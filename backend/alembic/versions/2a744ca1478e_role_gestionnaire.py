"""ajout role gestionnaire cebevirha

Revision ID: 2a744ca1478e
Revises: 92b5bbbea6b4
Create Date: 2026-09-05 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = '2a744ca1478e'
down_revision: Union[str, None] = '92b5bbbea6b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE role_enum ADD VALUE IF NOT EXISTS 'gestionnaire_cebevirha'")


def downgrade() -> None:
    pass
