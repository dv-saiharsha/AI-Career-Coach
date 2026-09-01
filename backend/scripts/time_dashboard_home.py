"""Stage-by-stage timing for GET /api/dashboard/home.

Users report a gap between signing in and the dashboard appearing. This
measures where that time actually goes inside the one request the dashboard
makes, rather than guessing at it — the composition in
dashboard/services.home() calls eight engine functions in sequence, and
"it's slow" is not actionable until each one has a number next to it.

Runs against an in-memory SQLite database seeded to a realistic size, so the
numbers are query-shape and Python cost, not network or Postgres planning.
Read them as relative weights between stages, not as production latency.

    python scripts/time_dashboard_home.py [--rows N]
"""

import argparse
import statistics
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.core.database import Base  # noqa: E402
from app.models.application import ApplicationStatusHistory, JobApplication  # noqa: E402
from app.models.interview import InterviewAnswer, InterviewQuestion, InterviewSession  # noqa: E402
from app.models.resume import ResumeAnalysis  # noqa: E402
from app.modules.analytics.services import pipeline_funnel, summary as analytics_summary  # noqa: E402
from app.modules.applications.services import get_pipeline  # noqa: E402
from app.modules.dashboard import services as dashboard  # noqa: E402
from app.modules.interview_coach import prep as interview_prep  # noqa: E402
from app.modules.interview_coach.dashboard import dashboard_summary as interview_summary  # noqa: E402

USER = "00000000-0000-0000-0000-00000000000a"


def seed(session, rows: int) -> None:
    """A user who has been using the product for a while, not a fresh one —
    an empty account hides exactly the costs that matter."""
    now = datetime.now(timezone.utc)
    stages = ("saved", "applied", "recruiter_screening", "technical_interview", "offer", "rejected")

    for i in range(rows):
        app_row = JobApplication(
            user_id=USER,
            job_title=f"Data Engineer {i}",
            company=f"Company {i}",
            location="Remote",
            status=stages[i % len(stages)],
            applied_at=now - timedelta(days=i % 90),
            created_at=now - timedelta(days=i % 90),
            match_score=50 + (i % 50),
        )
        session.add(app_row)
        session.flush()
        session.add(
            ApplicationStatusHistory(
                application_id=app_row.id, from_status=None, to_status=app_row.status
            )
        )

    for i in range(max(6, rows // 4)):
        session.add(
            ResumeAnalysis(
                user_id=USER,
                resume_filename=f"cv-{i}.pdf",
                job_description="Data engineering role.",
                ats_score=55 + (i % 40),
                result_json="{}",
                resume_text="Experience building pipelines.",
                created_at=now - timedelta(days=i * 7),
            )
        )

    for i in range(max(4, rows // 10)):
        s = InterviewSession(
            user_id=USER,
            role="Data Engineer",
            seniority="senior",
            status="completed",
            overall_score=60 + (i % 30),
            created_at=now - timedelta(days=i * 5),
        )
        session.add(s)
        session.flush()
        q = InterviewQuestion(session_id=s.id, question_type="technical", text="Q?", sequence_order=0)
        session.add(q)
        session.flush()
        session.add(
            InterviewAnswer(question_id=q.id, answer_text="A", score=7.0, feedback="{}")
        )

    session.commit()


STAGES = [
    ("resume", lambda db: dashboard._resume_section(db, USER)),
    ("pipeline", lambda db: get_pipeline(db, USER)),
    ("analytics", lambda db: analytics_summary(db, USER)),
    ("interview", lambda db: interview_summary(db, USER)),
    ("prep_progress", lambda db: interview_prep.dashboard_progress(db, USER)),
    ("jobs", lambda db: dashboard._jobs_section(db, USER)),
    ("funnel", lambda db: pipeline_funnel(db, USER)),
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rows", type=int, default=120, help="applications to seed")
    parser.add_argument("--runs", type=int, default=7)
    args = parser.parse_args()

    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    seed(db, args.rows)

    print(f"\nGET /dashboard/home — {args.rows} applications, {args.runs} runs\n")
    print(f"{'STAGE':<16}{'MEDIAN':>10}{'MAX':>10}{'SHARE':>9}")
    print("-" * 45)

    timings: dict[str, list[float]] = {}
    for name, fn in STAGES:
        samples = []
        for _ in range(args.runs):
            start = time.perf_counter()
            fn(db)
            samples.append((time.perf_counter() - start) * 1000)
        timings[name] = samples

    whole = []
    for _ in range(args.runs):
        start = time.perf_counter()
        dashboard.home(db, USER)
        whole.append((time.perf_counter() - start) * 1000)

    total_stage = sum(statistics.median(v) for v in timings.values())
    for name, samples in sorted(timings.items(), key=lambda kv: -statistics.median(kv[1])):
        med = statistics.median(samples)
        print(f"{name:<16}{med:>9.1f}ms{max(samples):>9.1f}ms{med / total_stage * 100:>8.1f}%")

    print("-" * 45)
    print(f"{'sum of stages':<16}{total_stage:>9.1f}ms")
    print(f"{'home() whole':<16}{statistics.median(whole):>9.1f}ms")
    print(
        "\nStages are timed individually and then home() as a whole. A whole\n"
        "materially larger than the sum means composition overhead; roughly\n"
        "equal means the stages are the cost.\n"
    )


if __name__ == "__main__":
    main()
