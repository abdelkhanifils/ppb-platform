"""ajout province localite sur poste

Revision ID: 0f75815d165b
Revises: 4e69d753a501
Create Date: 2026-09-09 17:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '0f75815d165b'
down_revision: Union[str, None] = '4e69d753a501'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('postes', sa.Column('province', sa.String(length=150), nullable=True))
    op.add_column('postes', sa.Column('localite', sa.String(length=150), nullable=True))


def downgrade() -> None:
    op.drop_column('postes', 'localite')
    op.drop_column('postes', 'province')
