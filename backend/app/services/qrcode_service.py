"""
Génération de l'image du QR Code de validation (Module 3 — Document
technique, « Numérotation... QR Code et signature »).

Contenu volontairement l'UUID BRUT du passeport (pas une URL) : la
vérification n'est jamais destinée à un scan grand public depuis un
téléphone quelconque — seule l'application de Contrôle frontière (Module 5),
utilisée par un agent authentifié, sait quoi faire de cet UUID (vérification
de signature hors-ligne + appel API authentifié). Un QR contenant une URL
publique inviterait n'importe quel scanner de caméra générique à tenter
d'ouvrir un lien — ici, il n'affiche qu'un texte neutre, sans rien à
cliquer ni de service public à interroger.

L'application de Contrôle (voir
frontend/src/components/controle/ScannerControle.tsx::extraireQrUuid)
accepte cet UUID brut aussi bien qu'une éventuelle URL historique — aucune
migration nécessaire côté application pour ce changement de format.
"""
import base64
from io import BytesIO

import qrcode


def construire_payload_qr(qr_uuid: str) -> str:
    return qr_uuid


def generer_qrcode_png_base64(qr_uuid: str) -> str:
    """Retourne un PNG encodé en base64 (sans préfixe data URI), prêt à être
    intégré dans un document imprimé (Module 3) ou affiché côté Web Admin."""
    image = qrcode.make(construire_payload_qr(qr_uuid))
    tampon = BytesIO()
    image.save(tampon, format="PNG")
    return base64.b64encode(tampon.getvalue()).decode("ascii")
