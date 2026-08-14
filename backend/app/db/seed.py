"""
Amorçage initial : les 6 pays CEMAC (ordre alphabétique, code numérique
01-06 conforme au gabarit du PPB), un compte de démonstration par rôle
RBAC, les 3 formulaires configurables de référence (éleveur, convoyeur,
troupeau — Document technique §4) avec leurs champs structurels de base,
et les paramètres système cités dans le document technique. À exécuter
une seule fois en développement :

    python -m app.db.seed
"""
import asyncio

from app.core.rbac import Role
from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.admin import DefinitionChamp, DefinitionFormulaire, Parametre, TypeChamp, TypeParametre
from app.models.pays import Pays
from app.models.poste import Poste
from app.models.utilisateur import Utilisateur

PAYS_CEMAC = [
    # code_numerique conforme au gabarit PPB : 01 CMR · 02 CAF · 03 COG · 04 GAB · 05 GNQ · 06 TCD
    ("CMR", "01", "Cameroun", 1, "FR/EN"),
    ("CAF", "02", "Centrafrique", 2, "FR/AR"),
    ("COG", "03", "Congo", 3, "FR/EN"),
    ("GAB", "04", "Gabon", 4, "FR/EN"),
    ("GNQ", "05", "Guinée Équatoriale", 5, "FR/EN"),
    ("TCD", "06", "Tchad", 6, "FR/AR"),
]

COMPTES_DEMO = [
    ("superadmin@cebevirha.org", "Super Administrateur", Role.SUPER_ADMIN, None),
    ("ministere.cmr@gouv.cm", "Ministère de l'Élevage — Cameroun", Role.ADMIN_NATIONAL, "CMR"),
    ("emission.cmr@cebevirha.org", "Agent d'émission — Kousséri", Role.AGENT_EMISSION, "CMR"),
    ("controle.tcd@cebevirha.org", "Agent de contrôle — Ngueli", Role.AGENT_CONTROLE, "TCD"),
    ("veterinaire.cmr@cebevirha.org", "Vétérinaire", Role.VETERINAIRE, "CMR"),
    ("consultation@cebevirha.org", "Consultation (lecture seule)", Role.CONSULTATION, None),
]

MOT_DE_PASSE_DEMO = "ChangeMoi!2026"  # à changer immédiatement en production

# Formulaires configurables de référence — Document technique §4.
# Champs structurels (nom_prenom, numero_cni...) déjà en colonnes fixes sur les modèles
# (Eleveur, Convoyeur) : ils ne sont PAS dupliqués ici. Seuls des exemples de champs
# métier pilotables par le Super Admin sont amorcés, pour rendre le module testable.
FORMULAIRES = [
    ("eleveur", "Éleveur", "Informations du propriétaire du troupeau"),
    ("convoyeur", "Convoyeur", "Informations de l'accompagnant du troupeau"),
    ("troupeau", "Troupeau", "Composition et effectifs du troupeau"),
]

CHAMPS_PAR_FORMULAIRE = {
    "eleveur": [
        ("nationalite", "Nationalité", TypeChamp.TEXTE, False),
        ("email", "E-mail", TypeChamp.TEXTE, False),
    ],
    "convoyeur": [
        ("lien_avec_eleveur", "Lien avec l'éleveur", TypeChamp.TEXTE, False),
    ],
    "troupeau": [
        ("mode_transport", "Mode de transport", TypeChamp.LISTE, False),
    ],
}

# Paramètres système cités dans le document technique (Modules 1 et 2).
PARAMETRES = [
    ("prix_unitaire_ppb", "1500", TypeParametre.DECIMAL, "Prix unitaire du PPB, en XAF (Module 1)."),
    ("plafond_paiement_en_ligne", "5000000", TypeParametre.DECIMAL, "Montant maximal autorisé pour un paiement en ligne, en XAF (Module 2)."),
    ("commande_quantite_min", "50", TypeParametre.INT, "Quantité minimale par commande (Module 1)."),
    ("commande_quantite_max", "10000", TypeParametre.INT, "Quantité maximale par commande (Module 1)."),
    ("commande_expiration_jours", "30", TypeParametre.INT, "Délai avant expiration automatique d'une commande non payée."),
]

# Quelques postes de contrôle frontaliers de référence (coordonnées
# approximatives) — alimentent l'agrégation « par poste » et la carte du
# tableau de bord régional (Module Statistiques) dès l'amorçage.
POSTES = [
    ("poste-kousseri", "Kousséri (frontière Tchad)", "CMR", 12.0785, 15.0303),
    ("poste-ngueli", "Ngueli (frontière Cameroun)", "TCD", 12.1067, 15.0206),
    ("poste-garoua-boulai", "Garoua-Boulaï (frontière RCA)", "CMR", 5.8814, 14.5525),
    ("poste-beloko", "Beloko (frontière Cameroun)", "CAF", 5.7167, 14.9333),
]


async def seed() -> None:
    async with AsyncSessionLocal() as db:
        code_iso_to_id = {}
        for code_iso, code_num, nom, ordre, version_defaut in PAYS_CEMAC:
            pays = Pays(
                code_iso=code_iso,
                code_numerique=code_num,
                nom=nom,
                ordre_alpha=ordre,
                version_linguistique_defaut=version_defaut,
            )
            db.add(pays)
            await db.flush()
            code_iso_to_id[code_iso] = pays.id

        for email, nom_complet, role, code_iso in COMPTES_DEMO:
            db.add(
                Utilisateur(
                    email=email,
                    hash_mdp=hash_password(MOT_DE_PASSE_DEMO),
                    nom_complet=nom_complet,
                    role=role,
                    pays_id=code_iso_to_id.get(code_iso) if code_iso else None,
                )
            )

        code_formulaire_to_id = {}
        for code, nom, description in FORMULAIRES:
            formulaire = DefinitionFormulaire(code=code, nom=nom, description=description, schema_version=1)
            db.add(formulaire)
            await db.flush()
            code_formulaire_to_id[code] = formulaire.id

        nb_champs = 0
        for code_formulaire, champs in CHAMPS_PAR_FORMULAIRE.items():
            for ordre, (code_champ, libelle_fr, type_champ, obligatoire) in enumerate(champs):
                db.add(
                    DefinitionChamp(
                        formulaire_id=code_formulaire_to_id[code_formulaire],
                        code_champ=code_champ,
                        libelle_fr=libelle_fr,
                        type_champ=type_champ,
                        obligatoire=obligatoire,
                        ordre_affichage=ordre,
                        options_liste={"valeurs": ["pied", "camion", "train"]} if type_champ == TypeChamp.LISTE else None,
                    )
                )
                nb_champs += 1

        for cle, valeur, type_parametre, description in PARAMETRES:
            db.add(Parametre(cle=cle, valeur=valeur, type=type_parametre, description=description))

        for code, nom, code_iso_pays, latitude, longitude in POSTES:
            db.add(
                Poste(
                    code=code,
                    nom=nom,
                    pays_id=code_iso_to_id[code_iso_pays],
                    latitude=latitude,
                    longitude=longitude,
                )
            )

        await db.commit()
    print(
        f"Amorçage terminé — {len(PAYS_CEMAC)} pays, {len(COMPTES_DEMO)} comptes "
        f"(mot de passe : {MOT_DE_PASSE_DEMO}), {len(FORMULAIRES)} formulaires ({nb_champs} champs), "
        f"{len(PARAMETRES)} paramètres, {len(POSTES)} postes de contrôle."
    )


if __name__ == "__main__":
    asyncio.run(seed())
