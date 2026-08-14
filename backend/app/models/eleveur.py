from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, new_uuid
from app.models.numerisation import JSON_TYPE


class Eleveur(TimestampMixin, Base):
    """Identité et coordonnées du propriétaire — créée depuis la Numerisation page 3 (Module 4)."""

    __tablename__ = "eleveurs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    passeport_id: Mapped[str] = mapped_column(ForeignKey("passeports.id"), unique=True, nullable=False)
    # Champs structurels figés (whitelist, jamais pilotés par la config dynamique)
    nom_prenom: Mapped[str] = mapped_column(String(255), nullable=False)
    numero_cni: Mapped[str] = mapped_column(String(50), nullable=False)
    telephone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    # Champs métier pilotés par DefinitionChamp (Module Administration)
    donnees_dynamiques: Mapped[dict] = mapped_column(JSON_TYPE, default=dict)
    date_enregistrement: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now())
