"""
Dépendances communes à tous les routeurs :
- get_current_user   : décode le JWT, charge l'utilisateur actif
- require_roles(...) : garde RBAC déclarative, à poser sur chaque route sensible

Exemple d'utilisation dans un routeur :

    @router.post("/", dependencies=[Depends(require_roles(Role.ADMIN_NATIONAL, Role.SUPER_ADMIN))])
    async def creer_commande(...): ...
"""
from dataclasses import dataclass

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rbac import Role
from app.core.security import decode_token
from app.db.session import get_db
from app.models.utilisateur import Utilisateur

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


@dataclass
class CurrentUser:
    id: str
    email: str
    role: Role
    pays_id: int | None


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> CurrentUser:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Identifiants invalides ou expirés",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            raise credentials_exception
        user_id: str | None = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    result = await db.execute(select(Utilisateur).where(Utilisateur.id == user_id, Utilisateur.actif.is_(True)))
    user = result.scalar_one_or_none()
    if user is None:
        raise credentials_exception

    return CurrentUser(id=user.id, email=user.email, role=Role(user.role), pays_id=user.pays_id)


def require_roles(*roles: Role):
    """Garde RBAC : rejette avec 403 si le rôle de l'utilisateur courant n'est pas dans `roles`."""

    async def _guard(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if current_user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Rôle '{current_user.role.value}' non autorisé pour cette opération.",
            )
        return current_user

    return _guard


def require_same_country_or_super_admin(pays_id_param: int, current_user: CurrentUser) -> None:
    """Un Admin National ne peut agir que sur les données de son propre pays."""
    if current_user.role == Role.SUPER_ADMIN:
        return
    if current_user.pays_id != pays_id_param:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Accès limité aux données de votre pays.",
        )


def require_same_country_or_finance(pays_id_param: int, current_user: CurrentUser) -> None:
    """Variante de require_same_country_or_super_admin ci-dessus, réservée
    aux endpoints de LECTURE des modules Commandes et Paiements
    uniquement — Comptabilité y a une vue globale (toutes commandes/tous
    paiements, tous pays confondus), nécessaire à son travail de
    rapprochement, mais N'A PAS le passe-droit "toutes données" de
    Super Admin sur le reste de la plateforme : n'utiliser cette variante
    que là où c'est explicitement voulu, jamais comme remplacement général
    de la fonction ci-dessus."""
    if current_user.role in (Role.SUPER_ADMIN, Role.COMPTABILITE):
        return
    if current_user.pays_id != pays_id_param:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Accès limité aux données de votre pays.",
        )
