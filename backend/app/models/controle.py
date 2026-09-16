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


class TypeIncident(str, enum.Enum):
    """Irrégularités observables sur le terrain, indépendamment du résultat
    du contrôle lui-même (voir Controle.type_incident) — sert la
    traçabilité des agents d'émission peu scrupuleux (voir
    /controles/signalements). Liste fermée pour l'essentiel des cas réels
    rencontrés, avec AUTRE en repli pour un cas isolé non prévu ici."""

    CHEPTEL_SUPERIEUR_CAPACITE = "cheptel_superieur_capacite"  # ex. 100 têtes présentées, un seul passeport (max 50) au lieu de deux
    NOMBRE_ANIMAUX_NE_CORRESPOND_PAS = "nombre_animaux_ne_correspond_pas"  # troupeau présenté plus petit OU plus grand que la déclaration, sans dépasser la capacité d'un passeport
    ESPECE_NE_CORRESPOND_PAS = "espece_ne_correspond_pas"  # ex. bovins déclarés, ovins présentés
    IDENTITE_DOUTEUSE = "identite_douteuse"  # éleveur/convoyeur présent ne semble pas être la personne déclarée sur le passeport
    PIECE_IDENTITE_ABSENTE = "piece_identite_absente"  # CNI de l'éleveur/convoyeur absente ou illisible sur place
    ITINERAIRE_NON_RESPECTE = "itineraire_non_respecte"  # trajet réellement suivi différent de l'origine/destination déclarée
    DOCUMENT_ALTERE = "document_altere"  # rature, grattage, ajout manuscrit suspect après impression
    VACCINATION_SUSPECTE = "vaccination_suspecte"  # dates de vaccination manquantes, incohérentes ou visiblement falsifiées
    DEJA_PRESENTE_AILLEURS = "deja_presente_ailleurs"  # doute que ce même document ait déjà servi pour un autre passage
    AUTRE = "autre"  # cas isolé, non couvert ci-dessus — details_incident alors obligatoire côté frontend


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
    # Signalement d'incident — TOUJOURS facultatif, quel que soit le
    # résultat du contrôle (voir enregistrer_controle) : un passeport
    # authentique et conforme peut malgré tout révéler une irrégularité sur
    # le terrain (cheptel réel différent de la déclaration, trajet non
    # respecté...), tout comme un passeport refusé pour une autre raison.
    # Jamais bloquant pour la validation elle-même — ce champ ne fait que
    # s'ajouter au résultat déjà déterminé, sans jamais le modifier. Sert la
    # traçabilité "retrouver l'agent d'émission" : un Controle remonte à son
    # Passeport, dont les Numerisation.agent_id/poste_code (page 4)
    # identifient qui a émis ce document et où (voir
    # /passeports/emissions-detail et /controles/signalements).
    type_incident: Mapped[TypeIncident | None] = mapped_column(str_enum(TypeIncident, "type_incident_enum"), nullable=True)
    # Toujours renseigné pour type_incident="autre" (cas isolé, texte libre)
    # — facultatif pour les autres types, en complément si l'agent veut
    # préciser (ex. le nombre réel constaté sur le terrain).
    details_incident: Mapped[str | None] = mapped_column(String(500), nullable=True)
