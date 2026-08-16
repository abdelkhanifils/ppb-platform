"""
Agrégations géospatiales PostGIS — carte des mouvements du tableau de bord
régional (Document technique, Module transversal Statistiques).

Choix d'implémentation : les coordonnées sont stockées en colonnes simples
(`Controle.latitude`/`longitude`, `Poste.latitude`/`longitude` — portables
sur tout moteur SQL), et les fonctions PostGIS (`ST_MakePoint`,
`ST_ClusterDBSCAN`, `ST_AsGeoJSON`) sont appliquées à la volée, en SQL brut,
uniquement quand le moteur de base est PostgreSQL — jamais persistées dans
une colonne géométrique dédiée. Deux raisons à ce choix :
1. Portabilité des tests : la suite tourne sur SQLite (aiosqlite), qui n'a
   pas d'extension PostGIS ; une colonne `Geometry` figerait le schéma sur
   un seul moteur.
2. Le calcul géospatial n'a de sens qu'à la lecture agrégée (carte, cluster) —
   jamais en écriture unitaire — donc rien ne justifie de le pré-calculer et
   de le stocker.

En dehors de PostgreSQL (tests, dev sans PostGIS), un repli Python pur
reproduit un clustering approximatif par grille — suffisant pour valider la
LOGIQUE d'agrégation (comptages, regroupements, structure de réponse), mais
PAS la précision géométrique du clustering réel, qui doit être vérifiée
contre une vraie base PostgreSQL+PostGIS (voir docker-compose.yml, image
`postgis/postgis`).
"""
import json
from collections import defaultdict

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.controle import Controle

METRES_PAR_DEGRE_EQUATEUR = 111_320  # conversion approximative, suffisante à l'échelle régionale CEMAC

# Résultat mis en cache par connexion à la base (processus) — évite de
# retenter la requête de sondage à chaque appel une fois la réponse connue.
_postgis_disponible: bool | None = None


async def _est_postgresql(db: AsyncSession) -> bool:
    """PostGIS réellement utilisable — pas seulement "la base est du
    PostgreSQL". Un déploiement utilisant l'offre PostgreSQL standard de
    Railway (sans l'image `postgis/postgis`, voir RAILWAY_DEPLOY.md
    §"Pour aller plus loin") a un dialecte "postgresql" mais AUCUNE des
    fonctions ST_* — les appeler provoque une erreur SQL, pas un simple
    résultat vide. Vérifié une fois par sondage (`SELECT PostGIS_version()`),
    jamais supposé à partir du seul nom du dialecte (bug réel corrigé ici :
    la carte des mouvements plantait en production faute de cette
    vérification)."""
    global _postgis_disponible
    if db.get_bind().dialect.name != "postgresql":
        return False
    if _postgis_disponible is not None:
        return _postgis_disponible
    try:
        await db.execute(text("SELECT PostGIS_version()"))
        _postgis_disponible = True
    except Exception:
        await db.rollback()  # la tentative échouée laisse la transaction en erreur — indispensable avant de continuer
        _postgis_disponible = False
    return _postgis_disponible


async def clusteriser_controles(db: AsyncSession, rayon_metres: float = 5_000, min_points: int = 2) -> list[dict]:
    """Regroupe les contrôles géolocalisés en clusters spatiaux — la donnée
    consommée par la carte régionale à faible zoom (voir
    frontend/src/pages/Statistiques.tsx). PostGIS `ST_ClusterDBSCAN` en
    production ; repli par grille en test/dev sans PostGIS."""
    if await _est_postgresql(db):
        rayon_degres = rayon_metres / METRES_PAR_DEGRE_EQUATEUR
        requete = text(
            """
            WITH points AS (
                SELECT
                    id, resultat, latitude, longitude,
                    ST_ClusterDBSCAN(
                        ST_SetSRID(ST_MakePoint(longitude::float, latitude::float), 4326),
                        :rayon, :min_points
                    ) OVER () AS cluster_id
                FROM controles
                WHERE latitude IS NOT NULL AND longitude IS NOT NULL
            )
            SELECT
                cluster_id,
                COUNT(*) AS nombre,
                AVG(latitude) AS latitude_centre,
                AVG(longitude) AS longitude_centre,
                SUM(CASE WHEN resultat = 'valide' THEN 1 ELSE 0 END) AS valides,
                SUM(CASE WHEN resultat = 'refuse' THEN 1 ELSE 0 END) AS refuses,
                SUM(CASE WHEN resultat = 'a_verifier' THEN 1 ELSE 0 END) AS a_verifier
            FROM points
            WHERE cluster_id IS NOT NULL
            GROUP BY cluster_id
            ORDER BY nombre DESC
            """
        )
        result = await db.execute(requete, {"rayon": rayon_degres, "min_points": min_points})
        return [
            {
                "cluster_id": row.cluster_id,
                "nombre": row.nombre,
                "latitude_centre": float(row.latitude_centre),
                "longitude_centre": float(row.longitude_centre),
                "valides": row.valides,
                "refuses": row.refuses,
                "a_verifier": row.a_verifier,
            }
            for row in result
        ]

    return await _clusteriser_par_grille(db, rayon_metres)


async def _clusteriser_par_grille(db: AsyncSession, rayon_metres: float) -> list[dict]:
    """Repli portable (SQLite) : regroupe les points tombant dans la même
    case d'une grille de la taille du rayon demandé — approximation
    suffisante pour tester la logique d'agrégation, pas la géométrie exacte."""
    result = await db.execute(select(Controle).where(Controle.latitude.is_not(None), Controle.longitude.is_not(None)))
    controles = result.scalars().all()
    if not controles:
        return []

    taille_case_degres = rayon_metres / METRES_PAR_DEGRE_EQUATEUR
    groupes: dict[tuple[int, int], list[Controle]] = defaultdict(list)
    for c in controles:
        case = (round(float(c.latitude) / taille_case_degres), round(float(c.longitude) / taille_case_degres))
        groupes[case].append(c)

    clusters = []
    for i, membres in enumerate(groupes.values()):
        lat_moyenne = sum(float(m.latitude) for m in membres) / len(membres)
        lon_moyenne = sum(float(m.longitude) for m in membres) / len(membres)
        clusters.append(
            {
                "cluster_id": i,
                "nombre": len(membres),
                "latitude_centre": lat_moyenne,
                "longitude_centre": lon_moyenne,
                "valides": sum(1 for m in membres if m.resultat.value == "valide"),
                "refuses": sum(1 for m in membres if m.resultat.value == "refuse"),
                "a_verifier": sum(1 for m in membres if m.resultat.value == "a_verifier"),
            }
        )
    return sorted(clusters, key=lambda c: c["nombre"], reverse=True)


async def points_controles_geojson(db: AsyncSession) -> dict:
    """FeatureCollection GeoJSON des contrôles géolocalisés — affichage brut à
    fort zoom ; préférer `clusteriser_controles` pour une vue régionale."""
    if await _est_postgresql(db):
        requete = text(
            """
            SELECT id, resultat, poste_id,
                   ST_AsGeoJSON(ST_SetSRID(ST_MakePoint(longitude::float, latitude::float), 4326)) AS geometrie
            FROM controles
            WHERE latitude IS NOT NULL AND longitude IS NOT NULL
            """
        )
        result = await db.execute(requete)
        features = [
            {
                "type": "Feature",
                "geometry": json.loads(row.geometrie),
                "properties": {"id": row.id, "resultat": row.resultat, "poste_id": row.poste_id},
            }
            for row in result
        ]
    else:
        result = await db.execute(select(Controle).where(Controle.latitude.is_not(None), Controle.longitude.is_not(None)))
        features = [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [float(c.longitude), float(c.latitude)]},
                "properties": {"id": c.id, "resultat": c.resultat.value, "poste_id": c.poste_id},
            }
            for c in result.scalars().all()
        ]

    return {"type": "FeatureCollection", "features": features}
