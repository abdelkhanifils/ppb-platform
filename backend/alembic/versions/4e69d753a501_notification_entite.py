"""ajout entite entite_id sur notification

Revision ID: 4e69d753a501
Revises: 3586f29a9966
Create Date: 2026-09-06 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '4e69d753a501'
down_revision: Union[str, None] = '3586f29a9966'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('notifications', sa.Column('entite', sa.String(length=50), nullable=True))
    op.add_column('notifications', sa.Column('entite_id', sa.String(length=36), nullable=True))
    op.create_index(op.f('ix_notifications_entite'), 'notifications', ['entite'])
    op.create_index(op.f('ix_notifications_entite_id'), 'notifications', ['entite_id'])


def downgrade() -> None:
    op.drop_index(op.f('ix_notifications_entite_id'), table_name='notifications')
    op.drop_index(op.f('ix_notifications_entite'), table_name='notifications')
    op.drop_column('notifications', 'entite_id')
    op.drop_column('notifications', 'entite')
