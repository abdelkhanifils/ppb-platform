"""
Signature numérique des PPB — Document technique §3 (Module 3) et §6
(Sécurité transversale) : « RSA-2048 ou ECDSA P-256, clé privée détenue
exclusivement par la CEBEVIRHA » ; « Seule la clé publique est présente
côté client — jamais la clé privée de signature. »

Ce module signe l'empreinte SHA-256 d'une chaîne canonique (jamais la donnée
brute) — pratique standard qui borne la taille de l'entrée signée quel que
soit l'algorithme, et découple le format du passeport de celui de la
signature.

Chargement de la clé — trois sources, dans cet ordre de priorité :
1. `QR_SIGNING_KEY_PEM_B64` (variable d'environnement, PEM encodé en base64
   sur une seule ligne) — pensé pour les hébergeurs sans disque persistant
   entre deux déploiements (ex. Railway sans Volume attaché à ce service) :
   sans cette option, une clé écrite sur `QR_SIGNING_KEY_PATH` disparaîtrait
   à chaque redéploiement, ce qui invaliderait tous les passeports déjà émis.
2. `QR_SIGNING_KEY_PATH` (fichier PEM sur disque) — pour un hébergement avec
   stockage persistant réel.
3. En développement/test SEULEMENT, si aucune des deux ci-dessus n'est
   fournie : une paire ECDSA P-256 est générée et persistée localement pour
   travailler sans provisionner de clé — CE COMPORTEMENT EST DÉSACTIVÉ dès
   que `ENVIRONMENT` vaut "production" ou "test" (la clé doit alors exister
   ou être fournie explicitement par le test — voir tests/conftest.py).
"""
import base64
from pathlib import Path

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa

from app.core.config import settings


class ErreurSignature(Exception):
    """Levée si la clé de signature est introuvable en dehors du développement,
    ou si le format de clé chargé n'est ni RSA ni EC."""


def _generer_cle_dev() -> ec.EllipticCurvePrivateKey:
    return ec.generate_private_key(ec.SECP256R1())


def _charger_ou_generer_cle_privee(chemin_str: str):
    # 1. Variable d'environnement (base64) — prioritaire, survit aux redéploiements
    # sur un hébergeur sans disque persistant.
    if settings.QR_SIGNING_KEY_PEM_B64:
        try:
            pem_bytes = base64.b64decode(settings.QR_SIGNING_KEY_PEM_B64)
            return serialization.load_pem_private_key(pem_bytes, password=None)
        except Exception as exc:
            raise ErreurSignature(f"QR_SIGNING_KEY_PEM_B64 est mal formée : {exc}") from exc

    # 2. Fichier sur disque.
    chemin = Path(chemin_str)
    if chemin.exists():
        return serialization.load_pem_private_key(chemin.read_bytes(), password=None)

    if settings.ENVIRONMENT == "production":
        raise ErreurSignature(
            f"Aucune clé de signature disponible (ni QR_SIGNING_KEY_PEM_B64, ni fichier "
            f"{chemin}) et génération automatique désactivée en production. "
            f"Provisionnez la clé de la CEBEVIRHA avant le déploiement."
        )

    # 3. Développement et tests uniquement : dépannage/isolation, jamais une clé réelle
    # de la CEBEVIRHA. En test, le chemin pointe vers un répertoire temporaire propre
    # à chaque test (voir tests/conftest.py) — aucune clé n'est jamais écrite au dépôt.
    cle = _generer_cle_dev()
    chemin.parent.mkdir(parents=True, exist_ok=True)
    chemin.write_bytes(
        cle.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )
    return cle


def cle_publique_pem(chemin_cle: str | None = None) -> bytes:
    """Clé publique au format PEM — seule donnée distribuée aux applications
    de contrôle (Module 5), jamais la clé privée."""
    cle_privee = _charger_ou_generer_cle_privee(chemin_cle or settings.QR_SIGNING_KEY_PATH)
    return cle_privee.public_key().public_bytes(
        encoding=serialization.Encoding.PEM, format=serialization.PublicFormat.SubjectPublicKeyInfo
    )


def signer(empreinte: bytes, chemin_cle: str | None = None) -> str:
    """Signe une empreinte SHA-256 (32 octets) — jamais la donnée brute. Retourne
    la signature encodée en base64, prête à être stockée dans Passeport.signature."""
    cle_privee = _charger_ou_generer_cle_privee(chemin_cle or settings.QR_SIGNING_KEY_PATH)

    if isinstance(cle_privee, ec.EllipticCurvePrivateKey):
        signature = cle_privee.sign(empreinte, ec.ECDSA(hashes.SHA256()))
    elif isinstance(cle_privee, rsa.RSAPrivateKey):
        signature = cle_privee.sign(empreinte, padding.PKCS1v15(), hashes.SHA256())
    else:
        raise ErreurSignature("La clé chargée n'est ni RSA ni EC (RSA-2048 / ECDSA P-256 attendus).")

    return base64.b64encode(signature).decode("ascii")


def verifier(empreinte: bytes, signature_b64: str, cle_publique_pem_bytes: bytes) -> bool:
    """Vérifie une signature à partir de la SEULE clé publique — c'est exactement
    ce que fait (ou devrait faire, côté client) l'application de contrôle en
    mode hors-ligne (Module 5) : aucun accès à la clé privée n'est nécessaire."""
    try:
        cle_publique = serialization.load_pem_public_key(cle_publique_pem_bytes)
        signature = base64.b64decode(signature_b64)
        if isinstance(cle_publique, ec.EllipticCurvePublicKey):
            cle_publique.verify(signature, empreinte, ec.ECDSA(hashes.SHA256()))
        elif isinstance(cle_publique, rsa.RSAPublicKey):
            cle_publique.verify(signature, empreinte, padding.PKCS1v15(), hashes.SHA256())
        else:
            return False
        return True
    except (InvalidSignature, ValueError):
        return False
