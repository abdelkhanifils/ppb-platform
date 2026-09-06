from pydantic import BaseModel, Field


class AutorisationImpressionCreate(BaseModel):
    pays_id: int
    plage_debut: int = Field(ge=1)
    plage_fin: int
    gabarit_version: int = Field(ge=1)


class AutorisationImpressionOut(BaseModel):
    id: str
    pays_id: int
    plage_debut: int
    plage_fin: int
    gabarit_version: int
    active: bool

    model_config = {"from_attributes": True}


class DeclarerLotRequest(BaseModel):
    pays_id: int
    numero_debut: int = Field(ge=1)
    numero_fin: int


class ConfirmationImpressionRequest(BaseModel):
    """Voir app.api.v1.endpoints.passeports::confirmer_impression_lot —
    identifiants exacts du lot déjà généré et affiché à l'agent, jamais
    reconstruits côté serveur."""

    passeport_ids: list[str]
