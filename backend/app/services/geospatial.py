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
from app.models.passeport import Passeport

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


async def clusteriser_controles(
    db: AsyncSession, rayon_metres: float = 5_000, min_points: int = 1, pays_id: int | None = None
) -> list[dict]:
    """Regroupe les contrôles géolocalisés en clusters spatiaux — la donnée
    consommée par la carte régionale à faible zoom (voir
    frontend/src/pages/Statistiques.tsx). PostGIS `ST_ClusterDBSCAN` en
    production ; repli par grille en test/dev sans PostGIS.

    `min_points=1` par défaut (pas 2) : avec `min_points >= 2`, DBSCAN exclut
    tout point n'ayant AUCUN voisin dans le rayon comme "bruit" — un contrôle
    isolé (aucun autre à proximité) disparaissait alors silencieusement de la
    carte, jamais affiché nulle part, bug réel corrigé ici. Avec 1, chaque
    point forme au moins son propre cluster à lui seul : rien n'est jamais
    masqué, seuls les points suffisamment proches se regroupent visuellement.

    `pays_id` restreint aux contrôles portant sur des passeports de ce pays
    (jointure sur `passeports`) — indispensable pour qu'un Admin National ne
    voie jamais les mouvements d'un autre pays sur cette carte."""
    if await _est_postgresql(db):
        rayon_degres = rayon_metres / METRES_PAR_DEGRE_EQUATEUR
        filtre_pays = "AND c.passeport_id IN (SELECT id FROM passeports WHERE pays_id = :pays_id)" if pays_id is not None else ""
        requete = text(
            f"""
            WITH points AS (
                SELECT
                    c.id, c.resultat, c.latitude, c.longitude,
                    ST_ClusterDBSCAN(
                        ST_SetSRID(ST_MakePoint(c.longitude::float, c.latitude::float), 4326),
                        :rayon, :min_points
                    ) OVER () AS cluster_id
                FROM controles c
                WHERE c.latitude IS NOT NULL AND c.longitude IS NOT NULL
                {filtre_pays}
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
        params: dict = {"rayon": rayon_degres, "min_points": min_points}
        if pays_id is not None:
            params["pays_id"] = pays_id
        result = await db.execute(requete, params)
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

    return await _clusteriser_par_grille(db, rayon_metres, pays_id=pays_id)


async def _clusteriser_par_grille(db: AsyncSession, rayon_metres: float, pays_id: int | None = None) -> list[dict]:
    """Repli portable (SQLite) : regroupe les points tombant dans la même
    case d'une grille de la taille du rayon demandé — approximation
    suffisante pour tester la logique d'agrégation, pas la géométrie exacte."""
    query = select(Controle).where(Controle.latitude.is_not(None), Controle.longitude.is_not(None))
    if pays_id is not None:
        query = query.join(Passeport, Controle.passeport_id == Passeport.id).where(Passeport.pays_id == pays_id)
    result = await db.execute(query)
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


async def points_controles_geojson(db: AsyncSession, pays_id: int | None = None) -> dict:
    """FeatureCollection GeoJSON des contrôles géolocalisés — affichage brut à
    fort zoom ; préférer `clusteriser_controles` pour une vue régionale.
    `pays_id` : même restriction que `clusteriser_controles` ci-dessus."""
    if await _est_postgresql(db):
        filtre_pays = "AND c.passeport_id IN (SELECT id FROM passeports WHERE pays_id = :pays_id)" if pays_id is not None else ""
        requete = text(
            f"""
            SELECT c.id, c.resultat, c.poste_id,
                   ST_AsGeoJSON(ST_SetSRID(ST_MakePoint(c.longitude::float, c.latitude::float), 4326)) AS geometrie
            FROM controles c
            WHERE c.latitude IS NOT NULL AND c.longitude IS NOT NULL
            {filtre_pays}
            """
        )
        params: dict = {}
        if pays_id is not None:
            params["pays_id"] = pays_id
        result = await db.execute(requete, params)
        features = [
            {
                "type": "Feature",
                "geometry": json.loads(row.geometrie),
                "properties": {"id": row.id, "resultat": row.resultat, "poste_id": row.poste_id},
            }
            for row in result
        ]
    else:
        query = select(Controle).where(Controle.latitude.is_not(None), Controle.longitude.is_not(None))
        if pays_id is not None:
            query = query.join(Passeport, Controle.passeport_id == Passeport.id).where(Passeport.pays_id == pays_id)
        result = await db.execute(query)
        features = [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [float(c.longitude), float(c.latitude)]},
                "properties": {"id": c.id, "resultat": c.resultat.value, "poste_id": c.poste_id},
            }
            for c in result.scalars().all()
        ]

    return {"type": "FeatureCollection", "features": features}
