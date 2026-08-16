"""Génération PDF de la facture d'une commande (Module 1) — document simple
de justification comptable, distinct du document imprimable du PPB lui-même
(voir app/services/pdf_passeport.py, Module 3)."""
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.models.commande import Commande
from app.models.pays import Pays

LIBELLES_LANGUE = {"FR/EN": "Français / Anglais", "FR/AR": "Français / Arabe"}
LIBELLES_MODE_IMPRESSION = {"centralisee": "Centralisée (siège CEBEVIRHA)", "decentralisee": "Décentralisée (pays)"}

# Déposez le logo officiel ici (PNG, fond transparent de préférence) pour
# qu'il apparaisse automatiquement en en-tête de la facture — aucune autre
# modification de code nécessaire. Sans ce fichier, l'en-tête reste
# textuelle (nom de l'organisme), comme actuellement.
CHEMIN_LOGO = Path(__file__).resolve().parent.parent / "assets" / "logo_cebevirha.png"


def generer_facture_pdf(commande: Commande, pays: Pays) -> bytes:
    tampon = BytesIO()
    document = SimpleDocTemplate(
        tampon, pagesize=A4, topMargin=25 * mm, bottomMargin=25 * mm, leftMargin=20 * mm, rightMargin=20 * mm
    )
    styles = getSampleStyleSheet()
    style_titre = ParagraphStyle("Titre", parent=styles["Title"], alignment=TA_CENTER, fontSize=16)
    style_sous_titre = ParagraphStyle("SousTitre", parent=styles["Normal"], alignment=TA_CENTER, textColor=colors.grey)

    elements = []
    if CHEMIN_LOGO.exists():
        # Logo rectangulaire (~1024x262 px) — largeur fixée, hauteur calculée pour
        # conserver ses proportions plutôt que de le déformer en carré.
        largeur_logo = 45 * mm
        hauteur_logo = largeur_logo * (262 / 1024)
        elements.append(Image(str(CHEMIN_LOGO), width=largeur_logo, height=hauteur_logo, hAlign="CENTER"))
        elements.append(Spacer(1, 4 * mm))
    elements += [
        Paragraph("CEBEVIRHA", style_titre),
        Paragraph("Commission Économique du Bétail, de la Viande et des Ressources Halieutiques", style_sous_titre),
        Spacer(1, 10 * mm),
        Paragraph(f"FACTURE — Commande {commande.id[:8].upper()}", styles["Heading2"]),
        Paragraph(f"Émise le {datetime.now(timezone.utc).strftime('%d/%m/%Y')}", styles["Normal"]),
        Spacer(1, 8 * mm),
    ]

    donnees_commande = [
        ["Pays destinataire", pays.nom],
        ["Responsable", commande.responsable_nom],
        ["Version linguistique", LIBELLES_LANGUE.get(commande.langue_version.value, commande.langue_version.value)],
        ["Mode d'impression", LIBELLES_MODE_IMPRESSION.get(commande.mode_impression.value, commande.mode_impression.value)],
        ["Statut", commande.statut.value.replace("_", " ").capitalize()],
    ]
    table_commande = Table(donnees_commande, colWidths=[60 * mm, 100 * mm])
    table_commande.setStyle(
        TableStyle(
            [
                ("FONTSIZE", (0, 0), (-1, -1), 10),
                ("TEXTCOLOR", (0, 0), (0, -1), colors.grey),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("LINEBELOW", (0, 0), (-1, -1), 0.3, colors.lightgrey),
            ]
        )
    )
    elements.append(table_commande)
    elements.append(Spacer(1, 10 * mm))

    prix_unitaire = commande.montant_total / commande.quantite if commande.quantite else 0
    donnees_montant = [
        ["Désignation", "Quantité", "Prix unitaire (XAF)", "Montant (XAF)"],
        [
            "Passeport Pour Bétail (PPB)",
            f"{commande.quantite:,}".replace(",", " "),
            f"{prix_unitaire:,.0f}".replace(",", " "),
            f"{commande.montant_total:,.0f}".replace(",", " "),
        ],
        ["", "", "TOTAL", f"{commande.montant_total:,.0f} XAF".replace(",", " ")],
    ]
    table_montant = Table(donnees_montant, colWidths=[70 * mm, 30 * mm, 40 * mm, 40 * mm])
    table_montant.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f5132")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTNAME", (2, 2), (3, 2), "Helvetica-Bold"),
                ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
                ("GRID", (0, 0), (-1, -2), 0.3, colors.lightgrey),
                ("LINEABOVE", (2, 2), (3, 2), 0.8, colors.black),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    elements.append(table_montant)
    elements.append(Spacer(1, 15 * mm))

    style_pied = ParagraphStyle("Pied", parent=styles["Normal"], fontSize=7, textColor=colors.grey)
    elements.append(
        Paragraph(
            "Document généré automatiquement — Plateforme numérique du Passeport Pour Bétail. "
            "Prix unitaire fixé par le paramètre système « prix_unitaire_ppb », modifiable par la CEBEVIRHA "
            "sans incidence sur les factures déjà émises.",
            style_pied,
        )
    )

    document.build(elements)
    return tampon.getvalue()
