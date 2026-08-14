from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.rbac import Role
from app.db.base import Base, TimestampMixin, new_uuid, str_enum


class Utilisateur(TimestampMixin, Base):
    """Compte applicatif — 6 rôles RBAC (Document technique §6)."""

    __tablename__ = "utilisateurs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    hash_mdp: Mapped[str] = mapped_column(String(255), nullable=False)
    nom_complet: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[Role] = mapped_column(str_enum(Role, "role_enum"), nullable=False)
    pays_id: Mapped[int | None] = mapped_column(ForeignKey("pays.id"), nullable=True)
    poste_id: Mapped[str | None] = mapped_column(String(36), nullable=True)  # rattachement pour agent_controle
    actif: Mapped[bool] = mapped_column(Boolean, default=True)
