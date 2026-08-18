"""Test de app.db.seed — l'amorçage doit pouvoir être rejoué sans erreur sur
une base déjà partiellement (ou totalement) amorcée, notamment pour ajouter
de nouveaux comptes de démonstration (Émission/Contrôle par pays) à une
base existante sans tout réinitialiser."""
import pytest
from sqlalchemy import select

from app.core.rbac import Role
from app.db.seed import COMPTES_DEMO, PAYS_CEMAC, POSTES, seed
from app.models.pays import Pays
from app.models.poste import Poste
from app.models.utilisateur import Utilisateur


def test_seed_cree_un_compte_emission_et_controle_par_pays():
    """Les 6 pays doivent chacun avoir un compte AGENT_EMISSION et un compte
    AGENT_CONTROLE — c'est la demande explicite ayant motivé cette évolution."""
    codes_iso = {c[0] for c in PAYS_CEMAC}
    emissions = {code for _, _, role, code in COMPTES_DEMO if role == Role.AGENT_EMISSION and code}
    controles = {code for _, _, role, code in COMPTES_DEMO if role == Role.AGENT_CONTROLE and code}

    assert emissions == codes_iso, f"Pays sans compte Émission : {codes_iso - emissions}"
    assert controles == codes_iso, f"Pays sans compte Contrôle : {codes_iso - controles}"


@pytest.mark.asyncio
async def test_seed_reel_est_idempotent(db, monkeypatch):
    """Exécute la vraie fonction seed() deux fois de suite contre la même
    session de test — la seconde exécution ne doit rien dupliquer ni lever
    d'erreur de contrainte d'unicité."""
    import app.db.seed as module_seed

    class FausseSessionCM:
        async def __aenter__(self):
            return db

        async def __aexit__(self, *a):
            return False

    monkeypatch.setattr(module_seed, "AsyncSessionLocal", lambda: FausseSessionCM())

    await module_seed.seed()
    nb_utilisateurs_1 = len((await db.execute(select(Utilisateur))).scalars().all())
    nb_pays_1 = len((await db.execute(select(Pays))).scalars().all())
    nb_postes_1 = len((await db.execute(select(Poste))).scalars().all())

    await module_seed.seed()  # rejoué — ne doit pas planter
    nb_utilisateurs_2 = len((await db.execute(select(Utilisateur))).scalars().all())
    nb_pays_2 = len((await db.execute(select(Pays))).scalars().all())
    nb_postes_2 = len((await db.execute(select(Poste))).scalars().all())

    assert nb_utilisateurs_1 == len(COMPTES_DEMO)
    assert nb_pays_1 == len(PAYS_CEMAC)
    assert nb_postes_1 == len(POSTES)
    assert nb_utilisateurs_2 == nb_utilisateurs_1
    assert nb_pays_2 == nb_pays_1
    assert nb_postes_2 == nb_postes_1
