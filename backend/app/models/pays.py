from sqlalchemy import Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Pays(Base):
    """Les 6 États membres CEMAC — code numérique 01-06 par ordre alphabétique."""

    __tablename__ = "pays"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code_iso: Mapped[str] = mapped_column(String(3), unique=True, nullable=False)  # CMR, CAF, COG, GAB, GNQ, TCD
    code_numerique: Mapped[str] = mapped_column(String(2), unique=True, nullable=False)  # 01..06
    nom: Mapped[str] = mapped_column(String(100), nullable=False)
    ordre_alpha: Mapped[int] = mapped_column(Integer, nullable=False)
    version_linguistique_defaut: Mapped[str] = mapped_column(String(5), default="FR/EN")  # FR/EN ou FR/AR
