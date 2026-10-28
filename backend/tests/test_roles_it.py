"""Profil IT, matrice de permissions configurable et présence en ligne."""
import pytest

from app.core import permissions as perms
from app.core.rbac import Role


async def test_it_acces_administration_seulement(client, it):
    _, h = it
    assert (await client.get("/api/v1/roles/matrice", headers=h)).status_code == 200
    assert (await client.get("/api/v1/roles/presence", headers=h)).status_code == 200
    assert (await client.get("/api/v1/utilisateurs", headers=h)).status_code == 200
    # Aucun accès métier ni opérations destructrices.
    assert (await client.get("/api/v1/comptabilite/synthese", headers=h)).status_code == 403
    assert (await client.post("/api/v1/paiements/x/valider", headers=h)).status_code == 403
    assert (await client.get("/api/v1/passeports/emissions-detail", headers=h)).status_code == 403
    assert (await client.get("/api/v1/sauvegardes", headers=h)).status_code in (403, 404)


async def test_defauts_reproduisent_les_roles_historiques(client, comptabilite, gestionnaire):
    _, hc = comptabilite
    _, hg = gestionnaire
    assert (await client.get("/api/v1/comptabilite/synthese", headers=hc)).status_code == 200
    assert (await client.get("/api/v1/roles/matrice", headers=hc)).status_code == 403
    assert (await client.get("/api/v1/roles/matrice", headers=hg)).status_code == 403


async def test_cocher_une_case_ouvre_la_fonctionnalite(client, super_admin, comptabilite):
    _, hs = super_admin
    _, hc = comptabilite
    assert (await client.get("/api/v1/utilisateurs", headers=hc)).status_code == 403
    cible = sorted(perms.defaut_pour(Role.COMPTABILITE) | {"utilisateurs.gerer"})
    r = await client.put("/api/v1/roles/matrice/comptabilite", json={"permissions": cible}, headers=hs)
    assert r.status_code == 200
    assert (await client.get("/api/v1/utilisateurs", headers=hc)).status_code == 200
    # /moi reflète la matrice
    moi = (await client.get("/api/v1/auth/moi", headers=hc)).json()
    assert "utilisateurs.gerer" in moi["permissions"]


async def test_decocher_une_case_ferme_la_fonctionnalite_et_reinitialiser_restaure(client, super_admin, comptabilite):
    _, hs = super_admin
    _, hc = comptabilite
    cible = sorted(perms.defaut_pour(Role.COMPTABILITE) - {"paiements.valider"})
    assert (await client.put("/api/v1/roles/matrice/comptabilite", json={"permissions": cible}, headers=hs)).status_code == 200
    assert (await client.post("/api/v1/paiements/inconnu/valider", headers=hc)).status_code == 403
    assert (await client.post("/api/v1/roles/matrice/comptabilite/reinitialiser", headers=hs)).status_code == 200
    # De nouveau autorisé (404 : le paiement n'existe pas, mais la garde est passée).
    assert (await client.post("/api/v1/paiements/inconnu/valider", headers=hc)).status_code != 403


async def test_permissions_reservees_et_lignes_verrouillees(client, super_admin, it, gestionnaire):
    _, hs = super_admin
    _, hi = it
    r = await client.put("/api/v1/roles/matrice/gestionnaire_cebevirha", json={"permissions": ["sauvegarde.gerer"]}, headers=hi)
    assert r.status_code == 422
    assert (await client.put("/api/v1/roles/matrice/super_admin", json={"permissions": []}, headers=hs)).status_code == 409
    # IT ne peut pas modifier le profil IT ; le Super Admin le peut mais pas sans roles.configurer.
    tout = sorted(perms.defaut_pour(Role.IT))
    assert (await client.put("/api/v1/roles/matrice/it", json={"permissions": tout}, headers=hi)).status_code == 403
    sans = [c for c in tout if c != "roles.configurer"]
    assert (await client.put("/api/v1/roles/matrice/it", json={"permissions": sans}, headers=hs)).status_code == 422
    assert (await client.put("/api/v1/roles/matrice/it", json={"permissions": ["nimporte.quoi"]}, headers=hs)).status_code == 422


async def test_it_ne_gere_pas_les_comptes_super_admin_ou_it(client, it, super_admin):
    _, hi = it
    sa, _ = super_admin
    corps = {"email": "nouveau@test.org", "nom_complet": "N", "mot_de_passe": "Motdepasse123!", "role": "super_admin", "pays_id": None}
    assert (await client.post("/api/v1/utilisateurs", json=corps, headers=hi)).status_code == 403
    corps["role"] = "it"
    assert (await client.post("/api/v1/utilisateurs", json=corps, headers=hi)).status_code == 403
    corps["role"] = "consultation"
    assert (await client.post("/api/v1/utilisateurs", json=corps, headers=hi)).status_code == 201
    assert (await client.patch(f"/api/v1/utilisateurs/{sa.id}", json={"actif": False}, headers=hi)).status_code == 403
    liste = (await client.get("/api/v1/utilisateurs", headers=hi)).json()
    assert all(u["role"] != "super_admin" for u in liste)


async def test_presence_en_ligne(client, it, super_admin):
    u, hi = it
    # Un appel authentifié enregistre l'activité.
    await client.get("/api/v1/auth/moi", headers=hi)
    r = (await client.get("/api/v1/roles/presence", headers=hi)).json()
    moi = next(x for x in r["utilisateurs"] if x["id"] == u.id)
    assert moi["en_ligne"] is True
    sa = next(x for x in r["utilisateurs"] if x["role"] == "super_admin")
    assert sa["en_ligne"] is False and sa["derniere_activite"] is None
    assert r["en_ligne"] == 1 and r["par_role"] == {"it": 1}


async def test_super_admin_na_pas_les_outils_terrain(client, super_admin):
    _, h = super_admin
    moi = (await client.get("/api/v1/auth/moi", headers=h)).json()
    assert "numerisations.scanner" not in moi["permissions"]
    assert "controles.effectuer" not in moi["permissions"]
    assert "roles.configurer" in moi["permissions"] and "sauvegarde.gerer" in moi["permissions"]
    # Les routes terrain restent refusées au Super Admin, comme avant.
    assert (await client.get("/api/v1/passeports/cache-emission", headers=h)).status_code == 403


async def test_compte_it_cree_par_super_admin_a_ses_permissions(client, super_admin):
    _, hs = super_admin
    r = await client.post("/api/v1/utilisateurs", json={"email": "nouvel.it@test.org", "nom_complet": "Nouvel IT", "mot_de_passe": "Motdepasse123!", "role": "it", "pays_id": None}, headers=hs)
    assert r.status_code == 201, r.text
    t = (await client.post("/api/v1/auth/login", json={"email": "nouvel.it@test.org", "password": "Motdepasse123!"})).json()
    moi = (await client.get("/api/v1/auth/moi", headers={"Authorization": "Bearer " + t["access_token"]})).json()
    assert moi["role"] == "it"
    assert {"roles.configurer", "utilisateurs.gerer", "presence.consulter"} <= set(moi["permissions"])
