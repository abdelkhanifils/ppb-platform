"""
Configuration centrale — lue depuis les variables d'environnement (.env).
Cf. Document technique, section 7 « Environnements et déploiement ».
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # --- Application ---
    PROJECT_NAME: str = "Plateforme PPB — CEBEVIRHA"
    API_V1_PREFIX: str = "/api/v1"
    ENVIRONMENT: str = "development"

    # --- Base de données ---
    DATABASE_URL: str = "postgresql+asyncpg://ppb_user:ppb_pass@localhost:5432/ppb"
    DATABASE_URL_SYNC: str = "postgresql://ppb_user:ppb_pass@localhost:5432/ppb"

    # --- JWT (Sécurité transversale, §6 du document technique) ---
    JWT_SECRET: str = "change-me-in-production"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # --- Bcrypt ---
    BCRYPT_ROUNDS: int = 12

    # --- Signature numérique des PPB (Module 3) ---
    QR_SIGNING_KEY_PATH: str = "./secrets/ppb_signing_key.pem"
    QR_SIGNING_ALGORITHM: str = "ECDSA-P256"
    # Base de l'URL encodée dans le QR Code (Module 3) — l'app de contrôle
    # (Module 5) n'a besoin que de l'UUID final, mais un QR generique (scanné
    # par un appareil photo classique) doit rester interprétable.
    QR_VERIFICATION_BASE_URL: str = "https://verify.ppb-cemac.org"

    # --- Paiement en ligne (Module 2) — RETIRÉ pour l'instant ---
    # Les identifiants CinetPay n'étaient pas disponibles au moment de ce
    # déploiement. Seul le paiement présentiel/virement est actif (voir
    # app/api/v1/endpoints/paiements.py). Pour réintégrer : voir le README,
    # section « Réactiver CinetPay ».

    # --- Stockage objet (S3-compatible) ---
    STORAGE_BUCKET: str = "ppb-documents-dev"
    STORAGE_ENDPOINT: str = ""

    # --- CORS ---
    CORS_ORIGINS: list[str] = ["http://localhost:5173"]

    # --- Règles métier paramétrables (valeurs de repli ; source de vérité = table Parametre) ---
    OFFLINE_CACHE_TTL_DAYS: int = 60
    COMMANDE_QUANTITE_MIN: int = 50
    COMMANDE_QUANTITE_MAX: int = 10_000
    COMMANDE_EXPIRATION_JOURS: int = 30


settings = Settings()
