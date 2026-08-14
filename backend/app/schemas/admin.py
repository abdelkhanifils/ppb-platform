from pydantic import BaseModel, Field, field_validator

from app.models.admin import TypeChamp, TypeParametre


# --- DefinitionFormulaire ---------------------------------------------------

class FormulaireOut(BaseModel):
    id: str
    code: str
    nom: str
    description: str | None
    schema_version: int

    model_config = {"from_attributes": True}


# --- DefinitionChamp ---------------------------------------------------------

class ChampCreate(BaseModel):
    code_champ: str = Field(min_length=1, max_length=100)
    libelle_fr: str = Field(min_length=1, max_length=255)
    libelle_en: str | None = None
    libelle_ar: str | None = None
    type_champ: TypeChamp
    obligatoire: bool = False
    ordre_affichage: int = 0
    regle_validation: str | None = None
    options_liste: dict | None = None

    @field_validator("options_liste")
    @classmethod
    def options_liste_requise_si_type_liste(cls, v: dict | None, info):
        type_champ = info.data.get("type_champ")
        if type_champ == TypeChamp.LISTE and not v:
            raise ValueError("options_liste est obligatoire pour un champ de type 'liste'.")
        return v


class ChampUpdate(BaseModel):
    """Modification partielle — seuls les champs fournis sont mis à jour."""

    libelle_fr: str | None = None
    libelle_en: str | None = None
    libelle_ar: str | None = None
    obligatoire: bool | None = None
    ordre_affichage: int | None = None
    regle_validation: str | None = None
    options_liste: dict | None = None


class ChampOut(BaseModel):
    id: str
    formulaire_id: str
    code_champ: str
    libelle_fr: str
    libelle_en: str | None
    libelle_ar: str | None
    type_champ: TypeChamp
    obligatoire: bool
    ordre_affichage: int
    actif: bool
    version: int

    model_config = {"from_attributes": True}


# --- Parametre -----------------------------------------------------------------

class ParametreOut(BaseModel):
    cle: str
    valeur: str
    type: TypeParametre
    description: str | None

    model_config = {"from_attributes": True}


class ParametreUpdate(BaseModel):
    valeur: str


# --- Schéma public (versionné) --------------------------------------------------

class ChampSchemaPublic(BaseModel):
    code_champ: str
    libelle_fr: str
    libelle_en: str | None
    libelle_ar: str | None
    type_champ: TypeChamp
    obligatoire: bool
    ordre_affichage: int
    regle_validation: str | None
    options_liste: dict | None

    model_config = {"from_attributes": True}


class SchemaFormulairePublic(BaseModel):
    """Réponse de GET /api/v1/formulaires/{code}/schema — consommée par le Web Admin,
    l'application d'émission (Module 4) et le portail pour générer dynamiquement
    l'affichage. `schema_version` permet aux applications de détecter un changement
    et de régénérer le formulaire sans mise à jour ni redéploiement."""

    code: str
    schema_version: int
    champs: list[ChampSchemaPublic]


# --- TexteGabarit — circuit à deux comptes ---------------------------------------

class TexteGabaritProposer(BaseModel):
    cle: str = Field(min_length=1, max_length=100)
    langue: str = Field(min_length=2, max_length=5)
    valeur: str = Field(min_length=1, max_length=2000)
    gabarit_version_courante: int = Field(ge=1)


class TexteGabaritRejeter(BaseModel):
    motif: str = Field(min_length=1, max_length=500)


class TexteGabaritOut(BaseModel):
    id: str
    gabarit_version: int
    cle: str
    langue: str
    valeur: str
    statut: str
    propose_par_id: str
    valide_par_id: str | None

    model_config = {"from_attributes": True}
