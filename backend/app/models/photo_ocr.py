from datetime import datetime, timedelta, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, LargeBinary, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.config import settings
from app.db.base import Base, TimestampMixin, new_uuid
from app.models.numerisation import JSON_TYPE


def _calculer_expiration() -> datetime:
    return datetime.now(timezone.utc) + timedelta(days=settings.OCR_PHOTO_RETENTION_JOURS)


class PhotoOcr(TimestampMixin, Base):
    """Photo d'une page 3 ou 4 remplie à la main, envoyée pour reconnaissance
    automatique (OCR) — Module 4, écran de saisie assistée.

    SEULE exception délibérée au principe « aucune image conservée » qui
    régit le reste du Module 4 (voir Numerisation, dans numerisation.py) —
    décidée explicitement avec la CEBEVIRHA : la photo est gardée un temps
    limité (voir `expire_le`, `settings.OCR_PHOTO_RETENTION_JOURS`) pour
    permettre à l'agent de rouvrir l'image en cas de doute sur un champ mal
    reconnu, jamais indéfiniment. Sa purge n'est PAS automatique par la
    seule présence de `expire_le` en base — voir
    app.services.ocr_service.purger_photos_expirees, à appeler
    périodiquement (tâche planifiée, ex. Railway Cron — voir
    RAILWAY_DEPLOY.md)."""

    __tablename__ = "photos_ocr"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    passeport_id: Mapped[str] = mapped_column(ForeignKey("passeports.id"), nullable=False)
    page_num: Mapped[int] = mapped_column(Integer, nullable=False)  # 3 ou 4 uniquement
    image_bytes: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    image_content_type: Mapped[str] = mapped_column(String(50), default="image/jpeg")
    # Résultat brut renvoyé par le service OCR (texte + zones) — conservé
    # pour audit/débogage de l'algorithme d'extraction, jamais affiché tel
    # quel à l'agent (voir app.services.ocr_service.extraire_champs_page3/4).
    resultat_ocr_brut: Mapped[dict] = mapped_column(JSON_TYPE, nullable=True)
    agent_id: Mapped[str] = mapped_column(ForeignKey("utilisateurs.id"), nullable=False)
    expire_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_calculer_expiration)
