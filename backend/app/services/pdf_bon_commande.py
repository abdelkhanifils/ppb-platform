"""Génération PDF du bon de commande d'une commande (Module 1) — document
distinct de la facture (voir app/services/pdf_facture.py) : le bon de
commande formalise la DEMANDE dès sa création (stable, ne change jamais
après coup), la facture suit le CIRCUIT DE PAIEMENT (proforma puis
définitive). Une commande produit donc désormais DEUX documents PDF
téléchargeables séparément, jamais fusionnés en un seul.
"""
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.models.commande import Commande
from app.models.pays import Pays

LIBELLES_LANGUE = {"FR/EN": "Français / Anglais", "FR/AR": "Français / Arabe"}
LIBELLES_MODE_IMPRESSION = {"centralisee": "Centralisée (siège CEBEVIRHA)", "decentralisee": "Décentralisée (pays)"}

# Même logo que la facture — voir app.services.pdf_facture pour la note sur
# ce chemin fixe (déposer le fichier ici suffit, aucun autre code à changer).
CHEMIN_LOGO = Path(__file__).resolve().parent.parent / "assets" / "logo_cebevirha.png"


def generer_bon_commande_pdf(commande: Commande, pays: Pays, cachet_bytes: bytes | None = None, rib: str | None = None) -> bytes:
    tampon = BytesIO()
    document = SimpleDocTemplate(
        tampon, pagesize=A4, topMargin=25 * mm, bottomMargin=25 * mm, leftMargin=20 * mm, rightMargin=20 * mm
    )
    styles = getSampleStyleSheet()
    style_titre = ParagraphStyle("Titre", parent=styles["Title"], alignment=TA_CENTER, fontSize=16)
    style_sous_titre = ParagraphStyle("SousTitre", parent=styles["Normal"], alignment=TA_CENTER, textColor=colors.grey)

    elements = []
    if CHEMIN_LOGO.exists():
        largeur_logo = A4[0] - 2 * 20 * mm
        hauteur_logo = largeur_logo * (184 / 768)
        elements.append(Image(str(CHEMIN_LOGO), width=largeur_logo, height=hauteur_logo, hAlign="CENTER"))
        elements.append(Spacer(1, 4 * mm))
    elements += [
        Paragraph("CEBEVIRHA", style_titre),
        Paragraph("Commission Économique du Bétail, de la Viande et des Ressources Halieutiques", style_sous_titre),
        Spacer(1, 10 * mm),
        Paragraph(f"BON DE COMMANDE — Commande {commande.id[:8].upper()}", styles["Heading2"]),
        # Date de la commande elle-même (cree_le), pas la date de génération
        # de ce PDF — contrairement à la facture, ce document représente un
        # évènement passé et fixe, jamais régénéré avec une date différente.
        Paragraph(f"Passée le {commande.cree_le.strftime('%d/%m/%Y')}", styles["Normal"]),
        Spacer(1, 8 * mm),
    ]

    donnees_commande = [
        ["Pays destinataire", pays.nom],
        ["Responsable", commande.responsable_nom],
        ["Version linguistique", LIBELLES_LANGUE.get(commande.langue_version.value, commande.langue_version.value)],
        ["Mode d'impression", LIBELLES_MODE_IMPRESSION.get(commande.mode_impression.value, commande.mode_impression.value)],
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
        ["", "", "MONTANT À RÉGLER", f"{commande.montant_total:,.0f} XAF".replace(",", " ")],
    ]
    table_montant = Table(donnees_montant, colWidths=[70 * mm, 30 * mm, 40 * mm, 40 * mm])
    table_montant.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#252a85")),  # bleu CEMAC — distingue visuellement du vert de la facture
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
    elements.append(Spacer(1, 10 * mm))

    if rib:
        style_rib_titre = ParagraphStyle("RIBTitre", parent=styles["Normal"], fontSize=9, textColor=colors.grey)
        style_rib_valeur = ParagraphStyle("RIBValeur", parent=styles["Normal"], fontSize=10, fontName="Helvetica-Bold")
        elements.append(Paragraph("Coordonnées bancaires (RIB) pour règlement", style_rib_titre))
        elements.append(Paragraph(rib, style_rib_valeur))
        elements.append(Spacer(1, 10 * mm))
    else:
        elements.append(Spacer(1, 5 * mm))

    if cachet_bytes:
        image_cachet = ImageReader(BytesIO(cachet_bytes))
        largeur_native, hauteur_native = image_cachet.getSize()
        hauteur_cachet = 22 * mm
        largeur_cachet = hauteur_cachet * (largeur_native / hauteur_native) if hauteur_native else hauteur_cachet
        largeur_cachet = min(largeur_cachet, 70 * mm)
        elements.append(Image(BytesIO(cachet_bytes), width=largeur_cachet, height=hauteur_cachet, hAlign="RIGHT"))
        elements.append(Spacer(1, 5 * mm))

    style_pied = ParagraphStyle("Pied", parent=styles["Normal"], fontSize=7, textColor=colors.grey)
    elements.append(
        Paragraph(
            "Document généré automatiquement — Plateforme numérique du Passeport Pour Bétail. "
            "Ce bon de commande formalise la demande ; la facture (proforma puis définitive une fois le paiement "
            "validé) suit séparément le circuit de règlement.",
            style_pied,
        )
    )

    document.build(elements)
    return tampon.getvalue()
