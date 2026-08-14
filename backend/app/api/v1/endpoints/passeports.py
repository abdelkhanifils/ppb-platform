"""
Module 3 — Impression (Document technique, section 3, M3).

Attribution automatique (numérotation, QR/UUID, signature — voir
app.services.attribution) déclenchée en interne par la confirmation du
paiement (Module 2) — jamais appelée directement par un client. La
publication vers l'index de vérification (Module 5) est event-driven, dans
la même transaction que l'attribution (voir app.services.attribution.publier_passeports).
"""
from datetime import datetime, timezone
import base64

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import CurrentUser, get_current_user, require_roles, require_same_country_or_super_admin
from app.core.rbac import Role
from app.core.signing import cle_publique_pem
from app.db.session import get_db
from app.models.autorisation_impression import AutorisationImpression
from app.models.commande import Commande
from app.models.passeport import Passeport, StatutPasseport
from app.schemas.passeport import AutorisationImpressionCreate, AutorisationImpressionOut, DeclarerLotRequest
from app.services.attribution import attribuer_passeports_pour_commande, publier_passeports
from app.services.audit import journaliser
from app.services.qrcode_service import generer_qrcode_png_base64

router = APIRouter(prefix="/passeports", tags=["Module 3 — Impression"])


# --- Attribution (interne, event-driven) --------------------------------------------------


@router.post("/attribuer", include_in_schema=False)
async def attribuer_passeports(commande_id: str, db: AsyncSession = Depends(get_db)):
    """Point d'entrée interne — en production, l'attribution est déclenchée
    directement en mémoire par le Module 2 (voir
    app/api/v1/endpoints/paiements.py, validation du paiement présentiel),
    dans la même transaction que la confirmation du paiement. Ce endpoint
    reste disponible pour un rejeu manuel (ops) ou un appel de test isolé,
    mais ne doit jamais être exposé à un client externe."""
    commande = await db.get(Commande, commande_id)
    if commande is None:
        raise HTTPException(status_code=404, detail="Commande introuvable.")

    passeports = await attribuer_passeports_pour_commande(db, commande)
    await db.commit()
    return {"passeports_crees": len(passeports)}


@router.post(
    "/sync/publier-nouveaux-passeports",
    dependencies=[Depends(require_roles(Role.SUPER_ADMIN))],
)
async def republier_passeports_non_publies(db: AsyncSession = Depends(get_db)):
    """La publication normale est automatique et immédiate (même transaction que
    l'attribution — voir app.services.attribution.publier_passeports). Ce
    endpoint est un filet de sécurité opérationnel : il republie tout
    passeport resté non publié après un incident applicatif, sans jamais
    dupliquer l'attribution elle-même (idempotent : republier un passeport
    déjà publié se contente de rafraîchir son horodatage)."""
    result = await db.execute(select(Passeport).where(Passeport.publie_le.is_(None)))
    passeports_a_publier = result.scalars().all()
    publier_passeports(passeports_a_publier)
    await db.commit()
    return {"republies": len(passeports_a_publier)}


# --- Consultation ---------------------------------------------------------------------------


@router.get("", response_model=None)
async def lister_passeports(
    pays_id: int | None = None,
    statut: StatutPasseport | None = None,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(Passeport)
    if current_user.role != Role.SUPER_ADMIN:
        query = query.where(Passeport.pays_id == current_user.pays_id)
    elif pays_id is not None:
        query = query.where(Passeport.pays_id == pays_id)
    if statut is not None:
        query = query.where(Passeport.statut == statut)
    result = await db.execute(query)
    return [
        {
            "id": p.id,
            "numero": f"{p.numero_pays}-{p.numero_annee}-{p.numero_lot}",
            "qr_uuid": p.qr_uuid,
            "statut": p.statut,
            "publie": p.publie_le is not None,
        }
        for p in result.scalars().all()
    ]


@router.get("/{passeport_id}/qrcode")
async def qrcode_passeport(
    passeport_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """PNG du QR Code de validation (page 2 du gabarit) — utilisé pour
    l'impression centralisée et l'aperçu Web Admin avant impression."""
    passeport = await db.get(Passeport, passeport_id)
    if passeport is None:
        raise HTTPException(status_code=404, detail="Passeport introuvable.")
    if current_user.role != Role.SUPER_ADMIN and current_user.pays_id != passeport.pays_id:
        raise HTTPException(status_code=403, detail="Accès limité aux passeports de votre pays.")

    png_bytes = base64.b64decode(generer_qrcode_png_base64(passeport.qr_uuid))
    return Response(content=png_bytes, media_type="image/png")


@router.get("/cle-publique")
async def obtenir_cle_publique():
    """Clé publique de vérification des signatures — SEULE donnée cryptographique
    distribuée aux applications de contrôle (Module 5) ; jamais la clé privée.
    Aucune restriction RBAC : cette clé est par nature publique."""
    pem = cle_publique_pem()
    return Response(content=pem, media_type="application/x-pem-file")


# --- Impression centralisée ------------------------------------------------------------------


@router.post(
    "/impression-centralisee/confirmer",
    dependencies=[Depends(require_roles(Role.SUPER_ADMIN))],
)
async def confirmer_impression_centralisee(
    commande_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """« Le lot est mis en file d'impression au siège de la CEBEVIRHA ; le statut
    passe à « vierge » dès confirmation d'impression. » (Document technique, M3)"""
    result = await db.execute(
        select(Passeport).where(Passeport.commande_id == commande_id, Passeport.statut == StatutPasseport.PRECHARGE)
    )
    passeports = result.scalars().all()
    if not passeports:
        raise HTTPException(status_code=404, detail="Aucun passeport PRECHARGE trouvé pour cette commande.")

    for passeport in passeports:
        passeport.statut = StatutPasseport.VIERGE

    await journaliser(
        db,
        utilisateur_id=current_user.id,
        action="impression_centralisee.confirmee",
        entite="Commande",
        entite_id=commande_id,
        nouvelle_valeur={"quantite": len(passeports)},
    )
    await db.commit()
    return {"statut": "confirme", "quantite": len(passeports)}


# --- Impression décentralisée — autorisations -------------------------------------------------


@router.get("/autorisations-impression/{pays_id}", response_model=AutorisationImpressionOut)
async def consulter_autorisation_impression(pays_id: int, db: AsyncSession = Depends(get_db)) -> AutorisationImpressionOut:
    result = await db.execute(
        select(AutorisationImpression).where(
            AutorisationImpression.pays_id == pays_id, AutorisationImpression.active.is_(True)
        )
    )
    autorisation = result.scalar_one_or_none()
    if autorisation is None:
        raise HTTPException(status_code=404, detail="Aucune autorisation active pour ce pays.")
    return AutorisationImpressionOut.model_validate(autorisation)


@router.post(
    "/autorisations-impression",
    response_model=AutorisationImpressionOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(Role.SUPER_ADMIN))],
)
async def creer_autorisation_impression(
    payload: AutorisationImpressionCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AutorisationImpressionOut:
    if payload.plage_fin <= payload.plage_debut:
        raise HTTPException(status_code=422, detail="plage_fin doit être strictement supérieur à plage_debut.")

    result = await db.execute(
        select(AutorisationImpression).where(
            AutorisationImpression.pays_id == payload.pays_id, AutorisationImpression.active.is_(True)
        )
    )
    for existante in result.scalars().all():
        if payload.plage_debut <= existante.plage_fin and payload.plage_fin >= existante.plage_debut:
            raise HTTPException(
                status_code=409,
                detail=f"Chevauchement avec une autorisation active existante ({existante.plage_debut}-{existante.plage_fin}).",
            )

    autorisation = AutorisationImpression(
        pays_id=payload.pays_id,
        plage_debut=payload.plage_debut,
        plage_fin=payload.plage_fin,
        gabarit_version=payload.gabarit_version,
    )
    db.add(autorisation)
    await db.flush()

    await journaliser(
        db,
        utilisateur_id=current_user.id,
        action="autorisation_impression.creee",
        entite="AutorisationImpression",
        entite_id=autorisation.id,
        nouvelle_valeur=payload.model_dump(),
    )
    await db.commit()
    await db.refresh(autorisation)
    return AutorisationImpressionOut.model_validate(autorisation)


@router.post(
    "/autorisations-impression/{autorisation_id}/suspendre",
    dependencies=[Depends(require_roles(Role.SUPER_ADMIN))],
)
async def suspendre_autorisation_impression(
    autorisation_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """« Droit de suspension immédiat par la CEBEVIRHA en cas d'anomalie constatée
    lors d'un audit. » (Document technique, M3 — Garde-fous)"""
    autorisation = await db.get(AutorisationImpression, autorisation_id)
    if autorisation is None:
        raise HTTPException(status_code=404, detail="Autorisation introuvable.")
    if not autorisation.active:
        raise HTTPException(status_code=409, detail="Cette autorisation est déjà suspendue.")

    autorisation.active = False
    autorisation.suspendue_par_id = current_user.id

    await journaliser(
        db,
        utilisateur_id=current_user.id,
        action="autorisation_impression.suspendue",
        entite="AutorisationImpression",
        entite_id=autorisation.id,
    )
    await db.commit()
    return {"id": autorisation.id, "active": False}


# --- Impression décentralisée — déclaration ----------------------------------------------------


@router.post(
    "/impression-decentralisee/declarer",
    dependencies=[Depends(require_roles(Role.SUPER_ADMIN, Role.ADMIN_NATIONAL))],
)
async def declarer_lot_imprime(
    payload: DeclarerLotRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Plage de numéros fermée — toute déclaration hors plage autorisée est
    rejetée (HTTP 422) ; tout numéro absent ou déjà imprimé est rejeté avant
    la moindre écriture (déclaration atomique, jamais partielle)."""
    require_same_country_or_super_admin(payload.pays_id, current_user)

    if payload.numero_fin <= payload.numero_debut:
        raise HTTPException(status_code=422, detail="numero_fin doit être strictement supérieur à numero_debut.")

    result = await db.execute(
        select(AutorisationImpression).where(
            AutorisationImpression.pays_id == payload.pays_id, AutorisationImpression.active.is_(True)
        )
    )
    autorisation = result.scalar_one_or_none()
    if autorisation is None:
        raise HTTPException(status_code=422, detail="Aucune autorisation d'impression décentralisée active.")
    if payload.numero_debut < autorisation.plage_debut or payload.numero_fin > autorisation.plage_fin:
        raise HTTPException(status_code=422, detail="Plage de numéros hors autorisation — rejeté.")

    # La plage autorisée porte sur des numéros de lot ; l'année est celle de
    # l'attribution en cours (limitation documentée : une AutorisationImpression
    # ne couvre pas explicitement plusieurs années dans ce modèle).
    annee_courante = str(datetime.now(timezone.utc).year)
    numeros_attendus = {str(n).zfill(7) for n in range(payload.numero_debut, payload.numero_fin + 1)}

    result = await db.execute(
        select(Passeport).where(
            Passeport.pays_id == payload.pays_id,
            Passeport.numero_annee == annee_courante,
            Passeport.numero_lot.in_(numeros_attendus),
        )
    )
    passeports = result.scalars().all()

    manquants = numeros_attendus - {p.numero_lot for p in passeports}
    if manquants:
        raise HTTPException(
            status_code=404,
            detail=f"{len(manquants)} numéro(s) de la plage introuvable(s) pour ce pays/année — aucune écriture effectuée.",
        )
    deja_traites = [p.numero_lot for p in passeports if p.statut != StatutPasseport.PRECHARGE]
    if deja_traites:
        raise HTTPException(
            status_code=409,
            detail=f"{len(deja_traites)} numéro(s) déjà imprimé(s) ou à un autre statut — aucune écriture effectuée.",
        )

    for passeport in passeports:
        passeport.statut = StatutPasseport.VIERGE

    await journaliser(
        db,
        utilisateur_id=current_user.id,
        action="impression_decentralisee.lot_declare",
        entite="Passeport",
        entite_id=f"{payload.pays_id}:{payload.numero_debut}-{payload.numero_fin}",
        nouvelle_valeur={"quantite": len(passeports), "numero_debut": payload.numero_debut, "numero_fin": payload.numero_fin},
    )
    await db.commit()
    return {"statut": "declare", "quantite": len(passeports), "responsable": current_user.id}
