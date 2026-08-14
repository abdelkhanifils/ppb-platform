"""
Module 5 — Contrôle (Document technique, section 3, M5).

Trois responsabilités distinctes :

1. Vérification d'authenticité — la signature numérique du passeport est
   revérifiée ICI (en ligne) exactement comme l'application de contrôle le
   fait hors-ligne côté client (Web Crypto API, même chaîne canonique — voir
   frontend/src/services/verificationSignature.ts) : même formule, même clé
   publique. Une signature invalide est rédhibitoire, quel que soit l'état
   de l'itinéraire.

2. Conformité au trajet déclaré — l'agent de contrôle est rattaché à un
   pays (Utilisateur.pays_id, cf. RBAC) ; un poste de contrôle n'a de sens
   que si ce pays correspond à l'origine OU à la destination de l'itinéraire
   déclaré (simplification documentée ci-dessous : sans référentiel des
   postes à ce stade, on ne peut pas vérifier qu'il s'agit précisément du
   bon point de passage sur le trajet, seulement que le pays du poste fait
   partie du trajet déclaré). La conformité au trajet n'est vérifiable que
   si l'Itineraire a déjà été synchronisé jusqu'au poste
   (itineraire_disponible_localement) ; sinon, le résultat reste
   « à_vérifier » — repli sur la page 3 manuscrite, jamais un blocage ni
   une validation par défaut.

3. Synchronisation différentielle (identité + itinéraire) — alimentée par
   `Passeport.publie_le` (Module 3) et `Itineraire.publie_le` (Module 4,
   voir app.services.emission), interrogée par l'application de contrôle
   dès qu'elle détecte une connexion (voir
   frontend/src/hooks/useDeltaSync.ts), sans aucune action de l'agent.
"""
import hashlib
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import CurrentUser, get_current_user, require_roles
from app.core.rbac import Role
from app.core.signing import cle_publique_pem
from app.core.signing import verifier as verifier_signature_numerique
from app.db.session import get_db
from app.models.controle import Controle, ResultatControle
from app.models.itineraire import Itineraire
from app.models.passeport import Passeport, StatutPasseport
from app.schemas.controle import ControleCreate, ControleResultat
from app.services.attribution import construire_chaine_canonique

router = APIRouter(prefix="/controles", tags=["Module 5 — Contrôle"])


@router.post("", response_model=ControleResultat, dependencies=[Depends(require_roles(Role.AGENT_CONTROLE))])
async def enregistrer_controle(
    payload: ControleCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ControleResultat:
    passeport = await db.get(Passeport, payload.passeport_id)
    resultat = ResultatControle.REFUSE
    conforme = None
    itineraire_dispo = False
    signature_valide = None

    if passeport is not None:
        chaine_canonique = construire_chaine_canonique(
            passeport.numero_pays, passeport.numero_annee, passeport.numero_lot, passeport.qr_uuid
        )
        empreinte = hashlib.sha256(chaine_canonique.encode("utf-8")).digest()
        signature_valide = verifier_signature_numerique(empreinte, passeport.signature, cle_publique_pem())

        if not signature_valide:
            # Authenticité en défaut : rédhibitoire, sans même consulter l'itinéraire.
            resultat = ResultatControle.REFUSE
        else:
            result = await db.execute(select(Itineraire).where(Itineraire.passeport_id == payload.passeport_id))
            itineraire = result.scalar_one_or_none()
            itineraire_dispo = itineraire is not None and itineraire.synchronise_vers_controle

            if not itineraire_dispo:
                # Repli sur le document papier — jamais bloquer, jamais valider par défaut.
                resultat = ResultatControle.A_VERIFIER
            else:
                # Simplification documentée (voir docstring du module) : sans référentiel
                # des postes, on vérifie que le pays de l'agent fait partie du trajet
                # déclaré (origine ou destination), pas la position exacte sur ce trajet.
                conforme = current_user.pays_id in (itineraire.pays_origine_id, itineraire.pays_destination_id)
                resultat = ResultatControle.VALIDE if conforme else ResultatControle.REFUSE

        passeport.statut = StatutPasseport.CONTROLE

    controle = Controle(
        passeport_id=payload.passeport_id,
        poste_id=payload.poste_id,
        agent_id=current_user.id,
        resultat=resultat,
        itineraire_disponible_localement=itineraire_dispo,
        conforme_itineraire=conforme,
        mode=payload.mode,
        latitude=payload.latitude,
        longitude=payload.longitude,
    )
    db.add(controle)
    await db.commit()

    return ControleResultat(
        resultat=resultat,
        signature_valide=signature_valide,
        itineraire_disponible_localement=itineraire_dispo,
        conforme_itineraire=conforme,
    )


@router.get("/cache-verification/delta")
async def sync_delta(
    depuis: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Synchronisation différentielle automatique — déclenchée côté client dès
    détection réseau (voir frontend/src/hooks/useDeltaSync.ts), sans action de
    l'agent. `depuis` (horodatage ISO 8601, dernière synchronisation réussie)
    est comparé à `Passeport.publie_le` et `Itineraire.publie_le` : les deux
    index de vérification alimentés respectivement par le Module 3 et le
    Module 4 (voir app.services.attribution et app.services.emission)."""
    try:
        seuil = datetime.fromisoformat(depuis)
        if seuil.tzinfo is None:
            seuil = seuil.replace(tzinfo=timezone.utc)
    except ValueError:
        seuil = datetime.min.replace(tzinfo=timezone.utc)

    result_passeports = await db.execute(
        select(Passeport).where(Passeport.publie_le.is_not(None), Passeport.publie_le > seuil)
    )
    passeports_delta = [_serialiser_passeport(p) for p in result_passeports.scalars().all()]

    result_itineraires = await db.execute(
        select(Itineraire).where(Itineraire.publie_le.is_not(None), Itineraire.publie_le > seuil)
    )
    itineraires_delta = [_serialiser_itineraire(i) for i in result_itineraires.scalars().all()]

    return {
        "depuis": depuis,
        "horodatage_serveur": datetime.now(timezone.utc).isoformat(),
        "passeports_delta": passeports_delta,
        "itineraires_delta": itineraires_delta,
    }


@router.get("/cache-verification")
async def cache_verification_complet(db: AsyncSession = Depends(get_db)):
    """Téléchargement complet du cache (première installation d'un poste) — ne
    renvoie que les données déjà publiées vers l'index de vérification."""
    result_passeports = await db.execute(select(Passeport).where(Passeport.publie_le.is_not(None)))
    result_itineraires = await db.execute(select(Itineraire).where(Itineraire.publie_le.is_not(None)))

    return {
        "horodatage_serveur": datetime.now(timezone.utc).isoformat(),
        "passeports": [_serialiser_passeport(p) for p in result_passeports.scalars().all()],
        "itineraires": [_serialiser_itineraire(i) for i in result_itineraires.scalars().all()],
    }


@router.get("")
async def historique_controles(poste_id: str | None = None, db: AsyncSession = Depends(get_db)):
    query = select(Controle)
    if poste_id:
        query = query.where(Controle.poste_id == poste_id)
    result = await db.execute(query)
    return [{"id": c.id, "poste_id": c.poste_id, "resultat": c.resultat} for c in result.scalars().all()]


def _serialiser_passeport(p: Passeport) -> dict:
    return {
        "id": p.id,
        "numero": f"{p.numero_pays}-{p.numero_annee}-{p.numero_lot}",
        "qr_uuid": p.qr_uuid,
        "hash_sha256": p.hash_sha256,
        "signature": p.signature,
        "statut": p.statut,
    }


def _serialiser_itineraire(i: Itineraire) -> dict:
    return {
        "passeport_id": i.passeport_id,
        "pays_origine_id": i.pays_origine_id,
        "province_origine": i.province_origine,
        "pays_destination_id": i.pays_destination_id,
        "province_destination": i.province_destination,
    }
