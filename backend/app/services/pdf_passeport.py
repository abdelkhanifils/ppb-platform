"""
Génération du document imprimable du PPB — Module 3 (Impression), format A5,
4 pages, structure alignée sur le gabarit officiel CEBEVIRHA (référence :
Passeport_Betail_A5_4pages.docx / _FR_AR.docx).

Principe important : SEULS les éléments fixes à l'impression sont
pré-remplis ici — numéro (pays/année/lot), QR Code, mentions légales
validées (voir TexteGabarit, Module Administration). L'identification de
l'éleveur, le convoyeur, l'itinéraire et la composition du troupeau restent
VIERGES sur ce document : ils sont remplis à la main sur le terrain
(Module 4), en encre noire, en lettres majuscules — le papier reste le
support légal de la saisie manuscrite, la plateforme n'en capture que la
version numérique déclarée séparément par l'agent d'émission (jamais une
photo du papier lui-même, conformément au principe « sans conservation
d'image » du Module 4).
"""
import base64
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A5
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    Image,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

from app.models.passeport import Passeport
from app.services.qrcode_service import generer_qrcode_png_base64

LARGEUR, HAUTEUR = A5
MARGE = 10 * mm
LARGEUR_UTILE = LARGEUR - 2 * MARGE

_styles = getSampleStyleSheet()
STYLE_SOUS_TITRE = ParagraphStyle("PPBSousTitre", parent=_styles["Normal"], fontSize=8, alignment=TA_CENTER, textColor=colors.grey)
STYLE_TITRE = ParagraphStyle("PPBTitre", parent=_styles["Title"], fontSize=13, alignment=TA_CENTER, spaceAfter=2)
STYLE_SECTION = ParagraphStyle("PPBSection", parent=_styles["Heading3"], fontSize=9, spaceBefore=6, spaceAfter=3)
STYLE_TEXTE = ParagraphStyle("PPBTexte", parent=_styles["Normal"], fontSize=6.5, leading=8)
STYLE_LEGAL = ParagraphStyle("PPBLegal", parent=_styles["Normal"], fontSize=6, leading=7.5)
STYLE_ETIQUETTE = ParagraphStyle("PPBEtiquette", parent=_styles["Normal"], fontSize=6, textColor=colors.grey)
STYLE_MRZ = ParagraphStyle("PPBMrz", parent=STYLE_TEXTE, fontName="Courier", fontSize=6.5, leading=8)

# Repli si aucun texte légal n'a encore été validé via le Module Administration
# (voir app.services.pdf_passeport.obtenir_textes_legaux) — reprend les mentions
# du gabarit de référence CEBEVIRHA, pour que le document ne parte jamais vide.
TEXTES_LEGAUX_PAR_DEFAUT = [
    "Le Passeport Pour Bétail est un document obligatoire pour la circulation du bétail à des buts "
    "commerciaux, au sein de l'espace CEMAC, sur des corridors transfrontaliers.",
    "Sa création et sa mise en circulation sont encadrées par l'Acte N° 31/84-UDEAC-413 du 19 décembre "
    "1984 à Brazzaville, puis par la Décision N° 1/94-CEBEVIRHA-018-CE-29 du 16 mars 1994.",
    "Il est émis par la CEBEVIRHA, puis délivré aux usagers des États de la CEMAC : Cameroun, "
    "Centrafrique, Congo, Gabon, Guinée Équatoriale et Tchad.",
    "Il est la propriété de la CEBEVIRHA ; aucune modification ne peut y être portée, sauf celles "
    "autorisées par les instances supérieures de la CEMAC.",
]


def _numero_complet(passeport: Passeport) -> str:
    return f"{passeport.numero_pays}-{passeport.numero_annee}-{passeport.numero_lot}"


def _bloc_numero(passeport: Passeport) -> Table:
    table = Table(
        [
            ["Pays / Country", "Année / Year", "N° de lot / Batch no."],
            [passeport.numero_pays, passeport.numero_annee, passeport.numero_lot],
        ],
        colWidths=[LARGEUR_UTILE / 3] * 3,
    )
    table.setStyle(
        TableStyle(
            [
                ("FONTSIZE", (0, 0), (-1, 0), 6),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.grey),
                ("FONTSIZE", (0, 1), (-1, 1), 12),
                ("FONTNAME", (0, 1), (-1, 1), "Courier-Bold"),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("BOX", (0, 0), (-1, -1), 0.5, colors.black),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.black),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    return table


def _page_1_complete(passeport: Passeport, textes_legaux: list[str]) -> list:
    elements = [
        Paragraph("COMMISSION ÉCONOMIQUE DU BÉTAIL, DE LA VIANDE", STYLE_SOUS_TITRE),
        Paragraph("ET DES RESSOURCES HALIEUTIQUES", STYLE_SOUS_TITRE),
        Spacer(1, 6 * mm),
        Paragraph("PASSEPORT POUR BÉTAIL", STYLE_TITRE),
        Paragraph("PASSPORT FOR CATTLE", STYLE_SOUS_TITRE),
        Spacer(1, 6 * mm),
        _bloc_numero(passeport),
        Spacer(1, 6 * mm),
        Paragraph("CEMAC", ParagraphStyle("PPBCemac", parent=STYLE_TITRE, fontSize=10)),
        Paragraph("Cameroun · Centrafrique · Congo · Gabon · Guinée Équatoriale · Tchad", STYLE_SOUS_TITRE),
        Spacer(1, 8 * mm),
        Paragraph("MENTIONS LÉGALES · LEGAL NOTICE", STYLE_SECTION),
    ]
    for texte in textes_legaux:
        elements.append(Paragraph(f"• {texte}", STYLE_LEGAL))
        elements.append(Spacer(1, 1.5 * mm))
    return elements


def _page_2(passeport: Passeport, qr_png_bytes: bytes) -> list:
    image_qr = Image(BytesIO(qr_png_bytes), width=22 * mm, height=22 * mm)
    cellule_numero = Paragraph(
        f"N° {_numero_complet(passeport)}<br/><font size=5 color='grey'>Passport number</font>", STYLE_TEXTE
    )
    table_identification = Table(
        [[cellule_numero, image_qr]],
        colWidths=[LARGEUR_UTILE - 28 * mm, 28 * mm],
    )
    table_identification.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.5, colors.black),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN", (1, 0), (1, 0), "CENTER"),
                ("LEFTPADDING", (0, 0), (0, 0), 4),
            ]
        )
    )

    entete_personnes = [
        Paragraph("PROPRIÉTAIRE<br/><font size=5 color='grey'>Livestock owner</font>", STYLE_TEXTE),
        Paragraph("CONVOYEUR<br/><font size=5 color='grey'>Livestock conveyor</font>", STYLE_TEXTE),
    ]
    corps_personnes = [
        Paragraph("Nom et prénom :<br/><br/>N° CNI :<br/><br/>Téléphone :", STYLE_TEXTE),
        Paragraph("Nom et prénom :<br/><br/>N° CNI :<br/><br/>Téléphone :", STYLE_TEXTE),
    ]
    table_personnes = Table(
        [entete_personnes, corps_personnes],
        colWidths=[LARGEUR_UTILE / 2] * 2,
        rowHeights=[6 * mm, 26 * mm],
    )
    table_personnes.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.5, colors.black),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("LEFTPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )

    table_od = Table(
        [
            [Paragraph("Origine — Pays / Localité", STYLE_TEXTE), Paragraph("Destination — Pays / Localité", STYLE_TEXTE)],
            ["", ""],
            [Paragraph("Origine — Province / Région", STYLE_TEXTE), Paragraph("Destination — Province / Région", STYLE_TEXTE)],
            ["", ""],
        ],
        colWidths=[LARGEUR_UTILE / 2] * 2,
        rowHeights=[5 * mm, 7 * mm, 5 * mm, 7 * mm],
    )
    table_od.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.5, colors.black), ("LEFTPADDING", (0, 0), (-1, -1), 3)]))

    largeur_poste = LARGEUR_UTILE - 8 * mm - 25 * mm - 20 * mm
    lignes_itineraire = [
        [
            Paragraph("N°", STYLE_TEXTE),
            Paragraph("Poste / localité traversée", STYLE_TEXTE),
            Paragraph("Date de passage", STYLE_TEXTE),
            Paragraph("Visa", STYLE_TEXTE),
        ]
    ]
    for n in range(1, 4):
        lignes_itineraire.append([str(n), "", "", ""])
    table_itineraire = Table(
        lignes_itineraire,
        colWidths=[8 * mm, largeur_poste, 25 * mm, 20 * mm],
        rowHeights=[6 * mm] + [7 * mm] * 3,
    )
    table_itineraire.setStyle(
        TableStyle([("GRID", (0, 0), (-1, -1), 0.5, colors.black), ("ALIGN", (0, 0), (0, -1), "CENTER")])
    )

    return [
        Paragraph("VOLET D'IDENTIFICATION DU DOCUMENT", STYLE_SECTION),
        table_identification,
        Spacer(1, 5 * mm),
        Paragraph("IDENTIFICATION ET TRAJET", STYLE_SECTION),
        table_personnes,
        Spacer(1, 4 * mm),
        Paragraph("ORIGINE ET DESTINATION DES ANIMAUX", STYLE_SECTION),
        table_od,
        Spacer(1, 4 * mm),
        Paragraph("ITINÉRAIRE EMPRUNTÉ", STYLE_SECTION),
        table_itineraire,
    ]


def _page_3() -> list:
    maladies = [
        ("Peste des Petits Ruminants", "Pest of small ruminants"),
        ("Péripneumonie contagieuse", "Contagious bovine peripneumonia"),
        ("Charbon", "Anthrax"),
        ("Trypanosomiase", "Trypanosomiasis"),
    ]
    cellules = [
        Paragraph(f"{fr}<br/><font size=5 color='grey'>{en}</font><br/>Date : __ / __ / ____<br/>Lieu : __________", STYLE_TEXTE)
        for fr, en in maladies
    ]
    table_maladies = Table(
        [[cellules[0], cellules[1]], [cellules[2], cellules[3]]],
        colWidths=[LARGEUR_UTILE / 2] * 2,
        rowHeights=[18 * mm, 18 * mm],
    )
    table_maladies.setStyle(
        TableStyle([("GRID", (0, 0), (-1, -1), 0.5, colors.black), ("TOPPADDING", (0, 0), (-1, -1), 3), ("LEFTPADDING", (0, 0), (-1, -1), 3)])
    )

    entete_troupeau = [
        Paragraph(t, STYLE_TEXTE) for t in ["Espèces", "Mâles", "Femelles jeunes", "Femelles adultes", "Total"]
    ]
    lignes_troupeau = [entete_troupeau]
    for espece in ["Bovins", "Ovins", "Caprins", "Camelins", "Autres : ____"]:
        lignes_troupeau.append([espece, "", "", "", ""])
    largeur_col = LARGEUR_UTILE / 5
    table_troupeau = Table(lignes_troupeau, colWidths=[largeur_col] * 5, rowHeights=[8 * mm] + [7 * mm] * 5)
    table_troupeau.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.5, colors.black),
                ("ALIGN", (1, 0), (-1, -1), "CENTER"),
                ("FONTSIZE", (0, 0), (-1, -1), 6),
            ]
        )
    )

    return [
        Paragraph("ÉTAT SANITAIRE, CHEPTEL ET CONTRÔLE", STYLE_SECTION),
        Paragraph("Traitements préventifs (vaccins) ou curatifs réalisés ou vérifiés.", STYLE_ETIQUETTE),
        Spacer(1, 2 * mm),
        table_maladies,
        Spacer(1, 5 * mm),
        Paragraph("COMPOSITION DU TROUPEAU", STYLE_SECTION),
        table_troupeau,
    ]


def _page_4(passeport: Passeport) -> list:
    entete_visas = [Paragraph(t, STYLE_TEXTE) for t in ["N°", "Poste", "Date", "Agent", "Visa"]]
    lignes_visas = [entete_visas]
    for n in range(1, 4):
        lignes_visas.append([str(n), "", "", "", ""])
    largeur_fixe = 8 * mm + 22 * mm + 30 * mm  # colonnes N°, Date, Agent
    largeur_restante = LARGEUR_UTILE - largeur_fixe
    largeur_poste = largeur_restante * 0.6
    largeur_visa = largeur_restante * 0.4
    table_visas = Table(
        lignes_visas,
        colWidths=[8 * mm, largeur_poste, 22 * mm, 30 * mm, largeur_visa],
        rowHeights=[6 * mm] + [9 * mm] * 3,
    )
    table_visas.setStyle(
        TableStyle([("GRID", (0, 0), (-1, -1), 0.5, colors.black), ("ALIGN", (0, 0), (0, -1), "CENTER"), ("FONTSIZE", (0, 0), (-1, -1), 6)])
    )

    # Zone de lecture automatique : chaîne illustrative inspirée du gabarit de
    # référence, PAS un format MRZ ICAO standardisé (le PPB n'est pas un
    # document de voyage international) — repère visuel cohérent avec le
    # document papier existant, sans checksum à valider.
    numero_brut = f"{passeport.numero_pays}{passeport.numero_annee}{passeport.numero_lot}"
    remplissage = "&lt;" * max(0, 30 - len(numero_brut))
    ligne_mrz = f"PPB&lt;&lt;CEMAC&lt;&lt;PASSEPORT&lt;POUR&lt;BETAIL{'&lt;' * 20} {numero_brut}{remplissage}0"

    return [
        Paragraph("VISAS DE CONTRÔLE AUX POSTES FRONTALIERS", STYLE_SECTION),
        table_visas,
        Spacer(1, 10 * mm),
        Paragraph("ZONE DE LECTURE AUTOMATIQUE", STYLE_SECTION),
        Paragraph(ligne_mrz, STYLE_MRZ),
        Spacer(1, 3 * mm),
        Paragraph(
            "Zone pré-formatée réservée aux données d'identification lisibles automatiquement (sans QR Code). "
            "Écrire en lettres MAJUSCULES, une par case, à l'encre noire. Numériser en couleur, 200 dpi minimum.",
            STYLE_ETIQUETTE,
        ),
        Spacer(1, 8 * mm),
        Paragraph(
            "CEBEVIRHA — Commission Économique du Bétail, de la Viande et des Ressources Halieutiques",
            ParagraphStyle("PPBPied", parent=STYLE_ETIQUETTE, alignment=TA_CENTER),
        ),
    ]


def _construire_document(tampon: BytesIO) -> BaseDocTemplate:
    document = BaseDocTemplate(
        tampon, pagesize=A5, topMargin=MARGE, bottomMargin=MARGE, leftMargin=MARGE, rightMargin=MARGE
    )
    cadre = Frame(MARGE, MARGE, LARGEUR_UTILE, HAUTEUR - 2 * MARGE, id="cadre")
    document.addPageTemplates([PageTemplate(id="page", frames=[cadre])])
    return document


def generer_document_passeport_pdf(passeport: Passeport, textes_legaux: list[str] | None = None) -> bytes:
    """Document imprimable A5, 4 pages, pour UN passeport."""
    textes = textes_legaux or TEXTES_LEGAUX_PAR_DEFAUT
    qr_png_bytes = base64.b64decode(generer_qrcode_png_base64(passeport.qr_uuid))

    tampon = BytesIO()
    document = _construire_document(tampon)

    elements: list = []
    elements += _page_1_complete(passeport, textes)
    elements.append(PageBreak())
    elements += _page_2(passeport, qr_png_bytes)
    elements.append(PageBreak())
    elements += _page_3()
    elements.append(PageBreak())
    elements += _page_4(passeport)

    document.build(elements)
    return tampon.getvalue()


def generer_document_lot_pdf(passeports: list[Passeport], textes_legaux: list[str] | None = None) -> bytes:
    """Concatène le document 4 pages de plusieurs passeports en un seul PDF —
    pour imprimer un lot complet en une fois (Module 3, impression centralisée)."""
    textes = textes_legaux or TEXTES_LEGAUX_PAR_DEFAUT
    qr_cache: dict[str, bytes] = {}

    tampon = BytesIO()
    document = _construire_document(tampon)

    elements: list = []
    for index, passeport in enumerate(passeports):
        if passeport.qr_uuid not in qr_cache:
            qr_cache[passeport.qr_uuid] = base64.b64decode(generer_qrcode_png_base64(passeport.qr_uuid))
        elements += _page_1_complete(passeport, textes)
        elements.append(PageBreak())
        elements += _page_2(passeport, qr_cache[passeport.qr_uuid])
        elements.append(PageBreak())
        elements += _page_3()
        elements.append(PageBreak())
        elements += _page_4(passeport)
        if index < len(passeports) - 1:
            elements.append(PageBreak())

    document.build(elements)
    return tampon.getvalue()
