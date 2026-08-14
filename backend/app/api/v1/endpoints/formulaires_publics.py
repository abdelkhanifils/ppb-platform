"""Endpoints publics de schéma — consommés par le Web Admin, l'application d'émission
(Module 4) et le portail pour générer dynamiquement l'affichage (Module Administration, §4).

Aucune authentification requise : ces endpoints ne renvoient que la définition
d'affichage (libellés, types, règles), jamais de donnée métier. Seuls les champs
`actif=True` sont exposés — un champ désactivé disparaît des nouvelles saisies
sans jamais effacer l'historique déjà enregistré."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.admin import DefinitionChamp, DefinitionFormulaire, StatutTexteGabarit, TexteGabarit
from app.schemas.admin import ChampSchemaPublic, SchemaFormulairePublic

router = APIRouter(prefix="/formulaires", tags=["Schémas publics"])


@router.get("/{code}/schema", response_model=SchemaFormulairePublic)
async def schema_formulaire(code: str, db: AsyncSession = Depends(get_db)) -> SchemaFormulairePublic:
    """Schéma versionné du formulaire — les applications comparent `schema_version` à
    leur copie locale (cache) pour savoir si une régénération de l'affichage est
    nécessaire, exactement comme elles le font pour la synchronisation des passeports
    (Module 3 -> Module 5). Pas de polling requis côté client : la version suffit."""
    result = await db.execute(select(DefinitionFormulaire).where(DefinitionFormulaire.code == code))
    formulaire = result.scalar_one_or_none()
    if formulaire is None:
        raise HTTPException(status_code=404, detail="Formulaire introuvable.")

    champs = await db.execute(
        select(DefinitionChamp)
        .where(DefinitionChamp.formulaire_id == formulaire.id, DefinitionChamp.actif.is_(True))
        .order_by(DefinitionChamp.ordre_affichage)
    )
    return SchemaFormulairePublic(
        code=formulaire.code,
        schema_version=formulaire.schema_version,
        champs=[ChampSchemaPublic.model_validate(c) for c in champs.scalars().all()],
    )


@router.get("/gabarit/{version}")
async def gabarit_publie(version: int, db: AsyncSession = Depends(get_db)):
    """Dernière version validée du gabarit — consommée par le Module Impression."""
    result = await db.execute(
        select(TexteGabarit).where(TexteGabarit.gabarit_version == version, TexteGabarit.statut == StatutTexteGabarit.VALIDE)
    )
    return [{"cle": t.cle, "langue": t.langue, "valeur": t.valeur} for t in result.scalars().all()]
