"""Crawl failure alerts: always logged, optionally also posted to a
Slack-compatible incoming webhook (ALERT_WEBHOOK_URL). No email provider is
introduced — see CRAWLER_PLAN.md's decisions for why.

Two conditions alert, each naturally deduped so one incident can't repeat
itself every single run:

  - the run itself failed outright (every company attempted, all failed) —
    checked once per run, so this can fire again on the very next tick if
    it's still true; there's no "recovered since" state to lose.
  - a company's crawl failure streak crosses CONSECUTIVE_FAILURE_THRESHOLD —
    checked with `== `, not `>=`. A company already failing for a week
    passed through 3 exactly once; every run after that is 4, 5, 6, ...,
    never equal to 3 again, so this alerts on the incident, not on every
    hour it remains true. A company that recovers and fails again later
    resets to 0 first, so a fresh incident still alerts.
"""

from __future__ import annotations

import json
import logging
import urllib.request

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.company import Company
from app.models.crawl_run import CrawlRun

logger = logging.getLogger(__name__)

CONSECUTIVE_FAILURE_THRESHOLD = 3
WEBHOOK_TIMEOUT_SECONDS = 10


def _post_webhook(text: str) -> None:
    if not settings.ALERT_WEBHOOK_URL:
        return
    payload = json.dumps({"text": text}).encode("utf-8")
    request = urllib.request.Request(
        settings.ALERT_WEBHOOK_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=WEBHOOK_TIMEOUT_SECONDS):  # noqa: S310
            pass
    except Exception:  # noqa: BLE001 - a failed alert must not fail the crawl that triggered it
        logger.warning("failed to post crawl alert to webhook", exc_info=True)


def _alert(message: str) -> None:
    logger.error("CRAWL ALERT: %s", message)
    _post_webhook(message)


def check_and_alert(db: Session, run: CrawlRun) -> None:
    """Call once, right after a crawl run completes."""
    if run.companies_attempted and run.companies_failed == run.companies_attempted:
        _alert(f"Crawl run {run.id} failed outright: all {run.companies_attempted} companies attempted failed.")

    newly_failing = (
        db.query(Company).filter(Company.consecutive_failures == CONSECUTIVE_FAILURE_THRESHOLD).all()
    )
    for company in newly_failing:
        _alert(
            f"{company.name} has failed its last {company.consecutive_failures} crawls in a row "
            f"(ats_type={company.ats_type}, last_error={company.last_error!r})."
        )
