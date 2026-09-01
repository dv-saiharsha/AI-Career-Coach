"""expand application pipeline to 12 stages, add status history

Milestone 8 — the Intelligent Application Tracker. Two changes:

1. job_applications.status grows from 5 stages (saved/applied/interviewing/
   offer/rejected) to 12, splitting the old catch-all 'interviewing' into
   the real shape of a hiring pipeline (recruiter contact through final
   round) and adding two terminal states (accepted/withdrawn) the old
   scheme had no room for. Existing 'interviewing' rows are remapped to
   'recruiter_screening' — the least presumptuous read of "somewhere in the
   interview process" available, since the old scheme never recorded which
   round was reached. recruiter_name/recruiter_email are new, both nullable.

2. A new application_status_history table — one row per status change,
   timestamped, which is what the Timeline view and the cross-application
   activity feed both render. Every existing application is backfilled with
   one synthetic "arrival" row (from_status=NULL, to_status=<current
   status>, changed_at=<the application's own created_at>) so the Timeline
   is never empty for pre-existing data — this records where an application
   started, as far as it's known, not a fabricated status change.

Revision ID: 23061ee9a125
Revises: 9a95c3ae4c54
Create Date: 2026-08-30 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '23061ee9a125'
down_revision: Union[str, None] = '9a95c3ae4c54'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_STATUS_CHECK = (
    "status IN ("
    "'saved', 'applied', 'recruiter_contacted', 'recruiter_screening', "
    "'online_assessment', 'technical_interview', 'manager_interview', "
    "'final_interview', 'offer', 'accepted', 'rejected', 'withdrawn'"
    ")"
)
OLD_STATUS_CHECK = "status IN ('saved', 'applied', 'interviewing', 'offer', 'rejected')"


def upgrade() -> None:
    is_postgres = op.get_bind().dialect.name == "postgresql"

    with op.batch_alter_table("job_applications") as batch:
        batch.add_column(sa.Column("recruiter_name", sa.String(), nullable=True))
        batch.add_column(sa.Column("recruiter_email", sa.String(), nullable=True))
        batch.drop_constraint("ck_job_applications_status", type_="check")

    op.execute("UPDATE job_applications SET status = 'recruiter_screening' WHERE status = 'interviewing'")

    with op.batch_alter_table("job_applications") as batch:
        batch.create_check_constraint("ck_job_applications_status", NEW_STATUS_CHECK)

    op.create_table(
        "application_status_history",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "application_id",
            sa.Integer(),
            sa.ForeignKey("job_applications.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("from_status", sa.String(), nullable=True),
        sa.Column("to_status", sa.String(), nullable=False),
        sa.Column("changed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(
        "ix_application_status_history_application_id", "application_status_history", ["application_id"]
    )

    op.execute(
        "INSERT INTO application_status_history (application_id, from_status, to_status, changed_at) "
        "SELECT id, NULL, status, created_at FROM job_applications"
    )

    if not is_postgres:
        return
    op.execute("ALTER TABLE public.application_status_history ENABLE ROW LEVEL SECURITY")
    op.execute("REVOKE ALL ON TABLE public.application_status_history FROM anon, authenticated")


def downgrade() -> None:
    is_postgres = op.get_bind().dialect.name == "postgresql"
    if is_postgres:
        op.execute("ALTER TABLE public.application_status_history DISABLE ROW LEVEL SECURITY")

    op.drop_index("ix_application_status_history_application_id", table_name="application_status_history")
    op.drop_table("application_status_history")

    with op.batch_alter_table("job_applications") as batch:
        batch.drop_constraint("ck_job_applications_status", type_="check")

    # Best-effort reverse remap. Rows that moved into a stage the old scheme
    # never had (online_assessment, manager_interview, ...) collapse to
    # 'interviewing' — lossy in the same disclosed way the forward migration
    # was, not a silent data change.
    op.execute(
        "UPDATE job_applications SET status = 'interviewing' WHERE status IN ("
        "'recruiter_contacted', 'recruiter_screening', 'online_assessment', "
        "'technical_interview', 'manager_interview', 'final_interview'"
        ")"
    )
    op.execute("UPDATE job_applications SET status = 'offer' WHERE status = 'accepted'")
    op.execute("UPDATE job_applications SET status = 'rejected' WHERE status = 'withdrawn'")

    with op.batch_alter_table("job_applications") as batch:
        batch.create_check_constraint("ck_job_applications_status", OLD_STATUS_CHECK)
        batch.drop_column("recruiter_email")
        batch.drop_column("recruiter_name")
