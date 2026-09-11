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


class ConfirmerImpressionRequest(BaseModel):
    # Liste exacte reçue via l'en-tête X-Passeport-Ids d'une génération
    # précédente (voir document_impression_commande / document_impression_
    # pays) — jamais recalculée côté serveur à partir d'un pays/commande,
    # pour ne confirmer QUE ce que l'agent a réellement vu dans le PDF qu'il
    # vient d'ouvrir, pas un ensemble différent qui aurait pu changer entre
    # temps (nouvelle commande payée, etc.).
    passeport_ids: list[str] = Field(min_length=1)
