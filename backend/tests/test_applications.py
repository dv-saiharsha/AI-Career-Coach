"""Application pipeline: persistence, ownership isolation, and stage rules.

The isolation tests are the important ones. Ownership is enforced by filtering
on the id from a verified JWT, so a caller cannot reach another user's row by
changing a value they control.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.deps import AuthenticatedUser, get_current_user
from app.main import app

USER_A = "00000000-0000-0000-0000-00000000000a"
USER_B = "00000000-0000-0000-0000-00000000000b"


@pytest.fixture
def db_session():
    # In-memory SQLite with a shared connection: the default would give each
    # connection its own blank database, so the table created here would be
    # invisible to the request handler.
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = TestingSession()
    yield session
    session.close()
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        id=USER_A, email="a@example.com"
    )
    yield TestClient(app)
    app.dependency_overrides.clear()


def as_user(client, user_id):
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        id=user_id, email=f"{user_id}@example.com"
    )
    return client


PAYLOAD = {"job_title": "ML Engineer", "company": "Acme", "location": "Austin, TX"}


class TestCreate:
    def test_creates_in_saved_by_default(self, client):
        response = client.post("/api/applications", json=PAYLOAD)
        assert response.status_code == 201
        assert response.json()["status"] == "saved"

    def test_rejects_missing_required_fields(self, client):
        assert client.post("/api/applications", json={"company": "Acme"}).status_code == 422

    def test_rejects_unknown_status(self, client):
        """Literal-typed status means a bad stage 422s with the allowed values
        rather than reaching the DB and failing the CHECK as an opaque 500."""
        response = client.post("/api/applications", json={**PAYLOAD, "status": "ghosted"})
        assert response.status_code == 422

    def test_creating_as_applied_stamps_applied_at(self, client):
        response = client.post("/api/applications", json={**PAYLOAD, "status": "applied"})
        assert response.json()["applied_at"] is not None

    def test_saved_application_has_no_applied_at(self, client):
        assert client.post("/api/applications", json=PAYLOAD).json()["applied_at"] is None

    def test_caller_cannot_set_user_id(self, client):
        """The create schema has no user_id field, so an injected one is
        ignored rather than filing the application against another account."""
        response = client.post("/api/applications", json={**PAYLOAD, "user_id": USER_B})
        assert response.status_code == 201
        as_user(client, USER_B)
        assert client.get("/api/applications/pipeline").json()["total"] == 0


class TestPipeline:
    def test_every_stage_key_present_when_empty(self, client):
        """A column with no cards still has to render — a missing key would
        make the column disappear from the board entirely."""
        pipeline = client.get("/api/applications/pipeline").json()["pipeline"]
        assert set(pipeline) == {
            "saved", "applied", "recruiter_contacted", "recruiter_screening",
            "online_assessment", "technical_interview", "manager_interview",
            "final_interview", "offer", "accepted", "rejected", "withdrawn",
        }
        assert all(v == [] for v in pipeline.values())

    def test_groups_by_stage(self, client):
        client.post("/api/applications", json=PAYLOAD)
        client.post("/api/applications", json={**PAYLOAD, "status": "offer"})
        body = client.get("/api/applications/pipeline").json()
        assert body["total"] == 2
        assert len(body["pipeline"]["saved"]) == 1
        assert len(body["pipeline"]["offer"]) == 1


class TestStatusTransitions:
    def test_moves_between_stages(self, client):
        app_id = client.post("/api/applications", json=PAYLOAD).json()["id"]
        response = client.patch(f"/api/applications/{app_id}/status", json={"status": "technical_interview"})
        assert response.status_code == 200
        assert response.json()["status"] == "technical_interview"

    def test_moving_to_applied_stamps_date(self, client):
        app_id = client.post("/api/applications", json=PAYLOAD).json()["id"]
        assert client.patch(f"/api/applications/{app_id}/status", json={"status": "applied"}).json()["applied_at"]

    def test_applied_at_is_not_reset_by_later_moves(self, client):
        """It records when the application went out. Moving forward to
        interviewing and back must not rewrite that date."""
        app_id = client.post("/api/applications", json=PAYLOAD).json()["id"]
        first = client.patch(f"/api/applications/{app_id}/status", json={"status": "applied"}).json()["applied_at"]
        client.patch(f"/api/applications/{app_id}/status", json={"status": "technical_interview"})
        again = client.patch(f"/api/applications/{app_id}/status", json={"status": "applied"}).json()
        assert again["applied_at"] == first

    def test_unknown_status_rejected(self, client):
        app_id = client.post("/api/applications", json=PAYLOAD).json()["id"]
        assert client.patch(f"/api/applications/{app_id}/status", json={"status": "nope"}).status_code == 422

    def test_missing_application_returns_404(self, client):
        assert client.patch("/api/applications/999999/status", json={"status": "offer"}).status_code == 404


class TestPartialUpdate:
    def test_notes_only_patch_leaves_status_untouched(self, client):
        """exclude_unset is what makes this work — with exclude_none, an
        omitted status would be sent as None and blank the field."""
        app_id = client.post("/api/applications", json={**PAYLOAD, "status": "offer"}).json()["id"]
        response = client.patch(f"/api/applications/{app_id}", json={"notes": "Met the team"})
        assert response.json()["status"] == "offer"
        assert response.json()["notes"] == "Met the team"

    def test_empty_patch_rejected(self, client):
        app_id = client.post("/api/applications", json=PAYLOAD).json()["id"]
        assert client.patch(f"/api/applications/{app_id}", json={}).status_code == 400


class TestOwnershipIsolation:
    """What the X-User-ID header approach could not provide: a caller cannot
    reach another account's rows by changing a value they control."""

    def test_pipeline_excludes_other_users(self, client):
        client.post("/api/applications", json=PAYLOAD)
        as_user(client, USER_B)
        assert client.get("/api/applications/pipeline").json()["total"] == 0

    def test_cannot_move_another_users_card(self, client):
        app_id = client.post("/api/applications", json=PAYLOAD).json()["id"]
        as_user(client, USER_B)
        response = client.patch(f"/api/applications/{app_id}/status", json={"status": "rejected"})
        # 404, not 403 — a 403 would confirm the row exists.
        assert response.status_code == 404

    def test_cannot_delete_another_users_card(self, client):
        app_id = client.post("/api/applications", json=PAYLOAD).json()["id"]
        as_user(client, USER_B)
        assert client.delete(f"/api/applications/{app_id}").status_code == 404
        as_user(client, USER_A)
        assert client.get("/api/applications/pipeline").json()["total"] == 1


class TestDelete:
    def test_deletes_own_application(self, client):
        app_id = client.post("/api/applications", json=PAYLOAD).json()["id"]
        assert client.delete(f"/api/applications/{app_id}").status_code == 204
        assert client.get("/api/applications/pipeline").json()["total"] == 0

    def test_missing_returns_404(self, client):
        assert client.delete("/api/applications/999999").status_code == 404


def test_unauthenticated_requests_rejected(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    try:
        unauthenticated = TestClient(app)
        assert unauthenticated.get("/api/applications/pipeline").status_code == 401
        assert unauthenticated.post("/api/applications", json=PAYLOAD).status_code == 401
    finally:
        app.dependency_overrides.clear()
