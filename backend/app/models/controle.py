import enum

from sqlalchemy import Boolean, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, new_uuid, str_enum


class ModeVerification(str, enum.Enum):
    EN_LIGNE = "en_ligne"
    HORS_LIGNE = "hors_ligne"


class ResultatControle(str, enum.Enum):
    VALIDE = "valide"
    REFUSE = "refuse"
    A_VERIFIER = "a_verifier"  # itinéraire non encore synchronisé -> repli papier


class Controle(TimestampMixin, Base):
    """Vérification effectuée à un poste frontière (Module 5).

    La conformité au trajet n'est vérifiable que si l'itinéraire a déjà
    été synchronisé jusqu'à ce poste (itineraire_disponible_localement).
    """

    __tablename__ = "controles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    passeport_id: Mapped[str] = mapped_column(ForeignKey("passeports.id"), nullable=False)
    poste_id: Mapped[str] = mapped_column(String(100), nullable=False)
    agent_id: Mapped[str] = mapped_column(ForeignKey("utilisateurs.id"), nullable=False)
    resultat: Mapped[ResultatControle] = mapped_column(str_enum(ResultatControle, "resultat_controle_enum"))
    itineraire_disponible_localement: Mapped[bool] = mapped_column(Boolean, default=False)
    conforme_itineraire: Mapped[bool | None] = mapped_column(Boolean, nullable=True)  # None = indéterminé
    mode: Mapped[ModeVerification] = mapped_column(str_enum(ModeVerification, "mode_verif_enum"))
    latitude: Mapped[float | None] = mapped_column(Numeric(9, 6), nullable=True)
    longitude: Mapped[float | None] = mapped_column(Numeric(9, 6), nullable=True)
    # Motif saisi par l'agent — obligatoire uniquement quand le garde-fou
    # anti-réutilisation l'exige (voir app.api.v1.endpoints.controles::
    # enregistrer_controle et ControleResultat.motif_requis) : un même poste
    # ayant déjà scanné ce PPB il y a au moins 10 minutes. En-deçà de ce
    # délai, un simple avertissement suffit (voir ControleResultat.nb_scans_ce_poste),
    # sans saisie obligatoire — reste `None` dans ce cas comme dans le cas
    # normal (premier scan à ce poste).
    motif: Mapped[str | None] = mapped_column(String(500), nullable=True)
