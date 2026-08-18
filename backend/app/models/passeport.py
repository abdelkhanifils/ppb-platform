import enum
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, new_uuid, nouveau_code_verification, str_enum


class StatutPasseport(str, enum.Enum):
    """Cycle de vie du passeport — Document technique, section 2."""

    PRECHARGE = "precharge"  # attribution automatique après paiement confirmé (M3)
    VIERGE = "vierge"  # impression confirmée, centralisée ou déclarée localement (M3)
    EMIS = "emis"  # remplissage terrain + synchronisation numérisation (M4)
    CONTROLE = "controle"  # vérification effectuée à un poste frontière (M5)
    REVOQUE = "revoque"


class Passeport(TimestampMixin, Base):
    """Un exemplaire de PPB, identifié par Pays / Année / N° de lot."""

    __tablename__ = "passeports"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    commande_id: Mapped[str] = mapped_column(ForeignKey("commandes.id"), nullable=False)
    pays_id: Mapped[int] = mapped_column(ForeignKey("pays.id"), nullable=False)
    numero_pays: Mapped[str] = mapped_column(String(2), nullable=False)  # 01-06, ordre alphabétique
    numero_annee: Mapped[str] = mapped_column(String(4), nullable=False)
    numero_lot: Mapped[str] = mapped_column(String(7), nullable=False)  # 7 chiffres
    qr_uuid: Mapped[str] = mapped_column(String(36), unique=True, nullable=False, default=new_uuid)
    # Code court affiché à l'écran de l'agent de contrôle après un scan
    # réussi — à comparer VISUELLEMENT avec ce qui est imprimé sur le
    # papier (voir pdf_passeport.py, page 2, à côté du QR Code). Protège
    # contre un scénario que la seule signature ne couvre pas : un QR Code
    # authentique recopié/photographié puis apposé sur un document
    # entièrement fabriqué — la signature resterait valide (elle porte sur
    # le passeport en base, pas sur le papier physique), mais le
    # faussaire n'aurait aucun moyen de connaître ce code à l'avance pour
    # l'imprimer correctement, sauf à disposer du document authentique
    # complet (auquel cas on retombe sur un problème de sécurité physique
    # du papier, pas numérique — voir la discussion filigrane/guilloché).
    code_verification: Mapped[str] = mapped_column(String(10), nullable=False, default=nouveau_code_verification)
    hash_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    signature: Mapped[str] = mapped_column(String(512), nullable=False)  # RSA-2048 / ECDSA P-256
    gabarit_version: Mapped[int] = mapped_column(Integer, nullable=False)  # fige la version FR/EN ou FR/AR
    statut: Mapped[StatutPasseport] = mapped_column(
        str_enum(StatutPasseport, "statut_passeport_enum"), default=StatutPasseport.PRECHARGE
    )
    # Horodatage de publication vers l'index de vérification (Module 5) — voir
    # app.services.attribution.publier_passeports. None tant que le passeport
    # n'a pas encore été rendu visible à la synchronisation différentielle.
    publie_le: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint("pays_id", "numero_annee", "numero_lot", name="uq_passeport_pays_annee_lot"),
    )


class CompteurNumerotation(Base):
    """Compteur atomique du dernier numéro de lot attribué, par (pays, année).

    Table dédiée plutôt qu'un `MAX(numero_lot)` recalculé à chaque attribution :
    verrouillable ligne par ligne (`SELECT ... FOR UPDATE`) pour garantir
    qu'aucune plage n'est distribuée deux fois lors d'attributions concurrentes.
    """

    __tablename__ = "compteurs_numerotation"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    pays_id: Mapped[int] = mapped_column(ForeignKey("pays.id"), nullable=False)
    annee: Mapped[str] = mapped_column(String(4), nullable=False)
    dernier_numero: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    __table_args__ = (UniqueConstraint("pays_id", "annee", name="uq_compteur_pays_annee"),)
