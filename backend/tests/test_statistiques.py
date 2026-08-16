"""Tests du Module transversal Statistiques — agrégations par pays, par phase,
par poste (portables) et géospatiales (clustering, GeoJSON — repli SQLite
testé ici ; la précision PostGIS réelle nécessite une base PostgreSQL, voir
app/services/geospatial.py)."""
import pytest

from app.models.commande import Commande, StatutCommande
from app.models.controle import Controle, ModeVerification, ResultatControle
from app.models.paiement import MoyenPaiement, Paiement, StatutPaiement
from app.services.attribution import attribuer_passeports_pour_commande
from app.services.geospatial import clusteriser_controles, points_controles_geojson
from app.services.statistiques import agreger_par_pays, agreger_par_pays_et_annee, agreger_par_phase, agreger_par_poste


async def _commande_payee_avec_paiement(db, pays_id: int, user_id: str, quantite: int = 2, montant: float = 3000):
    commande = Commande(
        pays_id=pays_id, quantite=quantite, langue_version="FR/EN", mode_impression="centralisee",
        montant_total=montant, statut=StatutCommande.PAYEE, responsable_nom="Test", cree_par_id=user_id,
    )
    db.add(commande)
    await db.commit()
    await db.refresh(commande)
    db.add(
        Paiement(
            commande_id=commande.id, montant=montant, moyen=MoyenPaiement.MOBILE_MONEY,
            statut=StatutPaiement.VALIDE, idempotency_key=f"idem-{commande.id}",
        )
    )
    await db.commit()
    passeports = await attribuer_passeports_pour_commande(db, commande)
    await db.commit()
    return commande, passeports


@pytest.mark.asyncio
async def test_agreger_par_pays_compte_commandes_et_montant(db, admin_national_cmr, pays_cameroun, pays_tchad):
    user, _ = admin_national_cmr
    await _commande_payee_avec_paiement(db, pays_cameroun.id, user.id, quantite=2, montant=3000)

    resultats = await agreger_par_pays(db)

    ligne_cmr = next(r for r in resultats if r["pays_id"] == pays_cameroun.id)
    ligne_tcd = next(r for r in resultats if r["pays_id"] == pays_tchad.id)
    assert ligne_cmr["nb_commandes"] == 1
    assert ligne_cmr["montant_encaisse_xaf"] == 3000
    assert ligne_cmr["passeports_par_statut"].get("precharge") == 2
    assert ligne_tcd["nb_commandes"] == 0
    assert ligne_tcd["montant_encaisse_xaf"] == 0


@pytest.mark.asyncio
async def test_agreger_par_phase_reflete_lentonnoir(db, admin_national_cmr, pays_cameroun):
    user, _ = admin_national_cmr
    await _commande_payee_avec_paiement(db, pays_cameroun.id, user.id, quantite=3)

    resultat = await agreger_par_phase(db)

    phases = {p["statut"]: p["nombre"] for p in resultat["phases"]}
    assert phases["precharge"] == 3
    assert phases["vierge"] == 0
    assert phases["emis"] == 0
    assert phases["controle"] == 0


@pytest.mark.asyncio
async def test_agreger_par_phase_filtre_par_pays(db, admin_national_cmr, admin_national_tcd, pays_cameroun, pays_tchad):
    user_cmr, _ = admin_national_cmr
    user_tcd, _ = admin_national_tcd
    await _commande_payee_avec_paiement(db, pays_cameroun.id, user_cmr.id, quantite=2)
    await _commande_payee_avec_paiement(db, pays_tchad.id, user_tcd.id, quantite=5)

    resultat_cmr = await agreger_par_phase(db, pays_id=pays_cameroun.id)

    phases = {p["statut"]: p["nombre"] for p in resultat_cmr["phases"]}
    assert phases["precharge"] == 2  # pas 7 (2+5) : bien filtré


@pytest.mark.asyncio
async def test_agreger_par_poste_compte_les_controles(client, db, agent_controle_cmr, admin_national_cmr, pays_cameroun, poste_kousseri):
    _, entetes = agent_controle_cmr
    user, _ = admin_national_cmr
    _, passeports = await _commande_payee_avec_paiement(db, pays_cameroun.id, user.id, quantite=1)

    await client.post(
        "/api/v1/controles",
        headers=entetes,
        json={"passeport_id": passeports[0].id, "poste_id": poste_kousseri.code, "mode": "en_ligne"},
    )

    resultats = await agreger_par_poste(db)

    poste_resultat = next(p for p in resultats if p["code"] == poste_kousseri.code)
    assert poste_resultat["total_controles"] == 1
    assert poste_resultat["nom"] == "Kousséri"
    assert poste_resultat["latitude"] == pytest.approx(12.0785)


@pytest.mark.asyncio
async def test_agreger_par_poste_filtre_par_pays(db, pays_cameroun, pays_tchad, poste_kousseri):
    from app.models.poste import Poste

    db.add(Poste(code="poste-ngueli", nom="Ngueli", pays_id=pays_tchad.id, latitude=12.1067, longitude=15.0206))
    await db.commit()

    resultats = await agreger_par_poste(db, pays_id=pays_cameroun.id)

    codes = {p["code"] for p in resultats}
    assert "poste-kousseri" in codes
    assert "poste-ngueli" not in codes


# --- Géospatial (repli SQLite — voir docstring du module pour la portée réelle) ------------


async def _creer_controle_geolocalise(db, passeport_id: str, agent_id: str, poste_id: str, lat: float, lon: float, resultat=ResultatControle.VALIDE):
    controle = Controle(
        passeport_id=passeport_id, poste_id=poste_id, agent_id=agent_id, resultat=resultat,
        itineraire_disponible_localement=False, mode=ModeVerification.EN_LIGNE, latitude=lat, longitude=lon,
    )
    db.add(controle)
    await db.commit()
    return controle


@pytest.mark.asyncio
async def test_clusteriser_controles_regroupe_les_points_proches(db, agent_controle_cmr, admin_national_cmr, pays_cameroun):
    agent, _ = agent_controle_cmr
    user, _ = admin_national_cmr
    _, passeports = await _commande_payee_avec_paiement(db, pays_cameroun.id, user.id, quantite=3)

    # Deux points très proches (même poste) + un point isolé loin.
    await _creer_controle_geolocalise(db, passeports[0].id, agent.id, "poste-a", 12.0785, 15.0303)
    await _creer_controle_geolocalise(db, passeports[1].id, agent.id, "poste-a", 12.0786, 15.0304)
    await _creer_controle_geolocalise(db, passeports[2].id, agent.id, "poste-b", 5.8814, 14.5525)

    clusters = await clusteriser_controles(db, rayon_metres=5_000, min_points=1)

    assert len(clusters) == 2
    tailles = sorted(c["nombre"] for c in clusters)
    assert tailles == [1, 2]


@pytest.mark.asyncio
async def test_points_geojson_structure_valide(db, agent_controle_cmr, admin_national_cmr, pays_cameroun):
    agent, _ = agent_controle_cmr
    user, _ = admin_national_cmr
    _, passeports = await _commande_payee_avec_paiement(db, pays_cameroun.id, user.id, quantite=1)
    await _creer_controle_geolocalise(db, passeports[0].id, agent.id, "poste-a", 12.0785, 15.0303)

    geojson = await points_controles_geojson(db)

    assert geojson["type"] == "FeatureCollection"
    assert len(geojson["features"]) == 1
    feature = geojson["features"][0]
    assert feature["type"] == "Feature"
    assert feature["geometry"]["type"] == "Point"
    assert feature["geometry"]["coordinates"] == [pytest.approx(15.0303), pytest.approx(12.0785)]


@pytest.mark.asyncio
async def test_clusteriser_controles_sans_donnees_retourne_liste_vide(db):
    clusters = await clusteriser_controles(db)
    assert clusters == []


# --- Endpoints ------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_endpoint_tableau_bord_accessible_en_lecture_seule(client, consultation):
    _, entetes = consultation
    reponse = await client.get("/api/v1/statistiques/tableau-bord", headers=entetes)
    assert reponse.status_code == 200
    corps = reponse.json()
    assert "par_pays" in corps
    assert "entonnoir_global" in corps


@pytest.mark.asyncio
async def test_endpoint_tableau_bord_refuse_pour_agent_terrain(client, agent_emission_cmr):
    _, entetes = agent_emission_cmr
    reponse = await client.get("/api/v1/statistiques/tableau-bord", headers=entetes)
    assert reponse.status_code == 403


@pytest.mark.asyncio
async def test_endpoint_carte_mouvements_points_retourne_geojson(client, super_admin):
    _, entetes = super_admin
    reponse = await client.get("/api/v1/statistiques/carte-mouvements/points", headers=entetes)
    assert reponse.status_code == 200
    assert reponse.json()["type"] == "FeatureCollection"


# --- Vue croisée pays x année ---------------------------------------------------------------


@pytest.mark.asyncio
async def test_agreger_par_pays_et_annee_regroupe_commande_et_paiement(db, admin_national_cmr, pays_cameroun):
    """Portabilité SQLite critique ici : extract('year', ...) doit fonctionner
    identiquement sur SQLite (tests) et PostgreSQL (production)."""
    user, _ = admin_national_cmr
    commande = Commande(
        pays_id=pays_cameroun.id, quantite=2, langue_version="FR/EN", mode_impression="centralisee",
        montant_total=3000, statut=StatutCommande.PAYEE, responsable_nom="Test", cree_par_id=user.id,
    )
    db.add(commande)
    await db.commit()
    await db.refresh(commande)
    db.add(
        Paiement(
            commande_id=commande.id, montant=3000, moyen=MoyenPaiement.VIREMENT,
            statut=StatutPaiement.VALIDE, idempotency_key="idem-annee-1",
        )
    )
    await db.commit()

    resultats = await agreger_par_pays_et_annee(db)

    from datetime import datetime, timezone
    annee_courante = datetime.now(timezone.utc).year
    ligne = next(l for l in resultats if l["pays_id"] == pays_cameroun.id and l["annee"] == annee_courante)
    assert ligne["nb_commandes"] == 1
    assert ligne["montant_commandes_xaf"] == 3000
    assert ligne["montant_encaisse_xaf"] == 3000
    assert ligne["moyens_paiement"] == {"virement": 1}


@pytest.mark.asyncio
async def test_agreger_par_pays_et_annee_inclut_passeports_et_controles(
    client, db, agent_controle_cmr, admin_national_cmr, pays_cameroun
):
    user, _ = admin_national_cmr
    _, entetes_agent = agent_controle_cmr

    commande = Commande(
        pays_id=pays_cameroun.id, quantite=1, langue_version="FR/EN", mode_impression="centralisee",
        montant_total=1500, statut=StatutCommande.PAYEE, responsable_nom="Test", cree_par_id=user.id,
    )
    db.add(commande)
    await db.commit()
    await db.refresh(commande)
    passeports = await attribuer_passeports_pour_commande(db, commande)
    await db.commit()

    await client.post(
        "/api/v1/controles", headers=entetes_agent,
        json={"passeport_id": passeports[0].id, "poste_id": "poste-a", "mode": "en_ligne"},
    )

    resultats = await agreger_par_pays_et_annee(db)

    annee_passeport = int(passeports[0].numero_annee)
    ligne = next(l for l in resultats if l["pays_id"] == pays_cameroun.id and l["annee"] == annee_passeport)
    # Le passeport reste PRECHARGE ici (jamais imprimé) -> ne doit pas compter
    assert ligne["nb_passeports_imprimes"] == 0
    assert ligne["nb_controles"] == 1


@pytest.mark.asyncio
async def test_agreger_par_pays_et_annee_filtre_par_pays(db, admin_national_cmr, admin_national_tcd, pays_cameroun, pays_tchad):
    user_cmr, _ = admin_national_cmr
    user_tcd, _ = admin_national_tcd
    for pays, user in [(pays_cameroun, user_cmr), (pays_tchad, user_tcd)]:
        db.add(Commande(
            pays_id=pays.id, quantite=1, langue_version="FR/EN", mode_impression="centralisee",
            montant_total=1500, statut=StatutCommande.PAYEE, responsable_nom="Test", cree_par_id=user.id,
        ))
    await db.commit()

    resultats = await agreger_par_pays_et_annee(db, pays_id=pays_cameroun.id)

    assert all(l["pays_id"] == pays_cameroun.id for l in resultats)


@pytest.mark.asyncio
async def test_endpoint_par_pays_annee_accessible_en_lecture_seule(client, consultation):
    _, entetes = consultation
    reponse = await client.get("/api/v1/statistiques/par-pays-annee", headers=entetes)
    assert reponse.status_code == 200
    assert isinstance(reponse.json(), list)
