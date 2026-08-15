"""Test du référentiel des pays — GET /pays doit toujours refléter la base
réelle, jamais une liste supposée côté client (voir la correction du bug
« pays n'existe pas » causé par une liste codée en dur dans le frontend)."""
import pytest


@pytest.mark.asyncio
async def test_lister_pays_retourne_les_six_pays_cemac(client, admin_national_cmr, pays_cameroun, pays_tchad):
    _, entetes = admin_national_cmr

    reponse = await client.get("/api/v1/pays", headers=entetes)

    assert reponse.status_code == 200
    corps = reponse.json()
    ids = {p["id"] for p in corps}
    assert pays_cameroun.id in ids
    assert pays_tchad.id in ids


@pytest.mark.asyncio
async def test_lister_pays_refuse_sans_authentification(client):
    reponse = await client.get("/api/v1/pays")
    assert reponse.status_code == 401
