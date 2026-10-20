"""Profile photos: signed uploads, the confirm step, signed reads, and erasure.

Cloud Storage is replaced by an in-memory fake. This file proves the application's own
rules; that Cloud Storage really enforces the policy (size, type) and that signing works
with the real service account was checked separately against the real bucket.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.deps import AuthenticatedUser, get_current_user
from app.core.ratelimit import reset_rate_limits
from app.main import app
from app.models.profile import Profile
from app.modules.user_profile import avatars, router as profile_router

ALICE = "AliceFirebaseUid1234567890ab"  # a Firebase-style (non-UUID) id
BOB = "BobFirebaseUid1234567890abcd"
BUCKET = "test-bucket"
SIGNER = "signer@example.iam.gserviceaccount.com"


class FakeBlob:
    def __init__(self, store, name, content_type="image/png", size=1000):
        self._store, self.name, self.content_type, self.size = store, name, content_type, size

    def delete(self):
        if self._store.fail_deletes:
            raise RuntimeError("storage unavailable")
        self._store.blobs.pop(self.name, None)

    def generate_signed_url(self, **kwargs):
        self._store.signed_reads.append((self.name, kwargs))
        return f"https://signed.example/{self.name}?sig=1"


class FakeStore:
    """Plays the storage client, a bucket and the blobs in it."""

    def __init__(self):
        self.blobs: dict[str, FakeBlob] = {}
        self.policies: list[dict] = []
        self.signed_reads: list[tuple] = []
        self.fail_deletes = False
        self.fail_listing = False

    def add(self, name, content_type="image/png", size=1000):
        self.blobs[name] = FakeBlob(self, name, content_type, size)
        return self.blobs[name]

    # the client
    def bucket(self, _name):
        return self

    def get_blob(self, name):
        return self.blobs.get(name)

    def blob(self, name):
        return self.blobs.get(name) or FakeBlob(self, name)

    def list_blobs(self, _bucket, prefix=""):
        if self.fail_listing:
            raise RuntimeError("listing failed")
        return [b for n, b in list(self.blobs.items()) if n.startswith(prefix)]

    def generate_signed_post_policy_v4(self, bucket, path, **kwargs):
        self.policies.append({"bucket": bucket, "path": path, **kwargs})
        return {"url": f"https://storage.example/{bucket}/", "fields": {"key": path, "policy": "p", **kwargs["fields"]}}


class FakeCredentials:
    token = "access-token"
    valid = True


@pytest.fixture
def store(monkeypatch):
    fake = FakeStore()
    monkeypatch.setattr(avatars.settings, "AVATAR_BUCKET", BUCKET)
    monkeypatch.setattr(avatars.settings, "AVATAR_SIGNER_SERVICE_ACCOUNT", SIGNER)
    monkeypatch.setattr(avatars.settings, "AVATAR_MAX_BYTES", 5 * 1024 * 1024)
    monkeypatch.setattr(avatars, "_client", lambda: fake)
    monkeypatch.setattr(avatars, "_credentials", lambda: FakeCredentials())
    avatars._read_cache.clear()
    yield fake
    avatars._read_cache.clear()


# ---------------------------------------------------------------- creating an upload

class TestCreateUpload:
    def test_the_object_lives_in_the_callers_own_folder_with_a_matching_extension(self, store):
        upload = avatars.create_upload(ALICE, "image/webp")
        assert upload["path"].startswith(f"avatars/{ALICE}/") and upload["path"].endswith(".webp")
        assert "/" not in upload["path"][len(f"avatars/{ALICE}/"):]

    def test_the_policy_caps_size_pins_the_type_and_is_signed_as_the_signer(self, store):
        avatars.create_upload(ALICE, "image/png")
        policy = store.policies[0]
        assert policy["conditions"] == [["content-length-range", 1, 5 * 1024 * 1024]]
        assert policy["fields"] == {"Content-Type": "image/png"}
        assert policy["service_account_email"] == SIGNER and policy["access_token"] == "access-token"
        assert policy["expiration"].total_seconds() == 600

    @pytest.mark.parametrize("content_type", ["image/gif", "application/pdf", "text/html", "image/svg+xml", ""])
    def test_only_jpeg_png_and_webp_are_accepted(self, store, content_type):
        with pytest.raises(avatars.AvatarRejected):
            avatars.create_upload(ALICE, content_type)
        assert store.policies == []

    @pytest.mark.parametrize("uid", ["../other", "a/b", "", "x" * 129, "with space"])
    def test_a_user_id_cannot_escape_its_folder(self, store, uid):
        with pytest.raises(avatars.AvatarRejected):
            avatars.create_upload(uid, "image/png")

    def test_unconfigured_means_unavailable_not_a_crash(self, monkeypatch):
        monkeypatch.setattr(avatars.settings, "AVATAR_BUCKET", "")
        with pytest.raises(avatars.AvatarUnavailable):
            avatars.create_upload(ALICE, "image/png")

    def test_a_signing_failure_is_unavailable(self, store, monkeypatch):
        def boom(*a, **k):
            raise RuntimeError("iam down")
        monkeypatch.setattr(store, "generate_signed_post_policy_v4", boom)
        with pytest.raises(avatars.AvatarUnavailable):
            avatars.create_upload(ALICE, "image/png")


# ------------------------------------------------------------------ the confirm step

class TestConfirm:
    def _own(self, store, name="a.png", **kw):
        path = f"avatars/{ALICE}/{name}"
        store.add(path, **kw)
        return path

    def test_an_acceptable_upload_passes(self, store):
        avatars.confirm_upload(ALICE, self._own(store))

    def test_someone_elses_object_is_refused_and_left_alone(self, store):
        theirs = f"avatars/{BOB}/b.png"
        store.add(theirs)
        with pytest.raises(avatars.AvatarRejected):
            avatars.confirm_upload(ALICE, theirs)
        assert theirs in store.blobs

    @pytest.mark.parametrize("path", [f"avatars/{ALICE}/../{BOB}/b.png", f"avatars/{ALICE}/sub/a.png", "other/a.png", f"avatars/{ALICE}"])
    def test_paths_that_leave_the_callers_folder_are_refused(self, store, path):
        with pytest.raises(avatars.AvatarRejected):
            avatars.confirm_upload(ALICE, path)

    def test_a_missing_object_is_refused(self, store):
        with pytest.raises(avatars.AvatarRejected):
            avatars.confirm_upload(ALICE, f"avatars/{ALICE}/never-uploaded.png")

    def test_a_wrong_type_is_refused_and_deleted(self, store):
        path = self._own(store, "a.png", content_type="text/html")
        with pytest.raises(avatars.AvatarRejected):
            avatars.confirm_upload(ALICE, path)
        assert path not in store.blobs

    def test_an_extension_that_does_not_match_the_type_is_refused(self, store):
        path = self._own(store, "a.jpg", content_type="image/png")
        with pytest.raises(avatars.AvatarRejected):
            avatars.confirm_upload(ALICE, path)

    @pytest.mark.parametrize("size", [0, 5 * 1024 * 1024 + 1])
    def test_an_empty_or_oversized_object_is_refused_and_deleted(self, store, size):
        path = self._own(store, "a.png", size=size)
        with pytest.raises(avatars.AvatarRejected):
            avatars.confirm_upload(ALICE, path)
        assert path not in store.blobs

    def test_exactly_the_maximum_size_is_allowed(self, store):
        avatars.confirm_upload(ALICE, self._own(store, size=5 * 1024 * 1024))


# ------------------------------------------------------------------------ cleaning up

class TestPurge:
    def test_keeps_only_the_named_photo_and_never_touches_other_users(self, store):
        keep = f"avatars/{ALICE}/new.png"
        for name in (keep, f"avatars/{ALICE}/old1.png", f"avatars/{ALICE}/old2.jpg", f"avatars/{BOB}/bob.png"):
            store.add(name)
        assert avatars.purge(ALICE, keep=keep) is True
        assert set(store.blobs) == {keep, f"avatars/{BOB}/bob.png"}

    def test_without_keep_removes_every_photo_of_that_user(self, store):
        store.add(f"avatars/{ALICE}/a.png")
        store.add(f"avatars/{BOB}/b.png")
        assert avatars.purge(ALICE) is True
        assert list(store.blobs) == [f"avatars/{BOB}/b.png"]

    def test_a_storage_failure_is_reported_not_raised(self, store):
        store.add(f"avatars/{ALICE}/a.png")
        store.fail_deletes = True
        assert avatars.purge(ALICE) is False
        store.fail_deletes = False
        store.fail_listing = True
        assert avatars.purge(ALICE) is False

    def test_unconfigured_has_nothing_to_delete(self, monkeypatch):
        monkeypatch.setattr(avatars.settings, "AVATAR_BUCKET", "")
        assert avatars.purge(ALICE) is True


# ------------------------------------------------------------------------ reading it

class TestRead:
    def test_a_read_url_is_signed_as_the_signer_for_an_hour_and_cached(self, store):
        path = f"avatars/{ALICE}/a.png"
        store.add(path)
        first = avatars.read_url(path)
        second = avatars.read_url(path)
        assert first == second and len(store.signed_reads) == 1
        kwargs = store.signed_reads[0][1]
        assert kwargs["version"] == "v4" and kwargs["method"] == "GET"
        assert kwargs["service_account_email"] == SIGNER and kwargs["expiration"].total_seconds() == 3600

    def test_the_cache_is_dropped_when_photos_are_purged(self, store):
        path = f"avatars/{ALICE}/a.png"
        store.add(path)
        avatars.read_url(path)
        avatars.purge(ALICE)
        assert path not in avatars._read_cache

    def test_display_prefers_the_stored_photo_and_falls_back_to_the_providers(self, store, monkeypatch):
        path = f"avatars/{ALICE}/a.png"
        store.add(path)
        assert avatars.display_url(path, "https://google/pic") == f"https://signed.example/{path}?sig=1"
        assert avatars.display_url(None, "https://google/pic") == "https://google/pic"

        def boom(_path):
            raise avatars.AvatarUnavailable("down")
        monkeypatch.setattr(avatars, "read_url", boom)
        assert avatars.display_url(path, "https://google/pic") == "https://google/pic"

    def test_unconfigured_just_shows_the_providers_picture(self, monkeypatch):
        monkeypatch.setattr(avatars.settings, "AVATAR_BUCKET", "")
        assert avatars.display_url("avatars/x/y.png", "https://google/pic") == "https://google/pic"


# ---------------------------------------------------------------------- over HTTP

@pytest.fixture
def api(store):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    session.add(Profile(user_id=ALICE, onboarding_completed=True, avatar_url="https://google/pic"))
    session.add(Profile(user_id=BOB, onboarding_completed=True))
    session.commit()
    app.dependency_overrides[get_db] = lambda: session
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(id=ALICE, email="a@x.com")
    reset_rate_limits()
    yield TestClient(app), session, store
    app.dependency_overrides.clear()
    reset_rate_limits()
    session.close()


class TestEndpoints:
    def test_upload_confirm_then_the_profile_shows_a_signed_url_and_old_photos_go(self, api):
        client, session, store = api
        store.add(f"avatars/{ALICE}/old.png")
        upload = client.post("/api/user/avatar/upload-url", json={"content_type": "image/png"}).json()
        assert upload["max_bytes"] == 5 * 1024 * 1024 and upload["fields"]["Content-Type"] == "image/png"
        store.add(upload["path"])  # what the browser's direct upload would have produced

        response = client.post("/api/user/avatar/confirm", json={"path": upload["path"]})
        assert response.status_code == 200
        assert response.json()["avatar_url"] == f"https://signed.example/{upload['path']}?sig=1"
        assert session.get(Profile, ALICE).avatar_path == upload["path"]
        assert set(store.blobs) == {upload["path"]}, "the previous photo should have been removed"

    def test_confirming_someone_elses_object_changes_nothing(self, api):
        client, session, store = api
        store.add(f"avatars/{BOB}/b.png")
        response = client.post("/api/user/avatar/confirm", json={"path": f"avatars/{BOB}/b.png"})
        assert response.status_code == 422
        assert session.get(Profile, ALICE).avatar_path is None
        assert f"avatars/{BOB}/b.png" in store.blobs

    def test_patch_cannot_set_avatar_path_so_no_one_can_read_another_persons_photo(self, api):
        client, session, store = api
        store.add(f"avatars/{BOB}/b.png")
        response = client.patch("/api/user/profile", json={"avatar_path": f"avatars/{BOB}/b.png", "bio": "hello"})
        assert response.status_code == 200
        profile = session.get(Profile, ALICE)
        assert profile.avatar_path is None, "PATCH must not be able to write avatar_path"
        assert profile.bio == "hello", "the rest of the PATCH still applies"
        assert response.json()["avatar_url"] == "https://google/pic"

    def test_removing_the_photo_clears_it_and_restores_the_providers_picture(self, api):
        client, session, store = api
        path = f"avatars/{ALICE}/a.png"
        store.add(path)
        session.get(Profile, ALICE).avatar_path = path
        session.commit()
        response = client.delete("/api/user/avatar")
        assert response.status_code == 200 and response.json()["avatar_url"] == "https://google/pic"
        assert session.get(Profile, ALICE).avatar_path is None and not store.blobs

    def test_an_unsupported_type_is_a_422(self, api):
        client, _s, _st = api
        assert client.post("/api/user/avatar/upload-url", json={"content_type": "image/gif"}).status_code == 422

    def test_uploads_are_rate_limited(self, api):
        client, _s, _st = api
        codes = [client.post("/api/user/avatar/upload-url", json={"content_type": "image/png"}).status_code for _ in range(11)]
        assert codes[:10] == [200] * 10 and codes[10] == 429

    def test_unconfigured_is_a_503_not_a_500(self, api, monkeypatch):
        client, _s, _st = api
        monkeypatch.setattr(avatars.settings, "AVATAR_BUCKET", "")
        assert client.post("/api/user/avatar/upload-url", json={"content_type": "image/png"}).status_code == 503

    def test_erasing_the_account_deletes_the_photos_first(self, api, monkeypatch):
        client, session, store = api
        store.add(f"avatars/{ALICE}/a.png")
        store.add(f"avatars/{BOB}/b.png")
        monkeypatch.setattr(profile_router, "delete_auth_user", lambda uid: True)
        body = client.delete("/api/user/account?confirm=DELETE").json()
        assert body["avatar_deleted"] is True
        assert list(store.blobs) == [f"avatars/{BOB}/b.png"]

    def test_a_storage_failure_during_erasure_is_reported_and_the_rest_still_happens(self, api, monkeypatch):
        client, session, store = api
        store.add(f"avatars/{ALICE}/a.png")
        store.fail_deletes = True
        monkeypatch.setattr(profile_router, "delete_auth_user", lambda uid: True)
        response = client.delete("/api/user/account?confirm=DELETE")
        assert response.status_code == 200 and response.json()["avatar_deleted"] is False
        assert session.get(Profile, ALICE) is None, "the rows were still erased"


class TestServiceLevelGuard:
    """The request schema already drops avatar_path; the service refuses it too, so a future
    caller that reaches update_profile directly cannot reopen the hole."""

    def test_update_profile_ignores_server_only_fields_whatever_they_carry(self, api):
        _client, session, _store = api
        from app.modules.user_profile import services
        services.update_profile(session, ALICE, {
            "avatar_path": f"avatars/{BOB}/b.png", "user_id": BOB, "bio": "kept",
        })
        profile = session.get(Profile, ALICE)
        assert profile.avatar_path is None and profile.user_id == ALICE
        assert profile.bio == "kept"
