"""
Création ou réinitialisation du compte Super Administrateur.

Pourquoi un script distinct de `app/db/seed.py` : l'amorçage est idempotent et
saute donc tout compte DÉJÀ présent, mot de passe inclus. C'est le comportement
voulu (rejouer le seed ne doit jamais réécrire un mot de passe de production),
mais il ne laisse aucune issue quand le mot de passe du Super Admin est perdu ou
n'a jamais été celui de la documentation : la connexion répond « Email ou mot de
passe incorrect. » sans qu'on puisse distinguer un compte absent d'un mot de
passe erroné. Ce script tranche explicitement les deux cas et les nomme.

Usage (une seule fois, depuis la console du service backend) :

    python -m scripts.reinitialiser_super_admin 'MotDePasseFort!2026'
    python -m scripts.reinitialiser_super_admin 'MotDePasseFort!2026' autre.admin@domaine.org

Le mot de passe est un ARGUMENT et n'est jamais écrit dans la base en clair :
seul son hachage est stocké, via la même fonction que l'amorçage et la
vérification de connexion — impossible donc de créer un compte que l'API
refuserait ensuite.
"""
import asyncio
import sys

from sqlalchemy import select

from app.core.rbac import Role
from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.utilisateur import Utilisateur

EMAIL_DEFAUT = "superadmin@cebevirha.org"
LONGUEUR_MINIMALE = 10


async def reinitialiser(email: str, mot_de_passe: str) -> None:
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Utilisateur).where(Utilisateur.email == email))
        utilisateur = result.scalar_one_or_none()

        if utilisateur is None:
            # Cas le plus fréquent en réalité : la base n'a jamais été amorcée,
            # le compte n'existe donc pas et aucun mot de passe ne pouvait
            # fonctionner.
            db.add(
                Utilisateur(
                    email=email,
                    hash_mdp=hash_password(mot_de_passe),
                    nom_complet="Super Administrateur",
                    role=Role.SUPER_ADMIN,
                    pays_id=None,
                )
            )
            await db.commit()
            print(f"Compte CRÉÉ : {email} (rôle SUPER_ADMIN, mot de passe défini).")
            return

        utilisateur.hash_mdp = hash_password(mot_de_passe)
        # Un compte désactivé est refusé à la connexion avec le MÊME message
        # qu'un mot de passe erroné : on le réactive et on le signale, sinon le
        # symptôme survivrait à la réinitialisation.
        etait_inactif = not utilisateur.actif
        utilisateur.actif = True
        # Un compte existant rattaché à un autre rôle expliquerait un accès
        # refusé aux écrans d'administration malgré une connexion réussie.
        ancien_role = utilisateur.role
        utilisateur.role = Role.SUPER_ADMIN
        await db.commit()

        print(f"Compte MIS À JOUR : {email} (mot de passe redéfini).")
        if etait_inactif:
            print("  · le compte était désactivé — il a été réactivé.")
        if ancien_role != Role.SUPER_ADMIN:
            print(f"  · rôle corrigé : {ancien_role} → SUPER_ADMIN.")


def main() -> None:
    if len(sys.argv) < 2:
        print(
            "Mot de passe manquant.\n"
            "Usage : python -m scripts.reinitialiser_super_admin '<mot de passe>' [email]",
            file=sys.stderr,
        )
        raise SystemExit(2)

    mot_de_passe = sys.argv[1]
    email = sys.argv[2].strip().lower() if len(sys.argv) > 2 else EMAIL_DEFAUT

    if len(mot_de_passe) < LONGUEUR_MINIMALE:
        print(
            f"Mot de passe trop court ({len(mot_de_passe)} caractères) : "
            f"{LONGUEUR_MINIMALE} au minimum pour un compte Super Administrateur.",
            file=sys.stderr,
        )
        raise SystemExit(2)

    asyncio.run(reinitialiser(email, mot_de_passe))


if __name__ == "__main__":
    main()