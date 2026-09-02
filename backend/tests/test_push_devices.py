"""Device registration for push notifications.

The behaviour worth testing here is not "a row is written" — it is what
happens when a token that already exists arrives under a different user.
Getting that wrong sends one person's interview reminders to another, which
is the one failure mode this table exists to prevent.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.deps import AuthenticatedUser, get_current_user
from app.main import app
from app.models.user_device import UserDevice

USER_A = "00000000-0000-0000-0000-00000000000a"
USER_B = "00000000-0000-0000-0000-00000000000b"
TOKEN = "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"


@pytest.fixture
def db_session():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


@pytest.fixture
def as_user(db_session):
    """A client signed in as whichever user id is passed."""

    def _client(user_id: str) -> TestClient:
        app.dependency_overrides[get_db] = lambda: db_session
        app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
            id=user_id, email=f"{user_id}@example.com"
        )
        return TestClient(app)

    yield _client
    app.dependency_overrides.clear()


class TestRegister:
    def test_registers_a_new_token(self, as_user, db_session):
        response = as_user(USER_A).post(
            "/api/notifications/devices",
            json={"expo_push_token": TOKEN, "platform": "ios"},
        )
        assert response.status_code == 201
        assert response.json()["platform"] == "ios"

        rows = db_session.query(UserDevice).all()
        assert len(rows) == 1
        assert rows[0].user_id == USER_A

    def test_registering_twice_updates_rather_than_duplicates(self, as_user, db_session):
        client = as_user(USER_A)
        client.post("/api/notifications/devices", json={"expo_push_token": TOKEN, "platform": "ios"})
        client.post(
            "/api/notifications/devices", json={"expo_push_token": TOKEN, "platform": "android"}
        )

        rows = db_session.query(UserDevice).all()
        assert len(rows) == 1, "a duplicate row is a duplicate notification"
        assert rows[0].platform == "android"

    def test_a_device_that_changes_hands_moves_to_the_new_user(self, as_user, db_session):
        """The case that matters. Someone signs out, someone else signs in on
        the same phone — the token must follow the new user, or the previous
        one keeps receiving notifications about a stranger's job search."""
        as_user(USER_A).post(
            "/api/notifications/devices", json={"expo_push_token": TOKEN, "platform": "ios"}
        )
        as_user(USER_B).post(
            "/api/notifications/devices", json={"expo_push_token": TOKEN, "platform": "ios"}
        )

        rows = db_session.query(UserDevice).all()
        assert len(rows) == 1
        assert rows[0].user_id == USER_B

    @pytest.mark.parametrize(
        "token",
        ["", "not-a-token", "ExponentPushToken[unterminated", "ghijkl[abc]"],
    )
    def test_rejects_a_token_that_is_not_an_expo_token(self, as_user, db_session, token):
        response = as_user(USER_A).post(
            "/api/notifications/devices", json={"expo_push_token": token, "platform": "ios"}
        )
        assert response.status_code == 400
        assert db_session.query(UserDevice).count() == 0

    def test_rejects_an_unknown_platform(self, as_user):
        response = as_user(USER_A).post(
            "/api/notifications/devices",
            json={"expo_push_token": TOKEN, "platform": "windows-phone"},
        )
        assert response.status_code == 422


class TestUnregister:
    def test_removes_the_callers_own_token(self, as_user, db_session):
        client = as_user(USER_A)
        client.post("/api/notifications/devices", json={"expo_push_token": TOKEN, "platform": "ios"})

        assert client.delete(f"/api/notifications/devices/{TOKEN}").status_code == 204
        assert db_session.query(UserDevice).count() == 0

    def test_will_not_remove_someone_elses_token(self, as_user, db_session):
        """Knowing a token must not be enough to silence its owner."""
        as_user(USER_A).post(
            "/api/notifications/devices", json={"expo_push_token": TOKEN, "platform": "ios"}
        )

        assert as_user(USER_B).delete(f"/api/notifications/devices/{TOKEN}").status_code == 204
        assert db_session.query(UserDevice).count() == 1, "another user's row was deleted"

    def test_is_idempotent(self, as_user):
        """Sign-out is not a place to fail. Deleting a token that is already
        gone succeeds rather than 404ing into a case the client must handle."""
        client = as_user(USER_A)
        assert client.delete(f"/api/notifications/devices/{TOKEN}").status_code == 204
        assert client.delete(f"/api/notifications/devices/{TOKEN}").status_code == 204
