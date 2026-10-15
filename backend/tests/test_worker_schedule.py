"""The hourly crawl: the worker's lock and cadence, the run log, the status
endpoint, and how new listings reach the Jobs page and the dashboard. Crawlers
and the clock are mocked; nothing touches the network or Ollama."""

import json
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import worker
from app.core.database import Base
from app.models.company import Company
from app.models.crawl_run import CrawlRun
from app.models.job import JobListing
from app.modules.dashboard import services as dashboard
from app.modules.job_market import crawl_status, crawler, services as jobs
from tests.test_crawler import board_row

NOW = datetime(2026, 10, 14, 12, 0, tzinfo=timezone.utc)


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


@pytest.fixture(autouse=True)
def _no_enrichment(monkeypatch):
    monkeypatch.setattr(crawler.ingestion, "_enrich", lambda pending, report: {})


# --- the run log ----------------------------------------------------------


class TestRunLog:
    def _companies(self, db):
        acme = Company(name="Acme", ats_type="greenhouse", ats_slug="acme", active=True)
        beta = Company(name="Beta", ats_type="lever", ats_slug="beta", active=True)
        db.add_all([acme, beta])
        db.flush()
        return acme, beta

    def test_a_run_records_counts_per_crawler(self, db, monkeypatch):
        acme, beta = self._companies(db)
        rows = [board_row("1"), board_row("2"), board_row("3")]

        def fake_crawl(company, min_interval_ms):
            if company.ats_type == "lever":
                return crawler.CompanyResult(error="HTTP 503")
            return crawler.CompanyResult(rows=list(rows))

        monkeypatch.setattr(crawler, "_crawl_one", fake_crawl)
        first = crawler.run_crawl(db)
        stats = json.loads(first.stats)
        assert stats["by_crawler"]["greenhouse"] == {
            "companies": 1, "failed": 0, "fetched": 3, "new": 3, "updated": 0, "duplicates": 0, "errors": [],
        }
        assert stats["by_crawler"]["lever"]["failed"] == 1 and stats["by_crawler"]["lever"]["errors"] == ["Beta: HTTP 503"]
        assert stats["fetched"] == 3 and stats["enrichment"]["enriched"] == 0
        assert first.started_at is not None and first.ended_at is not None

        # The same postings again: fetched, already stored, nothing new.
        second = json.loads(crawler.run_crawl(db).stats)
        assert second["by_crawler"]["greenhouse"]["new"] == 0
        assert second["by_crawler"]["greenhouse"]["duplicates"] == 3 and second["duplicates"] == 3

    def test_the_run_is_logged_per_crawler(self, db, monkeypatch, caplog):
        self._companies(db)
        monkeypatch.setattr(crawler, "_crawl_one", lambda c, m: crawler.CompanyResult(rows=[board_row("9", company=c.name)]))
        with caplog.at_level("INFO"):
            crawler.run_crawl(db)
        assert "[greenhouse]: 1 companies (0 failed), 1 fetched, 1 new" in caplog.text
        assert "[lever]" in caplog.text


# --- the worker: lock and cadence ----------------------------------------


class TestWorker:
    @pytest.fixture(autouse=True)
    def _file_lock(self, monkeypatch, tmp_path):
        monkeypatch.setattr(worker.settings, "REDIS_URL", "")
        monkeypatch.setattr(worker.settings, "DB_URL", "sqlite://")
        monkeypatch.setattr(worker, "LOCK_FILE", str(tmp_path / "crawl.lock"))

    def test_a_run_is_skipped_while_another_holds_the_lock(self, monkeypatch, caplog):
        ran = []
        monkeypatch.setattr(worker, "_run_once", lambda *a, **k: ran.append(a))
        with worker._local_lock() as held:
            assert held
            with caplog.at_level("INFO"):
                assert worker.run_locked() is False
        assert ran == [] and "crawl skipped (scheduled): a crawl is still running" in caplog.text
        assert worker.run_locked() is True and len(ran) == 1

    def test_runs_start_every_interval_from_the_previous_start(self, monkeypatch):
        clock = {"t": 0.0}
        sleeps = []
        monkeypatch.setattr(worker, "INTERVAL_SECONDS", 3600)

        def run():
            clock["t"] += 600  # a run takes ten minutes
            return True

        monkeypatch.setattr(worker, "run_locked", run)
        worker.main(max_runs=3, sleep=lambda s: (sleeps.append(s), clock.__setitem__("t", clock["t"] + s)),
                    clock=lambda: clock["t"])
        assert sleeps == [worker.STARTUP_DELAY_SECONDS, 3000, 3000]

    def test_a_failed_tick_does_not_end_the_loop(self, monkeypatch):
        calls = []

        def boom():
            calls.append(1)
            raise RuntimeError("database down")

        monkeypatch.setattr(worker, "run_locked", boom)
        worker.main(max_runs=2, sleep=lambda s: None, clock=lambda: 0.0)
        assert len(calls) == 2


# --- the status endpoint -------------------------------------------------


def _run(db, started, ended=True, trigger="scheduled", **stats):
    run = CrawlRun(trigger=trigger, started_at=started, ended_at=started + timedelta(minutes=4) if ended else None,
                   jobs_new=stats.get("new", 0), stats=json.dumps({"fetched": stats.get("fetched", 0), "duplicates": 0,
                                                                  "enrichment": {"enriched": 2}, "by_crawler": {}}))
    db.add(run)
    db.commit()
    return run


class TestSchedulerStatus:
    @pytest.fixture(autouse=True)
    def _hourly(self, monkeypatch):
        # The expectations below are written for the default hourly cadence;
        # a developer's .env (CRAWL_INTERVAL_SECONDS) must not change them.
        monkeypatch.setattr(crawl_status.settings, "CRAWL_INTERVAL_SECONDS", 3600)

    def test_last_run_next_run_and_not_running(self, db):
        _run(db, NOW - timedelta(minutes=20), new=5, fetched=40)
        status = crawl_status.scheduler_status(db, now=NOW)
        assert status["running"] is False and status["overdue"] is False
        assert status["last_run"]["jobs_new"] == 5 and status["last_run"]["postings_fetched"] == 40
        assert status["last_run"]["enriched"] == 2 and status["last_run"]["duration_seconds"] == 240
        assert status["next_run_at"] == (NOW - timedelta(minutes=20) + timedelta(hours=1)).isoformat()

    def test_a_run_in_progress_is_running_and_the_last_finished_run_is_reported(self, db):
        _run(db, NOW - timedelta(hours=1, minutes=2), new=3)
        _run(db, NOW - timedelta(minutes=2), ended=False)
        status = crawl_status.scheduler_status(db, now=NOW)
        assert status["running"] is True and status["last_run"]["jobs_new"] == 3

    def test_an_unfinished_run_older_than_the_timeout_is_not_running(self, db):
        _run(db, NOW - timedelta(hours=2), ended=False)
        assert crawl_status.scheduler_status(db, now=NOW)["running"] is False

    def test_a_worker_that_stopped_is_overdue(self, db):
        _run(db, NOW - timedelta(hours=3))
        status = crawl_status.scheduler_status(db, now=NOW)
        assert status["overdue"] is True

    def test_never_run(self, db):
        status = crawl_status.scheduler_status(db, now=NOW)
        assert status["last_run"] is None and status["next_run_at"] is None and status["running"] is False

    def test_the_endpoint_needs_a_login_and_answers(self, db):
        from fastapi.testclient import TestClient

        from app.core.database import get_db
        from app.core.deps import get_current_user
        from app.main import app

        client = TestClient(app)
        app.dependency_overrides[get_db] = lambda: db
        try:
            assert client.get("/api/jobs/scheduler-status").status_code in (401, 403)
            app.dependency_overrides[get_current_user] = lambda: type("U", (), {"id": "u1", "email": "a@b.c"})()
            body = client.get("/api/jobs/scheduler-status").json()
            assert set(body) == {"interval_seconds", "running", "last_run", "last_run_at", "next_run_at", "overdue"}
        finally:
            app.dependency_overrides.clear()


# --- new listings on the Jobs page and the dashboard ---------------------


def _listing(db, n, posted=None, first_seen=None, status="open", location="Remote, US"):
    row = JobListing(query_key="greenhouse:acme", external_id=str(n), title=f"Engineer {n}", company="Acme",
                     location=location, work_mode="Remote", apply_url=f"https://x/{n}", status=status,
                     posted_at=posted, first_seen_at=first_seen, fetched_at=first_seen or posted or NOW)
    db.add(row)
    db.commit()
    return row


class TestListingDates:
    def test_a_dateless_listing_sorts_by_when_it_was_first_seen(self, db):
        jobs.clear_feed_cache()
        _listing(db, 1, posted=datetime.now(timezone.utc) - timedelta(days=3))
        new = _listing(db, 2, posted=None, first_seen=datetime.now(timezone.utc) - timedelta(hours=1))
        rows, _, _ = jobs.get_jobs(db)
        assert rows[0].id == new.id

    def test_the_dashboard_shows_open_us_listings_including_dateless_ones(self, db):
        recent = datetime.now(timezone.utc) - timedelta(hours=2)
        _listing(db, 1, posted=recent)
        _listing(db, 2, posted=None, first_seen=recent)
        _listing(db, 3, posted=recent, status="closed")
        _listing(db, 4, posted=recent, location="London, UK")
        rows, _ = dashboard.fresh_jobs(db)
        assert sorted(r.external_id for r in rows) == ["1", "2"]
        latest = dashboard._latest_openings(db)
        assert sorted(o["title"] for o in latest) == ["Engineer 1", "Engineer 2"]

    def test_a_dateless_listing_says_when_it_was_seen_not_posted(self):
        assert dashboard._posted_label(None, NOW, NOW - timedelta(hours=3)) == "Seen 3h ago"
        assert dashboard._posted_label(None, NOW) == "Date not listed"
        assert dashboard._posted_label(NOW - timedelta(hours=5), NOW) == "5h ago"

    def test_the_payload_counts_age_from_first_seen_and_says_so(self, db):
        row = _listing(db, 5, posted=None, first_seen=datetime.now(timezone.utc) - timedelta(days=4, hours=1))
        payload = jobs.to_payload(row)
        assert payload["postedDaysAgo"] == 4 and payload["dateSource"] == "first_seen"
        dated = _listing(db, 6, posted=datetime.now(timezone.utc) - timedelta(days=2, hours=1))
        assert jobs.to_payload(dated)["dateSource"] == "posted" and jobs.to_payload(dated)["postedDaysAgo"] == 2


class TestRunOnce:
    """python -m app.worker --once: the Cloud Run Job entry point."""

    def test_a_finished_or_skipped_run_exits_zero(self, monkeypatch):
        from app import worker

        calls = []
        monkeypatch.setattr(worker, "run_locked", lambda: calls.append(1) or True)
        assert worker.run_once() == 0
        monkeypatch.setattr(worker, "run_locked", lambda: False)  # lock held elsewhere
        assert worker.run_once() == 0
        assert calls == [1]

    def test_a_failed_run_exits_one(self, monkeypatch):
        from app import worker

        def boom():
            raise RuntimeError("board fetch exploded")

        monkeypatch.setattr(worker, "run_locked", boom)
        assert worker.run_once() == 1

    def test_no_startup_delay(self, monkeypatch):
        from app import worker

        monkeypatch.setattr(worker, "run_locked", lambda: True)
        monkeypatch.setattr(worker.time, "sleep", lambda s: (_ for _ in ()).throw(AssertionError("slept")))
        assert worker.run_once() == 0
