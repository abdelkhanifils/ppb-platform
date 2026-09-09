from sqlalchemy import Boolean, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, new_uuid


class Poste(TimestampMixin, Base):
    """Référentiel des postes de contrôle frontaliers.

    `code` est la valeur utilisée telle quelle dans `Controle.poste_id`
    (chaîne libre, saisie par l'agent — voir app/models/controle.py) : ce
    référentiel enrichit ces codes a posteriori (nom, pays, coordonnées) pour
    l'agrégation du tableau de bord régional, sans imposer de contrainte de
    clé étrangère stricte sur `Controle` (un contrôle reste enregistrable
    même si son poste n'a pas encore été référencé ici).

    Coordonnées stockées en colonnes simples (latitude/longitude, portables
    sur tout moteur SQL) plutôt qu'en colonne géométrique PostGIS dédiée : les
    agrégations spatiales elles-mêmes (clustering, GeoJSON) sont exprimées en
    SQL PostGIS à la volée depuis ces colonnes — voir
    app/services/geospatial.py — ce qui évite de figer un type de colonne
    non portable (les tests tournent sur SQLite, sans extension PostGIS).
    """

    __tablename__ = "postes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    code: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    nom: Mapped[str] = mapped_column(String(255), nullable=False)
    pays_id: Mapped[int] = mapped_column(ForeignKey("pays.id"), nullable=False)
    # Renseignés à la création/modification du poste (Administration > Pays
    # & Frontières) — permettent de pré-remplir automatiquement l'origine du
    # troupeau à l'émission (province/localité), une fois le poste
    # d'émission choisi dans Réglages, exactement comme le lieu de
    # vaccination (voir mobile/src/pages/Emission.tsx). `None` tant qu'un
    # Super Admin ne les a pas renseignés — l'agent saisit alors ces deux
    # champs lui-même, comme avant.
    province: Mapped[str | None] = mapped_column(String(150), nullable=True)
    localite: Mapped[str | None] = mapped_column(String(150), nullable=True)
    latitude: Mapped[float] = mapped_column(Numeric(9, 6), nullable=False)
    longitude: Mapped[float] = mapped_column(Numeric(9, 6), nullable=False)
    actif: Mapped[bool] = mapped_column(Boolean, default=True)
