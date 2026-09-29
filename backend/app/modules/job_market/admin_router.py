"""Admin-only crawl monitoring and manual triggers.

Every endpoint here is gated by get_current_admin (ADMIN_EMAILS) — see that
dependency's own docstring for why an env allowlist rather than a DB column.
"""

import json
import threading
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import AuthenticatedUser, get_current_admin
from app.models.company import Company
from app.models.crawl_run import CrawlRun
from app.schemas.crawl import CompanyHealthSchema, CrawlRunSchema, CrawlTriggeredSchema
from app.worker import run_locked

router = APIRouter()


def _to_run_schema(run: CrawlRun) -> CrawlRunSchema:
    try:
        errors = json.loads(run.errors or "[]")
    except (ValueError, TypeError):
        errors = []
    return CrawlRunSchema(
        id=run.id,
        trigger=run.trigger,
        triggeredBy=run.triggered_by,
        startedAt=run.started_at,
        endedAt=run.ended_at,
        companiesAttempted=run.companies_attempted,
        companiesSucceeded=run.companies_succeeded,
        companiesFailed=run.companies_failed,
        jobsNew=run.jobs_new,
        jobsUpdated=run.jobs_updated,
        jobsClosed=run.jobs_closed,
        costUsd=run.cost_usd,
        errors=errors,
    )


def _to_company_schema(company: Company) -> CompanyHealthSchema:
    return CompanyHealthSchema(
        id=company.id,
        name=company.name,
        atsType=company.ats_type,
        atsSlug=company.ats_slug,
        active=company.active,
        lastCrawledAt=company.last_crawled_at,
        crawlStatus=company.crawl_status,
        consecutiveFailures=company.consecutive_failures,
        lastError=company.last_error,
    )


@router.get("/runs", response_model=List[CrawlRunSchema])
def list_runs(
    limit: int = Query(default=20, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _admin: AuthenticatedUser = Depends(get_current_admin),
):
    runs = db.query(CrawlRun).order_by(CrawlRun.started_at.desc()).offset(offset).limit(limit).all()
    return [_to_run_schema(run) for run in runs]


@router.get("/runs/{run_id}", response_model=CrawlRunSchema)
def get_run(
    run_id: int,
    db: Session = Depends(get_db),
    _admin: AuthenticatedUser = Depends(get_current_admin),
):
    run = db.query(CrawlRun).filter(CrawlRun.id == run_id).first()
    if run is None:
        raise HTTPException(status_code=404, detail="Crawl run not found")
    return _to_run_schema(run)


@router.get("/companies", response_model=List[CompanyHealthSchema])
def list_company_health(
    status_filter: Optional[str] = Query(
        default=None, alias="status", description="ok | failing | never_run"
    ),
    db: Session = Depends(get_db),
    _admin: AuthenticatedUser = Depends(get_current_admin),
):
    query = db.query(Company)
    if status_filter:
        query = query.filter(Company.crawl_status == status_filter)
    companies = query.order_by(Company.name).all()
    return [_to_company_schema(company) for company in companies]


def _trigger_in_background(trigger: str, triggered_by: str, company_ids: Optional[List[int]] = None) -> None:
    """Runs on a detached daemon thread, not FastAPI's BackgroundTasks — the
    same reason services.refresh_in_background isn't either: a crawl over
    every company can run long past when this response is sent, and that
    must not hold a request worker open for the duration. Still respects
    the same Redis lock the scheduled worker uses (run_locked), so a manual
    trigger can never overlap a scheduled run.
    """
    thread = threading.Thread(
        target=run_locked,
        kwargs={"trigger": trigger, "triggered_by": triggered_by, "company_ids": company_ids},
        daemon=True,
        name="admin-triggered-crawl",
    )
    thread.start()


@router.post("/run", response_model=CrawlTriggeredSchema, status_code=status.HTTP_202_ACCEPTED)
def trigger_full_crawl(admin: AuthenticatedUser = Depends(get_current_admin)):
    _trigger_in_background(trigger="manual", triggered_by=admin.id)
    return CrawlTriggeredSchema(detail="Crawl queued")


@router.post(
    "/companies/{company_id}/run", response_model=CrawlTriggeredSchema, status_code=status.HTTP_202_ACCEPTED
)
def trigger_company_crawl(
    company_id: int,
    db: Session = Depends(get_db),
    admin: AuthenticatedUser = Depends(get_current_admin),
):
    company = db.query(Company).filter(Company.id == company_id).first()
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found")

    _trigger_in_background(trigger="manual", triggered_by=admin.id, company_ids=[company_id])
    return CrawlTriggeredSchema(detail=f"Crawl queued for {company.name}")
