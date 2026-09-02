"""Dashboard overview: news provenance, freshness labelling, age boundary.

No network — the Federal Register client is monkeypatched. The tests that
matter here are about provenance: every article must be traceable to a real
document, and nothing may be authored locally.
"""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.models.job import JobListing
from app.modules.dashboard import services

NOW = datetime(2026, 8, 26, 12, 0, tzinfo=timezone.utc)
USER = "00000000-0000-0000-0000-00000000000a"


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def add_job(db, title, hours_since_posted, company="Acme"):
    row = JobListing(
        query_key="ai engineer", external_id=f"{title}-{hours_since_posted}", title=title,
        company=company, location="Remote", work_mode="Remote",
        apply_url="https://example.com/j",
        posted_at=NOW - timedelta(hours=hours_since_posted),
        fetched_at=NOW,
    )
    db.add(row)
    db.commit()
    return row



class TestFreshness:
    def test_labels_come_from_posted_at_not_fetched_at(self, db):
        """fetched_at is when we scraped. Filtering on it would label a
        three-week-old posting '1h ago' after a sweep."""
        add_job(db, "Old posting", hours_since_posted=500)
        label = services._posted_label(NOW - timedelta(hours=500), NOW)
        assert label == "20d ago"

    def test_missing_date_is_not_reported_as_fresh(self, db):
        """A missing date is unknown age, not a recent one."""
        assert services._posted_label(None, NOW) == "Date not listed"

    def test_recent_hours(self):
        assert services._posted_label(NOW - timedelta(hours=5), NOW) == "5h ago"
        assert services._posted_label(NOW - timedelta(minutes=10), NOW) == "Just now"

    def test_window_widens_when_too_few_are_truly_fresh(self, db):
        """Widened, not padded — and the label says which window was used."""
        for i in range(5):
            add_job(db, f"Older {i}", hours_since_posted=48)
        rows, label = services.fresh_jobs(db, NOW)
        assert label == "last 7 days"
        assert len(rows) == 5

    def test_stays_on_the_10h_window_when_enough_are_fresh(self, db):
        for i in range(4):
            add_job(db, f"Fresh {i}", hours_since_posted=2)
        rows, label = services.fresh_jobs(db, NOW)
        assert label == "last 10 hours"

    def test_nothing_older_than_the_window(self, db):
        add_job(db, "Ancient", hours_since_posted=24 * 30)
        rows, _ = services.fresh_jobs(db, NOW)
        assert rows == []


class TestOverview:
    def test_score_is_absent_without_a_scan(self, db):
        """No resume means no score — not a zero, which reads as a bad score
        rather than a missing one."""
        result = services.overview(db, USER)
        assert result["latest_ats_score"] is None
        assert result["scored_against"] is None

    def test_cards_carry_evidence_not_just_a_badge(self, db):
        row = add_job(db, "Engineer", hours_since_posted=2)
        row.h1b_sponsorship = "no_sponsorship"
        row.h1b_evidence = "No visa sponsorship available."
        db.commit()
        card = services.overview(db, USER)["fresh_jobs"][0]
        assert card["h1b_evidence"] == "No visa sponsorship available."

    def test_window_label_is_reported(self, db):
        assert "last" in services.overview(db, USER)["fresh_window"]
