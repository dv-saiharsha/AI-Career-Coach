"""Milestone 10 — the Notification Engine.

Covers the engine primitives (dedupe, grouping, expiration, mark-read/
archive) directly against the service layer, the event-driven triggers
wired into resume analysis and application status changes, the periodic
sweep wired into the dashboard's /home, and the REST surface end to end.
"""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.deps import AuthenticatedUser, get_current_user
from app.main import app
from app.models.application import ApplicationStatusHistory, JobApplication
from app.models.notification import Notification
from app.modules.notifications import service

USER_A = "00000000-0000-0000-0000-00000000000a"
USER_B = "00000000-0000-0000-0000-00000000000b"


@pytest.fixture
def db_session():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(autocommit=False, autoflush=False, bind=engine)()
    yield session
    session.close()
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(id=USER_A, email="a@example.com")
    yield TestClient(app)
    app.dependency_overrides.clear()


def make(db, user_id=USER_A, **overrides):
    defaults = dict(
        type="resume_needs_attention", category="resume", priority="medium",
        title="t", message="m", dedupe_key="k1",
    )
    defaults.update(overrides)
    return service.create_notification(db, user_id, **defaults)


# -- Engine primitives ------------------------------------------------------


class TestCreateAndDedupe:
    def test_creates_a_row(self, db_session):
        row = make(db_session)
        assert row is not None
        assert row.occurrence_count == 1
        assert row.read_at is None

    def test_same_dedupe_key_with_no_window_never_refires(self, db_session):
        make(db_session, dedupe_key="once")
        second = make(db_session, dedupe_key="once", title="different")
        assert second is None
        assert db_session.query(Notification).count() == 1

    def test_dedupe_window_allows_refire_after_it_elapses(self, db_session):
        row = make(db_session, dedupe_key="w", dedupe_window=timedelta(days=7))
        row.created_at = datetime.now(timezone.utc) - timedelta(days=8)
        db_session.commit()

        second = make(db_session, dedupe_key="w", dedupe_window=timedelta(days=7))
        assert second is not None
        assert db_session.query(Notification).filter(Notification.dedupe_key == "w").count() == 2

    def test_dedupe_window_blocks_refire_within_window(self, db_session):
        make(db_session, dedupe_key="w2", dedupe_window=timedelta(days=7))
        second = make(db_session, dedupe_key="w2", dedupe_window=timedelta(days=7))
        assert second is None

    def test_dedupe_is_scoped_per_user(self, db_session):
        make(db_session, user_id=USER_A, dedupe_key="shared")
        other = make(db_session, user_id=USER_B, dedupe_key="shared")
        assert other is not None


class TestGrouping:
    def test_matching_group_key_bumps_existing_row_instead_of_inserting(self, db_session):
        first = make(db_session, dedupe_key="g1", group_key="grp")
        second = service.create_notification(
            db_session, USER_A,
            type="resume_needs_attention", category="resume", priority="medium",
            title="t2", message="m2", dedupe_key="g2", group_key="grp",
        )
        assert second is not None
        assert second.id == first.id
        assert second.occurrence_count == 2
        assert second.message == "m2"
        assert db_session.query(Notification).count() == 1

    def test_grouped_update_resets_read_state(self, db_session):
        first = make(db_session, dedupe_key="g3", group_key="grp2")
        service.mark_read(db_session, USER_A, first.id)
        updated = service.create_notification(
            db_session, USER_A,
            type="resume_needs_attention", category="resume", priority="medium",
            title="t", message="new", dedupe_key="g4", group_key="grp2",
        )
        assert updated.read_at is None

    def test_no_group_key_on_second_call_is_a_plain_skip(self, db_session):
        make(db_session, dedupe_key="g5", group_key="grp3")
        second = make(db_session, dedupe_key="g5")  # same dedupe_key, no group_key this time
        assert second is None


class TestListingAndCounts:
    def test_unread_count_reflects_read_state(self, db_session):
        make(db_session, dedupe_key="a")
        make(db_session, dedupe_key="b")
        assert service.unread_count(db_session, USER_A) == 2
        row = service.list_notifications(db_session, USER_A)[0]
        service.mark_read(db_session, USER_A, row["id"])
        assert service.unread_count(db_session, USER_A) == 1

    def test_mark_all_read(self, db_session):
        make(db_session, dedupe_key="a")
        make(db_session, dedupe_key="b")
        updated = service.mark_all_read(db_session, USER_A)
        assert updated == 2
        assert service.unread_count(db_session, USER_A) == 0

    def test_archive_removes_from_active_list_but_not_history(self, db_session):
        row = make(db_session, dedupe_key="a")
        service.archive(db_session, USER_A, row.id)
        assert service.list_notifications(db_session, USER_A) == []
        assert len(service.list_notifications(db_session, USER_A, include_archived=True)) == 1

    def test_expired_notifications_are_excluded_from_active_list(self, db_session):
        row = make(db_session, dedupe_key="a", expires_in_days=1)
        row.expires_at = datetime.now(timezone.utc) - timedelta(days=1)
        db_session.commit()
        assert service.list_notifications(db_session, USER_A) == []
        assert service.unread_count(db_session, USER_A) == 0

    def test_cannot_mark_or_archive_another_users_notification(self, db_session):
        row = make(db_session, user_id=USER_B, dedupe_key="a")
        assert service.mark_read(db_session, USER_A, row.id) is None
        assert service.archive(db_session, USER_A, row.id) is None


# -- Event-driven: resume scans ----------------------------------------------


class TestResumeScanTrigger:
    def test_first_scan_with_weak_band_flags_needs_attention_only(self, db_session):
        service.notify_resume_scanned(
            db_session, USER_A, analysis_id=1, new_score=40.0, previous_score=None, latest_band="WEAK",
        )
        types = {n["type"] for n in service.list_notifications(db_session, USER_A)}
        assert types == {"resume_needs_attention"}

    def test_improved_score_past_threshold_fires_score_changed(self, db_session):
        service.notify_resume_scanned(
            db_session, USER_A, analysis_id=2, new_score=85.0, previous_score=70.0, latest_band="GOOD",
        )
        notes = service.list_notifications(db_session, USER_A)
        assert len(notes) == 1
        assert notes[0]["type"] == "resume_score_changed"
        assert "Improved" in notes[0]["title"]

    def test_dropped_score_past_threshold_fires_dropped_wording(self, db_session):
        service.notify_resume_scanned(
            db_session, USER_A, analysis_id=3, new_score=60.0, previous_score=80.0, latest_band="NEEDS WORK",
        )
        types = {n["type"]: n for n in service.list_notifications(db_session, USER_A)}
        assert "Dropped" in types["resume_score_changed"]["title"]
        assert "resume_needs_attention" in types

    def test_small_change_below_threshold_is_not_notified(self, db_session):
        service.notify_resume_scanned(
            db_session, USER_A, analysis_id=4, new_score=81.0, previous_score=80.0, latest_band="GOOD",
        )
        assert service.list_notifications(db_session, USER_A) == []


# -- Event-driven: application status changes --------------------------------


class TestApplicationStatusTrigger:
    def test_status_change_fires_generic_notification(self, db_session):
        service.notify_application_status_changed(
            db_session, USER_A, application_id=1, company="Acme", job_title="Engineer",
            from_status="applied", to_status="recruiter_contacted",
        )
        types = {n["type"] for n in service.list_notifications(db_session, USER_A)}
        assert types == {"application_status_changed"}

    def test_moving_into_interview_stage_also_fires_interview_notification(self, db_session):
        service.notify_application_status_changed(
            db_session, USER_A, application_id=2, company="Acme", job_title="Engineer",
            from_status="recruiter_contacted", to_status="technical_interview",
        )
        types = {n["type"] for n in service.list_notifications(db_session, USER_A)}
        assert types == {"application_status_changed", "interview_stage_reached"}

    def test_via_router_patch_status(self, client, db_session):
        app_row = JobApplication(user_id=USER_A, job_title="Backend Engineer", company="Acme", status="applied")
        db_session.add(app_row)
        db_session.commit()
        db_session.refresh(app_row)
        db_session.add(ApplicationStatusHistory(application_id=app_row.id, from_status=None, to_status="applied"))
        db_session.commit()

        response = client.patch(f"/api/applications/{app_row.id}/status", json={"status": "technical_interview"})
        assert response.status_code == 200

        body = client.get("/api/notifications").json()
        types = {n["type"] for n in body["notifications"]}
        assert "application_status_changed" in types
        assert "interview_stage_reached" in types


class TestJobMatchGrouping:
    """_check_job_matches is the one real trigger that exercises the
    engine's grouping primitive — multiple distinct qualifying jobs found in
    the same sweep collapse into one row rather than one each."""

    def test_two_qualifying_jobs_in_one_sweep_collapse_into_one_notification(self, db_session, monkeypatch):
        fixture = [
            {"id": "101", "title": "Backend Engineer", "company": "Acme", "match": {"overallMatch": 90}},
            {"id": "102", "title": "Platform Engineer", "company": "Globex", "match": {"overallMatch": 88}},
        ]
        monkeypatch.setattr("app.modules.job_market.services.top_matches", lambda db, user_id, limit=5: fixture)

        service._check_job_matches(db_session, USER_A, None)

        rows = [n for n in service.list_notifications(db_session, USER_A) if n["type"] == "high_match_job"]
        assert len(rows) == 1
        assert rows[0]["occurrence_count"] == 2
        assert rows[0]["title"] == "New High Match Jobs"
        assert "Globex" in rows[0]["message"]

    def test_same_job_is_not_re_announced_on_a_second_sweep(self, db_session, monkeypatch):
        fixture = [{"id": "101", "title": "Backend Engineer", "company": "Acme", "match": {"overallMatch": 90}}]
        monkeypatch.setattr("app.modules.job_market.services.top_matches", lambda db, user_id, limit=5: fixture)

        service._check_job_matches(db_session, USER_A, None)
        service._check_job_matches(db_session, USER_A, None)

        rows = [n for n in service.list_notifications(db_session, USER_A) if n["type"] == "high_match_job"]
        assert len(rows) == 1
        assert rows[0]["occurrence_count"] == 1

    def test_below_threshold_match_is_not_notified(self, db_session, monkeypatch):
        fixture = [{"id": "103", "title": "Support Engineer", "company": "Initech", "match": {"overallMatch": 50}}]
        monkeypatch.setattr("app.modules.job_market.services.top_matches", lambda db, user_id, limit=5: fixture)

        service._check_job_matches(db_session, USER_A, None)
        assert service.list_notifications(db_session, USER_A) == []


# -- Periodic sweep -----------------------------------------------------------


class TestPeriodicSweep:
    def test_brand_new_user_gets_mock_interview_reminder(self, db_session):
        service.check_periodic(db_session, USER_A)
        types = {n["type"] for n in service.list_notifications(db_session, USER_A)}
        assert "mock_interview_reminder" in types

    def test_running_twice_does_not_duplicate(self, db_session):
        service.check_periodic(db_session, USER_A)
        service.check_periodic(db_session, USER_A)
        count = sum(1 for n in service.list_notifications(db_session, USER_A) if n["type"] == "mock_interview_reminder")
        assert count == 1

    def test_wired_into_dashboard_home(self, client):
        response = client.get("/api/dashboard/home")
        assert response.status_code == 200
        body = client.get("/api/notifications").json()
        assert body["unread_count"] >= 1


# -- REST surface --------------------------------------------------------------


class TestRouter:
    def test_list_and_unread_count(self, client, db_session):
        make(db_session, dedupe_key="a")
        make(db_session, dedupe_key="b")
        body = client.get("/api/notifications").json()
        assert len(body["notifications"]) == 2
        assert body["unread_count"] == 2

    def test_mark_read_endpoint(self, client, db_session):
        row = make(db_session, dedupe_key="a")
        response = client.post(f"/api/notifications/{row.id}/read")
        assert response.status_code == 200
        assert response.json()["read_at"] is not None
        assert client.get("/api/notifications/unread-count").json()["unread_count"] == 0

    def test_mark_all_read_endpoint(self, client, db_session):
        make(db_session, dedupe_key="a")
        make(db_session, dedupe_key="b")
        response = client.post("/api/notifications/read-all")
        assert response.json()["updated"] == 2

    def test_archive_endpoint(self, client, db_session):
        row = make(db_session, dedupe_key="a")
        response = client.post(f"/api/notifications/{row.id}/archive")
        assert response.status_code == 200
        assert client.get("/api/notifications").json()["notifications"] == []

    def test_404_for_unknown_notification(self, client):
        assert client.post("/api/notifications/999999/read").status_code == 404
        assert client.post("/api/notifications/999999/archive").status_code == 404

    def test_cannot_act_on_another_users_notification(self, client, db_session):
        row = make(db_session, user_id=USER_B, dedupe_key="a")
        assert client.post(f"/api/notifications/{row.id}/read").status_code == 404
