"""Service d'écriture de la piste d'audit — utilisé par les routeurs sensibles
(Module Administration, Paiement, Impression, Contrôle). Insertion uniquement :
aucune méthode de modification ou de suppression n'est exposée, pour préserver
l'immuabilité exigée par le Document technique §6."""
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import PisteAudit


async def journaliser(
    db: AsyncSession,
    *,
    utilisateur_id: str,
    action: str,
    entite: str,
    entite_id: str,
    ancienne_valeur: dict | None = None,
    nouvelle_valeur: dict | None = None,
) -> None:
    db.add(
        PisteAudit(
            utilisateur_id=utilisateur_id,
            action=action,
            entite=entite,
            entite_id=entite_id,
            ancienne_valeur=ancienne_valeur,
            nouvelle_valeur=nouvelle_valeur,
        )
    )
    # Pas de commit ici : l'appelant commit dans la même transaction que
    # l'opération journalisée, pour garantir que l'un ne survit jamais sans l'autre.
