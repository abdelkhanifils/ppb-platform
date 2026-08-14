from fastapi import APIRouter, Depends, HTTPException, status
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import CurrentUser, get_current_user
from app.core.security import create_access_token, create_refresh_token, decode_token, verify_password
from app.db.session import get_db
from app.models.utilisateur import Utilisateur
from app.schemas.auth import LoginRequest, RefreshRequest, TokenResponse, UtilisateurOut

router = APIRouter(prefix="/auth", tags=["Authentification"])


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    """Authentification JWT (access 15 min / refresh 7 jours). Cf. Document technique §6."""
    result = await db.execute(select(Utilisateur).where(Utilisateur.email == payload.email))
    user = result.scalar_one_or_none()

    if user is None or not user.actif or not verify_password(payload.password, user.hash_mdp):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Email ou mot de passe incorrect.")

    return TokenResponse(
        access_token=create_access_token(user.id, user.role.value, user.pays_id),
        refresh_token=create_refresh_token(user.id),
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh(payload: RefreshRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    try:
        decoded = decode_token(payload.refresh_token)
        if decoded.get("type") != "refresh":
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Jeton de rafraîchissement invalide.")
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Jeton de rafraîchissement invalide.")

    result = await db.execute(select(Utilisateur).where(Utilisateur.id == decoded["sub"], Utilisateur.actif.is_(True)))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Utilisateur introuvable ou désactivé.")

    return TokenResponse(
        access_token=create_access_token(user.id, user.role.value, user.pays_id),
        refresh_token=create_refresh_token(user.id),
    )


@router.get("/moi", response_model=UtilisateurOut)
async def moi(
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UtilisateurOut:
    result = await db.execute(select(Utilisateur).where(Utilisateur.id == current_user.id))
    user = result.scalar_one()
    return UtilisateurOut.model_validate(user)
