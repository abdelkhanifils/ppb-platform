"""
Module Pays & Frontières — gestion du référentiel des localités
(app.models.localite.Localite), avec leur province de rattachement.

Écriture (création, modification) réservée Super Admin, comme le reste du
module Administration. Lecture ouverte aussi à l'Agent d'émission (liste
déroulante d'origine/destination du trajet et de localité de vaccination,
voir mobile/src/lib/paysLocalites.ts — appelée à remplacer progressivement
par ce référentiel) — limitée à son propre pays et aux seules localités
actives.

Remplace la liste jusqu'ici figée dans le code du mobile : celle-ci n'avait
aucun lien entre une localité et sa province (deux listes complètement
séparées), et n'était modifiable qu'en republiant l'application. La
désactivation reste toujours logique (`actif = False`), jamais une
suppression, pour ne pas casser l'historique des trajets déjà enregistrés
avec cette localité.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import CurrentUser, get_current_user, require_roles
from app.core.rbac import Role
from app.db.session import get_db
from app.models.localite import Localite
from app.models.pays import Pays
from app.schemas.localite import LocaliteCreate, LocaliteOut, LocaliteUpdate
from app.services.audit import journaliser

router = APIRouter(prefix="/localites", tags=["Module Pays & Frontières"])


@router.get("", response_model=list[LocaliteOut])
async def lister_localites(
    pays_id: int | None = None,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[LocaliteOut]:
    """Super Admin : toutes les localités, tous pays, actives ou non (pour
    Administration > Pays & Frontières, afin de pouvoir réactiver une
    localité désactivée). Agent d'émission : uniquement les localités
    actives de son PROPRE pays — `pays_id` est ignoré et remplacé par le
    sien, jamais un 403, cohérent avec le reste de la plateforme (voir
    /postes)."""
    if current_user.role not in (Role.SUPER_ADMIN, Role.AGENT_EMISSION):
        raise HTTPException(status_code=403, detail="Accès réservé à l'administration ou aux agents d'émission.")
    if current_user.role == Role.AGENT_EMISSION:
        pays_id = current_user.pays_id
    query = select(Localite).order_by(Localite.pays_id, Localite.nom)
    if current_user.role == Role.AGENT_EMISSION:
        query = query.where(Localite.actif.is_(True))
    if pays_id is not None:
        query = query.where(Localite.pays_id == pays_id)
    result = await db.execute(query)
    return [LocaliteOut.model_validate(loc) for loc in result.scalars().all()]


@router.post("", response_model=LocaliteOut, status_code=201, dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def creer_localite(
    payload: LocaliteCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> LocaliteOut:
    if await db.get(Pays, payload.pays_id) is None:
        raise HTTPException(status_code=422, detail="Pays introuvable.")
    result = await db.execute(
        select(Localite).where(Localite.pays_id == payload.pays_id, Localite.nom == payload.nom)
    )
    if result.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="Cette localité existe déjà pour ce pays.")

    localite = Localite(pays_id=payload.pays_id, nom=payload.nom, province=payload.province, actif=True)
    db.add(localite)
    await db.flush()

    await journaliser(
        db,
        utilisateur_id=current_user.id,
        action="localite.creee",
        entite="Localite",
        entite_id=localite.id,
        nouvelle_valeur={"nom": localite.nom, "province": localite.province, "pays_id": localite.pays_id},
    )
    await db.commit()
    await db.refresh(localite)
    return LocaliteOut.model_validate(localite)


@router.patch("/{localite_id}", response_model=LocaliteOut, dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def modifier_localite(
    localite_id: str,
    payload: LocaliteUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> LocaliteOut:
    localite = await db.get(Localite, localite_id)
    if localite is None:
        raise HTTPException(status_code=404, detail="Localité introuvable.")

    ancienne_valeur = {"nom": localite.nom, "province": localite.province, "actif": localite.actif}

    donnees = payload.model_dump(exclude_unset=True)
    for champ, valeur in donnees.items():
        setattr(localite, champ, valeur)
    await db.flush()

    await journaliser(
        db,
        utilisateur_id=current_user.id,
        action="localite.modifiee",
        entite="Localite",
        entite_id=localite.id,
        ancienne_valeur=ancienne_valeur,
        nouvelle_valeur=donnees,
    )
    await db.commit()
    await db.refresh(localite)
    return LocaliteOut.model_validate(localite)
