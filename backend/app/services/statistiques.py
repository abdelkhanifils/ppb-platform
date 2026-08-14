"""Agrégations statistiques portables (SQL standard, aucune dépendance
PostGIS) pour le tableau de bord régional — Document technique, Module
transversal Statistiques. Tournent identiquement sur PostgreSQL (production)
et SQLite (tests) ; pour les agrégations géospatiales (clustering, GeoJSON),
voir app/services/geospatial.py, explicitement PostGIS."""
from sqlalchemy import func, select
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
    clustering PostGIS des points bruts)."""
    query = select(Poste).where(Poste.actif.is_(True))
    if pays_id is not None:
        query = query.where(Poste.pays_id == pays_id)
    result = await db.execute(query)
    sortie = []

    for poste in result.scalars().all():
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
    return sorted(sortie, key=lambda p: p["total_controles"], reverse=True)
