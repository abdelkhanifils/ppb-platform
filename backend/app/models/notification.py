from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, new_uuid


class Notification(Base, TimestampMixin):
    """Notification interne (cloche) — une ligne par destinataire, pas par
    évènement : une nouvelle commande notifiée à 3 Super Admins crée 3 lignes,
    chacune marquable comme lue indépendamment. Volontairement simple (pas de
    table d'évènements séparée) : le volume attendu (quelques évènements par
    jour, un petit nombre de Super Admins) ne justifie pas la complexité
    d'un modèle plus normalisé.
    """

    __tablename__ = "notifications"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    utilisateur_id: Mapped[str] = mapped_column(ForeignKey("utilisateurs.id"), nullable=False, index=True)
    titre: Mapped[str] = mapped_column(String(255), nullable=False)
    message: Mapped[str] = mapped_column(String(1000), nullable=False)
    # Chemin relatif côté frontend vers lequel naviguer au clic (ex.
    # "/commandes" ou "/administration/paiements") — jamais une URL absolue,
    # pour rester indépendant du domaine (web vs éventuel futur sous-domaine).
    lien: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Entité concrète à l'origine de la notification (ex. "Commande",
    # commande.id) — permet de la marquer automatiquement lue dès que
    # l'action qu'elle annonçait est effectivement traitée (ex. le paiement
    # de cette commande validé), sans attendre que le destinataire clique
    # dessus manuellement. Voir app.services.notification_service::
    # resoudre_notifications. `None` pour une notification qui ne se
    # rattache à aucune action résolvable automatiquement.
    entite: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    entite_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    lu: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
