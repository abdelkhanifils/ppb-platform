from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, new_uuid


class Troupeau(TimestampMixin, Base):
    """Conteneur de la composition du troupeau — créé depuis la Numerisation page 4 (Module 4)."""

    __tablename__ = "troupeaux"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    passeport_id: Mapped[str] = mapped_column(ForeignKey("passeports.id"), unique=True, nullable=False)
    date_enregistrement: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now())

    especes: Mapped[list["TroupeauEspece"]] = relationship(back_populates="troupeau", cascade="all, delete-orphan")


class TroupeauEspece(Base):
    """Une espèce du troupeau (bovin, ovin, caprin, camelin...) et ses effectifs."""

    __tablename__ = "troupeau_especes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    troupeau_id: Mapped[str] = mapped_column(ForeignKey("troupeaux.id"), nullable=False)
    espece: Mapped[str] = mapped_column(String(50), nullable=False)  # bovin, ovin, caprin, camelin, autre
    nombre_males: Mapped[int] = mapped_column(Integer, default=0)
    nombre_femelles_jeunes: Mapped[int] = mapped_column(Integer, default=0)
    nombre_femelles_adultes: Mapped[int] = mapped_column(Integer, default=0)
    nombre_total: Mapped[int] = mapped_column(Integer, default=0)

    troupeau: Mapped["Troupeau"] = relationship(back_populates="especes")
