"""Application pipeline persistence.

Every function takes `user_id` and filters on it. That id always comes from a
verified Supabase JWT (app/core/deps.get_current_user) — never from a request
body or header, which a caller controls and could set to someone else's id.
"""

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.application import APPLICATION_STATUSES, JobApplication


def _serialize(record: JobApplication) -> dict:
    def iso(value: datetime | None) -> str | None:
        return value.isoformat() if value else None

    return {
        "id": record.id,
        "job_title": record.job_title,
        "company": record.company,
        "location": record.location,
        "salary_range": record.salary_range,
        "status": record.status,
        "job_url": record.job_url,
        "job_description": record.job_description,
        "tailored_resume_id": record.tailored_resume_id,
        "notes": record.notes,
        "applied_at": iso(record.applied_at),
        "created_at": iso(record.created_at),
        "updated_at": iso(record.updated_at),
    }


def get_pipeline(db: Session, user_id: str) -> dict:
    """All of a user's applications, grouped by stage.

    Every stage key is present even when empty — the board draws five columns
    regardless, and a missing key would silently drop one.
    """
    records = (
        db.query(JobApplication)
        .filter(JobApplication.user_id == user_id)
        .order_by(JobApplication.updated_at.desc().nullslast(), JobApplication.id.desc())
        .all()
    )

    pipeline: dict[str, list[dict]] = {status: [] for status in APPLICATION_STATUSES}
    for record in records:
        # Defensive: a row whose status predates a stage rename would
        # otherwise raise a KeyError and take the whole board down.
        pipeline.setdefault(record.status, []).append(_serialize(record))

    return {"pipeline": pipeline, "total": len(records)}


def create_application(db: Session, user_id: str, payload: dict) -> dict:
    record = JobApplication(user_id=user_id, **payload)
    # Saving something straight into 'applied' should still date-stamp it.
    if record.status == "applied":
        record.applied_at = datetime.now(timezone.utc)

    db.add(record)
    db.commit()
    db.refresh(record)
    return _serialize(record)


def _owned(db: Session, user_id: str, application_id: int) -> JobApplication | None:
    """Ownership is part of the lookup, not a check afterwards — so a wrong
    user gets an indistinguishable 404 rather than a 403 that confirms the
    row exists."""
    return (
        db.query(JobApplication)
        .filter(JobApplication.id == application_id, JobApplication.user_id == user_id)
        .first()
    )


def update_application(db: Session, user_id: str, application_id: int, payload: dict) -> dict | None:
    record = _owned(db, user_id, application_id)
    if not record:
        return None

    for field, value in payload.items():
        setattr(record, field, value)

    # Stamped the first time it reaches 'applied' and not overwritten after —
    # it records when the application went out, so moving to 'interviewing'
    # and back must not reset it.
    if payload.get("status") == "applied" and record.applied_at is None:
        record.applied_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(record)
    return _serialize(record)


def delete_application(db: Session, user_id: str, application_id: int) -> bool:
    record = _owned(db, user_id, application_id)
    if not record:
        return False
    db.delete(record)
    db.commit()
    return True
