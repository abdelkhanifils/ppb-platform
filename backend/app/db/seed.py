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

from sqlalchemy import select

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
    ("veterinaire.cmr@cebevirha.org", "Vétérinaire", Role.VETERINAIRE, "CMR"),
    ("consultation@cebevirha.org", "Consultation (lecture seule)", Role.CONSULTATION, None),
    # Un compte Émission et un compte Contrôle par pays CEMAC — pour tester
    # les Modules 4 et 5 dans chacun des 6 pays, pas seulement CMR/TCD.
    ("emission.cmr@cebevirha.org", "Agent d'émission — Cameroun", Role.AGENT_EMISSION, "CMR"),
    ("emission.caf@cebevirha.org", "Agent d'émission — Centrafrique", Role.AGENT_EMISSION, "CAF"),
    ("emission.cog@cebevirha.org", "Agent d'émission — Congo", Role.AGENT_EMISSION, "COG"),
    ("emission.gab@cebevirha.org", "Agent d'émission — Gabon", Role.AGENT_EMISSION, "GAB"),
    ("emission.gnq@cebevirha.org", "Agent d'émission — Guinée Équatoriale", Role.AGENT_EMISSION, "GNQ"),
    ("emission.tcd@cebevirha.org", "Agent d'émission — Tchad", Role.AGENT_EMISSION, "TCD"),
    ("controle.cmr@cebevirha.org", "Agent de contrôle — Cameroun", Role.AGENT_CONTROLE, "CMR"),
    ("controle.caf@cebevirha.org", "Agent de contrôle — Centrafrique", Role.AGENT_CONTROLE, "CAF"),
    ("controle.cog@cebevirha.org", "Agent de contrôle — Congo", Role.AGENT_CONTROLE, "COG"),
    ("controle.gab@cebevirha.org", "Agent de contrôle — Gabon", Role.AGENT_CONTROLE, "GAB"),
    ("controle.gnq@cebevirha.org", "Agent de contrôle — Guinée Équatoriale", Role.AGENT_CONTROLE, "GNQ"),
    ("controle.tcd@cebevirha.org", "Agent de contrôle — Tchad", Role.AGENT_CONTROLE, "TCD"),
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
    # Volontairement AUCUN champ dynamique supplémentaire pour eleveur/
    # convoyeur/troupeau ici : les 3 champs de base (nom_prenom,
    # numero_cni, telephone pour une personne ; effectifs/vaccinations
    # pour le troupeau) sont déjà codés en dur côté frontend
    # (Page3Identification.tsx, Page4Troupeau.tsx) et correspondent
    # EXACTEMENT à ce qui est imprimé sur le document papier (voir
    # pdf_passeport.py) — n'ajouter ici que des champs qui ont un
    # équivalent réel sur le papier, sinon la saisie terrain et l'OCR
    # (qui cherche les libellés du papier) désynchronisent silencieusement
    # du formulaire numérique. D'anciens champs de démonstration
    # (nationalité, e-mail, lien avec l'éleveur, mode de transport)
    # existaient ici sans correspondance papier — retirés (voir
    # scripts/desactiver_champs_demo.py pour les bases déjà amorcées).
}

# Paramètres système cités dans le document technique (Modules 1 et 2).
PARAMETRES = [
    ("prix_unitaire_ppb", "1500", TypeParametre.DECIMAL, "Prix unitaire du PPB, en XAF (Module 1)."),
    ("plafond_paiement_en_ligne", "5000000", TypeParametre.DECIMAL, "Montant maximal autorisé pour un paiement en ligne, en XAF (Module 2)."),
    ("commande_quantite_min", "50", TypeParametre.INT, "Quantité minimale par commande (Module 1)."),
    ("commande_quantite_max", "10000", TypeParametre.INT, "Quantité maximale par commande (Module 1)."),
    ("commande_expiration_jours", "30", TypeParametre.INT, "Délai avant expiration automatique d'une commande non payée."),
    ("rib_paiement", "", TypeParametre.STRING, "Coordonnées bancaires (RIB) affichées sur le bon de commande / la facture — à renseigner avant la première commande."),
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
    """Idempotent — rejouable sans erreur sur une base déjà partiellement
    amorcée : chaque entité est créée SEULEMENT si elle n'existe pas encore
    (vérifiée par sa clé naturelle : code_iso, email, code formulaire/champ,
    cle paramètre, code poste). Utile par exemple pour ajouter de nouveaux
    comptes de démonstration à une base existante sans tout réinitialiser."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Pays))
        code_iso_to_id = {p.code_iso: p.id for p in result.scalars().all()}
        nb_pays_crees = 0
        for code_iso, code_num, nom, ordre, version_defaut in PAYS_CEMAC:
            if code_iso in code_iso_to_id:
                continue
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
            nb_pays_crees += 1

        result = await db.execute(select(Utilisateur.email))
        emails_existants = {e for (e,) in result.all()}
        nb_comptes_crees = 0
        for email, nom_complet, role, code_iso in COMPTES_DEMO:
            if email in emails_existants:
                continue
            db.add(
                Utilisateur(
                    email=email,
                    hash_mdp=hash_password(MOT_DE_PASSE_DEMO),
                    nom_complet=nom_complet,
                    role=role,
                    pays_id=code_iso_to_id.get(code_iso) if code_iso else None,
                )
            )
            nb_comptes_crees += 1

        result = await db.execute(select(DefinitionFormulaire))
        code_formulaire_to_id = {f.code: f.id for f in result.scalars().all()}
        for code, nom, description in FORMULAIRES:
            if code in code_formulaire_to_id:
                continue
            formulaire = DefinitionFormulaire(code=code, nom=nom, description=description, schema_version=1)
            db.add(formulaire)
            await db.flush()
            code_formulaire_to_id[code] = formulaire.id

        result = await db.execute(select(DefinitionChamp.formulaire_id, DefinitionChamp.code_champ))
        champs_existants = set(result.all())
        nb_champs = 0
        for code_formulaire, champs in CHAMPS_PAR_FORMULAIRE.items():
            formulaire_id = code_formulaire_to_id[code_formulaire]
            for ordre, (code_champ, libelle_fr, type_champ, obligatoire) in enumerate(champs):
                if (formulaire_id, code_champ) in champs_existants:
                    continue
                db.add(
                    DefinitionChamp(
                        formulaire_id=formulaire_id,
                        code_champ=code_champ,
                        libelle_fr=libelle_fr,
                        type_champ=type_champ,
                        obligatoire=obligatoire,
                        ordre_affichage=ordre,
                        options_liste={"valeurs": ["pied", "camion", "train"]} if type_champ == TypeChamp.LISTE else None,
                    )
                )
                nb_champs += 1

        result = await db.execute(select(Parametre.cle))
        cles_existantes = {c for (c,) in result.all()}
        for cle, valeur, type_parametre, description in PARAMETRES:
            if cle in cles_existantes:
                continue
            db.add(Parametre(cle=cle, valeur=valeur, type=type_parametre, description=description))

        result = await db.execute(select(Poste.code))
        codes_postes_existants = {c for (c,) in result.all()}
        nb_postes_crees = 0
        for code, nom, code_iso_pays, latitude, longitude in POSTES:
            if code in codes_postes_existants:
                continue
            db.add(
                Poste(
                    code=code,
                    nom=nom,
                    pays_id=code_iso_to_id[code_iso_pays],
                    latitude=latitude,
                    longitude=longitude,
                )
            )
            nb_postes_crees += 1

        await db.commit()
    print(
        f"Amorçage terminé — {nb_pays_crees} pays ajouté(s) (sur {len(PAYS_CEMAC)}), "
        f"{nb_comptes_crees} compte(s) ajouté(s) (sur {len(COMPTES_DEMO)}, mot de passe : {MOT_DE_PASSE_DEMO}), "
        f"{nb_champs} champ(s) ajouté(s), {nb_postes_crees} poste(s) ajouté(s) (sur {len(POSTES)}). "
        f"Entités déjà présentes ignorées sans erreur."
    )


if __name__ == "__main__":
    asyncio.run(seed())
