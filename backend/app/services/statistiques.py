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


async def agreger_par_pays(db: AsyncSession) -> list[dict]:
    """Un pays -> ses volumes à chaque étape du pipeline (Commande, Paiement,
    Passeports par statut, Contrôles par résultat) — la vue de premier niveau
    du tableau de bord régional."""
    result = await db.execute(select(Pays).order_by(Pays.ordre_alpha))
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

    query_orphelins = select(Controle.poste_id, Controle.resultat, func.count(Controle.id)).select_from(Controle)
    if pays_id is not None:
        query_orphelins = query_orphelins.join(Passeport, Controle.passeport_id == Passeport.id).where(Passeport.pays_id == pays_id)
    if codes_connus:
        query_orphelins = query_orphelins.where(Controle.poste_id.notin_(codes_connus))
    query_orphelins = query_orphelins.group_by(Controle.poste_id, Controle.resultat)

    par_poste_orphelin: dict[str, dict[str, int]] = {}
    for poste_id_brut, resultat, nombre in (await db.execute(query_orphelins)).all():
        par_poste_orphelin.setdefault(poste_id_brut, {})[resultat.value] = nombre

    for poste_id_brut, par_resultat in par_poste_orphelin.items():
        sortie.append(
            {
                "poste_id": None,
                "code": poste_id_brut,
                "nom": f"{poste_id_brut} (non référencé)",
                "pays_id": pays_id,
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
