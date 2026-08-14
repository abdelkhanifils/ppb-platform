"""Tests du circuit « quatre yeux » de TexteGabarit (Module Administration) —
couvrent en particulier les deux corrections de la revue de sécurité : garde
d'état (un texte VALIDE/REJETE ne peut plus être retraité) et fixation de
`gabarit_version` dès la proposition (elle n'est plus incrémentée à la
validation, source d'incohérence pour des propositions groupées)."""
import pytest

from app.core.rbac import Role
from app.core.security import create_access_token, hash_password
from app.models.admin import StatutTexteGabarit
from app.models.utilisateur import Utilisateur


async def _proposer(client, entetes, cle="bullet_2_en", langue="en", valeur="Texte initial", version=1):
    return await client.post(
        "/api/v1/admin/gabarit/textes/proposer",
        headers=entetes,
        json={"cle": cle, "langue": langue, "valeur": valeur, "gabarit_version_courante": version},
    )


async def _second_super_admin(db, email="validateur@test.org"):
    validateur = Utilisateur(email=email, hash_mdp=hash_password("x"), nom_complet="Validateur", role=Role.SUPER_ADMIN)
    db.add(validateur)
    await db.commit()
    await db.refresh(validateur)
    entetes = {"Authorization": f"Bearer {create_access_token(validateur.id, validateur.role.value, None)}"}
    return validateur, entetes


@pytest.mark.asyncio
async def test_proposer_puis_valider_par_un_second_compte(client, db, super_admin):
    """Cas nominal : deux comptes Super Admin distincts, proposition puis validation."""
    _, entetes_proposant = super_admin
    validateur, entetes_validateur = await _second_super_admin(db)

    proposition = await _proposer(client, entetes_proposant)
    assert proposition.status_code == 201
    texte_id = proposition.json()["id"]
    assert proposition.json()["statut"] == StatutTexteGabarit.PROPOSE.value

    reponse = await client.post(f"/api/v1/admin/gabarit/textes/{texte_id}/valider", headers=entetes_validateur)

    assert reponse.status_code == 200
    corps = reponse.json()
    assert corps["statut"] == StatutTexteGabarit.VALIDE.value
    assert corps["gabarit_version"] == 1  # fixée à la proposition, jamais incrémentée à la validation
    assert corps["valide_par_id"] == validateur.id


@pytest.mark.asyncio
async def test_proposant_ne_peut_pas_valider_sa_propre_proposition(client, super_admin):
    _, entetes = super_admin
    proposition = await _proposer(client, entetes)
    texte_id = proposition.json()["id"]

    reponse = await client.post(f"/api/v1/admin/gabarit/textes/{texte_id}/valider", headers=entetes)

    assert reponse.status_code == 409


@pytest.mark.asyncio
async def test_texte_deja_valide_ne_peut_pas_etre_revalide(client, db, super_admin):
    """Correctif de sécurité : sans garde d'état, un texte déjà VALIDE pouvait
    être « revalidé », ce qui n'a aucun sens métier."""
    _, entetes_proposant = super_admin
    _, entetes_validateur = await _second_super_admin(db)

    proposition = await _proposer(client, entetes_proposant)
    texte_id = proposition.json()["id"]
    premiere_validation = await client.post(f"/api/v1/admin/gabarit/textes/{texte_id}/valider", headers=entetes_validateur)
    assert premiere_validation.status_code == 200

    seconde_validation = await client.post(f"/api/v1/admin/gabarit/textes/{texte_id}/valider", headers=entetes_validateur)

    assert seconde_validation.status_code == 409


@pytest.mark.asyncio
async def test_texte_rejete_ne_peut_pas_etre_valide_ensuite(client, db, super_admin):
    _, entetes_proposant = super_admin
    _, entetes_validateur = await _second_super_admin(db)

    proposition = await _proposer(client, entetes_proposant)
    texte_id = proposition.json()["id"]

    rejet = await client.post(
        f"/api/v1/admin/gabarit/textes/{texte_id}/rejeter", headers=entetes_validateur, json={"motif": "Formulation imprécise."}
    )
    assert rejet.status_code == 200
    assert rejet.json()["statut"] == StatutTexteGabarit.REJETE.value

    tentative_validation = await client.post(f"/api/v1/admin/gabarit/textes/{texte_id}/valider", headers=entetes_validateur)
    assert tentative_validation.status_code == 409


@pytest.mark.asyncio
async def test_double_proposition_simultanee_refusee(client, super_admin):
    """Deux propositions PROPOSE en attente pour le même (cle, langue, version)
    ne doivent jamais coexister silencieusement."""
    _, entetes = super_admin
    premiere = await _proposer(client, entetes)
    assert premiere.status_code == 201

    seconde = await _proposer(client, entetes, valeur="Une autre formulation")

    assert seconde.status_code == 409


@pytest.mark.asyncio
async def test_completion_gabarit_reflete_les_statuts(client, super_admin):
    _, entetes = super_admin
    await _proposer(client, entetes, cle="bullet_1", version=2)
    await _proposer(client, entetes, cle="bullet_2", version=2)

    reponse = await client.get("/api/v1/admin/gabarit/2/completion", headers=entetes)

    assert reponse.status_code == 200
    corps = reponse.json()
    assert corps["total"] == 2
    assert corps["par_statut"]["propose"] == 2
    assert corps["par_statut"]["valide"] == 0


@pytest.mark.asyncio
async def test_valider_texte_introuvable_404(client, super_admin):
    _, entetes = super_admin
    reponse = await client.post("/api/v1/admin/gabarit/textes/id-inexistant/valider", headers=entetes)
    assert reponse.status_code == 404


@pytest.mark.asyncio
async def test_proposer_refuse_pour_role_non_super_admin(client, admin_national_cmr):
    _, entetes = admin_national_cmr
    reponse = await _proposer(client, entetes)
    assert reponse.status_code == 403
