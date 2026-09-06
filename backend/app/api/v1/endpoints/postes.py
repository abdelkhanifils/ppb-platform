"""
Module Pays & Frontières — gestion du référentiel des postes de contrôle
frontaliers (app.models.poste.Poste).

Écriture (création, modification, désactivation) réservée Super Admin,
comme le reste du module Administration : ce référentiel alimente le
tableau de bord régional (statistiques par poste, carte des mouvements)
pour tous les pays — sa cohérence globale ne relève pas d'un seul pays.

Lecture ouverte aussi à l'Agent de contrôle, limitée à son propre pays et
aux seuls postes actifs (voir lister_postes ci-dessous) — alimente la
liste déroulante d'identification du poste en début de session côté
frontend (ControleFrontiere.tsx::SaisiePosteId), à la place d'une saisie
libre qui laissait passer des identifiants ne correspondant à aucun poste
réel du référentiel.

`code` reste la clé libre déjà utilisée par les agents de contrôle
(Controle.poste_id, jamais une FK stricte — voir la docstring du modèle) :
créer un poste ici l'enrichit (nom, pays, coordonnées) pour l'agrégation,
mais un contrôle reste enregistrable même pour un code non encore
référencé. La désactivation est toujours logique (`actif = False`),
jamais une suppression, pour ne pas casser l'historique des contrôles déjà
rattachés à ce poste.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import CurrentUser, get_current_user, require_roles
from app.core.rbac import Role
from app.db.session import get_db
from app.models.pays import Pays
from app.models.poste import Poste
from app.schemas.poste import PosteCreate, PosteOut, PosteUpdate
from app.services.audit import journaliser

router = APIRouter(prefix="/postes", tags=["Module Pays & Frontières"])


@router.get("", response_model=list[PosteOut])
async def lister_postes(
    pays_id: int | None = None,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[PosteOut]:
    """Lecture ouverte à Super Admin (tous pays, pour Administration > Pays
    & Frontières) ET Agent de contrôle (voir frontend/src/pages/
    ControleFrontiere.tsx::SaisiePosteId — liste déroulante des postes de
    SON PROPRE pays, à l'identification du poste en début de session).
    Un Agent de contrôle ne peut jamais demander un autre pays que le
    sien : `pays_id` est ignoré et remplacé par le sien, jamais un 403 —
    cohérent avec le reste de la plateforme (voir /statistiques)."""
    if current_user.role not in (Role.SUPER_ADMIN, Role.AGENT_CONTROLE):
        raise HTTPException(status_code=403, detail="Accès réservé à l'administration ou aux agents de contrôle.")
    if current_user.role == Role.AGENT_CONTROLE:
        pays_id = current_user.pays_id
    query = select(Poste).order_by(Poste.pays_id, Poste.nom)
    if current_user.role == Role.AGENT_CONTROLE:
        # Un poste désactivé ne doit plus pouvoir être choisi pour un
        # nouveau contrôle — contrairement à l'administration, qui doit
        # continuer à le voir pour pouvoir le réactiver au besoin.
        query = query.where(Poste.actif.is_(True))
    if pays_id is not None:
        query = query.where(Poste.pays_id == pays_id)
    result = await db.execute(query)
    return [PosteOut.model_validate(p) for p in result.scalars().all()]


@router.post("", response_model=PosteOut, status_code=201, dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def creer_poste(
    payload: PosteCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PosteOut:
    if await db.get(Pays, payload.pays_id) is None:
        raise HTTPException(status_code=422, detail="Pays introuvable.")
    result = await db.execute(select(Poste).where(Poste.code == payload.code))
    if result.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="Un poste existe déjà avec ce code.")

    poste = Poste(
        code=payload.code,
        nom=payload.nom,
        pays_id=payload.pays_id,
        latitude=payload.latitude,
        longitude=payload.longitude,
        actif=True,
    )
    db.add(poste)
    await db.flush()

    await journaliser(
        db,
        utilisateur_id=current_user.id,
        action="poste.cree",
        entite="Poste",
        entite_id=poste.id,
        nouvelle_valeur={"code": poste.code, "nom": poste.nom, "pays_id": poste.pays_id},
    )
    await db.commit()
    await db.refresh(poste)
    return PosteOut.model_validate(poste)


@router.patch("/{poste_id}", response_model=PosteOut, dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def modifier_poste(
    poste_id: str,
    payload: PosteUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PosteOut:
    poste = await db.get(Poste, poste_id)
    if poste is None:
        raise HTTPException(status_code=404, detail="Poste introuvable.")

    ancienne_valeur = {"nom": poste.nom, "actif": poste.actif, "latitude": float(poste.latitude), "longitude": float(poste.longitude)}

    donnees = payload.model_dump(exclude_unset=True)
    for champ, valeur in donnees.items():
        setattr(poste, champ, valeur)
    await db.flush()

    await journaliser(
        db,
        utilisateur_id=current_user.id,
        action="poste.modifie",
        entite="Poste",
        entite_id=poste.id,
        ancienne_valeur=ancienne_valeur,
        nouvelle_valeur=donnees,
    )
    await db.commit()
    await db.refresh(poste)
    return PosteOut.model_validate(poste)
