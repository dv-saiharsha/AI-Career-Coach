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
from app.modules.dashboard import news, services

NOW = datetime(2026, 8, 26, 12, 0, tzinfo=timezone.utc)
USER = "00000000-0000-0000-0000-00000000000a"


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


@pytest.fixture(autouse=True)
def _clear_news_cache():
    news.clear_cache()
    yield
    news.clear_cache()


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


FR_DOC = {
    "document_number": "2026-17324",
    "title": "Fee for Certain H-1B Petitions",
    "abstract": "DHS proposes a fee for certain H-1B nonimmigrant petitions.",
    "publication_date": "2026-08-25",
    "html_url": "https://www.federalregister.gov/documents/2026/08/25/2026-17324/fee",
    "agencies": [{"name": "Homeland Security Department"}],
    "type": "Proposed Rule",
}


class TestNewsProvenance:
    def test_article_carries_the_real_publication_date(self, monkeypatch):
        """Never `now`. A canned item restamped hourly would read as freshly
        verified regardless of how old or wrong it is."""
        monkeypatch.setattr(news, "_fetch_term", lambda c, t, s: [FR_DOC])
        article = news.fetch_immigration_news()["articles"][0]
        assert article["published_at"] == "2026-08-25"

    def test_article_links_to_the_source(self, monkeypatch):
        """A policy claim a reader cannot check is worse than no claim."""
        monkeypatch.setattr(news, "_fetch_term", lambda c, t, s: [FR_DOC])
        assert news.fetch_immigration_news()["articles"][0]["url"].startswith(
            "https://www.federalregister.gov/"
        )

    def test_summary_is_the_agency_abstract_verbatim(self, monkeypatch):
        """Paraphrasing regulatory text introduces exactly the drift this
        module exists to avoid."""
        monkeypatch.setattr(news, "_fetch_term", lambda c, t, s: [FR_DOC])
        assert news.fetch_immigration_news()["articles"][0]["summary"] == FR_DOC["abstract"]

    def test_type_comes_from_the_document_not_a_judgement(self, monkeypatch):
        """'High Impact' would be advice this module cannot give."""
        monkeypatch.setattr(news, "_fetch_term", lambda c, t, s: [FR_DOC])
        assert news.fetch_immigration_news()["articles"][0]["type"] == "Proposed Rule"

    def test_unreachable_feed_reports_itself(self, monkeypatch):
        """No canned fallback: the UI says the feed is down rather than
        showing invented policy."""
        def boom(*a, **k):
            raise ConnectionError("down")

        monkeypatch.setattr(news, "_fetch_term", boom)
        result = news.fetch_immigration_news()
        assert result["reachable"] is False
        assert result["articles"] == []

    def test_irrelevant_documents_are_filtered(self, monkeypatch):
        """A term search matches anywhere, so an IRS rule citing
        'nonimmigrant' in passing would otherwise fill the panel."""
        unrelated = {**FR_DOC, "document_number": "x", "title": "Widget Safety Standards",
                     "abstract": "Rules for widget manufacturing."}
        monkeypatch.setattr(news, "_fetch_term", lambda c, t, s: [unrelated])
        assert news.fetch_immigration_news()["articles"] == []

    def test_same_document_across_terms_appears_once(self, monkeypatch):
        monkeypatch.setattr(news, "_fetch_term", lambda c, t, s: [FR_DOC])
        assert len(news.fetch_immigration_news()["articles"]) == 1

    def test_second_call_is_served_from_cache(self, monkeypatch):
        calls = {"n": 0}

        def counted(c, t, s):
            calls["n"] += 1
            return [FR_DOC]

        monkeypatch.setattr(news, "_fetch_term", counted)
        news.fetch_immigration_news()
        first = calls["n"]
        assert news.fetch_immigration_news()["cached"] is True
        assert calls["n"] == first, "a burst of dashboard loads must not fan out upstream"


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
    def test_score_is_absent_without_a_scan(self, db, monkeypatch):
        """No resume means no score — not a zero, which reads as a bad score
        rather than a missing one."""
        monkeypatch.setattr(news, "_fetch_term", lambda c, t, s: [])
        result = services.overview(db, USER)
        assert result["latest_ats_score"] is None
        assert result["scored_against"] is None

    def test_cards_carry_evidence_not_just_a_badge(self, db, monkeypatch):
        monkeypatch.setattr(news, "_fetch_term", lambda c, t, s: [])
        row = add_job(db, "Engineer", hours_since_posted=2)
        row.h1b_sponsorship = "no_sponsorship"
        row.h1b_evidence = "No visa sponsorship available."
        db.commit()
        card = services.overview(db, USER)["fresh_jobs"][0]
        assert card["h1b_evidence"] == "No visa sponsorship available."

    def test_window_label_is_reported(self, db, monkeypatch):
        monkeypatch.setattr(news, "_fetch_term", lambda c, t, s: [])
        assert "last" in services.overview(db, USER)["fresh_window"]
