"""
Module 4 — Scan / numérisation terrain (Document technique, section 3, M4).

Chaque page a un rôle précis (page 1 : vérif. visuelle ; page 2 : sélection
du passeport via QR ; pages 3-4 : création des entités métier). Aucune
image n'est transmise ni conservée côté serveur pour la VALIDATION des
pages — seules les données saisies/corrigées par l'agent le sont. SEULE
EXCEPTION : l'OCR assisté (voir la route .../ocr plus bas et
app/services/ocr_service.py), qui reçoit une photo à la seule fin de
pré-remplir le formulaire ; cette photo est conservée temporairement (voir
app/models/photo_ocr.py) — une décision distincte, explicite, jamais
étendue silencieusement au reste du module.

Idempotence : la transmission d'une page déjà connue (retour réseau perdu
côté client après un succès serveur, retentative automatique) met à jour la
ligne existante plutôt que d'en créer une seconde — la contrainte
d'unicité (passeport_id, page_num) protège ce comportement au niveau base.
La création des entités métier n'est déclenchée qu'une fois, garantie par
la vérification `passeport.statut != EMIS` avant d'y entrer : rejouer la
page 4 après coup ne recrée jamais un second Troupeau (par ailleurs
impossible, `Troupeau.passeport_id` est UNIQUE).
"""
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import CurrentUser, get_current_user, require_roles, require_same_country_or_super_admin
from app.core.rbac import Role
from app.db.session import get_db
from app.models.numerisation import Numerisation, StatutSync, StatutValidation
from app.models.passeport import Passeport, StatutPasseport
from app.models.photo_ocr import PhotoOcr
from app.services.emission import DonneesEmissionInvalides, creer_entites_page3, creer_entites_page4
from app.services.ocr_service import OcrIndisponible, appeler_google_vision, extraire_champs_page3, extraire_champs_page4

router = APIRouter(tags=["Module 4 — Scan"])


@router.post(
    "/numerisations/{passeport_id}/pages/{page_num}",
    dependencies=[Depends(require_roles(Role.AGENT_EMISSION))],
)
async def transmettre_page(
    passeport_id: str,
    page_num: int,
    # Valeur par defaut ajoutee apres un incident terrain : sans elle, ce corps
    # etait OBLIGATOIRE et un client envoyant `null` pour les pages 1 et 2 --
    # qui ne portent legitimement aucune donnee manuscrite -- recevait un 422
    # « Field required » a chaque tentative, bloquant definitivement la
    # synchronisation des la premiere page. Un corps absent signifie desormais
    # « page validee, aucune donnee », ce qui est le sens metier attendu.
    donnees_json: dict | None = None,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if page_num not in (1, 2, 3, 4):
        raise HTTPException(status_code=422, detail="page_num doit être compris entre 1 et 4.")

    passeport = await db.get(Passeport, passeport_id)
    if passeport is None:
        raise HTTPException(status_code=404, detail="Passeport introuvable.")
    # Corrigé lors de la revue de sécurité : sans ce contrôle, un agent
    # d'émission connaissant (ou devinant) l'UUID d'un passeport d'un AUTRE
    # pays pouvait le numériser — improbable vu l'espace des UUID, mais le
    # principe de moindre privilège doit être respecté indépendamment de la
    # difficulté pratique d'exploitation.
    require_same_country_or_super_admin(passeport.pays_id, current_user)

    result = await db.execute(
        select(Numerisation).where(Numerisation.passeport_id == passeport_id, Numerisation.page_num == page_num)
    )
    numerisation_existante = result.scalar_one_or_none()
    if numerisation_existante is not None:
        # Rejeu idempotent (ex. réponse réseau perdue après succès serveur) — on
        # met à jour la donnée mais on ne recrée jamais les entités métier.
        numerisation_existante.donnees_json = donnees_json
        numerisation_existante.agent_id = current_user.id
    else:
        db.add(
            Numerisation(
                passeport_id=passeport_id,
                page_num=page_num,
                donnees_json=donnees_json,
                statut_validation=StatutValidation.VALIDEE,
                statut_sync=StatutSync.SYNCHRONISEE,
                agent_id=current_user.id,
            )
        )

    result = await db.execute(select(Numerisation).where(Numerisation.passeport_id == passeport_id))
    toutes_numerisations = result.scalars().all()
    pages_validees = {n.page_num for n in toutes_numerisations}

    if pages_validees == {1, 2, 3, 4} and passeport.statut != StatutPasseport.EMIS:
        donnees_par_page = {n.page_num: n.donnees_json for n in toutes_numerisations}
        # Une saisie inexploitable (pays absent du referentiel, par exemple) est
        # un probleme CORRIGEABLE par l'agent : elle doit produire un 422 nomme,
        # jamais un 500. Un 500 sortant au-dessus du middleware CORS, le
        # navigateur affichait « bloque par la politique CORS » -- un message
        # qui designe la mauvaise cause et a coute des heures de recherche.
        try:
            await creer_entites_page3(db, passeport_id, donnees_par_page.get(3) or {})
            await creer_entites_page4(db, passeport_id, donnees_par_page.get(4) or {})
        except DonneesEmissionInvalides as exc:
            await db.rollback()
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        passeport.statut = StatutPasseport.EMIS

    await db.commit()
    return {"page_num": page_num, "statut_passeport": passeport.statut}


@router.get("/numerisations/{passeport_id}")
async def consulter_numerisations(
    passeport_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Pages transmises pour un passeport, AVEC les valeurs enregistrees.

    `donnees_json` etait auparavant omis : la route ne renvoyait que les
    statuts, si bien qu'aucune interface ne pouvait relire ce qui avait ete
    saisi sur le terrain -- les donnees etaient bien en base, mais invisibles.
    C'est le manque signale par l'agent (« enregistrer pour consultation »).

    Un controle d'acces est ajoute en meme temps : la route renvoyant desormais
    des donnees nominatives (eleveur, convoyeur, numeros de CNI), elle exige un
    compte authentifie du MEME pays que le passeport.
    """
    passeport = await db.get(Passeport, passeport_id)
    if passeport is None:
        raise HTTPException(status_code=404, detail="Passeport introuvable.")
    require_same_country_or_super_admin(passeport.pays_id, current_user)

    result = await db.execute(
        select(Numerisation)
        .where(Numerisation.passeport_id == passeport_id)
        .order_by(Numerisation.page_num)
    )
    numerisations = result.scalars().all()
    return {
        "passeport_id": passeport_id,
        "numero": f"{passeport.numero_pays}-{passeport.numero_annee}-{passeport.numero_lot}",
        "statut_passeport": passeport.statut,
        "pages": [
            {
                "page_num": n.page_num,
                "statut_validation": n.statut_validation,
                "statut_sync": n.statut_sync,
                "donnees_json": n.donnees_json or {},
                "enregistre_le": n.cree_le.isoformat() if n.cree_le else None,
            }
            for n in numerisations
        ],
    }


@router.get("/passeports/cache-emission", dependencies=[Depends(require_roles(Role.AGENT_EMISSION))])
async def cache_emission(
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Liste des numéros préchargés pour usage hors-ligne (PWA / IndexedDB côté client)."""
    result = await db.execute(
        select(Passeport).where(
            Passeport.pays_id == current_user.pays_id, Passeport.statut == StatutPasseport.VIERGE
        )
    )
    return [{"id": p.id, "qr_uuid": p.qr_uuid, "numero": f"{p.numero_pays}-{p.numero_annee}-{p.numero_lot}"} for p in result.scalars().all()]


@router.post(
    "/ocr/lire-champ",
    dependencies=[Depends(require_roles(Role.AGENT_EMISSION))],
)
async def lire_champ_ocr(photo: UploadFile = File(...)):
    """Lecture BRUTE d'une petite image déjà recadrée côté client (voir
    mobile/src/lib/ocrCloud.ts) — combine le positionnement précis déjà
    construit côté application (gabarit fixe + homographie par marqueurs de
    coin + affinage couleur) avec la qualité de lecture de Google Vision
    sur de l'écriture manuscrite, nettement supérieure à un moteur local
    (Tesseract).

    Volontairement SANS passeport_id ni page_num, contrairement à
    .../ocr ci-dessus : cette route ne fait AUCUNE recherche de libellé
    (voir extraire_champs_page3/4) — le client a déjà isolé le bon champ
    avant l'envoi, il ne reste qu'à renvoyer le texte reconnu tel quel. Pas
    d'archivage de l'image ici non plus : ce n'est qu'un petit fragment
    d'un champ, sans valeur d'audit à lui seul (contrairement à la photo
    complète d'une page, voir .../ocr)."""
    contenu = await photo.read()
    if not contenu:
        raise HTTPException(status_code=422, detail="Image vide.")

    try:
        mots = await appeler_google_vision(contenu)
    except OcrIndisponible as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    # Les mots sont déjà triés par Google Vision dans l'ordre de lecture
    # naturel — un simple tri par position horizontale (comme pour la
    # lecture locale) suffit à les rassembler dans le bon ordre pour un
    # champ à une seule ligne.
    mots_tries = sorted(mots, key=lambda m: m["x_min"])
    texte = " ".join(m["texte"] for m in mots_tries)
    return {"texte": texte}


@router.post(
    "/numerisations/{passeport_id}/pages/{page_num}/ocr",
    dependencies=[Depends(require_roles(Role.AGENT_EMISSION))],
)
async def reconnaitre_page_ocr(
    passeport_id: str,
    page_num: int,
    photo: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Reconnaissance automatique (OCR) d'une page 3 ou 4 photographiée —
    renvoie des CHAMPS SUGGÉRÉS pour pré-remplir le formulaire de saisie,
    jamais une validation directe : l'agent revoit et corrige chaque champ
    avant de valider la page (voir POST .../pages/{page_num} ci-dessus, un
    appel séparé et obligatoire). Si `GOOGLE_VISION_SERVICE_ACCOUNT_JSON_B64` n'est pas
    configurée ou que l'appel échoue, répond 503 plutôt qu'une erreur
    opaque — le frontend retombe alors sur le formulaire vierge, jamais
    bloqué par cette fonctionnalité optionnelle."""
    if page_num not in (3, 4):
        raise HTTPException(status_code=422, detail="OCR disponible uniquement pour les pages 3 et 4.")

    passeport = await db.get(Passeport, passeport_id)
    if passeport is None:
        raise HTTPException(status_code=404, detail="Passeport introuvable.")
    require_same_country_or_super_admin(passeport.pays_id, current_user)

    contenu = await photo.read()
    if not contenu:
        raise HTTPException(status_code=422, detail="Photo vide.")

    try:
        mots = await appeler_google_vision(contenu)
    except OcrIndisponible as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    champs = extraire_champs_page3(mots) if page_num == 3 else extraire_champs_page4(mots)

    db.add(
        PhotoOcr(
            passeport_id=passeport_id,
            page_num=page_num,
            image_bytes=contenu,
            image_content_type=photo.content_type or "image/jpeg",
            resultat_ocr_brut={"mots": mots},
            agent_id=current_user.id,
        )
    )
    await db.commit()

    # `mots` (liste brute, coordonnées PIXEL de la photo envoyée) est
    # renvoyé EN PLUS de `champs` (déjà interprété par ancrage de libellé
    # imprimé) — l'application mobile dispose de son propre système de
    # positionnement (marqueurs de coin + homographie, voir
    # mobile/src/lib/homographie.ts), plus précis qu'un ancrage sur texte
    # imprimé reconnu par Google Vision lui-même : elle peut ainsi combiner
    # SA position (fiable, déjà éprouvée) avec la LECTURE de Google Vision
    # (bien supérieure à un moteur local sur de l'écriture manuscrite),
    # plutôt que de dépendre de la mise en page devinée par l'ancrage.
    # `champs` reste renvoyé pour un usage sans position connue (aucun
    # marqueur détecté sur la photo, carnet imprimé avant leur ajout au
    # gabarit).
    return {"champs": champs, "mots": mots}
