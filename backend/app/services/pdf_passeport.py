"""
Génération du document imprimable du PPB — Module 3 (Impression), format A5,
4 pages, reproduisant fidèlement le gabarit officiel CEBEVIRHA (référence
validée : Passeport_Betail_A5_4pages.docx / _FR_AR.docx). Mise en page
vérifiée visuellement (rendu PDF -> image) avant intégration, page par page,
contre ce gabarit de référence.

Principe important : SEULS les éléments fixes à l'impression sont
pré-remplis ici — numéro (pays/année/lot), QR Code, mentions légales
validées (voir TexteGabarit, Module Administration). L'identification de
l'éleveur, le convoyeur, l'itinéraire et la composition du troupeau restent
VIERGES sur ce document (cases à remplir) : ils sont remplis à la main sur
le terrain (Module 4), en encre noire, en lettres majuscules — le papier
reste le support légal de la saisie manuscrite, la plateforme n'en capture
que la version numérique déclarée séparément par l'agent d'émission (jamais
une photo du papier lui-même, conformément au principe « sans conservation
d'image » du Module 4).
"""
import base64
from io import BytesIO
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A5
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    HRFlowable,
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
MARGE = 6 * mm
LARGEUR_UTILE = LARGEUR - 2 * MARGE

VERT = colors.HexColor("#0f5132")
CASE_FOND = colors.HexColor("#f3ead9")
CASE_BORD = colors.HexColor("#c9a35c")
GRIS = colors.HexColor("#6b7280")
BLEU_SOUS_TITRE = colors.HexColor("#1e3a5f")
OR = colors.HexColor("#e8b923")

CHEMIN_LOGO = Path(__file__).resolve().parent.parent / "assets" / "logo_cebevirha.png"

_styles = getSampleStyleSheet()
S_TITRE = ParagraphStyle("PPBTitre", parent=_styles["Title"], fontName="Helvetica-Bold", fontSize=18, textColor=VERT, alignment=TA_CENTER, spaceAfter=0)
S_SOUS_TITRE_ANG = ParagraphStyle("PPBSousTitreAng", parent=_styles["Normal"], fontName="Helvetica-Oblique", fontSize=10, textColor=BLEU_SOUS_TITRE, alignment=TA_CENTER)
S_ENTETE_ORG = ParagraphStyle("PPBEnteteOrg", parent=_styles["Normal"], fontName="Helvetica-Bold", fontSize=8, textColor=GRIS, alignment=TA_CENTER, leading=10)
S_LABEL_CHAMP = ParagraphStyle("PPBLabelChamp", parent=_styles["Normal"], fontName="Helvetica-Bold", fontSize=7.5, leading=9)
S_LABEL_CHAMP_EN = ParagraphStyle("PPBLabelChampEn", parent=_styles["Normal"], fontName="Helvetica-Oblique", fontSize=6, textColor=GRIS, leading=7)
S_CEMAC = ParagraphStyle("PPBCemac", parent=_styles["Normal"], fontName="Helvetica-Bold", fontSize=11, textColor=VERT, alignment=TA_CENTER)
S_CEMAC_PAYS = ParagraphStyle("PPBCemacPays", parent=_styles["Normal"], fontName="Helvetica", fontSize=7.5, textColor=GRIS, alignment=TA_CENTER)
S_NOTE = ParagraphStyle("PPBNote", parent=_styles["Normal"], fontName="Helvetica-Oblique", fontSize=7, textColor=GRIS, alignment=TA_CENTER)
S_BANDEAU_TITRE = ParagraphStyle("PPBBandeauTitre", parent=_styles["Normal"], fontName="Helvetica-Bold", fontSize=8, textColor=VERT, spaceBefore=4, spaceAfter=1)
S_SECTION_TITRE = ParagraphStyle("PPBSectionTitre", parent=_styles["Normal"], fontName="Helvetica-Bold", fontSize=12, textColor=colors.HexColor("#1f2937"))
S_SECTION_SOUS = ParagraphStyle("PPBSectionSous", parent=_styles["Normal"], fontName="Helvetica-Oblique", fontSize=8.5, textColor=GRIS, spaceAfter=3)
S_LEGAL_FR = ParagraphStyle("PPBLegalFr", parent=_styles["Normal"], fontName="Helvetica", fontSize=7.5, leading=9.5)
S_LEGAL_EN = ParagraphStyle("PPBLegalEn", parent=_styles["Normal"], fontName="Helvetica-Oblique", fontSize=6.5, textColor=GRIS, leading=8)
S_BANDEAU_VERT_FR = ParagraphStyle("PPBBandeauVertFr", parent=_styles["Normal"], fontName="Helvetica-Bold", fontSize=8.5, textColor=colors.white)
S_BANDEAU_VERT_EN = ParagraphStyle("PPBBandeauVertEn", parent=_styles["Normal"], fontName="Helvetica-Oblique", fontSize=7, textColor=colors.HexColor("#d1e7dd"), alignment=TA_RIGHT)
S_BANDEAU_VERT_EN_GAUCHE = ParagraphStyle("PPBBandeauVertEnG", parent=S_BANDEAU_VERT_EN, alignment=TA_LEFT)
S_CASE_LABEL = ParagraphStyle("PPBCaseLabel", parent=_styles["Normal"], fontName="Helvetica", fontSize=6, textColor=GRIS)
S_TABLE_ENTETE = ParagraphStyle("PPBTableEntete", parent=_styles["Normal"], fontName="Helvetica-Bold", fontSize=7, textColor=colors.white, alignment=TA_CENTER)
S_MRZ = ParagraphStyle("PPBMrz", parent=_styles["Normal"], fontName="Courier", fontSize=7.5, textColor=colors.white, leading=9)
S_PIED = ParagraphStyle("PPBPied", parent=_styles["Normal"], fontName="Helvetica", fontSize=6.5, textColor=GRIS, alignment=TA_CENTER)

TEXTES_LEGAUX_PAR_DEFAUT: list[tuple[str, str]] = [
    (
        "Le Passeport Pour Bétail est un document obligatoire pour la circulation du bétail à des buts "
        "commerciaux, au sein de l'espace CEMAC, sur des corridors transfrontaliers.",
        "The Livestock Passport is a mandatory document for the movement of livestock for commercial "
        "purposes within the CEMAC area, along cross-border corridors.",
    ),
    (
        "Sa création et sa mise en circulation sont encadrées par l'Acte N° 31/84-UDEAC-413 du 19 décembre "
        "1984 à Brazzaville, puis par la Décision N° 1/94-CEBEVIRHA-018-CE-29 du 16 mars 1994.",
        "Its creation and circulation are governed by Act No. 31/84-UDEAC-413 of December 19, 1984, in "
        "Brazzaville, and Decision No. 1/94-CEBEVIRHA-018-CE-29 of March 16, 1994.",
    ),
    (
        "Il est émis par la CEBEVIRHA, puis délivré aux usagers des États de la CEMAC : Cameroun, "
        "Centrafrique, Congo, Gabon, Guinée Équatoriale et Tchad.",
        "It is issued by CEBEVIRHA, and handed over to users in the CEMAC states: Cameroon, Central "
        "African Republic, Congo, Gabon, Equatorial Guinea, and Chad.",
    ),
    (
        "Il est la propriété de la CEBEVIRHA ; aucune modification ne peut y être portée, sauf celles "
        "autorisées par les instances supérieures de la CEMAC.",
        "It is the property of CEBEVIRHA, and no changes can be made to it except those authorized by "
        "the higher authorities of CEMAC.",
    ),
]


def _rangee_cases(valeurs: list, largeur_case: float = 5.6 * mm, hauteur: float = 5.2 * mm) -> Table:
    table = Table([valeurs], colWidths=[largeur_case] * len(valeurs), rowHeights=[hauteur])
    table.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.6, CASE_BORD),
                ("INNERGRID", (0, 0), (-1, -1), 0.6, CASE_BORD),
                ("BACKGROUND", (0, 0), (-1, -1), CASE_FOND),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("FONTNAME", (0, 0), (-1, -1), "Courier-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
            ]
        )
    )
    return table


def _champ_avec_cases(label_fr: str, label_en: str, nb_cases: int, largeur_case: float = 5.6 * mm) -> list:
    return [
        Paragraph(label_fr, S_LABEL_CHAMP),
        Paragraph(label_en, S_LABEL_CHAMP_EN),
        Spacer(1, 1 * mm),
        _rangee_cases([""] * nb_cases, largeur_case=largeur_case),
    ]


def _bandeau_vert(titre_fr: str, titre_en: str) -> Table:
    table = Table(
        [[Paragraph(titre_fr, S_BANDEAU_VERT_FR), Paragraph(titre_en, S_BANDEAU_VERT_EN)]],
        colWidths=[LARGEUR_UTILE * 0.68, LARGEUR_UTILE * 0.32],
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), VERT),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (0, 0), 6),
                ("RIGHTPADDING", (1, 0), (1, 0), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    return table


def _bandeau_vert_double(fr1: str, en1: str, fr2: str, en2: str) -> Table:
    def cellule(fr: str, en: str) -> list:
        return [Paragraph(fr, S_BANDEAU_VERT_FR), Paragraph(en, S_BANDEAU_VERT_EN_GAUCHE)]

    table = Table([[cellule(fr1, en1), cellule(fr2, en2)]], colWidths=[LARGEUR_UTILE / 2] * 2)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), VERT),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return table


def _bloc_numero(passeport: Passeport, echelle: float = 1.0) -> list:
    largeur_case = 5.6 * mm * echelle
    hauteur_case = 6.5 * mm * echelle
    cases_pays = _rangee_cases(list(passeport.numero_pays), largeur_case, hauteur_case)
    cases_annee = _rangee_cases(list(passeport.numero_annee), largeur_case, hauteur_case)
    cases_lot = _rangee_cases(list(passeport.numero_lot), largeur_case, hauteur_case)

    ligne_labels = Table(
        [
            [
                Paragraph("Pays<br/><font size=6 color='#6b7280'><i>Country</i></font>", S_LABEL_CHAMP),
                "",
                Paragraph("Année<br/><font size=6 color='#6b7280'><i>Year</i></font>", S_LABEL_CHAMP),
                "",
                Paragraph("N° de lot<br/><font size=6 color='#6b7280'><i>Batch no.</i></font>", S_LABEL_CHAMP),
            ]
        ],
        colWidths=[largeur_case * 2, 4 * mm, largeur_case * 4, 4 * mm, largeur_case * 7],
    )
    ligne_labels.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )

    ligne_cases = Table(
        [[cases_pays, "-", cases_annee, "-", cases_lot]],
        colWidths=[largeur_case * 2, 4 * mm, largeur_case * 4, 4 * mm, largeur_case * 7],
    )
    ligne_cases.setStyle(
        TableStyle(
            [
                ("ALIGN", (1, 0), (1, 0), "CENTER"),
                ("ALIGN", (3, 0), (3, 0), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("FONTNAME", (1, 0), (1, 0), "Helvetica-Bold"),
                ("FONTNAME", (3, 0), (3, 0), "Helvetica-Bold"),
                ("FONTSIZE", (1, 0), (1, 0), 11),
                ("FONTSIZE", (3, 0), (3, 0), 11),
            ]
        )
    )

    return [ligne_labels, Spacer(1, 1 * mm), ligne_cases]


def _page_1(passeport: Passeport) -> list:
    elements = []
    if CHEMIN_LOGO.exists():
        largeur_logo = 55 * mm
        hauteur_logo = largeur_logo * (262 / 1024)
        elements.append(Image(str(CHEMIN_LOGO), width=largeur_logo, height=hauteur_logo, hAlign="CENTER"))
        elements.append(Spacer(1, 5 * mm))

    elements += [
        Paragraph("COMMISSION ÉCONOMIQUE DU BÉTAIL, DE LA VIANDE<br/>ET DES RESSOURCES HALIEUTIQUES", S_ENTETE_ORG),
        Spacer(1, 6 * mm),
        Paragraph("PASSEPORT POUR BÉTAIL", S_TITRE),
        Paragraph("PASSPORT FOR CATTLE", S_SOUS_TITRE_ANG),
        Spacer(1, 4 * mm),
        HRFlowable(width="100%", thickness=1.5, color=OR, spaceAfter=6 * mm),
        Paragraph("Numéro du Passeport", ParagraphStyle("PPBNumTitre", parent=S_SECTION_TITRE, fontSize=10, alignment=TA_CENTER)),
        Paragraph("Passport number — généré automatiquement", ParagraphStyle("PPBNumSous", parent=S_SECTION_SOUS, alignment=TA_CENTER, spaceAfter=3)),
        Spacer(1, 2 * mm),
    ]
    conteneur = Table([[_bloc_numero(passeport)]], colWidths=[LARGEUR_UTILE])
    conteneur.setStyle(TableStyle([("ALIGN", (0, 0), (0, 0), "CENTER")]))
    elements.append(conteneur)
    elements += [
        Spacer(1, 8 * mm),
        Paragraph("CEMAC", S_CEMAC),
        Paragraph("Cameroun · Centrafrique · Congo · Gabon · Guinée Équatoriale · Tchad", S_CEMAC_PAYS),
        Spacer(1, 20 * mm),
        Paragraph("Document officiel — voir volet d'identification en page intérieure", S_NOTE),
    ]
    return elements


def _page_2(passeport: Passeport, qr_png_bytes: bytes, textes_legaux: list) -> list:
    elements = [
        Paragraph("MENTIONS LÉGALES · LEGAL NOTICE", S_BANDEAU_TITRE),
        Paragraph("Cadre juridique du document", S_SECTION_TITRE),
        Paragraph("Legal framework of the document", S_SECTION_SOUS),
    ]
    for fr, en in textes_legaux:
        elements.append(Paragraph(f"•&nbsp;&nbsp;{fr}", S_LEGAL_FR))
        elements.append(Paragraph(en, S_LEGAL_EN))
        elements.append(Spacer(1, 3 * mm))

    elements.append(Spacer(1, 3 * mm))
    elements.append(_bandeau_vert("VOLET D'IDENTIFICATION DU DOCUMENT", "Document identification panel"))
    elements.append(Spacer(1, 3 * mm))

    legende_codes = Paragraph(
        "01 CMR · 02 CAF · 03 COG · 04 GAB · 05 GNQ · 06 TCD",
        ParagraphStyle("PPBLegende", parent=S_CASE_LABEL, fontSize=6.5, spaceBefore=3),
    )
    colonne_gauche = (
        [
            Paragraph("Numéro du Passeport", ParagraphStyle("PPBNumTitre2", parent=S_SECTION_TITRE, fontSize=8.5)),
            Paragraph("Passport number — généré automatiquement", ParagraphStyle("PPBNumSous2", parent=S_SECTION_SOUS, fontSize=6.5, spaceAfter=2)),
        ]
        + _bloc_numero(passeport, echelle=0.85)
        + [legende_codes]
    )

    image_qr = Image(BytesIO(qr_png_bytes), width=26 * mm, height=26 * mm)
    colonne_droite = [
        image_qr,
        Spacer(1, 1.5 * mm),
        Paragraph("QR Code de validation", ParagraphStyle("PPBQrTitre", parent=S_LABEL_CHAMP, alignment=TA_CENTER)),
        Paragraph("Validation QR Code", ParagraphStyle("PPBQrSous", parent=S_LABEL_CHAMP_EN, alignment=TA_CENTER)),
    ]

    table_identification = Table([[colonne_gauche, colonne_droite]], colWidths=[LARGEUR_UTILE * 0.62, LARGEUR_UTILE * 0.38])
    table_identification.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.7, VERT),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ALIGN", (1, 0), (1, 0), "CENTER"),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("LEFTPADDING", (0, 0), (0, 0), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("LINEAFTER", (0, 0), (0, 0), 0.7, VERT),
            ]
        )
    )
    elements.append(table_identification)
    return elements


def _page_3() -> list:
    entete_proprietaire = _bandeau_vert_double("PROPRIÉTAIRE", "Livestock owner", "CONVOYEUR", "Livestock conveyor")

    def bloc_personne() -> list:
        return (
            _champ_avec_cases("Nom et prénom", "First and last name", 10)
            + [Spacer(1, 3 * mm)]
            + _champ_avec_cases("N° CNI", "National ID number", 10)
            + [Spacer(1, 3 * mm)]
            + _champ_avec_cases("Téléphone", "Phone number", 10)
        )

    table_personnes = Table([[bloc_personne(), bloc_personne()]], colWidths=[LARGEUR_UTILE / 2] * 2)
    table_personnes.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#d1d5db")),
                ("LINEAFTER", (0, 0), (0, 0), 0.5, colors.HexColor("#d1d5db")),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )

    champ_origine_pays = _champ_avec_cases("Origine — Pays / Localité", "Origin — Country / Locality", 10, largeur_case=5.0 * mm)
    champ_dest_pays = _champ_avec_cases("Destination — Pays / Localité", "Destination — Country / Locality", 10, largeur_case=5.0 * mm)
    table_od_1 = Table([[champ_origine_pays, champ_dest_pays]], colWidths=[LARGEUR_UTILE / 2] * 2)
    table_od_1.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))

    champ_origine_prov = _champ_avec_cases("Origine — Province / Région", "Origin — Province / Region", 10, largeur_case=5.0 * mm)
    champ_dest_prov = _champ_avec_cases("Destination — Province / Région", "Destination — Province / Region", 10, largeur_case=5.0 * mm)
    table_od_2 = Table([[champ_origine_prov, champ_dest_prov]], colWidths=[LARGEUR_UTILE / 2] * 2)
    table_od_2.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))

    entete_itineraire = [Paragraph(t, S_TABLE_ENTETE) for t in ["N°", "Poste / localité traversée", "Date de passage", "Visa"]]
    lignes_itineraire = [entete_itineraire]
    for n in range(1, 4):
        lignes_itineraire.append([str(n), "", "", ""])
    largeur_poste = LARGEUR_UTILE - 8 * mm - 24 * mm - 20 * mm
    table_itineraire = Table(lignes_itineraire, colWidths=[8 * mm, largeur_poste, 24 * mm, 20 * mm], rowHeights=[7 * mm] + [8 * mm] * 3)
    table_itineraire.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), VERT),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#d1d5db")),
                ("ALIGN", (0, 0), (0, -1), "CENTER"),
                ("FONTSIZE", (0, 1), (-1, -1), 7),
            ]
        )
    )

    return [
        Paragraph("IDENTIFICATION · TRAJET", S_BANDEAU_TITRE),
        Paragraph("Identification et trajet", S_SECTION_TITRE),
        Paragraph("Identification and route", S_SECTION_SOUS),
        entete_proprietaire,
        table_personnes,
        Spacer(1, 4 * mm),
        _bandeau_vert("ORIGINE ET DESTINATION DES ANIMAUX", "Origin and destination of animals"),
        Spacer(1, 3 * mm),
        table_od_1,
        Spacer(1, 3 * mm),
        table_od_2,
        Spacer(1, 4 * mm),
        _bandeau_vert("ITINÉRAIRE EMPRUNTÉ", "Route taken"),
        Spacer(1, 3 * mm),
        table_itineraire,
    ]


def _page_4(passeport: Passeport) -> list:
    maladies = [
        ("Peste des Petits Ruminants", "Pest of small ruminants"),
        ("Péripneumonie contagieuse", "Contagious bovine peripneumonia"),
        ("Charbon", "Anthrax"),
        ("Trypanosomiase", "Trypanosomiasis"),
    ]

    def bloc_maladie(fr: str, en: str) -> list:
        return [
            Paragraph(fr, S_LABEL_CHAMP),
            Paragraph(en, S_LABEL_CHAMP_EN),
            Spacer(1, 1 * mm),
            Paragraph("Date :", S_CASE_LABEL),
            _rangee_cases([""] * 8, largeur_case=4.6 * mm, hauteur=4.2 * mm),
            Spacer(1, 1 * mm),
            Paragraph("Lieu / Place", S_CASE_LABEL),
            _rangee_cases([""] * 13, largeur_case=4.6 * mm, hauteur=4.2 * mm),
        ]

    cellules = [bloc_maladie(fr, en) for fr, en in maladies]
    table_maladies = Table([[cellules[0], cellules[1]], [cellules[2], cellules[3]]], colWidths=[LARGEUR_UTILE / 2] * 2)
    table_maladies.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#d1d5db")),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#d1d5db")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )

    entete_haut = ["Espèces", "Mâles", "Femelles", "", "", "TOTAL"]
    entete_bas = ["", "", "Jeunes", "Adultes", "Total", ""]
    lignes_troupeau = [
        [Paragraph(t, S_TABLE_ENTETE) if t else "" for t in entete_haut],
        [Paragraph(t, S_TABLE_ENTETE) if t else "" for t in entete_bas],
    ]
    for espece in ["Bovins", "Ovins", "Caprins", "Camelins", "Autres : ____"]:
        lignes_troupeau.append([espece, "", "", "", "", ""])
    largeur_espece = LARGEUR_UTILE * 0.28
    largeur_reste = (LARGEUR_UTILE - largeur_espece) / 5
    table_troupeau = Table(
        lignes_troupeau,
        colWidths=[largeur_espece] + [largeur_reste] * 5,
        rowHeights=[5 * mm, 5 * mm] + [6 * mm] * 5,
    )
    table_troupeau.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 1), VERT),
                ("SPAN", (0, 0), (0, 1)),
                ("SPAN", (1, 0), (1, 1)),
                ("SPAN", (2, 0), (4, 0)),
                ("SPAN", (5, 0), (5, 1)),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#d1d5db")),
                ("ALIGN", (1, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("FONTSIZE", (0, 2), (-1, -1), 7.5),
            ]
        )
    )

    entete_visas = [Paragraph(t, S_TABLE_ENTETE) for t in ["N°", "Poste", "Date", "Agent", "Visa"]]
    lignes_visas = [entete_visas]
    for n in range(1, 4):
        lignes_visas.append([str(n), "", "", "", ""])
    largeur_fixe = 8 * mm + 20 * mm + 26 * mm
    largeur_restante = LARGEUR_UTILE - largeur_fixe
    table_visas = Table(
        lignes_visas,
        colWidths=[8 * mm, largeur_restante * 0.55, 20 * mm, 26 * mm, largeur_restante * 0.45],
        rowHeights=[6 * mm] + [6.5 * mm] * 3,
    )
    table_visas.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), VERT),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#d1d5db")),
                ("ALIGN", (0, 0), (0, -1), "CENTER"),
                ("FONTSIZE", (0, 1), (-1, -1), 7),
            ]
        )
    )

    numero_brut = f"{passeport.numero_pays}{passeport.numero_annee}{passeport.numero_lot}"
    remplissage = "&lt;" * max(0, 30 - len(numero_brut))
    ligne_mrz_1 = "PPB&lt;&lt;CEMAC&lt;&lt;PASSEPORT&lt;POUR&lt;BETAIL&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;"
    ligne_mrz_2 = f"{numero_brut}{remplissage}0"
    boite_mrz = Table([[Paragraph(ligne_mrz_1, S_MRZ)], [Paragraph(ligne_mrz_2, S_MRZ)]], colWidths=[LARGEUR_UTILE])
    boite_mrz.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#1f2937")),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ]
        )
    )

    return [
        Paragraph("SANTÉ · CHEPTEL · CONTRÔLE", S_BANDEAU_TITRE),
        Paragraph("État sanitaire, cheptel et contrôle", S_SECTION_TITRE),
        Paragraph("Health, herd and control", S_SECTION_SOUS),
        Paragraph("Traitements préventifs (vaccins) ou curatifs réalisés ou vérifiés.", S_NOTE),
        Spacer(1, 2 * mm),
        table_maladies,
        Spacer(1, 2 * mm),
        _bandeau_vert("COMPOSITION DU TROUPEAU", "Herd composition"),
        Spacer(1, 1.5 * mm),
        table_troupeau,
        Spacer(1, 2 * mm),
        _bandeau_vert("VISAS DE CONTRÔLE AUX POSTES FRONTALIERS", "Border control post visas"),
        Spacer(1, 1.5 * mm),
        table_visas,
        Spacer(1, 2 * mm),
        _bandeau_vert("ZONE DE LECTURE AUTOMATIQUE", "Machine readable zone"),
        Spacer(1, 1.5 * mm),
        boite_mrz,
        Spacer(1, 1 * mm),
        Paragraph(
            "Zone pré-formatée réservée aux données d'identification lisibles automatiquement (sans QR Code). "
            "Écrire en lettres MAJUSCULES, une par case, à l'encre noire.",
            S_NOTE,
        ),
        Spacer(1, 1.5 * mm),
        Paragraph("CEBEVIRHA — Commission Économique du Bétail, de la Viande et des Ressources Halieutiques", S_PIED),
    ]


def _fond_page(canvas_obj, doc) -> None:
    canvas_obj.saveState()
    canvas_obj.setStrokeColor(VERT)
    canvas_obj.setLineWidth(0.8)
    canvas_obj.rect(4 * mm, 4 * mm, LARGEUR - 8 * mm, HAUTEUR - 8 * mm)
    canvas_obj.setFont("Helvetica", 6)
    canvas_obj.setFillColor(GRIS)
    canvas_obj.drawString(9 * mm, 6 * mm, "CEBEVIRHA — PPB")
    canvas_obj.drawRightString(LARGEUR - 9 * mm, 6 * mm, f"{doc.page} / 4")
    canvas_obj.restoreState()


def _construire_document(tampon: BytesIO) -> BaseDocTemplate:
    document = BaseDocTemplate(
        tampon, pagesize=A5, topMargin=MARGE, bottomMargin=MARGE, leftMargin=MARGE, rightMargin=MARGE
    )
    cadre = Frame(MARGE, MARGE, LARGEUR_UTILE, HAUTEUR - 2 * MARGE, id="cadre")
    document.addPageTemplates([PageTemplate(id="page", frames=[cadre], onPage=_fond_page)])
    return document


def generer_document_passeport_pdf(passeport: Passeport, textes_legaux: list | None = None) -> bytes:
    """Document imprimable A5, 4 pages, pour UN passeport."""
    textes = textes_legaux or TEXTES_LEGAUX_PAR_DEFAUT
    qr_png_bytes = base64.b64decode(generer_qrcode_png_base64(passeport.qr_uuid))

    tampon = BytesIO()
    document = _construire_document(tampon)

    elements: list = []
    elements += _page_1(passeport)
    elements.append(PageBreak())
    elements += _page_2(passeport, qr_png_bytes, textes)
    elements.append(PageBreak())
    elements += _page_3()
    elements.append(PageBreak())
    elements += _page_4(passeport)

    document.build(elements)
    return tampon.getvalue()


def generer_document_lot_pdf(passeports: list, textes_legaux: list | None = None) -> bytes:
    """Concatène le document 4 pages de plusieurs passeports en un seul PDF —
    pour imprimer un lot complet en une fois (Module 3, impression centralisée)."""
    textes = textes_legaux or TEXTES_LEGAUX_PAR_DEFAUT
    qr_cache: dict = {}

    tampon = BytesIO()
    document = _construire_document(tampon)

    elements: list = []
    for index, passeport in enumerate(passeports):
        if passeport.qr_uuid not in qr_cache:
            qr_cache[passeport.qr_uuid] = base64.b64decode(generer_qrcode_png_base64(passeport.qr_uuid))
        elements += _page_1(passeport)
        elements.append(PageBreak())
        elements += _page_2(passeport, qr_cache[passeport.qr_uuid], textes)
        elements.append(PageBreak())
        elements += _page_3()
        elements.append(PageBreak())
        elements += _page_4(passeport)
        if index < len(passeports) - 1:
            elements.append(PageBreak())

    document.build(elements)
    return tampon.getvalue()
