"""
Remise à zéro des données de démonstration/test — AVANT présentation à un
partenaire, ou le jour de la livraison finale avant exploitation réelle.

Volontairement un script à exécuter à la main (jamais un bouton dans
l'interface web) : une opération aussi destructrice et irréversible ne doit
jamais être accessible en un clic accidentel, même par un Super Admin.

SUPPRIME (toutes les données métier produites par l'usage/les tests) :
    Vaccination, TroupeauEspece, Troupeau, PhotoOcr, Numerisation, Controle,
    Itineraire, Eleveur, Convoyeur, Passeport, Paiement, AutorisationImpression,
    Commande, Notification, PisteAudit

CONSERVE (configuration et référentiels — jamais touchés) :
    Utilisateur (tous les comptes), Pays, Poste, DefinitionFormulaire,
    DefinitionChamp, Parametre, TexteGabarit, Branding

Après remise à zéro, la prochaine commande créée repart naturellement au
lot n°1 pour l'année en cours (le numéro de lot suivant est calculé à partir
des passeports existants, jamais un compteur séparé — voir
app.services.attribution) : rien à réinitialiser en plus de cette purge.

USAGE :
    python -m app.scripts.reset_donnees_test
        Aperçu seul (par défaut) — compte ce qui serait supprimé, NE
        SUPPRIME RIEN. À exécuter en premier, systématiquement.

    python -m app.scripts.reset_donnees_test --confirmer SUPPRIMER-LES-DONNEES-DE-TEST
        Exécute réellement la suppression. La phrase de confirmation doit
        être tapée exactement — un simple indicateur --oui aurait pu se
        retrouver collé dans un script ou un historique de commandes et se
        relancer par accident.
"""
import asyncio
import sys

from sqlalchemy import delete, func, select

from app.db.session import AsyncSessionLocal
from app.models.audit import PisteAudit
from app.models.autorisation_impression import AutorisationImpression
from app.models.commande import Commande
from app.models.controle import Controle
from app.models.convoyeur import Convoyeur
from app.models.eleveur import Eleveur
from app.models.itineraire import Itineraire
from app.models.notification import Notification
from app.models.numerisation import Numerisation
from app.models.paiement import Paiement
from app.models.passeport import Passeport
from app.models.photo_ocr import PhotoOcr
from app.models.troupeau import Troupeau, TroupeauEspece
from app.models.vaccination import Vaccination

PHRASE_CONFIRMATION = "SUPPRIMER-LES-DONNEES-DE-TEST"

# Ordre = enfants avant parents, pour respecter les contraintes de clé
# étrangère (ex. Vaccination référence Troupeau, qui référence Passeport).
MODELES_A_PURGER = [
    Vaccination,
    TroupeauEspece,
    Troupeau,
    PhotoOcr,
    Numerisation,
    Controle,
    Itineraire,
    Eleveur,
    Convoyeur,
    Passeport,
    Paiement,
    AutorisationImpression,
    Commande,
    Notification,
    PisteAudit,
]


async def compter() -> dict[str, int]:
    async with AsyncSessionLocal() as db:
        comptes = {}
        for modele in MODELES_A_PURGER:
            resultat = await db.execute(select(func.count()).select_from(modele))
            comptes[modele.__tablename__] = resultat.scalar_one()
        return comptes


async def purger() -> None:
    async with AsyncSessionLocal() as db:
        for modele in MODELES_A_PURGER:
            await db.execute(delete(modele))
        await db.commit()


def afficher_comptes(comptes: dict[str, int], titre: str) -> None:
    print(f"\n{titre}")
    print("-" * len(titre))
    total = 0
    for table, nombre in comptes.items():
        print(f"  {table:<28} {nombre:>8}")
        total += nombre
    print(f"  {'TOTAL':<28} {total:>8}\n")


async def main() -> None:
    confirmer = "--confirmer" in sys.argv
    phrase_fournie = None
    if confirmer:
        idx = sys.argv.index("--confirmer")
        phrase_fournie = sys.argv[idx + 1] if idx + 1 < len(sys.argv) else None

    comptes_avant = await compter()
    afficher_comptes(comptes_avant, "Aperçu — lignes qui seraient supprimées")

    if not confirmer:
        print("Aucune donnée supprimée (aperçu seul).")
        print(f"Pour exécuter réellement : --confirmer {PHRASE_CONFIRMATION}")
        return

    if phrase_fournie != PHRASE_CONFIRMATION:
        print(f"ERREUR : phrase de confirmation incorrecte. Aucune donnée supprimée.")
        print(f"Phrase attendue exactement : {PHRASE_CONFIRMATION}")
        sys.exit(1)

    print("Suppression en cours...")
    await purger()
    comptes_apres = await compter()
    afficher_comptes(comptes_apres, "Après suppression (devrait être entièrement à zéro)")
    print("Terminé. Les comptes utilisateurs, pays, postes et paramètres n'ont pas été touchés.")


if __name__ == "__main__":
    asyncio.run(main())
