"""Cloche de notification — chaque utilisateur ne voit que ses propres
notifications (filtrées par utilisateur_id, jamais par rôle ici : le
filtrage par rôle a déjà eu lieu à la création, voir
app/services/notification_service.py)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import CurrentUser, get_current_user
from app.db.session import get_db
from app.models.notification import Notification
from app.schemas.notification import CompteurNonLuesOut, NotificationOut

router = APIRouter(prefix="/notifications", tags=["Notifications"])


@router.get("", response_model=list[NotificationOut])
async def lister_notifications(
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[NotificationOut]:
    # Les 50 plus récentes suffisent pour une cloche — jamais pensé comme un
    # historique exhaustif consultable, voir PisteAudit pour ça.
    result = await db.execute(
        select(Notification)
        .where(Notification.utilisateur_id == current_user.id)
        .order_by(Notification.cree_le.desc())
        .limit(50)
    )
    return [NotificationOut.model_validate(n) for n in result.scalars().all()]


@router.get("/compteur", response_model=CompteurNonLuesOut)
async def compter_non_lues(
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CompteurNonLuesOut:
    result = await db.execute(
        select(func.count())
        .select_from(Notification)
        .where(Notification.utilisateur_id == current_user.id, Notification.lu.is_(False))
    )
    return CompteurNonLuesOut(non_lues=result.scalar_one())


@router.post("/{notification_id}/lire", response_model=NotificationOut)
async def marquer_lue(
    notification_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> NotificationOut:
    notification = await db.get(Notification, notification_id)
    if notification is None or notification.utilisateur_id != current_user.id:
        raise HTTPException(status_code=404, detail="Notification introuvable.")
    notification.lu = True
    await db.commit()
    await db.refresh(notification)
    return NotificationOut.model_validate(notification)


@router.post("/tout-lire")
async def marquer_tout_lu(
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    result = await db.execute(
        select(Notification).where(Notification.utilisateur_id == current_user.id, Notification.lu.is_(False))
    )
    non_lues = result.scalars().all()
    for n in non_lues:
        n.lu = True
    await db.commit()
    return {"marquees": len(non_lues)}
