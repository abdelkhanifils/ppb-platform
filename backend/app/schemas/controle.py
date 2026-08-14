from pydantic import BaseModel

from app.models.controle import ModeVerification, ResultatControle


class ControleCreate(BaseModel):
    passeport_id: str
    poste_id: str
    mode: ModeVerification
    latitude: float | None = None
    longitude: float | None = None


class ControleResultat(BaseModel):
    resultat: ResultatControle
    signature_valide: bool | None  # None si le passeport n'a pas été trouvé
    itineraire_disponible_localement: bool
    conforme_itineraire: bool | None
