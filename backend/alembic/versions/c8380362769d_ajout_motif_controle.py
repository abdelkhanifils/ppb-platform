"""ajout motif a controles

Revision ID: c8380362769d
Revises: a4c04c0dd14a
Create Date: 2026-09-04 11:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'c8380362769d'
down_revision: Union[str, None] = 'a4c04c0dd14a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('controles', sa.Column('motif', sa.String(length=500), nullable=True))


def downgrade() -> None:
    op.drop_column('controles', 'motif')
