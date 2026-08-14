"""
Garde-fou de démarrage — Revue de sécurité RBAC/signature (voir SECURITY_REVIEW.md).

Refuse de démarrer en production si un secret critique a encore sa valeur
par défaut du dépôt (`.env.example`) — un JWT_SECRET laissé par inadvertance
permettrait de forger des jetons d'accès pour n'importe quel rôle.
Volontairement bruyant (RuntimeError, pas un simple log) : une erreur de
configuration de ce type ne doit jamais passer inaperçue.
"""
from app.core.config import settings

_JWT_SECRET_PAR_DEFAUT = "change-me-in-production"


def verifier_secrets_production() -> None:
    if settings.ENVIRONMENT != "production":
        return

    erreurs = []
    if settings.JWT_SECRET == _JWT_SECRET_PAR_DEFAUT:
        erreurs.append("JWT_SECRET a encore sa valeur par défaut du dépôt.")
    if len(settings.JWT_SECRET) < 32:
        erreurs.append("JWT_SECRET est trop court (32 caractères aléatoires minimum recommandés).")

    if erreurs:
        raise RuntimeError(
            "Démarrage refusé en production — secrets non configurés :\n- " + "\n- ".join(erreurs)
        )
