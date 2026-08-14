from sqlalchemy import Date, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, new_uuid


class Vaccination(TimestampMixin, Base):
    """Une vaccination réalisée, par maladie contrôlée (PPR, péripneumonie, charbon, trypanosomiase)."""

    __tablename__ = "vaccinations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    troupeau_id: Mapped[str] = mapped_column(ForeignKey("troupeaux.id"), nullable=False)
    maladie: Mapped[str] = mapped_column(String(100), nullable=False)
    date_vaccination: Mapped[str] = mapped_column(Date, nullable=True)
    lieu: Mapped[str | None] = mapped_column(String(255), nullable=True)
    valide_par_veterinaire_id: Mapped[str | None] = mapped_column(ForeignKey("utilisateurs.id"), nullable=True)
