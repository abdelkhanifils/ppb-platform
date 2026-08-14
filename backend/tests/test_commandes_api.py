"""
Tests du Module 1 — Commande (Document technique, section 3, M1).

Couvrent : création (RBAC, bornes de quantité paramétrables, garde-fou
AutorisationImpression pour le mode décentralisé, calcul du montant depuis
Parametre), consultation (isolation par pays), et changement de mode
d'impression (verrouillé après paiement).
"""
import pytest
from httpx import AsyncClient

from app.models.admin import Parametre, TypeParametre
from app.models.commande import Commande, StatutCommande


async def _creer_parametre(db, cle: str, valeur: str, type_: TypeParametre = TypeParametre.DECIMAL):
    db.add(Parametre(cle=cle, valeur=valeur, type=type_))
    await db.commit()


# --- Création ------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_creation_commande_succes(client: AsyncClient, db, admin_national_cmr, pays_cameroun):
    _, entetes = admin_national_cmr
    await _creer_parametre(db, "prix_unitaire_ppb", "1500")

    reponse = await client.post(
        "/api/v1/commandes",
        headers=entetes,
        json={
            "pays_id": pays_cameroun.id,
            "quantite": 200,
            "langue_version": "FR/EN",
            "mode_impression": "centralisee",
            "responsable_nom": "Directeur de l'Élevage",
        },
    )

    assert reponse.status_code == 201
    corps = reponse.json()
    assert corps["statut"] == StatutCommande.EN_ATTENTE_PAIEMENT.value
    assert corps["montant_total"] == 200 * 1500  # prix lu depuis Parametre, jamais codé en dur


@pytest.mark.asyncio
async def test_creation_refusee_pour_role_non_autorise(client: AsyncClient, agent_emission_cmr, pays_cameroun):
    """Seuls admin_national et super_admin peuvent créer une commande (RBAC)."""
    _, entetes = agent_emission_cmr

    reponse = await client.post(
        "/api/v1/commandes",
        headers=entetes,
        json={
            "pays_id": pays_cameroun.id,
            "quantite": 200,
            "langue_version": "FR/EN",
            "mode_impression": "centralisee",
            "responsable_nom": "Peu importe",
        },
    )

    assert reponse.status_code == 403


@pytest.mark.asyncio
async def test_creation_refusee_pour_pays_different(client: AsyncClient, admin_national_cmr, pays_tchad):
    """Un Admin National ne peut commander que pour son propre pays."""
    _, entetes = admin_national_cmr

    reponse = await client.post(
        "/api/v1/commandes",
        headers=entetes,
        json={
            "pays_id": pays_tchad.id,
            "quantite": 200,
            "langue_version": "FR/AR",
            "mode_impression": "centralisee",
            "responsable_nom": "Peu importe",
        },
    )

    assert reponse.status_code == 403


@pytest.mark.asyncio
async def test_creation_quantite_sous_le_minimum_parametrable(client: AsyncClient, db, admin_national_cmr, pays_cameroun):
    """La borne 50-10 000 est paramétrable — ici resserrée à 100 minimum, doit être respectée."""
    _, entetes = admin_national_cmr
    await _creer_parametre(db, "commande_quantite_min", "100", TypeParametre.INT)
    await _creer_parametre(db, "commande_quantite_max", "10000", TypeParametre.INT)

    reponse = await client.post(
        "/api/v1/commandes",
        headers=entetes,
        json={
            "pays_id": pays_cameroun.id,
            "quantite": 50,  # sous le plancher paramétré (100)
            "langue_version": "FR/EN",
            "mode_impression": "centralisee",
            "responsable_nom": "Peu importe",
        },
    )

    assert reponse.status_code == 422


@pytest.mark.asyncio
async def test_creation_quantite_au_dessus_du_maximum_par_defaut(client: AsyncClient, admin_national_cmr, pays_cameroun):
    """Sans Parametre amorcé, retombe sur les bornes de repli (config) — 10 000 par défaut."""
    _, entetes = admin_national_cmr

    reponse = await client.post(
        "/api/v1/commandes",
        headers=entetes,
        json={
            "pays_id": pays_cameroun.id,
            "quantite": 15_000,
            "langue_version": "FR/EN",
            "mode_impression": "centralisee",
            "responsable_nom": "Peu importe",
        },
    )

    assert reponse.status_code == 422


@pytest.mark.asyncio
async def test_creation_decentralisee_refusee_sans_autorisation(client: AsyncClient, admin_national_cmr, pays_cameroun):
    """Le mode décentralisé exige une AutorisationImpression active — HTTP 422 sinon."""
    _, entetes = admin_national_cmr

    reponse = await client.post(
        "/api/v1/commandes",
        headers=entetes,
        json={
            "pays_id": pays_cameroun.id,
            "quantite": 200,
            "langue_version": "FR/EN",
            "mode_impression": "decentralisee",
            "responsable_nom": "Peu importe",
        },
    )

    assert reponse.status_code == 422
    assert "AutorisationImpression" in reponse.json()["detail"]


@pytest.mark.asyncio
async def test_creation_decentralisee_acceptee_avec_autorisation(
    client: AsyncClient, admin_national_cmr, pays_cameroun, autorisation_impression_cameroun
):
    _, entetes = admin_national_cmr

    reponse = await client.post(
        "/api/v1/commandes",
        headers=entetes,
        json={
            "pays_id": pays_cameroun.id,
            "quantite": 200,
            "langue_version": "FR/EN",
            "mode_impression": "decentralisee",
            "responsable_nom": "Peu importe",
        },
    )

    assert reponse.status_code == 201
    assert reponse.json()["mode_impression"] == "decentralisee"


@pytest.mark.asyncio
async def test_super_admin_peut_creer_pour_nimporte_quel_pays(client: AsyncClient, super_admin, pays_tchad):
    _, entetes = super_admin

    reponse = await client.post(
        "/api/v1/commandes",
        headers=entetes,
        json={
            "pays_id": pays_tchad.id,
            "quantite": 100,
            "langue_version": "FR/AR",
            "mode_impression": "centralisee",
            "responsable_nom": "Peu importe",
        },
    )

    assert reponse.status_code == 201


# --- Consultation -----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_consultation_commande_meme_pays_autorisee(client: AsyncClient, db, admin_national_cmr, pays_cameroun):
    user, entetes = admin_national_cmr
    commande = Commande(
        pays_id=pays_cameroun.id,
        quantite=100,
        langue_version="FR/EN",
        mode_impression="centralisee",
        montant_total=150_000,
        statut=StatutCommande.EN_ATTENTE_PAIEMENT,
        responsable_nom="Test",
        cree_par_id=user.id,
    )
    db.add(commande)
    await db.commit()
    await db.refresh(commande)

    reponse = await client.get(f"/api/v1/commandes/{commande.id}", headers=entetes)

    assert reponse.status_code == 200
    assert reponse.json()["id"] == commande.id


@pytest.mark.asyncio
async def test_consultation_commande_autre_pays_refusee(
    client: AsyncClient, db, admin_national_cmr, admin_national_tcd, pays_tchad
):
    """Un Admin National ne peut pas consulter les commandes d'un autre pays."""
    user_tcd, _ = admin_national_tcd
    _, entetes_cmr = admin_national_cmr

    commande = Commande(
        pays_id=pays_tchad.id,
        quantite=100,
        langue_version="FR/AR",
        mode_impression="centralisee",
        montant_total=150_000,
        statut=StatutCommande.EN_ATTENTE_PAIEMENT,
        responsable_nom="Test",
        cree_par_id=user_tcd.id,
    )
    db.add(commande)
    await db.commit()
    await db.refresh(commande)

    reponse = await client.get(f"/api/v1/commandes/{commande.id}", headers=entetes_cmr)

    assert reponse.status_code == 403


@pytest.mark.asyncio
async def test_liste_commandes_filtree_par_pays_pour_admin_national(
    client: AsyncClient, db, admin_national_cmr, admin_national_tcd, pays_cameroun, pays_tchad
):
    user_cmr, entetes_cmr = admin_national_cmr
    user_tcd, _ = admin_national_tcd

    db.add_all(
        [
            Commande(
                pays_id=pays_cameroun.id, quantite=100, langue_version="FR/EN", mode_impression="centralisee",
                montant_total=1, statut=StatutCommande.EN_ATTENTE_PAIEMENT, responsable_nom="A", cree_par_id=user_cmr.id,
            ),
            Commande(
                pays_id=pays_tchad.id, quantite=100, langue_version="FR/AR", mode_impression="centralisee",
                montant_total=1, statut=StatutCommande.EN_ATTENTE_PAIEMENT, responsable_nom="B", cree_par_id=user_tcd.id,
            ),
        ]
    )
    await db.commit()

    reponse = await client.get("/api/v1/commandes", headers=entetes_cmr)

    assert reponse.status_code == 200
    corps = reponse.json()
    assert len(corps) == 1
    assert corps[0]["pays_id"] == pays_cameroun.id


# --- Changement de mode d'impression ------------------------------------------------------


@pytest.mark.asyncio
async def test_changement_mode_impression_avant_paiement_autorise(
    client: AsyncClient, db, admin_national_cmr, pays_cameroun, autorisation_impression_cameroun
):
    user, entetes = admin_national_cmr
    commande = Commande(
        pays_id=pays_cameroun.id,
        quantite=100,
        langue_version="FR/EN",
        mode_impression="centralisee",
        montant_total=150_000,
        statut=StatutCommande.EN_ATTENTE_PAIEMENT,
        responsable_nom="Test",
        cree_par_id=user.id,
    )
    db.add(commande)
    await db.commit()
    await db.refresh(commande)

    reponse = await client.patch(
        f"/api/v1/commandes/{commande.id}/mode-impression",
        headers=entetes,
        json={"mode_impression": "decentralisee"},
    )

    assert reponse.status_code == 200
    assert reponse.json()["mode_impression"] == "decentralisee"


@pytest.mark.asyncio
async def test_changement_mode_impression_apres_paiement_refuse(
    client: AsyncClient, db, admin_national_cmr, pays_cameroun
):
    """Verrou métier : plus de modification possible une fois la commande payée (statut PAYEE)."""
    user, entetes = admin_national_cmr
    commande = Commande(
        pays_id=pays_cameroun.id,
        quantite=100,
        langue_version="FR/EN",
        mode_impression="centralisee",
        montant_total=150_000,
        statut=StatutCommande.PAYEE,
        responsable_nom="Test",
        cree_par_id=user.id,
    )
    db.add(commande)
    await db.commit()
    await db.refresh(commande)

    reponse = await client.patch(
        f"/api/v1/commandes/{commande.id}/mode-impression",
        headers=entetes,
        json={"mode_impression": "centralisee"},
    )

    assert reponse.status_code == 409


@pytest.mark.asyncio
async def test_changement_mode_impression_commande_introuvable(client: AsyncClient, admin_national_cmr):
    _, entetes = admin_national_cmr

    reponse = await client.patch(
        "/api/v1/commandes/id-inexistant/mode-impression",
        headers=entetes,
        json={"mode_impression": "centralisee"},
    )

    assert reponse.status_code == 404


@pytest.mark.asyncio
async def test_changement_mode_impression_refuse_pour_autre_pays(
    client: AsyncClient, db, admin_national_cmr, admin_national_tcd, pays_tchad
):
    user_tcd, _ = admin_national_tcd
    _, entetes_cmr = admin_national_cmr

    commande = Commande(
        pays_id=pays_tchad.id,
        quantite=100,
        langue_version="FR/AR",
        mode_impression="centralisee",
        montant_total=150_000,
        statut=StatutCommande.EN_ATTENTE_PAIEMENT,
        responsable_nom="Test",
        cree_par_id=user_tcd.id,
    )
    db.add(commande)
    await db.commit()
    await db.refresh(commande)

    reponse = await client.patch(
        f"/api/v1/commandes/{commande.id}/mode-impression",
        headers=entetes_cmr,
        json={"mode_impression": "decentralisee"},
    )

    assert reponse.status_code == 403
