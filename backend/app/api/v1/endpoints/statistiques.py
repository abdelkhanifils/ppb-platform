"""
Module transversal — Exploitation statistique (Document technique, section 5).

Alimenté en continu par les synchronisations des modules Impression, Scan et
Contrôle. Trois axes d'agrégation portables (par pays, par phase, par poste —
voir app/services/statistiques.py) et un axe géospatial PostGIS (clustering
et GeoJSON des mouvements — voir app/services/geospatial.py, PostgreSQL
uniquement, avec repli portable en développement/test).
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import require_roles
from app.core.rbac import Role
from app.db.session import get_db
from app.models.commande import Commande
from app.models.paiement import Paiement, StatutPaiement
from app.services.export_excel import CATEGORIES_VALIDES, generer_export_excel
from app.services.geospatial import clusteriser_controles, points_controles_geojson
from app.services.statistiques import agreger_par_pays, agreger_par_pays_et_annee, agreger_par_phase, agreger_par_poste

router = APIRouter(prefix="/statistiques", tags=["Statistiques"])

_lecture_seule = Depends(require_roles(Role.SUPER_ADMIN, Role.ADMIN_NATIONAL, Role.CONSULTATION))


@router.get("/tableau-bord", dependencies=[_lecture_seule])
async def tableau_bord(db: AsyncSession = Depends(get_db)):
    """Vue de synthèse régionale — combine les trois axes d'agrégation pour un
    premier écran de tableau de bord (le détail par pays/poste/phase est
    disponible sur les endpoints dédiés ci-dessous pour une exploration plus fine)."""
    par_pays = await agreger_par_pays(db)
    par_phase = await agreger_par_phase(db)
    return {
        "par_pays": par_pays,
        "entonnoir_global": par_phase["phases"],
        "totaux": {
            "nb_pays": len(par_pays),
            "nb_commandes_total": sum(p["nb_commandes"] for p in par_pays),
            "montant_encaisse_total_xaf": sum(p["montant_encaisse_xaf"] for p in par_pays),
        },
    }


@router.get("/par-pays", dependencies=[_lecture_seule])
async def statistiques_par_pays(db: AsyncSession = Depends(get_db)):
    return await agreger_par_pays(db)


@router.get("/par-pays-annee", dependencies=[_lecture_seule])
async def statistiques_par_pays_annee(pays_id: int | None = None, db: AsyncSession = Depends(get_db)):
    """Vue croisée pays x année — commandes, paiements (par moyen),
    passeports imprimés, contrôles (par résultat). Voir
    app.services.statistiques.agreger_par_pays_et_annee pour le détail des
    règles d'agrégation."""
    return await agreger_par_pays_et_annee(db, pays_id=pays_id)


@router.get("/par-phase", dependencies=[_lecture_seule])
async def statistiques_par_phase(pays_id: int | None = None, db: AsyncSession = Depends(get_db)):
    return await agreger_par_phase(db, pays_id=pays_id)


@router.get("/par-poste", dependencies=[_lecture_seule])
async def statistiques_par_poste(pays_id: int | None = None, db: AsyncSession = Depends(get_db)):
    return await agreger_par_poste(db, pays_id=pays_id)


@router.get("/ventes", dependencies=[_lecture_seule])
async def statistiques_ventes(pays_id: int | None = None, db: AsyncSession = Depends(get_db)):
    query = select(func.count(Paiement.id), func.coalesce(func.sum(Paiement.montant), 0)).where(
        Paiement.statut == StatutPaiement.VALIDE
    )
    if pays_id is not None:
        query = query.select_from(Paiement).join(Commande, Paiement.commande_id == Commande.id).where(
            Commande.pays_id == pays_id
        )
    result = await db.execute(query)
    nombre, montant_total = result.one()
    return {"nombre_ppb_vendus": nombre, "montant_total_encaisse_xaf": float(montant_total)}


@router.get("/carte-mouvements", dependencies=[_lecture_seule])
async def carte_mouvements(
    rayon_metres: float = Query(5_000, ge=100, le=200_000),
    min_points: int = Query(2, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
):
    """Clusters de contrôles géolocalisés (PostGIS `ST_ClusterDBSCAN` en
    production) — vue régionale à faible zoom pour la carte du tableau de bord."""
    return {"clusters": await clusteriser_controles(db, rayon_metres=rayon_metres, min_points=min_points)}


@router.get("/carte-mouvements/points", dependencies=[_lecture_seule])
async def carte_mouvements_points(db: AsyncSession = Depends(get_db)):
    """Points bruts (GeoJSON FeatureCollection) — affichage à fort zoom, quand
    le clustering régional n'est plus pertinent."""
    return await points_controles_geojson(db)


@router.get("/export", dependencies=[_lecture_seule])
async def export_statistiques(
    categories: str = "commandes,paiements,passeports_emis,controles",
    pays_id: int | None = None,
    annee: int | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Export Excel détaillé (un onglet par catégorie), filtrable par pays
    et par année — voir app.services.export_excel pour le contenu exact de
    chaque onglet. `categories` : liste séparée par des virgules parmi
    commandes, paiements, passeports_emis, controles (ou "tout")."""
    demandees = {c.strip() for c in categories.split(",") if c.strip()}
    if "tout" in demandees:
        demandees = set(CATEGORIES_VALIDES)
    categories_invalides = demandees - CATEGORIES_VALIDES
    if categories_invalides:
        raise HTTPException(status_code=422, detail=f"Catégories inconnues : {', '.join(sorted(categories_invalides))}")

    classeur_bytes = await generer_export_excel(db, demandees, pays_id=pays_id, annee=annee)
    return Response(
        content=classeur_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="statistiques-ppb.xlsx"'},
    )
