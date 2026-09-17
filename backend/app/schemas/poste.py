from pydantic import BaseModel, Field


class PosteOut(BaseModel):
    id: str
    code: str
    nom: str
    pays_id: int
    localite_id: str | None = None
    # Champs enrichis en lecture seule, résolus par jointure vers Localite
    # (voir _serialiser_poste dans l'endpoint) — jamais stockés directement
    # sur Poste : localite_id est la SEULE source de vérité, ces deux
    # champs ne font que la refléter pour éviter à chaque appelant de
    # refaire la jointure lui-même (Administration, mobile à l'émission).
    localite_nom: str | None = None
    province: str | None = None
    latitude: float
    longitude: float
    actif: bool

    model_config = {"from_attributes": True}


class PosteCreate(BaseModel):
    code: str = Field(min_length=1, max_length=100)
    nom: str = Field(min_length=1, max_length=255)
    pays_id: int
    localite_id: str | None = None
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class PosteUpdate(BaseModel):
    """Tous les champs sont optionnels : seuls ceux fournis sont modifiés.
    `code` et `pays_id` ne sont volontairement PAS modifiables après
    création — le code est déjà utilisé tel quel dans l'historique des
    contrôles (Controle.poste_id) ; le changer romprait ce rattachement.
    Créer un nouveau poste plutôt que de renommer le code d'un poste existant."""

    nom: str | None = Field(default=None, min_length=1, max_length=255)
    # `localite_id` accepte explicitement `None` pour détacher un poste
    # d'une localité (ex. corriger une erreur de saisie) — voir l'endpoint
    # pour la distinction entre "champ absent" (ne pas toucher) et "champ
    # présent valant None" (détacher), via exclude_unset.
    localite_id: str | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    actif: bool | None = None
