"""Tests du Module 5 — Contrôle : vérification d'authenticité (signature),
conformité au trajet déclaré, et synchronisation différentielle (delta)."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models.commande import Commande, StatutCommande
from app.models.controle import ResultatControle
from app.models.itineraire import Itineraire
from app.services.attribution import attribuer_passeports_pour_commande
from app.services.emission import creer_entites_page3

DONNEES_ITINERAIRE = {
    "eleveur": {"nom_prenom": "A", "numero_cni": "1", "donnees_dynamiques": {}},
    "convoyeur": {"nom_prenom": "B", "numero_cni": "2", "donnees_dynamiques": {}},
    "itineraire": {
        "pays_origine_id": None,
        "province_origine": "Extrême-Nord",
        "pays_destination_id": None,
        "province_destination": "N'Djamena",
    },
}


async def _preparer_passeport_avec_itineraire(db, pays_id_emission: int, user_id: str, pays_origine_id: int, pays_destination_id: int):
    commande = Commande(
        pays_id=pays_id_emission, quantite=1, langue_version="FR/EN", mode_impression="centralisee",
        montant_total=1500, statut=StatutCommande.PAYEE, responsable_nom="Test", cree_par_id=user_id,
    )
    db.add(commande)
    await db.commit()
    await db.refresh(commande)
    passeports = await attribuer_passeports_pour_commande(db, commande)
    await db.commit()
    passeport = passeports[0]

    donnees = {**DONNEES_ITINERAIRE, "itineraire": {**DONNEES_ITINERAIRE["itineraire"], "pays_origine_id": pays_origine_id, "pays_destination_id": pays_destination_id}}
    await creer_entites_page3(db, passeport.id, donnees)
    await db.commit()
    return passeport


# --- Vérification d'authenticité et conformité ------------------------------------------------


@pytest.mark.asyncio
async def test_controle_valide_si_signature_ok_et_pays_sur_le_trajet(
    client, db, agent_controle_cmr, admin_national_cmr, pays_cameroun, pays_tchad
):
    """L'agent est au Cameroun ; le trajet Cameroun -> Tchad passe par son pays."""
    _, entetes = agent_controle_cmr
    user_admin, _ = admin_national_cmr
    passeport = await _preparer_passeport_avec_itineraire(db, pays_cameroun.id, user_admin.id, pays_cameroun.id, pays_tchad.id)

    reponse = await client.post(
        "/api/v1/controles",
        headers=entetes,
        json={"passeport_id": passeport.id, "poste_id": "poste-kousseri", "mode": "en_ligne"},
    )

    assert reponse.status_code == 200
    corps = reponse.json()
    assert corps["signature_valide"] is True
    assert corps["conforme_itineraire"] is True
    assert corps["resultat"] == ResultatControle.VALIDE.value


@pytest.mark.asyncio
async def test_controle_refuse_si_pays_hors_trajet(
    client, db, agent_controle_tcd, admin_national_cmr, pays_cameroun, pays_tchad
):
    """Le trajet est Cameroun -> Cameroun (interne) ; un agent tchadien ne fait
    partie ni de l'origine ni de la destination."""
    _, entetes = agent_controle_tcd
    user_admin, _ = admin_national_cmr
    passeport = await _preparer_passeport_avec_itineraire(db, pays_cameroun.id, user_admin.id, pays_cameroun.id, pays_cameroun.id)

    reponse = await client.post(
        "/api/v1/controles",
        headers=entetes,
        json={"passeport_id": passeport.id, "poste_id": "poste-ngueli", "mode": "en_ligne"},
    )

    assert reponse.status_code == 200
    corps = reponse.json()
    assert corps["signature_valide"] is True
    assert corps["conforme_itineraire"] is False
    assert corps["resultat"] == ResultatControle.REFUSE.value


@pytest.mark.asyncio
async def test_controle_refuse_si_signature_invalide(client, db, agent_controle_cmr, admin_national_cmr, pays_cameroun, pays_tchad):
    """Une signature falsifiée est rédhibitoire, même si l'itinéraire serait conforme."""
    _, entetes = agent_controle_cmr
    user_admin, _ = admin_national_cmr
    passeport = await _preparer_passeport_avec_itineraire(db, pays_cameroun.id, user_admin.id, pays_cameroun.id, pays_tchad.id)
    passeport.signature = "signature-falsifiee-en-base64"
    await db.commit()

    reponse = await client.post(
        "/api/v1/controles",
        headers=entetes,
        json={"passeport_id": passeport.id, "poste_id": "poste-kousseri", "mode": "en_ligne"},
    )

    assert reponse.status_code == 200
    corps = reponse.json()
    assert corps["signature_valide"] is False
    assert corps["resultat"] == ResultatControle.REFUSE.value
    assert corps["conforme_itineraire"] is None  # jamais évalué : la signature a déjà tranché


@pytest.mark.asyncio
async def test_controle_a_verifier_si_itineraire_non_synchronise(
    client, db, agent_controle_cmr, admin_national_cmr, pays_cameroun, pays_tchad
):
    """Passeport émis mais sans Itineraire encore créé (page 3 non complétée) —
    repli sur le document papier, jamais un blocage ni une validation par défaut."""
    _, entetes = agent_controle_cmr
    user_admin, _ = admin_national_cmr

    commande = Commande(
        pays_id=pays_cameroun.id, quantite=1, langue_version="FR/EN", mode_impression="centralisee",
        montant_total=1500, statut=StatutCommande.PAYEE, responsable_nom="Test", cree_par_id=user_admin.id,
    )
    db.add(commande)
    await db.commit()
    await db.refresh(commande)
    passeports = await attribuer_passeports_pour_commande(db, commande)
    await db.commit()
    passeport = passeports[0]

    reponse = await client.post(
        "/api/v1/controles",
        headers=entetes,
        json={"passeport_id": passeport.id, "poste_id": "poste-kousseri", "mode": "en_ligne"},
    )

    assert reponse.status_code == 200
    corps = reponse.json()
    assert corps["signature_valide"] is True
    assert corps["itineraire_disponible_localement"] is False
    assert corps["resultat"] == ResultatControle.A_VERIFIER.value


@pytest.mark.asyncio
async def test_controle_refuse_role_non_autorise(client, agent_emission_cmr):
    """Seul agent_controle peut enregistrer un contrôle."""
    _, entetes = agent_emission_cmr

    reponse = await client.post(
        "/api/v1/controles",
        headers=entetes,
        json={"passeport_id": "peu-importe", "poste_id": "poste-x", "mode": "en_ligne"},
    )

    assert reponse.status_code == 403


# --- Synchronisation différentielle -----------------------------------------------------------


@pytest.mark.asyncio
async def test_delta_renvoie_passeports_et_itineraires_publies_apres_le_seuil(
    client, db, agent_controle_cmr, admin_national_cmr, pays_cameroun, pays_tchad
):
    _, entetes = agent_controle_cmr
    user_admin, _ = admin_national_cmr
    seuil = datetime.now(timezone.utc) - timedelta(minutes=1)

    passeport = await _preparer_passeport_avec_itineraire(db, pays_cameroun.id, user_admin.id, pays_cameroun.id, pays_tchad.id)

    reponse = await client.get(
        "/api/v1/controles/cache-verification/delta", headers=entetes, params={"depuis": seuil.isoformat()}
    )

    assert reponse.status_code == 200
    corps = reponse.json()
    assert any(p["id"] == passeport.id for p in corps["passeports_delta"])
    assert any(i["passeport_id"] == passeport.id for i in corps["itineraires_delta"])


@pytest.mark.asyncio
async def test_delta_exclut_ce_qui_est_anterieur_au_seuil(
    client, db, agent_controle_cmr, admin_national_cmr, pays_cameroun, pays_tchad
):
    _, entetes = agent_controle_cmr
    user_admin, _ = admin_national_cmr
    passeport = await _preparer_passeport_avec_itineraire(db, pays_cameroun.id, user_admin.id, pays_cameroun.id, pays_tchad.id)

    seuil_futur = datetime.now(timezone.utc) + timedelta(minutes=1)

    reponse = await client.get(
        "/api/v1/controles/cache-verification/delta", headers=entetes, params={"depuis": seuil_futur.isoformat()}
    )

    assert reponse.status_code == 200
    corps = reponse.json()
    assert not any(p["id"] == passeport.id for p in corps["passeports_delta"])
    assert not any(i["passeport_id"] == passeport.id for i in corps["itineraires_delta"])


@pytest.mark.asyncio
async def test_delta_horodatage_invalide_retombe_sur_tout_lhistorique(
    client, db, agent_controle_cmr, admin_national_cmr, pays_cameroun, pays_tchad
):
    _, entetes = agent_controle_cmr
    user_admin, _ = admin_national_cmr
    passeport = await _preparer_passeport_avec_itineraire(db, pays_cameroun.id, user_admin.id, pays_cameroun.id, pays_tchad.id)

    reponse = await client.get(
        "/api/v1/controles/cache-verification/delta", headers=entetes, params={"depuis": "horodatage-invalide"}
    )

    assert reponse.status_code == 200
    corps = reponse.json()
    assert any(p["id"] == passeport.id for p in corps["passeports_delta"])


@pytest.mark.asyncio
async def test_cache_verification_complet_inclut_itineraires(
    client, db, admin_national_cmr, pays_cameroun, pays_tchad
):
    user_admin, _ = admin_national_cmr
    passeport = await _preparer_passeport_avec_itineraire(db, pays_cameroun.id, user_admin.id, pays_cameroun.id, pays_tchad.id)

    reponse = await client.get("/api/v1/controles/cache-verification")

    assert reponse.status_code == 200
    corps = reponse.json()
    assert any(p["id"] == passeport.id for p in corps["passeports"])
    assert any(i["passeport_id"] == passeport.id for i in corps["itineraires"])


# --- Enrichissement du cache avec éleveur/convoyeur/troupeau (aperçu document, app de contrôle) ---


@pytest.mark.asyncio
async def test_cache_verification_inclut_eleveur_convoyeur_meme_sans_troupeau(
    client, db, admin_national_cmr, pays_cameroun, pays_tchad
):
    """Page 3 transmise, page 4 pas encore : éleveur/convoyeur doivent
    apparaître, mais troupeau_especes doit rester une liste vide — jamais
    une erreur ni un champ manquant (voir _enrichir_avec_emission)."""
    user_admin, _ = admin_national_cmr
    passeport = await _preparer_passeport_avec_itineraire(db, pays_cameroun.id, user_admin.id, pays_cameroun.id, pays_tchad.id)

    reponse = await client.get("/api/v1/controles/cache-verification")

    assert reponse.status_code == 200
    itineraire = next(i for i in reponse.json()["itineraires"] if i["passeport_id"] == passeport.id)
    assert itineraire["eleveur"]["nom_prenom"] == "A"
    assert itineraire["convoyeur"]["nom_prenom"] == "B"
    assert itineraire["troupeau_especes"] == []
    assert itineraire["vaccinations"] == []


@pytest.mark.asyncio
async def test_cache_verification_inclut_troupeau_apres_page4(
    client, db, admin_national_cmr, pays_cameroun, pays_tchad
):
    from app.services.emission import creer_entites_page4

    user_admin, _ = admin_national_cmr
    passeport = await _preparer_passeport_avec_itineraire(db, pays_cameroun.id, user_admin.id, pays_cameroun.id, pays_tchad.id)
    await creer_entites_page4(
        db, passeport.id,
        {
            "especes": [{"espece": "bovin", "nombre_males": 5, "nombre_femelles_jeunes": 3, "nombre_femelles_adultes": 7, "nombre_total": 15}],
            "vaccinations": [{"maladie": "peste_petits_ruminants", "date_vaccination": "2026-01-10", "lieu": "Kousséri"}],
        },
    )
    await db.commit()

    reponse = await client.get("/api/v1/controles/cache-verification")

    itineraire = next(i for i in reponse.json()["itineraires"] if i["passeport_id"] == passeport.id)
    assert len(itineraire["troupeau_especes"]) == 1
    assert itineraire["troupeau_especes"][0]["espece"] == "bovin"
    assert itineraire["troupeau_especes"][0]["nombre_total"] == 15
    assert len(itineraire["vaccinations"]) == 1
    assert itineraire["vaccinations"][0]["maladie"] == "peste_petits_ruminants"


@pytest.mark.asyncio
async def test_cache_verification_delta_enrichi_aussi(client, db, agent_controle_cmr, admin_national_cmr, pays_cameroun, pays_tchad):
    """Le delta partage exactement le même chemin d'enrichissement que le
    cache complet (_enrichir_avec_emission) — vérifié ici séparément car
    c'est un endpoint distinct, authentifié."""
    _, entetes = agent_controle_cmr
    user_admin, _ = admin_national_cmr
    passeport = await _preparer_passeport_avec_itineraire(db, pays_cameroun.id, user_admin.id, pays_cameroun.id, pays_tchad.id)

    reponse = await client.get(
        "/api/v1/controles/cache-verification/delta", headers=entetes, params={"depuis": "2020-01-01T00:00:00Z"}
    )

    assert reponse.status_code == 200
    itineraire = next(i for i in reponse.json()["itineraires_delta"] if i["passeport_id"] == passeport.id)
    assert itineraire["eleveur"]["nom_prenom"] == "A"
    assert itineraire["troupeau_especes"] == []


# --- Historique des contrôles (tableau de bord) --------------------------------------------


@pytest.mark.asyncio
async def test_historique_controles_refuse_sans_authentification(client):
    reponse = await client.get("/api/v1/controles")
    assert reponse.status_code == 401


@pytest.mark.asyncio
async def test_historique_controles_restreint_par_pays(
    client, db, agent_controle_cmr, agent_controle_tcd, admin_national_cmr, admin_national_tcd, pays_cameroun, pays_tchad
):
    """Un contrôle sur un passeport camerounais et un contrôle sur un
    passeport tchadien : un Admin National camerounais ne doit voir que le
    premier."""
    from app.services.attribution import attribuer_passeports_pour_commande

    user_admin_cmr, entetes_admin_cmr = admin_national_cmr
    user_admin_tcd, _ = admin_national_tcd
    agent_cmr, entetes_agent_cmr = agent_controle_cmr
    agent_tcd, entetes_agent_tcd = agent_controle_tcd

    commande_cmr = Commande(
        pays_id=pays_cameroun.id, quantite=1, langue_version="FR/EN", mode_impression="centralisee",
        montant_total=1500, statut=StatutCommande.PAYEE, responsable_nom="Test", cree_par_id=user_admin_cmr.id,
    )
    commande_tcd = Commande(
        pays_id=pays_tchad.id, quantite=1, langue_version="FR/EN", mode_impression="centralisee",
        montant_total=1500, statut=StatutCommande.PAYEE, responsable_nom="Test", cree_par_id=user_admin_tcd.id,
    )
    db.add(commande_cmr)
    db.add(commande_tcd)
    await db.commit()
    await db.refresh(commande_cmr)
    await db.refresh(commande_tcd)
    passeport_cmr = (await attribuer_passeports_pour_commande(db, commande_cmr))[0]
    passeport_tcd = (await attribuer_passeports_pour_commande(db, commande_tcd))[0]
    await db.commit()

    await client.post(
        "/api/v1/controles", headers=entetes_agent_cmr,
        json={"passeport_id": passeport_cmr.id, "poste_id": "poste-a", "mode": "en_ligne"},
    )
    await client.post(
        "/api/v1/controles", headers=entetes_agent_tcd,
        json={"passeport_id": passeport_tcd.id, "poste_id": "poste-b", "mode": "en_ligne"},
    )

    reponse_cmr = await client.get("/api/v1/controles", headers=entetes_admin_cmr)

    assert reponse_cmr.status_code == 200
    numeros_vus = {c["numero"] for c in reponse_cmr.json()}
    numero_cmr = f"{passeport_cmr.numero_pays}-{passeport_cmr.numero_annee}-{passeport_cmr.numero_lot}"
    numero_tcd = f"{passeport_tcd.numero_pays}-{passeport_tcd.numero_annee}-{passeport_tcd.numero_lot}"
    assert numero_cmr in numeros_vus
    assert numero_tcd not in numeros_vus


@pytest.mark.asyncio
async def test_historique_controles_inclut_agent_et_date(client, db, agent_controle_cmr, admin_national_cmr, pays_cameroun):
    from app.services.attribution import attribuer_passeports_pour_commande

    user_admin, entetes_admin = admin_national_cmr
    agent, entetes_agent = agent_controle_cmr

    commande = Commande(
        pays_id=pays_cameroun.id, quantite=1, langue_version="FR/EN", mode_impression="centralisee",
        montant_total=1500, statut=StatutCommande.PAYEE, responsable_nom="Test", cree_par_id=user_admin.id,
    )
    db.add(commande)
    await db.commit()
    await db.refresh(commande)
    passeport = (await attribuer_passeports_pour_commande(db, commande))[0]
    await db.commit()

    await client.post(
        "/api/v1/controles", headers=entetes_agent,
        json={"passeport_id": passeport.id, "poste_id": "poste-kousseri", "mode": "en_ligne"},
    )

    reponse = await client.get("/api/v1/controles", headers=entetes_admin)

    assert reponse.status_code == 200
    controle = reponse.json()[0]
    assert controle["agent_nom"] == agent.nom_complet
    assert controle["poste_id"] == "poste-kousseri"
    assert "date" in controle
