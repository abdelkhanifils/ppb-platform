from pydantic import BaseModel, EmailStr, Field

from app.core.rbac import Role


class UtilisateurCreate(BaseModel):
    email: EmailStr
    mot_de_passe: str = Field(min_length=8)
    nom_complet: str = Field(min_length=1)
    role: Role
    pays_id: int | None = None


class UtilisateurUpdate(BaseModel):
    """Tous les champs sont optionnels : seuls ceux fournis sont modifiés."""

    nom_complet: str | None = Field(default=None, min_length=1)
    role: Role | None = None
    pays_id: int | None = None
    actif: bool | None = None


class ReinitialiserMotDePasseRequest(BaseModel):
    nouveau_mot_de_passe: str = Field(min_length=8)


class UtilisateurAdminOut(BaseModel):
    """Vue Administration — plus complète que UtilisateurOut (auth.py),
    qui reste réservée au profil du compte connecté."""

    id: str
    email: EmailStr
    nom_complet: str
    role: Role
    pays_id: int | None
    actif: bool

    model_config = {"from_attributes": True}
