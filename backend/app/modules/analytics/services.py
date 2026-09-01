"""Historical analytics: ATS trajectory, pipeline funnel, resume quality.

Every query filters on a user_id taken from a verified JWT.
"""

import json
from datetime import datetime

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.application import APPLICATION_STATUSES, INTERVIEW_STAGES, ApplicationStatusHistory, JobApplication
from app.models.resume import ResumeAnalysis

STAGES = APPLICATION_STATUSES


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _scans(db: Session, user_id: str) -> list[ResumeAnalysis]:
    return (
        db.query(ResumeAnalysis)
        .filter(ResumeAnalysis.user_id == user_id)
        .order_by(ResumeAnalysis.created_at.asc(), ResumeAnalysis.id.asc())
        .all()
    )


def ats_history(db: Session, user_id: str) -> list[dict]:
    """Every scan in chronological order.

    Labelled by resume_filename, not job_title: resume_analyses has no
    job_title column. The filename is also what the user recognises
    ("ML_Engineer_v3.pdf"), which is what makes a trajectory across resume
    revisions legible.
    """
    return [
        {
            "id": scan.id,
            "date": _iso(scan.created_at),
            "score": round(float(scan.ats_score or 0), 1),
            "label": scan.resume_filename or "Untitled resume",
        }
        for scan in _scans(db, user_id)
    ]


def quantified_bullet_history(db: Session, user_id: str) -> list[dict]:
    """Quantified-bullet figures per scan, read from stored diagnostics.

    Only scans saved after diagnostics shipped carry these numbers. Older rows
    are skipped rather than reported as zero, which would draw a fake collapse
    at the start of the trend line.
    """
    points: list[dict] = []
    for scan in _scans(db, user_id):
        try:
            stored = json.loads(scan.result_json or "{}")
        except (ValueError, TypeError):
            continue
        diagnostics = stored.get("diagnostics")
        if not isinstance(diagnostics, dict):
            continue
        points.append(
            {
                "id": scan.id,
                "date": _iso(scan.created_at),
                "label": scan.resume_filename or "Untitled resume",
                "quantified_ratio": round(float(diagnostics.get("quantified_metrics_ratio") or 0), 1),
                "impact_rating": round(float(diagnostics.get("bullet_impact_rating") or 0), 1),
            }
        )
    return points


def pipeline_funnel(db: Session, user_id: str) -> dict:
    """Conversion counts as "ever reached at least this stage".

    `status` records where a card is NOW, not where it has been, so counting
    it directly understates every earlier stage: someone with ten interviews
    booked, all now rejected, would show a 0% interview rate.

      - reached_applied uses applied_at, the one point in the journey that is
        actually timestamped, so it stays true after a card moves on.
      - reached_interviewing / reached_offer query application_status_history
        (Milestone 8) for any row that ever landed on an interview-or-later
        stage — exact, not an approximation. A card rejected after an onsite
        still counts, because history records the onsite happened even
        though `status` no longer says so.

    Before Milestone 8 introduced status history, this was computed
    ordinally from current `status` alone (`interviewing` + `offer` counts),
    which under-counted exactly the rejected-after-progressing case above —
    stated as a known limitation at the time rather than papered over.
    """
    counts = dict(
        db.query(JobApplication.status, func.count(JobApplication.id))
        .filter(JobApplication.user_id == user_id)
        .group_by(JobApplication.status)
        .all()
    )
    by_stage = {stage: counts.get(stage, 0) for stage in STAGES}

    reached_applied = (
        db.query(func.count(JobApplication.id))
        .filter(JobApplication.user_id == user_id, JobApplication.applied_at.isnot(None))
        .scalar()
    ) or 0

    def _reached(stages: tuple[str, ...]) -> int:
        return (
            db.query(func.count(func.distinct(ApplicationStatusHistory.application_id)))
            .join(JobApplication, ApplicationStatusHistory.application_id == JobApplication.id)
            .filter(JobApplication.user_id == user_id, ApplicationStatusHistory.to_status.in_(stages))
            .scalar()
        ) or 0

    reached_interviewing = _reached(INTERVIEW_STAGES + ("offer", "accepted"))
    reached_offer = _reached(("offer", "accepted"))

    def rate(numerator: int, denominator: int) -> float | None:
        # None, not 0.0, when there is nothing to divide by: "0% interview
        # rate" reads as failure, where no applications yet is simply no data.
        if denominator <= 0:
            return None
        return round(numerator / denominator * 100, 1)

    return {
        "by_stage": by_stage,
        "total_tracked": sum(by_stage.values()),
        "reached_applied": reached_applied,
        "reached_interviewing": reached_interviewing,
        "reached_offer": reached_offer,
        # Denominated on applications actually sent, not on every saved card:
        # counting roles that were only bookmarked would deflate both rates.
        "interview_rate": rate(reached_interviewing, reached_applied),
        "offer_rate": rate(reached_offer, reached_applied),
    }


def progress_buckets(history: list[dict], period: str) -> list[dict]:
    """Buckets an already-computed ats_history into weekly or monthly
    points, for the Career Dashboard's Weekly/Monthly Progress charts.

    A pure function over data the caller already fetched, not a second
    query — ats_history stays the one source of scan data; this only
    re-groups it. Each bucket keeps the *last* score recorded in it (where
    the resume stood by the end of that period), not an average, since
    averaging scores from different resume revisions together would blur
    what each one actually scored.
    """
    if period not in ("week", "month"):
        raise ValueError("period must be 'week' or 'month'")

    buckets: dict[str, dict] = {}
    for point in history:
        if not point.get("date"):
            continue
        parsed = datetime.fromisoformat(point["date"].replace("Z", "+00:00"))
        if period == "week":
            iso_year, iso_week, _ = parsed.isocalendar()
            key = f"{iso_year}-W{iso_week:02d}"
        else:
            key = f"{parsed.year}-{parsed.month:02d}"
        # History is already chronological, so the last write per key is the
        # bucket's most recent point — no need to compare dates again here.
        buckets[key] = {"period": key, "score": point["score"]}

    return list(buckets.values())


def summary(db: Session, user_id: str) -> dict:
    history = ats_history(db, user_id)
    scores = [point["score"] for point in history]
    return {
        "ats_history": history,
        "quantified_history": quantified_bullet_history(db, user_id),
        "funnel": pipeline_funnel(db, user_id),
        "scan_count": len(history),
        "best_score": max(scores) if scores else None,
        "latest_score": scores[-1] if scores else None,
        # First-to-latest delta. None with a single scan: one data point is not
        # a trend, and rendering "+0" would imply it were.
        "score_delta": round(scores[-1] - scores[0], 1) if len(scores) > 1 else None,
    }
