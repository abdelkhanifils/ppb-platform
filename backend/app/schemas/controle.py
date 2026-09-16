from pydantic import BaseModel

from app.models.controle import ModeVerification, ResultatControle, TypeIncident


class ControleCreate(BaseModel):
    # Exactement l'un des deux, jamais aucun — voir enregistrer_controle
    # pour la validation. `qr_uuid` permet d'enregistrer un contrôle pour un
    # passeport dont l'authenticité a été vérifiée hors-ligne par sa
    # signature embarquée dans le QR (voir backend/app/services/
    # qrcode_service.py) mais qui n'a jamais été synchronisé sur cet
    # appareil — l'agent ne connaît alors pas son identifiant interne
    # (Passeport.id), seulement son qr_uuid, présent dans le QR lui-même.
    passeport_id: str | None = None
    qr_uuid: str | None = None
    poste_id: str
    mode: ModeVerification
    latitude: float | None = None
    longitude: float | None = None
    # Voir ControleResultat.motif_requis — fourni par l'agent uniquement
    # quand le garde-fou l'exige, sinon absent. L'API n'impose pas sa
    # présence ici : le blocage réel se fait côté frontend (l'agent ne peut
    # pas valider sans le saisir quand motif_requis est vrai) — voir la
    # docstring d'enregistrer_controle pour la raison de ce choix.
    motif: str | None = None
    # Signalement d'incident — TOUJOURS facultatif, quel que soit
    # `resultat` (voir Controle.type_incident) : jamais un frein à
    # l'enregistrement du contrôle lui-même, seulement une information
    # complémentaire pour la traçabilité des agents d'émission.
    type_incident: TypeIncident | None = None
    details_incident: str | None = None


class SignalerIncidentRequest(BaseModel):
    # `None` efface un signalement déjà posé par erreur — jamais une valeur
    # obligatoire, cohérent avec le caractère facultatif de cette
    # fonctionnalité tout au long de son parcours.
    type_incident: TypeIncident | None = None
    details_incident: str | None = None


class HistoriqueControle(BaseModel):
    poste_id: str
    resultat: ResultatControle
    date: str  # ISO 8601


class ControleResultat(BaseModel):
    # `None` uniquement pour une simple consultation de l'historique (voir
    # historique_pour_garde_fou), qui ne crée jamais de Controle — dans ce
    # cas, aucun signalement n'est possible tant qu'un contrôle réel n'a
    # pas été enregistré.
    controle_id: str | None
    resultat: ResultatControle
    signature_valide: bool | None  # None si le passeport n'a pas été trouvé
    itineraire_disponible_localement: bool
    conforme_itineraire: bool | None
    # Garde-fou anti-réutilisation (voir enregistrer_controle) — un PPB
    # passe légitimement par PLUSIEURS postes le long de son trajet déclaré,
    # ce n'est donc jamais un blocage automatique pur : l'agent voit
    # l'historique complet et reste décisionnaire pour tout re-scan récent
    # au même poste. Seul le cas d'un re-scan tardif (>= 10 min depuis le
    # dernier scan à CE MÊME poste) impose une saisie de motif avant de
    # pouvoir valider — un intervalle aussi long au même endroit suggère un
    # document réutilisé pour un passage distinct, pas une simple répétition
    # de scan technique.
    historique_controles: list[HistoriqueControle]
    deja_valide_a_ce_poste: bool
    nb_scans_ce_poste: int
    minutes_depuis_dernier_scan_ce_poste: float | None
    motif_requis: bool
