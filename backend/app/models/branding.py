from sqlalchemy import Integer, LargeBinary, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin

# Trois zones de personnalisation indépendantes (logo, icône, cachet,
# couleurs, nom — chacune ses propres valeurs) — demande explicite :
# - "global" : reste du tableau de bord web (Commandes, Paiements,
#   Administration, Statistiques...) — c'était l'unique zone avant cette
#   évolution, son identifiant reste donc inchangé pour ne rien casser sur
#   les lignes déjà en base.
# - "emission" : écrans d'émission de l'application mobile terrain.
# - "controle" : écran de contrôle frontière, PARTAGÉ entre le web
#   (ppb.cebevirha.org) et l'application mobile (les deux affichent la même
#   personnalisation "controle", puisque c'est fonctionnellement le même
#   module des deux côtés).
ID_BRANDING_GLOBAL = "global"
ID_BRANDING_EMISSION = "emission"
ID_BRANDING_CONTROLE = "controle"
ZONES_VALIDES = frozenset({ID_BRANDING_GLOBAL, ID_BRANDING_EMISSION, ID_BRANDING_CONTROLE})


class Branding(TimestampMixin, Base):
    """Identité visuelle de la plateforme (module Personnalisation) — nom
    d'application, couleurs, logo, icône (PWA/favicon), cachet.

    Jusqu'à 3 lignes, une par zone (`id` ∈ ZONES_VALIDES ci-dessus) — jamais
    par pays (décision produit toujours valable : pas de marque blanche par
    pays). Modifiable par Super Admin uniquement (app.api.v1.endpoints.branding),
    mais LUE sans authentification (page de connexion, manifest PWA, favicon) :
    aucune donnée sensible ici, seulement de l'apparence.

    Une zone "emission" ou "controle" qui n'a jamais été personnalisée (ligne
    absente) retombe sur la zone "global" à la lecture (voir
    app.api.v1.endpoints.branding::_get_avec_repli) — tant que personne n'a
    rien personnalisé pour elle, son apparence reste identique au reste de
    la plateforme, jamais une apparence "vide" par défaut.

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
    # Cachet + signature scannés (une seule image) — apposés automatiquement
    # en bas de la première page de chaque PPB généré et en bas de chaque
    # facture (voir app.services.pdf_passeport et app.services.pdf_facture).
    # Même choix de stockage que logo/icône ci-dessus (bytes en base, jamais
    # sur disque) pour la même raison (système de fichiers éphémère sur
    # Railway).
    cachet_bytes: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    cachet_content_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
