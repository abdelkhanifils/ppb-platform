from pydantic import BaseModel, EmailStr

from app.core.rbac import Role


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


class UtilisateurOut(BaseModel):
    id: str
    email: EmailStr
    nom_complet: str
    role: Role
    pays_id: int | None

    model_config = {"from_attributes": True}


class MoiOut(UtilisateurOut):
    """Profil courant + fonctionnalités effectivement accordées à son rôle
    (matrice « Rôles et accès ») — l'interface s'en sert pour afficher menus et pages."""

    permissions: list[str] = []
