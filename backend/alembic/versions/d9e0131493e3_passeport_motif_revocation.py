"""ajout motif_revocation sur passeport

Revision ID: d9e0131493e3
Revises: 20f6783ce4d2
Create Date: 2026-09-22 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'd9e0131493e3'
down_revision: Union[str, None] = '20f6783ce4d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('passeports', sa.Column('motif_revocation', sa.String(length=500), nullable=True))


def downgrade() -> None:
    op.drop_column('passeports', 'motif_revocation')
