"""add voice_metrics to interview_answers

Purely additive: one nullable JSON-text column, holding whichever of
speaking_duration_seconds / average_confidence / speaking_rate_wpm /
long_pause_count / filler_word_count Deepgram's response could support for
that answer (see interview_coach/voice.py). Null for every existing row and
for every typed answer going forward — nothing about the evaluation
pipeline or any other column changes.

Revision ID: 9a95c3ae4c54
Revises: 992a070f86cb
Create Date: 2026-08-29 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '9a95c3ae4c54'
down_revision: Union[str, None] = '992a070f86cb'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("interview_answers") as batch:
        batch.add_column(sa.Column("voice_metrics", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("interview_answers") as batch:
        batch.drop_column("voice_metrics")
