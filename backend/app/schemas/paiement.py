from datetime import datetime

from pydantic import BaseModel

from app.models.paiement import MoyenPaiement, StatutPaiement


class PaiementPresentielRequest(BaseModel):
    commande_id: str
    moyen: MoyenPaiement
    montant: float


class PaiementOut(BaseModel):
    id: str
    commande_id: str
    montant: float
    devise: str
    moyen: MoyenPaiement
    statut: StatutPaiement
    created_at: datetime

    model_config = {"from_attributes": True}
