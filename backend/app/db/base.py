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


def str_enum(enum_cls, name: str) -> SAEnum:
    """Colonne Enum qui stocke `.value` (ex. "centralisee") et non `.name` (ex.
    "CENTRALISEE") — le comportement par défaut de SQLAlchemy stocke le nom du
    membre, ce qui désynchronise silencieusement la base des valeurs sérialisées
    par l'API pour tous nos enums `(str, enum.Enum)`. À utiliser pour CHAQUE
    colonne Enum du modèle, systématiquement, plutôt que `sqlalchemy.Enum(...)`
    directement."""
    return SAEnum(enum_cls, name=name, values_callable=lambda obj: [e.value for e in obj])
