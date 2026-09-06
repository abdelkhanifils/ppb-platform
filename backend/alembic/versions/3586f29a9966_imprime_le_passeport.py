"""ajout imprime_le sur passeport

Revision ID: 3586f29a9966
Revises: 2a744ca1478e
Create Date: 2026-09-06 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '3586f29a9966'
down_revision: Union[str, None] = '2a744ca1478e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('passeports', sa.Column('imprime_le', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('passeports', 'imprime_le')
