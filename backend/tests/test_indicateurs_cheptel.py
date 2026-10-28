"""Indicateurs d'effectifs du cheptel : espèce, origine, destination, vaccinations."""
import pytest

from app.models.controle import Controle, ModeVerification, ResultatControle
from app.models.itineraire import Itineraire
from app.models.troupeau import Troupeau, TroupeauEspece
from app.models.vaccination import Vaccination
from tests.test_statistiques import _commande_payee_avec_paiement


async def _troupeau(db, passeport, especes, origine_id, dest_id, loc_o="Kousséri", loc_d="Ngueli", vaccins=()):
    db.add(Itineraire(passeport_id=passeport.id, pays_origine_id=origine_id, province_origine="P", localite_origine=loc_o,
                      pays_destination_id=dest_id, province_destination="Q", localite_destination=loc_d))
    t = Troupeau(passeport_id=passeport.id)
    db.add(t)
    await db.flush()
    for esp, n in especes:
        db.add(TroupeauEspece(troupeau_id=t.id, espece=esp, nombre_total=n, nombre_males=n))
    for m in vaccins:
        db.add(Vaccination(troupeau_id=t.id, maladie=m))
    await db.commit()
    return t


@pytest.mark.asyncio
async def test_indicateurs_par_espece_origine_destination_vaccins(client, db, super_admin, admin_national_cmr, pays_cameroun, pays_tchad):
    u, h = super_admin
    _, pp = await _commande_payee_avec_paiement(db, pays_cameroun.id, u.id, quantite=2)
    await _troupeau(db, pp[0], [("bovin", 30), ("ovin", 10)], pays_tchad.id, pays_cameroun.id, vaccins=["PPR", "charbon"])
    await _troupeau(db, pp[1], [("bovin", 20)], pays_tchad.id, pays_cameroun.id, vaccins=["PPR", "PPR"])
    r = (await client.get("/api/v1/statistiques/indicateurs", headers=h)).json()
    assert r["total_cheptel"] == 60
    assert {e["espece"]: e["total"] for e in r["par_espece"]} == {"bovin": 50, "ovin": 10}
    assert r["par_origine_pays"][0]["effectif"] == 60 and r["par_origine_pays"][0]["nb_passeports"] == 2
    assert r["par_destination_localite"][0]["localite"] == "Ngueli"
    v = {(x["maladie"], x["espece"]): x["effectif"] for x in r["vaccinations"]}
    assert v[("PPR", "bovin")] == 50 and v[("PPR", "ovin")] == 10 and v[("charbon", "bovin")] == 30  # PPR en double compté une fois
    assert len(r["non_disponibles"]) == 6


@pytest.mark.asyncio
async def test_base_controles_et_perimetre_admin_national(client, db, super_admin, admin_national_cmr, agent_controle_cmr, pays_cameroun, pays_tchad, poste_kousseri):
    u, _ = super_admin
    an, h_an = admin_national_cmr
    ag, _ = agent_controle_cmr
    _, pc = await _commande_payee_avec_paiement(db, pays_cameroun.id, u.id, quantite=1)
    _, pt = await _commande_payee_avec_paiement(db, pays_tchad.id, u.id, quantite=1)
    await _troupeau(db, pc[0], [("bovin", 10)], pays_cameroun.id, pays_tchad.id)
    await _troupeau(db, pt[0], [("bovin", 99)], pays_tchad.id, pays_cameroun.id)
    # Admin National : uniquement son pays, même s'il demande l'autre.
    r = (await client.get(f"/api/v1/statistiques/indicateurs?pays_id={pays_tchad.id}", headers=h_an)).json()
    assert r["total_cheptel"] == 10
    # Base contrôlés : seul le passeport contrôlé compte.
    db.add(Controle(passeport_id=pc[0].id, poste_id=poste_kousseri.id if hasattr(poste_kousseri, "id") else "p", agent_id=ag.id,
                    resultat=ResultatControle.VALIDE, itineraire_disponible_localement=False, mode=ModeVerification.EN_LIGNE))
    await db.commit()
    r = (await client.get("/api/v1/statistiques/indicateurs?base=controles", headers=h_an)).json()
    assert r["total_cheptel"] == 10
    assert (await client.get("/api/v1/statistiques/indicateurs?base=x", headers=h_an)).status_code == 422


@pytest.mark.asyncio
async def test_consultation_peut_lire_agent_terrain_refuse(client, consultation, agent_emission_cmr):
    assert (await client.get("/api/v1/statistiques/indicateurs", headers=consultation[1])).status_code == 200
    assert (await client.get("/api/v1/statistiques/indicateurs", headers=agent_emission_cmr[1])).status_code == 403
