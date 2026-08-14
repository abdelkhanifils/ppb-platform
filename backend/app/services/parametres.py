"""Lecture typée des paramètres système (Parametre) — Document technique, Module
Administration §4 : « Le prix unitaire n'est jamais codé en dur : il est lu depuis
le paramètre système prix_unitaire_ppb ... Le plafond de paiement en ligne suit
exactement le même principe. » Toute valeur par défaut passée ici n'est qu'un
filet de sécurité si le paramètre n'a pas encore été amorcé en base."""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.admin import Parametre


async def obtenir_parametre(db: AsyncSession, cle: str) -> str | None:
    result = await db.execute(select(Parametre).where(Parametre.cle == cle))
    parametre = result.scalar_one_or_none()
    return parametre.valeur if parametre else None


async def obtenir_parametre_decimal(db: AsyncSession, cle: str, defaut: float) -> float:
    valeur = await obtenir_parametre(db, cle)
    return float(valeur) if valeur is not None else defaut


async def obtenir_parametre_int(db: AsyncSession, cle: str, defaut: int) -> int:
    valeur = await obtenir_parametre(db, cle)
    return int(valeur) if valeur is not None else defaut
