"""
Génération de l'image du QR Code de validation (Module 3 — Document
technique, « Numérotation... QR Code et signature »). Le contenu encodé est
une URL de vérification se terminant par le qr_uuid du passeport : lisible
par n'importe quel lecteur QR grand public (pas seulement l'application
métier html5-qrcode du Module 4/5), conformément à l'esprit d'un document
« officiel — voir volet d'identification » destiné à être vérifiable par
un tiers.

Ce module ne fait QUE générer l'image ; le contenu (URL + qr_uuid) est le
même que celui utilisé pour la vérification côté Module 5 — toute
modification de son format doit rester compatible avec le code qui
l'interprète là-bas.
"""
import base64
from io import BytesIO

import qrcode

from app.core.config import settings


def construire_payload_qr(qr_uuid: str) -> str:
    return f"{settings.QR_VERIFICATION_BASE_URL.rstrip('/')}/{qr_uuid}"


def generer_qrcode_png_base64(qr_uuid: str) -> str:
    """Retourne un PNG encodé en base64 (sans préfixe data URI), prêt à être
    intégré dans un document imprimé (Module 3) ou affiché côté Web Admin."""
    image = qrcode.make(construire_payload_qr(qr_uuid))
    tampon = BytesIO()
    image.save(tampon, format="PNG")
    return base64.b64encode(tampon.getvalue()).decode("ascii")
