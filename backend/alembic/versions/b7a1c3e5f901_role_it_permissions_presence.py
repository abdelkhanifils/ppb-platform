"""role IT, table permissions_roles, derniere_activite

Revision ID: b7a1c3e5f901
Revises: d9e0131493e3
Create Date: 2026-10-27 17:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'b7a1c3e5f901'
down_revision: Union[str, None] = 'd9e0131493e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ALTER TYPE ... ADD VALUE doit s'exécuter hors transaction (voir a4c04c0dd14a).
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE role_enum ADD VALUE IF NOT EXISTS 'it'")

    op.add_column('utilisateurs', sa.Column('derniere_activite', sa.DateTime(timezone=True), nullable=True))
    op.create_table(
        'permissions_roles',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('role', postgresql.ENUM(name='role_enum', create_type=False), nullable=False),
        sa.Column('code', sa.String(64), nullable=False),
        sa.Column('autorise', sa.Boolean(), nullable=False),
        sa.Column('cree_le', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('modifie_le', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint('role', 'code', name='uq_permissions_roles_role_code'),
    )
    op.create_index('ix_permissions_roles_role', 'permissions_roles', ['role'])


def downgrade() -> None:
    op.drop_index('ix_permissions_roles_role', table_name='permissions_roles')
    op.drop_table('permissions_roles')
    op.drop_column('utilisateurs', 'derniere_activite')
