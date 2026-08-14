"""Tests des failles corrigées lors de la revue de sécurité RBAC (voir
SECURITY_REVIEW.md) — un Admin National ne doit jamais pouvoir agir sur les
données d'un pays qui n'est pas le sien, quel que soit l'endpoint."""
import pytest

from app.core.config import settings
from app.core.startup_checks import verifier_secrets_production
from app.models.commande import Commande, StatutCommande
from app.services.attribution import attribuer_passeports_pour_commande


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
async def test_moyens_disponibles_refuse_sans_authentification(client, db, admin_national_cmr, pays_cameroun):
    user, _ = admin_national_cmr
    commande = await _creer_commande(db, pays_cameroun.id, user.id)

    reponse = await client.get(f"/api/v1/paiements/{commande.id}/moyens-disponibles")

    assert reponse.status_code == 401


@pytest.mark.asyncio
async def test_moyens_disponibles_refuse_pour_autre_pays(client, db, admin_national_cmr, admin_national_tcd, pays_tchad):
    user_tcd, _ = admin_national_tcd
    _, entetes_cmr = admin_national_cmr
    commande = await _creer_commande(db, pays_tchad.id, user_tcd.id)

    reponse = await client.get(f"/api/v1/paiements/{commande.id}/moyens-disponibles", headers=entetes_cmr)

    assert reponse.status_code == 403


@pytest.mark.asyncio
async def test_paiement_presentiel_refuse_pour_commande_dun_autre_pays(
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
async def test_super_admin_non_restreint_par_pays(client, db, admin_national_tcd, super_admin, pays_tchad):
    """Le Super Admin, lui, doit pouvoir agir sur n'importe quel pays."""
    user_tcd, _ = admin_national_tcd
    _, entetes_super = super_admin
    commande = await _creer_commande(db, pays_tchad.id, user_tcd.id)

    reponse = await client.get(f"/api/v1/paiements/{commande.id}/moyens-disponibles", headers=entetes_super)

    assert reponse.status_code == 200


@pytest.mark.asyncio
async def test_transmettre_page_refuse_pour_passeport_dun_autre_pays(
    client, db, agent_emission_cmr, admin_national_cmr, pays_cameroun, pays_tchad
):
    """Un agent d'émission camerounais ne peut pas numériser un passeport tchadien."""
    _, entetes_agent_cmr = agent_emission_cmr
    user_admin, _ = admin_national_cmr

    commande = Commande(
        pays_id=pays_tchad.id, quantite=1, langue_version="FR/AR", mode_impression="centralisee",
        montant_total=1500, statut=StatutCommande.PAYEE, responsable_nom="Test", cree_par_id=user_admin.id,
    )
    db.add(commande)
    await db.commit()
    await db.refresh(commande)
    passeports = await attribuer_passeports_pour_commande(db, commande)
    await db.commit()
    passeport_tchad = passeports[0]

    reponse = await client.post(
        f"/api/v1/numerisations/{passeport_tchad.id}/pages/1", headers=entetes_agent_cmr, json=None
    )

    assert reponse.status_code == 403


# --- Garde-fou des secrets par défaut ------------------------------------------------------


def test_demarrage_refuse_avec_secret_jwt_par_defaut_en_production():
    ancien_environnement, ancien_secret = settings.ENVIRONMENT, settings.JWT_SECRET
    try:
        settings.ENVIRONMENT = "production"
        settings.JWT_SECRET = "change-me-in-production"
        with pytest.raises(RuntimeError, match="JWT_SECRET"):
            verifier_secrets_production()
    finally:
        settings.ENVIRONMENT, settings.JWT_SECRET = ancien_environnement, ancien_secret


def test_demarrage_accepte_secrets_valides_en_production():
    ancien_environnement, ancien_secret = settings.ENVIRONMENT, settings.JWT_SECRET
    try:
        settings.ENVIRONMENT = "production"
        settings.JWT_SECRET = "un-secret-suffisamment-long-et-genere-aleatoirement-32plus"
        verifier_secrets_production()  # ne lève pas
    finally:
        settings.ENVIRONMENT, settings.JWT_SECRET = ancien_environnement, ancien_secret


def test_demarrage_ignore_le_controle_hors_production():
    assert settings.ENVIRONMENT == "test"
    verifier_secrets_production()  # ne lève jamais en dehors de la production
