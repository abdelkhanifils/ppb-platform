"""Test unitaire de app.services.commandes.expirer_commandes_echues — règle métier
« Une commande non payée sous 30 jours passe automatiquement au statut expirée »
(Document technique, Module 1). Appelé directement sur la session de test, sans
passer par la couche HTTP : c'est une règle de fond, pas un comportement d'endpoint."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models.admin import Parametre, TypeParametre
from app.models.commande import Commande, StatutCommande
from app.services.commandes import expirer_commandes_echues


async def _creer_commande(db, pays_id: int, user_id: str, cree_le: datetime, statut=StatutCommande.EN_ATTENTE_PAIEMENT):
    commande = Commande(
        pays_id=pays_id,
        quantite=100,
        langue_version="FR/EN",
        mode_impression="centralisee",
        montant_total=150_000,
        statut=statut,
        responsable_nom="Test",
        cree_par_id=user_id,
    )
    db.add(commande)
    await db.flush()
    # cree_le a un server_default : on le force explicitement pour simuler l'ancienneté.
    commande.cree_le = cree_le
    await db.commit()
    await db.refresh(commande)
    return commande


@pytest.mark.asyncio
async def test_expire_les_commandes_echues_au_dela_du_delai_par_defaut(db, admin_national_cmr, pays_cameroun):
    user, _ = admin_national_cmr
    ancienne = await _creer_commande(
        db, pays_cameroun.id, user.id, cree_le=datetime.now(timezone.utc) - timedelta(days=45)
    )
    recente = await _creer_commande(
        db, pays_cameroun.id, user.id, cree_le=datetime.now(timezone.utc) - timedelta(days=5)
    )

    nombre_expirees = await expirer_commandes_echues(db, delai_jours_defaut=30)

    assert nombre_expirees == 1
    await db.refresh(ancienne)
    await db.refresh(recente)
    assert ancienne.statut == StatutCommande.EXPIREE
    assert recente.statut == StatutCommande.EN_ATTENTE_PAIEMENT


@pytest.mark.asyncio
async def test_ne_touche_pas_les_commandes_deja_payees(db, admin_national_cmr, pays_cameroun):
    user, _ = admin_national_cmr
    payee_ancienne = await _creer_commande(
        db, pays_cameroun.id, user.id,
        cree_le=datetime.now(timezone.utc) - timedelta(days=90),
        statut=StatutCommande.PAYEE,
    )

    nombre_expirees = await expirer_commandes_echues(db, delai_jours_defaut=30)

    assert nombre_expirees == 0
    await db.refresh(payee_ancienne)
    assert payee_ancienne.statut == StatutCommande.PAYEE


@pytest.mark.asyncio
async def test_delai_parametrable_via_parametre_systeme(db, admin_national_cmr, pays_cameroun):
    """Le délai de 30 jours n'est pas figé : Parametre('commande_expiration_jours') prime
    sur la valeur de repli passée en argument."""
    user, _ = admin_national_cmr
    db.add(Parametre(cle="commande_expiration_jours", valeur="10", type=TypeParametre.INT))
    await db.commit()

    commande_15_jours = await _creer_commande(
        db, pays_cameroun.id, user.id, cree_le=datetime.now(timezone.utc) - timedelta(days=15)
    )

    # Sans le paramètre, delai_jours_defaut=30 n'aurait pas expiré une commande de 15 jours.
    nombre_expirees = await expirer_commandes_echues(db, delai_jours_defaut=30)

    assert nombre_expirees == 1
    await db.refresh(commande_15_jours)
    assert commande_15_jours.statut == StatutCommande.EXPIREE


@pytest.mark.asyncio
async def test_aucune_commande_a_expirer_retourne_zero(db, admin_national_cmr, pays_cameroun):
    user, _ = admin_national_cmr
    await _creer_commande(db, pays_cameroun.id, user.id, cree_le=datetime.now(timezone.utc))

    nombre_expirees = await expirer_commandes_echues(db, delai_jours_defaut=30)

    assert nombre_expirees == 0

    result = await db.execute(select(Commande))
    commande = result.scalar_one()
    assert commande.statut == StatutCommande.EN_ATTENTE_PAIEMENT
