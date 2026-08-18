import secrets
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum as SAEnum, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    """Horodatage systématique — utile à la piste d'audit (Document technique §6)."""

    cree_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    modifie_le: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


def new_uuid() -> str:
    return str(uuid.uuid4())


# Alphabet volontairement restreint pour un code de vérification lu/comparé
# à l'œil (voir Passeport.code_verification) : ni 0/O, ni 1/I/L — ambigus à
# l'écrit comme à l'écran, une source d'erreur inutile pour un agent
# fatigué à un poste frontière.
_ALPHABET_CODE_VERIFICATION = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"


def nouveau_code_verification(longueur: int = 6) -> str:
    return "".join(secrets.choice(_ALPHABET_CODE_VERIFICATION) for _ in range(longueur))


def str_enum(enum_cls, name: str) -> SAEnum:
    """Colonne Enum qui stocke `.value` (ex. "centralisee") et non `.name` (ex.
    "CENTRALISEE") — le comportement par défaut de SQLAlchemy stocke le nom du
    membre, ce qui désynchronise silencieusement la base des valeurs sérialisées
    par l'API pour tous nos enums `(str, enum.Enum)`. À utiliser pour CHAQUE
    colonne Enum du modèle, systématiquement, plutôt que `sqlalchemy.Enum(...)`
    directement."""
    return SAEnum(enum_cls, name=name, values_callable=lambda obj: [e.value for e in obj])
