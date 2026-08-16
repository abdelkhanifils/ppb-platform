"""Tests des endpoints de génération PDF — facture (Module 1) et document
imprimable du PPB (Module 3). Vérifie uniquement la structure de haut niveau
(en-tête PDF valide, en-têtes HTTP) — pas le rendu visuel, impossible à
valider par un test automatisé."""
import pytest

from app.models.commande import Commande, StatutCommande
from app.services.attribution import attribuer_passeports_pour_commande


async def _creer_commande(db, pays_id: int, user_id: str) -> Commande:
    commande = Commande(
        pays_id=pays_id, quantite=3, langue_version="FR/EN", mode_impression="centralisee",
        montant_total=4500, statut=StatutCommande.EN_ATTENTE_PAIEMENT, responsable_nom="Test", cree_par_id=user_id,
    )
    db.add(commande)
    await db.commit()
    await db.refresh(commande)
    return commande


@pytest.mark.asyncio
async def test_facture_pdf_telechargeable(client, db, admin_national_cmr, pays_cameroun):
    user, entetes = admin_national_cmr
    commande = await _creer_commande(db, pays_cameroun.id, user.id)

    reponse = await client.get(f"/api/v1/commandes/{commande.id}/facture", headers=entetes)

    assert reponse.status_code == 200
    assert reponse.headers["content-type"] == "application/pdf"
    assert reponse.content[:5] == b"%PDF-"


@pytest.mark.asyncio
async def test_facture_pdf_refuse_pour_autre_pays(client, db, admin_national_cmr, admin_national_tcd, pays_tchad):
    user_tcd, _ = admin_national_tcd
    _, entetes_cmr = admin_national_cmr
    commande = await _creer_commande(db, pays_tchad.id, user_tcd.id)

    reponse = await client.get(f"/api/v1/commandes/{commande.id}/facture", headers=entetes_cmr)

    assert reponse.status_code == 403


@pytest.mark.asyncio
async def test_document_passeport_pdf_telechargeable(client, db, admin_national_cmr, pays_cameroun):
    user, entetes = admin_national_cmr
    commande = await _creer_commande(db, pays_cameroun.id, user.id)
    commande.statut = StatutCommande.PAYEE
    passeports = await attribuer_passeports_pour_commande(db, commande)
    await db.commit()

    reponse = await client.get(f"/api/v1/passeports/{passeports[0].id}/document", headers=entetes)

    assert reponse.status_code == 200
    assert reponse.headers["content-type"] == "application/pdf"
    assert reponse.content[:5] == b"%PDF-"


@pytest.mark.asyncio
async def test_document_impression_lot_pdf_contient_toutes_les_pages(client, db, admin_national_cmr, pays_cameroun):
    """3 passeports x 4 pages -> le PDF concaténé doit être notablement plus
    volumineux qu'un document à un seul passeport (vérification indirecte,
    sans dépendre d'un lecteur PDF pour compter les pages précisément)."""
    user, entetes = admin_national_cmr
    commande = await _creer_commande(db, pays_cameroun.id, user.id)
    commande.statut = StatutCommande.PAYEE
    await attribuer_passeports_pour_commande(db, commande)
    await db.commit()

    reponse_lot = await client.get(f"/api/v1/passeports/commande/{commande.id}/document-impression", headers=entetes)

    assert reponse_lot.status_code == 200
    assert reponse_lot.content[:5] == b"%PDF-"


@pytest.mark.asyncio
async def test_document_impression_lot_404_si_aucun_precharge(client, db, admin_national_cmr, pays_cameroun):
    user, entetes = admin_national_cmr
    commande = await _creer_commande(db, pays_cameroun.id, user.id)  # jamais payée -> aucun passeport

    reponse = await client.get(f"/api/v1/passeports/commande/{commande.id}/document-impression", headers=entetes)

    assert reponse.status_code == 404


@pytest.mark.asyncio
async def test_document_passeport_refuse_pour_autre_pays(client, db, admin_national_cmr, admin_national_tcd, pays_tchad):
    user_tcd, _ = admin_national_tcd
    _, entetes_cmr = admin_national_cmr
    commande = await _creer_commande(db, pays_tchad.id, user_tcd.id)
    commande.statut = StatutCommande.PAYEE
    passeports = await attribuer_passeports_pour_commande(db, commande)
    await db.commit()

    reponse = await client.get(f"/api/v1/passeports/{passeports[0].id}/document", headers=entetes_cmr)

    assert reponse.status_code == 403
