"""
Module 3 — Impression (Document technique, section 3, M3).

Attribution automatique (numérotation, QR/UUID, signature — voir
app.services.attribution) déclenchée en interne par la confirmation du
paiement (Module 2) — jamais appelée directement par un client. La
publication vers l'index de vérification (Module 5) est event-driven, dans
la même transaction que l'attribution (voir app.services.attribution.publier_passeports).
"""
from datetime import datetime, timezone
import base64

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import CurrentUser, get_current_user, require_roles, require_same_country_or_super_admin
from app.core.rbac import Role
from app.core.signing import cle_publique_pem
from app.db.session import get_db
from app.models.autorisation_impression import AutorisationImpression
from app.models.commande import Commande
from app.models.admin import StatutTexteGabarit, TexteGabarit
from app.models.branding import ID_BRANDING_GLOBAL, Branding
from app.models.controle import Controle
from app.models.convoyeur import Convoyeur
from app.models.eleveur import Eleveur
from app.models.passeport import Passeport, StatutPasseport
from app.schemas.passeport import AutorisationImpressionCreate, AutorisationImpressionOut, DeclarerLotRequest
from app.services.attribution import attribuer_passeports_pour_commande, publier_passeports
from app.services.audit import journaliser
from app.services.passeport_detail import detail_emission
from app.services.pdf_passeport import generer_document_lot_pdf, generer_document_passeport_pdf
from app.services.qrcode_service import generer_qrcode_png_base64

router = APIRouter(prefix="/passeports", tags=["Module 3 — Impression"])


# --- Attribution (interne, event-driven) --------------------------------------------------


@router.post("/attribuer", include_in_schema=False)
async def attribuer_passeports(commande_id: str, db: AsyncSession = Depends(get_db)):
    """Point d'entrée interne — en production, l'attribution est déclenchée
    directement en mémoire par le Module 2 (voir
    app/api/v1/endpoints/paiements.py, validation du paiement présentiel),
    dans la même transaction que la confirmation du paiement. Ce endpoint
    reste disponible pour un rejeu manuel (ops) ou un appel de test isolé,
    mais ne doit jamais être exposé à un client externe."""
    commande = await db.get(Commande, commande_id)
    if commande is None:
        raise HTTPException(status_code=404, detail="Commande introuvable.")

    passeports = await attribuer_passeports_pour_commande(db, commande)
    await db.commit()
    return {"passeports_crees": len(passeports)}


@router.post(
    "/sync/publier-nouveaux-passeports",
    dependencies=[Depends(require_roles(Role.SUPER_ADMIN))],
)
async def republier_passeports_non_publies(db: AsyncSession = Depends(get_db)):
    """La publication normale est automatique et immédiate (même transaction que
    l'attribution — voir app.services.attribution.publier_passeports). Ce
    endpoint est un filet de sécurité opérationnel : il republie tout
    passeport resté non publié après un incident applicatif, sans jamais
    dupliquer l'attribution elle-même (idempotent : republier un passeport
    déjà publié se contente de rafraîchir son horodatage)."""
    result = await db.execute(select(Passeport).where(Passeport.publie_le.is_(None)))
    passeports_a_publier = result.scalars().all()
    publier_passeports(passeports_a_publier)
    await db.commit()
    return {"republies": len(passeports_a_publier)}


# --- Consultation ---------------------------------------------------------------------------


@router.get("", response_model=None)
async def lister_passeports(
    pays_id: int | None = None,
    commande_id: str | None = None,
    statut: StatutPasseport | None = None,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(Passeport)
    if current_user.role != Role.SUPER_ADMIN:
        query = query.where(Passeport.pays_id == current_user.pays_id)
    elif pays_id is not None:
        query = query.where(Passeport.pays_id == pays_id)
    if commande_id is not None:
        query = query.where(Passeport.commande_id == commande_id)
    if statut is not None:
        query = query.where(Passeport.statut == statut)
    result = await db.execute(query)
    return [
        {
            "id": p.id,
            "numero": f"{p.numero_pays}-{p.numero_annee}-{p.numero_lot}",
            "qr_uuid": p.qr_uuid,
            "statut": p.statut,
            "publie": p.publie_le is not None,
        }
        for p in result.scalars().all()
    ]


@router.get("/emissions-detail", dependencies=[Depends(require_roles(Role.SUPER_ADMIN, Role.ADMIN_NATIONAL))])
async def lister_emissions_detail(
    pays_id: int | None = None,
    annee: int | None = None,
    limite: int = 50,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Détail nominatif (éleveur/convoyeur — nom, CNI, téléphone — composition
    du troupeau, vaccinations) de chaque passeport EFFECTIVEMENT ÉMIS sur le
    terrain (statut différent de PRECHARGE et VIERGE, qui n'ont encore aucune
    donnée saisie). Réservé à Super Admin et Admin National : ces données
    personnelles ne sont jamais exposées à Consultation, contrairement aux
    agrégats de /statistiques. Un Admin National ne voit que son propre pays
    — `pays_id` est ignoré s'il ne correspond pas au sien, jamais un 403,
    même règle que pour /statistiques (voir son cloisonnement)."""
    pays_id_effectif = pays_id if current_user.role == Role.SUPER_ADMIN else current_user.pays_id

    query = select(Passeport).where(Passeport.statut.notin_((StatutPasseport.PRECHARGE, StatutPasseport.VIERGE)))
    if pays_id_effectif is not None:
        query = query.where(Passeport.pays_id == pays_id_effectif)
    if annee is not None:
        query = query.where(Passeport.numero_annee == str(annee))
    query = query.order_by(Passeport.cree_le.desc()).limit(min(limite, 200))

    result = await db.execute(query)
    return [await detail_emission(db, p) for p in result.scalars().all()]


@router.get("/historique-personne", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def historique_personne(
    numero_cni: str,
    db: AsyncSession = Depends(get_db),
):
    """Retrace TOUS les passeports où une personne (éleveur OU convoyeur) est
    apparue au fil du temps, regroupés par numéro de pièce d'identité — et,
    pour chacun, l'itinéraire déclaré et l'historique complet des contrôles
    effectués (poste, date, résultat), pour reconstituer ses déplacements
    réels plutôt que le seul trajet déclaré sur un unique passeport.

    Réservé Super Admin, contrairement à /emissions-detail (Super Admin +
    Admin National) : une même personne peut apparaître sur des passeports
    émis dans PLUSIEURS pays différents (c'est précisément l'intérêt de
    cette vue) — un cloisonnement par pays comme sur /emissions-detail n'a
    donc pas de sens ici, et exposerait par construction des données
    d'autres pays à un Admin National s'il était autorisé.

    Le rapprochement se fait sur le numéro de pièce d'identité tel que
    saisi à chaque émission — deux saisies légèrement différentes pour la
    même personne réelle (faute de frappe, CNI renouvelée) ne seront pas
    rapprochées : limite assumée, aucune normalisation ou correspondance
    approximative n'est tentée, pour ne jamais associer à tort deux
    personnes distinctes partageant une saisie proche par coïncidence."""
    numero_cni_normalise = numero_cni.strip()
    if not numero_cni_normalise:
        raise HTTPException(status_code=422, detail="Numéro de pièce d'identité requis.")

    result_eleveur = await db.execute(select(Eleveur.passeport_id).where(Eleveur.numero_cni == numero_cni_normalise))
    result_convoyeur = await db.execute(select(Convoyeur.passeport_id).where(Convoyeur.numero_cni == numero_cni_normalise))
    ids_passeports = {row[0] for row in result_eleveur} | {row[0] for row in result_convoyeur}
    if not ids_passeports:
        return []

    result_passeports = await db.execute(
        select(Passeport).where(Passeport.id.in_(ids_passeports)).order_by(Passeport.cree_le.asc())
    )
    passeports = result_passeports.scalars().all()

    voyages = []
    for p in passeports:
        detail = await detail_emission(db, p)
        result_controles = await db.execute(
            select(Controle).where(Controle.passeport_id == p.id).order_by(Controle.cree_le.asc())
        )
        controles = [
            {
                "poste_id": c.poste_id,
                "resultat": c.resultat,
                "date": c.cree_le.isoformat(),
                "motif": c.motif,
            }
            for c in result_controles.scalars().all()
        ]
        voyages.append({"passeport": detail, "controles": controles})
    return voyages


@router.get("/{passeport_id}/detail", dependencies=[Depends(require_roles(Role.SUPER_ADMIN, Role.ADMIN_NATIONAL))])
async def detail_passeport(
    passeport_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Détail nominatif d'UN passeport — même contenu qu'une ligne de
    /emissions-detail, pour un accès direct depuis une recherche par numéro
    ou par QR (écran Impression / Statistiques)."""
    passeport = await db.get(Passeport, passeport_id)
    if passeport is None:
        raise HTTPException(status_code=404, detail="Passeport introuvable.")
    require_same_country_or_super_admin(passeport.pays_id, current_user)
    return await detail_emission(db, passeport)


@router.get("/{passeport_id}/qrcode")
async def qrcode_passeport(
    passeport_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """PNG du QR Code de validation (page 2 du gabarit) — utilisé pour
    l'impression centralisée et l'aperçu Web Admin avant impression."""
    passeport = await db.get(Passeport, passeport_id)
    if passeport is None:
        raise HTTPException(status_code=404, detail="Passeport introuvable.")
    if current_user.role != Role.SUPER_ADMIN and current_user.pays_id != passeport.pays_id:
        raise HTTPException(status_code=403, detail="Accès limité aux passeports de votre pays.")

    png_bytes = base64.b64decode(generer_qrcode_png_base64(passeport.qr_uuid))
    return Response(content=png_bytes, media_type="image/png")


async def _obtenir_textes_legaux(db: AsyncSession, gabarit_version: int) -> list[tuple[str, str]] | None:
    """Textes légaux VALIDÉS (circuit à deux comptes, voir Module Administration)
    pour une version de gabarit donnée — jamais un texte encore au statut
    « proposé » ou « rejeté ». Apparie les versions française et anglaise
    partageant la même `cle` (voir pdf_passeport._page_2, qui affiche les deux
    langues côte à côte, comme sur le gabarit de référence). Repli sur les
    mentions par défaut si rien n'a encore été validé pour cette version (voir
    pdf_passeport.TEXTES_LEGAUX_PAR_DEFAUT)."""
    result = await db.execute(
        select(TexteGabarit).where(
            TexteGabarit.gabarit_version == gabarit_version,
            TexteGabarit.langue.in_(("fr", "en")),
            TexteGabarit.statut == StatutTexteGabarit.VALIDE,
        )
    )
    par_cle: dict[str, dict[str, str]] = {}
    for texte in result.scalars().all():
        par_cle.setdefault(texte.cle, {})[texte.langue] = texte.valeur

    paires = [(v["fr"], v["en"]) for v in par_cle.values() if "fr" in v and "en" in v]
    return sorted(paires) or None  # None -> generer_document_passeport_pdf applique son propre repli


async def _obtenir_cachet_bytes(db: AsyncSession) -> bytes | None:
    """Cachet + signature scanné (module Personnalisation) — une seule image
    pour toute la plateforme, voir app.models.branding. `None` si jamais
    uploadé : generer_document_passeport_pdf omet alors simplement le
    cachet, sans erreur."""
    branding = await db.get(Branding, ID_BRANDING_GLOBAL)
    return branding.cachet_bytes if branding else None


@router.get("/{passeport_id}/document")
async def document_passeport(
    passeport_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Document imprimable A5 4 pages pour UN passeport — voir
    app/services/pdf_passeport.py pour ce qui est pré-rempli vs laissé vierge."""
    passeport = await db.get(Passeport, passeport_id)
    if passeport is None:
        raise HTTPException(status_code=404, detail="Passeport introuvable.")
    if current_user.role != Role.SUPER_ADMIN and current_user.pays_id != passeport.pays_id:
        raise HTTPException(status_code=403, detail="Accès limité aux passeports de votre pays.")

    # La version linguistique (FR/EN ou FR/AR) est portée par la commande
    # d'origine, pas par le passeport lui-même — voir app/models/commande.py.
    commande = await db.get(Commande, passeport.commande_id)
    langue_version = commande.langue_version.value if commande else "FR/EN"

    textes = await _obtenir_textes_legaux(db, passeport.gabarit_version)
    cachet_bytes = await _obtenir_cachet_bytes(db)
    pdf_bytes = generer_document_passeport_pdf(
        passeport,
        textes,
        langue_version=langue_version,
        cachet_bytes=cachet_bytes,
        reference_commande=passeport.commande_id[:8].upper() if passeport.commande_id else None,
    )
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="ppb-{passeport.numero_pays}-{passeport.numero_annee}-{passeport.numero_lot}.pdf"'},
    )


@router.get("/commande/{commande_id}/document-impression")
async def document_impression_commande(
    commande_id: str,
    limite: int | None = None,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Document imprimable A5, concaténant les 4 pages de chaque passeport de
    cette commande. `limite` (optionnel) plafonne le nombre de passeports
    inclus — un lot de plusieurs milliers d'exemplaires produirait sinon un
    PDF de plusieurs dizaines de milliers de pages, long à générer et
    difficile à ouvrir dans un navigateur ; l'agent choisit combien il veut
    afficher/imprimer à la fois.

    Ne filtre plus par statut PRECHARGE (comme avant l'auto-confirmation à
    la validation du paiement, voir app.api.v1.endpoints.paiements) : les
    passeports passent désormais directement au statut VIERGE dès le
    paiement validé, sans étape de confirmation d'impression séparée — ce
    document reste consultable/imprimable pour toute commande payée, quel
    que soit le statut individuel de ses passeports."""
    commande = await db.get(Commande, commande_id)
    if commande is None:
        raise HTTPException(status_code=404, detail="Commande introuvable.")
    if current_user.role not in (Role.SUPER_ADMIN, Role.GESTIONNAIRE_CEBEVIRHA) and current_user.pays_id != commande.pays_id:
        raise HTTPException(status_code=403, detail="Accès limité aux commandes de votre pays.")

    requete = select(Passeport).where(Passeport.commande_id == commande_id).order_by(Passeport.numero_lot)
    if limite is not None:
        requete = requete.limit(limite)
    result = await db.execute(requete)
    passeports = result.scalars().all()
    if not passeports:
        raise HTTPException(status_code=404, detail="Aucun passeport trouvé pour cette commande.")

    gabarit_version = passeports[0].gabarit_version
    textes = await _obtenir_textes_legaux(db, gabarit_version)
    cachet_bytes = await _obtenir_cachet_bytes(db)
    pdf_bytes = generer_document_lot_pdf(
        passeports,
        textes,
        langue_version=commande.langue_version.value,
        cachet_bytes=cachet_bytes,
        reference_commande=commande_id[:8].upper(),
    )
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="ppb-lot-{commande_id[:8]}.pdf"'},
    )


@router.get("/cle-publique")
async def obtenir_cle_publique():
    """Clé publique de vérification des signatures — SEULE donnée cryptographique
    distribuée aux applications de contrôle (Module 5) ; jamais la clé privée.
    Aucune restriction RBAC : cette clé est par nature publique."""
    pem = cle_publique_pem()
    return Response(content=pem, media_type="application/x-pem-file")


# --- Impression centralisée ------------------------------------------------------------------


@router.post(
    "/impression-centralisee/confirmer",
    dependencies=[Depends(require_roles(Role.SUPER_ADMIN, Role.GESTIONNAIRE_CEBEVIRHA))],
)
async def confirmer_impression_centralisee(
    commande_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """« Le lot est mis en file d'impression au siège de la CEBEVIRHA ; le statut
    passe à « vierge » dès confirmation d'impression. » (Document technique, M3)"""
    result = await db.execute(
        select(Passeport).where(Passeport.commande_id == commande_id, Passeport.statut == StatutPasseport.PRECHARGE)
    )
    passeports = result.scalars().all()
    if not passeports:
        raise HTTPException(status_code=404, detail="Aucun passeport PRECHARGE trouvé pour cette commande.")

    for passeport in passeports:
        passeport.statut = StatutPasseport.VIERGE

    await journaliser(
        db,
        utilisateur_id=current_user.id,
        action="impression_centralisee.confirmee",
        entite="Commande",
        entite_id=commande_id,
        nouvelle_valeur={"quantite": len(passeports)},
    )
    await db.commit()
    return {"statut": "confirme", "quantite": len(passeports)}


# --- Impression décentralisée — autorisations -------------------------------------------------


@router.get("/autorisations-impression/{pays_id}", response_model=AutorisationImpressionOut)
async def consulter_autorisation_impression(pays_id: int, db: AsyncSession = Depends(get_db)) -> AutorisationImpressionOut:
    result = await db.execute(
        select(AutorisationImpression)
        .where(AutorisationImpression.pays_id == pays_id, AutorisationImpression.active.is_(True))
        # La création empêche désormais plusieurs autorisations actives par
        # pays, mais reste défensif ici (ordre + first(), pas
        # scalar_one_or_none()) au cas où d'anciennes données en double
        # subsisteraient encore — prend la plus récente plutôt que de
        # planter avec MultipleResultsFound.
        .order_by(AutorisationImpression.cree_le.desc())
    )
    autorisation = result.scalars().first()
    if autorisation is None:
        raise HTTPException(status_code=404, detail="Aucune autorisation active pour ce pays.")
    return AutorisationImpressionOut.model_validate(autorisation)


@router.post(
    "/autorisations-impression",
    response_model=AutorisationImpressionOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(Role.SUPER_ADMIN))],
)
async def creer_autorisation_impression(
    payload: AutorisationImpressionCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AutorisationImpressionOut:
    if payload.plage_fin <= payload.plage_debut:
        raise HTTPException(status_code=422, detail="plage_fin doit être strictement supérieur à plage_debut.")

    result = await db.execute(
        select(AutorisationImpression).where(
            AutorisationImpression.pays_id == payload.pays_id, AutorisationImpression.active.is_(True)
        )
    )
    # Une seule autorisation active à la fois par pays, quelle que soit sa
    # plage — pas seulement en cas de chevauchement. Le reste du système
    # (consultation, déclaration de lot imprimé) suppose qu'il en existe au
    # plus une par pays ; en autoriser plusieurs simultanées (même sur des
    # plages disjointes) casse ces deux endroits avec une erreur
    # MultipleResultsFound dès que la seconde autorisation est créée —
    # confirmé en usage réel. Suspendre l'autorisation en cours avant d'en
    # créer une nouvelle, plutôt que de permettre l'empilement.
    existante = result.scalars().first()
    if existante is not None:
        raise HTTPException(
            status_code=409,
            detail=f"Une autorisation est déjà active pour ce pays ({existante.plage_debut}-{existante.plage_fin}) — suspendez-la avant d'en créer une nouvelle.",
        )

    autorisation = AutorisationImpression(
        pays_id=payload.pays_id,
        plage_debut=payload.plage_debut,
        plage_fin=payload.plage_fin,
        gabarit_version=payload.gabarit_version,
    )
    db.add(autorisation)
    await db.flush()

    await journaliser(
        db,
        utilisateur_id=current_user.id,
        action="autorisation_impression.creee",
        entite="AutorisationImpression",
        entite_id=autorisation.id,
        nouvelle_valeur=payload.model_dump(),
    )
    await db.commit()
    await db.refresh(autorisation)
    return AutorisationImpressionOut.model_validate(autorisation)


@router.post(
    "/autorisations-impression/{autorisation_id}/suspendre",
    dependencies=[Depends(require_roles(Role.SUPER_ADMIN))],
)
async def suspendre_autorisation_impression(
    autorisation_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """« Droit de suspension immédiat par la CEBEVIRHA en cas d'anomalie constatée
    lors d'un audit. » (Document technique, M3 — Garde-fous)"""
    autorisation = await db.get(AutorisationImpression, autorisation_id)
    if autorisation is None:
        raise HTTPException(status_code=404, detail="Autorisation introuvable.")
    if not autorisation.active:
        raise HTTPException(status_code=409, detail="Cette autorisation est déjà suspendue.")

    autorisation.active = False
    autorisation.suspendue_par_id = current_user.id

    await journaliser(
        db,
        utilisateur_id=current_user.id,
        action="autorisation_impression.suspendue",
        entite="AutorisationImpression",
        entite_id=autorisation.id,
    )
    await db.commit()
    return {"id": autorisation.id, "active": False}


# --- Impression décentralisée — déclaration ----------------------------------------------------


@router.post(
    "/impression-decentralisee/declarer",
    dependencies=[Depends(require_roles(Role.SUPER_ADMIN, Role.ADMIN_NATIONAL))],
)
async def declarer_lot_imprime(
    payload: DeclarerLotRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Plage de numéros fermée — toute déclaration hors plage autorisée est
    rejetée (HTTP 422) ; tout numéro absent ou déjà imprimé est rejeté avant
    la moindre écriture (déclaration atomique, jamais partielle)."""
    require_same_country_or_super_admin(payload.pays_id, current_user)

    if payload.numero_fin <= payload.numero_debut:
        raise HTTPException(status_code=422, detail="numero_fin doit être strictement supérieur à numero_debut.")

    result = await db.execute(
        select(AutorisationImpression).where(
            AutorisationImpression.pays_id == payload.pays_id,
            AutorisationImpression.active.is_(True),
            AutorisationImpression.plage_debut <= payload.numero_debut,
            AutorisationImpression.plage_fin >= payload.numero_fin,
        )
    )
    # Filtre sur la plage déclarée, pas seulement sur "active" : la création
    # empêche désormais plusieurs autorisations actives par pays (voir
    # creer_autorisation_impression), mais reste défensif ici (first(), pas
    # scalar_one_or_none()) au cas où d'anciennes données en double
    # subsisteraient encore.
    autorisation = result.scalars().first()
    if autorisation is None:
        raise HTTPException(status_code=422, detail="Aucune autorisation d'impression décentralisée active.")

    # La plage autorisée porte sur des numéros de lot ; l'année est celle de
    # l'attribution en cours (limitation documentée : une AutorisationImpression
    # ne couvre pas explicitement plusieurs années dans ce modèle).
    annee_courante = str(datetime.now(timezone.utc).year)
    numeros_attendus = {str(n).zfill(7) for n in range(payload.numero_debut, payload.numero_fin + 1)}

    result = await db.execute(
        select(Passeport).where(
            Passeport.pays_id == payload.pays_id,
            Passeport.numero_annee == annee_courante,
            Passeport.numero_lot.in_(numeros_attendus),
        )
    )
    passeports = result.scalars().all()

    manquants = numeros_attendus - {p.numero_lot for p in passeports}
    if manquants:
        raise HTTPException(
            status_code=404,
            detail=f"{len(manquants)} numéro(s) de la plage introuvable(s) pour ce pays/année — aucune écriture effectuée.",
        )
    deja_traites = [p.numero_lot for p in passeports if p.statut != StatutPasseport.PRECHARGE]
    if deja_traites:
        raise HTTPException(
            status_code=409,
            detail=f"{len(deja_traites)} numéro(s) déjà imprimé(s) ou à un autre statut — aucune écriture effectuée.",
        )

    for passeport in passeports:
        passeport.statut = StatutPasseport.VIERGE

    await journaliser(
        db,
        utilisateur_id=current_user.id,
        action="impression_decentralisee.lot_declare",
        entite="Passeport",
        entite_id=f"{payload.pays_id}:{payload.numero_debut}-{payload.numero_fin}",
        nouvelle_valeur={"quantite": len(passeports), "numero_debut": payload.numero_debut, "numero_fin": payload.numero_fin},
    )
    await db.commit()
    return {"statut": "declare", "quantite": len(passeports), "responsable": current_user.id}
