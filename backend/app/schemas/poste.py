from pydantic import BaseModel, Field


class PosteOut(BaseModel):
    id: str
    code: str
    nom: str
    pays_id: int
    latitude: float
    longitude: float
    actif: bool

    model_config = {"from_attributes": True}


class PosteCreate(BaseModel):
    code: str = Field(min_length=1, max_length=100)
    nom: str = Field(min_length=1, max_length=255)
    pays_id: int
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class PosteUpdate(BaseModel):
    """Tous les champs sont optionnels : seuls ceux fournis sont modifiés.
    `code` et `pays_id` ne sont volontairement PAS modifiables après
    création — le code est déjà utilisé tel quel dans l'historique des
    contrôles (Controle.poste_id) ; le changer romprait ce rattachement.
    Créer un nouveau poste plutôt que de renommer le code d'un poste existant."""

    nom: str | None = Field(default=None, min_length=1, max_length=255)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    actif: bool | None = None
