from sqlalchemy import Boolean, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.rbac import Role
from app.db.base import Base, TimestampMixin, new_uuid, str_enum


class PermissionRole(TimestampMixin, Base):
    """Écart à la matrice par défaut (app.core.permissions) : une ligne =
    la case est cochée (`autorise=True`) ou décochée (`False`) pour ce rôle,
    à l'inverse de son état par défaut. Aucune ligne = comportement par défaut."""

    __tablename__ = "permissions_roles"
    __table_args__ = (UniqueConstraint("role", "code", name="uq_permissions_roles_role_code"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    role: Mapped[Role] = mapped_column(str_enum(Role, "role_enum"), nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    autorise: Mapped[bool] = mapped_column(Boolean, nullable=False)
