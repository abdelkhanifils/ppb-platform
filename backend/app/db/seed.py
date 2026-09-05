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
    # --- Postes de référence initiaux ---
    ("poste-kousseri", "Kousséri (frontière Tchad)", "CMR", 12.0785, 15.0303),
    ("poste-ngueli", "Ngueli (frontière Cameroun)", "TCD", 12.1067, 15.0206),
    ("poste-garoua-boulai", "Garoua-Boulaï (frontière RCA)", "CMR", 5.8814, 14.5525),
    ("poste-beloko", "Beloko (frontière Cameroun)", "CAF", 5.7167, 14.9333),

    # --- Postes supplémentaires — points de passage réels documentés,
    # frontières internes CEMAC et frontières avec les pays voisins (côté
    # CEMAC uniquement : Poste.pays_id est une clé étrangère vers les 6
    # membres CEMAC, jamais vers un pays voisin). Coordonnées approximatives
    # (mêmes réserves que les 4 postes de référence ci-dessus) : à affiner
    # avec des relevés GPS de terrain quand disponibles.
# --- Frontières internes CEMAC ---
    ("poste-yagoua", "Yagoua (frontière Tchad)", "CMR", 10.3403, 15.2333),
    ("poste-bongor", "Bongor (frontière Cameroun)", "TCD", 10.2812, 15.3736),
    ("poste-katoa", "Katoa (frontière Tchad)", "CMR", 10.1000, 15.0500),
    ("poste-guelendeng", "Guelendeng (frontière Cameroun)", "TCD", 10.9333, 15.5333),
    ("poste-doumrou", "Doumrou / Blangoua (frontière Tchad)", "CMR", 12.4000, 14.9333),
    ("poste-fianga", "Fianga (frontière Cameroun)", "TCD", 9.9167, 15.1333),
    ("poste-binder", "Binder (frontière Tchad)", "CMR", 8.6167, 14.6167),
    ("poste-lere", "Léré (frontière Cameroun)", "TCD", 9.6667, 14.2167),
    ("poste-touboro", "Touboro / Mbaïboum (frontière Tchad)", "CMR", 7.7667, 15.3667),
    ("poste-moundou", "Moundou (frontière Cameroun)", "TCD", 8.5667, 16.0833),
    ("poste-sido-tcd", "Sido (frontière RCA)", "TCD", 6.6167, 18.0500),
    ("poste-sido-caf", "Sido (frontière Tchad)", "CAF", 6.6000, 18.0667),
    ("poste-maro", "Maro (frontière RCA)", "TCD", 7.9667, 18.7333),
    ("poste-kabo", "Kabo (frontière Tchad)", "CAF", 7.7000, 18.6333),
    ("poste-gore", "Goré (frontière RCA)", "TCD", 7.9333, 16.6333),
    ("poste-paoua", "Paoua (frontière Tchad)", "CAF", 7.2500, 16.4333),
    ("poste-doba", "Doba / Baïbokoum (frontière RCA)", "TCD", 8.6500, 16.8500),
    ("poste-markounda", "Markounda / Ngaoundaye (frontière Tchad)", "CAF", 7.6500, 16.6500),
    ("poste-cantonnier", "Cantonnier (frontière Cameroun)", "CAF", 5.9833, 14.9500),
    ("poste-gamboula", "Gamboula (frontière Cameroun)", "CAF", 4.1167, 15.1500),
    ("poste-kenzou", "Kenzou (frontière RCA)", "CMR", 4.5667, 15.1500),
    ("poste-amada-gaza", "Amada-Gaza (frontière Cameroun)", "CAF", 3.9167, 15.6667),
    ("poste-giti", "Giti (frontière RCA)", "CMR", 3.7000, 15.7500),
    ("poste-moloundou", "Moloundou (frontière RCA)", "CMR", 2.0333, 15.2333),
    ("poste-libongo", "Libongo / Salo (frontière Cameroun)", "CAF", 2.5000, 16.0500),
    ("poste-kye-ossi", "Kyé-Ossi (frontière Gabon/Guinée Équatoriale)", "CMR", 2.3333, 11.0833),
    ("poste-eboro", "Eboro (frontière Cameroun)", "GAB", 2.2833, 11.2667),
    ("poste-abang-minko", "Abang-Minko (frontière Gabon)", "CMR", 2.1167, 11.1500),
    ("poste-bitam", "Bitam (frontière Cameroun/Guinée Équatoriale)", "GAB", 2.0833, 11.4833),
    ("poste-campo", "Campo (frontière Guinée Équatoriale)", "CMR", 2.3667, 9.8167),
    ("poste-ebebiyin", "Ebebiyin (frontière Cameroun/Gabon)", "GNQ", 2.1500, 11.3333),
    ("poste-cocobeach", "Cocobeach (frontière Guinée Équatoriale)", "GAB", 0.9833, 9.5833),
    ("poste-cogo", "Cogo (frontière Gabon)", "GNQ", 1.0833, 9.7000),
    ("poste-medouneu", "Medouneu (frontière Guinée Équatoriale)", "GAB", 1.1500, 10.8000),
    ("poste-mbinda", "Mbinda (frontière Gabon)", "COG", 2.1500, 12.9167),
    ("poste-bakoumba", "Bakoumba (frontière Congo)", "GAB", 1.9500, 13.0833),
    ("poste-ngongo", "Ngongo (frontière Gabon)", "COG", 1.6333, 13.5833),
    ("poste-franceville", "Franceville / Lekoko (frontière Congo)", "GAB", 1.6333, 13.5833),
    ("poste-kelle", "Kellé (frontière Gabon)", "COG", 0.1167, 14.5333),
    ("poste-mekambo", "Mekambo / Zadie (frontière Congo)", "GAB", 1.0167, 13.9333),
    ("poste-dolisie", "Dolisie / Nyanga (frontière Gabon)", "COG", -4.2000, 12.6667),
    ("poste-tchibanga", "Tchibanga / Doussala (frontière Congo)", "GAB", -2.8500, 11.0167),
    ("poste-mongoumba", "Mongoumba (frontière Congo)", "CAF", 3.6333, 18.5833),
    ("poste-betou", "Bétou (frontière RCA)", "COG", 3.1000, 18.5333),

    # --- Frontières CEMAC / voisins hors CEMAC (côté CEMAC uniquement) ---
    ("poste-fotokol", "Fotokol (frontière Nigeria)", "CMR", 12.3833, 14.1833),
    ("poste-amchide", "Amchidé (frontière Nigeria)", "CMR", 10.9333, 13.9333),
    ("poste-guider", "Guider / Dembo (frontière Nigeria)", "CMR", 9.9333, 13.9500),
    ("poste-ekok", "Ekok (frontière Nigeria)", "CMR", 5.8500, 9.0667),
    ("poste-idenau", "Idenau / Ekondo-Titi (frontière Nigeria)", "CMR", 4.2167, 8.9833),
    ("poste-adre", "Adré (frontière Soudan)", "TCD", 13.4667, 22.2000),
    ("poste-tine-tcd", "Tine (frontière Soudan)", "TCD", 15.0667, 22.6667),
    ("poste-tissi", "Tissi (frontière Soudan)", "TCD", 11.4167, 21.9833),
    ("poste-ounianga", "Ounianga Kébir / Wour (frontière Libye)", "TCD", 19.0667, 20.4833),
    ("poste-kouri-bougoudi", "Kouri Bougoudi (frontière Libye)", "TCD", 21.6167, 18.9500),
    ("poste-daboua", "Daboua / Rig-Rig (frontière Niger)", "TCD", 13.5167, 14.2167),
    ("poste-bangui-rdc", "Bangui (frontière RD Congo)", "CAF", 4.3667, 18.5833),
    ("poste-mobaye", "Mobaye (frontière RD Congo)", "CAF", 4.3167, 21.1833),
    ("poste-bangassou", "Bangassou (frontière RD Congo)", "CAF", 4.7333, 22.8167),
    ("poste-birao", "Birao (frontière Soudan)", "CAF", 10.2833, 22.7833),
    ("poste-bambouti", "Bambouti (frontière Soudan du Sud)", "CAF", 5.2500, 25.9333),
    ("poste-brazzaville", "Brazzaville — Le Beach (frontière RD Congo)", "COG", -4.2661, 15.2832),
    ("poste-impfondo", "Impfondo (frontière RD Congo)", "COG", 1.6167, 18.0667),
    ("poste-lukolela", "Lukolela (frontière RD Congo)", "COG", -1.0500, 17.1833),
    ("poste-kimongo", "Kimongo (frontière Angola/Cabinda)", "COG", -4.6833, 12.6667),
    ("poste-ngoio", "Ngoio / Nzassi (frontière Angola/Cabinda)", "COG", -4.7833, 11.9500),
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
