"""Crawl failure alerting. No network — webhook posts go through a
monkeypatched _post_webhook / urlopen, never a real HTTP call."""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.models.company import Company
from app.models.crawl_run import CrawlRun
from app.modules.job_market import alerting


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


@pytest.fixture
def alerts(monkeypatch):
    sent = []
    monkeypatch.setattr(alerting, "_post_webhook", lambda message: sent.append(message))
    return sent


class TestRunFailedOutright:
    def test_alerts_when_every_attempted_company_failed(self, db, alerts):
        run = CrawlRun(companies_attempted=3, companies_failed=3)
        alerting.check_and_alert(db, run)
        assert any("failed outright" in message for message in alerts)

    def test_no_alert_when_some_companies_succeeded(self, db, alerts):
        run = CrawlRun(companies_attempted=3, companies_failed=1)
        alerting.check_and_alert(db, run)
        assert not any("failed outright" in message for message in alerts)

    def test_no_alert_when_nothing_was_attempted(self, db, alerts):
        run = CrawlRun(companies_attempted=0, companies_failed=0)
        alerting.check_and_alert(db, run)
        assert alerts == []


class TestConsecutiveCompanyFailures:
    def test_alerts_the_run_the_streak_first_crosses_the_threshold(self, db, alerts):
        db.add(Company(name="Acme", consecutive_failures=3))
        db.commit()
        run = CrawlRun(companies_attempted=5, companies_failed=1)
        alerting.check_and_alert(db, run)
        assert any("Acme" in message for message in alerts)

    def test_does_not_re_alert_every_run_after_the_streak_grows(self, db, alerts):
        db.add(Company(name="Acme", consecutive_failures=4))
        db.commit()
        run = CrawlRun(companies_attempted=5, companies_failed=1)
        alerting.check_and_alert(db, run)
        assert alerts == []

    def test_a_company_below_the_threshold_does_not_alert(self, db, alerts):
        db.add(Company(name="Acme", consecutive_failures=2))
        db.commit()
        run = CrawlRun(companies_attempted=5, companies_failed=1)
        alerting.check_and_alert(db, run)
        assert alerts == []

    def test_a_recovered_then_re_failing_company_alerts_again(self, db, alerts):
        """consecutive_failures resets to 0 on any success (crawler.py), so
        hitting 3 a second time is a fresh incident, not a continuation."""
        db.add(Company(name="Acme", consecutive_failures=3))
        db.commit()
        run = CrawlRun(companies_attempted=5, companies_failed=1)
        alerting.check_and_alert(db, run)
        assert len(alerts) == 1


class TestWebhook:
    def test_no_webhook_configured_does_nothing(self, monkeypatch):
        monkeypatch.setattr(alerting.settings, "ALERT_WEBHOOK_URL", "")
        called = []
        monkeypatch.setattr(alerting.urllib.request, "urlopen", lambda *a, **k: called.append(1))
        alerting._post_webhook("test")
        assert called == []

    def test_a_failed_post_does_not_raise(self, monkeypatch):
        monkeypatch.setattr(alerting.settings, "ALERT_WEBHOOK_URL", "https://hooks.example/x")

        def boom(*a, **k):
            raise OSError("unreachable")

        monkeypatch.setattr(alerting.urllib.request, "urlopen", boom)
        alerting._post_webhook("test")  # must not raise
