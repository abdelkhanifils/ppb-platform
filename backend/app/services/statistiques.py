"""Agrégations statistiques portables (SQL standard, aucune dépendance
PostGIS) pour le tableau de bord régional — Document technique, Module
transversal Statistiques. Tournent identiquement sur PostgreSQL (production)
et SQLite (tests) ; pour les agrégations géospatiales (clustering, GeoJSON),
voir app/services/geospatial.py, explicitement PostGIS."""
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import case, extract, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.commande import Commande
from app.models.controle import Controle
from app.models.itineraire import Itineraire
from app.models.paiement import Paiement, StatutPaiement
from app.models.passeport import Passeport, StatutPasseport
from app.models.pays import Pays
from app.models.poste import Poste


def bornes_periode(debut: date | None, fin: date | None) -> tuple[datetime | None, datetime | None]:
    """Période en jours INCLUSIFS -> bornes [début, fin+1j[ (comparées à des colonnes datetime)."""
    d = datetime.combine(debut, time.min, tzinfo=timezone.utc) if debut else None
    f = datetime.combine(fin + timedelta(days=1), time.min, tzinfo=timezone.utc) if fin else None
    return d, f


def filtre_dates(query, colonne_date, debut: date | None, fin: date | None):
    """Restreint `colonne_date` à l'intervalle [debut, fin] (jours inclus) quand il est fourni."""
    d, f = bornes_periode(debut, fin)
    if d is not None:
        query = query.where(colonne_date >= d)
    if f is not None:
        query = query.where(colonne_date < f)
    return query


def _filtre_periode(query, colonne_date, annee: int | None, mois: int | None, debut: date | None = None, fin: date | None = None):
    query = filtre_dates(query, colonne_date, debut, fin)
    if annee is not None:
        query = query.where(extract("year", colonne_date) == annee)
    if mois is not None:
        query = query.where(extract("month", colonne_date) == mois)
    return query


def _premiers_controles():
    """Identifiants des PREMIERS contrôles de chaque passeport : un passeport est comptabilisé UNE
    seule fois, à son premier scan (les scans suivants ne changent ni le total ni la répartition).
    Ainsi : contrôlés = validés + à vérifier + refusés, chacun étant le résultat du premier scan."""
    rang = func.row_number().over(partition_by=Controle.passeport_id, order_by=(Controle.cree_le, Controle.id)).label("rang")
    sous = select(Controle.id.label("id"), rang).subquery()
    return select(sous.c.id).where(sous.c.rang == 1)


async def _cumuls_passeports(
    db: AsyncSession, pays_id: int | None = None, annee: int | None = None, mois: int | None = None,
    debut: date | None = None, fin: date | None = None,
) -> dict[tuple[int, int], dict[str, int]]:
    """Étapes ATTEINTES par les passeports, par (pays, année du numéro) — comptées de façon
    CUMULATIVE et sans double compte :

    - ``precharge``  : passeports disponibles = attribués (tous).
    - ``vierge``     : imprimés = impression CONFIRMÉE (``imprime_le`` renseigné), rien d'autre.
    - ``emis``       : émis sur le terrain = un itinéraire a été numérisé (le statut ``emis`` est
                       écrasé par ``controle`` dès le premier contrôle : compter le statut seul
                       faisait « disparaître » des émissions au fil des contrôles).
    - ``controle``   : passeports contrôlés, comptés UNE fois au premier scan (un passeport scanné
                       plusieurs fois compte une fois) = validés + à vérifier + refusés.
    - ``revoque``    : passeports révoqués.

    Filtre ``mois`` (1-12) / ``annee`` : appliqué à la date de l'évènement (attribution, émission,
    premier contrôle)."""
    cumuls: dict[tuple[int, int], dict[str, int]] = {}

    def _c(pid: int, an: str) -> dict[str, int]:
        return cumuls.setdefault((pid, int(an)), {"precharge": 0, "vierge": 0, "emis": 0, "controle": 0, "revoque": 0})

    def _filtre(q, colonne_date):
        q = filtre_dates(q, colonne_date, debut, fin)
        if annee is not None:
            q = q.where(extract("year", colonne_date) == annee)
        if mois is not None:
            q = q.where(extract("month", colonne_date) == mois)
        return q

    q = select(
        Passeport.pays_id,
        Passeport.numero_annee,
        func.count(Passeport.id),
        func.sum(case((Passeport.imprime_le.is_not(None), 1), else_=0)),  # imprimés = impression confirmée uniquement
        func.sum(case((Passeport.statut == StatutPasseport.REVOQUE, 1), else_=0)),
    ).group_by(Passeport.pays_id, Passeport.numero_annee)
    if pays_id is not None:
        q = q.where(Passeport.pays_id == pays_id)
    q = _filtre(q, Passeport.cree_le)
    for pid, an, total, imprimes, revoques in (await db.execute(q)).all():
        c = _c(pid, an)
        c["precharge"], c["vierge"], c["revoque"] = int(total), int(imprimes or 0), int(revoques or 0)

    q = (
        select(Passeport.pays_id, Passeport.numero_annee, func.count(func.distinct(Passeport.id)))
        .select_from(Passeport)
        .join(Itineraire, Itineraire.passeport_id == Passeport.id)
        .group_by(Passeport.pays_id, Passeport.numero_annee)
    )
    if pays_id is not None:
        q = q.where(Passeport.pays_id == pays_id)
    q = _filtre(q, Itineraire.cree_le)
    for pid, an, nb in (await db.execute(q)).all():
        _c(pid, an)["emis"] = int(nb)

    # « Contrôlés » = passeports distincts, comptés au PREMIER scan : égale validés + à vérifier + refusés
    # (résultat du premier scan de chaque passeport).
    q = (
        select(Passeport.pays_id, Passeport.numero_annee, func.count(Controle.id))
        .select_from(Controle)
        .join(Passeport, Passeport.id == Controle.passeport_id)
        .where(Controle.id.in_(_premiers_controles()))
        .group_by(Passeport.pays_id, Passeport.numero_annee)
    )
    if pays_id is not None:
        q = q.where(Passeport.pays_id == pays_id)
    q = _filtre(q, Controle.cree_le)
    for pid, an, nb in (await db.execute(q)).all():
        _c(pid, an)["controle"] = int(nb)
    return cumuls


def _somme_cumuls(cumuls: dict[tuple[int, int], dict[str, int]], pays_id: int) -> dict[str, int]:
    total = {"precharge": 0, "vierge": 0, "emis": 0, "controle": 0, "revoque": 0}
    for (pid, _annee), c in cumuls.items():
        if pid == pays_id:
            for k, v in c.items():
                total[k] += v
    return total


async def agreger_par_pays(db: AsyncSession, pays_id: int | None = None, debut: date | None = None, fin: date | None = None) -> list[dict]:
    """Un pays -> ses volumes à chaque étape du pipeline (Commande, Paiement,
    Passeports par statut, Contrôles par résultat) — la vue de premier niveau
    du tableau de bord régional. `pays_id` restreint à un seul pays — utilisé
    pour qu'un Admin National ne voie que sa propre ligne (voir
    app.api.v1.endpoints.statistiques, qui impose cette restriction, jamais
    laissée au choix de l'appelant)."""
    query = select(Pays).order_by(Pays.ordre_alpha)
    if pays_id is not None:
        query = query.where(Pays.id == pays_id)
    result = await db.execute(query)
    sortie = []
    cumuls_tous = await _cumuls_passeports(db, pays_id=pays_id, debut=debut, fin=fin)

    for pays in result.scalars().all():
        nb_commandes = (
            await db.execute(filtre_dates(select(func.count(Commande.id)).where(Commande.pays_id == pays.id), Commande.cree_le, debut, fin))
        ).scalar_one()

        montant_encaisse = (
            await db.execute(
                filtre_dates(
                    select(func.coalesce(func.sum(Paiement.montant), 0))
                    .select_from(Paiement)
                    .join(Commande, Paiement.commande_id == Commande.id)
                    .where(Commande.pays_id == pays.id, Paiement.statut == StatutPaiement.VALIDE),
                    Paiement.cree_le, debut, fin,
                )
            )
        ).scalar_one()

        result_statuts = await db.execute(
            filtre_dates(
                select(Passeport.statut, func.count(Passeport.id)).where(Passeport.pays_id == pays.id),
                Passeport.cree_le, debut, fin,
            ).group_by(Passeport.statut)
        )
        passeports_par_statut = {statut.value: nombre for statut, nombre in result_statuts.all()}

        result_controles = await db.execute(
            filtre_dates(
                select(Controle.resultat, func.count(Controle.id))
                .select_from(Controle)
                .join(Passeport, Controle.passeport_id == Passeport.id)
                .where(Passeport.pays_id == pays.id, Controle.id.in_(_premiers_controles())),
                Controle.cree_le, debut, fin,
            ).group_by(Controle.resultat)
        )
        controles_par_resultat = {resultat.value: nombre for resultat, nombre in result_controles.all()}

        sortie.append(
            {
                "pays_id": pays.id,
                "code_iso": pays.code_iso,
                "nom": pays.nom,
                "nb_commandes": nb_commandes,
                "montant_encaisse_xaf": float(montant_encaisse),
                "passeports_par_statut": passeports_par_statut,
                "passeports_cumules": _somme_cumuls(cumuls_tous, pays.id),
                "controles_par_resultat": controles_par_resultat,
            }
        )
    return sortie


async def agreger_par_phase(db: AsyncSession, pays_id: int | None = None, debut: date | None = None, fin: date | None = None) -> dict:
    """Entonnoir global du pipeline : combien de passeports ONT ATTEINT chaque étape (cumulatif,
    donc décroissant : attribués ≥ imprimés ≥ émis ≥ contrôlés), tous pays confondus ou pour un
    seul. Auparavant chaque passeport n'était compté que dans son statut ACTUEL : un passeport
    contrôlé disparaissait de « Émis », et les « Émis » baissaient à mesure que les contrôles
    avançaient."""
    cumuls = await _cumuls_passeports(db, pays_id=pays_id, debut=debut, fin=fin)
    total = {"precharge": 0, "vierge": 0, "emis": 0, "controle": 0, "revoque": 0}
    for c in cumuls.values():
        for k, v in c.items():
            total[k] += v
    # Étapes : disponibles (attribués) -> imprimés (impression CONFIRMÉE) -> émis -> contrôlés -> révoqués.
    ordre_pipeline = [s.value for s in StatutPasseport]
    return {"phases": [{"statut": s, "nombre": total.get(s, 0)} for s in ordre_pipeline]}


async def agreger_par_poste(db: AsyncSession, pays_id: int | None = None, debut: date | None = None, fin: date | None = None) -> list[dict]:
    """Un poste de contrôle -> ses volumes par résultat, avec ses coordonnées
    pour affichage cartographique (voir aussi app.services.geospatial pour le
    clustering PostGIS des points bruts).

    Inclut aussi les contrôles dont le `poste_id` (texte libre saisi par
    l'agent, voir frontend/src/pages/ControleFrontiere.tsx::SaisiePosteId)
    ne correspond à AUCUN poste du référentiel — bug corrigé ici : ces
    contrôles existent bien (visibles dans « Détail par pays et année »)
    mais disparaissaient silencieusement de cette vue faute de correspondance
    exacte avec un `Poste.code` connu. Ils apparaissent avec `poste_id: null`
    et un nom explicite, plutôt que d'être perdus."""
    query = select(Poste).where(Poste.actif.is_(True))
    if pays_id is not None:
        query = query.where(Poste.pays_id == pays_id)
    result = await db.execute(query)
    postes_connus = result.scalars().all()
    codes_connus = {p.code for p in postes_connus}
    sortie = []

    for poste in postes_connus:
        result_resultats = await db.execute(
            filtre_dates(select(Controle.resultat, func.count(Controle.id)).where(Controle.poste_id == poste.code, Controle.id.in_(_premiers_controles())), Controle.cree_le, debut, fin)
            .group_by(Controle.resultat)
        )
        par_resultat = {resultat.value: nombre for resultat, nombre in result_resultats.all()}
        sortie.append(
            {
                "poste_id": poste.id,
                "code": poste.code,
                "nom": poste.nom,
                "pays_id": poste.pays_id,
                "latitude": float(poste.latitude),
                "longitude": float(poste.longitude),
                "controles_par_resultat": par_resultat,
                "total_controles": sum(par_resultat.values()),
            }
        )

    # Regroupé par (poste_id_brut, pays_id RÉEL du passeport contrôlé) — pas
    # par le paramètre `pays_id` de filtre ci-dessus, qui vaut None lors
    # d'un appel non filtré (vue globale) : affecter `pays_id` à la valeur
    # de ce paramètre aurait mis `null` sur CHAQUE orphelin dans ce cas,
    # les faisant tous disparaître dès qu'un pays précis est ensuite
    # sélectionné côté interface (aucun ne correspondant plus). Le passeport
    # associé donne le pays réel, y compris sans filtre.
    query_orphelins = (
        select(Controle.poste_id, Passeport.pays_id, Controle.resultat, func.count(Controle.id))
        .select_from(Controle)
        .join(Passeport, Controle.passeport_id == Passeport.id)
    )
    if pays_id is not None:
        query_orphelins = query_orphelins.where(Passeport.pays_id == pays_id)
    if codes_connus:
        query_orphelins = query_orphelins.where(Controle.poste_id.notin_(codes_connus))
    query_orphelins = query_orphelins.where(Controle.id.in_(_premiers_controles()))
    query_orphelins = filtre_dates(query_orphelins, Controle.cree_le, debut, fin).group_by(Controle.poste_id, Passeport.pays_id, Controle.resultat)

    # Clé (poste_id_brut, pays_id) plutôt que poste_id_brut seul : un même
    # identifiant de poste saisi librement pourrait en théorie provenir de
    # passeports de deux pays différents — deux lignes distinctes dans ce
    # cas, jamais mélangées sous un seul pays arbitraire.
    par_poste_orphelin: dict[tuple[str, int], dict[str, int]] = {}
    for poste_id_brut, pays_id_reel, resultat, nombre in (await db.execute(query_orphelins)).all():
        par_poste_orphelin.setdefault((poste_id_brut, pays_id_reel), {})[resultat.value] = nombre

    for (poste_id_brut, pays_id_reel), par_resultat in par_poste_orphelin.items():
        sortie.append(
            {
                "poste_id": None,
                "code": poste_id_brut,
                "nom": f"{poste_id_brut} (non référencé)",
                "pays_id": pays_id_reel,
                "latitude": None,
                "longitude": None,
                "controles_par_resultat": par_resultat,
                "total_controles": sum(par_resultat.values()),
            }
        )

    return sorted(sortie, key=lambda p: p["total_controles"], reverse=True)


async def agreger_par_pays_et_annee(
    db: AsyncSession, pays_id: int | None = None, annee: int | None = None, mois: int | None = None,
    debut: date | None = None, fin: date | None = None,
) -> list[dict]:
    """Vue croisée pays x année — combine commandes, paiements validés (avec
    répartition par moyen : virement, espèces, chèque — le paiement en ligne
    a été retiré, voir README §« Réactiver CinetPay »), passeports (par
    statut : vierge/émis/contrôlé/révoqué — jamais agrégés en un seul total,
    pour distinguer un passeport simplement imprimé de celui réellement
    rempli sur le terrain) et contrôles (avec répartition par résultat).

    Deux sources d'« année » différentes, assumées : la date de création
    pour les commandes et paiements (aucune autre notion d'année n'existe
    pour eux), et `numero_annee` — l'année embarquée dans la numérotation du
    PPB — pour les passeports et contrôles. Les deux coïncident presque
    toujours en pratique (l'attribution qui fixe `numero_annee` se produit
    dans la même transaction que la validation du paiement), mais rien ne
    garantit une correspondance stricte si une commande est validée à
    cheval sur un changement d'année — accepté comme limite mineure plutôt
    que d'ajouter un champ redondant aux modèles.
    """
    lignes: dict[tuple[int, int], dict] = {}

    def _ligne(pid: int, annee: int) -> dict:
        return lignes.setdefault(
            (pid, annee),
            {
                "pays_id": pid,
                "annee": annee,
                "nb_commandes": 0,
                "montant_commandes_xaf": 0.0,
                "montant_encaisse_xaf": 0.0,
                "moyens_paiement": {},
                "passeports_par_statut": {},
                "passeports_cumules": {"precharge": 0, "vierge": 0, "emis": 0, "controle": 0, "revoque": 0},
                "nb_controles": 0,
                "controles_par_resultat": {},
            },
        )

    annee_commande = extract("year", Commande.cree_le)
    query_commandes = select(Commande.pays_id, annee_commande, func.count(Commande.id), func.coalesce(func.sum(Commande.montant_total), 0)).group_by(
        Commande.pays_id, annee_commande
    )
    if pays_id is not None:
        query_commandes = query_commandes.where(Commande.pays_id == pays_id)
    query_commandes = _filtre_periode(query_commandes, Commande.cree_le, annee, mois, debut, fin)
    for pid, annee, nb, montant in (await db.execute(query_commandes)).all():
        ligne = _ligne(pid, int(annee))
        ligne["nb_commandes"] = nb
        ligne["montant_commandes_xaf"] = float(montant)

    annee_paiement = extract("year", Paiement.cree_le)
    query_paiements = (
        select(Commande.pays_id, annee_paiement, Paiement.moyen, func.count(Paiement.id), func.coalesce(func.sum(Paiement.montant), 0))
        .select_from(Paiement)
        .join(Commande, Paiement.commande_id == Commande.id)
        .where(Paiement.statut == StatutPaiement.VALIDE)
        .group_by(Commande.pays_id, annee_paiement, Paiement.moyen)
    )
    if pays_id is not None:
        query_paiements = query_paiements.where(Commande.pays_id == pays_id)
    query_paiements = _filtre_periode(query_paiements, Paiement.cree_le, annee, mois, debut, fin)
    for pid, annee, moyen, nb, montant in (await db.execute(query_paiements)).all():
        ligne = _ligne(pid, int(annee))
        ligne["montant_encaisse_xaf"] += float(montant)
        ligne["moyens_paiement"][moyen.value] = ligne["moyens_paiement"].get(moyen.value, 0) + nb

    query_passeports = (
        select(Passeport.pays_id, Passeport.numero_annee, Passeport.statut, func.count(Passeport.id))
        .where(Passeport.statut != StatutPasseport.PRECHARGE)
        .group_by(Passeport.pays_id, Passeport.numero_annee, Passeport.statut)
    )
    if pays_id is not None:
        query_passeports = query_passeports.where(Passeport.pays_id == pays_id)
    query_passeports = _filtre_periode(query_passeports, Passeport.cree_le, annee, mois, debut, fin)
    for pid, annee_str, statut, nb in (await db.execute(query_passeports)).all():
        ligne = _ligne(pid, int(annee_str))
        # "vierge" = imprimé mais pas encore rempli sur le terrain ; "emis" =
        # rempli sur le terrain (Module 4) ; "controle"/"revoque" = passeport
        # dont le STATUT est passé à contrôlé/révoqué — à ne pas confondre
        # avec `nb_controles` ci-dessous, qui compte les ACTIONS de scan
        # (un même passeport peut être scanné plusieurs fois).
        ligne["passeports_par_statut"][statut.value] = ligne["passeports_par_statut"].get(statut.value, 0) + nb

    query_controles = (
        select(Passeport.pays_id, Passeport.numero_annee, Controle.resultat, func.count(Controle.id))
        .select_from(Controle)
        .join(Passeport, Controle.passeport_id == Passeport.id)
        .where(Controle.id.in_(_premiers_controles()))
        .group_by(Passeport.pays_id, Passeport.numero_annee, Controle.resultat)
    )
    if pays_id is not None:
        query_controles = query_controles.where(Passeport.pays_id == pays_id)
    query_controles = _filtre_periode(query_controles, Controle.cree_le, annee, mois, debut, fin)
    for pid, annee_str, resultat, nb in (await db.execute(query_controles)).all():
        ligne = _ligne(pid, int(annee_str))
        ligne["nb_controles"] += nb
        ligne["controles_par_resultat"][resultat.value] = ligne["controles_par_resultat"].get(resultat.value, 0) + nb

    for (pid, an), c in (await _cumuls_passeports(db, pays_id=pays_id, annee=annee, mois=mois, debut=debut, fin=fin)).items():
        _ligne(pid, an)["passeports_cumules"] = c

    resultat = [l for l in lignes.values() if annee is None or l["annee"] == annee]
    return sorted(resultat, key=lambda l: (l["pays_id"], -l["annee"]))


# --- Indicateurs d'effectifs du cheptel (vérifié à l'émission / contrôlé) ------------------

NON_DISPONIBLES = [
    {"code": "proprietaires_nationalite", "libelle": "Nombre de propriétaires par nationalité",
     "motif": "La nationalité du propriétaire n'est pas saisie (aucun champ correspondant sur le passeport papier)."},
    {"code": "convoyeurs_nationalite", "libelle": "Nombre de convoyeurs par nationalité",
     "motif": "La nationalité du convoyeur n'est pas saisie (aucun champ correspondant sur le passeport papier)."},
    {"code": "foyers_maladies", "libelle": "Foyers de maladies contagieuses identifiés, par type de maladie",
     "motif": "Aucune collecte de rapports sanitaires (foyers) n'existe encore dans la plateforme."},
    {"code": "morbidite", "libelle": "Cas de morbidité par type de maladie et par espèce",
     "motif": "Aucune collecte de rapports sanitaires (morbidité) n'existe encore dans la plateforme."},
    {"code": "mortalite", "libelle": "Cas de mortalité par type de maladie et par espèce",
     "motif": "Aucune collecte de rapports sanitaires (mortalité) n'existe encore dans la plateforme."},
    {"code": "traitements", "libelle": "Animaux ayant reçu un traitement clinique, par type de maladie et par espèce",
     "motif": "Seuls les vaccins sont enregistrés ; les traitements cliniques ne le sont pas."},
]


async def indicateurs_cheptel(
    db: AsyncSession, base: str = "emis", pays_id: int | None = None, annee: int | None = None, mois: int | None = None,
    debut: date | None = None, fin: date | None = None,
) -> dict:
    """Effectifs du cheptel par espèce, origine, destination et vaccinations.

    `base` : "emis" = troupeaux numérisés (vérifiés par l'agent d'émission) ;
    "controles" = troupeaux dont le passeport a été contrôlé au moins une
    fois à un poste frontière (compté une seule fois, même contrôlé plusieurs
    fois). `pays_id` filtre sur le pays émetteur du passeport (imposé à
    l'Admin National par l'endpoint). Les vaccinations sont enregistrées par
    troupeau : l'effectif « par espèce » est la composition du troupeau
    vacciné."""
    from app.models.itineraire import Itineraire
    from app.models.troupeau import Troupeau, TroupeauEspece
    from app.models.vaccination import Vaccination

    ids = select(Troupeau.id).join(Passeport, Passeport.id == Troupeau.passeport_id)
    if pays_id is not None:
        ids = ids.where(Passeport.pays_id == pays_id)
    if base == "controles":
        premier_ctrl = (
            select(Controle.passeport_id.label("pid"), func.min(Controle.cree_le).label("date_ref"))
            .group_by(Controle.passeport_id)
            .subquery()
        )
        ids = ids.join(premier_ctrl, premier_ctrl.c.pid == Troupeau.passeport_id)
        date_ref = premier_ctrl.c.date_ref
    else:
        date_ref = Troupeau.date_enregistrement
    # Filtres de période (année / mois) sur la date de référence : enregistrement du troupeau
    # (émission) ou premier contrôle du passeport (frontières).
    ids = filtre_dates(ids, date_ref, debut, fin)
    if annee is not None:
        ids = ids.where(extract("year", date_ref) == annee)
    if mois is not None:
        ids = ids.where(extract("month", date_ref) == mois)
    troupeaux_ids = ids.scalar_subquery()

    esp = (
        await db.execute(
            select(
                TroupeauEspece.espece,
                func.sum(TroupeauEspece.nombre_males),
                func.sum(TroupeauEspece.nombre_femelles_jeunes),
                func.sum(TroupeauEspece.nombre_femelles_adultes),
                func.sum(TroupeauEspece.nombre_total),
            )
            .where(TroupeauEspece.troupeau_id.in_(troupeaux_ids))
            .group_by(TroupeauEspece.espece)
            .order_by(func.sum(TroupeauEspece.nombre_total).desc())
        )
    ).all()
    par_espece = [
        {"espece": e, "males": int(m or 0), "femelles_jeunes": int(fj or 0), "femelles_adultes": int(fa or 0), "total": int(t or 0)}
        for e, m, fj, fa, t in esp
    ]

    # Effectif d'un passeport = somme de ses espèces ; rattaché à son itinéraire.
    eff_par_passeport = (
        select(Troupeau.passeport_id.label("pid"), func.sum(TroupeauEspece.nombre_total).label("eff"))
        .join(TroupeauEspece, TroupeauEspece.troupeau_id == Troupeau.id)
        .where(Troupeau.id.in_(troupeaux_ids))
        .group_by(Troupeau.passeport_id)
        .subquery()
    )

    async def _par_lieu(pays_fk, pays_autre, localite_col):
        pays_alias = Pays
        lignes = (
            await db.execute(
                select(pays_alias.nom, pays_autre, localite_col, func.count(), func.sum(eff_par_passeport.c.eff))
                .select_from(Itineraire)
                .join(eff_par_passeport, eff_par_passeport.c.pid == Itineraire.passeport_id)
                .join(pays_alias, pays_alias.id == pays_fk, isouter=True)
                .group_by(pays_alias.nom, pays_autre, localite_col)
            )
        ).all()
        sortie = []
        for nom, autre, loc, nb, eff in lignes:
            sortie.append({"pays": nom or autre or "Non renseigné", "localite": loc or "Non renseignée", "nb_passeports": int(nb), "effectif": int(eff or 0)})
        sortie.sort(key=lambda x: -x["effectif"])
        return sortie

    origine = await _par_lieu(Itineraire.pays_origine_id, Itineraire.pays_origine_autre, Itineraire.localite_origine)
    destination = await _par_lieu(Itineraire.pays_destination_id, Itineraire.pays_destination_autre, Itineraire.localite_destination)

    def _par_pays(lignes):
        agg: dict[str, dict] = {}
        for l in lignes:
            a = agg.setdefault(l["pays"], {"pays": l["pays"], "nb_passeports": 0, "effectif": 0})
            a["nb_passeports"] += l["nb_passeports"]
            a["effectif"] += l["effectif"]
        return sorted(agg.values(), key=lambda x: -x["effectif"])

    # Vaccinations : une ligne (troupeau, maladie) comptée une fois.
    vacc = (
        select(Vaccination.troupeau_id.label("tid"), Vaccination.maladie.label("maladie"))
        .where(Vaccination.troupeau_id.in_(troupeaux_ids))
        .distinct()
        .subquery()
    )
    vl = (
        await db.execute(
            select(vacc.c.maladie, TroupeauEspece.espece, func.sum(TroupeauEspece.nombre_total))
            .join(TroupeauEspece, TroupeauEspece.troupeau_id == vacc.c.tid)
            .group_by(vacc.c.maladie, TroupeauEspece.espece)
            .order_by(vacc.c.maladie, TroupeauEspece.espece)
        )
    ).all()
    vaccinations = [{"maladie": m, "espece": e, "effectif": int(n or 0)} for m, e, n in vl]

    return {
        "base": base,
        "total_cheptel": sum(x["total"] for x in par_espece),
        "par_espece": par_espece,
        "par_origine_pays": _par_pays(origine),
        "par_origine_localite": origine,
        "par_destination_pays": _par_pays(destination),
        "par_destination_localite": destination,
        "vaccinations": vaccinations,
        "non_disponibles": NON_DISPONIBLES,
    }


async def cheptel_par_pays_annee(
    db: AsyncSession,
    base: str = "emis",
    pays_id: int | None = None,
    annee: int | None = None,
    mois: int | None = None,
    debut: date | None = None,
    fin: date | None = None,
) -> list[dict]:
    """Effectifs du cheptel présentés comme les commandes : une ligne par pays émetteur, année et
    mois, avec le nombre de passeports, l'effectif total, l'effectif par espèce et l'effectif des
    animaux issus de troupeaux vaccinés.

    La date de référence est celle de l'enregistrement du troupeau (base « emis » : vérifié à
    l'émission) ou celle du PREMIER contrôle du passeport (base « controles » : contrôlé aux
    frontières, compté une seule fois). Les filtres ``annee`` / ``mois`` s'appliquent à cette date."""
    from app.models.troupeau import Troupeau, TroupeauEspece
    from app.models.vaccination import Vaccination

    if base == "controles":
        premier = (
            select(Controle.passeport_id.label("pid"), func.min(Controle.cree_le).label("date_ref"))
            .group_by(Controle.passeport_id)
            .subquery()
        )
        source = (
            select(
                Troupeau.id.label("tid"),
                Troupeau.passeport_id.label("pid"),
                Passeport.pays_id.label("pays_id"),
                premier.c.date_ref.label("date_ref"),
            )
            .select_from(Troupeau)
            .join(Passeport, Passeport.id == Troupeau.passeport_id)
            .join(premier, premier.c.pid == Troupeau.passeport_id)
        )
    else:
        source = (
            select(
                Troupeau.id.label("tid"),
                Troupeau.passeport_id.label("pid"),
                Passeport.pays_id.label("pays_id"),
                Troupeau.date_enregistrement.label("date_ref"),
            )
            .select_from(Troupeau)
            .join(Passeport, Passeport.id == Troupeau.passeport_id)
        )
    if pays_id is not None:
        source = source.where(Passeport.pays_id == pays_id)
    src = source.subquery()
    annee_col = extract("year", src.c.date_ref)
    mois_col = extract("month", src.c.date_ref)

    def _filtre(q):
        q = filtre_dates(q, src.c.date_ref, debut, fin)
        if annee is not None:
            q = q.where(annee_col == annee)
        if mois is not None:
            q = q.where(mois_col == mois)
        return q

    lignes: dict[tuple[int, int, int], dict] = {}

    def _ligne(pid: int, an, mo) -> dict:
        return lignes.setdefault(
            (pid, int(an), int(mo)),
            {"pays_id": pid, "annee": int(an), "mois": int(mo), "nb_passeports": 0, "total": 0, "par_espece": {}, "vaccines": 0},
        )

    q = _filtre(
        select(src.c.pays_id, annee_col, mois_col, TroupeauEspece.espece, func.sum(TroupeauEspece.nombre_total))
        .select_from(src)
        .join(TroupeauEspece, TroupeauEspece.troupeau_id == src.c.tid)
        .group_by(src.c.pays_id, annee_col, mois_col, TroupeauEspece.espece)
    )
    for pid, an, mo, espece, n in (await db.execute(q)).all():
        l = _ligne(pid, an, mo)
        l["par_espece"][espece] = l["par_espece"].get(espece, 0) + int(n or 0)
        l["total"] += int(n or 0)

    q = _filtre(select(src.c.pays_id, annee_col, mois_col, func.count(func.distinct(src.c.pid))).group_by(src.c.pays_id, annee_col, mois_col))
    for pid, an, mo, nb in (await db.execute(q)).all():
        _ligne(pid, an, mo)["nb_passeports"] = int(nb)

    vaccines = select(Vaccination.troupeau_id).distinct()
    q = _filtre(
        select(src.c.pays_id, annee_col, mois_col, func.sum(TroupeauEspece.nombre_total))
        .select_from(src)
        .join(TroupeauEspece, TroupeauEspece.troupeau_id == src.c.tid)
        .where(src.c.tid.in_(vaccines))
        .group_by(src.c.pays_id, annee_col, mois_col)
    )
    for pid, an, mo, n in (await db.execute(q)).all():
        _ligne(pid, an, mo)["vaccines"] = int(n or 0)

    return sorted(lignes.values(), key=lambda l: (l["pays_id"], -l["annee"], -l["mois"]))
