"""
Module Réinitialisation — remise à zéro des données TRANSACTIONNELLES
(commandes, paiements, passeports, émissions, contrôles), pour repartir
d'une plateforme vide avant une démonstration à un partenaire, ou le jour
du passage en exploitation réelle.

Ce que ceci supprime : Commande, Paiement, Passeport (et tout ce qui s'y
rattache — Itineraire, Eleveur, Convoyeur, Troupeau, TroupeauEspece,
Vaccination, Controle, Numerisation, PhotoOcr), AutorisationImpression,
Notification. Les compteurs de numérotation des passeports sont remis à
zéro pour chaque pays, pour que la numérotation reparte proprement de
001 plutôt que de continuer après les numéros déjà utilisés en test.

Ce que ceci NE touche JAMAIS : Utilisateur (y compris les comptes créés en
test — un nettoyage de comptes se fait à la main, Administration >
Utilisateurs, jamais en masse ici, pour ne jamais risquer de supprimer un
compte encore nécessaire), Pays, Poste, Parametre, TexteGabarit, Branding,
DefinitionFormulaire/DefinitionChamp, PisteAudit (l'historique existant
reste consultable ; l'exécution de CETTE réinitialisation elle-même y est
journalisée comme un nouvel évènement, jamais effacée).

Réservé Super Admin. Deux garde-fous avant toute suppression réelle :
1. Un aperçu (GET /apercu) donne les volumes exacts qui seraient supprimés,
   à consulter avant de se décider.
2. L'exécution (POST /executer) exige une phrase de confirmation saisie
   EXACTEMENT par l'appelant (voir PHRASE_CONFIRMATION) — jamais un simple
   bouton "oui", pour qu'une action aussi irréversible ne puisse jamais
   partir d'un clic accidentel.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import CurrentUser, get_current_user, require_roles
from app.core.rbac import Role
from app.db.session import get_db
from app.models.autorisation_impression import AutorisationImpression
from app.models.commande import Commande
from app.models.controle import Controle
from app.models.convoyeur import Convoyeur
from app.models.eleveur import Eleveur
from app.models.itineraire import Itineraire
from app.models.notification import Notification
from app.models.numerisation import Numerisation
from app.models.paiement import Paiement
from app.models.passeport import CompteurNumerotation, Passeport
from app.models.photo_ocr import PhotoOcr
from app.models.troupeau import Troupeau, TroupeauEspece
from app.models.vaccination import Vaccination
from app.services.audit import journaliser

router = APIRouter(
    prefix="/reinitialisation",
    tags=["Module Réinitialisation"],
    dependencies=[Depends(require_roles(Role.SUPER_ADMIN))],
)

PHRASE_CONFIRMATION = "SUPPRIMER LES DONNEES DE TEST"


class ApercuReinitialisation(BaseModel):
    commandes: int
    paiements: int
    passeports: int
    controles: int
    notifications: int
    autorisations_impression: int


class ExecuterReinitialisationRequest(BaseModel):
    confirmation: str


@router.get("/apercu", response_model=ApercuReinitialisation)
async def apercu_reinitialisation(db: AsyncSession = Depends(get_db)) -> ApercuReinitialisation:
    """Lecture seule — aucune suppression. Les tables enfant (Itineraire,
    Eleveur, Convoyeur, Troupeau, Vaccination, Numerisation, PhotoOcr) ne
    sont pas comptées séparément : elles suivent numériquement les
    Passeports (au plus une ligne par passeport pour la plupart), déjà
    visibles dans ce total."""
    async def _compter(modele) -> int:
        return (await db.execute(select(func.count()).select_from(modele))).scalar_one()

    return ApercuReinitialisation(
        commandes=await _compter(Commande),
        paiements=await _compter(Paiement),
        passeports=await _compter(Passeport),
        controles=await _compter(Controle),
        notifications=await _compter(Notification),
        autorisations_impression=await _compter(AutorisationImpression),
    )


@router.post("/executer")
async def executer_reinitialisation(
    payload: ExecuterReinitialisationRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if payload.confirmation.strip() != PHRASE_CONFIRMATION:
        raise HTTPException(
            status_code=422,
            detail=f"Phrase de confirmation incorrecte. Saisissez exactement : {PHRASE_CONFIRMATION}",
        )

    apercu = await apercu_reinitialisation(db)

    # Ordre strict enfant -> parent, pour respecter les clés étrangères —
    # jamais de CASCADE configuré au niveau des modèles (choix délibéré
    # ailleurs dans la plateforme, pour qu'aucune suppression ne se propage
    # sans être explicitement listée ici).
    for modele in (
        Vaccination,
        TroupeauEspece,
        Troupeau,
        Controle,
        Numerisation,
        PhotoOcr,
        Itineraire,
        Eleveur,
        Convoyeur,
        Notification,
        Paiement,
        Passeport,
        AutorisationImpression,
        Commande,
    ):
        await db.execute(delete(modele))

    # Numérotation des passeports remise à zéro pour chaque pays — sans
    # cela, la prochaine commande reprendrait après les numéros déjà
    # utilisés en test plutôt que de repartir de 001.
    await db.execute(delete(CompteurNumerotation))

    # Journalisée en dernier, après les suppressions : PisteAudit n'est
    # jamais vidée par cette action (voir la docstring de module), donc cet
    # évènement reste le premier de la nouvelle période d'exploitation,
    # juste après tout l'historique de test précédent.
    await journaliser(
        db,
        utilisateur_id=current_user.id,
        action="plateforme.reinitialisee",
        entite="Plateforme",
        entite_id="globale",
        ancienne_valeur=apercu.model_dump(),
    )
    await db.commit()
    return {"statut": "reinitialisee", "supprime": apercu.model_dump()}
