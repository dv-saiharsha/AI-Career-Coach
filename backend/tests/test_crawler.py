"""The companies-table-driven crawl orchestrator: reconciliation, the
close-after-2-misses lifecycle, per-company health, and the low-level
fetch/retry/throttle machinery. No real network calls anywhere."""

import urllib.error
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.models.company import Company
from app.models.crawl_run import CrawlRun
from app.models.job import JobListing
from app.modules.job_market import crawler


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def make_company(db, **overrides) -> Company:
    defaults = dict(name="Acme", ats_type="greenhouse", ats_slug="acme", active=True)
    company = Company(**{**defaults, **overrides})
    db.add(company)
    db.flush()
    return company


def board_row(external_id: str, title: str = "Engineer", location: str = "Remote", company: str = "Acme") -> dict:
    return {
        "query_key": "greenhouse:acme", "external_id": external_id, "title": title,
        "company": company, "location": location, "work_mode": "Remote", "salary_range": None,
        "description": None, "skills": "[]", "apply_url": f"https://acme.com/{external_id}",
        "posted_at": None, "source": "greenhouse",
    }


class _FakeResponse:
    def __init__(self, status: int, body: str, headers: dict | None = None):
        self.status = status
        self._body = body.encode("utf-8")
        self.headers = headers or {}

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class TestRawFetch:
    def test_a_200_returns_body_and_headers(self, monkeypatch):
        monkeypatch.setattr(
            crawler.urllib.request, "urlopen",
            lambda request, timeout: _FakeResponse(200, "hello", {"ETag": '"v1"', "Last-Modified": "Mon"}),
        )
        status, body, etag, last_modified = crawler._raw_fetch("https://x.com", None, None, 5)
        assert (status, body, etag, last_modified) == (200, "hello", '"v1"', "Mon")

    def test_a_304_returns_no_body(self, monkeypatch):
        def boom(request, timeout):
            raise urllib.error.HTTPError("https://x.com", 304, "Not Modified", {"ETag": '"v1"'}, None)

        monkeypatch.setattr(crawler.urllib.request, "urlopen", boom)
        status, body, etag, _ = crawler._raw_fetch("https://x.com", '"v1"', None, 5)
        assert status == 304
        assert body == ""
        assert etag == '"v1"'

    def test_a_404_is_returned_not_raised(self, monkeypatch):
        def boom(request, timeout):
            raise urllib.error.HTTPError("https://x.com", 404, "Not Found", {}, None)

        monkeypatch.setattr(crawler.urllib.request, "urlopen", boom)
        status, body, _, _ = crawler._raw_fetch("https://x.com", None, None, 5)
        assert status == 404

    def test_a_500_raises_retryable(self, monkeypatch):
        def boom(request, timeout):
            raise urllib.error.HTTPError("https://x.com", 500, "Server Error", {}, None)

        monkeypatch.setattr(crawler.urllib.request, "urlopen", boom)
        with pytest.raises(crawler._Retryable):
            crawler._raw_fetch("https://x.com", None, None, 5)

    def test_a_timeout_raises_retryable(self, monkeypatch):
        def boom(request, timeout):
            raise TimeoutError("timed out")

        monkeypatch.setattr(crawler.urllib.request, "urlopen", boom)
        with pytest.raises(crawler._Retryable):
            crawler._raw_fetch("https://x.com", None, None, 5)


class TestFetchWithRetry:
    def test_succeeds_on_a_later_attempt(self, monkeypatch):
        monkeypatch.setattr(crawler.time, "sleep", lambda seconds: None)
        calls = {"n": 0}

        def flaky(url, etag, last_modified, timeout):
            calls["n"] += 1
            if calls["n"] < 2:
                raise crawler._Retryable("flaky")
            return 200, "ok", None, None

        monkeypatch.setattr(crawler, "_raw_fetch", flaky)
        status, body, _, _ = crawler._fetch_with_retry("https://x.com", None, None)
        assert (status, body) == (200, "ok")
        assert calls["n"] == 2

    def test_raises_after_exhausting_attempts(self, monkeypatch):
        monkeypatch.setattr(crawler.time, "sleep", lambda seconds: None)
        monkeypatch.setattr(
            crawler, "_raw_fetch", lambda *a: (_ for _ in ()).throw(crawler._Retryable("still down"))
        )
        with pytest.raises(crawler._Retryable):
            crawler._fetch_with_retry("https://x.com", None, None)


class TestThrottle:
    def test_a_second_call_on_the_same_domain_waits(self, monkeypatch):
        crawler._last_request_at.clear()
        slept = []
        monkeypatch.setattr(crawler.time, "sleep", lambda seconds: slept.append(seconds))
        crawler._throttle("x.com", min_interval_ms=1000)
        crawler._throttle("x.com", min_interval_ms=1000)
        assert slept and slept[0] > 0

    def test_a_different_domain_is_not_throttled_by_the_first(self, monkeypatch):
        crawler._last_request_at.clear()
        slept = []
        monkeypatch.setattr(crawler.time, "sleep", lambda seconds: slept.append(seconds))
        crawler._throttle("x.com", min_interval_ms=1000)
        crawler._throttle("y.com", min_interval_ms=1000)
        assert slept == []


class TestMakeFetch:
    def test_captures_etag_and_last_modified_on_success(self, monkeypatch):
        monkeypatch.setattr(crawler, "_fetch_with_retry", lambda *a: (200, "body", '"v2"', "Tue"))
        monkeypatch.setattr(crawler, "_throttle", lambda *a: None)
        company = Company(name="Acme")
        fetch, captured = crawler._make_fetch(company, min_interval_ms=0)
        assert fetch("https://x.com") == (200, "body")
        assert captured["etag"] == '"v2"'
        assert captured["not_modified"] is False

    def test_captures_not_modified(self, monkeypatch):
        monkeypatch.setattr(crawler, "_fetch_with_retry", lambda *a: (304, "", '"v2"', None))
        monkeypatch.setattr(crawler, "_throttle", lambda *a: None)
        company = Company(name="Acme")
        fetch, captured = crawler._make_fetch(company, min_interval_ms=0)
        fetch("https://x.com")
        assert captured["not_modified"] is True

    def test_a_retry_exhausted_failure_never_raises_and_is_captured(self, monkeypatch):
        def boom(*a):
            raise crawler._Retryable("still down")

        monkeypatch.setattr(crawler, "_fetch_with_retry", boom)
        monkeypatch.setattr(crawler, "_throttle", lambda *a: None)
        company = Company(name="Acme")
        fetch, captured = crawler._make_fetch(company, min_interval_ms=0)
        status, body = fetch("https://x.com")
        assert status == 599
        assert captured["error"] == "still down"


class TestReconciliation:
    def test_a_new_row_is_inserted_as_open(self, db):
        company = make_company(db)
        new, updated, closed = crawler._reconcile_company_rows(
            db, company, [board_row("greenhouse:acme:1")], not_modified=False
        )
        db.commit()
        assert (new, updated, closed) == (1, 0, 0)
        row = db.query(JobListing).one()
        assert row.status == "open"
        assert row.first_seen_at is not None
        assert row.missed_streak == 0

    def test_two_same_title_same_location_postings_stay_separate(self, db):
        """Regression: content_hash = md5(company|title|location) used to
        collapse these into one row. Identity is now (source, company,
        external_id), so two real distinct reqs must both persist."""
        company = make_company(db)
        rows = [
            board_row("greenhouse:acme:1", title="Engineer", location="Remote"),
            board_row("greenhouse:acme:2", title="Engineer", location="Remote"),
        ]
        new, _, _ = crawler._reconcile_company_rows(db, company, rows, not_modified=False)
        db.commit()
        assert new == 2
        assert db.query(JobListing).count() == 2

    def test_a_title_edit_updates_the_existing_row_not_a_new_one(self, db):
        """Regression: same external_id, a renamed title, must read as an
        edit to the existing row — not a second row replacing the first."""
        company = make_company(db)
        crawler._reconcile_company_rows(
            db, company, [board_row("greenhouse:acme:1", title="Engineer")], not_modified=False
        )
        db.commit()
        original_id = db.query(JobListing).one().id

        crawler._reconcile_company_rows(
            db, company, [board_row("greenhouse:acme:1", title="Senior Engineer")], not_modified=False
        )
        db.commit()

        assert db.query(JobListing).count() == 1
        row = db.query(JobListing).one()
        assert row.id == original_id
        assert row.title == "Senior Engineer"

    def test_a_row_missing_once_is_not_yet_closed(self, db):
        company = make_company(db)
        crawler._reconcile_company_rows(db, company, [board_row("greenhouse:acme:1")], not_modified=False)
        db.commit()

        crawler._reconcile_company_rows(db, company, [], not_modified=False)
        db.commit()

        row = db.query(JobListing).one()
        assert row.status == "open"
        assert row.missed_streak == 1

    def test_a_row_missing_twice_closes(self, db):
        company = make_company(db)
        crawler._reconcile_company_rows(db, company, [board_row("greenhouse:acme:1")], not_modified=False)
        db.commit()

        crawler._reconcile_company_rows(db, company, [], not_modified=False)
        db.commit()
        new, updated, closed = crawler._reconcile_company_rows(db, company, [], not_modified=False)
        db.commit()

        assert closed == 1
        row = db.query(JobListing).one()
        assert row.status == "closed"
        assert row.closed_at is not None

    def test_a_closed_row_reappearing_is_reopened(self, db):
        company = make_company(db)
        crawler._reconcile_company_rows(db, company, [board_row("greenhouse:acme:1")], not_modified=False)
        db.commit()
        for _ in range(2):
            crawler._reconcile_company_rows(db, company, [], not_modified=False)
            db.commit()
        assert db.query(JobListing).one().status == "closed"

        crawler._reconcile_company_rows(db, company, [board_row("greenhouse:acme:1")], not_modified=False)
        db.commit()
        row = db.query(JobListing).one()
        assert row.status == "open"
        assert row.closed_at is None
        assert row.missed_streak == 0

    def test_not_modified_reconfirms_without_touching_counts(self, db):
        company = make_company(db)
        crawler._reconcile_company_rows(db, company, [board_row("greenhouse:acme:1")], not_modified=False)
        db.commit()
        crawler._reconcile_company_rows(db, company, [], not_modified=False)  # one miss
        db.commit()

        new, updated, closed = crawler._reconcile_company_rows(db, company, [], not_modified=True)
        db.commit()

        assert (new, updated, closed) == (0, 0, 0)
        row = db.query(JobListing).one()
        assert row.missed_streak == 0, "a 304 re-confirms every open row rather than letting misses accrue"

    def test_a_row_with_no_external_id_is_skipped_not_crashed_on(self, db):
        company = make_company(db)
        row = board_row("ignored")
        row["external_id"] = None
        new, updated, closed = crawler._reconcile_company_rows(db, company, [row], not_modified=False)
        assert (new, updated, closed) == (0, 0, 0)
        assert db.query(JobListing).count() == 0


class TestNonUsFilter:
    """Regression: these boards list every office's openings with no country
    filter of their own, and services.py's read-time _us_only filter only
    stops a non-US row from being *shown* — it does not stop this crawler
    from storing (and re-crawling) it forever, which is pure waste."""

    def test_a_non_us_row_is_dropped_before_it_reaches_reconciliation(self, monkeypatch):
        monkeypatch.setattr(
            crawler.ats_boards, "fetch_board",
            lambda *a, **k: [
                board_row("greenhouse:acme:1", location="Tokyo, Japan"),
                board_row("greenhouse:acme:2", location="Austin, TX"),
            ],
        )
        company = Company(name="Acme", ats_type="greenhouse", ats_slug="acme")
        result = crawler._crawl_one(company, min_interval_ms=0)
        assert [row["location"] for row in result.rows] == ["Austin, TX"]


class TestRunCrawl:
    def test_manual_review_companies_are_never_crawled(self, db, monkeypatch):
        make_company(db, name="Unresolved", ats_type="manual_review", ats_slug=None)
        monkeypatch.setattr(
            crawler.ats_boards, "fetch_board", lambda *a, **k: pytest.fail("must not be called")
        )
        run = crawler.run_crawl(db)
        assert run.companies_attempted == 0

    def test_a_successful_crawl_updates_company_health_and_counts(self, db, monkeypatch):
        company = make_company(db, consecutive_failures=3, crawl_status="failing")
        monkeypatch.setattr(
            crawler.ats_boards, "fetch_board",
            lambda *a, **k: [board_row("greenhouse:acme:1")],
        )
        run = crawler.run_crawl(db)

        db.refresh(company)
        assert company.crawl_status == "ok"
        assert company.consecutive_failures == 0
        assert company.last_crawled_at is not None
        assert run.companies_succeeded == 1
        assert run.companies_failed == 0
        assert run.jobs_new == 1
        assert run.ended_at is not None

    def test_a_failing_company_does_not_stop_the_run_or_touch_its_jobs(self, db, monkeypatch):
        make_company(db, name="Dead", ats_slug="dead")
        good = make_company(db, name="Good", ats_slug="good")

        def flaky(provider, board, **kwargs):
            if board == "dead":
                raise crawler._Retryable("timed out")
            return [board_row("greenhouse:good:1", company="Good")]

        monkeypatch.setattr(crawler.ats_boards, "fetch_board", flaky)
        run = crawler.run_crawl(db)

        assert run.companies_attempted == 2
        assert run.companies_failed == 1
        assert run.companies_succeeded == 1
        assert run.jobs_new == 1

        db.refresh(good)
        assert good.crawl_status == "ok"

    def test_crawl_run_is_persisted(self, db, monkeypatch):
        make_company(db)
        monkeypatch.setattr(crawler.ats_boards, "fetch_board", lambda *a, **k: [])
        run = crawler.run_crawl(db, trigger="manual", triggered_by="user-1")
        stored = db.query(CrawlRun).filter(CrawlRun.id == run.id).one()
        assert stored.trigger == "manual"
        assert stored.triggered_by == "user-1"
        assert stored.started_at is not None

    def test_retention_deletes_old_closed_rows_but_keeps_recent_ones(self, db, monkeypatch):
        company = make_company(db)
        old_row = JobListing(
            query_key="greenhouse:acme", source="greenhouse", company="Acme", external_id="old",
            company_id=company.id, title="Old", location="Remote", work_mode="Remote",
            apply_url="https://x.com/old", skills="[]", status="closed",
            closed_at=datetime.now(timezone.utc) - timedelta(days=200),
        )
        recent_row = JobListing(
            query_key="greenhouse:acme", source="greenhouse", company="Acme", external_id="recent",
            company_id=company.id, title="Recent", location="Remote", work_mode="Remote",
            apply_url="https://x.com/recent", skills="[]", status="closed",
            closed_at=datetime.now(timezone.utc) - timedelta(days=1),
        )
        db.add_all([old_row, recent_row])
        db.commit()

        monkeypatch.setattr(crawler.ats_boards, "fetch_board", lambda *a, **k: [])
        crawler.run_crawl(db)

        remaining = {row.external_id for row in db.query(JobListing).all()}
        assert remaining == {"recent"}
