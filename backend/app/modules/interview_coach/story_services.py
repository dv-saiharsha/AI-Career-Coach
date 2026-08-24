"""STAR story persistence. Every query filters on the JWT-derived user_id."""

from datetime import datetime

from sqlalchemy.orm import Session

from app.models.story import StarStory
from app.modules.interview_coach.star_bank import evaluate_star_story


def _serialize(record: StarStory) -> dict:
    def iso(value: datetime | None) -> str | None:
        return value.isoformat() if value else None

    return {
        "id": record.id,
        "title": record.title,
        "situation": record.situation or "",
        "task": record.task or "",
        "action": record.action or "",
        "result": record.result or "",
        "tags": record.tags,
        "created_at": iso(record.created_at),
        "updated_at": iso(record.updated_at),
        # Evaluated on read rather than stored: the rubric will change, and a
        # cached score would silently disagree with the live one after any
        # tweak to the evaluator.
        "evaluation": evaluate_star_story(
            record.situation or "", record.task or "", record.action or "", record.result or ""
        ),
    }


def list_stories(db: Session, user_id: str) -> dict:
    records = (
        db.query(StarStory)
        .filter(StarStory.user_id == user_id)
        .order_by(StarStory.created_at.desc().nullslast(), StarStory.id.desc())
        .all()
    )
    return {"stories": [_serialize(r) for r in records], "count": len(records)}


def create_story(db: Session, user_id: str, payload: dict) -> dict:
    record = StarStory(user_id=user_id, **payload)
    db.add(record)
    db.commit()
    db.refresh(record)
    return _serialize(record)


def _owned(db: Session, user_id: str, story_id: int) -> StarStory | None:
    """Ownership is part of the lookup, so another user's story returns an
    indistinguishable 404 rather than a 403 confirming it exists."""
    return (
        db.query(StarStory)
        .filter(StarStory.id == story_id, StarStory.user_id == user_id)
        .first()
    )


def update_story(db: Session, user_id: str, story_id: int, payload: dict) -> dict | None:
    record = _owned(db, user_id, story_id)
    if not record:
        return None
    for field, value in payload.items():
        setattr(record, field, value)
    db.commit()
    db.refresh(record)
    return _serialize(record)


def delete_story(db: Session, user_id: str, story_id: int) -> bool:
    record = _owned(db, user_id, story_id)
    if not record:
        return False
    db.delete(record)
    db.commit()
    return True
