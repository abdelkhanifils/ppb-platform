from sqlalchemy import Boolean, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, new_uuid


class AutorisationImpression(TimestampMixin, Base):
    """Droits d'impression décentralisée accordés à un pays (Module 3).

    Garde-fous : plage de numéros fermée (rejet HTTP 422 hors plage),
    gabarit_version certifié, suspension possible par la CEBEVIRHA.
    """

    __tablename__ = "autorisations_impression"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    pays_id: Mapped[int] = mapped_column(ForeignKey("pays.id"), nullable=False)
    plage_debut: Mapped[int] = mapped_column(Integer, nullable=False)
    plage_fin: Mapped[int] = mapped_column(Integer, nullable=False)
    gabarit_version: Mapped[int] = mapped_column(Integer, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    suspendue_par_id: Mapped[str | None] = mapped_column(ForeignKey("utilisateurs.id"), nullable=True)
