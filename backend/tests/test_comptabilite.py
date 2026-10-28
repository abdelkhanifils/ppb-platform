"""Tests de l'espace Comptabilité : synthèse, liste par période, exports."""
import io
import zipfile
from datetime import datetime, timedelta, timezone

import pytest

from app.models.commande import Commande, StatutCommande
from app.models.paiement import MoyenPaiement, Paiement, StatutPaiement


async def _commande(db, pays_id, user_id, montant, statut, cree_le=None):
    c = Commande(pays_id=pays_id, quantite=100, langue_version="FR/EN", mode_impression="centralisee", montant_total=montant, statut=statut, responsable_nom="Test", cree_par_id=user_id)
    if cree_le:
        c.cree_le = cree_le
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return c


async def _paiement(db, commande, montant, statut, cle, cree_le=None):
    p = Paiement(commande_id=commande.id, montant=montant, moyen=MoyenPaiement.VIREMENT, statut=statut, idempotency_key=cle)
    if cree_le:
        p.cree_le = cree_le
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return p


@pytest.fixture
def maintenant():
    return datetime.now(timezone.utc)


async def _jeu(db, cmr, tcd, user, maintenant):
    payee = await _commande(db, cmr.id, user.id, 1000, StatutCommande.PAYEE)
    await _paiement(db, payee, 1000, StatutPaiement.VALIDE, "k1")
    attente = await _commande(db, tcd.id, user.id, 500, StatutCommande.EN_ATTENTE_PAIEMENT)
    await _paiement(db, attente, 500, StatutPaiement.EN_ATTENTE_VALIDATION, "k2")
    sans_paiement = await _commande(db, tcd.id, user.id, 250, StatutCommande.EN_ATTENTE_PAIEMENT)
    ancienne = await _commande(db, cmr.id, user.id, 700, StatutCommande.PAYEE, cree_le=maintenant - timedelta(days=90))
    await _paiement(db, ancienne, 700, StatutPaiement.VALIDE, "k3", cree_le=maintenant - timedelta(days=90))
    return payee, attente, sans_paiement, ancienne


@pytest.mark.asyncio
async def test_synthese_totaux(client, db, comptabilite, super_admin, pays_cameroun, pays_tchad, maintenant):
    _, entetes = comptabilite
    await _jeu(db, pays_cameroun, pays_tchad, super_admin[0], maintenant)
    r = await client.get("/api/v1/comptabilite/synthese", headers=entetes)
    assert r.status_code == 200
    j = r.json()
    assert j["en_attente"]["nombre"] == 1 and j["en_attente"]["montant"] == 500
    assert j["commandes_payees"] == {"nombre": 2, "montant": 1700}
    assert j["commandes_non_payees"] == {"nombre": 2, "montant": 750}
    assert j["montant_total_commandes"] == 2450
    assert j["encaisse"]["montant"] == 1700
    assert {l["pays"] for l in j["par_pays"]} == {"Cameroun", "Tchad"}


@pytest.mark.asyncio
async def test_synthese_periode_exclut_ancien_mais_garde_attente(client, db, comptabilite, super_admin, pays_cameroun, pays_tchad, maintenant):
    _, entetes = comptabilite
    await _jeu(db, pays_cameroun, pays_tchad, super_admin[0], maintenant)
    debut = (maintenant - timedelta(days=7)).date().isoformat()
    r = await client.get("/api/v1/comptabilite/synthese", headers=entetes, params={"debut": debut})
    j = r.json()
    assert j["commandes_payees"] == {"nombre": 1, "montant": 1000}
    assert j["encaisse"]["montant"] == 1000
    assert j["en_attente"]["nombre"] == 1


@pytest.mark.asyncio
async def test_periode_liste_et_filtre_statut(client, db, comptabilite, super_admin, pays_cameroun, pays_tchad, maintenant):
    _, entetes = comptabilite
    await _jeu(db, pays_cameroun, pays_tchad, super_admin[0], maintenant)
    r = await client.get("/api/v1/comptabilite/periode", headers=entetes)
    assert r.json()["total"] == 3
    r = await client.get("/api/v1/comptabilite/periode", headers=entetes, params={"statut": "en_attente_validation"})
    j = r.json()
    assert j["total"] == 1 and j["lignes"][0]["pays"] == "Tchad" and j["montant_en_attente"] == 500


@pytest.mark.asyncio
async def test_dates_inversees_refusees(client, comptabilite):
    _, entetes = comptabilite
    r = await client.get("/api/v1/comptabilite/periode", headers=entetes, params={"debut": "2026-05-10", "fin": "2026-05-01"})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_export_xlsx_et_csv(client, db, comptabilite, super_admin, pays_cameroun, pays_tchad, maintenant):
    _, entetes = comptabilite
    await _jeu(db, pays_cameroun, pays_tchad, super_admin[0], maintenant)
    r = await client.get("/api/v1/comptabilite/export", headers=entetes)
    assert r.status_code == 200 and r.content[:2] == b"PK"
    assert ".xlsx" in r.headers["content-disposition"]
    r = await client.get("/api/v1/comptabilite/export", headers=entetes, params={"format": "csv"})
    assert r.status_code == 200
    lignes = r.content.decode("utf-8-sig").strip().splitlines()
    assert len(lignes) == 4 and lignes[0].startswith("Date;")


@pytest.mark.asyncio
async def test_factures_zip(client, db, comptabilite, super_admin, pays_cameroun, pays_tchad, maintenant):
    _, entetes = comptabilite
    await _jeu(db, pays_cameroun, pays_tchad, super_admin[0], maintenant)
    r = await client.get("/api/v1/comptabilite/factures-zip", headers=entetes)
    assert r.status_code == 200
    noms = zipfile.ZipFile(io.BytesIO(r.content)).namelist()
    assert len(noms) == 3 and sum("definitive" in n for n in noms) == 2 and sum("proforma" in n for n in noms) == 1


@pytest.mark.asyncio
async def test_factures_zip_vide_donne_404(client, comptabilite):
    _, entetes = comptabilite
    r = await client.get("/api/v1/comptabilite/factures-zip", headers=entetes)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_acces_reserve_aux_profils_financiers(client, admin_national_cmr, agent_emission_cmr, super_admin):
    for entetes in (admin_national_cmr[1], agent_emission_cmr[1]):
        assert (await client.get("/api/v1/comptabilite/synthese", headers=entetes)).status_code == 403
    assert (await client.get("/api/v1/comptabilite/synthese", headers=super_admin[1])).status_code == 200
    assert (await client.get("/api/v1/comptabilite/synthese")).status_code in (401, 403)
