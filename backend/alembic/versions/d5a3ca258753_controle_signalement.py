"""ajout signalement incident sur controle

Revision ID: d5a3ca258753
Revises: 47c24c5fd719
Create Date: 2026-09-16 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'd5a3ca258753'
down_revision: Union[str, None] = '47c24c5fd719'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TYPE_INCIDENT_VALEURS = (
    'cheptel_superieur_capacite',
    'nombre_animaux_ne_correspond_pas',
    'espece_ne_correspond_pas',
    'identite_douteuse',
    'piece_identite_absente',
    'itineraire_non_respecte',
    'document_altere',
    'vaccination_suspecte',
    'deja_presente_ailleurs',
    'autre',
)


def upgrade() -> None:
    type_incident_enum = sa.Enum(*TYPE_INCIDENT_VALEURS, name='type_incident_enum')
    type_incident_enum.create(op.get_bind())
    op.add_column('controles', sa.Column('type_incident', type_incident_enum, nullable=True))
    op.add_column('controles', sa.Column('details_incident', sa.String(length=500), nullable=True))


def downgrade() -> None:
    op.drop_column('controles', 'details_incident')
    op.drop_column('controles', 'type_incident')
    sa.Enum(name='type_incident_enum').drop(op.get_bind())
