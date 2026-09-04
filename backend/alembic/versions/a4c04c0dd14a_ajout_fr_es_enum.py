"""ajout FR/ES a version_ling_enum

Revision ID: a4c04c0dd14a
Revises: 264d0d6bd41f
Create Date: 2026-09-04 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = 'a4c04c0dd14a'
down_revision: Union[str, None] = '264d0d6bd41f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # PostgreSQL interdit ALTER TYPE ... ADD VALUE à l'intérieur d'une
    # transaction (avant PG 12, et même au-delà dans certains contextes) —
    # Alembic exécute chaque migration dans une transaction par défaut.
    # `autocommit_block()` en sort le temps de cette instruction précise,
    # sans affecter le reste de la migration.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE version_ling_enum ADD VALUE IF NOT EXISTS 'FR/ES'")


def downgrade() -> None:
    # PostgreSQL ne permet pas de retirer une valeur d'un type ENUM natif —
    # seule option : recréer le type sans elle, ce qui échouerait si la
    # moindre ligne existante l'utilise déjà. Assumé irréversible en
    # pratique (comme la plupart des ajouts de valeur d'enum) : aucune
    # tentative de recréation risquée ici.
    pass
