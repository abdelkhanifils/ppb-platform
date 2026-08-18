"""
Réinitialisation des données de TEST transactionnelles — garde les comptes
utilisateurs, les pays et les postes intacts, vide tout le reste (commandes,
paiements, passeports, éleveurs, convoyeurs, itinéraires, troupeaux,
vaccinations, numérisations, contrôles, photos OCR).

À utiliser UNIQUEMENT si aucun passeport réel n'a été distribué sur le
terrain (voir la discussion — sinon, préférer la procédure de migration en
3 étapes qui préserve les numéros déjà en circulation).

Usage (depuis le dossier backend/) :
    railway run python scripts/reinitialiser_donnees_test.py
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text

from app.db.session import AsyncSessionLocal

# Ordre important : des tables dépendantes (clé étrangère) vers les tables
# référencées, sinon la contrainte d'intégrité bloque la suppression.
TABLES_A_VIDER = [
    "photos_ocr",
    "controles",
    "vaccinations",
    "troupeau_especes",
    "troupeaux",
    "itineraires",
    "convoyeurs",
    "eleveurs",
    "numerisations",
    "passeports",
    "compteurs_numerotation",
    "autorisations_impression",
    "paiements",
    "commandes",
]


async def reinitialiser() -> None:
    async with AsyncSessionLocal() as db:
        for table in TABLES_A_VIDER:
            await db.execute(text(f"TRUNCATE TABLE {table} RESTART IDENTITY CASCADE"))
        await db.commit()
    print(f"{len(TABLES_A_VIDER)} table(s) vidée(s). Comptes, pays et postes conservés.")


if __name__ == "__main__":
    asyncio.run(reinitialiser())
