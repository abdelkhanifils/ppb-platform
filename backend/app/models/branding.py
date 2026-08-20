from sqlalchemy import Integer, LargeBinary, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin

ID_BRANDING_GLOBAL = "global"


class Branding(TimestampMixin, Base):
    """Identité visuelle de la plateforme (module Personnalisation) — nom
    d'application, couleurs, logo, icône (PWA/favicon).

    Une SEULE ligne, `id` fixe (`ID_BRANDING_GLOBAL`) : identité unique pour
    toute la plateforme, jamais par pays (décision produit — pas de
    marque blanche par pays pour l'instant). Modifiable par Super Admin
    uniquement (app.api.v1.endpoints.branding), mais LUE sans authentification
    (page de connexion, manifest PWA, favicon) : aucune donnée sensible ici,
    seulement de l'apparence.

    Logo et icône stockés en base (colonnes bytes), jamais sur disque — même
    choix que PhotoOcr (app.models.numerisation) : l'hébergement cible
    (Railway) a un système de fichiers éphémère à chaque redéploiement, seule
    la base de données persiste de façon fiable.

    `version` est incrémentée à chaque modification (couleurs, nom, logo OU
    icône) et utilisée comme paramètre `?v=` dans les URLs d'image servies
    par ce module : sans cela, les navigateurs garderaient en cache l'ancien
    logo/icône indéfiniment après un changement, l'URL ne changeant jamais
    autrement (même mécanisme que DefinitionFormulaire.schema_version pour
    la même raison de cache client)."""

    __tablename__ = "branding"

    id: Mapped[str] = mapped_column(String(20), primary_key=True, default=lambda: ID_BRANDING_GLOBAL)
    nom_application: Mapped[str] = mapped_column(String(100), default="Passeport Pour Bétail")
    couleur_primaire: Mapped[str] = mapped_column(String(7), default="#0f5132")  # format #RRGGBB
    couleur_primaire_claire: Mapped[str] = mapped_column(String(7), default="#146c43")
    logo_bytes: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    logo_content_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    icone_bytes: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    icone_content_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
