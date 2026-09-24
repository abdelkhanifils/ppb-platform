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


class RevoquerPasseportsRequest(BaseModel):
    """Retrait du circuit d'un ou plusieurs passeports — Super Admin
    uniquement (voir POST /passeports/revoquer), pour les cas où un faux
    document est détecté sur le terrain (ex. via un signalement d'incident
    côté Contrôle). Un passeport révoqué est refusé de façon systématique
    à tout contrôle ultérieur, quelle que soit la validité technique de sa
    signature (voir enregistrer_controle)."""

    passeport_ids: list[str] = Field(min_length=1)
    motif: str = Field(min_length=1, max_length=500)
