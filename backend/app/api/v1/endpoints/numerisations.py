"""
Module 4 — Scan / numérisation terrain (Document technique, section 3, M4).

Chaque page a un rôle précis (page 1 : vérif. visuelle ; page 2 : sélection
du passeport via QR ; pages 3-4 : création des entités métier). Aucune
image n'est transmise ni conservée côté serveur — seules les données
validées par l'agent le sont. Une fois les 4 pages synchronisées, le
backend crée Eleveur, Convoyeur, Itineraire (page 3) et Troupeau (+
TroupeauEspece), Vaccination (page 4) — voir app/services/emission.py.

Idempotence : la transmission d'une page déjà connue (retour réseau perdu
côté client après un succès serveur, retentative automatique) met à jour la
ligne existante plutôt que d'en créer une seconde — la contrainte
d'unicité (passeport_id, page_num) protège ce comportement au niveau base.
La création des entités métier n'est déclenchée qu'une fois, garantie par
la vérification `passeport.statut != EMIS` avant d'y entrer : rejouer la
page 4 après coup ne recrée jamais un second Troupeau (par ailleurs
impossible, `Troupeau.passeport_id` est UNIQUE).
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import CurrentUser, get_current_user, require_roles, require_same_country_or_super_admin
from app.core.rbac import Role
from app.db.session import get_db
from app.models.numerisation import Numerisation, StatutSync, StatutValidation
from app.models.passeport import Passeport, StatutPasseport
from app.services.emission import creer_entites_page3, creer_entites_page4

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
