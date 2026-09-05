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

TROIS ENSEIGNEMENTS DU TERRAIN sont intégrés ici, après un blocage total de
l'enregistrement (« erreur 500 » sur la page 4, la seule page qui écrit
réellement en base, donc la seule à pouvoir échouer) :

1. TYPES. `Vaccination.date_vaccination` est une colonne SQL `Date`. Le client
   transmet légitimement du JSON, donc une CHAÎNE (« 2026-08-19 ») : le pilote
   PostgreSQL refuse strictement une chaîne pour une colonne Date et lève une
   erreur au moment du commit. La conversion est donc faite ici, au seul
   endroit qui connaît à la fois la forme reçue et la forme attendue.

2. CLÉS ÉTRANGÈRES. Un `pays_origine_id` inconnu de la table `pays` produit une
   violation de contrainte, c'est-à-dire une erreur 500 opaque au bout d'une
   chaîne d'appels. On vérifie donc en amont et on lève une erreur NOMMÉE, que
   l'appelant traduit en 422 lisible : l'agent doit pouvoir corriger sa saisie,
   pas deviner.

3. IDEMPOTENCE RÉELLE. Le garde-fou `statut != EMIS` de l'appelant ne suffit
   pas dans tous les cas (un passeport rouvert en administration, une émission
   rejouée depuis un autre appareil) : `Eleveur.passeport_id` et
   `Troupeau.passeport_id` étant UNIQUE, une seconde création lèverait une
   violation d'unicité. On vérifie donc l'existence avant d'insérer.
"""
from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.convoyeur import Convoyeur
from app.models.eleveur import Eleveur
from app.models.itineraire import Itineraire
from app.models.pays import Pays
from app.models.troupeau import Troupeau, TroupeauEspece
from app.models.vaccination import Vaccination


class DonneesEmissionInvalides(Exception):
    """Donnée de page 3/4 inexploitable — à traduire en 422 par l'appelant.

    Distinguer ce cas d'une véritable panne serveur est essentiel : une saisie
    incomplète est corrigeable par l'agent, une panne ne l'est pas. Les
    confondre dans un même 500 rendait l'application muette sur la seule
    information utile.
    """


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


def _convertir_date(valeur: object) -> date | None:
    """Chaîne JSON → objet date, en tolérant les formes réellement rencontrées.

    Une date absente est un cas MÉTIER normal (vaccination non pratiquée) et ne
    doit jamais faire échouer l'émission : on renvoie None. Une date
    syntaxiquement inexploitable est traitée de même — perdre une date de
    vaccination est regrettable, perdre l'émission entière du passeport le
    serait bien davantage.
    """
    if valeur is None or valeur == "":
        return None
    if isinstance(valeur, datetime):
        return valeur.date()
    if isinstance(valeur, date):
        return valeur
    if isinstance(valeur, str):
        texte = valeur.strip()
        if not texte:
            return None
        # `date.fromisoformat` n'accepte pas un horodatage complet avant
        # Python 3.11 : on tronque à la partie date, seule information utile.
        try:
            return date.fromisoformat(texte[:10])
        except ValueError:
            return None
    return None


def _entier(valeur: object) -> int:
    """Effectif → entier positif. Le formulaire peut renvoyer une chaîne."""
    try:
        nombre = int(valeur)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0
    return max(0, nombre)


async def _identifiants_pays(db: AsyncSession) -> set[int]:
    result = await db.execute(select(Pays.id))
    return {identifiant for (identifiant,) in result.all()}


async def _existe(db: AsyncSession, modele, passeport_id: str) -> bool:
    result = await db.execute(select(modele.id).where(modele.passeport_id == passeport_id))
    return result.scalar_one_or_none() is not None


async def creer_entites_page3(db: AsyncSession, passeport_id: str, donnees_json: dict) -> Itineraire | None:
    """Éleveur, Convoyeur et Itinéraire déclaré — à partir du payload de la page 3
    (voir frontend/src/types/emission.ts::DonneesPage3, qui doit rester le
    miroir exact de ce que cette fonction attend).

    Renvoie None si les entités existaient déjà : le rejeu est un cas normal sur
    un réseau intermittent, pas une anomalie.
    """
    donnees_json = donnees_json or {}

    if not await _existe(db, Eleveur, passeport_id):
        db.add(Eleveur(passeport_id=passeport_id, **_extraire_donnees_personne(donnees_json.get("eleveur") or {})))
    if not await _existe(db, Convoyeur, passeport_id):
        db.add(Convoyeur(passeport_id=passeport_id, **_extraire_donnees_personne(donnees_json.get("convoyeur") or {})))

    if await _existe(db, Itineraire, passeport_id):
        return None

    itineraire_data = donnees_json.get("itineraire") or {}
    pays_connus = await _identifiants_pays(db)

    origine = itineraire_data.get("pays_origine_id")
    origine_autre = (itineraire_data.get("pays_origine_autre") or "").strip() or None
    destination = itineraire_data.get("pays_destination_id")
    destination_autre = (itineraire_data.get("pays_destination_autre") or "").strip() or None
    for libelle, valeur, valeur_autre in (
        ("pays d'origine", origine, origine_autre),
        ("pays de destination", destination, destination_autre),
    ):
        # Exactement l'un des deux — jamais les deux (saisie incohérente côté
        # client), jamais aucun des deux (page 3 pas transmise). Un pays
        # hors CEMAC (Nigeria, Soudan...) n'a pas d'identifiant dans le
        # référentiel Pays — voir la docstring d'Itineraire — d'où ce champ
        # de saisie libre en alternative, jamais en complément.
        if valeur is None and valeur_autre is None:
            raise DonneesEmissionInvalides(
                f"Page 3 : le {libelle} n'a pas été transmis. Rouvrez la page 3 et sélectionnez-le."
            )
        if valeur is not None and valeur_autre is not None:
            raise DonneesEmissionInvalides(
                f"Page 3 : le {libelle} a été transmis à la fois comme pays connu et comme saisie libre — "
                "un seul des deux est attendu. Rouvrez la page 3 et corrigez la sélection."
            )
        if valeur is not None and valeur not in pays_connus:
            raise DonneesEmissionInvalides(
                f"Page 3 : le {libelle} transmis (identifiant {valeur}) est inconnu du référentiel "
                f"de la plateforme (identifiants connus : {sorted(pays_connus) or 'aucun — référentiel non amorcé'})."
            )

    itineraire = Itineraire(
        passeport_id=passeport_id,
        pays_origine_id=origine,
        pays_origine_autre=origine_autre,
        province_origine=itineraire_data.get("province_origine") or "",
        localite_origine=itineraire_data.get("localite_origine"),
        pays_destination_id=destination,
        pays_destination_autre=destination_autre,
        province_destination=itineraire_data.get("province_destination") or "",
        localite_destination=itineraire_data.get("localite_destination"),
        synchronise_vers_controle=True,
        publie_le=datetime.now(timezone.utc),
    )
    db.add(itineraire)
    return itineraire


async def creer_entites_page4(db: AsyncSession, passeport_id: str, donnees_json: dict) -> Troupeau | None:
    """Troupeau (+ TroupeauEspece par espèce) et Vaccinations — à partir du
    payload de la page 4 (voir frontend/src/types/emission.ts::DonneesPage4).

    Renvoie None si le troupeau existait déjà (rejeu).
    """
    donnees_json = donnees_json or {}

    if await _existe(db, Troupeau, passeport_id):
        return None

    troupeau = Troupeau(passeport_id=passeport_id)
    db.add(troupeau)
    await db.flush()  # obtient troupeau.id, requis par les lignes filles ci-dessous

    for espece in donnees_json.get("especes") or []:
        if not isinstance(espece, dict):
            continue
        males = _entier(espece.get("nombre_males"))
        jeunes = _entier(espece.get("nombre_femelles_jeunes"))
        adultes = _entier(espece.get("nombre_femelles_adultes"))
        total = _entier(espece.get("nombre_total")) or (males + jeunes + adultes)
        # Une espèce entièrement à zéro n'est pas une donnée : le formulaire
        # présente les quatre espèces du gabarit, l'agent n'en remplit qu'une
        # partie. Les conserver toutes encombrerait les statistiques de lignes
        # vides indiscernables d'un troupeau réellement nul.
        if males + jeunes + adultes + total == 0:
            continue
        db.add(
            TroupeauEspece(
                troupeau_id=troupeau.id,
                espece=str(espece.get("espece") or "autre"),
                nombre_males=males,
                nombre_femelles_jeunes=jeunes,
                nombre_femelles_adultes=adultes,
                nombre_total=total,
            )
        )

    for vaccination in donnees_json.get("vaccinations") or []:
        if not isinstance(vaccination, dict):
            continue
        date_vaccination = _convertir_date(vaccination.get("date_vaccination"))
        lieu = vaccination.get("lieu") or None
        # Une maladie sans date ni lieu signifie « non vaccinée » : l'enregistrer
        # laisserait croire à une vaccination dont on aurait perdu la date.
        if date_vaccination is None and not lieu:
            continue
        db.add(
            Vaccination(
                troupeau_id=troupeau.id,
                maladie=str(vaccination.get("maladie") or ""),
                date_vaccination=date_vaccination,
                lieu=lieu,
            )
        )

    return troupeau