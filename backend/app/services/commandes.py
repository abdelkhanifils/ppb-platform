"""Règles du cycle de vie de la Commande non couvertes par un endpoint direct
(Document technique, Module 1, règles métier) : « Une commande non payée sous
30 jours passe automatiquement au statut « expirée ». » Le délai est lu depuis
Parametre('commande_expiration_jours') — paramétrable sans redéploiement.

Destiné à être appelé par une tâche planifiée (APScheduler, déjà en dépendance
du projet — voir requirements.txt) ; exposé aussi tel quel pour les tests
unitaires, qui l'invoquent directement sans passer par le scheduler.
"""
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.commande import Commande, StatutCommande
from app.services.parametres import obtenir_parametre_int


async def expirer_commandes_echues(db: AsyncSession, delai_jours_defaut: int = 30) -> int:
    """Fait passer au statut EXPIREE toute commande EN_ATTENTE_PAIEMENT créée il y a
    plus de `commande_expiration_jours`. Retourne le nombre de commandes expirées."""
    delai_jours = await obtenir_parametre_int(db, "commande_expiration_jours", delai_jours_defaut)
    seuil = datetime.now(timezone.utc) - timedelta(days=delai_jours)

    result = await db.execute(
        select(Commande).where(Commande.statut == StatutCommande.EN_ATTENTE_PAIEMENT, Commande.cree_le < seuil)
    )
    commandes_echues = result.scalars().all()
    for commande in commandes_echues:
        commande.statut = StatutCommande.EXPIREE

    await db.commit()
    return len(commandes_echues)
