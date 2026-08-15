"""Tests du Module 2 — Paiement présentiel et liste des paiements d'une commande."""
import pytest

from app.models.commande import Commande, StatutCommande


async def _creer_commande(db, pays_id: int, user_id: str, montant: float = 300_000) -> Commande:
    commande = Commande(
        pays_id=pays_id, quantite=200, langue_version="FR/EN", mode_impression="centralisee",
        montant_total=montant, statut=StatutCommande.EN_ATTENTE_PAIEMENT, responsable_nom="Test", cree_par_id=user_id,
    )
    db.add(commande)
    await db.commit()
    await db.refresh(commande)
    return commande


@pytest.mark.asyncio
async def test_enregistrer_paiement_presentiel_succes(client, db, admin_national_cmr, pays_cameroun):
    user, entetes = admin_national_cmr
    commande = await _creer_commande(db, pays_cameroun.id, user.id)

    reponse = await client.post(
        "/api/v1/paiements/presentiel",
        headers=entetes,
        json={"commande_id": commande.id, "moyen": "virement", "montant": 300_000},
    )

    assert reponse.status_code == 200
    assert reponse.json()["statut"] == "en_attente_validation"


@pytest.mark.asyncio
async def test_enregistrer_paiement_presentiel_refuse_pour_autre_pays(
    client, db, admin_national_cmr, admin_national_tcd, pays_tchad
):
    user_tcd, _ = admin_national_tcd
    _, entetes_cmr = admin_national_cmr
    commande = await _creer_commande(db, pays_tchad.id, user_tcd.id)

    reponse = await client.post(
        "/api/v1/paiements/presentiel",
        headers=entetes_cmr,
        json={"commande_id": commande.id, "moyen": "virement", "montant": 300_000},
    )

    assert reponse.status_code == 403


@pytest.mark.asyncio
async def test_valider_paiement_presentiel_declenche_attribution(client, db, admin_national_cmr, super_admin, pays_cameroun):
    from sqlalchemy import select
    from app.models.passeport import Passeport

    user, entetes_admin = admin_national_cmr
    _, entetes_super = super_admin
    commande = await _creer_commande(db, pays_cameroun.id, user.id, montant=1500)

    creation = await client.post(
        "/api/v1/paiements/presentiel", headers=entetes_admin,
        json={"commande_id": commande.id, "moyen": "virement", "montant": 1500},
    )
    paiement_id = creation.json()["paiement_id"]

    reponse = await client.post(f"/api/v1/paiements/{paiement_id}/valider", headers=entetes_super)

    assert reponse.status_code == 200
    await db.refresh(commande)
    assert commande.statut == StatutCommande.PAYEE
    passeports = (await db.execute(select(Passeport).where(Passeport.commande_id == commande.id))).scalars().all()
    assert len(passeports) == commande.quantite


# --- Liste des paiements d'une commande (écran Paiements du Web Admin) --------------------


@pytest.mark.asyncio
async def test_lister_paiements_dune_commande(client, db, admin_national_cmr, pays_cameroun):
    user, entetes = admin_national_cmr
    commande = await _creer_commande(db, pays_cameroun.id, user.id)

    reponse_creation = await client.post(
        "/api/v1/paiements/presentiel",
        headers=entetes,
        json={"commande_id": commande.id, "moyen": "virement", "montant": 300_000},
    )
    assert reponse_creation.status_code == 200

    reponse = await client.get("/api/v1/paiements", headers=entetes, params={"commande_id": commande.id})

    assert reponse.status_code == 200
    corps = reponse.json()
    assert len(corps) == 1
    assert corps[0]["commande_id"] == commande.id


@pytest.mark.asyncio
async def test_lister_paiements_refuse_pour_commande_dun_autre_pays(
    client, db, admin_national_cmr, admin_national_tcd, pays_tchad
):
    user_tcd, _ = admin_national_tcd
    _, entetes_cmr = admin_national_cmr
    commande = await _creer_commande(db, pays_tchad.id, user_tcd.id)

    reponse = await client.get("/api/v1/paiements", headers=entetes_cmr, params={"commande_id": commande.id})

    assert reponse.status_code == 403
