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

Eleven tables carry a user_id. Four more hold that person's data without one,
reachable only through a parent:

    interview_answers          -> interview_questions -> interview_sessions
    interview_questions        -> interview_sessions
    application_status_history -> job_applications
    coach_messages             -> coach_conversations

The database used to help here: user_id referenced Supabase's auth.users with
ON DELETE CASCADE, so deleting the login also removed star_stories and
prep_question_user_state. Those foreign keys are gone with Supabase, so every
one of these tables is now erased explicitly, and
tests/test_erasure_coverage.py fails when a table with a user_id column (or a
child of one) is added without being listed in USER_ID_TABLES / CHILD_TABLES.

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

from sqlalchemy import bindparam, inspect, select, text
from sqlalchemy.orm import Session

from app.models.application import ApplicationStatusHistory, JobApplication
from app.models.interview import InterviewAnswer, InterviewQuestion, InterviewSession
from app.models.notification import Notification
from app.models.offer import JobOffer
from app.models.profile import Profile
from app.models.resume import ResumeAnalysis
from app.models.story import StarStory
from app.models.interview_prep import PrepQuestionUserState
from app.models.tailor_cache import TailorCache
from app.models.tailored_resume import TailoredResume
from app.models.user_device import UserDevice

logger = logging.getLogger(__name__)

# The contract with tests/test_erasure_coverage.py. Table names, not models:
# coach_conversations and coach_messages no longer have models (nothing writes
# them any more) but their rows are still in production databases.
USER_ID_TABLES = frozenset(
    {
        "profiles",
        "resume_analyses",
        "job_applications",
        "interview_sessions",
        "job_offers",
        "notifications",
        "user_devices",
        "star_stories",
        "prep_question_user_state",
        "tailor_cache",
        "tailored_resumes",
        "coach_conversations",
    }
)
CHILD_TABLES = frozenset(
    {"interview_answers", "interview_questions", "application_status_history", "coach_messages"}
)

# Which section of the export carries each table. Kept beside the erasure
# registry on purpose: tests/test_erasure_coverage.py requires this to name
# exactly the tables erasure removes, so a person is never shown less than we
# delete, and never loses something we did not show them.
EXPORT_SECTIONS = {
    "profiles": "profile",
    "resume_analyses": "resume_analyses",
    "job_applications": "job_applications",
    "application_status_history": "application_status_history",
    "interview_sessions": "interview_sessions",
    "interview_questions": "interview_questions",
    "interview_answers": "interview_answers",
    "job_offers": "job_offers",
    "notifications": "notifications",
    "user_devices": "devices",
    "star_stories": "star_stories",
    "prep_question_user_state": "prep_question_user_state",
    "tailor_cache": "tailor_cache",
    "tailored_resumes": "tailored_resumes",
    "coach_conversations": "coach_conversations",
    "coach_messages": "coach_messages",
}


def _plain(value: Any) -> Any:
    """JSON-safe. Datetimes to ISO, bytes described rather than dumped."""
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, (bytes, bytearray)):
        # The raw PDF is the user's own file and they already have it. Base64
        # of every stored resume would multiply the export size for something
        # they can fetch individually from /api/resume/file/{id}, so its
        # presence and size are reported instead of its contents.
        return {
            "_bytes": len(value),
            "_note": (
                "download via /api/resume/file/{analysis_id} (scanned resumes) or "
                "/api/resume-builder/saved-tailored/{id}/file (saved tailored copies)"
            ),
        }
    return value


def _rows(db: Session, model, user_id: str) -> list[dict]:
    rows = db.execute(select(model).where(model.user_id == user_id)).scalars().all()
    return [
        {column.name: _plain(getattr(row, column.name)) for column in model.__table__.columns}
        for row in rows
    ]


def _export_coach_history(db: Session, user_id: str) -> dict[str, list[dict]]:
    """coach_conversations and their coach_messages. No ORM models exist for them.

    Always returns both sections, empty when the tables are absent, so the shape
    of the export does not depend on how the schema was built.
    """
    out: dict[str, list[dict]] = {"coach_conversations": [], "coach_messages": []}
    present = set(inspect(db.connection()).get_table_names())
    if "coach_conversations" not in present:
        return out
    conversations = db.execute(
        text("SELECT * FROM coach_conversations WHERE user_id = :user_id ORDER BY id"),
        {"user_id": user_id},
    ).mappings().all()
    out["coach_conversations"] = [{k: _plain(v) for k, v in row.items()} for row in conversations]
    ids = [row["id"] for row in conversations]
    if ids and "coach_messages" in present:
        messages = db.execute(
            text("SELECT * FROM coach_messages WHERE conversation_id IN :ids ORDER BY id").bindparams(
                bindparam("ids", expanding=True)
            ),
            {"ids": ids},
        ).mappings().all()
        out["coach_messages"] = [{k: _plain(v) for k, v in row.items()} for row in messages]
    return out


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
            "Everything HireLoom holds about this account. Resume files are "
            "referenced rather than embedded — fetch each from "
            "/api/resume/file/{analysis_id}, and saved tailored copies from "
            "/api/resume-builder/saved-tailored/{id}/file. Job listings are not included: they "
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
        "star_stories": _rows(db, StarStory, user_id),
        "prep_question_user_state": _rows(db, PrepQuestionUserState, user_id),
        "tailor_cache": _rows(db, TailorCache, user_id),
        "tailored_resumes": _rows(db, TailoredResume, user_id),
        **_export_coach_history(db, user_id),
    }


def _delete_coach_history(db: Session, user_id: str) -> dict[str, int]:
    """coach_messages, then coach_conversations. No ORM models exist for them.

    Skipped only when the tables are absent (a SQLite file built from the
    models alone); wherever Alembic built the schema they are there, and a
    missing table must not look like a deletion that happened.
    """
    # The session's own connection: a second one from the engine would, under a
    # shared-connection pool, roll back the deletions this transaction has pending.
    present = set(inspect(db.connection()).get_table_names())
    counts: dict[str, int] = {}
    if "coach_messages" in present:
        counts["coach_messages"] = db.execute(
            text(
                "DELETE FROM coach_messages WHERE conversation_id IN "
                "(SELECT id FROM coach_conversations WHERE user_id = :user_id)"
            ),
            {"user_id": user_id},
        ).rowcount
    if "coach_conversations" in present:
        counts["coach_conversations"] = db.execute(
            text("DELETE FROM coach_conversations WHERE user_id = :user_id"), {"user_id": user_id}
        ).rowcount
    return counts


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

    deleted.update(_delete_coach_history(db, user_id))

    for name, model in (
        ("star_stories", StarStory),
        ("prep_question_user_state", PrepQuestionUserState),
        ("tailor_cache", TailorCache),
        ("tailored_resumes", TailoredResume),
        ("interview_sessions", InterviewSession),
        ("job_offers", JobOffer),  # references job_applications (ON DELETE SET NULL)
        ("job_applications", JobApplication),
        ("resume_analyses", ResumeAnalysis),
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
