"""poste localite_id au lieu de province/localite texte

Revision ID: 20f6783ce4d2
Revises: d5a3ca258753
Create Date: 2026-09-17 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '20f6783ce4d2'
down_revision: Union[str, None] = 'd5a3ca258753'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('postes', sa.Column('localite_id', sa.String(length=36), nullable=True))
    op.create_foreign_key('fk_postes_localite_id', 'postes', 'localites', ['localite_id'], ['id'])

    # Reprend chaque poste dont la localité (texte libre, ancien design) a
    # une correspondance dans le référentiel Localités — comparaison
    # normalisée (casse, espaces superflus), même raisonnement que la
    # dérivation à la volée qu'elle remplace (voir l'historique de
    # app/api/v1/endpoints/postes.py). Un poste sans correspondance garde
    # `localite_id` à NULL — jamais rattaché à une localité au hasard.
    op.execute(
        """
        UPDATE postes
        SET localite_id = localites.id
        FROM localites
        WHERE postes.pays_id = localites.pays_id
          AND postes.localite IS NOT NULL
          AND TRIM(LOWER(postes.localite)) = TRIM(LOWER(localites.nom))
        """
    )

    op.drop_column('postes', 'province')
    op.drop_column('postes', 'localite')


def downgrade() -> None:
    op.add_column('postes', sa.Column('province', sa.String(length=150), nullable=True))
    op.add_column('postes', sa.Column('localite', sa.String(length=150), nullable=True))
    op.execute(
        """
        UPDATE postes
        SET localite = localites.nom, province = localites.province
        FROM localites
        WHERE postes.localite_id = localites.id
        """
    )
    op.drop_constraint('fk_postes_localite_id', 'postes', type_='foreignkey')
    op.drop_column('postes', 'localite_id')
