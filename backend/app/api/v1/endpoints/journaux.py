"""
Module Journaux d'activité — consultation SEULE de la piste d'audit
(app.models.audit.PisteAudit), alimentée depuis de nombreux routeurs
sensibles (utilisateurs, paiements, impression, contrôle, branding,
administration...) via app.services.audit.journaliser.

Réservé Super Admin : les entrées journalisées couvrent l'ensemble de la
plateforme, tous pays confondus (ex. modification d'un paramètre système),
et certaines portent sur des actions qu'un Admin National n'a pas le droit
de voir même pour son propre pays (ex. remboursement, décidé par Super
Admin seul).

Aucune route d'écriture ici — l'immuabilité de la piste d'audit est déjà
garantie par app.models.audit (voir sa docstring) : ce module ne fait que
la lire.
"""
from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import require_roles
from app.core.rbac import Role
from app.db.session import get_db
from app.models.audit import PisteAudit
from app.models.utilisateur import Utilisateur
from app.schemas.audit import EntreeAuditOut

router = APIRouter(
    prefix="/journaux",
    tags=["Module Journaux d'activité"],
    dependencies=[Depends(require_roles(Role.SUPER_ADMIN))],
)


@router.get("", response_model=list[EntreeAuditOut])
async def lister_journaux(
    action: str | None = None,
    entite: str | None = None,
    utilisateur_id: str | None = None,
    depuis: datetime | None = None,
    limite: int = 100,
    db: AsyncSession = Depends(get_db),
) -> list[EntreeAuditOut]:
    query = select(PisteAudit, Utilisateur.nom_complet).join(
        Utilisateur, Utilisateur.id == PisteAudit.utilisateur_id, isouter=True
    )
    if action is not None:
        query = query.where(PisteAudit.action == action)
    if entite is not None:
        query = query.where(PisteAudit.entite == entite)
    if utilisateur_id is not None:
        query = query.where(PisteAudit.utilisateur_id == utilisateur_id)
    if depuis is not None:
        query = query.where(PisteAudit.cree_le >= depuis)
    query = query.order_by(PisteAudit.cree_le.desc()).limit(min(limite, 500))

    result = await db.execute(query)
    return [
        EntreeAuditOut(
            id=entree.id,
            utilisateur_id=entree.utilisateur_id,
            utilisateur_nom=nom_complet,
            action=entree.action,
            entite=entree.entite,
            entite_id=entree.entite_id,
            ancienne_valeur=entree.ancienne_valeur,
            nouvelle_valeur=entree.nouvelle_valeur,
            cree_le=entree.cree_le.isoformat(),
        )
        for entree, nom_complet in result.all()
    ]


@router.get("/actions-distinctes", response_model=list[str])
async def lister_actions_distinctes(db: AsyncSession = Depends(get_db)) -> list[str]:
    """Alimente le filtre déroulant côté interface — évite de faire deviner
    à l'administrateur la liste exacte des identifiants d'action utilisés
    dans le code (ex. \"utilisateur.cree\", \"paiement.valide\")."""
    result = await db.execute(select(PisteAudit.action).distinct().order_by(PisteAudit.action))
    return [row[0] for row in result.all()]
