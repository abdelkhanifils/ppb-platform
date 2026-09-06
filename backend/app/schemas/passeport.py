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
