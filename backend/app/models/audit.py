"""
Piste d'audit — Document technique §6 « Sécurité transversale » :
« Journalisation immuable de toute opération sensible (attribution,
impression, contrôle, remboursement, configuration dynamique) ».

Immuabilité : aucune route UPDATE/DELETE n'est exposée sur cette table —
seule l'insertion est permise (voir app/services/audit.py).
"""
from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, new_uuid
from app.models.numerisation import JSON_TYPE


class PisteAudit(TimestampMixin, Base):
    __tablename__ = "piste_audit"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    utilisateur_id: Mapped[str] = mapped_column(ForeignKey("utilisateurs.id"), nullable=False)
    action: Mapped[str] = mapped_column(String(100), nullable=False)  # ex. "champ.ajoute", "parametre.modifie"
    entite: Mapped[str] = mapped_column(String(100), nullable=False)  # ex. "DefinitionChamp", "Parametre"
    entite_id: Mapped[str] = mapped_column(String(100), nullable=False)
    ancienne_valeur: Mapped[dict | None] = mapped_column(JSON_TYPE, nullable=True)
    nouvelle_valeur: Mapped[dict | None] = mapped_column(JSON_TYPE, nullable=True)
