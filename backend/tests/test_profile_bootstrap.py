"""The profile row a signup trigger used to create.

Supabase's on_auth_user_created trigger inserted public.profiles when someone
signed up. The trigger is gone, so the backend creates the row the first time
it sees the person authenticated. It has to be idempotent and safe when a
brand-new user's first requests arrive together, which they always do: a page
load fires several API calls at once.
"""

import threading

import pytest
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

from app.core import deps
from app.core.database import Base
from app.models.profile import Profile
from app.modules.user_profile import services

USER = "00000000-0000-0000-0000-0000000000c1"


@pytest.fixture
def engine(tmp_path):
    # A file, not :memory:, so several threads can each hold their own connection.
    engine = create_engine(
        f"sqlite:///{tmp_path / 'p.db'}", connect_args={"check_same_thread": False, "timeout": 30}
    )
    Base.metadata.create_all(bind=engine)
    yield engine
    engine.dispose()


@pytest.fixture(autouse=True)
def _fresh_cache():
    deps._profile_ensured.clear()
    yield
    deps._profile_ensured.clear()


def _count(session, user_id=USER) -> int:
    return session.execute(select(func.count()).select_from(Profile).where(Profile.user_id == user_id)).scalar()


def test_creates_an_empty_profile_once(engine):
    Session = sessionmaker(bind=engine)
    with Session() as s:
        first = services.ensure_profile(s, USER)
        second = services.ensure_profile(s, USER)
        assert first.user_id == second.user_id == USER
        assert first.onboarding_completed is False and first.target_roles == "[]"
        assert _count(s) == 1


def test_an_existing_profile_is_not_overwritten(engine):
    Session = sessionmaker(bind=engine)
    with Session() as s:
        s.add(Profile(user_id=USER, onboarding_completed=True, bio="keep me"))
        s.commit()
        profile = services.ensure_profile(s, USER)
        assert profile.bio == "keep me" and profile.onboarding_completed is True


def test_concurrent_first_requests_create_exactly_one_profile(engine):
    """Eight 'first requests' released together; none may fail and one row results."""
    Session = sessionmaker(bind=engine)
    barrier = threading.Barrier(8)
    errors: list[BaseException] = []

    def first_request():
        try:
            with Session() as s:
                barrier.wait(timeout=10)
                services.ensure_profile(s, USER)
        except BaseException as exc:  # noqa: BLE001 - the point is to catch anything
            errors.append(exc)

    threads = [threading.Thread(target=first_request) for _ in range(8)]
    [t.start() for t in threads]
    [t.join(timeout=30) for t in threads]

    assert not errors, errors
    with Session() as s:
        assert _count(s) == 1


def _credentials():
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials="token")


def test_the_first_authenticated_request_creates_the_profile(engine, monkeypatch):
    monkeypatch.setattr(deps, "verify_supabase_token", lambda _t: {"sub": USER, "email": "a@x.com"})
    Session = sessionmaker(bind=engine)
    with Session() as s:
        user = deps.get_current_user(_credentials(), s)
        assert user.id == USER and _count(s) == 1
        assert USER in deps._profile_ensured


def test_a_known_user_costs_no_database_work(engine, monkeypatch):
    monkeypatch.setattr(deps, "verify_supabase_token", lambda _t: {"sub": USER, "email": "a@x.com"})
    deps._profile_ensured.add(USER)

    class ExplodingSession:
        def __getattr__(self, name):
            raise AssertionError("a cached user must not touch the database")

    assert deps.get_current_user(_credentials(), ExplodingSession()).id == USER


def test_a_database_failure_never_fails_authentication(monkeypatch):
    monkeypatch.setattr(deps, "verify_supabase_token", lambda _t: {"sub": USER, "email": "a@x.com"})

    class BrokenSession:
        def get_bind(self):
            raise RuntimeError("database is down")

        def rollback(self):
            pass

    user = deps.get_current_user(_credentials(), BrokenSession())
    assert user.id == USER
    assert USER not in deps._profile_ensured  # retried on the next request
