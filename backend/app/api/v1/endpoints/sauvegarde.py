"""
Module Sauvegarde — export manuel des données métier, PAS une sauvegarde
d'infrastructure.

Distinction importante, affichée aussi côté interface (voir
frontend/src/pages/Administration.tsx::SectionSauvegarde) : la sauvegarde
RÉELLE de la base de données (points de restauration, réplication) est
assurée automatiquement par l'hébergeur (Railway, au niveau PostgreSQL),
hors du périmètre de cette application — aucun bouton ici ne peut se
substituer à ce mécanisme. Ce module offre seulement un export ponctuel,
lisible, des tables métier principales, pour un archivage manuel côté
CEBEVIRHA (ex. avant une opération sensible, ou à intervalle régulier par
prudence) — jamais un mécanisme de restauration en retour.

Réservé Super Admin — les données exportées couvrent tous les pays.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import json

from app.api.v1.deps import require_roles
from app.core.rbac import Role
from app.db.session import get_db
from app.models.commande import Commande
from app.models.paiement import Paiement
from app.models.passeport import Passeport
from app.models.utilisateur import Utilisateur

router = APIRouter(
    prefix="/sauvegarde",
    tags=["Module Sauvegarde"],
    dependencies=[Depends(require_roles(Role.SUPER_ADMIN))],
)


def _serialiser(obj, champs: list[str]) -> dict:
    resultat = {}
    for champ in champs:
        valeur = getattr(obj, champ)
        if isinstance(valeur, datetime):
            valeur = valeur.isoformat()
        elif hasattr(valeur, "value"):  # enum
            valeur = valeur.value
        resultat[champ] = valeur
    return resultat


@router.get("/export")
async def exporter_donnees(db: AsyncSession = Depends(get_db)):
    """Un seul fichier JSON regroupant les tables métier principales — pas
    de format binaire propriétaire, pour rester lisible et ré-exploitable
    (tableur, script) sans dépendre de cette plateforme pour le relire."""
    commandes = (await db.execute(select(Commande))).scalars().all()
    paiements = (await db.execute(select(Paiement))).scalars().all()
    passeports = (await db.execute(select(Passeport))).scalars().all()
    utilisateurs = (await db.execute(select(Utilisateur))).scalars().all()

    export = {
        "genere_le": datetime.now(timezone.utc).isoformat(),
        "avertissement": (
            "Export manuel des données métier — ne remplace pas la sauvegarde "
            "automatique de la base de données assurée par l'hébergeur."
        ),
        "commandes": [
            _serialiser(c, ["id", "pays_id", "quantite", "langue_version", "mode_impression", "statut", "cree_le"])
            for c in commandes
        ],
        "paiements": [
            _serialiser(p, ["id", "commande_id", "montant", "moyen", "statut", "cree_le"])
            for p in paiements
        ],
        "passeports": [
            _serialiser(p, ["id", "numero", "pays_id", "commande_id", "statut", "cree_le"])
            for p in passeports
        ],
        "utilisateurs": [
            _serialiser(u, ["id", "email", "nom_complet", "role", "pays_id", "actif", "cree_le"])
            for u in utilisateurs
        ],
    }

    contenu = json.dumps(export, ensure_ascii=False, indent=2)
    horodatage = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    return Response(
        content=contenu,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="export-ppb-{horodatage}.json"'},
    )
