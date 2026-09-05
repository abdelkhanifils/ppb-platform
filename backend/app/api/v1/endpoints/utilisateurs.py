"""
Module Utilisateurs — gestion des comptes applicatifs et de leurs rôles RBAC
(Document technique §6).

Super Admin : accès complet, tous pays, tous rôles — inchangé.

Admin National : accès désormais ouvert, mais STRICTEMENT circonscrit à son
propre personnel de terrain — il peut créer, modifier et réinitialiser le
mot de passe des comptes Agent d'émission et Agent de contrôle DE SON PROPRE
PAYS uniquement (voir ROLES_GERABLES_PAR_ADMIN_NATIONAL et
_verifier_scope_admin_national ci-dessous). Il ne peut :
- ni créer/modifier un compte Super Admin, Admin National, Comptabilité,
  Vétérinaire ou Consultation ;
- ni voir, modifier ou réinitialiser un compte d'un AUTRE pays, même parmi
  les deux rôles qui lui sont ouverts ;
- ni changer le pays d'un compte (le sien étant le seul pays possible pour
  lui, ce champ n'a pas de sens à faire varier de son point de vue).
Ce cloisonnement est appliqué explicitement dans CHAQUE fonction ci-dessous
(jamais supposé acquis par la seule présence du rôle dans le décorateur de
route) — voir _verifier_scope_admin_national, appelée à chaque point de
décision.

Deux garde-fous volontaires, valables pour les deux rôles autorisés ici :
1. Un Super Admin ne peut ni désactiver ni rétrograder SON PROPRE compte —
   erreur d'inattention plausible (l'écran liste tous les comptes, y compris
   le sien) qui laisserait sinon la plateforme sans administrateur.
2. La désactivation est toujours logique (`actif = False`), jamais une
   suppression : l'historique (piste d'audit, numérisations, paiements
   déjà associés à cet utilisateur_id) doit rester intact et consultable.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import CurrentUser, get_current_user, require_roles
from app.core.rbac import Role
from app.core.security import hash_password
from app.db.session import get_db
from app.models.pays import Pays
from app.models.utilisateur import Utilisateur
from app.schemas.utilisateur import (
    ReinitialiserMotDePasseRequest,
    UtilisateurAdminOut,
    UtilisateurCreate,
    UtilisateurUpdate,
)
from app.services.audit import journaliser

router = APIRouter(
    prefix="/utilisateurs",
    tags=["Module Utilisateurs"],
    dependencies=[Depends(require_roles(Role.SUPER_ADMIN, Role.ADMIN_NATIONAL))],
)

# Les deux seuls rôles qu'un Admin National peut attribuer ou gérer — voir
# la docstring de module pour le raisonnement complet.
ROLES_GERABLES_PAR_ADMIN_NATIONAL = {Role.AGENT_EMISSION, Role.AGENT_CONTROLE}


def _verifier_scope_admin_national(current_user: CurrentUser, pays_id: int | None, role: Role) -> None:
    """N'a d'effet que pour un Admin National (Super Admin n'appelle jamais
    cette fonction) — lève un 403 dès que la combinaison pays/rôle sort de
    ce qui lui est ouvert. Centralisé ici pour que les 3 points d'écriture
    (création, modification, réinitialisation de mot de passe) appliquent
    exactement la même règle, jamais une variante oubliée dans l'un d'eux."""
    if role not in ROLES_GERABLES_PAR_ADMIN_NATIONAL:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Un Admin National ne peut gérer que des comptes Agent d'émission ou Agent de contrôle.",
        )
    if pays_id != current_user.pays_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Un Admin National ne peut gérer que le personnel de son propre pays.",
        )


async def _verifier_pays_existe(pays_id: int | None, db: AsyncSession) -> None:
    if pays_id is None:
        return
    if await db.get(Pays, pays_id) is None:
        raise HTTPException(status_code=422, detail="Pays introuvable.")


async def _get_utilisateur_ou_404(utilisateur_id: str, db: AsyncSession) -> Utilisateur:
    utilisateur = await db.get(Utilisateur, utilisateur_id)
    if utilisateur is None:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")
    return utilisateur


@router.get("", response_model=list[UtilisateurAdminOut])
async def lister_utilisateurs(
    pays_id: int | None = None,
    role: Role | None = None,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[UtilisateurAdminOut]:
    query = select(Utilisateur).order_by(Utilisateur.nom_complet)
    if current_user.role == Role.ADMIN_NATIONAL:
        # Toujours son propre pays et les deux rôles gérables, quels que
        # soient les paramètres de requête reçus — jamais un filtre client
        # qui élargirait la portée réellement autorisée.
        query = query.where(Utilisateur.pays_id == current_user.pays_id)
        query = query.where(Utilisateur.role.in_(ROLES_GERABLES_PAR_ADMIN_NATIONAL))
    else:
        if pays_id is not None:
            query = query.where(Utilisateur.pays_id == pays_id)
        if role is not None:
            query = query.where(Utilisateur.role == role)
    result = await db.execute(query)
    return [UtilisateurAdminOut.model_validate(u) for u in result.scalars().all()]


@router.post("", response_model=UtilisateurAdminOut, status_code=status.HTTP_201_CREATED)
async def creer_utilisateur(
    payload: UtilisateurCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UtilisateurAdminOut:
    if current_user.role == Role.ADMIN_NATIONAL:
        _verifier_scope_admin_national(current_user, payload.pays_id, payload.role)

    result = await db.execute(select(Utilisateur).where(Utilisateur.email == payload.email))
    if result.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="Un compte existe déjà avec cet email.")

    await _verifier_pays_existe(payload.pays_id, db)

    utilisateur = Utilisateur(
        email=payload.email,
        hash_mdp=hash_password(payload.mot_de_passe),
        nom_complet=payload.nom_complet,
        role=payload.role,
        pays_id=payload.pays_id,
        actif=True,
    )
    db.add(utilisateur)
    await db.flush()

    await journaliser(
        db,
        utilisateur_id=current_user.id,
        action="utilisateur.cree",
        entite="Utilisateur",
        entite_id=utilisateur.id,
        nouvelle_valeur={"email": utilisateur.email, "role": utilisateur.role.value, "pays_id": utilisateur.pays_id},
    )
    await db.commit()
    await db.refresh(utilisateur)
    return UtilisateurAdminOut.model_validate(utilisateur)


@router.patch("/{utilisateur_id}", response_model=UtilisateurAdminOut)
async def modifier_utilisateur(
    utilisateur_id: str,
    payload: UtilisateurUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UtilisateurAdminOut:
    utilisateur = await _get_utilisateur_ou_404(utilisateur_id, db)

    if current_user.role == Role.ADMIN_NATIONAL:
        # Vérifié à la fois sur l'état ACTUEL du compte ciblé (un Admin
        # National ne doit jamais pouvoir toucher un compte hors de sa
        # portée, même pour le désactiver) et sur l'état VOULU par la
        # requête (il ne peut pas non plus faire sortir un compte de cette
        # portée en lui changeant son rôle ou son pays).
        _verifier_scope_admin_national(current_user, utilisateur.pays_id, utilisateur.role)
        role_vise = payload.role if "role" in payload.model_fields_set else utilisateur.role
        pays_vise = payload.pays_id if "pays_id" in payload.model_fields_set else utilisateur.pays_id
        _verifier_scope_admin_national(current_user, pays_vise, role_vise)

    est_propre_compte = utilisateur.id == current_user.id
    if est_propre_compte and payload.actif is False:
        raise HTTPException(status_code=409, detail="Vous ne pouvez pas désactiver votre propre compte.")
    if est_propre_compte and payload.role is not None and payload.role != Role.SUPER_ADMIN:
        raise HTTPException(status_code=409, detail="Vous ne pouvez pas retirer votre propre rôle Super Admin.")

    if "pays_id" in payload.model_fields_set:
        await _verifier_pays_existe(payload.pays_id, db)

    ancienne_valeur = {"role": utilisateur.role.value, "pays_id": utilisateur.pays_id, "actif": utilisateur.actif}

    donnees = payload.model_dump(exclude_unset=True)
    for champ, valeur in donnees.items():
        setattr(utilisateur, champ, valeur)
    await db.flush()

    await journaliser(
        db,
        utilisateur_id=current_user.id,
        action="utilisateur.modifie",
        entite="Utilisateur",
        entite_id=utilisateur.id,
        ancienne_valeur=ancienne_valeur,
        nouvelle_valeur={"role": utilisateur.role.value, "pays_id": utilisateur.pays_id, "actif": utilisateur.actif},
    )
    await db.commit()
    await db.refresh(utilisateur)
    return UtilisateurAdminOut.model_validate(utilisateur)


@router.post("/{utilisateur_id}/reinitialiser-mot-de-passe")
async def reinitialiser_mot_de_passe(
    utilisateur_id: str,
    payload: ReinitialiserMotDePasseRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    utilisateur = await _get_utilisateur_ou_404(utilisateur_id, db)
    if current_user.role == Role.ADMIN_NATIONAL:
        _verifier_scope_admin_national(current_user, utilisateur.pays_id, utilisateur.role)

    utilisateur.hash_mdp = hash_password(payload.nouveau_mot_de_passe)
    await db.flush()

    await journaliser(
        db,
        utilisateur_id=current_user.id,
        action="utilisateur.mot_de_passe_reinitialise",
        entite="Utilisateur",
        entite_id=utilisateur.id,
    )
    await db.commit()
    return {"statut": "reinitialise"}
