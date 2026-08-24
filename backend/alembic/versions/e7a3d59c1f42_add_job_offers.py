"""add job_offers comparison table

Backing store for /offers — see app/models/offer.py.

Money is NUMERIC(12,2), not float: these values are summed into a total the
user compares competing offers on, and binary floating point accumulates
representation error across additions.

application_id is INTEGER because job_applications.id is an integer primary
key. ON DELETE SET NULL rather than CASCADE — removing a pipeline card should
not destroy the offer attached to it.

Deny-by-default RLS, consistent with every other table: the frontend never
reaches PostgREST, it calls this backend, which verifies the Supabase JWT and
connects as the service role.

Revision ID: e7a3d59c1f42
Revises: c9f4e21b7d83
Create Date: 2026-08-21 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e7a3d59c1f42'
down_revision: Union[str, None] = 'c9f4e21b7d83'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    is_postgres = op.get_bind().dialect.name == "postgresql"
    uuid_type = sa.dialects.postgresql.UUID(as_uuid=False) if is_postgres else sa.String(36)

    op.create_table(
        "job_offers",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", uuid_type, nullable=False),
        sa.Column("application_id", sa.Integer(), nullable=True),
        sa.Column("company", sa.String(), nullable=False),
        sa.Column("role_title", sa.String(), nullable=False),
        sa.Column("base_salary", sa.Numeric(12, 2), server_default="0", nullable=False),
        sa.Column("annual_bonus", sa.Numeric(12, 2), server_default="0", nullable=False),
        sa.Column("signing_bonus", sa.Numeric(12, 2), server_default="0", nullable=False),
        sa.Column("equity_value_annual", sa.Numeric(12, 2), server_default="0", nullable=False),
        sa.Column("location", sa.String(), nullable=True),
        sa.Column("is_remote", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.ForeignKeyConstraint(
            ["application_id"], ["job_applications.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_job_offers_id", "job_offers", ["id"])
    op.create_index("ix_job_offers_user_id", "job_offers", ["user_id"])

    if not is_postgres:
        return
    op.execute(
        "ALTER TABLE public.job_offers "
        "ADD CONSTRAINT fk_job_offers_user "
        "FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE"
    )
    op.execute("ALTER TABLE public.job_offers ENABLE ROW LEVEL SECURITY")
    op.execute("REVOKE ALL ON TABLE public.job_offers FROM anon, authenticated")


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE public.job_offers DISABLE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE public.job_offers DROP CONSTRAINT IF EXISTS fk_job_offers_user")

    op.drop_index("ix_job_offers_user_id", table_name="job_offers")
    op.drop_index("ix_job_offers_id", table_name="job_offers")
    op.drop_table("job_offers")
