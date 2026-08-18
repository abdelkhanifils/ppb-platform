"""
Module 4 — Scan / numérisation terrain (Document technique, section 3, M4).

Chaque page a un rôle précis (page 1 : vérif. visuelle ; page 2 : sélection
du passeport via QR ; pages 3-4 : création des entités métier). Aucune
image n'est transmise ni conservée côté serveur pour la VALIDATION des
pages — seules les données saisies/corrigées par l'agent le sont. SEULE
EXCEPTION : l'OCR assisté (voir la route .../ocr plus bas et
app/services/ocr_service.py), qui reçoit une photo à la seule fin de
pré-remplir le formulaire ; cette photo est conservée temporairement (voir
app/models/photo_ocr.py) — une décision distincte, explicite, jamais
étendue silencieusement au reste du module.

Idempotence : la transmission d'une page déjà connue (retour réseau perdu
côté client après un succès serveur, retentative automatique) met à jour la
ligne existante plutôt que d'en créer une seconde — la contrainte
d'unicité (passeport_id, page_num) protège ce comportement au niveau base.
La création des entités métier n'est déclenchée qu'une fois, garantie par
la vérification `passeport.statut != EMIS` avant d'y entrer : rejouer la
page 4 après coup ne recrée jamais un second Troupeau (par ailleurs
impossible, `Troupeau.passeport_id` est UNIQUE).
"""
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import CurrentUser, get_current_user, require_roles, require_same_country_or_super_admin
from app.core.rbac import Role
from app.db.session import get_db
from app.models.numerisation import Numerisation, StatutSync, StatutValidation
from app.models.passeport import Passeport, StatutPasseport
from app.models.photo_ocr import PhotoOcr
from app.services.emission import creer_entites_page3, creer_entites_page4
from app.services.ocr_service import OcrIndisponible, appeler_google_vision, extraire_champs_page3, extraire_champs_page4

router = APIRouter(tags=["Module 4 — Scan"])


@router.post(
    "/numerisations/{passeport_id}/pages/{page_num}",
    dependencies=[Depends(require_roles(Role.AGENT_EMISSION))],
)
async def transmettre_page(
    passeport_id: str,
    page_num: int,
    donnees_json: dict | None,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if page_num not in (1, 2, 3, 4):
        raise HTTPException(status_code=422, detail="page_num doit être compris entre 1 et 4.")

    passeport = await db.get(Passeport, passeport_id)
    if passeport is None:
        raise HTTPException(status_code=404, detail="Passeport introuvable.")
    # Corrigé lors de la revue de sécurité : sans ce contrôle, un agent
    # d'émission connaissant (ou devinant) l'UUID d'un passeport d'un AUTRE
    # pays pouvait le numériser — improbable vu l'espace des UUID, mais le
    # principe de moindre privilège doit être respecté indépendamment de la
    # difficulté pratique d'exploitation.
    require_same_country_or_super_admin(passeport.pays_id, current_user)

    result = await db.execute(
        select(Numerisation).where(Numerisation.passeport_id == passeport_id, Numerisation.page_num == page_num)
    )
    numerisation_existante = result.scalar_one_or_none()
    if numerisation_existante is not None:
        # Rejeu idempotent (ex. réponse réseau perdue après succès serveur) — on
        # met à jour la donnée mais on ne recrée jamais les entités métier.
        numerisation_existante.donnees_json = donnees_json
        numerisation_existante.agent_id = current_user.id
    else:
        db.add(
            Numerisation(
                passeport_id=passeport_id,
                page_num=page_num,
                donnees_json=donnees_json,
                statut_validation=StatutValidation.VALIDEE,
                statut_sync=StatutSync.SYNCHRONISEE,
                agent_id=current_user.id,
            )
        )

    result = await db.execute(select(Numerisation).where(Numerisation.passeport_id == passeport_id))
    toutes_numerisations = result.scalars().all()
    pages_validees = {n.page_num for n in toutes_numerisations}

    if pages_validees == {1, 2, 3, 4} and passeport.statut != StatutPasseport.EMIS:
        donnees_par_page = {n.page_num: n.donnees_json for n in toutes_numerisations}
        await creer_entites_page3(db, passeport_id, donnees_par_page.get(3) or {})
        await creer_entites_page4(db, passeport_id, donnees_par_page.get(4) or {})
        passeport.statut = StatutPasseport.EMIS

    await db.commit()
    return {"page_num": page_num, "statut_passeport": passeport.statut}


@router.get("/numerisations/{passeport_id}")
async def consulter_numerisations(passeport_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Numerisation).where(Numerisation.passeport_id == passeport_id))
    return [
        {"page_num": n.page_num, "statut_validation": n.statut_validation, "statut_sync": n.statut_sync}
        for n in result.scalars().all()
    ]


@router.get("/passeports/cache-emission", dependencies=[Depends(require_roles(Role.AGENT_EMISSION))])
async def cache_emission(
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Liste des numéros préchargés pour usage hors-ligne (PWA / IndexedDB côté client)."""
    result = await db.execute(
        select(Passeport).where(
            Passeport.pays_id == current_user.pays_id, Passeport.statut == StatutPasseport.VIERGE
        )
    )
    return [{"id": p.id, "qr_uuid": p.qr_uuid, "numero": f"{p.numero_pays}-{p.numero_annee}-{p.numero_lot}"} for p in result.scalars().all()]


@router.post(
    "/numerisations/{passeport_id}/pages/{page_num}/ocr",
    dependencies=[Depends(require_roles(Role.AGENT_EMISSION))],
)
async def reconnaitre_page_ocr(
    passeport_id: str,
    page_num: int,
    photo: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Reconnaissance automatique (OCR) d'une page 3 ou 4 photographiée —
    renvoie des CHAMPS SUGGÉRÉS pour pré-remplir le formulaire de saisie,
    jamais une validation directe : l'agent revoit et corrige chaque champ
    avant de valider la page (voir POST .../pages/{page_num} ci-dessus, un
    appel séparé et obligatoire). Si `GOOGLE_VISION_SERVICE_ACCOUNT_JSON_B64` n'est pas
    configurée ou que l'appel échoue, répond 503 plutôt qu'une erreur
    opaque — le frontend retombe alors sur le formulaire vierge, jamais
    bloqué par cette fonctionnalité optionnelle."""
    if page_num not in (3, 4):
        raise HTTPException(status_code=422, detail="OCR disponible uniquement pour les pages 3 et 4.")

    passeport = await db.get(Passeport, passeport_id)
    if passeport is None:
        raise HTTPException(status_code=404, detail="Passeport introuvable.")
    require_same_country_or_super_admin(passeport.pays_id, current_user)

    contenu = await photo.read()
    if not contenu:
        raise HTTPException(status_code=422, detail="Photo vide.")

    try:
        mots = await appeler_google_vision(contenu)
    except OcrIndisponible as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    champs = extraire_champs_page3(mots) if page_num == 3 else extraire_champs_page4(mots)

    db.add(
        PhotoOcr(
            passeport_id=passeport_id,
            page_num=page_num,
            image_bytes=contenu,
            image_content_type=photo.content_type or "image/jpeg",
            resultat_ocr_brut={"mots": mots},
            agent_id=current_user.id,
        )
    )
    await db.commit()

    return {"champs": champs}
