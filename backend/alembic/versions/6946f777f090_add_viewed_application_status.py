"""add 'viewed' application status

Adds a thirteenth pipeline stage, 'viewed': an automatic, passive signal
recorded when a user opens a job's detail pane, distinct from 'saved' (an
explicit bookmark action the user already had a button for). No existing rows
change status — this only widens the CHECK constraint so the new value can be
written. See app/models/application.py's APPLICATION_STATUSES for the
lifecycle note.

Revision ID: 6946f777f090
Revises: 4c4b035fadfd
Create Date: 2026-09-26 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = '6946f777f090'
down_revision: Union[str, None] = '4c4b035fadfd'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_STATUS_CHECK = (
    "status IN ("
    "'viewed', 'saved', 'applied', 'recruiter_contacted', 'recruiter_screening', "
    "'online_assessment', 'technical_interview', 'manager_interview', "
    "'final_interview', 'offer', 'accepted', 'rejected', 'withdrawn'"
    ")"
)
OLD_STATUS_CHECK = (
    "status IN ("
    "'saved', 'applied', 'recruiter_contacted', 'recruiter_screening', "
    "'online_assessment', 'technical_interview', 'manager_interview', "
    "'final_interview', 'offer', 'accepted', 'rejected', 'withdrawn'"
    ")"
)


def upgrade() -> None:
    with op.batch_alter_table("job_applications") as batch:
        batch.drop_constraint("ck_job_applications_status", type_="check")
        batch.create_check_constraint("ck_job_applications_status", NEW_STATUS_CHECK)


def downgrade() -> None:
    # Best-effort: any row that reached 'viewed' and was never touched again
    # collapses to 'saved', the nearest pre-existing "not yet applied" stage.
    op.execute("UPDATE job_applications SET status = 'saved' WHERE status = 'viewed'")

    with op.batch_alter_table("job_applications") as batch:
        batch.drop_constraint("ck_job_applications_status", type_="check")
        batch.create_check_constraint("ck_job_applications_status", OLD_STATUS_CHECK)
