"""
Module Personnalisation — identité visuelle globale de la plateforme (nom,
couleurs, logo, icône PWA/favicon).

Lecture PUBLIQUE, sans authentification : la page de connexion, le favicon
et le manifest PWA doivent s'afficher correctement avant même qu'un
utilisateur soit connecté — aucune donnée sensible n'y transite (uniquement
de l'apparence). Écriture réservée au Super Admin (décision produit : une
seule identité pour toute la plateforme, jamais par pays — voir
app.models.branding).
"""
import json

from fastapi import APIRouter, Depends, HTTPException, Request, Response, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import CurrentUser, get_current_user, require_roles
from app.core.rbac import Role
from app.db.session import get_db
from app.models.branding import ID_BRANDING_GLOBAL, Branding
from app.schemas.branding import BrandingOut, BrandingUpdate
from app.services.audit import journaliser

router = APIRouter(prefix="/branding", tags=["Module Personnalisation"])

_TYPES_IMAGE_AUTORISES = {"image/png", "image/jpeg", "image/webp", "image/svg+xml", "image/x-icon"}
_TAILLE_MAX_IMAGE_OCTETS = 3 * 1024 * 1024  # 3 Mo — largement suffisant pour un logo/icône, évite de gonfler la base


async def _get_ou_creer(db: AsyncSession) -> Branding:
    """La ligne singleton est créée à la première lecture plutôt que par une
    migration de données séparée — plus simple, et cohérent avec le fait que
    ses valeurs par défaut (couleurs, nom) sont déjà celles du produit
    actuel : tant que personne ne personnalise rien, le comportement observé
    est strictement identique à avant ce module."""
    branding = await db.get(Branding, ID_BRANDING_GLOBAL)
    if branding is None:
        branding = Branding(id=ID_BRANDING_GLOBAL)
        db.add(branding)
        await db.commit()
        await db.refresh(branding)
    return branding


@router.get("", response_model=BrandingOut)
async def obtenir_branding(db: AsyncSession = Depends(get_db)) -> BrandingOut:
    b = await _get_ou_creer(db)
    return BrandingOut(
        nom_application=b.nom_application,
        couleur_primaire=b.couleur_primaire,
        couleur_primaire_claire=b.couleur_primaire_claire,
        a_logo=b.logo_bytes is not None,
        a_icone=b.icone_bytes is not None,
        version=b.version,
    )


@router.get("/logo")
async def obtenir_logo(db: AsyncSession = Depends(get_db)):
    b = await _get_ou_creer(db)
    if b.logo_bytes is None:
        raise HTTPException(status_code=404, detail="Aucun logo configuré.")
    return Response(content=b.logo_bytes, media_type=b.logo_content_type or "image/png")


@router.get("/icone")
async def obtenir_icone(db: AsyncSession = Depends(get_db)):
    b = await _get_ou_creer(db)
    if b.icone_bytes is None:
        raise HTTPException(status_code=404, detail="Aucune icône configurée.")
    return Response(content=b.icone_bytes, media_type=b.icone_content_type or "image/png")


@router.get("/manifest.webmanifest")
async def obtenir_manifest(request: Request, db: AsyncSession = Depends(get_db)):
    """Web App Manifest généré dynamiquement — l'icône PWA (« Ajouter à
    l'écran d'accueil ») change donc immédiatement quand le Super Admin la
    remplace, sans reconstruction ni redéploiement du frontend. URLs
    d'icône absolues (nécessaire : ce manifest est consommé par les deux
    apps front — Web Admin et application mobile terrain — potentiellement
    sur des origines différentes de celle de ce backend)."""
    b = await _get_ou_creer(db)
    base = str(request.base_url).rstrip("/")
    icone_url = f"{base}/api/v1/branding/icone?v={b.version}"
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
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BrandingOut:
    b = await _get_ou_creer(db)
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
    return BrandingOut(
        nom_application=b.nom_application,
        couleur_primaire=b.couleur_primaire,
        couleur_primaire_claire=b.couleur_primaire_claire,
        a_logo=b.logo_bytes is not None,
        a_icone=b.icone_bytes is not None,
        version=b.version,
    )


async def _remplacer_image(
    db: AsyncSession,
    current_user: CurrentUser,
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

    b = await _get_ou_creer(db)
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
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BrandingOut:
    b = await _remplacer_image(db, current_user, fichier, "logo_bytes", "logo_content_type", "branding.logo_remplace")
    return BrandingOut(
        nom_application=b.nom_application,
        couleur_primaire=b.couleur_primaire,
        couleur_primaire_claire=b.couleur_primaire_claire,
        a_logo=True,
        a_icone=b.icone_bytes is not None,
        version=b.version,
    )


@router.post("/icone", response_model=BrandingOut, dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def remplacer_icone(
    fichier: UploadFile,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BrandingOut:
    """Icône PWA / favicon — carrée recommandée, 512×512 idéalement (le
    manifest déclare 192×192 et 512×512 en s'appuyant sur la même image ;
    les navigateurs la redimensionnent, mais une source haute résolution
    évite un rendu flou une fois l'app installée)."""
    b = await _remplacer_image(db, current_user, fichier, "icone_bytes", "icone_content_type", "branding.icone_remplacee")
    return BrandingOut(
        nom_application=b.nom_application,
        couleur_primaire=b.couleur_primaire,
        couleur_primaire_claire=b.couleur_primaire_claire,
        a_logo=b.logo_bytes is not None,
        a_icone=True,
        version=b.version,
    )
