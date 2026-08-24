"""add job_applications pipeline table

Backing store for the /applications Kanban board — see app/models/application.py.

Deny-by-default RLS (enabled, no policies, grants revoked), matching every
other table. Worth stating why there are no `auth.uid() = user_id` policies
here even though this is per-user data: the frontend never talks to PostgREST.
It calls this FastAPI backend, which verifies the Supabase JWT itself
(app/core/deps.get_current_user) and connects over SQLAlchemy as the service
role. Adding permissive policies would grant nothing today and would imply
direct client access is a supported path, which it isn't. Ownership is
enforced in the query layer: every read and write filters on user_id from the
verified token, never from a request body or header.

Status is a CHECK-constrained TEXT column rather than a native enum so a new
stage doesn't need ALTER TYPE, and so the SQLite dev database still works.

Revision ID: c9f4e21b7d83
Revises: b6d2f84a1c93
Create Date: 2026-08-21 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c9f4e21b7d83'
down_revision: Union[str, None] = 'b6d2f84a1c93'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    is_postgres = op.get_bind().dialect.name == "postgresql"
    uuid_type = sa.dialects.postgresql.UUID(as_uuid=False) if is_postgres else sa.String(36)

    op.create_table(
        "job_applications",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", uuid_type, nullable=False),
        sa.Column("job_title", sa.String(), nullable=False),
        sa.Column("company", sa.String(), nullable=False),
        sa.Column("location", sa.String(), nullable=True),
        sa.Column("salary_range", sa.String(), nullable=True),
        sa.Column("status", sa.String(), server_default="saved", nullable=False),
        sa.Column("job_url", sa.Text(), nullable=True),
        sa.Column("job_description", sa.Text(), nullable=True),
        sa.Column("tailored_resume_id", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.CheckConstraint(
            "status IN ('saved', 'applied', 'interviewing', 'offer', 'rejected')",
            name="ck_job_applications_status",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_job_applications_id", "job_applications", ["id"])
    op.create_index("ix_job_applications_user_id", "job_applications", ["user_id"])
    # The board is only ever read as "this user's pipeline".
    op.create_index("ix_job_applications_user_status", "job_applications", ["user_id", "status"])

    if not is_postgres:
        return
    # FK to Supabase's auth schema, which isn't modelled in SQLAlchemy — same
    # approach as resume_analyses. ON DELETE CASCADE so deleting an account
    # takes its pipeline with it.
    op.execute(
        "ALTER TABLE public.job_applications "
        "ADD CONSTRAINT fk_job_applications_user "
        "FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE"
    )
    op.execute("ALTER TABLE public.job_applications ENABLE ROW LEVEL SECURITY")
    op.execute("REVOKE ALL ON TABLE public.job_applications FROM anon, authenticated")


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE public.job_applications DISABLE ROW LEVEL SECURITY")
        op.execute(
            "ALTER TABLE public.job_applications DROP CONSTRAINT IF EXISTS fk_job_applications_user"
        )

    op.drop_index("ix_job_applications_user_status", table_name="job_applications")
    op.drop_index("ix_job_applications_user_id", table_name="job_applications")
    op.drop_index("ix_job_applications_id", table_name="job_applications")
    op.drop_table("job_applications")
