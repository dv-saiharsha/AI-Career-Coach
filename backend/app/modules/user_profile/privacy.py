"""Export and erasure of everything this product holds about one person.

WHY THIS EXISTS

The landing page tells people "Nothing was shared" and "Your CV is not sold,
listed, or shown to employers. It is read to score it, and that is all."

Those are the right promises. Until now there was no mechanism behind them —
no way for someone to see what was held, and no way to make it stop being
held. A promise a user cannot verify or act on is a marketing line, and the
data involved is not trivial: full resume PDFs, the extracted text with name,
email, phone and employment history, job descriptions they pasted, private
notes on applications, and the answers they gave in mock interviews.

THE PART THAT IS EASY TO GET WRONG

Nine tables carry a user_id. Three more hold that person's data without one,
reachable only through a parent:

    interview_answers          -> interview_questions -> interview_sessions
    interview_questions        -> interview_sessions
    application_status_history -> job_applications

A deletion written as "DELETE FROM every table WHERE user_id = :id" looks
complete, passes a casual review, and leaves the user's own interview answers
sitting in the database attached to nothing. That is worse than not offering
deletion at all, because the person has been told their data is gone.

So deletion walks the parents first to collect their ids, deletes the children
by those ids, and only then removes the parents. The counts it returns name
every table, including the indirect ones, so the result is auditable rather
than a bare "ok".

WHAT IS DELIBERATELY NOT DELETED

job_listings and prep_questions. Neither is user data — the first is the
shared job feed every account reads, the second is the shared question bank.
Removing rows from them because one user left would degrade the product for
everyone else and would not protect anybody.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.application import ApplicationStatusHistory, JobApplication
from app.models.interview import InterviewAnswer, InterviewQuestion, InterviewSession
from app.models.notification import Notification
from app.models.offer import JobOffer
from app.models.profile import Profile
from app.models.resume import ResumeAnalysis
from app.models.user_device import UserDevice

logger = logging.getLogger(__name__)


def _plain(value: Any) -> Any:
    """JSON-safe. Datetimes to ISO, bytes described rather than dumped."""
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, (bytes, bytearray)):
        # The raw PDF is the user's own file and they already have it. Base64
        # of every stored resume would multiply the export size for something
        # they can fetch individually from /api/resume/file/{id}, so its
        # presence and size are reported instead of its contents.
        return {"_bytes": len(value), "_note": "download via /api/resume/file/{analysis_id}"}
    return value


def _rows(db: Session, model, user_id: str) -> list[dict]:
    rows = db.execute(select(model).where(model.user_id == user_id)).scalars().all()
    return [
        {column.name: _plain(getattr(row, column.name)) for column in model.__table__.columns}
        for row in rows
    ]


def export_user_data(db: Session, user_id: str) -> dict:
    """Everything held about one person, as JSON.

    Includes the indirect tables, reached through their parents, because an
    export that silently omits a person's own interview answers is not an
    export of their data.
    """
    session_ids = [
        row[0]
        for row in db.execute(
            select(InterviewSession.id).where(InterviewSession.user_id == user_id)
        ).all()
    ]
    question_ids = [
        row[0]
        for row in db.execute(
            select(InterviewQuestion.id).where(InterviewQuestion.session_id.in_(session_ids))
        ).all()
    ] if session_ids else []
    application_ids = [
        row[0]
        for row in db.execute(
            select(JobApplication.id).where(JobApplication.user_id == user_id)
        ).all()
    ]

    def by_ids(model, column, ids) -> list[dict]:
        if not ids:
            return []
        rows = db.execute(select(model).where(column.in_(ids))).scalars().all()
        return [
            {c.name: _plain(getattr(row, c.name)) for c in model.__table__.columns}
            for row in rows
        ]

    return {
        "exported_at": datetime.now().astimezone().isoformat(),
        "user_id": user_id,
        "note": (
            "Everything ApplyCenter holds about this account. Resume files are "
            "referenced rather than embedded — fetch each from "
            "/api/resume/file/{analysis_id}. Job listings are not included: they "
            "are the shared public feed, not your data."
        ),
        "profile": _rows(db, Profile, user_id),
        "resume_analyses": _rows(db, ResumeAnalysis, user_id),
        "job_applications": _rows(db, JobApplication, user_id),
        "application_status_history": by_ids(
            ApplicationStatusHistory, ApplicationStatusHistory.application_id, application_ids
        ),
        "interview_sessions": _rows(db, InterviewSession, user_id),
        "interview_questions": by_ids(
            InterviewQuestion, InterviewQuestion.session_id, session_ids
        ),
        "interview_answers": by_ids(
            InterviewAnswer, InterviewAnswer.question_id, question_ids
        ),
        "job_offers": _rows(db, JobOffer, user_id),
        "notifications": _rows(db, Notification, user_id),
        "devices": _rows(db, UserDevice, user_id),
    }


def delete_user_data(db: Session, user_id: str) -> dict[str, int]:
    """Erase everything, children before parents. Returns per-table counts.

    Counts are returned per table rather than as a total so the result can be
    checked against the export — "we deleted 47 things" is not something a
    person can verify, and neither is a bare success.
    """
    deleted: dict[str, int] = {}

    session_ids = [
        row[0]
        for row in db.execute(
            select(InterviewSession.id).where(InterviewSession.user_id == user_id)
        ).all()
    ]
    question_ids = [
        row[0]
        for row in db.execute(
            select(InterviewQuestion.id).where(InterviewQuestion.session_id.in_(session_ids))
        ).all()
    ] if session_ids else []
    application_ids = [
        row[0]
        for row in db.execute(
            select(JobApplication.id).where(JobApplication.user_id == user_id)
        ).all()
    ]

    # Grandchildren first, then children, then parents. Anything else either
    # violates a foreign key or orphans rows that still hold this person's
    # words.
    if question_ids:
        deleted["interview_answers"] = (
            db.query(InterviewAnswer)
            .filter(InterviewAnswer.question_id.in_(question_ids))
            .delete(synchronize_session=False)
        )
    if session_ids:
        deleted["interview_questions"] = (
            db.query(InterviewQuestion)
            .filter(InterviewQuestion.session_id.in_(session_ids))
            .delete(synchronize_session=False)
        )
    if application_ids:
        deleted["application_status_history"] = (
            db.query(ApplicationStatusHistory)
            .filter(ApplicationStatusHistory.application_id.in_(application_ids))
            .delete(synchronize_session=False)
        )

    for name, model in (
        ("interview_sessions", InterviewSession),
        ("job_applications", JobApplication),
        ("resume_analyses", ResumeAnalysis),
        ("job_offers", JobOffer),
        ("notifications", Notification),
        ("devices", UserDevice),
        ("profile", Profile),
    ):
        deleted[name] = (
            db.query(model).filter(model.user_id == user_id).delete(synchronize_session=False)
        )

    db.commit()
    # user_id is logged; nothing about the person is. This line needs to exist
    # for an operator to answer "was this account actually erased", and it
    # would defeat the point if it recorded what was erased.
    logger.info("erased all data for user %s: %s", user_id, json.dumps(deleted))
    return deleted
