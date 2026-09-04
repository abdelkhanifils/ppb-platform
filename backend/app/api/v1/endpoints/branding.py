"""
Module Personnalisation — identité visuelle de la plateforme, PAR ZONE (nom,
couleurs, logo, icône PWA/favicon, cachet). Trois zones indépendantes (voir
app.models.branding.ZONES_VALIDES pour le détail de chacune) : "global"
(reste du tableau de bord web), "emission" (écrans d'émission mobile) et
"controle" (écran de contrôle frontière, partagé web + mobile).

Lecture PUBLIQUE, sans authentification : la page de connexion, le favicon
et le manifest PWA doivent s'afficher correctement avant même qu'un
utilisateur soit connecté — aucune donnée sensible n'y transite (uniquement
de l'apparence). Écriture réservée au Super Admin.
"""
import json

from fastapi import APIRouter, Depends, HTTPException, Request, Response, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import CurrentUser, get_current_user, require_roles
from app.core.rbac import Role
from app.db.session import get_db
from app.models.branding import ID_BRANDING_GLOBAL, ZONES_VALIDES, Branding
from app.schemas.branding import BrandingOut, BrandingUpdate
from app.services.audit import journaliser

router = APIRouter(prefix="/branding", tags=["Module Personnalisation"])

_TYPES_IMAGE_AUTORISES = {"image/png", "image/jpeg", "image/webp", "image/svg+xml", "image/x-icon"}
_TAILLE_MAX_IMAGE_OCTETS = 3 * 1024 * 1024  # 3 Mo — largement suffisant pour un logo/icône, évite de gonfler la base


def _valider_zone(zone: str) -> str:
    if zone not in ZONES_VALIDES:
        raise HTTPException(status_code=422, detail=f"Zone de personnalisation inconnue : {zone!r}.")
    return zone


async def _get_ou_creer(db: AsyncSession, zone: str) -> Branding:
    """La ligne d'une zone est créée à la première ÉCRITURE plutôt que par
    une migration de données séparée — plus simple, et cohérent avec le fait
    que ses valeurs par défaut (couleurs, nom) sont déjà celles du produit
    actuel : tant que personne ne personnalise rien pour cette zone, son
    comportement en LECTURE reste identique à "global" (voir
    _get_avec_repli, jamais cette fonction-ci pour un GET)."""
    branding = await db.get(Branding, zone)
    if branding is None:
        branding = Branding(id=zone)
        db.add(branding)
        await db.commit()
        await db.refresh(branding)
    return branding


async def _get_avec_repli(db: AsyncSession, zone: str) -> Branding:
    """Lecture d'une zone — si "emission" ou "controle" n'a jamais été
    personnalisée (ligne absente), retombe entièrement sur "global" plutôt
    que de créer une ligne vide : c'est ce qui permet à une zone non encore
    personnalisée d'hériter silencieusement de l'apparence par défaut, sans
    qu'un Super Admin ait à dupliquer quoi que ce soit avant de personnaliser
    une seule zone à la fois."""
    if zone == ID_BRANDING_GLOBAL:
        return await _get_ou_creer(db, ID_BRANDING_GLOBAL)
    branding = await db.get(Branding, zone)
    if branding is not None:
        return branding
    return await _get_ou_creer(db, ID_BRANDING_GLOBAL)


def _vers_out(b: Branding) -> BrandingOut:
    return BrandingOut(
        nom_application=b.nom_application,
        couleur_primaire=b.couleur_primaire,
        couleur_primaire_claire=b.couleur_primaire_claire,
        a_logo=b.logo_bytes is not None,
        a_icone=b.icone_bytes is not None,
        a_cachet=b.cachet_bytes is not None,
        version=b.version,
        zone=b.id,
    )


@router.get("", response_model=BrandingOut)
async def obtenir_branding(zone: str = ID_BRANDING_GLOBAL, db: AsyncSession = Depends(get_db)) -> BrandingOut:
    _valider_zone(zone)
    b = await _get_avec_repli(db, zone)
    return _vers_out(b)


@router.get("/logo")
async def obtenir_logo(zone: str = ID_BRANDING_GLOBAL, db: AsyncSession = Depends(get_db)):
    _valider_zone(zone)
    b = await _get_avec_repli(db, zone)
    if b.logo_bytes is None:
        raise HTTPException(status_code=404, detail="Aucun logo configuré.")
    return Response(content=b.logo_bytes, media_type=b.logo_content_type or "image/png")


@router.get("/icone")
async def obtenir_icone(zone: str = ID_BRANDING_GLOBAL, db: AsyncSession = Depends(get_db)):
    _valider_zone(zone)
    b = await _get_avec_repli(db, zone)
    if b.icone_bytes is None:
        raise HTTPException(status_code=404, detail="Aucune icône configurée.")
    return Response(content=b.icone_bytes, media_type=b.icone_content_type or "image/png")


@router.get("/cachet")
async def obtenir_cachet(zone: str = ID_BRANDING_GLOBAL, db: AsyncSession = Depends(get_db)):
    """Public, comme /logo et /icone ci-dessus (voir docstring de module) —
    utilisé par le backend lui-même lors de la génération des PDF (passeport
    et facture, toujours zone "global" pour ces deux documents — le cachet
    officiel de la CEBEVIRHA n'a pas de raison de varier par zone d'écran)."""
    _valider_zone(zone)
    b = await _get_avec_repli(db, zone)
    if b.cachet_bytes is None:
        raise HTTPException(status_code=404, detail="Aucun cachet configuré.")
    return Response(content=b.cachet_bytes, media_type=b.cachet_content_type or "image/png")


@router.get("/manifest.webmanifest")
async def obtenir_manifest(request: Request, zone: str = ID_BRANDING_GLOBAL, db: AsyncSession = Depends(get_db)):
    """Web App Manifest généré dynamiquement — l'icône PWA (« Ajouter à
    l'écran d'accueil ») change donc immédiatement quand le Super Admin la
    remplace, sans reconstruction ni redéploiement du frontend. URLs
    d'icône absolues (nécessaire : ce manifest est consommé par les deux
    apps front — Web Admin et application mobile terrain — potentiellement
    sur des origines différentes de celle de ce backend)."""
    _valider_zone(zone)
    b = await _get_avec_repli(db, zone)
    base = str(request.base_url).rstrip("/")
    icone_url = f"{base}/api/v1/branding/icone?v={b.version}&zone={zone}"
    manifest = {
        "name": b.nom_application,
        "short_name": b.nom_application[:30],
        "start_url": "/",
        "display": "standalone",
        "background_color": "#ffffff",
        "theme_color": b.couleur_primaire,
        "icons": (
            [{"src": icone_url, "sizes": "192x192 512x512", "type": b.icone_content_type or "image/png", "purpose": "any maskable"}]
            if b.icone_bytes is not None
            else []
        ),
    }
    return Response(content=json.dumps(manifest), media_type="application/manifest+json")


@router.patch("", response_model=BrandingOut, dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def modifier_branding(
    payload: BrandingUpdate,
    zone: str = ID_BRANDING_GLOBAL,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BrandingOut:
    _valider_zone(zone)
    b = await _get_ou_creer(db, zone)
    ancienne_valeur = {
        "nom_application": b.nom_application,
        "couleur_primaire": b.couleur_primaire,
        "couleur_primaire_claire": b.couleur_primaire_claire,
    }
    donnees = payload.model_dump(exclude_unset=True)
    for champ, valeur in donnees.items():
        setattr(b, champ, valeur)
    if donnees:
        b.version += 1
    await db.flush()

    await journaliser(
        db,
        utilisateur_id=current_user.id,
        action="branding.modifie",
        entite="Branding",
        entite_id=b.id,
        ancienne_valeur=ancienne_valeur,
        nouvelle_valeur=donnees,
    )
    await db.commit()
    await db.refresh(b)
    return _vers_out(b)


async def _remplacer_image(
    db: AsyncSession,
    current_user: CurrentUser,
    zone: str,
    fichier: UploadFile,
    champ_bytes: str,
    champ_type: str,
    action_audit: str,
) -> Branding:
    if fichier.content_type not in _TYPES_IMAGE_AUTORISES:
        raise HTTPException(
            status_code=422,
            detail=f"Format d'image non pris en charge ({fichier.content_type}). Formats acceptés : PNG, JPEG, WEBP, SVG.",
        )
    contenu = await fichier.read()
    if not contenu:
        raise HTTPException(status_code=422, detail="Fichier vide.")
    if len(contenu) > _TAILLE_MAX_IMAGE_OCTETS:
        raise HTTPException(status_code=422, detail="Fichier trop volumineux (3 Mo maximum).")

    b = await _get_ou_creer(db, zone)
    setattr(b, champ_bytes, contenu)
    setattr(b, champ_type, fichier.content_type)
    b.version += 1
    await db.flush()

    await journaliser(
        db,
        utilisateur_id=current_user.id,
        action=action_audit,
        entite="Branding",
        entite_id=b.id,
        nouvelle_valeur={"content_type": fichier.content_type, "taille_octets": len(contenu)},
    )
    await db.commit()
    await db.refresh(b)
    return b


@router.post("/logo", response_model=BrandingOut, dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def remplacer_logo(
    fichier: UploadFile,
    zone: str = ID_BRANDING_GLOBAL,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BrandingOut:
    _valider_zone(zone)
    b = await _remplacer_image(db, current_user, zone, fichier, "logo_bytes", "logo_content_type", "branding.logo_remplace")
    return _vers_out(b)


@router.post("/icone", response_model=BrandingOut, dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def remplacer_icone(
    fichier: UploadFile,
    zone: str = ID_BRANDING_GLOBAL,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BrandingOut:
    """Icône PWA / favicon — carrée recommandée, 512×512 idéalement (le
    manifest déclare 192×192 et 512×512 en s'appuyant sur la même image ;
    les navigateurs la redimensionnent, mais une source haute résolution
    évite un rendu flou une fois l'app installée)."""
    _valider_zone(zone)
    b = await _remplacer_image(db, current_user, zone, fichier, "icone_bytes", "icone_content_type", "branding.icone_remplacee")
    return _vers_out(b)


@router.post("/cachet", response_model=BrandingOut, dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def remplacer_cachet(
    fichier: UploadFile,
    zone: str = ID_BRANDING_GLOBAL,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BrandingOut:
    """Image du cachet + signature scannés — apposée automatiquement en bas
    de la première page de chaque PPB généré et en bas de chaque facture
    (voir app.services.pdf_passeport et app.services.pdf_facture, toujours
    zone "global"). Fond transparent (PNG) recommandé pour un rendu propre
    sur le document."""
    _valider_zone(zone)
    b = await _remplacer_image(db, current_user, zone, fichier, "cachet_bytes", "cachet_content_type", "branding.cachet_remplace")
    return _vers_out(b)
