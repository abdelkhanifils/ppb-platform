"""Agrégations statistiques portables (SQL standard, aucune dépendance
PostGIS) pour le tableau de bord régional — Document technique, Module
transversal Statistiques. Tournent identiquement sur PostgreSQL (production)
et SQLite (tests) ; pour les agrégations géospatiales (clustering, GeoJSON),
voir app/services/geospatial.py, explicitement PostGIS."""
from sqlalchemy import extract, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.commande import Commande
from app.models.controle import Controle
from app.models.paiement import Paiement, StatutPaiement
from app.models.passeport import Passeport, StatutPasseport
from app.models.pays import Pays
from app.models.poste import Poste


async def agreger_par_pays(db: AsyncSession, pays_id: int | None = None) -> list[dict]:
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

    for pays in result.scalars().all():
        nb_commandes = (
            await db.execute(select(func.count(Commande.id)).where(Commande.pays_id == pays.id))
        ).scalar_one()

        montant_encaisse = (
            await db.execute(
                select(func.coalesce(func.sum(Paiement.montant), 0))
                .select_from(Paiement)
                .join(Commande, Paiement.commande_id == Commande.id)
                .where(Commande.pays_id == pays.id, Paiement.statut == StatutPaiement.VALIDE)
            )
        ).scalar_one()

        result_statuts = await db.execute(
            select(Passeport.statut, func.count(Passeport.id))
            .where(Passeport.pays_id == pays.id)
            .group_by(Passeport.statut)
        )
        passeports_par_statut = {statut.value: nombre for statut, nombre in result_statuts.all()}

        result_controles = await db.execute(
            select(Controle.resultat, func.count(Controle.id))
            .select_from(Controle)
            .join(Passeport, Controle.passeport_id == Passeport.id)
            .where(Passeport.pays_id == pays.id)
            .group_by(Controle.resultat)
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
                "controles_par_resultat": controles_par_resultat,
            }
        )
    return sortie


async def agreger_par_phase(db: AsyncSession, pays_id: int | None = None) -> dict:
    """Entonnoir global du pipeline M3->M5 : combien de passeports à chaque
    phase, dans l'ordre du cycle de vie (pas l'ordre alphabétique — plus
    lisible pour un entonnoir), tous pays confondus ou pour un seul."""
    query = select(Passeport.statut, func.count(Passeport.id)).group_by(Passeport.statut)
    if pays_id is not None:
        query = query.where(Passeport.pays_id == pays_id)
    result = await db.execute(query)
    par_statut = {statut.value: nombre for statut, nombre in result.all()}

    ordre_pipeline = [s.value for s in StatutPasseport]
    return {"phases": [{"statut": s, "nombre": par_statut.get(s, 0)} for s in ordre_pipeline]}


async def agreger_par_poste(db: AsyncSession, pays_id: int | None = None) -> list[dict]:
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
            select(Controle.resultat, func.count(Controle.id))
            .where(Controle.poste_id == poste.code)
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
    query_orphelins = query_orphelins.group_by(Controle.poste_id, Passeport.pays_id, Controle.resultat)

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


async def agreger_par_pays_et_annee(db: AsyncSession, pays_id: int | None = None) -> list[dict]:
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
        .group_by(Passeport.pays_id, Passeport.numero_annee, Controle.resultat)
    )
    if pays_id is not None:
        query_controles = query_controles.where(Passeport.pays_id == pays_id)
    for pid, annee_str, resultat, nb in (await db.execute(query_controles)).all():
        ligne = _ligne(pid, int(annee_str))
        ligne["nb_controles"] += nb
        ligne["controles_par_resultat"][resultat.value] = ligne["controles_par_resultat"].get(resultat.value, 0) + nb

    return sorted(lignes.values(), key=lambda l: (l["pays_id"], -l["annee"]))


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


async def indicateurs_cheptel(db: AsyncSession, base: str = "emis", pays_id: int | None = None) -> dict:
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
        ids = ids.where(Troupeau.passeport_id.in_(select(Controle.passeport_id)))
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
