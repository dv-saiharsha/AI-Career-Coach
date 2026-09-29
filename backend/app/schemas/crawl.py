from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class CrawlRunSchema(BaseModel):
    id: int
    trigger: str
    triggeredBy: Optional[str]
    startedAt: datetime
    endedAt: Optional[datetime]
    companiesAttempted: int
    companiesSucceeded: int
    companiesFailed: int
    jobsNew: int
    jobsUpdated: int
    jobsClosed: int
    costUsd: float
    errors: List[str]


class CompanyHealthSchema(BaseModel):
    id: int
    name: str
    atsType: Optional[str]
    atsSlug: Optional[str]
    active: bool
    lastCrawledAt: Optional[datetime]
    crawlStatus: str
    consecutiveFailures: int
    lastError: Optional[str]


class CrawlTriggeredSchema(BaseModel):
    status: str = "queued"
    detail: str
