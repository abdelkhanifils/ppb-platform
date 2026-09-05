"""
Détail d'un passeport émis — éleveur, convoyeur (identité + CNI + téléphone),
composition du troupeau par espèce, vaccinations.

Ces données sont personnelles (CNI, téléphone) : ce module n'est consommé que
par des endpoints réservés à Super Admin et Admin National (jamais Agent de
contrôle ni Consultation) — voir app/api/v1/endpoints/passeports.py,
`GET /passeports/{id}/detail` et `GET /passeports/emissions-detail`, tous
deux cloisonnés par pays comme le reste de la plateforme (Admin National
limité au sien, Super Admin sans restriction).

Logique d'enrichissement reprise de
app.api.v1.endpoints.controles._enrichir_avec_emission (Module 5), qui sert
un besoin voisin mais structuré autour d'un Itineraire déjà sérialisé ; ce
module part directement d'un Passeport pour rester réutilisable par un
export ou une liste, sans dépendre du Module 5.
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.convoyeur import Convoyeur
from app.models.eleveur import Eleveur
from app.models.itineraire import Itineraire
from app.models.passeport import Passeport
from app.models.troupeau import Troupeau, TroupeauEspece
from app.models.vaccination import Vaccination


def _serialiser_personne(personne: Eleveur | Convoyeur | None) -> dict | None:
    if personne is None:
        return None
    return {"nom_prenom": personne.nom_prenom, "numero_cni": personne.numero_cni, "telephone": personne.telephone}


async def detail_emission(db: AsyncSession, passeport: Passeport) -> dict:
    """Toutes les données saisies sur le terrain (Module 4) pour ce
    passeport, quel que soit leur degré d'avancement : un passeport dont
    seule la page 3 a été transmise aura un éleveur/convoyeur mais aucun
    troupeau — comportement attendu, jamais une erreur (voir docstring de
    `_enrichir_avec_emission`, Module 5, pour le même principe)."""
    eleveur = (await db.execute(select(Eleveur).where(Eleveur.passeport_id == passeport.id))).scalar_one_or_none()
    convoyeur = (await db.execute(select(Convoyeur).where(Convoyeur.passeport_id == passeport.id))).scalar_one_or_none()
    troupeau = (await db.execute(select(Troupeau).where(Troupeau.passeport_id == passeport.id))).scalar_one_or_none()
    itineraire = (await db.execute(select(Itineraire).where(Itineraire.passeport_id == passeport.id))).scalar_one_or_none()

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
            {
                "maladie": v.maladie,
                "date_vaccination": str(v.date_vaccination) if v.date_vaccination else None,
                "lieu": v.lieu,
                "valide": v.valide_par_veterinaire_id is not None,
            }
            for v in result_vaccinations.scalars().all()
        ]

    return {
        "id": passeport.id,
        "numero": f"{passeport.numero_pays}-{passeport.numero_annee}-{passeport.numero_lot}",
        "statut": passeport.statut,
        "pays_id": passeport.pays_id,
        "eleveur": _serialiser_personne(eleveur),
        "convoyeur": _serialiser_personne(convoyeur),
        "itineraire": (
            {
                "pays_origine_id": itineraire.pays_origine_id,
                "pays_origine_autre": itineraire.pays_origine_autre,
                "province_origine": itineraire.province_origine,
                "localite_origine": itineraire.localite_origine,
                "pays_destination_id": itineraire.pays_destination_id,
                "pays_destination_autre": itineraire.pays_destination_autre,
                "province_destination": itineraire.province_destination,
                "localite_destination": itineraire.localite_destination,
            }
            if itineraire
            else None
        ),
        "especes": especes,
        "nombre_total_animaux": sum(e["nombre_total"] for e in especes),
        "vaccinations": vaccinations,
    }
