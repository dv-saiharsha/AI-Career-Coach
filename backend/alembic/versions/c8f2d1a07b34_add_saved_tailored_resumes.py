"""add user-owned tailored resume copies

The API uses Firebase user IDs and owns all database access. This table is
portable across the local SQLite database and the GCP-hosted PostgreSQL
database; it has no dependency on an external auth schema.

Revision ID: c8f2d1a07b34
Revises: b4e1c2d3f501
Create Date: 2026-10-15 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "c8f2d1a07b34"
down_revision: Union[str, None] = "b4e1c2d3f501"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tailored_resumes",
        sa.Column("id", sa.Integer(), nullable=False),
        # text, like every user_id since c7e4a19d5b36 (Firebase uids).
        sa.Column("user_id", sa.Text(), nullable=False),
        sa.Column("source_analysis_id", sa.Integer(), nullable=True),
        sa.Column("job_id", sa.Integer(), nullable=True),
        sa.Column("job_title", sa.String(), nullable=False),
        sa.Column("company", sa.String(), nullable=True),
        sa.Column("job_description", sa.Text(), nullable=False),
        sa.Column("resume_filename", sa.String(), nullable=False),
        sa.Column("resume_text", sa.Text(), nullable=False),
        sa.Column("resume_content", sa.Text(), nullable=False),
        sa.Column("pdf_bytes", sa.LargeBinary(), nullable=False),
        sa.Column("score_before", sa.Float(), nullable=True),
        sa.Column("score_after", sa.Float(), nullable=True),
        sa.Column("details_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_tailored_resumes_id", "tailored_resumes", ["id"])
    op.create_index("ix_tailored_resumes_user_id", "tailored_resumes", ["user_id"])
    op.create_index("ix_tailored_resumes_source_analysis_id", "tailored_resumes", ["source_analysis_id"])
    op.create_index("ix_tailored_resumes_job_id", "tailored_resumes", ["job_id"])
    op.create_index(
        "ix_tailored_resumes_user_created", "tailored_resumes", ["user_id", "created_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_tailored_resumes_user_created", table_name="tailored_resumes")
    op.drop_index("ix_tailored_resumes_job_id", table_name="tailored_resumes")
    op.drop_index("ix_tailored_resumes_source_analysis_id", table_name="tailored_resumes")
    op.drop_index("ix_tailored_resumes_user_id", table_name="tailored_resumes")
    op.drop_index("ix_tailored_resumes_id", table_name="tailored_resumes")
    op.drop_table("tailored_resumes")