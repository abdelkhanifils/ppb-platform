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
from sqlalchemy.exc import ProgrammingError

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
    videes = []
    ignorees = []
    async with AsyncSessionLocal() as db:
        for table in TABLES_A_VIDER:
            try:
                async with db.begin_nested():
                    await db.execute(text(f"TRUNCATE TABLE {table} RESTART IDENTITY CASCADE"))
                videes.append(table)
            except ProgrammingError:
                # Table absente — migration correspondante pas encore
                # appliquée (ex. photos_ocr, ajoutée par une évolution
                # récente). Jamais bloquant : on l'ignore et on continue
                # avec le reste, plutôt que de tout faire échouer pour une
                # table qui n'a de toute façon rien à vider.
                ignorees.append(table)
        await db.commit()

    print(f"{len(videes)} table(s) vidée(s) : {', '.join(videes)}.")
    if ignorees:
        print(f"{len(ignorees)} table(s) ignorée(s) (n'existent pas encore — migration pas encore appliquée) : {', '.join(ignorees)}.")
    print("Comptes, pays et postes conservés.")


if __name__ == "__main__":
    asyncio.run(reinitialiser())
