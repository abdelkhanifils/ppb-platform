"""
Scénarios de test end-to-end — voir E2E_TEST_PLAN.md pour le catalogue
complet organisé par module. Ce fichier implémente les scénarios marqués
« [implémenté] » : des parcours qui enchaînent plusieurs endpoints/modules,
par opposition aux tests unitaires des autres fichiers qui isolent une
règle métier à la fois.

Paiement en ligne (CinetPay) retiré : voir
app/api/v1/endpoints/paiements.py — seul le scénario de paiement présentiel
(E2E-2.1) est couvert ici pour le Module 2.
"""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models.admin import Parametre, TypeParametre
from app.models.commande import Commande, StatutCommande
from app.models.controle import ResultatControle
from app.models.itineraire import Itineraire
from app.models.numerisation import Numerisation
from app.models.passeport import Passeport, StatutPasseport
from app.models.paiement import Paiement, StatutPaiement

DONNEES_PAGE_3 = {
    "eleveur": {"nom_prenom": "Amadou Ba", "numero_cni": "CM123456", "donnees_dynamiques": {}},
    "convoyeur": {"nom_prenom": "Issa Moussa", "numero_cni": "CM654321", "donnees_dynamiques": {}},
    "itineraire": {
        "pays_origine_id": None,
        "province_origine": "Extrême-Nord",
        "pays_destination_id": None,
        "province_destination": "N'Djamena",
    },
}
DONNEES_PAGE_4 = {
    "especes": [{"espece": "bovin", "nombre_males": 5, "nombre_femelles_jeunes": 3, "nombre_femelles_adultes": 7, "nombre_total": 15}],
    "vaccinations": [{"maladie": "peste_petits_ruminants", "date_vaccination": "2026-01-10", "lieu": "Kousséri"}],
}


# --- E2E-2.1 — Paiement présentiel --------------------------------------------------------


@pytest.mark.asyncio
async def test_e2e_2_1_paiement_presentiel_jusqua_attribution(client, db, admin_national_cmr, super_admin, pays_cameroun):
    user, entetes_admin = admin_national_cmr
    _, entetes_super = super_admin

    reponse = await client.post(
        "/api/v1/commandes", headers=entetes_admin,
        json={"pays_id": pays_cameroun.id, "quantite": 50, "langue_version": "FR/EN", "mode_impression": "centralisee", "responsable_nom": "D"},
    )
    commande_id = reponse.json()["id"]

    reponse = await client.post(
        "/api/v1/paiements/presentiel", headers=entetes_admin,
        json={"commande_id": commande_id, "moyen": "virement", "montant": 75_000},
    )
    assert reponse.status_code == 200
    paiement_id = reponse.json()["paiement_id"]

    reponse = await client.post(f"/api/v1/paiements/{paiement_id}/valider", headers=entetes_super)
    assert reponse.status_code == 200


    commande = await db.get(Commande, commande_id)
    assert commande.statut == StatutCommande.PAYEE
    passeports = (await db.execute(select(Passeport).where(Passeport.commande_id == commande_id))).scalars().all()
    assert len(passeports) == 50


# --- E2E-3.1 — Attribution complète (numérotation, QR, signature, publication) ------------


@pytest.mark.asyncio
async def test_e2e_3_1_attribution_complete_verifiable(client, db, admin_national_cmr, pays_cameroun):
    from app.core.signing import cle_publique_pem, verifier
    from app.services.attribution import attribuer_passeports_pour_commande, construire_chaine_canonique
    import hashlib

    user, _ = admin_national_cmr
    commande = Commande(
        pays_id=pays_cameroun.id, quantite=5, langue_version="FR/EN", mode_impression="centralisee",
        montant_total=7500, statut=StatutCommande.PAYEE, responsable_nom="D", cree_par_id=user.id,
    )
    db.add(commande)
    await db.commit()
    await db.refresh(commande)

    passeports = await attribuer_passeports_pour_commande(db, commande)
    await db.commit()

    numeros_lot = sorted(p.numero_lot for p in passeports)
    assert numeros_lot == [str(n).zfill(7) for n in range(1, 6)]
    assert len({p.qr_uuid for p in passeports}) == 5

    pem = cle_publique_pem()
    for p in passeports:
        chaine = construire_chaine_canonique(p.numero_pays, p.numero_annee, p.numero_lot, p.qr_uuid)
        empreinte = hashlib.sha256(chaine.encode()).digest()
        assert verifier(empreinte, p.signature, pem) is True
        assert p.publie_le is not None


# --- E2E-4.1 / E2E-4.2 — Parcours 4 pages + résilience au rejeu ---------------------------


@pytest.mark.asyncio
async def test_e2e_4_1_parcours_4_pages_puis_rejeu_page4(
    client, db, agent_emission_cmr, admin_national_cmr, pays_cameroun, pays_tchad
):
    from app.services.attribution import attribuer_passeports_pour_commande

    user_agent, entetes_agent = agent_emission_cmr
    user_admin, _ = admin_national_cmr

    commande = Commande(
        pays_id=pays_cameroun.id, quantite=1, langue_version="FR/EN", mode_impression="centralisee",
        montant_total=1500, statut=StatutCommande.PAYEE, responsable_nom="D", cree_par_id=user_admin.id,
    )
    db.add(commande)
    await db.commit()
    await db.refresh(commande)
    passeports = await attribuer_passeports_pour_commande(db, commande)
    await db.commit()
    passeport = passeports[0]

    page3 = {**DONNEES_PAGE_3, "itineraire": {**DONNEES_PAGE_3["itineraire"], "pays_origine_id": pays_cameroun.id, "pays_destination_id": pays_tchad.id}}
    for page_num, donnees in [(1, None), (2, None), (3, page3), (4, DONNEES_PAGE_4)]:
        reponse = await client.post(f"/api/v1/numerisations/{passeport.id}/pages/{page_num}", headers=entetes_agent, json=donnees)
        assert reponse.status_code == 200

    await db.refresh(passeport)
    assert passeport.statut == StatutPasseport.EMIS

    itineraire = (await db.execute(select(Itineraire).where(Itineraire.passeport_id == passeport.id))).scalar_one()
    assert itineraire.publie_le is not None

    # E2E-4.2 : rejeu de la page 4 — aucune duplication.
    reponse = await client.post(f"/api/v1/numerisations/{passeport.id}/pages/4", headers=entetes_agent, json=DONNEES_PAGE_4)
    assert reponse.status_code == 200
    numerisations_page4 = (
        await db.execute(select(Numerisation).where(Numerisation.passeport_id == passeport.id, Numerisation.page_num == 4))
    ).scalars().all()
    assert len(numerisations_page4) == 1


# --- E2E-5.1, 5.2, 5.3 — Scénarios de contrôle --------------------------------------------


async def _emettre_passeport_avec_itineraire(client, db, entetes_agent, commande, pays_origine_id, pays_destination_id):
    from app.services.attribution import attribuer_passeports_pour_commande

    passeports = await attribuer_passeports_pour_commande(db, commande)
    await db.commit()
    passeport = passeports[0]

    page3 = {**DONNEES_PAGE_3, "itineraire": {**DONNEES_PAGE_3["itineraire"], "pays_origine_id": pays_origine_id, "pays_destination_id": pays_destination_id}}
    for page_num, donnees in [(1, None), (2, None), (3, page3), (4, DONNEES_PAGE_4)]:
        await client.post(f"/api/v1/numerisations/{passeport.id}/pages/{page_num}", headers=entetes_agent, json=donnees)
    return passeport


@pytest.mark.asyncio
async def test_e2e_5_1_controle_valide_signature_et_trajet_conformes(
    client, db, agent_emission_cmr, agent_controle_cmr, admin_national_cmr, pays_cameroun, pays_tchad
):
    _, entetes_agent_emission = agent_emission_cmr
    _, entetes_agent_controle = agent_controle_cmr
    user_admin, _ = admin_national_cmr

    commande = Commande(
        pays_id=pays_cameroun.id, quantite=1, langue_version="FR/EN", mode_impression="centralisee",
        montant_total=1500, statut=StatutCommande.PAYEE, responsable_nom="D", cree_par_id=user_admin.id,
    )
    db.add(commande)
    await db.commit()
    await db.refresh(commande)
    passeport = await _emettre_passeport_avec_itineraire(client, db, entetes_agent_emission, commande, pays_cameroun.id, pays_tchad.id)

    reponse = await client.post(
        "/api/v1/controles", headers=entetes_agent_controle,
        json={"passeport_id": passeport.id, "poste_id": "poste-kousseri", "mode": "en_ligne"},
    )

    assert reponse.status_code == 200
    corps = reponse.json()
    assert corps["signature_valide"] is True
    assert corps["conforme_itineraire"] is True
    assert corps["resultat"] == ResultatControle.VALIDE.value


@pytest.mark.asyncio
async def test_e2e_5_2_controle_refuse_signature_falsifiee(
    client, db, agent_emission_cmr, agent_controle_cmr, admin_national_cmr, pays_cameroun, pays_tchad
):
    _, entetes_agent_emission = agent_emission_cmr
    _, entetes_agent_controle = agent_controle_cmr
    user_admin, _ = admin_national_cmr

    commande = Commande(
        pays_id=pays_cameroun.id, quantite=1, langue_version="FR/EN", mode_impression="centralisee",
        montant_total=1500, statut=StatutCommande.PAYEE, responsable_nom="D", cree_par_id=user_admin.id,
    )
    db.add(commande)
    await db.commit()
    await db.refresh(commande)
    passeport = await _emettre_passeport_avec_itineraire(client, db, entetes_agent_emission, commande, pays_cameroun.id, pays_tchad.id)

    passeport.signature = "signature-falsifiee"
    await db.commit()

    reponse = await client.post(
        "/api/v1/controles", headers=entetes_agent_controle,
        json={"passeport_id": passeport.id, "poste_id": "poste-kousseri", "mode": "en_ligne"},
    )

    assert reponse.json()["signature_valide"] is False
    assert reponse.json()["resultat"] == ResultatControle.REFUSE.value


@pytest.mark.asyncio
async def test_e2e_5_3_repli_papier_si_itineraire_non_synchronise(
    client, db, agent_controle_cmr, admin_national_cmr, pays_cameroun
):
    from app.services.attribution import attribuer_passeports_pour_commande

    _, entetes_agent_controle = agent_controle_cmr
    user_admin, _ = admin_national_cmr

    commande = Commande(
        pays_id=pays_cameroun.id, quantite=1, langue_version="FR/EN", mode_impression="centralisee",
        montant_total=1500, statut=StatutCommande.PAYEE, responsable_nom="D", cree_par_id=user_admin.id,
    )
    db.add(commande)
    await db.commit()
    await db.refresh(commande)
    passeports = await attribuer_passeports_pour_commande(db, commande)
    await db.commit()
    # Émission volontairement PAS effectuée — pas d'itinéraire.

    reponse = await client.post(
        "/api/v1/controles", headers=entetes_agent_controle,
        json={"passeport_id": passeports[0].id, "poste_id": "poste-kousseri", "mode": "en_ligne"},
    )

    assert reponse.json()["itineraire_disponible_localement"] is False
    assert reponse.json()["resultat"] == ResultatControle.A_VERIFIER.value


# --- E2E-5.4 — Synchronisation différentielle après coupure --------------------------------


@pytest.mark.asyncio
async def test_e2e_5_4_delta_apres_coupure_reseau(
    client, db, agent_emission_cmr, agent_controle_cmr, admin_national_cmr, pays_cameroun, pays_tchad
):
    """Simule un poste hors-ligne : sa dernière synchronisation date d'il y a 2h ;
    entre-temps, 3 passeports sont attribués. Le delta doit renvoyer exactement ces 3."""
    from app.services.attribution import attribuer_passeports_pour_commande

    _, entetes_agent_emission = agent_emission_cmr
    _, entetes_agent_controle = agent_controle_cmr
    user_admin, _ = admin_national_cmr

    derniere_synchro_poste = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()

    commande = Commande(
        pays_id=pays_cameroun.id, quantite=3, langue_version="FR/EN", mode_impression="centralisee",
        montant_total=4500, statut=StatutCommande.PAYEE, responsable_nom="D", cree_par_id=user_admin.id,
    )
    db.add(commande)
    await db.commit()
    await db.refresh(commande)
    passeports = await attribuer_passeports_pour_commande(db, commande)
    await db.commit()

    reponse = await client.get(
        "/api/v1/controles/cache-verification/delta", headers=entetes_agent_controle,
        params={"depuis": derniere_synchro_poste},
    )

    assert reponse.status_code == 200
    corps = reponse.json()
    ids_recus = {p["id"] for p in corps["passeports_delta"]}
    assert ids_recus == {p.id for p in passeports}


# --- E2E-A.2 — Circuit à deux comptes TexteGabarit -----------------------------------------


@pytest.mark.asyncio
async def test_e2e_a_2_circuit_deux_comptes_gabarit(client, db, super_admin):
    from app.core.rbac import Role
    from app.core.security import create_access_token, hash_password
    from app.models.utilisateur import Utilisateur

    _, entetes_a = super_admin
    b = Utilisateur(email="b@test.org", hash_mdp=hash_password("x"), nom_complet="B", role=Role.SUPER_ADMIN)
    db.add(b)
    await db.commit()
    await db.refresh(b)
    entetes_b = {"Authorization": f"Bearer {create_access_token(b.id, b.role.value, None)}"}

    proposition = await client.post(
        "/api/v1/admin/gabarit/textes/proposer", headers=entetes_a,
        json={"cle": "bullet_3", "langue": "fr", "valeur": "Nouveau texte légal.", "gabarit_version_courante": 2},
    )
    texte_id = proposition.json()["id"]

    auto_validation = await client.post(f"/api/v1/admin/gabarit/textes/{texte_id}/valider", headers=entetes_a)
    assert auto_validation.status_code == 409

    validation_b = await client.post(f"/api/v1/admin/gabarit/textes/{texte_id}/valider", headers=entetes_b)
    assert validation_b.status_code == 200
    assert validation_b.json()["valide_par_id"] == b.id

    revalidation = await client.post(f"/api/v1/admin/gabarit/textes/{texte_id}/valider", headers=entetes_b)
    assert revalidation.status_code == 409


# --- E2E-S.1 — Cohérence du tableau de bord après un cycle complet ------------------------


@pytest.mark.asyncio
async def test_e2e_s_1_tableau_bord_coherent_apres_cycle_complet(
    client, db, agent_emission_cmr, agent_controle_cmr, admin_national_cmr, super_admin, pays_cameroun, pays_tchad, poste_kousseri
):
    from app.models.paiement import MoyenPaiement
    from app.services.attribution import attribuer_passeports_pour_commande

    _, entetes_agent_emission = agent_emission_cmr
    _, entetes_agent_controle = agent_controle_cmr
    user_admin, _ = admin_national_cmr
    _, entetes_super = super_admin

    commande = Commande(
        pays_id=pays_cameroun.id, quantite=1, langue_version="FR/EN", mode_impression="centralisee",
        montant_total=1500, statut=StatutCommande.PAYEE, responsable_nom="D", cree_par_id=user_admin.id,
    )
    db.add(commande)
    await db.commit()
    await db.refresh(commande)
    db.add(Paiement(commande_id=commande.id, montant=1500, moyen=MoyenPaiement.MOBILE_MONEY, statut=StatutPaiement.VALIDE, idempotency_key="e2e-s1"))
    await db.commit()

    passeport = await _emettre_passeport_avec_itineraire(client, db, entetes_agent_emission, commande, pays_cameroun.id, pays_tchad.id)
    await client.post(
        "/api/v1/controles", headers=entetes_agent_controle,
        json={"passeport_id": passeport.id, "poste_id": poste_kousseri.code, "mode": "en_ligne"},
    )

    reponse = await client.get("/api/v1/statistiques/tableau-bord", headers=entetes_super)
    corps = reponse.json()
    ligne_cmr = next(p for p in corps["par_pays"] if p["pays_id"] == pays_cameroun.id)
    assert ligne_cmr["nb_commandes"] == 1
    assert ligne_cmr["montant_encaisse_xaf"] == 1500
    assert ligne_cmr["passeports_par_statut"].get("controle") == 1

    reponse_poste = await client.get("/api/v1/statistiques/par-poste", headers=entetes_super)
    poste_resultat = next(p for p in reponse_poste.json() if p["code"] == poste_kousseri.code)
    assert poste_resultat["total_controles"] == 1
