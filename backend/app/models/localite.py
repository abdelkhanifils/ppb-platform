from sqlalchemy import Boolean, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, new_uuid


class Localite(TimestampMixin, Base):
    """Référentiel des localités par pays, avec leur province de
    rattachement — jusqu'ici une liste figée dans le code du mobile
    (mobile/src/lib/paysLocalites.ts), sans aucun lien entre une localité et
    sa province, et sans aucun moyen de la modifier autrement qu'en
    republiant l'application. Devient ici modifiable depuis Administration >
    Pays & Frontières (voir app/api/v1/endpoints/localites.py), à l'image du
    référentiel des postes.

    `province` reste un champ texte libre (pas de référentiel séparé des
    provinces) : les 6 pays CEMAC ont un découpage provincial officiel
    stable, les pays voisins hors CEMAC n'en ont traditionnellement pas dans
    cette plateforme (voir provincesPourPays côté mobile, qui renvoie "Autres"
    pour eux) — imposer une table de provinces distincte pour les seuls pays
    CEMAC aurait ajouté une complexité que ce texte libre évite, au prix
    d'une cohérence orthographique à la seule discipline de saisie de
    l'administrateur.

    `nom` + `pays_id` unique ensemble : la même localité ne doit jamais être
    doublée pour un même pays, mais un même nom de ville peut légitimement
    exister dans deux pays différents (aucune contrainte d'unicité globale
    sur `nom` seul)."""

    __tablename__ = "localites"
    __table_args__ = (UniqueConstraint("pays_id", "nom", name="uq_localite_pays_nom"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    pays_id: Mapped[int] = mapped_column(ForeignKey("pays.id"), nullable=False)
    nom: Mapped[str] = mapped_column(String(150), nullable=False)
    # Vide tant qu'un Super Admin ne l'a pas renseignée — jamais une raison
    # de masquer la localité pour autant (voir lister_localites) : elle
    # reste utilisable comme lieu, simplement sans province associée en
    # attendant d'être complétée.
    province: Mapped[str | None] = mapped_column(String(150), nullable=True)
    actif: Mapped[bool] = mapped_column(Boolean, default=True)
