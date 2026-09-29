"""Admin crawl API: auth gating and the read/trigger endpoints. The trigger
endpoints never let a real background thread touch a real database — both
threading.Thread and run_locked are replaced with synchronous fakes."""

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import settings
from app.core.database import Base, get_db
from app.core.deps import AuthenticatedUser, get_current_user
from app.main import app
from app.models.company import Company
from app.models.crawl_run import CrawlRun
from app.modules.job_market import admin_router

ADMIN_EMAIL = "admin@example.com"


@pytest.fixture
def db_session(monkeypatch):
    # settings is a module-level singleton (app/core/config.py) shared by
    # every importer, including app.core.deps — patching this one object's
    # attribute is what get_current_admin actually reads.
    monkeypatch.setattr(settings, "ADMIN_EMAILS", ADMIN_EMAIL)
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(autocommit=False, autoflush=False, bind=engine)()
    yield session
    session.close()


class _SyncThread:
    """Runs the target immediately, synchronously — a real background
    thread would otherwise open its own SessionLocal() against whatever
    DB_URL is configured, which in a test process must never be a real
    database."""

    def __init__(self, target=None, kwargs=None, **_ignored):
        self._target = target
        self._kwargs = kwargs or {}

    def start(self):
        self._target(**self._kwargs)


@pytest.fixture
def client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        id="user-1", email=ADMIN_EMAIL
    )
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture
def as_non_admin(client):
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        id="user-2", email="nobody@example.com"
    )
    return client


class TestAdminGating:
    def test_a_non_admin_is_forbidden(self, as_non_admin):
        assert as_non_admin.get("/api/admin/crawl/runs").status_code == 403
        assert as_non_admin.get("/api/admin/crawl/companies").status_code == 403
        assert as_non_admin.post("/api/admin/crawl/run").status_code == 403

    def test_an_admin_is_allowed(self, client):
        assert client.get("/api/admin/crawl/runs").status_code == 200

    def test_admin_emails_is_case_insensitive(self, client):
        app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
            id="user-1", email=ADMIN_EMAIL.upper()
        )
        assert client.get("/api/admin/crawl/runs").status_code == 200


class TestRuns:
    def test_lists_runs_newest_first(self, client, db_session):
        # Explicit, distinct started_at: two inserts in the same test can
        # land in the same SQLite CURRENT_TIMESTAMP second, which would make
        # the ordering this test checks for coincidental rather than real.
        older = CrawlRun(trigger="scheduled", started_at=datetime(2026, 1, 1, tzinfo=timezone.utc))
        db_session.add(older)
        db_session.commit()
        newer = CrawlRun(
            trigger="manual", triggered_by="user-1", started_at=datetime(2026, 1, 2, tzinfo=timezone.utc)
        )
        db_session.add(newer)
        db_session.commit()

        response = client.get("/api/admin/crawl/runs")
        assert response.status_code == 200
        ids = [row["id"] for row in response.json()]
        assert ids == [newer.id, older.id]

    def test_a_missing_run_is_404(self, client):
        assert client.get("/api/admin/crawl/runs/999").status_code == 404

    def test_errors_are_returned_as_a_list_not_a_json_string(self, client, db_session):
        run = CrawlRun(errors='["Acme: timed out"]')
        db_session.add(run)
        db_session.commit()

        response = client.get(f"/api/admin/crawl/runs/{run.id}")
        assert response.json()["errors"] == ["Acme: timed out"]


class TestCompanyHealth:
    def test_lists_company_health(self, client, db_session):
        db_session.add(Company(name="Acme", crawl_status="ok"))
        db_session.commit()
        response = client.get("/api/admin/crawl/companies")
        assert response.status_code == 200
        assert response.json()[0]["name"] == "Acme"

    def test_filters_by_status(self, client, db_session):
        db_session.add(Company(name="Ok Co", crawl_status="ok"))
        db_session.add(Company(name="Broken Co", crawl_status="failing"))
        db_session.commit()

        response = client.get("/api/admin/crawl/companies?status=failing")
        names = [row["name"] for row in response.json()]
        assert names == ["Broken Co"]


class TestManualTrigger:
    def test_a_full_crawl_calls_run_locked_with_the_admin_s_id(self, client, monkeypatch):
        calls = []
        monkeypatch.setattr(admin_router, "run_locked", lambda **kwargs: calls.append(kwargs))
        monkeypatch.setattr(admin_router.threading, "Thread", _SyncThread)

        response = client.post("/api/admin/crawl/run")
        assert response.status_code == 202
        assert calls == [{"trigger": "manual", "triggered_by": "user-1", "company_ids": None}]

    def test_a_missing_company_is_404_before_anything_is_queued(self, client, monkeypatch):
        monkeypatch.setattr(admin_router, "run_locked", lambda **kwargs: pytest.fail("must not run"))
        monkeypatch.setattr(admin_router.threading, "Thread", _SyncThread)

        response = client.post("/api/admin/crawl/companies/999/run")
        assert response.status_code == 404

    def test_a_company_crawl_is_scoped_to_that_company(self, client, db_session, monkeypatch):
        company = Company(name="Acme")
        db_session.add(company)
        db_session.commit()

        calls = []
        monkeypatch.setattr(admin_router, "run_locked", lambda **kwargs: calls.append(kwargs))
        monkeypatch.setattr(admin_router.threading, "Thread", _SyncThread)

        response = client.post(f"/api/admin/crawl/companies/{company.id}/run")
        assert response.status_code == 202
        assert calls == [{"trigger": "manual", "triggered_by": "user-1", "company_ids": [company.id]}]
