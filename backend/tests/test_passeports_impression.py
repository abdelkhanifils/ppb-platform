"""Tests des endpoints du Module 3 — Impression : autorisations d'impression
décentralisée (création, chevauchement, suspension), déclaration de lot
(plage fermée, numéros manquants/déjà imprimés), impression centralisée,
et publication/clé publique."""
import pytest

from app.models.commande import Commande, StatutCommande
from app.models.passeport import Passeport, StatutPasseport
from app.services.attribution import attribuer_passeports_pour_commande


async def _attribuer(db, pays_id: int, user_id: str, quantite: int) -> list[Passeport]:
    commande = Commande(
        pays_id=pays_id, quantite=quantite, langue_version="FR/EN", mode_impression="decentralisee",
        montant_total=quantite * 1500, statut=StatutCommande.PAYEE, responsable_nom="Test", cree_par_id=user_id,
    )
    db.add(commande)
    await db.commit()
    await db.refresh(commande)
    passeports = await attribuer_passeports_pour_commande(db, commande)
    await db.commit()
    return passeports


# --- Autorisations d'impression décentralisée --------------------------------------------


@pytest.mark.asyncio
async def test_creer_autorisation_impression_succes(client, super_admin, pays_cameroun):
    _, entetes = super_admin

    reponse = await client.post(
        "/api/v1/passeports/autorisations-impression",
        headers=entetes,
        json={"pays_id": pays_cameroun.id, "plage_debut": 1, "plage_fin": 1000, "gabarit_version": 1},
    )

    assert reponse.status_code == 201
    corps = reponse.json()
    assert corps["active"] is True
    assert corps["plage_debut"] == 1 and corps["plage_fin"] == 1000


@pytest.mark.asyncio
async def test_creer_autorisation_refusee_pour_role_non_super_admin(client, admin_national_cmr, pays_cameroun):
    _, entetes = admin_national_cmr

    reponse = await client.post(
        "/api/v1/passeports/autorisations-impression",
        headers=entetes,
        json={"pays_id": pays_cameroun.id, "plage_debut": 1, "plage_fin": 1000, "gabarit_version": 1},
    )

    assert reponse.status_code == 403


@pytest.mark.asyncio
async def test_creer_autorisation_rejette_plage_invalide(client, super_admin, pays_cameroun):
    _, entetes = super_admin

    reponse = await client.post(
        "/api/v1/passeports/autorisations-impression",
        headers=entetes,
        json={"pays_id": pays_cameroun.id, "plage_debut": 500, "plage_fin": 100, "gabarit_version": 1},
    )

    assert reponse.status_code == 422


@pytest.mark.asyncio
async def test_creer_autorisation_rejette_chevauchement(client, super_admin, pays_cameroun, autorisation_impression_cameroun):
    """`autorisation_impression_cameroun` couvre déjà 1-1000 pour le Cameroun."""
    _, entetes = super_admin

    reponse = await client.post(
        "/api/v1/passeports/autorisations-impression",
        headers=entetes,
        json={"pays_id": pays_cameroun.id, "plage_debut": 500, "plage_fin": 1500, "gabarit_version": 1},
    )

    assert reponse.status_code == 409


@pytest.mark.asyncio
async def test_suspendre_autorisation_impression(client, db, super_admin, autorisation_impression_cameroun):
    _, entetes = super_admin

    reponse = await client.post(
        f"/api/v1/passeports/autorisations-impression/{autorisation_impression_cameroun.id}/suspendre",
        headers=entetes,
    )

    assert reponse.status_code == 200
    assert reponse.json()["active"] is False
    await db.refresh(autorisation_impression_cameroun)
    assert autorisation_impression_cameroun.active is False
    assert autorisation_impression_cameroun.suspendue_par_id is not None


@pytest.mark.asyncio
async def test_suspendre_autorisation_deja_suspendue_refuse(client, db, super_admin, autorisation_impression_cameroun):
    _, entetes = super_admin
    autorisation_impression_cameroun.active = False
    await db.commit()

    reponse = await client.post(
        f"/api/v1/passeports/autorisations-impression/{autorisation_impression_cameroun.id}/suspendre",
        headers=entetes,
    )

    assert reponse.status_code == 409


@pytest.mark.asyncio
async def test_consulter_autorisation_impression_introuvable(client, pays_tchad):
    reponse = await client.get(f"/api/v1/passeports/autorisations-impression/{pays_tchad.id}")
    assert reponse.status_code == 404


# --- Déclaration de lot décentralisé -------------------------------------------------------


@pytest.mark.asyncio
async def test_declarer_lot_succes(client, db, admin_national_cmr, pays_cameroun, autorisation_impression_cameroun):
    user, entetes = admin_national_cmr
    passeports = await _attribuer(db, pays_cameroun.id, user.id, quantite=5)
    assert all(p.statut == StatutPasseport.PRECHARGE for p in passeports)

    reponse = await client.post(
        "/api/v1/passeports/impression-decentralisee/declarer",
        headers=entetes,
        json={"pays_id": pays_cameroun.id, "numero_debut": 1, "numero_fin": 5},
    )

    assert reponse.status_code == 200
    assert reponse.json()["quantite"] == 5
    for p in passeports:
        await db.refresh(p)
        assert p.statut == StatutPasseport.VIERGE


@pytest.mark.asyncio
async def test_declarer_lot_hors_plage_autorisee_rejete(client, db, admin_national_cmr, pays_cameroun):
    """Autorisation limitée à 1-3 ; déclarer 1-5 doit être rejeté avant toute écriture."""
    from app.models.autorisation_impression import AutorisationImpression

    user, entetes = admin_national_cmr
    db.add(AutorisationImpression(pays_id=pays_cameroun.id, plage_debut=1, plage_fin=3, gabarit_version=1, active=True))
    await db.commit()
    passeports = await _attribuer(db, pays_cameroun.id, user.id, quantite=5)

    reponse = await client.post(
        "/api/v1/passeports/impression-decentralisee/declarer",
        headers=entetes,
        json={"pays_id": pays_cameroun.id, "numero_debut": 1, "numero_fin": 5},
    )

    assert reponse.status_code == 422
    for p in passeports:
        await db.refresh(p)
        assert p.statut == StatutPasseport.PRECHARGE  # aucune écriture partielle


@pytest.mark.asyncio
async def test_declarer_lot_sans_autorisation_active_rejete(client, admin_national_cmr, pays_cameroun):
    _, entetes = admin_national_cmr

    reponse = await client.post(
        "/api/v1/passeports/impression-decentralisee/declarer",
        headers=entetes,
        json={"pays_id": pays_cameroun.id, "numero_debut": 1, "numero_fin": 5},
    )

    assert reponse.status_code == 422


@pytest.mark.asyncio
async def test_declarer_lot_numero_manquant_rejete_404(
    client, db, admin_national_cmr, pays_cameroun, autorisation_impression_cameroun
):
    """Seuls 3 passeports existent : déclarer 1-5 doit échouer, aucun numéro fantôme accepté."""
    user, entetes = admin_national_cmr
    await _attribuer(db, pays_cameroun.id, user.id, quantite=3)

    reponse = await client.post(
        "/api/v1/passeports/impression-decentralisee/declarer",
        headers=entetes,
        json={"pays_id": pays_cameroun.id, "numero_debut": 1, "numero_fin": 5},
    )

    assert reponse.status_code == 404


@pytest.mark.asyncio
async def test_declarer_lot_deja_imprime_rejete_409(
    client, db, admin_national_cmr, pays_cameroun, autorisation_impression_cameroun
):
    user, entetes = admin_national_cmr
    await _attribuer(db, pays_cameroun.id, user.id, quantite=3)

    premiere = await client.post(
        "/api/v1/passeports/impression-decentralisee/declarer",
        headers=entetes,
        json={"pays_id": pays_cameroun.id, "numero_debut": 1, "numero_fin": 3},
    )
    assert premiere.status_code == 200

    seconde = await client.post(
        "/api/v1/passeports/impression-decentralisee/declarer",
        headers=entetes,
        json={"pays_id": pays_cameroun.id, "numero_debut": 1, "numero_fin": 3},
    )
    assert seconde.status_code == 409


@pytest.mark.asyncio
async def test_declarer_lot_refuse_pour_autre_pays(
    client, admin_national_cmr, pays_tchad, autorisation_impression_cameroun
):
    """Un Admin National ne peut déclarer un lot que pour son propre pays."""
    _, entetes = admin_national_cmr

    reponse = await client.post(
        "/api/v1/passeports/impression-decentralisee/declarer",
        headers=entetes,
        json={"pays_id": pays_tchad.id, "numero_debut": 1, "numero_fin": 3},
    )

    assert reponse.status_code == 403


# --- Impression centralisée -----------------------------------------------------------------


@pytest.mark.asyncio
async def test_confirmer_impression_centralisee_succes(client, db, super_admin, admin_national_cmr, pays_cameroun):
    user, _ = admin_national_cmr
    _, entetes_super = super_admin
    passeports = await _attribuer(db, pays_cameroun.id, user.id, quantite=4)
    commande_id = passeports[0].commande_id

    reponse = await client.post(
        "/api/v1/passeports/impression-centralisee/confirmer",
        headers=entetes_super,
        params={"commande_id": commande_id},
    )

    assert reponse.status_code == 200
    assert reponse.json()["quantite"] == 4
    for p in passeports:
        await db.refresh(p)
        assert p.statut == StatutPasseport.VIERGE


@pytest.mark.asyncio
async def test_confirmer_impression_centralisee_commande_sans_passeport_precharge(client, super_admin):
    _, entetes = super_admin

    reponse = await client.post(
        "/api/v1/passeports/impression-centralisee/confirmer",
        headers=entetes,
        params={"commande_id": "commande-inexistante"},
    )

    assert reponse.status_code == 404


# --- Publication / clé publique / QR --------------------------------------------------------


@pytest.mark.asyncio
async def test_republier_passeports_non_publies(client, db, super_admin, admin_national_cmr, pays_cameroun):
    user, _ = admin_national_cmr
    _, entetes_super = super_admin
    passeports = await _attribuer(db, pays_cameroun.id, user.id, quantite=2)
    for p in passeports:
        p.publie_le = None  # simule un incident de publication
    await db.commit()

    reponse = await client.post("/api/v1/passeports/sync/publier-nouveaux-passeports", headers=entetes_super)

    assert reponse.status_code == 200
    assert reponse.json()["republies"] == 2
    for p in passeports:
        await db.refresh(p)
        assert p.publie_le is not None


@pytest.mark.asyncio
async def test_cle_publique_endpoint_ne_necessite_pas_authentification(client):
    reponse = await client.get("/api/v1/passeports/cle-publique")

    assert reponse.status_code == 200
    assert b"BEGIN PUBLIC KEY" in reponse.content


@pytest.mark.asyncio
async def test_qrcode_endpoint_retourne_un_png(client, db, admin_national_cmr, pays_cameroun):
    user, entetes = admin_national_cmr
    passeports = await _attribuer(db, pays_cameroun.id, user.id, quantite=1)

    reponse = await client.get(f"/api/v1/passeports/{passeports[0].id}/qrcode", headers=entetes)

    assert reponse.status_code == 200
    assert reponse.headers["content-type"] == "image/png"
    assert reponse.content[:8] == b"\x89PNG\r\n\x1a\n"  # signature de fichier PNG


@pytest.mark.asyncio
async def test_qrcode_endpoint_refuse_pour_autre_pays(client, db, admin_national_cmr, admin_national_tcd, pays_tchad):
    user_tcd, _ = admin_national_tcd
    _, entetes_cmr = admin_national_cmr
    passeports = await _attribuer(db, pays_tchad.id, user_tcd.id, quantite=1)

    reponse = await client.get(f"/api/v1/passeports/{passeports[0].id}/qrcode", headers=entetes_cmr)

    assert reponse.status_code == 403
