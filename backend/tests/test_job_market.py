"""Job feed tests — pure database reads, no network, no external calls.

Every row here is what job_market/crawler.py would have written: a
standing, crawler-sourced listing with a real status. There is no more
on-demand fetch, per-query cache, or aggregator to mock — see
job_market/services.py's own module docstring for why.
"""

from datetime import datetime, timedelta, timezone

import pytest

from app.models.company import Company  # noqa: F401 — registers job_listings.company_id's FK target


@pytest.fixture
def db_session():
    """In-memory database. StaticPool so every connection sees the same
    file-less database — the default pool would hand out a fresh empty one."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool

    from app.core.database import Base

    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(autocommit=False, autoflush=False, bind=engine)()
    yield session
    session.close()
    Base.metadata.drop_all(bind=engine)


def add_job(
    db,
    title,
    company="Acme",
    query_key="greenhouse:acme",
    location="Remote",
    status="open",
    posted_hours=1,
    fetched_hours_old=1,
    skills="[]",
    description=None,
    external_id=None,
):
    from app.models.job import JobListing

    row = JobListing(
        query_key=query_key,
        external_id=external_id or f"{query_key}-{title}",
        title=title,
        company=company,
        location=location,
        work_mode="Remote",
        apply_url="https://example.com/job",
        status=status,
        skills=skills,
        description=description,
        fetched_at=datetime.now(timezone.utc) - timedelta(hours=fetched_hours_old),
        posted_at=(
            None if posted_hours is None
            else datetime.now(timezone.utc) - timedelta(hours=posted_hours)
        ),
    )
    db.add(row)
    db.commit()
    return row


class TestSearchJobs:
    """search_jobs() on SQLite falls back to a substring match — the branch
    every test here actually exercises, since local dev and CI are SQLite.
    The Postgres to_tsvector branch is exercised by the migration that adds
    ix_job_listings_fts and by production itself, not by this suite."""

    def test_matches_the_title(self, db_session):
        from app.modules.job_market.services import search_jobs

        add_job(db_session, "Senior Backend Engineer")
        add_job(db_session, "Product Designer")
        rows = search_jobs(db_session, "backend engineer")
        assert [r.title for r in rows] == ["Senior Backend Engineer"]

    def test_matches_the_company(self, db_session):
        from app.modules.job_market.services import search_jobs

        add_job(db_session, "Engineer", company="Stripe")
        add_job(db_session, "Engineer", company="Acme", query_key="greenhouse:other")
        rows = search_jobs(db_session, "stripe")
        assert [r.company for r in rows] == ["Stripe"]

    def test_matches_skills(self, db_session):
        from app.modules.job_market.services import search_jobs

        add_job(db_session, "Engineer", skills='["Rust", "Distributed Systems"]')
        add_job(db_session, "Designer", skills='["Figma"]', query_key="greenhouse:other")
        rows = search_jobs(db_session, "rust")
        assert [r.title for r in rows] == ["Engineer"]

    def test_an_empty_query_returns_nothing(self, db_session):
        from app.modules.job_market.services import search_jobs

        add_job(db_session, "Engineer")
        assert search_jobs(db_session, "") == []
        assert search_jobs(db_session, "   ") == []

    def test_a_closed_row_is_excluded(self, db_session):
        from app.modules.job_market.services import search_jobs

        add_job(db_session, "Backend Engineer", status="closed")
        assert search_jobs(db_session, "backend") == []

    def test_a_non_us_row_is_excluded(self, db_session):
        from app.modules.job_market.services import search_jobs

        add_job(db_session, "Backend Engineer", location="São Paulo, Brazil")
        assert search_jobs(db_session, "backend") == []

    def test_an_expired_posting_is_excluded(self, db_session):
        from app.core.config import settings
        from app.modules.job_market.services import search_jobs

        over = (settings.JOB_MAX_AGE_DAYS + 3) * 24
        add_job(db_session, "Backend Engineer", posted_hours=over)
        assert search_jobs(db_session, "backend") == []

    def test_no_match_returns_empty_not_the_whole_table(self, db_session):
        from app.modules.job_market.services import search_jobs

        add_job(db_session, "Backend Engineer")
        assert search_jobs(db_session, "underwater basket weaving") == []


class TestWarmFeed:
    def test_stale_rows_are_served_rather_than_nothing(self, db_session):
        from app.modules.job_market.services import _warm_feed

        add_job(db_session, "Software Engineer", fetched_hours_old=500)
        rows, last_updated = _warm_feed(db_session, None)
        assert len(rows) == 1
        assert last_updated is not None

    def test_ordered_by_when_the_job_was_posted(self, db_session):
        """Ordering is on posted_at, not fetched_at — every row from one
        crawl shares a fetched_at, so sorting on it leaves the grid in
        arbitrary order while looking sorted."""
        from app.modules.job_market.services import _warm_feed

        add_job(db_session, "Posted 3d ago", posted_hours=72, query_key="greenhouse:a")
        add_job(db_session, "Posted 1h ago", posted_hours=1, query_key="greenhouse:b")
        rows, _ = _warm_feed(db_session, None)
        assert [r.title for r in rows] == ["Posted 1h ago", "Posted 3d ago"]

    def test_target_roles_lead_the_feed_by_title_match(self, db_session):
        """Role matching is against the row's own title now — query_key is a
        board identifier ("greenhouse:acme"), not a role, since every row is
        crawler-sourced."""
        from app.modules.job_market.services import _warm_feed

        add_job(db_session, "Generic Analyst", query_key="greenhouse:a")
        add_job(db_session, "DevOps Engineer, Wanted", query_key="greenhouse:b")
        rows, _ = _warm_feed(db_session, ["DevOps Engineer"])
        assert rows[0].title == "DevOps Engineer, Wanted"

    def test_roles_are_normalised_before_matching(self, db_session):
        """'Senior DevOps Engineer' must still match a title containing
        'devops engineer' once seniority words are stripped."""
        from app.modules.job_market.services import _warm_feed

        add_job(db_session, "DevOps Engineer Wanted")
        rows, _ = _warm_feed(db_session, ["Senior DevOps Engineer "])
        assert rows and rows[0].title == "DevOps Engineer Wanted"

    def test_a_narrow_profile_is_backfilled(self, db_session):
        """Below MIN_PERSONALIZED_MATCHES, the full ranked set (role-first)
        is shown rather than an almost-empty grid."""
        from app.modules.job_market.services import _warm_feed

        add_job(db_session, "DevOps Engineer Wanted", query_key="greenhouse:a")
        add_job(db_session, "Backend Engineer", query_key="greenhouse:b")
        rows, _ = _warm_feed(db_session, ["DevOps Engineer"])
        assert {r.title for r in rows} == {"DevOps Engineer Wanted", "Backend Engineer"}

    def test_enough_matches_drops_the_backfill_entirely(self, db_session):
        from app.modules.job_market import services

        for i in range(services.MIN_PERSONALIZED_MATCHES):
            add_job(db_session, f"DevOps Engineer {i}", query_key=f"greenhouse:{i}")
        add_job(db_session, "Unrelated Backfill Role", query_key="greenhouse:backfill")

        rows, _ = services._warm_feed(db_session, ["DevOps Engineer"])
        assert all("DevOps Engineer" in r.title for r in rows)

    def test_postings_older_than_the_cap_are_suppressed(self, db_session):
        from app.core.config import settings
        from app.modules.job_market.services import _warm_feed

        over = (settings.JOB_MAX_AGE_DAYS + 3) * 24
        add_job(db_session, "Too Old", posted_hours=over, query_key="greenhouse:a")
        add_job(db_session, "Recent", posted_hours=12, query_key="greenhouse:b")
        rows, _ = _warm_feed(db_session, None)
        assert [r.title for r in rows] == ["Recent"]

    def test_undated_postings_are_kept(self, db_session):
        """A missing date is unknown age, not old age — dropping these would
        silently hide every posting whose source omitted one."""
        from app.modules.job_market.services import _warm_feed

        add_job(db_session, "No Date", posted_hours=None)
        rows, _ = _warm_feed(db_session, None)
        assert [r.title for r in rows] == ["No Date"]

    def test_empty_table_returns_empty(self, db_session):
        from app.modules.job_market.services import _warm_feed

        rows, last_updated = _warm_feed(db_session, ["AI Engineer"])
        assert rows == [] and last_updated is None

    def test_no_target_roles_still_returns_the_feed(self, db_session):
        from app.modules.job_market.services import _warm_feed

        add_job(db_session, "Software Engineer")
        rows, _ = _warm_feed(db_session, [])
        assert len(rows) == 1

    def test_a_closed_row_is_excluded(self, db_session):
        from app.modules.job_market.services import _warm_feed

        add_job(db_session, "Closed Role", status="closed", query_key="greenhouse:a")
        add_job(db_session, "Open Role", status="open", query_key="greenhouse:b")
        rows, _ = _warm_feed(db_session, None)
        assert [r.title for r in rows] == ["Open Role"]

    def test_a_non_us_row_is_excluded(self, db_session):
        from app.modules.job_market.services import _warm_feed

        add_job(db_session, "BR Role", location="São Paulo, Brazil", query_key="greenhouse:a")
        add_job(db_session, "US Role", location="Austin, TX", query_key="greenhouse:b")
        rows, _ = _warm_feed(db_session, None)
        assert [r.title for r in rows] == ["US Role"]


class TestGetJobs:
    def test_no_query_serves_the_warm_feed(self, db_session):
        from app.modules.job_market.services import get_jobs

        add_job(db_session, "Software Engineer")
        rows, _updated, refreshing = get_jobs(db_session, None, [])
        assert len(rows) == 1
        assert refreshing is False

    def test_a_query_searches_directly_no_cache_no_refresh_flag(self, db_session):
        from app.modules.job_market.services import get_jobs

        add_job(db_session, "Backend Engineer")
        rows, _updated, refreshing = get_jobs(db_session, "backend", None)
        assert [r.title for r in rows] == ["Backend Engineer"]
        assert refreshing is False

    def test_a_query_matching_nothing_returns_an_empty_feed_not_a_fallback(self, db_session):
        """Unlike the old on-demand design, a miss is not a reason to fall
        back to the warm feed — there is nothing left to refresh, so an
        honest empty result is correct."""
        from app.modules.job_market.services import get_jobs

        add_job(db_session, "Software Engineer")
        rows, _updated, refreshing = get_jobs(db_session, "nonexistent role xyz", None)
        assert rows == []
        assert refreshing is False


class TestDomainClassification:
    """domain_for() reads a posting's own title now, not query_key — every
    row is crawler-sourced, and query_key is a board identifier
    ("greenhouse:stripe"), not the role it was searched for."""

    def test_classifies_from_the_title(self):
        from app.modules.job_market.services import domain_for

        assert domain_for("Senior Software Engineer") == "Software & AI"
        assert domain_for("Registered Nurse - ICU") == "Healthcare & Medical"

    def test_an_unrecognised_title_classifies_as_none(self):
        from app.modules.job_market.services import domain_for

        assert domain_for("Chief Vibes Officer") is None
