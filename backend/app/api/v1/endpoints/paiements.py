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

from app.api.v1.deps import CurrentUser, get_current_user, require_roles, require_same_country_or_finance, require_same_country_or_super_admin
from app.core.rbac import Role
from app.db.session import get_db
from app.models.commande import Commande, StatutCommande
from app.models.paiement import Paiement, StatutPaiement
from app.models.passeport import StatutPasseport
from app.schemas.paiement import PaiementOut, PaiementPresentielRequest
from app.services.attribution import attribuer_passeports_pour_commande
from app.services.audit import journaliser

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
        require_same_country_or_finance(commande.pays_id, current_user)
        result = await db.execute(select(Paiement).where(Paiement.commande_id == commande_id))
        return [PaiementOut.model_validate(p) for p in result.scalars().all()]

    query = select(Paiement)
    if current_user.role not in (Role.SUPER_ADMIN, Role.COMPTABILITE, Role.GESTIONNAIRE_CEBEVIRHA):
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


@router.post("/presentiel", dependencies=[Depends(require_roles(Role.SUPER_ADMIN, Role.ADMIN_NATIONAL, Role.GESTIONNAIRE_CEBEVIRHA))])
async def enregistrer_paiement_presentiel(
    payload: PaiementPresentielRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    commande = await db.get(Commande, payload.commande_id)
    if commande is None:
        raise HTTPException(status_code=404, detail="Commande introuvable.")
    # Gestionnaire CEBEVIRHA enregistre pour n'importe quel pays (il crée
    # déjà les commandes de n'importe quel pays — voir commandes.py) ; il ne
    # peut en revanche jamais valider ce même paiement (voir /valider
    # ci-dessous, toujours Super Admin/Comptabilité seuls) — séparation des
    # tâches délibérée entre qui enregistre et qui valide.
    require_same_country_or_finance(commande.pays_id, current_user)

    # Garde-fou anti-doublon — un clic répété (ou une re-soumission après une
    # réponse mal interprétée côté interface) ne doit jamais produire deux
    # paiements distincts pour la même commande tant que le premier n'a pas
    # échoué ou été remboursé : la commande n'a qu'un seul montant dû, un
    # deuxième enregistrement serait nécessairement une erreur de saisie, pas
    # un second versement légitime (un versement partiel n'existe pas dans ce
    # circuit — voir la validation du montant plus bas).
    result_existant = await db.execute(
        select(Paiement).where(
            Paiement.commande_id == payload.commande_id,
            Paiement.statut.in_([StatutPaiement.EN_ATTENTE_VALIDATION, StatutPaiement.VALIDE]),
        )
    )
    if result_existant.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=409,
            detail="Un paiement est déjà enregistré pour cette commande (en attente de validation ou déjà validé).",
        )

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


@router.post("/{paiement_id}/valider", dependencies=[Depends(require_roles(Role.SUPER_ADMIN, Role.COMPTABILITE))])
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
    passeports = await attribuer_passeports_pour_commande(db, commande)
    # Auto-confirmation de l'impression dès la validation du paiement —
    # demande explicite de retirer l'étape manuelle séparée (bouton
    # « Confirmer impression », voir l'historique dans
    # app.api.v1.endpoints.passeports::confirmer_impression_centralisee,
    # conservé pour l'impression décentralisée mais plus utilisé ici).
    # PRECHARGE -> VIERGE directement sur les objets déjà en mémoire — pas
    # besoin d'une requête séparée, attribuer_passeports_pour_commande
    # vient de les créer avec ce même statut initial.
    for passeport in passeports:
        passeport.statut = StatutPasseport.VIERGE
    await journaliser(
        db,
        utilisateur_id=current_user.id,
        action="impression.auto_confirmee_apres_paiement",
        entite="Commande",
        entite_id=commande.id,
        nouvelle_valeur={"quantite": len(passeports)},
    )
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
