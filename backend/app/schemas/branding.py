from pydantic import BaseModel, Field


class BrandingOut(BaseModel):
    """Métadonnées d'identité visuelle — jamais les octets d'image (servis
    séparément par /branding/logo et /branding/icone, en flux binaire)."""

    nom_application: str
    couleur_primaire: str
    couleur_primaire_claire: str
    a_logo: bool
    a_icone: bool
    version: int


class BrandingUpdate(BaseModel):
    """Tous les champs sont optionnels : seuls ceux fournis sont modifiés."""

    nom_application: str | None = Field(default=None, min_length=1, max_length=100)
    couleur_primaire: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    couleur_primaire_claire: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
