"""Analytics aggregation: ATS trajectory, funnel derivation, isolation.

The funnel tests matter most. `status` records where a card is NOW, so a naive
group-by understates every earlier stage — these lock in the derivation that
avoids that.
"""

import json
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.deps import AuthenticatedUser, get_current_user
from app.main import app
from app.models.application import JobApplication
from app.models.resume import ResumeAnalysis

USER_A = "00000000-0000-0000-0000-00000000000a"
USER_B = "00000000-0000-0000-0000-00000000000b"
BASE_TIME = datetime(2026, 1, 1, tzinfo=timezone.utc)


@pytest.fixture
def db_session():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(autocommit=False, autoflush=False, bind=engine)()
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


def add_scan(db, user_id, score, filename, days=0, diagnostics=None):
    payload = {"ats_score": score}
    if diagnostics is not None:
        payload["diagnostics"] = diagnostics
    record = ResumeAnalysis(
        user_id=user_id,
        resume_filename=filename,
        job_description="jd",
        ats_score=score,
        result_json=json.dumps(payload),
        created_at=BASE_TIME + timedelta(days=days),
    )
    db.add(record)
    db.commit()
    return record


def add_application(db, user_id, status, applied=False):
    record = JobApplication(
        user_id=user_id,
        job_title="Engineer",
        company="Acme",
        status=status,
        applied_at=BASE_TIME if applied else None,
    )
    db.add(record)
    db.commit()
    return record


class TestAtsHistory:
    def test_returns_scans_chronologically(self, client, db_session):
        add_scan(db_session, USER_A, 80.0, "v2.pdf", days=5)
        add_scan(db_session, USER_A, 60.0, "v1.pdf", days=0)
        history = client.get("/api/analytics/summary").json()["ats_history"]
        assert [p["score"] for p in history] == [60.0, 80.0]

    def test_labels_by_filename_not_missing_job_title(self, client, db_session):
        """resume_analyses has no job_title column — reading one would
        AttributeError. The filename is also what the user recognises."""
        add_scan(db_session, USER_A, 75.0, "ML_Engineer_v3.pdf")
        assert client.get("/api/analytics/summary").json()["ats_history"][0]["label"] == "ML_Engineer_v3.pdf"

    def test_score_delta_across_revisions(self, client, db_session):
        add_scan(db_session, USER_A, 60.0, "v1.pdf", days=0)
        add_scan(db_session, USER_A, 82.0, "v2.pdf", days=3)
        body = client.get("/api/analytics/summary").json()
        assert body["score_delta"] == 22.0
        assert body["best_score"] == 82.0
        assert body["latest_score"] == 82.0

    def test_single_scan_has_no_delta(self, client, db_session):
        """One data point isn't a trend; '+0' would imply it were."""
        add_scan(db_session, USER_A, 70.0, "v1.pdf")
        assert client.get("/api/analytics/summary").json()["score_delta"] is None

    def test_empty_history(self, client):
        body = client.get("/api/analytics/summary").json()
        assert body["ats_history"] == []
        assert body["best_score"] is None and body["score_delta"] is None


class TestQuantifiedHistory:
    def test_reads_stored_diagnostics(self, client, db_session):
        add_scan(
            db_session, USER_A, 70.0, "v1.pdf",
            diagnostics={"quantified_metrics_ratio": 40.0, "bullet_impact_rating": 66.7},
        )
        point = client.get("/api/analytics/summary").json()["quantified_history"][0]
        assert point["quantified_ratio"] == 40.0
        assert point["impact_rating"] == 66.7

    def test_skips_scans_without_diagnostics(self, client, db_session):
        """Older rows predate diagnostics. Reporting them as 0 would draw a
        fake collapse at the start of the trend."""
        add_scan(db_session, USER_A, 70.0, "old.pdf")
        add_scan(db_session, USER_A, 80.0, "new.pdf", days=1,
                 diagnostics={"quantified_metrics_ratio": 50.0, "bullet_impact_rating": 70.0})
        history = client.get("/api/analytics/summary").json()["quantified_history"]
        assert len(history) == 1 and history[0]["label"] == "new.pdf"

    def test_corrupt_result_json_is_skipped_not_fatal(self, client, db_session):
        record = add_scan(db_session, USER_A, 70.0, "bad.pdf")
        record.result_json = "{not json"
        db_session.commit()
        assert client.get("/api/analytics/summary").status_code == 200


class TestFunnel:
    def test_progressed_cards_still_count_as_applied(self, client, db_session):
        """The core correction: status is current-state, so grouping by it
        alone would report applied=0 for someone with interviews booked."""
        add_application(db_session, USER_A, "interviewing", applied=True)
        add_application(db_session, USER_A, "offer", applied=True)
        funnel = client.get("/api/analytics/summary").json()["funnel"]
        assert funnel["by_stage"]["applied"] == 0
        assert funnel["reached_applied"] == 2

    def test_offer_counts_toward_interviewing(self, client, db_session):
        add_application(db_session, USER_A, "offer", applied=True)
        funnel = client.get("/api/analytics/summary").json()["funnel"]
        assert funnel["reached_interviewing"] == 1
        assert funnel["reached_offer"] == 1

    def test_rates_denominate_on_applied_not_saved(self, client, db_session):
        """Bookmarked-but-never-applied roles must not deflate the rate."""
        for _ in range(8):
            add_application(db_session, USER_A, "saved")
        add_application(db_session, USER_A, "applied", applied=True)
        add_application(db_session, USER_A, "interviewing", applied=True)
        funnel = client.get("/api/analytics/summary").json()["funnel"]
        assert funnel["total_tracked"] == 10
        assert funnel["reached_applied"] == 2
        # 1 of 2 applied, not 1 of 10 tracked.
        assert funnel["interview_rate"] == 50.0

    def test_rates_are_none_with_nothing_applied(self, client, db_session):
        """'0%' reads as failure; no applications yet is just no data."""
        add_application(db_session, USER_A, "saved")
        funnel = client.get("/api/analytics/summary").json()["funnel"]
        assert funnel["interview_rate"] is None and funnel["offer_rate"] is None

    def test_all_stage_keys_present_when_empty(self, client):
        funnel = client.get("/api/analytics/summary").json()["funnel"]
        assert set(funnel["by_stage"]) == {"saved", "applied", "interviewing", "offer", "rejected"}

    def test_offer_rate(self, client, db_session):
        add_application(db_session, USER_A, "applied", applied=True)
        add_application(db_session, USER_A, "applied", applied=True)
        add_application(db_session, USER_A, "applied", applied=True)
        add_application(db_session, USER_A, "offer", applied=True)
        assert client.get("/api/analytics/summary").json()["funnel"]["offer_rate"] == 25.0


class TestIsolation:
    def test_excludes_other_users_scans(self, client, db_session):
        add_scan(db_session, USER_B, 99.0, "theirs.pdf")
        body = client.get("/api/analytics/summary").json()
        assert body["ats_history"] == [] and body["best_score"] is None

    def test_excludes_other_users_applications(self, client, db_session):
        add_application(db_session, USER_B, "offer", applied=True)
        assert client.get("/api/analytics/summary").json()["funnel"]["total_tracked"] == 0


def test_unauthenticated_rejected(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    try:
        assert TestClient(app).get("/api/analytics/summary").status_code == 401
    finally:
        app.dependency_overrides.clear()
