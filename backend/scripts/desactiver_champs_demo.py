"""
Désactive les champs dynamiques de démonstration (nationalité, e-mail,
lien avec l'éleveur, mode de transport) qui n'ont aucune correspondance sur
le document papier — signalés par un test terrain montrant ces champs
apparaître dans le formulaire de saisie alors qu'ils n'ont pas de case sur
le PPB imprimé (voir pdf_passeport.py).

Désactivation logique (actif=False), jamais une suppression — l'historique
(si un passeport a déjà été saisi avec une valeur dans l'un de ces champs)
reste intact en base, seul l'AFFICHAGE dans le formulaire de saisie
s'arrête. Sans effet si ces champs n'existent pas (base fraîchement
amorcée après le retrait correspondant dans app/db/seed.py).

Usage (depuis le dossier backend/) :
    railway run python scripts/desactiver_champs_demo.py
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select

from app.db.session import AsyncSessionLocal
from app.models.admin import DefinitionChamp, DefinitionFormulaire

CHAMPS_A_DESACTIVER = [
    ("eleveur", "nationalite"),
    ("eleveur", "email"),
    ("convoyeur", "lien_avec_eleveur"),
    ("troupeau", "mode_transport"),
]


async def desactiver() -> None:
    desactives = []
    async with AsyncSessionLocal() as db:
        for code_formulaire, code_champ in CHAMPS_A_DESACTIVER:
            formulaire = (
                await db.execute(select(DefinitionFormulaire).where(DefinitionFormulaire.code == code_formulaire))
            ).scalar_one_or_none()
            if formulaire is None:
                continue
            champ = (
                await db.execute(
                    select(DefinitionChamp).where(
                        DefinitionChamp.formulaire_id == formulaire.id,
                        DefinitionChamp.code_champ == code_champ,
                        DefinitionChamp.actif.is_(True),
                    )
                )
            ).scalar_one_or_none()
            if champ is None:
                continue
            champ.actif = False
            formulaire.schema_version += 1
            desactives.append(f"{code_formulaire}.{code_champ}")
        await db.commit()

    if desactives:
        print(f"{len(desactives)} champ(s) désactivé(s) : {', '.join(desactives)}.")
    else:
        print("Aucun champ à désactiver (déjà fait, ou base fraîchement amorcée sans ces champs).")


if __name__ == "__main__":
    asyncio.run(desactiver())
