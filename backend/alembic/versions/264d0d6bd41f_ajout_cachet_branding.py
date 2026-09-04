"""ajout cachet a branding

Revision ID: 264d0d6bd41f
Revises: 3184bce736e9
Create Date: 2026-09-02 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '264d0d6bd41f'
down_revision: Union[str, None] = '3184bce736e9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('branding', sa.Column('cachet_bytes', sa.LargeBinary(), nullable=True))
    op.add_column('branding', sa.Column('cachet_content_type', sa.String(length=50), nullable=True))


def downgrade() -> None:
    op.drop_column('branding', 'cachet_content_type')
    op.drop_column('branding', 'cachet_bytes')
