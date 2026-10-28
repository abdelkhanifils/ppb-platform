"""
Espace Comptabilité — synthèse financière, paiements et factures par période.

Réservé aux profils à vue financière GLOBALE (tous pays), les mêmes que ceux
visés par `require_same_country_or_finance` : Super Admin, Comptabilité et
Gestionnaire CEBEVIRHA. Un Admin National n'y accède pas : il garde sa vue
limitée à son pays via l'écran Paiements existant.

Trois usages :
- `/synthese` : chiffres du tableau de bord (paiements en attente, commandes
  payées / non payées, encaissé), éventuellement bornés à une période ;
- `/periode` : la liste détaillée des paiements d'une période, avec leur
  commande et le pays, pour l'affichage à l'écran ;
- `/export` et `/factures-zip` : les mêmes données à télécharger (Excel ou
  CSV ; archive ZIP des factures PDF).

La période (`debut`, `fin`, bornes incluses) s'applique à la date de création
de chaque enregistrement. Les paiements EN ATTENTE ne sont volontairement pas
bornés par la période : c'est un travail à faire, il doit rester visible
quelle que soit sa date.
"""
import csv
import io
import zipfile
from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import CurrentUser, get_current_user, require_permission
from app.core.rbac import Role
from app.db.session import get_db
from app.models.branding import ID_BRANDING_GLOBAL, Branding
from app.models.commande import Commande, StatutCommande
from app.models.paiement import Paiement, StatutPaiement
from app.models.pays import Pays
from app.services.audit import journaliser
from app.services.export_excel import _ecrire_feuille
from app.services.parametres import obtenir_parametre
from app.services.pdf_facture import generer_facture_pdf

router = APIRouter(
    prefix="/comptabilite",
    tags=["Comptabilité"],
    dependencies=[Depends(require_permission("comptabilite.consulter"))],
)

MAX_FACTURES_ZIP = 300


def _bornes(debut: date | None, fin: date | None) -> tuple[datetime | None, datetime | None]:
    """Convertit une période en jours (inclusifs) en bornes [debut, fin+1j[."""
    if debut and fin and debut > fin:
        raise HTTPException(status_code=422, detail="La date de début doit précéder la date de fin.")
    d = datetime.combine(debut, time.min, tzinfo=timezone.utc) if debut else None
    f = datetime.combine(fin + timedelta(days=1), time.min, tzinfo=timezone.utc) if fin else None
    return d, f


def _condition_periode(colonne, d: datetime | None, f: datetime | None):
    conds = []
    if d is not None:
        conds.append(colonne >= d)
    if f is not None:
        conds.append(colonne < f)
    return and_(*conds) if conds else None


def _ajouter(query, cond):
    return query.where(cond) if cond is not None else query


@router.get("/synthese")
async def synthese(
    debut: date | None = None,
    fin: date | None = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    d, f = _bornes(debut, fin)
    noms = {p.id: p.nom for p in (await db.execute(select(Pays))).scalars().all()}

    # Paiements en attente de validation — file de travail, non bornée.
    attente_rows = (
        await db.execute(
            select(Paiement, Commande)
            .join(Commande, Commande.id == Paiement.commande_id)
            .where(Paiement.statut == StatutPaiement.EN_ATTENTE_VALIDATION)
            .order_by(Paiement.cree_le.asc())
        )
    ).all()
    en_attente = {
        "nombre": len(attente_rows),
        "montant": float(sum(p.montant for p, _ in attente_rows)),
        "paiements": [
            {
                "id": p.id,
                "commande_id": p.commande_id,
                "reference": p.commande_id[:8],
                "pays": noms.get(c.pays_id, f"Pays #{c.pays_id}"),
                "montant": float(p.montant),
                "devise": p.devise,
                "moyen": p.moyen.value,
                "cree_le": p.cree_le,
            }
            for p, c in attente_rows[:10]
        ],
    }

    # Commandes payées / non payées, sur la période (date de création).
    cond_cmd = _condition_periode(Commande.cree_le, d, f)
    q_cmd = _ajouter(
        select(Commande.pays_id, Commande.statut, func.count(Commande.id), func.coalesce(func.sum(Commande.montant_total), 0))
        .where(Commande.statut.in_([StatutCommande.PAYEE, StatutCommande.EN_ATTENTE_PAIEMENT]))
        .group_by(Commande.pays_id, Commande.statut),
        cond_cmd,
    )
    par_pays: dict[int, dict] = {}
    tot = {"payees": [0, 0.0], "non_payees": [0, 0.0]}
    for pays_id, statut, nb, montant in (await db.execute(q_cmd)).all():
        cle = "payees" if statut == StatutCommande.PAYEE else "non_payees"
        tot[cle][0] += nb
        tot[cle][1] += float(montant)
        ligne = par_pays.setdefault(pays_id, {"pays": noms.get(pays_id, f"Pays #{pays_id}"), "nb_payees": 0, "montant_payees": 0.0, "nb_non_payees": 0, "montant_non_payees": 0.0})
        ligne["nb_" + cle] += nb
        ligne["montant_" + cle] += float(montant)

    # Encaissé = paiements validés sur la période.
    q_enc = _ajouter(
        select(func.count(Paiement.id), func.coalesce(func.sum(Paiement.montant), 0)).where(Paiement.statut == StatutPaiement.VALIDE),
        _condition_periode(Paiement.cree_le, d, f),
    )
    nb_enc, montant_enc = (await db.execute(q_enc)).one()

    return {
        "periode": {"debut": debut, "fin": fin},
        "en_attente": en_attente,
        "commandes_payees": {"nombre": tot["payees"][0], "montant": tot["payees"][1]},
        "commandes_non_payees": {"nombre": tot["non_payees"][0], "montant": tot["non_payees"][1]},
        "montant_total_commandes": tot["payees"][1] + tot["non_payees"][1],
        "encaisse": {"nombre": nb_enc, "montant": float(montant_enc)},
        "par_pays": sorted(par_pays.values(), key=lambda x: x["pays"]),
        "devise": "XAF",
    }


async def _lignes_periode(db: AsyncSession, debut: date | None, fin: date | None, statut: StatutPaiement | None) -> list[dict]:
    d, f = _bornes(debut, fin)
    noms = {p.id: p.nom for p in (await db.execute(select(Pays))).scalars().all()}
    query = (
        select(Paiement, Commande)
        .join(Commande, Commande.id == Paiement.commande_id)
        .order_by(Paiement.cree_le.desc())
    )
    query = _ajouter(query, _condition_periode(Paiement.cree_le, d, f))
    if statut is not None:
        query = query.where(Paiement.statut == statut)
    lignes = []
    for p, c in (await db.execute(query)).all():
        lignes.append(
            {
                "paiement_id": p.id,
                "commande_id": c.id,
                "reference": c.id[:8],
                "pays": noms.get(c.pays_id, f"Pays #{c.pays_id}"),
                "quantite": c.quantite,
                "montant": float(p.montant),
                "devise": p.devise,
                "moyen": p.moyen.value,
                "statut_paiement": p.statut.value,
                "montant_commande": float(c.montant_total),
                "statut_commande": c.statut.value,
                "facture_definitive": c.statut == StatutCommande.PAYEE,
                "cree_le": p.cree_le,
            }
        )
    return lignes


@router.get("/periode")
async def paiements_periode(
    debut: date | None = None,
    fin: date | None = None,
    statut: StatutPaiement | None = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    lignes = await _lignes_periode(db, debut, fin, statut)
    return {
        "lignes": lignes,
        "total": len(lignes),
        "montant_valide": sum(l["montant"] for l in lignes if l["statut_paiement"] == "valide"),
        "montant_en_attente": sum(l["montant"] for l in lignes if l["statut_paiement"] == "en_attente_validation"),
    }


_ENTETES = ["Date", "Référence commande", "Pays", "Quantité", "Montant du paiement", "Devise", "Moyen", "Statut du paiement", "Montant de la commande", "Statut de la commande"]


def _ligne_tableau(l: dict) -> list:
    return [l["cree_le"].strftime("%Y-%m-%d %H:%M"), l["reference"], l["pays"], l["quantite"], l["montant"], l["devise"], l["moyen"], l["statut_paiement"], l["montant_commande"], l["statut_commande"]]


def _nom_periode(debut: date | None, fin: date | None) -> str:
    return f"{debut or 'debut'}_{fin or 'fin'}"


@router.get("/export")
async def exporter_paiements(
    debut: date | None = None,
    fin: date | None = None,
    statut: StatutPaiement | None = None,
    format: str = Query("xlsx", pattern="^(xlsx|csv)$"),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    lignes = await _lignes_periode(db, debut, fin, statut)
    nom = f"paiements-ppb_{_nom_periode(debut, fin)}"
    if format == "csv":
        tampon = io.StringIO()
        writer = csv.writer(tampon, delimiter=";")
        writer.writerow(_ENTETES)
        for l in lignes:
            writer.writerow(_ligne_tableau(l))
        contenu = ("﻿" + tampon.getvalue()).encode("utf-8")  # BOM : Excel lit correctement les accents
        media, ext = "text/csv; charset=utf-8", "csv"
    else:
        from openpyxl import Workbook

        classeur = Workbook()
        classeur.remove(classeur.active)
        _ecrire_feuille(classeur, "Paiements", _ENTETES, [_ligne_tableau(l) for l in lignes])
        sortie = io.BytesIO()
        classeur.save(sortie)
        contenu = sortie.getvalue()
        media, ext = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"
    await journaliser(db, utilisateur_id=current_user.id, action="comptabilite.export_paiements", entite="Paiement", entite_id="periode", nouvelle_valeur={"debut": str(debut), "fin": str(fin), "statut": statut.value if statut else None, "format": format, "lignes": len(lignes)})
    await db.commit()
    return Response(content=contenu, media_type=media, headers={"Content-Disposition": f'attachment; filename="{nom}.{ext}"'})


@router.get("/factures-zip")
async def telecharger_factures_zip(
    debut: date | None = None,
    fin: date | None = None,
    statut: StatutPaiement | None = None,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Archive ZIP des factures PDF des commandes ayant un paiement sur la
    période (une facture par commande, même si plusieurs paiements)."""
    lignes = await _lignes_periode(db, debut, fin, statut)
    ids = list(dict.fromkeys(l["commande_id"] for l in lignes))
    if not ids:
        raise HTTPException(status_code=404, detail="Aucune facture sur cette période.")
    if len(ids) > MAX_FACTURES_ZIP:
        raise HTTPException(status_code=413, detail=f"Trop de factures ({len(ids)}) — réduisez la période (maximum {MAX_FACTURES_ZIP}).")
    branding = await db.get(Branding, ID_BRANDING_GLOBAL)
    cachet = branding.cachet_bytes if branding else None
    rib = await obtenir_parametre(db, "rib_paiement")
    pays_par_id = {p.id: p for p in (await db.execute(select(Pays))).scalars().all()}
    commandes = (await db.execute(select(Commande).where(Commande.id.in_(ids)))).scalars().all()
    sortie = io.BytesIO()
    with zipfile.ZipFile(sortie, "w", zipfile.ZIP_DEFLATED) as archive:
        for c in commandes:
            pdf = generer_facture_pdf(c, pays_par_id[c.pays_id], cachet_bytes=cachet, rib=rib)
            etat = "definitive" if c.statut == StatutCommande.PAYEE else "proforma"
            code = pays_par_id[c.pays_id].code_iso
            archive.writestr(f"facture-{code}-{c.id[:8]}-{etat}.pdf", pdf)
    await journaliser(db, utilisateur_id=current_user.id, action="comptabilite.export_factures", entite="Commande", entite_id="periode", nouvelle_valeur={"debut": str(debut), "fin": str(fin), "factures": len(commandes)})
    await db.commit()
    return Response(content=sortie.getvalue(), media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="factures-ppb_{_nom_periode(debut, fin)}.zip"'})
