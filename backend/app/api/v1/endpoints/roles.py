"""
Rôles et accès — matrice de permissions configurable (cases à cocher) et
suivi des utilisateurs en ligne. Réservé à Super Admin et au profil IT
(permissions `roles.configurer` et `presence.consulter`).

Garde-fous :
- la ligne Super Admin est figée (il garde tout) ;
- seul un Super Admin peut modifier la ligne IT ou réinitialiser son profil ;
- les permissions « réservées Super Admin » ne sont accordables à aucun autre rôle ;
- le profil IT ne peut pas perdre `roles.configurer` (sinon plus personne, hors
  Super Admin, ne pourrait corriger la matrice).
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import CurrentUser, permissions_effectives, require_permission
from app.core import permissions as perms
from app.core.rbac import Role
from app.db.session import get_db
from app.models.pays import Pays
from app.models.permission_role import PermissionRole
from app.models.utilisateur import Utilisateur
from app.services.audit import journaliser

router = APIRouter(prefix="/roles", tags=["Rôles et accès"])

SEUIL_EN_LIGNE_MINUTES = 5


class MajPermissions(BaseModel):
    permissions: list[str]


async def _matrice(db: AsyncSession) -> dict:
    roles = []
    for r in Role:
        effectives = await permissions_effectives(db, r)
        roles.append(
            {
                "role": r.value,
                "verrouille": r in perms.ROLES_VERROUILLES,
                "permissions": sorted(effectives),
                "defaut": sorted(perms.defaut_pour(r)),
            }
        )
    return {
        "catalogue": [
            {"code": p.code, "module": p.module, "libelle": p.libelle, "reservee_super_admin": p.reservee_super_admin}
            for p in perms.CATALOGUE
        ],
        "roles": roles,
    }


@router.get("/matrice", dependencies=[Depends(require_permission("roles.configurer"))])
async def lire_matrice(db: AsyncSession = Depends(get_db)):
    return await _matrice(db)


def _verifier_cible(actuel: CurrentUser, role: Role) -> None:
    if role in perms.ROLES_VERROUILLES:
        raise HTTPException(status_code=409, detail="Le profil Super Admin dispose toujours de toutes les fonctionnalités.")
    if role == Role.IT and actuel.role != Role.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Seul un Super Admin peut modifier le profil IT.")


@router.put("/matrice/{role}")
async def mettre_a_jour_role(
    role: Role,
    payload: MajPermissions,
    current_user: CurrentUser = Depends(require_permission("roles.configurer")),
    db: AsyncSession = Depends(get_db),
):
    _verifier_cible(current_user, role)
    voulues = set(payload.permissions)
    inconnues = voulues - set(perms.PAR_CODE)
    if inconnues:
        raise HTTPException(status_code=422, detail=f"Fonctionnalités inconnues : {', '.join(sorted(inconnues))}")
    interdites = [c for c in voulues if not perms.accordable(c, role)]
    if interdites:
        raise HTTPException(
            status_code=422,
            detail=f"Réservé au Super Admin, non attribuable : {', '.join(sorted(interdites))}",
        )
    if role == Role.IT and "roles.configurer" not in voulues:
        raise HTTPException(status_code=422, detail="Le profil IT doit conserver la configuration des rôles.")

    avant = await permissions_effectives(db, role)
    defaut = perms.defaut_pour(role)
    await db.execute(delete(PermissionRole).where(PermissionRole.role == role))
    for code in perms.PAR_CODE:
        if (code in voulues) != (code in defaut):
            db.add(PermissionRole(role=role, code=code, autorise=code in voulues))
    await db.flush()
    await journaliser(
        db,
        utilisateur_id=current_user.id,
        action="role.permissions_modifiees",
        entite="Role",
        entite_id=role.value,
        ancienne_valeur={"permissions": sorted(avant)},
        nouvelle_valeur={"permissions": sorted(voulues)},
    )
    await db.commit()
    return await _matrice(db)


@router.post("/matrice/{role}/reinitialiser")
async def reinitialiser_role(
    role: Role,
    current_user: CurrentUser = Depends(require_permission("roles.configurer")),
    db: AsyncSession = Depends(get_db),
):
    _verifier_cible(current_user, role)
    avant = await permissions_effectives(db, role)
    await db.execute(delete(PermissionRole).where(PermissionRole.role == role))
    await journaliser(
        db,
        utilisateur_id=current_user.id,
        action="role.permissions_reinitialisees",
        entite="Role",
        entite_id=role.value,
        ancienne_valeur={"permissions": sorted(avant)},
        nouvelle_valeur={"permissions": sorted(perms.defaut_pour(role))},
    )
    await db.commit()
    return await _matrice(db)


@router.get("/presence", dependencies=[Depends(require_permission("presence.consulter"))])
async def utilisateurs_en_ligne(db: AsyncSession = Depends(get_db)):
    """Utilisateurs actifs avec leur dernière activité. « En ligne » = requête
    authentifiée dans les 5 dernières minutes."""
    maintenant = datetime.now(timezone.utc)
    seuil = maintenant - timedelta(minutes=SEUIL_EN_LIGNE_MINUTES)
    lignes = (
        await db.execute(
            select(Utilisateur, Pays.nom)
            .join(Pays, Pays.id == Utilisateur.pays_id, isouter=True)
            .where(Utilisateur.actif.is_(True))
        )
    ).all()

    def _aware(d):
        return d if d is None or d.tzinfo else d.replace(tzinfo=timezone.utc)

    utilisateurs = []
    for u, pays_nom in lignes:
        d = _aware(u.derniere_activite)
        utilisateurs.append(
            {
                "id": u.id,
                "nom_complet": u.nom_complet,
                "email": u.email,
                "role": u.role.value,
                "pays": pays_nom,
                "derniere_activite": d.isoformat() if d else None,
                "en_ligne": bool(d and d >= seuil),
            }
        )
    utilisateurs.sort(key=lambda x: (not x["en_ligne"], -(datetime.fromisoformat(x["derniere_activite"]).timestamp() if x["derniere_activite"] else 0)))
    par_role: dict[str, int] = {}
    for x in utilisateurs:
        if x["en_ligne"]:
            par_role[x["role"]] = par_role.get(x["role"], 0) + 1
    return {
        "seuil_minutes": SEUIL_EN_LIGNE_MINUTES,
        "en_ligne": sum(1 for x in utilisateurs if x["en_ligne"]),
        "total_actifs": len(utilisateurs),
        "par_role": par_role,
        "utilisateurs": utilisateurs,
    }
