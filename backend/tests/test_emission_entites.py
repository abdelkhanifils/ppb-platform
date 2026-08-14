"""Tests du Module 4 — création des entités métier à la complétion des 4 pages,
et de son idempotence (rejeu d'une page déjà transmise)."""
import pytest
from sqlalchemy import select

from app.models.commande import Commande, StatutCommande
from app.models.convoyeur import Convoyeur
from app.models.eleveur import Eleveur
from app.models.itineraire import Itineraire
from app.models.numerisation import Numerisation
from app.models.passeport import StatutPasseport
from app.models.troupeau import Troupeau, TroupeauEspece
from app.models.vaccination import Vaccination
from app.services.attribution import attribuer_passeports_pour_commande

DONNEES_PAGE_3 = {
    "eleveur": {"nom_prenom": "Amadou Ba", "numero_cni": "CM123456", "telephone": "+237600000001", "donnees_dynamiques": {}},
    "convoyeur": {"nom_prenom": "Issa Moussa", "numero_cni": "CM654321", "donnees_dynamiques": {}},
    "itineraire": {
        "pays_origine_id": None,  # rempli dans les tests (dépend du fixture pays)
        "province_origine": "Extrême-Nord",
        "localite_origine": "Kousséri",
        "pays_destination_id": None,
        "province_destination": "N'Djamena",
        "localite_destination": "Ngueli",
    },
}

DONNEES_PAGE_4 = {
    "especes": [
        {"espece": "bovin", "nombre_males": 10, "nombre_femelles_jeunes": 5, "nombre_femelles_adultes": 15, "nombre_total": 30}
    ],
    "vaccinations": [{"maladie": "peste_petits_ruminants", "date_vaccination": "2026-01-15", "lieu": "Kousséri"}],
}


async def _preparer_passeport(db, pays_id: int, user_id: str):
    commande = Commande(
        pays_id=pays_id, quantite=1, langue_version="FR/EN", mode_impression="centralisee",
        montant_total=1500, statut=StatutCommande.PAYEE, responsable_nom="Test", cree_par_id=user_id,
    )
    db.add(commande)
    await db.commit()
    await db.refresh(commande)
    passeports = await attribuer_passeports_pour_commande(db, commande)
    await db.commit()
    return passeports[0]


@pytest.mark.asyncio
async def test_completion_4_pages_cree_les_entites_metier(
    client, db, agent_emission_cmr, admin_national_cmr, pays_cameroun, pays_tchad
):
    user_agent, entetes = agent_emission_cmr
    user_admin, _ = admin_national_cmr
    passeport = await _preparer_passeport(db, pays_cameroun.id, user_admin.id)

    page3 = {**DONNEES_PAGE_3, "itineraire": {**DONNEES_PAGE_3["itineraire"], "pays_origine_id": pays_cameroun.id, "pays_destination_id": pays_tchad.id}}

    for page_num, donnees in [(1, None), (2, None), (3, page3), (4, DONNEES_PAGE_4)]:
        reponse = await client.post(f"/api/v1/numerisations/{passeport.id}/pages/{page_num}", headers=entetes, json=donnees)
        assert reponse.status_code == 200

    await db.refresh(passeport)
    assert passeport.statut == StatutPasseport.EMIS

    eleveur = (await db.execute(select(Eleveur).where(Eleveur.passeport_id == passeport.id))).scalar_one()
    assert eleveur.nom_prenom == "Amadou Ba"

    convoyeur = (await db.execute(select(Convoyeur).where(Convoyeur.passeport_id == passeport.id))).scalar_one()
    assert convoyeur.nom_prenom == "Issa Moussa"

    itineraire = (await db.execute(select(Itineraire).where(Itineraire.passeport_id == passeport.id))).scalar_one()
    assert itineraire.pays_origine_id == pays_cameroun.id
    assert itineraire.pays_destination_id == pays_tchad.id
    assert itineraire.synchronise_vers_controle is True
    assert itineraire.publie_le is not None

    troupeau = (await db.execute(select(Troupeau).where(Troupeau.passeport_id == passeport.id))).scalar_one()
    especes = (await db.execute(select(TroupeauEspece).where(TroupeauEspece.troupeau_id == troupeau.id))).scalars().all()
    assert len(especes) == 1
    assert especes[0].nombre_total == 30

    vaccinations = (await db.execute(select(Vaccination).where(Vaccination.troupeau_id == troupeau.id))).scalars().all()
    assert len(vaccinations) == 1
    assert vaccinations[0].maladie == "peste_petits_ruminants"


@pytest.mark.asyncio
async def test_rejeu_page_ne_duplique_pas_les_entites(
    client, db, agent_emission_cmr, admin_national_cmr, pays_cameroun, pays_tchad
):
    """Renvoyer la page 4 après coup (ex. réponse réseau perdue côté client) ne
    doit jamais créer un second Troupeau ni planter."""
    user_agent, entetes = agent_emission_cmr
    user_admin, _ = admin_national_cmr
    passeport = await _preparer_passeport(db, pays_cameroun.id, user_admin.id)
    page3 = {**DONNEES_PAGE_3, "itineraire": {**DONNEES_PAGE_3["itineraire"], "pays_origine_id": pays_cameroun.id, "pays_destination_id": pays_tchad.id}}

    for page_num, donnees in [(1, None), (2, None), (3, page3), (4, DONNEES_PAGE_4)]:
        await client.post(f"/api/v1/numerisations/{passeport.id}/pages/{page_num}", headers=entetes, json=donnees)

    # Rejeu de la page 4.
    reponse = await client.post(f"/api/v1/numerisations/{passeport.id}/pages/4", headers=entetes, json=DONNEES_PAGE_4)
    assert reponse.status_code == 200

    troupeaux = (await db.execute(select(Troupeau).where(Troupeau.passeport_id == passeport.id))).scalars().all()
    assert len(troupeaux) == 1

    numerisations = (
        await db.execute(select(Numerisation).where(Numerisation.passeport_id == passeport.id, Numerisation.page_num == 4))
    ).scalars().all()
    assert len(numerisations) == 1  # une seule ligne, mise à jour — pas une seconde


@pytest.mark.asyncio
async def test_page_num_invalide_rejetee(client, agent_emission_cmr):
    _, entetes = agent_emission_cmr
    reponse = await client.post("/api/v1/numerisations/un-id/pages/5", headers=entetes, json=None)
    assert reponse.status_code == 422
