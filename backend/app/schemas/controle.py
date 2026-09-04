from pydantic import BaseModel

from app.models.controle import ModeVerification, ResultatControle


class ControleCreate(BaseModel):
    passeport_id: str
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


class HistoriqueControle(BaseModel):
    poste_id: str
    resultat: ResultatControle
    date: str  # ISO 8601


class ControleResultat(BaseModel):
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
