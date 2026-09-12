"""ajout poste_code sur numerisation

Revision ID: 4be950408d46
Revises: 0f75815d165b
Create Date: 2026-09-12 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '4be950408d46'
down_revision: Union[str, None] = '0f75815d165b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('numerisations', sa.Column('poste_code', sa.String(length=100), nullable=True))


def downgrade() -> None:
    op.drop_column('numerisations', 'poste_code')
