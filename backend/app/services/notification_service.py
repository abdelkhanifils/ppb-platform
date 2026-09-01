"""Notifie les Super Administrateurs — les seuls habilités à valider les
paiements et à créer des autorisations d'impression décentralisée (voir
app/api/v1/endpoints/paiements.py et passeports.py). Utilisé quand un
évènement nécessite leur action (ex. nouvelle commande en attente de
paiement).

Écrit toujours la notification cloche (jamais silencieuse), et tente en
plus l'email — l'échec de l'email n'empêche jamais la notification cloche
d'exister (voir email_service.envoyer_email, qui ne lève jamais).
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rbac import Role
from app.models.notification import Notification
from app.models.utilisateur import Utilisateur
from app.services.email_service import envoyer_email


async def notifier_super_admins(
    db: AsyncSession,
    *,
    titre: str,
    message: str,
    lien: str | None = None,
    corps_email_html: str | None = None,
) -> None:
    """Crée une Notification par Super Admin actif et tente l'envoi email à
    chacun. N'effectue PAS le commit — à la charge de l'appelant, dans la
    même transaction que l'action qui déclenche la notification (cohérent
    avec journaliser(), voir app/services/audit.py)."""
    result = await db.execute(
        select(Utilisateur).where(Utilisateur.role == Role.SUPER_ADMIN, Utilisateur.actif.is_(True))
    )
    super_admins = result.scalars().all()

    for admin in super_admins:
        db.add(Notification(utilisateur_id=admin.id, titre=titre, message=message, lien=lien))

    # Emails envoyés après avoir programmé les écritures cloche, mais avant
    # le commit de l'appelant : un échec d'envoi (réseau, identifiants SMTP
    # absents) ne doit jamais faire échouer la transaction ni empêcher la
    # notification cloche d'être committée — envoyer_email ne lève jamais
    # (voir sa docstring), donc rien à intercepter ici.
    if corps_email_html:
        for admin in super_admins:
            await envoyer_email(admin.email, titre, corps_email_html)
