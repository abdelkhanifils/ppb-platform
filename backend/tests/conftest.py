"""
Fixtures partagées pour les tests du backend PPB.

Base de données : SQLite en mémoire (aiosqlite), recréée à chaque test pour
l'isolation. `get_db` est substitué pour pointer vers cette base de test au
lieu de PostgreSQL — le reste de l'application (routeurs, RBAC, JWT) tourne
sans modification, exactement comme en production.

Authentification : les jetons d'accès sont générés directement via
`create_access_token` (contournement volontaire de /auth/login) pour garder
les tests du Module Commande concentrés sur le Module Commande.
"""
import tempfile
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core.config import settings
from app.core.rbac import Role
from app.core.security import create_access_token, hash_password
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models.autorisation_impression import AutorisationImpression
from app.models.pays import Pays
from app.models.utilisateur import Utilisateur

# ENVIRONMENT="test" désactive la génération automatique de clé de signature
# hors d'un répertoire temporaire isolé (voir la fixture _cle_signature_isolee
# plus bas) et le garde-fou de secrets par défaut (app/core/startup_checks.py).
settings.ENVIRONMENT = "test"

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

# StaticPool : une connexion unique partagée par tout le test, indispensable
# pour que le SQLite en mémoire soit visible à la fois par le fixture qui
# amorce les données et par les requêtes émises via le client HTTP.
_engine_test = create_async_engine(TEST_DATABASE_URL, connect_args={"check_same_thread": False}, poolclass=StaticPool)
_SessionLocalTest = async_sessionmaker(bind=_engine_test, expire_on_commit=False)


@pytest.fixture(autouse=True)
def _cle_signature_isolee():
    """Chaque test obtient sa propre clé de signature éphémère (ECDSA P-256),
    générée dans un répertoire temporaire — jamais la clé réelle de la
    CEBEVIRHA, jamais partagée entre tests, jamais écrite au dépôt. Voir
    app/core/signing.py : la génération automatique reste interdite en
    environnement "production"."""
    with tempfile.TemporaryDirectory() as tmp:
        ancien_chemin = settings.QR_SIGNING_KEY_PATH
        settings.QR_SIGNING_KEY_PATH = str(Path(tmp) / "cle_test.pem")
        yield
        settings.QR_SIGNING_KEY_PATH = ancien_chemin



async def _override_get_db():
    async with _SessionLocalTest() as session:
        yield session


app.dependency_overrides[get_db] = _override_get_db


@pytest_asyncio.fixture(autouse=True)
async def _preparer_base():
    """Table fraîche à chaque test — garantit l'indépendance des cas de test."""
    async with _engine_test.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with _engine_test.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture
async def db(): # noqa: A002 - nom court volontaire, usage massif dans les tests
    async with _SessionLocalTest() as session:
        yield session


@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# --- Référentiel pays ---------------------------------------------------------------------

@pytest_asyncio.fixture
async def pays_cameroun(db) -> Pays:
    pays = Pays(code_iso="CMR", code_numerique="01", nom="Cameroun", ordre_alpha=1, version_linguistique_defaut="FR/EN")
    db.add(pays)
    await db.commit()
    await db.refresh(pays)
    return pays


@pytest_asyncio.fixture
async def pays_tchad(db) -> Pays:
    pays = Pays(code_iso="TCD", code_numerique="06", nom="Tchad", ordre_alpha=6, version_linguistique_defaut="FR/AR")
    db.add(pays)
    await db.commit()
    await db.refresh(pays)
    return pays


# --- Comptes utilisateurs par rôle --------------------------------------------------------

async def _creer_utilisateur(db, email: str, role: Role, pays_id: int | None) -> Utilisateur:
    user = Utilisateur(
        email=email,
        hash_mdp=hash_password("Test!2026"),
        nom_complet=email,
        role=role,
        pays_id=pays_id,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


def _entete_auth(user: Utilisateur) -> dict[str, str]:
    jeton = create_access_token(user.id, user.role.value, user.pays_id)
    return {"Authorization": f"Bearer {jeton}"}


@pytest_asyncio.fixture
async def admin_national_cmr(db, pays_cameroun):
    user = await _creer_utilisateur(db, "ministere.cmr@test.org", Role.ADMIN_NATIONAL, pays_cameroun.id)
    return user, _entete_auth(user)


@pytest_asyncio.fixture
async def admin_national_tcd(db, pays_tchad):
    user = await _creer_utilisateur(db, "ministere.tcd@test.org", Role.ADMIN_NATIONAL, pays_tchad.id)
    return user, _entete_auth(user)


@pytest_asyncio.fixture
async def super_admin(db):
    user = await _creer_utilisateur(db, "superadmin@test.org", Role.SUPER_ADMIN, None)
    return user, _entete_auth(user)


@pytest_asyncio.fixture
async def consultation(db):
    user = await _creer_utilisateur(db, "consultation@test.org", Role.CONSULTATION, None)
    return user, _entete_auth(user)


@pytest_asyncio.fixture
async def agent_emission_cmr(db, pays_cameroun):
    user = await _creer_utilisateur(db, "emission.cmr@test.org", Role.AGENT_EMISSION, pays_cameroun.id)
    return user, _entete_auth(user)


@pytest_asyncio.fixture
async def agent_controle_cmr(db, pays_cameroun):
    user = await _creer_utilisateur(db, "controle.cmr@test.org", Role.AGENT_CONTROLE, pays_cameroun.id)
    return user, _entete_auth(user)


@pytest_asyncio.fixture
async def agent_controle_tcd(db, pays_tchad):
    user = await _creer_utilisateur(db, "controle.tcd@test.org", Role.AGENT_CONTROLE, pays_tchad.id)
    return user, _entete_auth(user)


@pytest_asyncio.fixture
async def autorisation_impression_cameroun(db, pays_cameroun) -> AutorisationImpression:
    autorisation = AutorisationImpression(
        pays_id=pays_cameroun.id, plage_debut=1, plage_fin=1000, gabarit_version=1, active=True
    )
    db.add(autorisation)
    await db.commit()
    await db.refresh(autorisation)
    return autorisation


@pytest_asyncio.fixture
async def poste_kousseri(db, pays_cameroun):
    from app.models.poste import Poste

    poste = Poste(code="poste-kousseri", nom="Kousséri", pays_id=pays_cameroun.id, latitude=12.0785, longitude=15.0303)
    db.add(poste)
    await db.commit()
    await db.refresh(poste)
    return poste
