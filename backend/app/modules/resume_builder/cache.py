"""A small cache for tailoring output, keyed by (user, resume scan, job).

Two things make this worth having. faang.build_preview's include_rewrites path
spends a Claude call, and services.quick_tailor runs several tectonic compiles
per attempt (see router.py's rate-limit comment) — both real costs paid again
for the exact same input every time a user reopens the same tailor tab.

Rows are read-then-expired: a stale row is deleted on the read that finds it,
rather than swept on a timer. Same amortized-sweep preference as
core/ratelimit.py, and for the same reason — there is no background job to own.

Neither kind is invalidated when the underlying resume or job listing changes,
because neither can change out from under a cache hit: a re-scan gets a new
analysis_id, and job_listings rows are immutable once fetched (see
job_market/services.py). The TTL exists only to bound how long a stale row
survives if the same (user, analysis, job) is never revisited.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from sqlalchemy.orm import Session

from app.models.tailor_cache import TailorCache

TTL_HOURS = 24

CacheKind = Literal["preview", "quick_tailor"]


def _target_pages_clause(target_pages: int | None):
    """target_pages is NULL for kind="preview" — `== None` would build a SQL
    literal comparison that never matches NULL, so the None case needs its
    own IS NULL clause rather than falling through to the general one."""
    if target_pages is None:
        return TailorCache.target_pages.is_(None)
    return TailorCache.target_pages == target_pages


def get_cached(
    db: Session,
    user_id: str,
    analysis_id: int,
    job_id: int,
    kind: CacheKind,
    target_pages: int | None = None,
) -> dict[str, Any] | None:
    """The cached payload, or None on a miss or an expired row.

    An expired row is deleted here rather than left for a caller to notice —
    the read that finds it is the only place a sweep is ever cheap."""
    row = (
        db.query(TailorCache)
        .filter(
            TailorCache.user_id == user_id,
            TailorCache.analysis_id == analysis_id,
            TailorCache.job_id == job_id,
            TailorCache.kind == kind,
            _target_pages_clause(target_pages),
        )
        .first()
    )
    if row is None:
        return None

    created_at = row.created_at
    if created_at.tzinfo is None:
        # SQLite hands back naive datetimes; Postgres aware ones (same quirk
        # documented in dashboard/services.py). Treat a naive stamp as UTC,
        # which is what server_default=func.now() actually wrote.
        created_at = created_at.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) - created_at > timedelta(hours=TTL_HOURS):
        db.delete(row)
        db.commit()
        return None

    payload = json.loads(row.payload_json)
    if row.pdf_base64 is not None:
        payload["pdf_base64"] = row.pdf_base64
    return payload


def put_cached(
    db: Session,
    user_id: str,
    analysis_id: int,
    job_id: int,
    kind: CacheKind,
    payload: dict[str, Any],
    target_pages: int | None = None,
) -> None:
    """Stores `payload`, replacing any existing row for the same key.

    pdf_base64 is split out of the JSON blob into its own column rather than
    left inside it — a cache row should be inspectable without base64-decoding
    a multi-kilobyte string first.
    """
    pdf_base64 = payload.get("pdf_base64")
    to_store = {k: v for k, v in payload.items() if k != "pdf_base64"}

    existing = (
        db.query(TailorCache)
        .filter(
            TailorCache.user_id == user_id,
            TailorCache.analysis_id == analysis_id,
            TailorCache.job_id == job_id,
            TailorCache.kind == kind,
            _target_pages_clause(target_pages),
        )
        .first()
    )
    if existing is not None:
        db.delete(existing)
        db.flush()

    db.add(
        TailorCache(
            user_id=user_id,
            analysis_id=analysis_id,
            job_id=job_id,
            kind=kind,
            target_pages=target_pages,
            payload_json=json.dumps(to_store),
            pdf_base64=pdf_base64,
        )
    )
    db.commit()
