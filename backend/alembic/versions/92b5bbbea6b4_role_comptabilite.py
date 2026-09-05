"""ajout role comptabilite

Revision ID: 92b5bbbea6b4
Revises: ecef5cd7e5b2
Create Date: 2026-09-05 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = '92b5bbbea6b4'
down_revision: Union[str, None] = 'ecef5cd7e5b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Voir migration a4c04c0dd14a (ajout FR/ES) pour le détail de cette
    # contrainte PostgreSQL (ALTER TYPE ... ADD VALUE hors transaction).
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE role_enum ADD VALUE IF NOT EXISTS 'comptabilite'")


def downgrade() -> None:
    # Irréversible en pratique si un utilisateur a déjà ce rôle — voir la
    # politique du projet pour ce type de changement (migrations FR/ES et
    # itineraire pays optionnels).
    pass
