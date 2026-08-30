from datetime import datetime

from pydantic import BaseModel, Field

from app.models.commande import ModeImpression, StatutCommande, VersionLinguistique


class CommandeCreate(BaseModel):
    pays_id: int
    # Bornes non figées ici : seul un plancher de bon sens (positif) est imposé au
    # niveau du schéma. Les bornes réelles (50-10 000, paramétrables) sont vérifiées
    # dans le routeur depuis Parametre('commande_quantite_min'/'commande_quantite_max'),
    # conformément au document technique (« quantité ... paramétrable »).
    quantite: int = Field(gt=0)
    langue_version: VersionLinguistique
    mode_impression: ModeImpression
    responsable_nom: str


class CommandeModeImpressionUpdate(BaseModel):
    mode_impression: ModeImpression


class CommandeVersionLinguistiqueUpdate(BaseModel):
    langue_version: VersionLinguistique


class CommandeOut(BaseModel):
    id: str
    pays_id: int
    quantite: int
    langue_version: VersionLinguistique
    mode_impression: ModeImpression
    montant_total: float
    statut: StatutCommande
    responsable_nom: str
    created_at: datetime

    model_config = {"from_attributes": True}
