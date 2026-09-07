"""
Génération de l'image du QR Code de validation (Module 3 — Document
technique, « Numérotation... QR Code et signature »).

Contenu : `{numero_pays}-{numero_annee}-{numero_lot}-{qr_uuid}-{signature}` —
la MÊME chaîne canonique que celle signée à l'attribution (voir
app.services.attribution::construire_chaine_canonique), suivie de la
signature elle-même. Volontairement PAS l'UUID seul (ancien format) : ce
dernier oblige l'application de Contrôle à d'abord retrouver le passeport
dans sa base locale synchronisée avant de pouvoir vérifier quoi que ce
soit — un passeport émis après la dernière synchronisation de l'agent, ou
jamais synchronisé sur cet appareil, ne pouvait alors JAMAIS être vérifié,
même hors-ligne, même si le PPB était parfaitement authentique. En
embarquant la signature dans le QR lui-même, l'authenticité se vérifie
UNIQUEMENT à partir de ce qui est scanné + la clé publique déjà en cache
sur l'appareil (voir frontend/src/services/verificationSignature.ts) —
plus jamais besoin que ce passeport précis ait déjà été synchronisé pour
confirmer qu'il est authentique. Seules les vérifications complémentaires
(itinéraire déclaré, historique de contrôles) restent tributaires d'une
base locale à jour ou d'une connexion — la plateforme le signale alors
clairement, sans jamais confondre les deux dans un même message d'erreur.

Un QR contenant ces champs reste un texte neutre, pas une URL : aucun
scanner de caméra générique n'y verra de lien à ouvrir — seule
l'application de Contrôle (Module 5), utilisée par un agent authentifié,
sait quoi en faire.

Rétrocompatibilité : les passeports déjà imprimés avant ce changement
portent l'ancien format (UUID brut) — impossible à corriger après
impression physique. L'application de Contrôle (voir
frontend/src/components/controle/ScannerControle.tsx) reconnaît les deux
formats et retombe sur l'ancien comportement (recherche locale par UUID
préalable) pour ceux-ci.
"""
import base64
from io import BytesIO

import qrcode

from app.models.passeport import Passeport


def construire_payload_qr(passeport: Passeport) -> str:
    return (
        f"{passeport.numero_pays}-{passeport.numero_annee}-{passeport.numero_lot}-"
        f"{passeport.qr_uuid}-{passeport.signature}"
    )


def generer_qrcode_png_base64(passeport: Passeport) -> str:
    """Retourne un PNG encodé en base64 (sans préfixe data URI), prêt à être
    intégré dans un document imprimé (Module 3) ou affiché côté Web Admin."""
    image = qrcode.make(construire_payload_qr(passeport))
    tampon = BytesIO()
    image.save(tampon, format="PNG")
    return base64.b64encode(tampon.getvalue()).decode("ascii")

