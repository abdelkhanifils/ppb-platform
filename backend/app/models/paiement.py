import enum

from sqlalchemy import ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, new_uuid, str_enum


class MoyenPaiement(str, enum.Enum):
    MOBILE_MONEY = "mobile_money"
    CARTE_BANCAIRE = "carte_bancaire"
    VIREMENT = "virement"
    ESPECES = "especes"
    CHEQUE = "cheque"


class StatutPaiement(str, enum.Enum):
    INITIE = "initie"
    EN_ATTENTE_VALIDATION = "en_attente_validation"  # présentiel/virement, avant validation agent
    VALIDE = "valide"
    ECHOUE = "echoue"
    REMBOURSE = "rembourse"


class Paiement(TimestampMixin, Base):
    """Transaction associée à une commande (Module 2). Paiement en ligne (PSP)
    retiré pour l'instant — voir app/api/v1/endpoints/paiements.py — seuls le
    présentiel et le virement sont actifs, d'où l'absence de colonnes
    spécifiques à un prestataire de paiement en ligne."""

    __tablename__ = "paiements"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    commande_id: Mapped[str] = mapped_column(ForeignKey("commandes.id"), nullable=False)
    montant: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False)
    devise: Mapped[str] = mapped_column(String(3), default="XAF")
    moyen: Mapped[MoyenPaiement] = mapped_column(str_enum(MoyenPaiement, "moyen_paiement_enum"))
    statut: Mapped[StatutPaiement] = mapped_column(
        str_enum(StatutPaiement, "statut_paiement_enum"), default=StatutPaiement.INITIE
    )
    idempotency_key: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    valide_par_id: Mapped[str | None] = mapped_column(ForeignKey("utilisateurs.id"), nullable=True)  # présentiel
