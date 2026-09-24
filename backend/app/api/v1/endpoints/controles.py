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

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import CurrentUser, get_current_user, require_roles
from app.core.rbac import Role
from app.core.signing import cle_publique_pem
from app.core.signing import verifier as verifier_signature_numerique
from app.db.session import get_db
from app.models.controle import Controle, ResultatControle, TypeIncident
from app.models.convoyeur import Convoyeur
from app.models.eleveur import Eleveur
from app.models.itineraire import Itineraire
from app.models.numerisation import Numerisation
from app.models.passeport import Passeport, StatutPasseport
from app.models.troupeau import Troupeau, TroupeauEspece
from app.models.utilisateur import Utilisateur
from app.models.vaccination import Vaccination
from app.schemas.controle import ControleCreate, ControleResultat, HistoriqueControle, SignalerIncidentRequest
from app.services.attribution import construire_chaine_canonique

router = APIRouter(prefix="/controles", tags=["Module 5 — Contrôle"])

# En-deçà de ce délai depuis le dernier scan à CE MÊME poste, un simple
# avertissement suffit (l'agent voit le compte, reste décisionnaire) ; au-delà,
# saisie d'un motif obligatoire avant de pouvoir valider — voir la docstring
# de ControleResultat pour le raisonnement complet.
SEUIL_MOTIF_OBLIGATOIRE_MINUTES = 10


async def _garde_fou_reutilisation(db: AsyncSession, passeport_id: str, poste_id: str) -> tuple[list[HistoriqueControle], bool, int, float | None, bool]:
    """Interroge l'historique des contrôles d'un passeport et calcule les
    signaux du garde-fou anti-réutilisation — factorisé pour être identique
    entre enregistrer_controle (qui écrit un nouveau contrôle) et
    historique_pour_garde_fou (lecture seule, appelée par le frontend AVANT
    que l'agent ne valide). Retourne (historique, deja_valide_a_ce_poste,
    nb_scans_ce_poste, minutes_depuis_dernier_scan_ce_poste, motif_requis)."""
    result = await db.execute(
        select(Controle).where(Controle.passeport_id == passeport_id).order_by(Controle.cree_le.desc())
    )
    controles_anterieurs = result.scalars().all()
    historique = [
        HistoriqueControle(poste_id=c.poste_id, resultat=c.resultat, date=c.cree_le.isoformat())
        for c in controles_anterieurs
    ]
    scans_ce_poste = [c for c in controles_anterieurs if c.poste_id == poste_id]
    deja_valide_a_ce_poste = any(c.resultat == ResultatControle.VALIDE for c in scans_ce_poste)
    nb_scans_ce_poste = len(scans_ce_poste)

    minutes_depuis_dernier: float | None = None
    motif_requis = False
    if scans_ce_poste:
        # Le premier élément est le plus récent — controles_anterieurs (et
        # donc scans_ce_poste, qui en est un sous-ensemble filtré en
        # préservant l'ordre) est trié par cree_le décroissant ci-dessus.
        dernier = scans_ce_poste[0]
        maintenant = datetime.now(timezone.utc)
        cree_le = dernier.cree_le if dernier.cree_le.tzinfo else dernier.cree_le.replace(tzinfo=timezone.utc)
        minutes_depuis_dernier = (maintenant - cree_le).total_seconds() / 60
        motif_requis = minutes_depuis_dernier >= SEUIL_MOTIF_OBLIGATOIRE_MINUTES

    return historique, deja_valide_a_ce_poste, nb_scans_ce_poste, minutes_depuis_dernier, motif_requis


@router.get("/historique/{passeport_id}", response_model=ControleResultat)
async def historique_pour_garde_fou(
    passeport_id: str,
    poste_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ControleResultat:
    """Consultation SEULE de l'historique des contrôles d'un passeport, sans
    en enregistrer un nouveau — alimente le garde-fou anti-réutilisation
    affiché à l'agent (voir docstring de ControleResultat). Appelée en
    complément de la vérification locale/hors-ligne habituelle
    (frontend/src/pages/ControleFrontiere.tsx), uniquement quand une
    connexion est disponible : l'historique nécessite de voir les scans
    faits par d'AUTRES agents à d'autres postes, ce qu'un cache local
    synchronisé par appareil ne peut pas savoir à lui seul. Renvoie les
    autres champs de ControleResultat à `None`/valeurs neutres — ils ne
    concernent que le résultat d'authenticité, déjà calculé localement."""
    historique, deja_valide_a_ce_poste, nb_scans_ce_poste, minutes_depuis_dernier, motif_requis = (
        await _garde_fou_reutilisation(db, passeport_id, poste_id)
    )
    return ControleResultat(
        controle_id=None,
        resultat=ResultatControle.A_VERIFIER,
        signature_valide=None,
        itineraire_disponible_localement=False,
        conforme_itineraire=None,
        historique_controles=historique,
        deja_valide_a_ce_poste=deja_valide_a_ce_poste,
        nb_scans_ce_poste=nb_scans_ce_poste,
        minutes_depuis_dernier_scan_ce_poste=minutes_depuis_dernier,
        motif_requis=motif_requis,
    )


@router.post("", response_model=ControleResultat, dependencies=[Depends(require_roles(Role.AGENT_CONTROLE))])
async def enregistrer_controle(
    payload: ControleCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ControleResultat:
    if not payload.passeport_id and not payload.qr_uuid:
        raise HTTPException(status_code=422, detail="passeport_id ou qr_uuid requis.")

    if payload.passeport_id:
        passeport = await db.get(Passeport, payload.passeport_id)
    else:
        # Cas d'un passeport authentifié hors-ligne par sa signature
        # embarquée (voir qrcode_service.py) mais jamais synchronisé sur cet
        # appareil — l'agent ne connaît que son qr_uuid, pas son identifiant
        # interne. Résolu ici, côté serveur, qui lui dispose de la table
        # complète.
        result_passeport = await db.execute(select(Passeport).where(Passeport.qr_uuid == payload.qr_uuid))
        passeport = result_passeport.scalar_one_or_none()
    passeport_id_effectif = passeport.id if passeport is not None else payload.passeport_id
    if passeport_id_effectif is None:
        # Ni passeport_id connu localement, ni qr_uuid résolu côté serveur —
        # jamais un passeport authentique légitimement émis par cette
        # plateforme (voir la résolution ci-dessus). Refus propre plutôt
        # que de tenter d'écrire un Controle sans passeport_id, qui
        # échouerait sur la contrainte de clé étrangère.
        raise HTTPException(status_code=404, detail="Passeport introuvable — ni en local, ni sur la plateforme.")
    resultat = ResultatControle.REFUSE
    conforme = None
    itineraire_dispo = False
    signature_valide = None

    if passeport is not None:
        if passeport.statut == StatutPasseport.REVOQUE:
            # Passeport retiré du circuit par un Super Admin (faux document
            # détecté sur le terrain, voir POST /passeports/revoquer) —
            # refus IMMÉDIAT et INCONDITIONNEL, avant même de vérifier la
            # signature ou l'itinéraire : un document frauduleux peut très
            # bien porter une signature techniquement valide (ex. copié
            # depuis un vrai passeport), la révocation doit donc primer sur
            # tout le reste. Le statut REVOQUE lui-même n'est jamais
            # réécrit plus bas (voir la condition sur passeport.statut) —
            # un contrôle ultérieur ne doit jamais le faire sortir de cet
            # état terminal.
            resultat = ResultatControle.REFUSE
            signature_valide = False
        else:
            chaine_canonique = construire_chaine_canonique(
                passeport.numero_pays, passeport.numero_annee, passeport.numero_lot, passeport.qr_uuid
            )
            empreinte = hashlib.sha256(chaine_canonique.encode("utf-8")).digest()
            signature_valide = verifier_signature_numerique(empreinte, passeport.signature, cle_publique_pem())

            if not signature_valide:
                # Authenticité en défaut : rédhibitoire, sans même consulter l'itinéraire.
                resultat = ResultatControle.REFUSE
            else:
                result = await db.execute(select(Itineraire).where(Itineraire.passeport_id == passeport.id))
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

    # Garde-fou anti-réutilisation — voir la docstring de ControleResultat.
    # Interrogé AVANT d'ajouter le nouveau contrôle ci-dessous : ne doit
    # jamais se voir lui-même dans son propre historique.
    historique_controles: list[HistoriqueControle] = []
    deja_valide_a_ce_poste = False
    nb_scans_ce_poste = 0
    minutes_depuis_dernier = None
    motif_requis = False
    if passeport is not None:
        historique_controles, deja_valide_a_ce_poste, nb_scans_ce_poste, minutes_depuis_dernier, motif_requis = (
            await _garde_fou_reutilisation(db, passeport.id, payload.poste_id)
        )
        if motif_requis and not (payload.motif and payload.motif.strip()):
            # Appliqué aussi côté serveur, pas seulement par le frontend
            # (qui bloque déjà normalement la validation dans ce cas) — un
            # appel direct à l'API sans passer par l'écran de contrôle ne
            # doit pas pouvoir contourner cette exigence.
            raise HTTPException(
                status_code=422,
                detail="Un motif est requis : ce PPB a déjà été scanné à ce poste il y a plus de "
                f"{SEUIL_MOTIF_OBLIGATOIRE_MINUTES} minutes.",
            )

    controle = Controle(
        passeport_id=passeport_id_effectif,
        poste_id=payload.poste_id,
        agent_id=current_user.id,
        resultat=resultat,
        itineraire_disponible_localement=itineraire_dispo,
        conforme_itineraire=conforme,
        mode=payload.mode,
        latitude=payload.latitude,
        longitude=payload.longitude,
        motif=payload.motif,
        type_incident=payload.type_incident,
        details_incident=payload.details_incident,
    )
    db.add(controle)
    await db.commit()

    return ControleResultat(
        controle_id=controle.id,
        resultat=resultat,
        signature_valide=signature_valide,
        itineraire_disponible_localement=itineraire_dispo,
        conforme_itineraire=conforme,
        historique_controles=historique_controles,
        deja_valide_a_ce_poste=deja_valide_a_ce_poste,
        nb_scans_ce_poste=nb_scans_ce_poste,
        minutes_depuis_dernier_scan_ce_poste=minutes_depuis_dernier,
        motif_requis=motif_requis,
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
    itineraires_delta = [await _enrichir_avec_emission(db, _serialiser_itineraire(i)) for i in result_itineraires.scalars().all()]

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
        "itineraires": [await _enrichir_avec_emission(db, _serialiser_itineraire(i)) for i in result_itineraires.scalars().all()],
    }


@router.get("")
async def historique_controles(
    poste_id: str | None = None,
    limite: int = 50,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Historique des contrôles effectués aux postes frontaliers — alimente
    la section "Contrôles récents" du tableau de bord. Corrigé lors de cette
    évolution : l'endpoint n'exigeait jusqu'ici ni authentification ni
    restriction par pays (même faille que celles déjà corrigées ailleurs —
    voir SECURITY_REVIEW.md) ; un Admin National ne voit désormais que les
    contrôles portant sur des passeports de son propre pays."""
    query = (
        select(Controle, Passeport, Utilisateur)
        .join(Passeport, Controle.passeport_id == Passeport.id)
        .join(Utilisateur, Controle.agent_id == Utilisateur.id)
        .order_by(Controle.cree_le.desc())
        .limit(min(limite, 200))
    )
    if current_user.role not in (Role.SUPER_ADMIN, Role.CONSULTATION):
        query = query.where(Passeport.pays_id == current_user.pays_id)
    if poste_id:
        query = query.where(Controle.poste_id == poste_id)

    result = await db.execute(query)
    return [
        {
            "id": controle.id,
            "numero": f"{passeport.numero_pays}-{passeport.numero_annee}-{passeport.numero_lot}",
            "pays_id": passeport.pays_id,
            "poste_id": controle.poste_id,
            "resultat": controle.resultat,
            "mode": controle.mode,
            "agent_nom": agent.nom_complet,
            "date": controle.cree_le.isoformat(),
        }
        for controle, passeport, agent in result.all()
    ]


def _serialiser_passeport(p: Passeport) -> dict:
    return {
        "id": p.id,
        "numero": f"{p.numero_pays}-{p.numero_annee}-{p.numero_lot}",
        "qr_uuid": p.qr_uuid,
        "code_verification": p.code_verification,
        "hash_sha256": p.hash_sha256,
        "signature": p.signature,
        "statut": p.statut,
    }


def _serialiser_itineraire(i: Itineraire) -> dict:
    return {
        "passeport_id": i.passeport_id,
        "pays_origine_id": i.pays_origine_id,
        "pays_origine_autre": i.pays_origine_autre,
        "province_origine": i.province_origine,
        "localite_origine": i.localite_origine,
        "pays_destination_id": i.pays_destination_id,
        "pays_destination_autre": i.pays_destination_autre,
        "province_destination": i.province_destination,
        "localite_destination": i.localite_destination,
    }


async def _enrichir_avec_emission(db: AsyncSession, itineraire_serialise: dict) -> dict:
    """Ajoute au dict itinéraire (déjà sérialisé) les données d'éleveur,
    convoyeur, composition du troupeau et vaccinations — quand elles
    existent. Un passeport dont seule la page 3 a été transmise (pas encore
    la page 4) aura un itinéraire mais AUCUN troupeau : c'est le comportement
    attendu, jamais une erreur — l'application de contrôle doit alors
    afficher ces champs vides, exactement comme sur le papier pas encore
    rempli (voir frontend, AperçuDocumentPasseport)."""
    passeport_id = itineraire_serialise["passeport_id"]

    eleveur = (await db.execute(select(Eleveur).where(Eleveur.passeport_id == passeport_id))).scalar_one_or_none()
    convoyeur = (await db.execute(select(Convoyeur).where(Convoyeur.passeport_id == passeport_id))).scalar_one_or_none()
    troupeau = (await db.execute(select(Troupeau).where(Troupeau.passeport_id == passeport_id))).scalar_one_or_none()

    especes: list[dict] = []
    vaccinations: list[dict] = []
    if troupeau is not None:
        result_especes = await db.execute(select(TroupeauEspece).where(TroupeauEspece.troupeau_id == troupeau.id))
        especes = [
            {
                "espece": e.espece,
                "nombre_males": e.nombre_males,
                "nombre_femelles_jeunes": e.nombre_femelles_jeunes,
                "nombre_femelles_adultes": e.nombre_femelles_adultes,
                "nombre_total": e.nombre_total,
            }
            for e in result_especes.scalars().all()
        ]
        result_vaccinations = await db.execute(select(Vaccination).where(Vaccination.troupeau_id == troupeau.id))
        vaccinations = [
            {"maladie": v.maladie, "date_vaccination": str(v.date_vaccination) if v.date_vaccination else None, "lieu": v.lieu}
            for v in result_vaccinations.scalars().all()
        ]

    return {
        **itineraire_serialise,
        "eleveur": {"nom_prenom": eleveur.nom_prenom, "numero_cni": eleveur.numero_cni, "telephone": eleveur.telephone} if eleveur else None,
        "convoyeur": {"nom_prenom": convoyeur.nom_prenom, "numero_cni": convoyeur.numero_cni, "telephone": convoyeur.telephone} if convoyeur else None,
        "troupeau_especes": especes,
        "vaccinations": vaccinations,
    }


@router.get("/signalements", dependencies=[Depends(require_roles(Role.SUPER_ADMIN, Role.ADMIN_NATIONAL))])
async def lister_signalements(
    pays_id: int | None = None,
    type_incident: TypeIncident | None = None,
    agent_emission_id: str | None = None,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Contrôles ayant fait l'objet d'un signalement d'incident (voir
    Controle.type_incident) — traçabilité "retrouver l'agent d'émission qui
    fait le faux" : chaque ligne relie le contrôleur qui a signalé, le
    passeport concerné, ET l'agent d'émission ayant émis ce document
    (retrouvé via Numerisation.agent_id/poste_code de sa page 4), pour
    repérer un agent d'émission revenant anormalement souvent dans ces
    signalements. Même cloisonnement par pays que le reste de la
    plateforme — un Admin National ne voit que les signalements concernant
    des passeports de son propre pays, jamais ceux d'un autre.

    `agent_emission_id` filtre sur l'agent qui a ÉMIS le passeport
    (Numerisation.agent_id, page 4) — PAS sur l'agent qui a CONTRÔLÉ et
    signalé (Controle.agent_id) : c'est bien le premier qui intéresse cette
    vue, l'objectif étant de retrouver les émissions frauduleuses, pas les
    contrôles eux-mêmes."""
    pays_id_effectif = pays_id if current_user.role == Role.SUPER_ADMIN else current_user.pays_id

    query = (
        select(Controle, Passeport, Numerisation, Utilisateur)
        .select_from(Controle)
        .join(Passeport, Passeport.id == Controle.passeport_id)
        .outerjoin(Numerisation, (Numerisation.passeport_id == Passeport.id) & (Numerisation.page_num == 4))
        .outerjoin(Utilisateur, Utilisateur.id == Numerisation.agent_id)
        .where(Controle.type_incident.is_not(None))
    )
    if pays_id_effectif is not None:
        query = query.where(Passeport.pays_id == pays_id_effectif)
    if type_incident is not None:
        query = query.where(Controle.type_incident == type_incident)
    if agent_emission_id is not None:
        query = query.where(Numerisation.agent_id == agent_emission_id)
    query = query.order_by(Controle.cree_le.desc()).limit(200)

    result = await db.execute(query)
    return [
        {
            "controle_id": controle.id,
            "date": controle.cree_le.isoformat(),
            "poste_controle": controle.poste_id,
            "resultat": controle.resultat.value,
            "type_incident": controle.type_incident.value if controle.type_incident else None,
            "details_incident": controle.details_incident,
            "passeport_numero": f"{passeport.numero_pays}-{passeport.numero_annee}-{passeport.numero_lot}",
            "passeport_id": passeport.id,
            "passeport_revoque": passeport.statut == StatutPasseport.REVOQUE,
            "agent_emission_id": agent.id if agent else None,
            "agent_emission_nom": agent.nom_complet if agent else None,
            "poste_emission_code": numerisation.poste_code if numerisation else None,
        }
        for controle, passeport, numerisation, agent in result.all()
    ]


@router.patch("/{controle_id}/signalement")
async def signaler_incident(
    controle_id: str,
    payload: SignalerIncidentRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Attache (ou efface) un signalement d'incident à un contrôle DÉJÀ
    enregistré — étape séparée et volontairement a posteriori (voir
    ControleCreate.type_incident) : le contrôle lui-même n'attend jamais ce
    choix pour être validé et enregistré. Réservé à l'agent qui a réalisé
    CE contrôle précis, ou à un Super Admin (correction) — jamais un autre
    agent de contrôle, qui n'a pas constaté l'irrégularité de ses propres
    yeux sur le terrain."""
    controle = await db.get(Controle, controle_id)
    if controle is None:
        raise HTTPException(status_code=404, detail="Contrôle introuvable.")
    if current_user.role != Role.SUPER_ADMIN and controle.agent_id != current_user.id:
        raise HTTPException(status_code=403, detail="Seul l'agent ayant réalisé ce contrôle peut le signaler.")

    controle.type_incident = payload.type_incident
    controle.details_incident = payload.details_incident
    await db.commit()
    return {"type_incident": controle.type_incident.value if controle.type_incident else None}
