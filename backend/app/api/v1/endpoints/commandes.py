"""
Module 1 — Commande (Document technique, section 3, M1).

Règles métier appliquées ici :
- Quantité 50-10 000 par défaut, paramétrable sans redéploiement via
  Parametre('commande_quantite_min'/'commande_quantite_max') — jamais figée
  en dur (voir app.services.parametres).
- Prix unitaire jamais codé en dur : lu depuis Parametre('prix_unitaire_ppb')
  à chaque calcul de montant.
- Version linguistique obligatoire à la création (FR/EN ou FR/AR).
- Modifications (mode d'impression, version linguistique) possibles
  uniquement tant que la commande n'est pas payée.
- Le mode décentralisé n'est proposé que si une AutorisationImpression
  active existe pour le pays (vérifié ici avant création).
"""
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import CurrentUser, get_current_user, require_roles, require_same_country_or_super_admin
from app.core.config import settings
from app.core.rbac import Role
from app.db.session import get_db
from app.models.autorisation_impression import AutorisationImpression
from app.models.commande import Commande, ModeImpression, StatutCommande
from app.models.pays import Pays
from app.schemas.commande import (
    CommandeCreate,
    CommandeModeImpressionUpdate,
    CommandeOut,
    CommandeVersionLinguistiqueUpdate,
)
from app.services.parametres import obtenir_parametre_decimal, obtenir_parametre_int
from app.services.pdf_facture import generer_facture_pdf

router = APIRouter(prefix="/commandes", tags=["Module 1 — Commande"])


@router.post(
    "",
    response_model=CommandeOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(Role.ADMIN_NATIONAL, Role.SUPER_ADMIN))],
)
async def creer_commande(
    payload: CommandeCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CommandeOut:
    require_same_country_or_super_admin(payload.pays_id, current_user)

    pays = await db.get(Pays, payload.pays_id)
    if pays is None:
        raise HTTPException(status_code=404, detail="Pays introuvable.")

    quantite_min = await obtenir_parametre_int(db, "commande_quantite_min", settings.COMMANDE_QUANTITE_MIN)
    quantite_max = await obtenir_parametre_int(db, "commande_quantite_max", settings.COMMANDE_QUANTITE_MAX)
    if not (quantite_min <= payload.quantite <= quantite_max):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"La quantité doit être comprise entre {quantite_min} et {quantite_max}.",
        )

    if payload.mode_impression == ModeImpression.DECENTRALISEE:
        result = await db.execute(
            select(AutorisationImpression).where(
                AutorisationImpression.pays_id == payload.pays_id,
                AutorisationImpression.active.is_(True),
            )
        )
        if result.scalar_one_or_none() is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Aucune AutorisationImpression active pour ce pays : impression décentralisée impossible.",
            )

    prix_unitaire = await obtenir_parametre_decimal(db, "prix_unitaire_ppb", 1500.0)

    commande = Commande(
        pays_id=payload.pays_id,
        quantite=payload.quantite,
        langue_version=payload.langue_version,
        mode_impression=payload.mode_impression,
        montant_total=payload.quantite * prix_unitaire,
        statut=StatutCommande.EN_ATTENTE_PAIEMENT,
        responsable_nom=payload.responsable_nom,
        cree_par_id=current_user.id,
    )
    db.add(commande)
    await db.commit()
    await db.refresh(commande)
    # TODO: génération automatique de la facture PDF (voir GET /commandes/{id}/facture)
    return CommandeOut.model_validate(commande)


@router.get("/{commande_id}", response_model=CommandeOut)
async def consulter_commande(
    commande_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CommandeOut:
    commande = await db.get(Commande, commande_id)
    if commande is None:
        raise HTTPException(status_code=404, detail="Commande introuvable.")
    if current_user.role != Role.SUPER_ADMIN and current_user.pays_id != commande.pays_id:
        raise HTTPException(status_code=403, detail="Accès limité aux commandes de votre pays.")
    return CommandeOut.model_validate(commande)


@router.get("", response_model=list[CommandeOut])
async def lister_commandes(
    pays_id: int | None = None,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[CommandeOut]:
    query = select(Commande)
    if current_user.role != Role.SUPER_ADMIN:
        query = query.where(Commande.pays_id == current_user.pays_id)
    elif pays_id is not None:
        query = query.where(Commande.pays_id == pays_id)
    result = await db.execute(query)
    return [CommandeOut.model_validate(c) for c in result.scalars().all()]


@router.patch(
    "/{commande_id}/mode-impression",
    response_model=CommandeOut,
    dependencies=[Depends(require_roles(Role.ADMIN_NATIONAL, Role.SUPER_ADMIN))],
)
async def modifier_mode_impression(
    commande_id: str,
    payload: CommandeModeImpressionUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CommandeOut:
    commande = await db.get(Commande, commande_id)
    if commande is None:
        raise HTTPException(status_code=404, detail="Commande introuvable.")
    require_same_country_or_super_admin(commande.pays_id, current_user)
    if commande.statut != StatutCommande.EN_ATTENTE_PAIEMENT:
        raise HTTPException(status_code=409, detail="Modification impossible après paiement.")
    commande.mode_impression = payload.mode_impression
    await db.commit()
    await db.refresh(commande)
    return CommandeOut.model_validate(commande)


@router.patch(
    "/{commande_id}/version-linguistique",
    response_model=CommandeOut,
    dependencies=[Depends(require_roles(Role.ADMIN_NATIONAL, Role.SUPER_ADMIN))],
)
async def modifier_version_linguistique(
    commande_id: str,
    payload: CommandeVersionLinguistiqueUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CommandeOut:
    commande = await db.get(Commande, commande_id)
    if commande is None:
        raise HTTPException(status_code=404, detail="Commande introuvable.")
    require_same_country_or_super_admin(commande.pays_id, current_user)
    if commande.statut != StatutCommande.EN_ATTENTE_PAIEMENT:
        raise HTTPException(status_code=409, detail="Modification impossible après paiement.")
    commande.langue_version = payload.langue_version
    await db.commit()
    await db.refresh(commande)
    return CommandeOut.model_validate(commande)


@router.get("/{commande_id}/facture")
async def telecharger_facture(
    commande_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    commande = await db.get(Commande, commande_id)
    if commande is None:
        raise HTTPException(status_code=404, detail="Commande introuvable.")
    require_same_country_or_super_admin(commande.pays_id, current_user)

    pays = await db.get(Pays, commande.pays_id)
    pdf_bytes = generer_facture_pdf(commande, pays)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="facture-{commande_id[:8]}.pdf"'},
    )
