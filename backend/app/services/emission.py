"""
Création des entités métier à partir des numérisations validées — Module 4
(Document technique §3, M4, pages 3 et 4).

Appelé une seule fois par passeport, exactement quand les 4 pages ont été
validées (voir app/api/v1/endpoints/numerisations.py, qui garde ce point
d'entrée idempotent en ne l'invoquant que si `Passeport.statut` n'est pas
déjà EMIS). Aucune de ces fonctions ne committe — l'appelant le fait dans
la même transaction que le passage au statut EMIS.

Itineraire : « déclaré oralement par l'éleveur ou le convoyeur à l'agent
d'émission » (Document de conception PPB) — publié immédiatement vers
l'index de vérification du Module 5 au moment de sa création, exactement
comme l'attribution des passeports publie vers ce même index (voir
app.services.attribution.publier_passeports). C'est cette publication qui
alimente la synchronisation différentielle de l'application de contrôle.
"""
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.convoyeur import Convoyeur
from app.models.eleveur import Eleveur
from app.models.itineraire import Itineraire
from app.models.troupeau import Troupeau, TroupeauEspece
from app.models.vaccination import Vaccination


def _extraire_donnees_personne(donnees: dict) -> dict:
    """Ne retient que les champs structurels connus + les champs dynamiques non
    vides — une valeur `None` explicite dans donnees_dynamiques (champ laissé
    vide par l'agent) ne doit jamais écraser silencieusement une valeur par
    défaut côté base."""
    return {
        "nom_prenom": donnees.get("nom_prenom") or "",
        "numero_cni": donnees.get("numero_cni") or "",
        "telephone": donnees.get("telephone"),
        "donnees_dynamiques": {k: v for k, v in (donnees.get("donnees_dynamiques") or {}).items() if v is not None},
    }


async def creer_entites_page3(db: AsyncSession, passeport_id: str, donnees_json: dict) -> Itineraire:
    """Éleveur, Convoyeur et Itinéraire déclaré — à partir du payload de la page 3
    (voir frontend/src/types/emission.ts::DonneesPage3, qui doit rester le
    miroir exact de ce que cette fonction attend)."""
    donnees_json = donnees_json or {}

    db.add(Eleveur(passeport_id=passeport_id, **_extraire_donnees_personne(donnees_json.get("eleveur") or {})))
    db.add(Convoyeur(passeport_id=passeport_id, **_extraire_donnees_personne(donnees_json.get("convoyeur") or {})))

    itineraire_data = donnees_json.get("itineraire") or {}
    itineraire = Itineraire(
        passeport_id=passeport_id,
        pays_origine_id=itineraire_data["pays_origine_id"],
        province_origine=itineraire_data.get("province_origine") or "",
        localite_origine=itineraire_data.get("localite_origine"),
        pays_destination_id=itineraire_data["pays_destination_id"],
        province_destination=itineraire_data.get("province_destination") or "",
        localite_destination=itineraire_data.get("localite_destination"),
        synchronise_vers_controle=True,
        publie_le=datetime.now(timezone.utc),
    )
    db.add(itineraire)
    return itineraire


async def creer_entites_page4(db: AsyncSession, passeport_id: str, donnees_json: dict) -> Troupeau:
    """Troupeau (+ TroupeauEspece par espèce) et Vaccinations — à partir du
    payload de la page 4 (voir frontend/src/types/emission.ts::DonneesPage4)."""
    donnees_json = donnees_json or {}

    troupeau = Troupeau(passeport_id=passeport_id)
    db.add(troupeau)
    await db.flush()  # obtient troupeau.id, requis par les lignes filles ci-dessous

    for espece in donnees_json.get("especes") or []:
        db.add(
            TroupeauEspece(
                troupeau_id=troupeau.id,
                espece=espece.get("espece", "autre"),
                nombre_males=espece.get("nombre_males", 0),
                nombre_femelles_jeunes=espece.get("nombre_femelles_jeunes", 0),
                nombre_femelles_adultes=espece.get("nombre_femelles_adultes", 0),
                nombre_total=espece.get("nombre_total", 0),
            )
        )

    for vaccination in donnees_json.get("vaccinations") or []:
        db.add(
            Vaccination(
                troupeau_id=troupeau.id,
                maladie=vaccination.get("maladie", ""),
                date_vaccination=vaccination.get("date_vaccination"),
                lieu=vaccination.get("lieu"),
            )
        )

    return troupeau
