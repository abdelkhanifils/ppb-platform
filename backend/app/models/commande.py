from sqlalchemy import ForeignKey, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column
import enum

from app.db.base import Base, TimestampMixin, new_uuid, str_enum


class ModeImpression(str, enum.Enum):
    CENTRALISEE = "centralisee"
    DECENTRALISEE = "decentralisee"


class VersionLinguistique(str, enum.Enum):
    FR_EN = "FR/EN"
    FR_AR = "FR/AR"


class StatutCommande(str, enum.Enum):
    BROUILLON = "brouillon"
    EN_ATTENTE_PAIEMENT = "en_attente_paiement"
    PAYEE = "payee"
    EXPIREE = "expiree"
    ANNULEE = "annulee"


class Commande(TimestampMixin, Base):
    """Commande de PPB passée par un Ministère de l'Élevage (Module 1)."""

    __tablename__ = "commandes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    pays_id: Mapped[int] = mapped_column(ForeignKey("pays.id"), nullable=False)
    quantite: Mapped[int] = mapped_column(Integer, nullable=False)  # bornes 50-10000, cf. Parametre
    langue_version: Mapped[VersionLinguistique] = mapped_column(str_enum(VersionLinguistique, "version_ling_enum"))
    mode_impression: Mapped[ModeImpression] = mapped_column(str_enum(ModeImpression, "mode_impr_enum"))
    montant_total: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False)
    statut: Mapped[StatutCommande] = mapped_column(
        str_enum(StatutCommande, "statut_commande_enum"), default=StatutCommande.BROUILLON
    )
    responsable_nom: Mapped[str] = mapped_column(String(255), nullable=False)
    cree_par_id: Mapped[str] = mapped_column(ForeignKey("utilisateurs.id"), nullable=False)
