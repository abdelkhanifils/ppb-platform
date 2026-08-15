"""
Référentiel des pays — Document technique, référentiel CEMAC.

Endpoint volontairement simple : les 6 pays sont amorcés une fois pour
toutes (voir app/db/seed.py) et changent rarement. Authentification requise
(cohérent avec le reste de l'API), aucune restriction de rôle : tout compte
authentifié a besoin de connaître ce référentiel (listes déroulantes des
écrans Commandes, Paiements, etc.).

Existe précisément pour éviter qu'un identifiant de pays soit codé en dur
côté client (frontend/src/types/pays.ts en gardait une copie statique pour
l'usage hors-ligne du Module 4 — légitime là, mais fragile pour les écrans
d'administration qui ont de toute façon besoin du réseau) : le frontend doit
TOUJOURS lire ce référentiel ici pour les écrans qui ne sont pas concernés
par le fonctionnement hors-ligne.
"""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import get_current_user
from app.db.session import get_db
from app.models.pays import Pays

router = APIRouter(prefix="/pays", tags=["Référentiel"])


@router.get("", dependencies=[Depends(get_current_user)])
async def lister_pays(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Pays).order_by(Pays.ordre_alpha))
    return [
        {"id": p.id, "code_iso": p.code_iso, "code_numerique": p.code_numerique, "nom": p.nom}
        for p in result.scalars().all()
    ]
