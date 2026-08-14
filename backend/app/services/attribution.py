"""
Attribution automatique des passeports — Module 3 (Document technique §3, M3).

Regroupe :
- la numérotation séquentielle (code pays 2 chiffres, année 4 chiffres,
  n° de lot 7 chiffres), réservée de façon atomique par (pays, année) pour
  survivre à des attributions concurrentes (deux validations de paiement
  présentiel déclenchées au même instant, par exemple) ;
- la génération du QR Code (UUID) et de la signature numérique, calculée
  sur l'empreinte SHA-256 d'une chaîne canonique (jamais la donnée brute) ;
- la publication automatique vers l'index de vérification consommé par le
  Module 5 (Contrôle) — voir la note dans `publier_passeports`.

Ce module ne committe jamais lui-même : il flush pour obtenir les id/valeurs
générés côté base, et laisse l'appelant (webhook de paiement, validation
présentiel, réconciliation, ou l'endpoint interne /passeports/attribuer)
committer dans SA PROPRE transaction — l'attribution et la confirmation du
paiement qui la déclenche doivent réussir ou échouer ensemble.
"""
import hashlib
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.signing import signer
from app.models.commande import Commande
from app.models.passeport import CompteurNumerotation, Passeport, StatutPasseport
from app.models.pays import Pays


def construire_chaine_canonique(numero_pays: str, numero_annee: str, numero_lot: str, qr_uuid: str) -> str:
    """Chaîne signée — DOIT rester strictement identique entre la signature
    (ici, à l'attribution) et toute vérification ultérieure (Module 5, en
    ligne ou hors-ligne). Toute modification de ce format invalide la
    signature de tous les passeports déjà émis."""
    return f"{numero_pays}-{numero_annee}-{numero_lot}-{qr_uuid}"


async def _reserver_plage_numeros(db: AsyncSession, pays_id: int, annee: str, quantite: int) -> int:
    """Réserve `quantite` numéros de lot consécutifs pour (pays, année) et
    retourne le premier numéro de la plage. Le verrou de ligne
    (`SELECT ... FOR UPDATE`) n'est appliqué que sur les dialectes qui le
    supportent réellement (PostgreSQL en production) — SQLite (tests) ne le
    supporte pas et n'en a pas besoin, la connexion y étant de toute façon
    unique et sérialisée."""
    requete = select(CompteurNumerotation).where(
        CompteurNumerotation.pays_id == pays_id, CompteurNumerotation.annee == annee
    )
    if db.get_bind().dialect.name == "postgresql":
        requete = requete.with_for_update()

    result = await db.execute(requete)
    compteur = result.scalar_one_or_none()
    if compteur is None:
        compteur = CompteurNumerotation(pays_id=pays_id, annee=annee, dernier_numero=0)
        db.add(compteur)
        await db.flush()

    premier_numero = compteur.dernier_numero + 1
    compteur.dernier_numero += quantite
    return premier_numero


def publier_passeports(passeports: list[Passeport]) -> None:
    """« Publication » vers l'index de vérification consommé par le Module 5
    (endpoints /controles/cache-verification*).

    Dans cette implémentation, l'index EST la table Passeport elle-même :
    publier revient à horodater `publie_le`, ce qui rend immédiatement le
    passeport éligible à la synchronisation différentielle au prochain appel
    de contrôle — sans file d'attente ni service externe à opérer, et sans
    délai d'aucune sorte puisque l'écriture se fait dans la même transaction
    que l'attribution. Si un jour un index dédié est introduit (cache Redis,
    service de vérification séparément scalable), c'est ICI qu'il faudra
    ajouter l'appel sortant correspondant, en conservant ce même point
    d'entrée pour ne pas avoir à toucher au reste du pipeline.
    """
    maintenant = datetime.now(timezone.utc)
    for passeport in passeports:
        passeport.publie_le = maintenant


async def attribuer_passeports_pour_commande(db: AsyncSession, commande: Commande) -> list[Passeport]:
    """Numérotation, QR Code, signature et publication pour chaque exemplaire
    d'une commande payée. Statut initial : PRECHARGE (Document technique,
    « Attribution automatique »). Ne committe pas — voir docstring du module."""
    pays = await db.get(Pays, commande.pays_id)
    if pays is None:
        raise ValueError(f"Pays introuvable pour la commande {commande.id}.")

    annee = str(datetime.now(timezone.utc).year)
    premier_numero = await _reserver_plage_numeros(db, pays.id, annee, commande.quantite)

    passeports: list[Passeport] = []
    for offset in range(commande.quantite):
        numero_lot = str(premier_numero + offset).zfill(7)
        qr_uuid = str(uuid.uuid4())
        chaine_canonique = construire_chaine_canonique(pays.code_numerique, annee, numero_lot, qr_uuid)
        empreinte = hashlib.sha256(chaine_canonique.encode("utf-8")).digest()

        passeport = Passeport(
            commande_id=commande.id,
            pays_id=pays.id,
            numero_pays=pays.code_numerique,
            numero_annee=annee,
            numero_lot=numero_lot,
            qr_uuid=qr_uuid,
            hash_sha256=empreinte.hex(),
            signature=signer(empreinte),
            # TODO(Module Administration) : lire la gabarit_version validée correspondant
            # à commande.langue_version au lieu de figer la version 1 — aucune conversion
            # n'étant possible après attribution (Document technique, Module 3).
            gabarit_version=1,
            statut=StatutPasseport.PRECHARGE,
        )
        db.add(passeport)
        passeports.append(passeport)

    await db.flush()
    publier_passeports(passeports)  # même transaction : publication et attribution réussissent ensemble
    return passeports
