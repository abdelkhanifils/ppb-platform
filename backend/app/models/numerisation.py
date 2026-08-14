import enum

from sqlalchemy import ForeignKey, Integer, JSON, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, new_uuid, str_enum

# JSONB en production (PostgreSQL, indexable), JSON générique ailleurs (ex. SQLite
# en tests) — un seul type partagé par tous les modèles utilisant des données
# dynamiques (Numerisation, Eleveur, Convoyeur, DefinitionChamp, PisteAudit...).
JSON_TYPE = JSON().with_variant(JSONB(), "postgresql")


class StatutValidation(str, enum.Enum):
    EN_ATTENTE = "en_attente"
    VALIDEE = "validee"


class StatutSync(str, enum.Enum):
    LOCAL = "local"  # en file d'attente locale, hors-ligne
    SYNCHRONISEE = "synchronisee"


class Numerisation(TimestampMixin, Base):
    """Données validées d'une page de PPB rempli (1 à 4) — aucune image conservée."""

    __tablename__ = "numerisations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    passeport_id: Mapped[str] = mapped_column(ForeignKey("passeports.id"), nullable=False)
    page_num: Mapped[int] = mapped_column(Integer, nullable=False)  # 1 à 4
    donnees_json: Mapped[dict] = mapped_column(JSON_TYPE, nullable=True)  # None pour page 1 (vérif visuelle seule)
    statut_validation: Mapped[StatutValidation] = mapped_column(
        str_enum(StatutValidation, "statut_validation_enum"), default=StatutValidation.EN_ATTENTE
    )
    statut_sync: Mapped[StatutSync] = mapped_column(str_enum(StatutSync, "statut_sync_enum"), default=StatutSync.LOCAL)
    agent_id: Mapped[str] = mapped_column(ForeignKey("utilisateurs.id"), nullable=False)

    __table_args__ = (UniqueConstraint("passeport_id", "page_num", name="uq_numerisation_passeport_page"),)
