"""itineraire pays optionnels et saisie libre

Revision ID: ecef5cd7e5b2
Revises: c8380362769d
Create Date: 2026-09-05 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'ecef5cd7e5b2'
down_revision: Union[str, None] = 'c8380362769d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('itineraires', 'pays_origine_id', existing_type=sa.Integer(), nullable=True)
    op.alter_column('itineraires', 'pays_destination_id', existing_type=sa.Integer(), nullable=True)
    op.add_column('itineraires', sa.Column('pays_origine_autre', sa.String(length=255), nullable=True))
    op.add_column('itineraires', sa.Column('pays_destination_autre', sa.String(length=255), nullable=True))


def downgrade() -> None:
    # Irréversible en pratique si des lignes utilisent déjà *_autre (un pays
    # non-CEMAC n'a pas d'id valide à leur substituer) — pas de tentative de
    # ré-imposer NOT NULL ici, cohérent avec la politique du projet pour ce
    # type de changement (voir downgrade() de la migration FR/ES).
    op.drop_column('itineraires', 'pays_destination_autre')
    op.drop_column('itineraires', 'pays_origine_autre')
