"""table notifications

Revision ID: 3184bce736e9
Revises: 9041ebe84083
Create Date: 2026-09-01 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '3184bce736e9'
down_revision: Union[str, None] = '9041ebe84083'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('notifications',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('utilisateur_id', sa.String(length=36), nullable=False),
    sa.Column('titre', sa.String(length=255), nullable=False),
    sa.Column('message', sa.String(length=1000), nullable=False),
    sa.Column('lien', sa.String(length=255), nullable=True),
    sa.Column('lu', sa.Boolean(), nullable=False),
    sa.Column('cree_le', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('modifie_le', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['utilisateur_id'], ['utilisateurs.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_notifications_utilisateur_id'), 'notifications', ['utilisateur_id'], unique=False)
    op.create_index(op.f('ix_notifications_lu'), 'notifications', ['lu'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_notifications_lu'), table_name='notifications')
    op.drop_index(op.f('ix_notifications_utilisateur_id'), table_name='notifications')
    op.drop_table('notifications')
