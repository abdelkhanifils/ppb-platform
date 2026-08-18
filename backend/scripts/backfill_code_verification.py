"""
Script de rattrapage — Passeport.code_verification.

À exécuter UNE SEULE FOIS, juste après avoir appliqué la migration qui
ajoute la colonne `code_verification` (voir README ci-dessous pour la
procédure complète en 3 étapes — indispensable si des passeports existent
déjà en base, ce qui est votre cas).

Usage (depuis le dossier backend/) :
    railway run python scripts/backfill_code_verification.py
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select

from app.db.base import nouveau_code_verification
from app.db.session import AsyncSessionLocal
from app.models.passeport import Passeport


async def backfiller() -> None:
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Passeport).where(Passeport.code_verification.is_(None)))
        passeports = result.scalars().all()

        if not passeports:
            print("Aucun passeport à mettre à jour — tous ont déjà un code_verification.")
            return

        for passeport in passeports:
            passeport.code_verification = nouveau_code_verification()

        await db.commit()
        print(f"{len(passeports)} passeport(s) mis à jour avec un nouveau code_verification.")


if __name__ == "__main__":
    asyncio.run(backfiller())
