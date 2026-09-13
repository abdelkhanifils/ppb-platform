from pydantic import BaseModel, Field


class LocaliteOut(BaseModel):
    id: str
    pays_id: int
    nom: str
    province: str | None = None
    actif: bool

    model_config = {"from_attributes": True}


class LocaliteCreate(BaseModel):
    pays_id: int
    nom: str = Field(min_length=1, max_length=150)
    province: str | None = Field(default=None, max_length=150)


class LocaliteUpdate(BaseModel):
    """`pays_id` volontairement non modifiable — comme pour Poste, créer une
    nouvelle localité plutôt que de faire migrer celle-ci d'un pays à
    l'autre après coup (une localité rattachée au mauvais pays dès la
    création est une erreur de saisie à corriger en la recréant, pas un cas
    d'usage réel à gérer)."""

    nom: str | None = Field(default=None, min_length=1, max_length=150)
    province: str | None = Field(default=None, max_length=150)
    actif: bool | None = None
