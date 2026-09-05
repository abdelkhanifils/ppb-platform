from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, new_uuid


class Itineraire(TimestampMixin, Base):
    """Trajet déclaré oralement à l'agent d'émission — détermine à lui seul la validité du passeport.

    Non prédéfini à la commande, non connu à l'attribution du QR Code :
    créé uniquement lors du Module 4 (page 3), à partir des données validées.
    """

    __tablename__ = "itineraires"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    passeport_id: Mapped[str] = mapped_column(ForeignKey("passeports.id"), unique=True, nullable=False)
    # Nullable : un trajet impliquant un pays hors CEMAC (ex. Nigeria, Soudan —
    # non membres, jamais ajoutés à la table Pays pour ne pas fausser sa
    # sémantique administrative ailleurs dans la plateforme — commandes,
    # rattachement des utilisateurs, etc.) n'a pas de pays_origine_id/
    # pays_destination_id valide : *_autre porte alors le nom saisi
    # librement par l'agent. Les deux champs (id et *_autre) ne sont jamais
    # renseignés simultanément pour un même sens (origine ou destination) —
    # voir la validation dans app/services/emission.py.
    pays_origine_id: Mapped[int | None] = mapped_column(ForeignKey("pays.id"), nullable=True)
    pays_origine_autre: Mapped[str | None] = mapped_column(String(255), nullable=True)
    province_origine: Mapped[str] = mapped_column(String(255), nullable=False)
    localite_origine: Mapped[str | None] = mapped_column(String(255), nullable=True)
    pays_destination_id: Mapped[int | None] = mapped_column(ForeignKey("pays.id"), nullable=True)
    pays_destination_autre: Mapped[str | None] = mapped_column(String(255), nullable=True)
    province_destination: Mapped[str] = mapped_column(String(255), nullable=False)
    localite_destination: Mapped[str | None] = mapped_column(String(255), nullable=True)
    date_enregistrement: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Propagation vers les postes de contrôle — cf. app.models.controle.itineraire_disponible_localement
    synchronise_vers_controle: Mapped[bool] = mapped_column(Boolean, default=False)
    # Horodatage de publication vers l'index de vérification (Module 5) — pendant
    # de Passeport.publie_le (Module 3). Alimente la synchronisation différentielle
    # (GET /controles/cache-verification/delta). None tant que non publié.
    publie_le: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
