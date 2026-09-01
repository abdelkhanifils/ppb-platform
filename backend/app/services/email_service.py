"""Envoi d'email via SMTP — fournisseur Hostinger (smtp.hostinger.com,
port 465, SSL implicite). Voir app.core.config pour les variables d'env
requises (SMTP_HOTE, SMTP_UTILISATEUR, SMTP_MOT_DE_PASSE).

Nécessite le forfait Railway Pro (ou supérieur) sur le service backend :
Railway bloque les connexions SMTP sortantes (ports 25/465/587) sur les
forfaits Free/Trial/Hobby, confirmé en test réel ("Network is unreachable")
avant la mise à niveau — voir station.railway.com pour la confirmation
officielle de ce comportement.

Tant que SMTP_MOT_DE_PASSE est vide, envoyer_email() journalise un
avertissement et renvoie False sans lever d'exception — même logique que
GOOGLE_VISION_SERVICE_ACCOUNT_JSON_B64 dans ocr_service.py : une
notification email qui échoue ne doit jamais bloquer l'action métier
(création de commande, validation de paiement) qui l'a déclenchée.
"""
import asyncio
import logging
import smtplib
from email.message import EmailMessage

from app.core.config import settings

logger = logging.getLogger(__name__)


def _envoyer_smtp_bloquant(destinataire: str, sujet: str, corps_html: str) -> None:
    message = EmailMessage()
    message["Subject"] = sujet
    message["From"] = settings.SMTP_UTILISATEUR
    message["To"] = destinataire
    message.set_content("Ce message nécessite un client email affichant le HTML.")
    message.add_alternative(corps_html, subtype="html")

    # Port 465 = SSL implicite dès la connexion (pas STARTTLS) — c'est le
    # réglage documenté par Hostinger, à ne pas changer sans revérifier
    # leurs paramètres actuels si le fournisseur change un jour.
    with smtplib.SMTP_SSL(settings.SMTP_HOTE, settings.SMTP_PORT, timeout=15) as serveur:
        serveur.login(settings.SMTP_UTILISATEUR, settings.SMTP_MOT_DE_PASSE)
        serveur.send_message(message)


async def envoyer_email(destinataire: str, sujet: str, corps_html: str) -> bool:
    """Renvoie True si l'envoi a réussi, False sinon — jamais d'exception
    propagée à l'appelant (voir docstring du module)."""
    if not settings.SMTP_MOT_DE_PASSE:
        logger.warning("SMTP_MOT_DE_PASSE non configuré — email à %s non envoyé (sujet : %s).", destinataire, sujet)
        return False
    try:
        # smtplib est synchrone/bloquant : déporté sur un thread pour ne pas
        # geler la boucle asyncio le temps de la connexion SMTP.
        await asyncio.to_thread(_envoyer_smtp_bloquant, destinataire, sujet, corps_html)
        return True
    except Exception:
        logger.exception("Échec de l'envoi d'email à %s (sujet : %s).", destinataire, sujet)
        return False
