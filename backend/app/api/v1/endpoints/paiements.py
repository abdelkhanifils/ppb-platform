"""
Module 2 — Paiement (Document technique, section 3, M2).

Paiement en ligne (CinetPay) volontairement RETIRÉ de cette version : les
identifiants CinetPay (apikey, site_id, secret webhook) ne sont pas encore
disponibles au moment du déploiement. Seul le paiement présentiel/virement
est actif — il ne nécessite aucun identifiant externe.

Pour réintégrer le paiement en ligne plus tard, voir le README, section
« Réactiver CinetPay ».

Le paiement présentiel suit le même principe d'autorisation que le reste de
la plateforme : c'est la validation explicite d'un agent CEBEVIRHA (Super
Admin), et elle seule, qui déclenche l'attribution automatique des
passeports (Module 3), dans la même transaction que la validation.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import CurrentUser, get_current_user, require_roles, require_same_country_or_super_admin
from app.core.rbac import Role
from app.db.session import get_db
from app.models.commande import Commande, StatutCommande
from app.models.paiement import Paiement, StatutPaiement
from app.schemas.paiement import PaiementOut, PaiementPresentielRequest
from app.services.attribution import attribuer_passeports_pour_commande

router = APIRouter(prefix="/paiements", tags=["Module 2 — Paiement"])


@router.get("", response_model=list[PaiementOut])
async def lister_paiements(
    commande_id: str | None = None,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[PaiementOut]:
    """Historique des paiements. Avec `commande_id` : paiements d'une seule
    commande (usage historique, détail). Sans : TOUS les paiements visibles
    par l'utilisateur (un Admin National ne voit que ceux de son pays, comme
    partout ailleurs sur la plateforme) — utilisé par le nouveau tableau
    Paiements du Web Admin, qui affiche l'ensemble des transactions avec
    filtres plutôt qu'une commande à la fois."""
    if commande_id is not None:
        commande = await db.get(Commande, commande_id)
        if commande is None:
            raise HTTPException(status_code=404, detail="Commande introuvable.")
        require_same_country_or_super_admin(commande.pays_id, current_user)
        result = await db.execute(select(Paiement).where(Paiement.commande_id == commande_id))
        return [PaiementOut.model_validate(p) for p in result.scalars().all()]

    query = select(Paiement)
    if current_user.role != Role.SUPER_ADMIN:
        query = query.join(Commande, Commande.id == Paiement.commande_id).where(Commande.pays_id == current_user.pays_id)
    result = await db.execute(query)
    return [PaiementOut.model_validate(p) for p in result.scalars().all()]


@router.get("/{commande_id}/moyens-disponibles")
async def moyens_disponibles(
    commande_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Uniquement les moyens présentiel/virement pour l'instant — le paiement
    en ligne (mobile money, carte) réapparaîtra ici une fois CinetPay
    réintégré (voir docstring du module)."""
    commande = await db.get(Commande, commande_id)
    if commande is None:
        raise HTTPException(status_code=404, detail="Commande introuvable.")
    require_same_country_or_super_admin(commande.pays_id, current_user)
    return {"commande_id": commande_id, "montant": commande.montant_total, "moyens_eligibles": ["virement", "especes", "cheque"]}


@router.post("/presentiel", dependencies=[Depends(require_roles(Role.SUPER_ADMIN, Role.ADMIN_NATIONAL))])
async def enregistrer_paiement_presentiel(
    payload: PaiementPresentielRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    commande = await db.get(Commande, payload.commande_id)
    if commande is None:
        raise HTTPException(status_code=404, detail="Commande introuvable.")
    require_same_country_or_super_admin(commande.pays_id, current_user)

    paiement = Paiement(
        commande_id=payload.commande_id,
        montant=payload.montant,
        moyen=payload.moyen,
        statut=StatutPaiement.EN_ATTENTE_VALIDATION,
        idempotency_key=str(uuid.uuid4()),
    )
    db.add(paiement)
    await db.commit()
    await db.refresh(paiement)
    return {"paiement_id": paiement.id, "statut": paiement.statut}


@router.post("/{paiement_id}/valider", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def valider_paiement_presentiel(
    paiement_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """L'agent CEBEVIRHA est l'unique déclencheur — aucune confirmation PSP intermédiaire."""
    paiement = await db.get(Paiement, paiement_id)
    if paiement is None:
        raise HTTPException(status_code=404, detail="Paiement introuvable.")
    paiement.statut = StatutPaiement.VALIDE
    paiement.valide_par_id = current_user.id
    commande = await db.get(Commande, paiement.commande_id)
    commande.statut = StatutCommande.PAYEE
    await attribuer_passeports_pour_commande(db, commande)
    await db.commit()
    # TODO: génération du reçu
    return {"statut": "valide", "valide_par": current_user.id}


@router.get("/{paiement_id}/statut", response_model=PaiementOut)
async def statut_paiement(paiement_id: str, db: AsyncSession = Depends(get_db)) -> PaiementOut:
    paiement = await db.get(Paiement, paiement_id)
    if paiement is None:
        raise HTTPException(status_code=404, detail="Paiement introuvable.")
    return PaiementOut.model_validate(paiement)


@router.get("/{paiement_id}/recu")
async def telecharger_recu(paiement_id: str, db: AsyncSession = Depends(get_db)):
    # TODO: génération PDF du reçu (numéro unique, référence commande, mode, agent validateur)
    raise HTTPException(status_code=501, detail="Génération de reçu PDF à implémenter.")


@router.post("/{paiement_id}/rembourser", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def rembourser_paiement(paiement_id: str, db: AsyncSession = Depends(get_db)):
    paiement = await db.get(Paiement, paiement_id)
    if paiement is None:
        raise HTTPException(status_code=404, detail="Paiement introuvable.")
    if paiement.statut != StatutPaiement.VALIDE:
        raise HTTPException(status_code=409, detail="Seul un paiement validé peut être remboursé.")
    paiement.statut = StatutPaiement.REMBOURSE
    await db.commit()
    return {"statut": "rembourse"}
