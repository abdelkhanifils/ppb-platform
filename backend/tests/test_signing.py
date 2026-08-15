"""Tests de app.core.signing — chargement de la clé de signature depuis les
trois sources possibles (voir docstring du module), en particulier la
variable d'environnement base64 (QR_SIGNING_KEY_PEM_B64), qui a corrigé un
échec réel en production Railway (conteneur sans disque persistant : une
clé écrite sur QR_SIGNING_KEY_PATH disparaît à chaque redéploiement)."""
import base64

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from app.core.config import settings
from app.core.signing import ErreurSignature, cle_publique_pem, signer, verifier


def _cle_pem_b64() -> str:
    cle = ec.generate_private_key(ec.SECP256R1())
    pem = cle.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return base64.b64encode(pem).decode("ascii")


def test_charge_la_cle_depuis_la_variable_environnement_base64():
    ancienne_valeur = settings.QR_SIGNING_KEY_PEM_B64
    try:
        settings.QR_SIGNING_KEY_PEM_B64 = _cle_pem_b64()

        empreinte = b"0" * 32
        signature = signer(empreinte)
        pem_publique = cle_publique_pem()

        assert verifier(empreinte, signature, pem_publique) is True
    finally:
        settings.QR_SIGNING_KEY_PEM_B64 = ancienne_valeur


def test_variable_environnement_prioritaire_sur_le_fichier(tmp_path):
    """Si les deux sont renseignées, la variable d'environnement doit gagner
    — c'est la source pensée pour la production (voir docstring du module)."""
    ancienne_valeur = settings.QR_SIGNING_KEY_PEM_B64
    ancien_chemin = settings.QR_SIGNING_KEY_PATH
    try:
        # Une clé différente sur le disque, jamais utilisée si la variable est présente.
        settings.QR_SIGNING_KEY_PATH = str(tmp_path / "autre_cle.pem")
        settings.QR_SIGNING_KEY_PEM_B64 = _cle_pem_b64()

        empreinte = b"1" * 32
        signature = signer(empreinte)
        pem_publique = cle_publique_pem()

        assert verifier(empreinte, signature, pem_publique) is True
    finally:
        settings.QR_SIGNING_KEY_PEM_B64 = ancienne_valeur
        settings.QR_SIGNING_KEY_PATH = ancien_chemin


def test_variable_environnement_malformee_leve_erreur_explicite():
    ancienne_valeur = settings.QR_SIGNING_KEY_PEM_B64
    try:
        settings.QR_SIGNING_KEY_PEM_B64 = "ceci-nest-pas-du-base64-pem-valide"
        with pytest.raises(ErreurSignature):
            signer(b"0" * 32)
    finally:
        settings.QR_SIGNING_KEY_PEM_B64 = ancienne_valeur


def test_production_sans_aucune_cle_refuse_de_signer(tmp_path):
    ancien_environnement = settings.ENVIRONMENT
    ancien_chemin = settings.QR_SIGNING_KEY_PATH
    ancienne_valeur = settings.QR_SIGNING_KEY_PEM_B64
    try:
        settings.ENVIRONMENT = "production"
        settings.QR_SIGNING_KEY_PATH = str(tmp_path / "inexistante.pem")
        settings.QR_SIGNING_KEY_PEM_B64 = ""
        with pytest.raises(ErreurSignature):
            signer(b"0" * 32)
    finally:
        settings.ENVIRONMENT = ancien_environnement
        settings.QR_SIGNING_KEY_PATH = ancien_chemin
        settings.QR_SIGNING_KEY_PEM_B64 = ancienne_valeur
