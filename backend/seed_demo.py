import asyncio
import sys
import uuid

sys.path.insert(0, ".")

from app.db.session import AsyncSessionLocal
from app.core.security import hash_password
from app.core.rbac import Role
from app.models.pays import Pays
from app.models.utilisateur import Utilisateur
from app.models.poste import Poste
from app.models.localite import Localite
from app.models.commande import Commande, StatutCommande, ModeImpression, VersionLinguistique
from app.models.passeport import Passeport, StatutPasseport
from app.models.itineraire import Itineraire
from app.models.numerisation import Numerisation
from app.models.controle import Controle, ResultatControle, ModeVerification, TypeIncident
from app.models.paiement import Paiement, StatutPaiement, MoyenPaiement
from sqlalchemy import select

MDP = "Demo1234!"
PAYS_CEMAC = [
    (1, "Cameroun", "CMR", "01", 1),
    (2, "Centrafrique", "CAF", "02", 2),
    (3, "Congo", "COG", "03", 3),
    (4, "Gabon", "GAB", "04", 4),
    (5, "Guinée Équatoriale", "GNQ", "05", 5),
    (6, "Tchad", "TCD", "06", 6),
]


async def main():
    async with AsyncSessionLocal() as db:
        for pid, nom, iso, num, ordre in PAYS_CEMAC:
            if not await db.get(Pays, pid):
                db.add(Pays(id=pid, nom=nom, code_iso=iso, code_numerique=num, ordre_alpha=ordre))
        await db.commit()

        tchad_id, cameroun_id = 6, 1

        for nom, province in [("N'Djaména", "N'Djaména"), ("Moundou", "Logone Occidental"), ("Abéché", "Ouaddaï")]:
            db.add(Localite(id=str(uuid.uuid4()), pays_id=tchad_id, nom=nom, province=province, actif=True))
        await db.commit()

        poste_emission = Poste(id=str(uuid.uuid4()), code="TCD-NDJ-EMIS-01", nom="Poste d'émission N'Djaména",
                                pays_id=tchad_id, latitude=12.1348, longitude=15.0557, actif=True)
        poste_controle = Poste(id=str(uuid.uuid4()), code="TCD-FRONT-01", nom="Poste frontalier Fianga",
                                pays_id=tchad_id, latitude=9.9167, longitude=15.1333, actif=True)
        db.add_all([poste_emission, poste_controle])
        await db.commit()

        comptes = [
            ("superadmin@demo.ppb", "Amina Souleymane", Role.SUPER_ADMIN, None, None),
            ("gestionnaire@demo.ppb", "Paul Ngarossoro", Role.GESTIONNAIRE_CEBEVIRHA, None, None),
            ("comptable@demo.ppb", "Fatimé Abakar", Role.COMPTABILITE, None, None),
            ("emission@demo.ppb", "Ismaël Brahim", Role.AGENT_EMISSION, tchad_id, poste_emission.id),
            ("controle@demo.ppb", "Mariam Oumar", Role.AGENT_CONTROLE, tchad_id, poste_controle.id),
            ("admin.national@demo.ppb", "Jean Moussa", Role.ADMIN_NATIONAL, tchad_id, None),
        ]
        for email, nom, role, pays_id, poste_id in comptes:
            db.add(Utilisateur(id=str(uuid.uuid4()), email=email, hash_mdp=hash_password(MDP),
                                nom_complet=nom, role=role, pays_id=pays_id, poste_id=poste_id, actif=True))
        await db.commit()

        superadmin = (await db.execute(select(Utilisateur).where(Utilisateur.email == "superadmin@demo.ppb"))).scalar_one()
        agent_controle = (await db.execute(select(Utilisateur).where(Utilisateur.email == "controle@demo.ppb"))).scalar_one()
        agent_emission = (await db.execute(select(Utilisateur).where(Utilisateur.email == "emission@demo.ppb"))).scalar_one()

        commande = Commande(id=str(uuid.uuid4()), pays_id=tchad_id, quantite=20,
                             langue_version=VersionLinguistique.FR_EN, mode_impression=ModeImpression.CENTRALISEE,
                             montant_total=100000, statut=StatutCommande.PAYEE,
                             responsable_nom="Direction de l'Élevage du Tchad", cree_par_id=superadmin.id)
        db.add(commande)
        await db.commit()

        passeports = []
        for i in range(1, 21):
            p = Passeport(id=str(uuid.uuid4()), commande_id=commande.id, pays_id=tchad_id,
                           numero_pays="06", numero_annee="2026", numero_lot=str(i).zfill(7),
                           qr_uuid=str(uuid.uuid4()), code_verification=str(uuid.uuid4())[:6].upper(),
                           hash_sha256="x" * 64, signature="demo", gabarit_version=1,
                           statut=StatutPasseport.VIERGE if i > 5 else StatutPasseport.EMIS)
            passeports.append(p)
            db.add(p)
        await db.commit()

        for p in passeports[:5]:
            db.add(Itineraire(id=str(uuid.uuid4()), passeport_id=p.id,
                               pays_origine_id=tchad_id, province_origine="N'Djaména", localite_origine="N'Djaména",
                               pays_destination_id=cameroun_id, province_destination="Extrême-Nord", localite_destination="Kousséri"))
            for page in (1, 2, 3, 4):
                db.add(Numerisation(
                    id=str(uuid.uuid4()), passeport_id=p.id, page_num=page, agent_id=agent_emission.id,
                    donnees_json={
                        "eleveur": {"nom": "Adoum Hassan", "numero_cni": "TC0012345", "telephone": "+23566012345"},
                        "convoyeur": {"nom": "Youssouf Idriss", "numero_cni": "TC0054321", "telephone": "+23566054321"},
                        "cheptel": {"bovins": 12, "ovins": 8, "caprins": 5},
                    } if page == 3 else None,
                    poste_code=poste_emission.code if page == 4 else None,
                ))
        await db.commit()

        db.add(Controle(id=str(uuid.uuid4()), passeport_id=passeports[0].id, poste_id=poste_controle.id,
                         agent_id=agent_controle.id, resultat=ResultatControle.VALIDE,
                         itineraire_disponible_localement=True, conforme_itineraire=True,
                         mode=ModeVerification.EN_LIGNE, latitude=9.9167, longitude=15.1333))
        db.add(Controle(id=str(uuid.uuid4()), passeport_id=passeports[1].id, poste_id=poste_controle.id,
                         agent_id=agent_controle.id, resultat=ResultatControle.VALIDE,
                         itineraire_disponible_localement=True, conforme_itineraire=True,
                         mode=ModeVerification.EN_LIGNE, latitude=9.9167, longitude=15.1333,
                         type_incident=TypeIncident.NOMBRE_ANIMAUX_NE_CORRESPOND_PAS,
                         details_incident="17 têtes présentées contre 15 déclarées."))
        await db.commit()

        db.add(Paiement(id=str(uuid.uuid4()), commande_id=commande.id, montant=100000, devise="XAF",
                         moyen=MoyenPaiement.VIREMENT, statut=StatutPaiement.EN_ATTENTE_VALIDATION,
                         idempotency_key=str(uuid.uuid4())))
        await db.commit()

        print("Données de démonstration créées avec succès.")


if __name__ == "__main__":
    asyncio.run(main())
