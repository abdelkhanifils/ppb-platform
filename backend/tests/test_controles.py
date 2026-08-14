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
