"""Test de app.services.qrcode_service — le contenu encodé dans le QR doit
rester l'UUID brut du passeport, jamais une URL : la vérification est
réservée à l'application de Contrôle (agent authentifié), pas à un scan
grand public depuis un téléphone quelconque (voir la docstring du module)."""
from app.services.qrcode_service import construire_payload_qr


def test_payload_qr_est_luuid_brut_sans_url():
    uuid_test = "550e8400-e29b-41d4-a716-446655440000"

    payload = construire_payload_qr(uuid_test)

    assert payload == uuid_test
    assert "http" not in payload
    assert "/" not in payload
