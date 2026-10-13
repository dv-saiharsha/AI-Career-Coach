"""Firebase token verification, and what happens to a person after they are erased.

The SDK is replaced by an in-memory directory whose behaviour is taken from the
installed firebase_admin source (check_revoked calls get_user, so a deleted user
raises UserNotFoundError and a disabled one raises UserDisabledError, neither of
which is an InvalidIdTokenError). Nothing here talks to Google.
"""

import time

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from fastapi.testclient import TestClient
from firebase_admin import auth as fb
from firebase_admin import exceptions as fb_exceptions
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core import deps, security
from app.core.config import settings
from app.core.database import Base, get_db
from app.main import app
from app.models.application import JobApplication
from app.models.notification import Notification
from app.models.profile import Profile
from app.models.resume import ResumeAnalysis
from app.models.story import StarStory
from app.modules.user_profile import auth_admin, privacy

ALICE = "00000000-0000-0000-0000-00000000000a"
BOB = "00000000-0000-0000-0000-00000000000b"


class FakeFirebase:
    """The parts of firebase_admin.auth the backend uses, with the SDK's semantics."""

    def __init__(self):
        self.users: dict[str, dict] = {}
        self.tokens: dict[str, dict] = {}
        self.verify_calls: list[bool] = []
        self.delete_fails = False
        self.keys_unreachable = False

    def add_user(self, uid, *, disabled=False):
        self.users[uid] = {"disabled": disabled, "revoked": False}

    def issue(self, uid, *, email="a@example.com", verified=True, provider="google.com",
              picture=None, expired=False):
        token = f"token-{uid}-{len(self.tokens)}"
        self.tokens[token] = {
            "uid": uid, "email": email, "email_verified": verified, "picture": picture,
            "name": "A Person", "firebase": {"sign_in_provider": provider},
            "exp": time.time() + (-10 if expired else 3600), "_expired": expired,
        }
        return token

    # --- the SDK surface ---------------------------------------------------
    def verify_id_token(self, token, app=None, check_revoked=False, clock_skew_seconds=0):
        self.verify_calls.append(check_revoked)
        if self.keys_unreachable:
            raise fb.CertificateFetchError("keys unreachable", cause=None)
        claims = self.tokens.get(token)
        if claims is None:
            raise fb.InvalidIdTokenError("not a token")
        if claims["_expired"]:
            raise fb.ExpiredIdTokenError("expired", cause=None)
        if check_revoked:  # what the real SDK does: get_user(uid)
            user = self.users.get(claims["uid"])
            if user is None:
                raise fb.UserNotFoundError("no user")
            if user["disabled"]:
                raise fb.UserDisabledError("The user record is disabled.")
            if user["revoked"]:
                raise fb.RevokedIdTokenError("revoked")
        return {k: v for k, v in claims.items() if not k.startswith("_")}

    def delete_user(self, uid, app=None):
        if self.delete_fails:
            raise fb_exceptions.UnavailableError("firebase is down")
        if uid not in self.users:
            raise fb.UserNotFoundError("no user")
        del self.users[uid]


@pytest.fixture
def firebase(monkeypatch):
    fake = FakeFirebase()
    monkeypatch.setattr(security.firebase_auth, "verify_id_token", fake.verify_id_token)
    monkeypatch.setattr(security.firebase_auth, "delete_user", fake.delete_user)
    monkeypatch.setattr(auth_admin.firebase_auth, "delete_user", fake.delete_user)
    monkeypatch.setattr(security, "_firebase_app", lambda: None)
    monkeypatch.setattr(security, "firebase_app", lambda: None)
    monkeypatch.setattr(settings, "FIREBASE_PROJECT_ID", "test-project")
    return fake


# ------------------------------------------------------------------ the verifier

class TestVerification:
    def test_a_valid_token_is_accepted_and_normalised(self, firebase):
        firebase.add_user(ALICE)
        claims = security.verify_firebase_token(
            firebase.issue(ALICE, email="a@example.com", picture="https://x/p.png")
        )
        assert claims["sub"] == ALICE and claims["email"] == "a@example.com"
        assert claims["email_verified"] is True and claims["picture"] == "https://x/p.png"
        assert claims["sign_in_provider"] == "google.com"

    def test_revocation_is_always_checked(self, firebase):
        """Without check_revoked a deleted user's token stays valid for an hour."""
        firebase.add_user(ALICE)
        security.verify_firebase_token(firebase.issue(ALICE))
        assert firebase.verify_calls == [True]

    @pytest.mark.parametrize("make", [
        lambda f: "garbage",
        lambda f: f.issue(ALICE, expired=True),
        lambda f: "",
    ])
    def test_bad_and_expired_tokens_are_rejected(self, firebase, make):
        firebase.add_user(ALICE)
        with pytest.raises(security.TokenRejected):
            security.verify_firebase_token(make(firebase))

    def test_a_deleted_user_is_rejected_not_an_unhandled_error(self, firebase):
        # UserNotFoundError is not an InvalidIdTokenError: catching only that
        # family would let this escape as a 500.
        token = firebase.issue(ALICE)  # never added to the directory
        with pytest.raises(security.TokenRejected):
            security.verify_firebase_token(token)

    def test_a_disabled_user_is_rejected(self, firebase):
        firebase.add_user(ALICE, disabled=True)
        with pytest.raises(security.TokenRejected):
            security.verify_firebase_token(firebase.issue(ALICE))

    def test_a_revoked_token_is_rejected(self, firebase):
        firebase.add_user(ALICE)
        firebase.users[ALICE]["revoked"] = True
        with pytest.raises(security.TokenRejected):
            security.verify_firebase_token(firebase.issue(ALICE))

    def test_an_outage_is_unavailable_not_a_rejection(self, firebase):
        """Google's keys being unreachable must not sign everybody out."""
        firebase.add_user(ALICE)
        firebase.keys_unreachable = True
        with pytest.raises(security.AuthUnavailable):
            security.verify_firebase_token(firebase.issue(ALICE))

    def test_an_unexpected_sdk_failure_fails_closed_as_unavailable(self, firebase, monkeypatch):
        def boom(*a, **k):
            raise RuntimeError("socket exploded")
        monkeypatch.setattr(security.firebase_auth, "verify_id_token", boom)
        with pytest.raises(security.AuthUnavailable):
            security.verify_firebase_token("anything")

    def test_unconfigured_is_unavailable(self, firebase, monkeypatch):
        monkeypatch.undo()  # drop the fake _firebase_app so the real check runs
        monkeypatch.setattr(settings, "FIREBASE_PROJECT_ID", "")
        monkeypatch.setattr(security, "_app", None)
        with pytest.raises(security.AuthUnavailable):
            security.verify_firebase_token("anything")


class TestCache:
    def test_a_repeat_within_the_window_does_not_call_firebase(self, firebase):
        firebase.add_user(ALICE)
        token = firebase.issue(ALICE)
        security.verify_firebase_token(token)
        security.verify_firebase_token(token)
        assert firebase.verify_calls == [True], "the second verification should be served from cache"

    def test_forgetting_a_user_forces_a_fresh_check(self, firebase):
        firebase.add_user(ALICE)
        token = firebase.issue(ALICE)
        security.verify_firebase_token(token)
        firebase.users.pop(ALICE)
        security.forget_user(ALICE)
        with pytest.raises(security.TokenRejected):
            security.verify_firebase_token(token)

    def test_a_blocked_user_is_rejected_even_with_a_cached_verification(self, firebase):
        firebase.add_user(ALICE)
        token = firebase.issue(ALICE)
        security.verify_firebase_token(token)  # now cached
        security.block_user(ALICE)
        with pytest.raises(security.TokenRejected):
            security.verify_firebase_token(token)

    def test_a_blocked_user_is_rejected_on_a_fresh_verification_too(self, firebase):
        firebase.add_user(ALICE)
        security.block_user(ALICE)
        with pytest.raises(security.TokenRejected):
            security.verify_firebase_token(firebase.issue(ALICE))

    def test_the_cache_never_outlives_the_token(self, firebase):
        firebase.add_user(ALICE)
        token = firebase.issue(ALICE)
        firebase.tokens[token]["exp"] = time.time() + 1
        security.verify_firebase_token(token)
        (valid_until, _uid, _claims), = security._cache.values()
        assert valid_until <= firebase.tokens[token]["exp"]


# ------------------------------------------------------------- the dependency

def _creds(token):
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


class TestDependency:
    @pytest.fixture
    def session(self):
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(bind=engine)
        with sessionmaker(bind=engine)() as s:
            yield s

    def _status(self, token, session):
        with pytest.raises(HTTPException) as exc:
            deps.get_current_user(_creds(token), session)
        return exc.value.status_code, exc.value.detail

    def test_no_credentials_is_401(self, session):
        with pytest.raises(HTTPException) as exc:
            deps.get_current_user(None, session)
        assert exc.value.status_code == 401

    def test_a_rejected_token_is_401(self, firebase, session):
        assert self._status("garbage", session)[0] == 401

    def test_an_outage_is_503(self, firebase, session):
        firebase.add_user(ALICE)
        firebase.keys_unreachable = True
        assert self._status(firebase.issue(ALICE), session)[0] == 503

    def test_an_unverified_email_is_403_with_a_distinct_code(self, firebase, session):
        firebase.add_user(ALICE)
        status, detail = self._status(firebase.issue(ALICE, verified=False, provider="password"), session)
        assert (status, detail) == (403, "email_not_verified")

    def test_unverified_users_get_no_profile_row(self, firebase, session):
        firebase.add_user(ALICE)
        self._status(firebase.issue(ALICE, verified=False, provider="password"), session)
        assert session.query(Profile).count() == 0

    def test_a_verified_user_gets_a_profile_with_their_picture(self, firebase, session):
        firebase.add_user(ALICE)
        user = deps.get_current_user(_creds(firebase.issue(ALICE, picture="https://x/p.png")), session)
        assert user.id == ALICE
        assert session.query(Profile).one().avatar_url == "https://x/p.png"


# -------------------------------------------- after erasure, end to end over HTTP

@pytest.fixture
def world(firebase):
    """The real app and the real auth dependency; only Firebase and the database are local."""
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    app.dependency_overrides[get_db] = lambda: session
    client = TestClient(app, raise_server_exceptions=False)
    yield client, session, firebase
    app.dependency_overrides.pop(get_db, None)
    session.close()


def _seed(session, uid):
    session.add(Profile(user_id=uid, onboarding_completed=True))
    session.add(ResumeAnalysis(user_id=uid, resume_filename="cv.pdf", job_description="jd",
                               ats_score=70, result_json="{}"))
    session.add(JobApplication(user_id=uid, job_title="Engineer", company="Acme", status="applied"))
    session.add(StarStory(user_id=uid, title="story"))
    session.add(Notification(user_id=uid, type="resume_needs_attention", category="resume",
                             title="t", message="m", dedupe_key=f"k-{uid[-1]}"))
    session.commit()


def _rows_for(session, uid) -> dict[str, int]:
    return {
        model.__tablename__: session.execute(
            select(func.count()).select_from(model).where(model.user_id == uid)
        ).scalar()
        for model in (Profile, ResumeAnalysis, JobApplication, StarStory, Notification)
    }


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


class TestAfterErasure:
    def _erase(self, client, token):
        return client.delete("/api/user/account?confirm=DELETE", headers=_auth(token))

    def test_the_old_token_cannot_recreate_anything(self, world):
        client, session, firebase = world
        firebase.add_user(ALICE)
        firebase.add_user(BOB)
        _seed(session, ALICE)
        _seed(session, BOB)
        token = firebase.issue(ALICE)

        assert client.get("/api/user/profile", headers=_auth(token)).status_code == 200
        response = self._erase(client, token)
        assert response.status_code == 200 and response.json()["sign_in_disabled"] is True
        assert ALICE not in firebase.users, "the Firebase user should be deleted"
        assert sum(_rows_for(session, ALICE).values()) == 0

        for path in ("/api/user/profile", "/api/notifications", "/api/dashboard/home",
                     "/api/applications/pipeline", "/api/interview/stories"):
            assert client.get(path, headers=_auth(token)).status_code == 401, path
        assert sum(_rows_for(session, ALICE).values()) == 0, "a request after erasure recreated rows"
        assert all(v > 0 for v in _rows_for(session, BOB).values()), "someone else's data was touched"

    def test_another_process_that_never_saw_the_user_also_refuses(self, world):
        """No in-process block and no cache: only Firebase's own answer protects us."""
        client, session, firebase = world
        firebase.add_user(ALICE)
        _seed(session, ALICE)
        token = firebase.issue(ALICE)
        assert self._erase(client, token).status_code == 200

        security._cache.clear()
        security._blocked.clear()
        deps._profile_ensured.clear()

        assert client.get("/api/user/profile", headers=_auth(token)).status_code == 401
        assert sum(_rows_for(session, ALICE).values()) == 0

    def test_when_firebase_deletion_fails_the_block_still_protects_this_process(self, world):
        client, session, firebase = world
        firebase.add_user(ALICE)
        _seed(session, ALICE)
        token = firebase.issue(ALICE)
        firebase.delete_fails = True

        response = self._erase(client, token)

        assert response.status_code == 200
        assert response.json()["sign_in_disabled"] is False, "must report that the login remains"
        assert ALICE in firebase.users
        assert client.get("/api/user/profile", headers=_auth(token)).status_code == 401
        assert sum(_rows_for(session, ALICE).values()) == 0

    def test_a_failed_erasure_leaves_the_user_able_to_retry(self, world, monkeypatch):
        client, session, firebase = world
        firebase.add_user(ALICE)
        _seed(session, ALICE)
        token = firebase.issue(ALICE)
        monkeypatch.setattr(privacy, "delete_user_data", lambda db, uid: (_ for _ in ()).throw(RuntimeError("db down")))

        assert self._erase(client, token).status_code == 500
        assert ALICE in firebase.users, "the login must survive a failed erasure"
        assert not security.is_blocked(ALICE)
        assert client.get("/api/user/profile", headers=_auth(token)).status_code == 200

    def test_a_rejected_confirmation_blocks_nobody(self, world):
        client, session, firebase = world
        firebase.add_user(ALICE)
        _seed(session, ALICE)
        token = firebase.issue(ALICE)
        assert client.delete("/api/user/account?confirm=yes", headers=_auth(token)).status_code == 400
        assert not security.is_blocked(ALICE)
        assert client.get("/api/user/profile", headers=_auth(token)).status_code == 200
