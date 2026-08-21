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

from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

from app.models.passeport import Passeport
from app.services.qrcode_service import generer_qrcode_png_base64
from app.services.texte_arabe import preparer_texte_arabe

LARGEUR, HAUTEUR = A5
MARGE = 4 * mm
LARGEUR_UTILE = LARGEUR - 2 * MARGE

VERT = colors.HexColor("#0f5132")
CASE_FOND = colors.HexColor("#f3ead9")
CASE_BORD = colors.HexColor("#c9a35c")
GRIS = colors.HexColor("#6b7280")
BLEU_SOUS_TITRE = colors.HexColor("#1e3a5f")
OR = colors.HexColor("#e8b923")

CHEMIN_LOGO = Path(__file__).resolve().parent.parent / "assets" / "logo_cebevirha.png"

# Version FR/AR (Module 3) — police téléchargée pendant la construction de
# l'image Docker (voir Dockerfile), car Helvetica ne contient aucun glyphe
# arabe. Enregistrement défensif : si le téléchargement a échoué ou que le
# fichier est absent, POLICE_ARABE_DISPONIBLE reste False et le document
# retombe sur l'anglais pour la ligne secondaire plutôt que d'afficher du
# texte mal formé ou de faire planter la génération.
CHEMIN_POLICE_ARABE = Path(__file__).resolve().parent.parent / "assets" / "fonts" / "Amiri-Regular.ttf"
NOM_POLICE_ARABE = "PPBArabe"
POLICE_ARABE_DISPONIBLE = False
if CHEMIN_POLICE_ARABE.exists():
    try:
        pdfmetrics.registerFont(TTFont(NOM_POLICE_ARABE, str(CHEMIN_POLICE_ARABE)))
        POLICE_ARABE_DISPONIBLE = True
    except Exception:
        POLICE_ARABE_DISPONIBLE = False

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
S_CACHET = ParagraphStyle("PPBCachet", parent=_styles["Normal"], fontName="Helvetica-Bold", fontSize=7, textColor=colors.HexColor("#c81e1e"), alignment=TA_RIGHT)
S_TABLE_ENTETE = ParagraphStyle("PPBTableEntete", parent=_styles["Normal"], fontName="Helvetica-Bold", fontSize=7, textColor=colors.white, alignment=TA_CENTER)
S_MRZ = ParagraphStyle("PPBMrz", parent=_styles["Normal"], fontName="Courier", fontSize=7.5, textColor=colors.white, leading=8)
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


# --- Version FR/AR — traductions arabes des libellés secondaires -----------------------------
# Clé = texte anglais tel qu'utilisé ailleurs dans ce module (mode FR/EN) ;
# valeur = traduction arabe correspondante, tirée du gabarit de référence
# CEBEVIRHA (Passeport_Betail_A5_4pages_FR_AR.docx). Couvre les lignes
# secondaires isolées (déjà des Paragraph séparés) — pas les bandeaux-titres
# combinant français et anglais sur une seule ligne (ex. "MENTIONS LÉGALES ·
# LEGAL NOTICE"), qui restent en français seul en mode FR/AR : mélanger du
# texte arabe réordonné (RTL) au milieu d'une chaîne français/anglais
# concaténée risquerait un rendu bidi incorrect, pour un gain de lisibilité
# marginal vu le gros titre français juste en dessous.
TRADUCTIONS_AR: dict[str, str] = {
    "PASSPORT FOR CATTLE": "جواز سفر الماشية",
    "Country": "البلد",
    "Year": "السنة",
    "Batch no.": "رقم الدفعة",
    "Legal framework of the document": "الإطار القانوني للوثيقة",
    "Document identification panel": "بطاقة تعريف الوثيقة",
    "Passport number — généré automatiquement": "رقم الجواز — يُنشأ تلقائيًا",
    "Validation QR Code": "رمز التحقق",
    "Livestock owner": "مالك الماشية",
    "Livestock conveyor": "مرافق الماشية",
    "First and last name": "الاسم الكامل",
    "National ID number": "رقم البطاقة الوطنية",
    "Phone number": "رقم الهاتف",
    "Origin and destination of animals": "منشأ ووجهة الحيوانات",
    "Origin — Country / Locality": "المنشأ — البلد / المحلة",
    "Destination — Country / Locality": "الوجهة — البلد / المحلة",
    "Origin — Province / Region": "المنشأ — المقاطعة / الإقليم",
    "Destination — Province / Region": "الوجهة — المقاطعة / الإقليم",
    "Route taken": "المسار المتبع",
    "Identification and route": "التعريف والمسار",
    "Health, herd and control": "الحالة الصحية والقطيع والمراقبة",
    "Pest of small ruminants": "طاعون المجترات الصغيرة",
    "Contagious bovine peripneumonia": "الالتهاب الرئوي المعدي للأبقار",
    "Anthrax": "الجمرة الخبيثة",
    "Trypanosomiasis": "داء المثقبيات",
    "Herd composition": "تركيبة القطيع",
    "Border control post visas": "تأشيرات المراقبة عند المراكز الحدودية",
    "Machine readable zone": "منطقة القراءة الآلية",
    "Traitements préventifs (vaccins) ou curatifs réalisés ou vérifiés.":
        "العلاجات الوقائية (اللقاحات) أو العلاجية المنجزة أو المتحقق منها.",
    # En-têtes de tableaux — jamais bilingues FR/EN dans le gabarit (une
    # seule langue par cellule, colonnes trop étroites) ; en mode FR/AR
    # uniquement, une seconde ligne arabe apparaît sous le mot français.
    "Espèces": "الأنواع",
    "Mâles": "الذكور",
    "Femelles": "الإناث",
    "Jeunes": "الصغار",
    "Adultes": "البالغون",
    "Total": "المجموع",
    "TOTAL": "المجموع الكلي",
    "Bovins": "الأبقار",
    "Ovins": "الأغنام",
    "Caprins": "الماعز",
    "Camelins": "الإبل",
    "Autres : ____": "أخرى : ____",
    "N°": "الرقم",
    "Poste": "المركز",
    "Poste / localité traversée": "المركز / المحلة المعبورة",
    "Date": "التاريخ",
    "Date de passage": "تاريخ المرور",
    "Agent": "العون",
    "Visa": "التأشيرة",
}

# Version FR/EN — traductions anglaises des mêmes libellés « en-tête de
# tableau » que TRADUCTIONS_AR ci-dessus (Espèces, Bovins, Poste, ...),
# jamais fournies nulle part ailleurs dans ce module pour ces libellés
# précis (contrairement aux gros titres/sections, qui reçoivent toujours
# leur anglais directement en argument de _p_secondaire). Clé = texte
# français, comme TRADUCTIONS_AR, pour que _entete_bilingue interroge les
# deux dictionnaires de la même façon.
TRADUCTIONS_EN: dict[str, str] = {
    "Traitements préventifs (vaccins) ou curatifs réalisés ou vérifiés.":
        "Preventive (vaccines) or curative treatments carried out or verified.",
    "Espèces": "Species",
    "Mâles": "Males",
    "Femelles": "Females",
    "Jeunes": "Young",
    "Adultes": "Adults",
    "Total": "Total",
    "TOTAL": "TOTAL",
    "Bovins": "Cattle",
    "Ovins": "Sheep",
    "Caprins": "Goats",
    "Camelins": "Camels",
    "Autres : ____": "Other: ____",
    "N°": "No.",
    "Poste": "Post",
    "Poste / localité traversée": "Post / locality crossed",
    "Date": "Date",
    "Date de passage": "Crossing date",
    "Agent": "Officer",
    "Visa": "Visa",
}

# Textes légaux (les 4 mentions de la page 2) — mêmes clés que
# TEXTES_LEGAUX_PAR_DEFAUT côté anglais, appariées par position.
TEXTES_LEGAUX_AR: list[str] = [
    "الجواز الخاص بالماشية وثيقة إلزامية لتنقل الماشية لأغراض تجارية، داخل فضاء الجماعة "
    "الاقتصادية والنقدية لوسط أفريقيا (CEMAC)، عبر الممرات العابرة للحدود.",
    "تم تنظيم إنشائه وتداوله بموجب القانون رقم 31/84-UDEAC-413 الصادر في 19 ديسمبر 1984 "
    "في برازافيل، ثم بموجب القرار رقم 1/94-CEBEVIRHA-018-CE-29 الصادر في 16 مارس 1994.",
    "تصدره اللجنة الاقتصادية للماشية واللحوم والموارد السمكية (CEBEVIRHA)، ويُسلَّم لمستخدمي "
    "دول الجماعة: الكاميرون، أفريقيا الوسطى، الكونغو، الغابون، غينيا الاستوائية وتشاد.",
    "هو ملك للجنة الاقتصادية للماشية واللحوم والموارد السمكية؛ لا يجوز إدخال أي تعديل عليه "
    "إلا بترخيص من الهيئات العليا للجماعة.",
]


def _p_secondaire(texte_en: str, langue: str, style_base: ParagraphStyle, alignement=None) -> Paragraph:
    """Construit la ligne secondaire (sous le français) — anglais en mode
    FR/EN, arabe en mode FR/AR (si la police arabe a pu être chargée et
    qu'une traduction existe ; repli sur l'anglais sinon, voir docstring du
    dictionnaire TRADUCTIONS_AR ci-dessus). `alignement` par défaut reprend
    celui du style anglais d'origine (souvent centré) ; passer TA_RIGHT
    explicitement pour les libellés de champ (l'arabe s'aligne alors comme
    le ferait une étiquette de formulaire réelle, pas seulement le titre)."""
    if langue == "FR/AR" and POLICE_ARABE_DISPONIBLE and texte_en in TRADUCTIONS_AR:
        texte_ar = preparer_texte_arabe(TRADUCTIONS_AR[texte_en])
        style_ar = ParagraphStyle(
            f"{style_base.name}_ar",
            parent=style_base,
            fontName=NOM_POLICE_ARABE,
            fontSize=style_base.fontSize + 2,
            leading=style_base.leading + 2,
            alignment=alignement if alignement is not None else style_base.alignment,
        )
        return Paragraph(texte_ar, style_ar)
    return Paragraph(texte_en, style_base)


def _entete_bilingue(texte_fr: str, langue: str, style_base: ParagraphStyle = S_TABLE_ENTETE) -> Paragraph:
    """En-tête de cellule de tableau (N°, Poste, Espèces, Bovins, ...) —
    jamais bilingue dans le gabarit d'origine (colonnes trop étroites, une
    seule langue par cellule). Français et langue secondaire (anglais ou
    arabe) côte à côte SUR LA MÊME LIGNE (pas empilés) : les premières
    lignes de ces tableaux sont trop basses pour accueillir deux lignes de
    texte sans déborder — les juxtaposer horizontalement règle le problème
    sans jamais agrandir la ligne."""
    if langue == "FR/AR" and POLICE_ARABE_DISPONIBLE and texte_fr in TRADUCTIONS_AR:
        texte_ar = preparer_texte_arabe(TRADUCTIONS_AR[texte_fr])
        return Paragraph(f"{texte_fr} <font face='{NOM_POLICE_ARABE}' size=6.5>{texte_ar}</font>", style_base)
    if langue == "FR/EN" and texte_fr in TRADUCTIONS_EN:
        return Paragraph(f"{texte_fr} <i><font size=6.5 color='#6b7280'>{TRADUCTIONS_EN[texte_fr]}</font></i>", style_base)
    return Paragraph(texte_fr, style_base)


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


def _champ_avec_cases(label_fr: str, label_en: str, nb_cases: int, langue: str = "FR/EN", largeur_case: float = 5.6 * mm) -> list:
    return [
        Paragraph(label_fr, S_LABEL_CHAMP),
        _p_secondaire(label_en, langue, S_LABEL_CHAMP_EN, alignement=TA_LEFT),
        Spacer(1, 1 * mm),
        _rangee_cases([""] * nb_cases, largeur_case=largeur_case),
    ]


def _bandeau_vert(titre_fr: str, titre_en: str, langue: str = "FR/EN") -> Table:
    table = Table(
        [[Paragraph(titre_fr, S_BANDEAU_VERT_FR), _p_secondaire(titre_en, langue, S_BANDEAU_VERT_EN, alignement=TA_RIGHT)]],
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


def _bandeau_vert_double(fr1: str, en1: str, fr2: str, en2: str, langue: str = "FR/EN") -> Table:
    def cellule(fr: str, en: str) -> list:
        return [Paragraph(fr, S_BANDEAU_VERT_FR), _p_secondaire(en, langue, S_BANDEAU_VERT_EN_GAUCHE, alignement=TA_LEFT)]

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


def _libelle_secondaire_inline(mot_en: str, langue: str) -> str:
    """Fragment <font> pour la seconde ligne (anglais/arabe) des étiquettes
    du bloc numéro — insérée via <br/> à l'intérieur d'un même Paragraph, ce
    qui interdit d'utiliser _p_secondaire (qui construit un Paragraph
    entier) : la police change donc via l'attribut face= plutôt qu'un style
    de paragraphe séparé."""
    if langue == "FR/AR" and POLICE_ARABE_DISPONIBLE and mot_en in TRADUCTIONS_AR:
        texte_ar = preparer_texte_arabe(TRADUCTIONS_AR[mot_en])
        return f"<font face='{NOM_POLICE_ARABE}' size=9 color='#6b7280'>{texte_ar}</font>"
    return f"<font size=6 color='#6b7280'><i>{mot_en}</i></font>"


def _bloc_numero(passeport: Passeport, langue: str = "FR/EN", echelle: float = 1.0) -> list:
    largeur_case = 5.6 * mm * echelle
    hauteur_case = 6.5 * mm * echelle
    cases_pays = _rangee_cases(list(passeport.numero_pays), largeur_case, hauteur_case)
    cases_annee = _rangee_cases(list(passeport.numero_annee), largeur_case, hauteur_case)
    cases_lot = _rangee_cases(list(passeport.numero_lot), largeur_case, hauteur_case)

    ligne_labels = Table(
        [
            [
                Paragraph(f"Pays<br/>{_libelle_secondaire_inline('Country', langue)}", S_LABEL_CHAMP),
                "",
                Paragraph(f"Année<br/>{_libelle_secondaire_inline('Year', langue)}", S_LABEL_CHAMP),
                "",
                Paragraph(f"N° de lot<br/>{_libelle_secondaire_inline('Batch no.', langue)}", S_LABEL_CHAMP),
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


def _page_1(passeport: Passeport, langue: str = "FR/EN") -> list:
    elements = []
    if CHEMIN_LOGO.exists():
        largeur_logo = 55 * mm
        hauteur_logo = largeur_logo * (184 / 768)
        elements.append(Image(str(CHEMIN_LOGO), width=largeur_logo, height=hauteur_logo, hAlign="CENTER"))
        elements.append(Spacer(1, 5 * mm))

    elements += [
        Paragraph("COMMISSION ÉCONOMIQUE DU BÉTAIL, DE LA VIANDE<br/>ET DES RESSOURCES HALIEUTIQUES", S_ENTETE_ORG),
        Spacer(1, 6 * mm),
        Paragraph("PASSEPORT POUR BÉTAIL", S_TITRE),
        _p_secondaire("PASSPORT FOR CATTLE", langue, S_SOUS_TITRE_ANG),
        Spacer(1, 4 * mm),
        HRFlowable(width="100%", thickness=1.5, color=OR, spaceAfter=6 * mm),
        Paragraph("Numéro du Passeport", ParagraphStyle("PPBNumTitre", parent=S_SECTION_TITRE, fontSize=10, alignment=TA_CENTER)),
        _p_secondaire(
            "Passport number — généré automatiquement", langue,
            ParagraphStyle("PPBNumSous", parent=S_SECTION_SOUS, alignment=TA_CENTER, spaceAfter=3),
        ),
        Spacer(1, 2 * mm),
    ]
    conteneur = Table([[_bloc_numero(passeport, langue=langue)]], colWidths=[LARGEUR_UTILE])
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


def _page_2(passeport: Passeport, qr_png_bytes: bytes, textes_legaux: list, langue: str = "FR/EN") -> list:
    elements = [
        Paragraph("MENTIONS LÉGALES · LEGAL NOTICE", S_BANDEAU_TITRE),
        Paragraph("Cadre juridique du document", S_SECTION_TITRE),
        _p_secondaire("Legal framework of the document", langue, S_SECTION_SOUS),
    ]
    for fr, secondaire in textes_legaux:
        elements.append(Paragraph(f"•&nbsp;&nbsp;{fr}", S_LEGAL_FR))
        if langue == "FR/AR" and POLICE_ARABE_DISPONIBLE:
            style_legal_ar = ParagraphStyle(
                "PPBLegalAr", parent=S_LEGAL_EN, fontName=NOM_POLICE_ARABE,
                fontSize=S_LEGAL_EN.fontSize + 2.5, leading=S_LEGAL_EN.leading + 3, alignment=TA_RIGHT,
            )
            elements.append(Paragraph(preparer_texte_arabe(secondaire), style_legal_ar))
        else:
            elements.append(Paragraph(secondaire, S_LEGAL_EN))
        elements.append(Spacer(1, 3 * mm))

    elements.append(Spacer(1, 3 * mm))
    elements.append(_bandeau_vert("VOLET D'IDENTIFICATION DU DOCUMENT", "Document identification panel", langue=langue))
    elements.append(Spacer(1, 3 * mm))

    legende_codes = Paragraph(
        "01 CMR · 02 CAF · 03 COG · 04 GAB · 05 GNQ · 06 TCD",
        ParagraphStyle("PPBLegende", parent=S_CASE_LABEL, fontSize=6.5, spaceBefore=3),
    )
    colonne_gauche = (
        [
            Paragraph("Numéro du Passeport", ParagraphStyle("PPBNumTitre2", parent=S_SECTION_TITRE, fontSize=8.5)),
            _p_secondaire(
                "Passport number — généré automatiquement", langue,
                ParagraphStyle("PPBNumSous2", parent=S_SECTION_SOUS, fontSize=6.5, spaceAfter=2),
            ),
        ]
        + _bloc_numero(passeport, langue=langue, echelle=0.85)
        + [legende_codes]
    )

    image_qr = Image(BytesIO(qr_png_bytes), width=26 * mm, height=26 * mm)
    style_code_verif = ParagraphStyle(
        "PPBCodeVerif", parent=S_LABEL_CHAMP, alignment=TA_CENTER, fontName="Courier-Bold", fontSize=11, textColor=VERT,
    )
    colonne_droite = [
        image_qr,
        Spacer(1, 1.5 * mm),
        Paragraph("QR Code de validation", ParagraphStyle("PPBQrTitre", parent=S_LABEL_CHAMP, alignment=TA_CENTER)),
        _p_secondaire(
            "Validation QR Code", langue,
            ParagraphStyle("PPBQrSous", parent=S_LABEL_CHAMP_EN, alignment=TA_CENTER), alignement=TA_CENTER,
        ),
        Spacer(1, 2 * mm),
        # Code court à comparer VISUELLEMENT avec ce que l'app de contrôle
        # affiche après le scan (voir Passeport.code_verification) — espacé
        # lettre par lettre pour rester lisible même reproduit petit.
        Paragraph(" ".join(passeport.code_verification), style_code_verif),
        Paragraph("Code de vérification", ParagraphStyle("PPBCodeVerifLabel", parent=S_LABEL_CHAMP_EN, alignment=TA_CENTER)),
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


def _page_3(langue: str = "FR/EN") -> list:
    entete_proprietaire = _bandeau_vert_double("PROPRIÉTAIRE", "Livestock owner", "CONVOYEUR", "Livestock conveyor", langue=langue)

    def bloc_personne() -> list:
        return (
            _champ_avec_cases("Nom et prénom", "First and last name", 10, langue=langue)
            + [Spacer(1, 3 * mm)]
            + _champ_avec_cases("N° CNI", "National ID number", 10, langue=langue)
            + [Spacer(1, 3 * mm)]
            + _champ_avec_cases("Téléphone", "Phone number", 10, langue=langue)
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

    champ_origine_pays = _champ_avec_cases("Origine — Pays / Localité", "Origin — Country / Locality", 10, langue=langue, largeur_case=5.0 * mm)
    champ_dest_pays = _champ_avec_cases("Destination — Pays / Localité", "Destination — Country / Locality", 10, langue=langue, largeur_case=5.0 * mm)
    table_od_1 = Table([[champ_origine_pays, champ_dest_pays]], colWidths=[LARGEUR_UTILE / 2] * 2)
    table_od_1.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))

    champ_origine_prov = _champ_avec_cases("Origine — Province / Région", "Origin — Province / Region", 10, langue=langue, largeur_case=5.0 * mm)
    champ_dest_prov = _champ_avec_cases("Destination — Province / Région", "Destination — Province / Region", 10, langue=langue, largeur_case=5.0 * mm)
    table_od_2 = Table([[champ_origine_prov, champ_dest_prov]], colWidths=[LARGEUR_UTILE / 2] * 2)
    table_od_2.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))

    entete_itineraire = [Paragraph("N°", S_TABLE_ENTETE)] + [
        _entete_bilingue(t, langue) for t in ["Poste / localité traversée", "Date de passage", "Visa"]
    ]
    lignes_itineraire = [entete_itineraire]
    for n in range(1, 4):
        lignes_itineraire.append([str(n), "", "", ""])
    largeur_poste = LARGEUR_UTILE - 8 * mm - 24 * mm - 20 * mm
    # Hauteur de la ligne d'en-tête laissée automatique (None) plutôt que
    # figée : « Date de passage » + sa traduction arabe côte à côte peuvent
    # se replier sur 2 lignes dans une colonne de 24mm — une hauteur fixe
    # trop petite provoquait un débordement visuel au-dessus de la cellule.
    table_itineraire = Table(lignes_itineraire, colWidths=[8 * mm, largeur_poste, 24 * mm, 20 * mm], rowHeights=[None] + [8 * mm] * 3)
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
        _p_secondaire("Identification and route", langue, S_SECTION_SOUS),
        entete_proprietaire,
        table_personnes,
        Spacer(1, 4 * mm),
        _bandeau_vert("ORIGINE ET DESTINATION DES ANIMAUX", "Origin and destination of animals", langue=langue),
        Spacer(1, 3 * mm),
        table_od_1,
        Spacer(1, 3 * mm),
        table_od_2,
        Spacer(1, 4 * mm),
        _bandeau_vert("ITINÉRAIRE EMPRUNTÉ", "Route taken", langue=langue),
        Spacer(1, 3 * mm),
        table_itineraire,
    ]


def _page_4(passeport: Passeport, langue: str = "FR/EN") -> list:
    maladies = [
        ("Peste des Petits Ruminants", "Pest of small ruminants"),
        ("Péripneumonie contagieuse", "Contagious bovine peripneumonia"),
        ("Charbon", "Anthrax"),
        ("Trypanosomiase", "Trypanosomiasis"),
    ]

    def bloc_maladie(fr: str, en: str) -> list:
        entete = Table(
            [[
                [Paragraph(fr, S_LABEL_CHAMP), _p_secondaire(en, langue, S_LABEL_CHAMP_EN, alignement=TA_LEFT)],
                Paragraph("<u>Cachet</u>", S_CACHET),
            ]],
            colWidths=[None, 20 * mm],
        )
        entete.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("ALIGN", (1, 0), (1, 0), "RIGHT"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
        return [
            entete,
            Spacer(1, 0.5 * mm),
            Paragraph("Date :", S_CASE_LABEL),
            _rangee_cases([""] * 8, largeur_case=4.6 * mm, hauteur=4.2 * mm),
            Spacer(1, 0.5 * mm),
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
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )

    entete_haut = ["Espèces", "Mâles", "Femelles", "", "", "TOTAL"]
    entete_bas = ["", "", "Jeunes", "Adultes", "Total", ""]

    def _entete_bilingue_etroite(texte_fr: str) -> Paragraph:
        """Variante compacte de _entete_bilingue — police secondaire réduite,
        pour les colonnes Jeunes/Adultes/Total (~20mm, plus étroites que les
        autres en-têtes de ce document)."""
        if langue == "FR/AR" and POLICE_ARABE_DISPONIBLE and texte_fr in TRADUCTIONS_AR:
            texte_ar = preparer_texte_arabe(TRADUCTIONS_AR[texte_fr])
            return Paragraph(f"{texte_fr}<br/><font face='{NOM_POLICE_ARABE}' size=6>{texte_ar}</font>", S_TABLE_ENTETE)
        if langue == "FR/EN" and texte_fr in TRADUCTIONS_EN:
            return Paragraph(f"{texte_fr}<br/><i><font size=6 color='#d1e7dd'>{TRADUCTIONS_EN[texte_fr]}</font></i>", S_TABLE_ENTETE)
        return Paragraph(texte_fr, S_TABLE_ENTETE)

    lignes_troupeau = [
        [_entete_bilingue(t, langue) if t else "" for t in entete_haut],
        # Jeunes/Adultes/Total : colonnes trop étroites pour le côte-à-côte
        # (contrairement aux autres en-têtes) — repli sur un empilement
        # compact (police réduite), la ligne d'en-tête étant de toute façon
        # à hauteur automatique (voir plus bas) et non plus figée.
        [_entete_bilingue_etroite(t) if t else "" for t in entete_bas],
    ]
    for espece in ["Bovins", "Ovins", "Caprins", "Camelins", "Autres : ____"]:
        cellule_espece = _entete_bilingue(espece, langue, style_base=S_LABEL_CHAMP) if langue in ("FR/AR", "FR/EN") else espece
        lignes_troupeau.append([cellule_espece, "", "", "", "", ""])
    largeur_espece = LARGEUR_UTILE * 0.28
    largeur_reste = (LARGEUR_UTILE - largeur_espece) / 5
    hauteur_ligne_espece = 6 * mm
    hauteur_entete_troupeau = 5 * mm
    table_troupeau = Table(
        lignes_troupeau,
        colWidths=[largeur_espece] + [largeur_reste] * 5,
        rowHeights=[None, None] + [hauteur_ligne_espece] * 5,
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

    entete_visas = [Paragraph("N°", S_TABLE_ENTETE)] + [
        _entete_bilingue(t, langue) for t in ["Poste", "Date", "Agent", "Visa"]
    ]
    lignes_visas = [entete_visas]
    for n in range(1, 4):
        lignes_visas.append([str(n), "", "", "", ""])
    largeur_fixe = 8 * mm + 20 * mm + 26 * mm
    largeur_restante = LARGEUR_UTILE - largeur_fixe
    hauteur_entete_visas = 6 * mm
    table_visas = Table(
        lignes_visas,
        colWidths=[8 * mm, largeur_restante * 0.55, 20 * mm, 26 * mm, largeur_restante * 0.45],
        rowHeights=[None] + [6 * mm] * 3,
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
                ("TOPPADDING", (0, 0), (-1, -1), 1),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
            ]
        )
    )

    phrase_note = "Traitements préventifs (vaccins) ou curatifs réalisés ou vérifiés."
    if langue == "FR/AR" and POLICE_ARABE_DISPONIBLE:
        style_note_ar = ParagraphStyle("PPBNoteAr", parent=S_NOTE, fontName=NOM_POLICE_ARABE, fontSize=S_NOTE.fontSize + 2)
        ligne_note_secondaire = Paragraph(preparer_texte_arabe(TRADUCTIONS_AR[phrase_note]), style_note_ar)
    elif langue == "FR/EN":
        ligne_note_secondaire = Paragraph(TRADUCTIONS_EN[phrase_note], S_NOTE)
    else:
        ligne_note_secondaire = Spacer(0, 0)

    return [
        Paragraph("SANTÉ · CHEPTEL · CONTRÔLE", S_BANDEAU_TITRE),
        Paragraph("État sanitaire, cheptel et contrôle", S_SECTION_TITRE),
        _p_secondaire("Health, herd and control", langue, S_SECTION_SOUS),
        Paragraph(phrase_note, S_NOTE),
        ligne_note_secondaire,
        Spacer(1, 0.5 * mm),
        table_maladies,
        Spacer(1, 0.5 * mm),
        _bandeau_vert("COMPOSITION DU TROUPEAU", "Herd composition", langue=langue),
        Spacer(1, 1 * mm),
        table_troupeau,
        Spacer(1, 1 * mm),
        _bandeau_vert("VISAS DE CONTRÔLE AUX POSTES FRONTALIERS", "Border control post visas", langue=langue),
        Spacer(1, 1 * mm),
        table_visas,
        Spacer(1, 1 * mm),
        _bandeau_vert("ZONE DE LECTURE AUTOMATIQUE", "Machine readable zone", langue=langue),
        Spacer(1, 1 * mm),
        boite_mrz,
        Paragraph(
            "Zone pré-formatée réservée aux données d'identification lisibles automatiquement (sans QR Code). "
            "Écrire en lettres MAJUSCULES, une par case, à l'encre noire.",
            S_NOTE,
        ),
        Spacer(1, 0.5 * mm),
        Paragraph("CEBEVIRHA — Commission Économique du Bétail, de la Viande et des Ressources Halieutiques", S_PIED),
    ]


def _dessiner_guilloche(canvas_obj, x: float, y: float, largeur: float, hauteur: float) -> None:
    """Motif ondulé de sécurité (guilloché), en approximation — bandes de
    sinusoïdes superposées, dans l'esprit du filigrane du gabarit de
    référence (jamais destiné à égaler un vrai guilloché d'imprimerie
    sécuritaire, seulement à en évoquer visuellement la texture)."""
    import math

    canvas_obj.saveState()
    canvas_obj.setStrokeColor(colors.HexColor("#cfe3d8"))
    canvas_obj.setLineWidth(0.4)
    pas = 3.2 * mm
    amplitude = 1.3 * mm
    periode = 9 * mm
    nb_vagues = 3
    for k in range(nb_vagues):
        dephasage = k * (periode / nb_vagues)
        chemin = canvas_obj.beginPath()
        premier = True
        t = 0.0
        while t <= hauteur:
            dx = amplitude * math.sin(2 * math.pi * (t + dephasage) / periode)
            if premier:
                chemin.moveTo(x + dx, y + t)
                premier = False
            else:
                chemin.lineTo(x + dx, y + t)
            t += pas / 4
        canvas_obj.drawPath(chemin, stroke=1, fill=0)
    canvas_obj.restoreState()


def _fond_page(canvas_obj, doc) -> None:
    # Bandes guillochées à L'EXTÉRIEUR du cadre, des deux côtés (gauche et
    # droit) — entre le bord de page et le rectangle vert, jamais superposées
    # au contenu ni au cadre lui-même.
    _dessiner_guilloche(canvas_obj, 2 * mm, 4 * mm, 4 * mm, HAUTEUR - 8 * mm)
    _dessiner_guilloche(canvas_obj, LARGEUR - 2 * mm, 4 * mm, 4 * mm, HAUTEUR - 8 * mm)

    canvas_obj.saveState()
    canvas_obj.setStrokeColor(VERT)
    canvas_obj.setLineWidth(0.8)
    canvas_obj.rect(4 * mm, 4 * mm, LARGEUR - 8 * mm, HAUTEUR - 8 * mm)
    canvas_obj.restoreState()

    canvas_obj.saveState()
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


def _textes_legaux_pour_langue(langue: str, textes_legaux: list | None) -> list:
    """En FR/AR, les textes légaux personnalisés (validés via le Module
    Administration, toujours des paires français/anglais — voir
    app.api.v1.endpoints.passeports._obtenir_textes_legaux) ne s'appliquent
    pas : il n'existe pas encore de circuit de validation FR/AR pour ce
    contenu. On retombe systématiquement sur les mentions par défaut
    appariées à leur traduction arabe (TEXTES_LEGAUX_AR)."""
    if langue == "FR/AR":
        fr_par_defaut = [fr for fr, _ in TEXTES_LEGAUX_PAR_DEFAUT]
        return list(zip(fr_par_defaut, TEXTES_LEGAUX_AR))
    return textes_legaux or TEXTES_LEGAUX_PAR_DEFAUT


def generer_document_passeport_pdf(
    passeport: Passeport, textes_legaux: list | None = None, langue_version: str = "FR/EN"
) -> bytes:
    """Document imprimable A5, 4 pages, pour UN passeport. `langue_version`
    ("FR/EN" ou "FR/AR") vient de Commande.langue_version — voir
    app.api.v1.endpoints.passeports.document_passeport, qui va chercher la
    commande associée pour la déterminer."""
    textes = _textes_legaux_pour_langue(langue_version, textes_legaux)
    qr_png_bytes = base64.b64decode(generer_qrcode_png_base64(passeport.qr_uuid))

    tampon = BytesIO()
    document = _construire_document(tampon)

    elements: list = []
    elements += _page_1(passeport, langue=langue_version)
    elements.append(PageBreak())
    elements += _page_2(passeport, qr_png_bytes, textes, langue=langue_version)
    elements.append(PageBreak())
    elements += _page_3(langue=langue_version)
    elements.append(PageBreak())
    elements += _page_4(passeport, langue=langue_version)

    document.build(elements)
    return tampon.getvalue()


def generer_document_lot_pdf(
    passeports: list, textes_legaux: list | None = None, langue_version: str = "FR/EN"
) -> bytes:
    """Concatène le document 4 pages de plusieurs passeports en un seul PDF —
    pour imprimer un lot complet en une fois (Module 3, impression centralisée).
    Un seul `langue_version` pour tout le lot : cohérent avec le fait qu'un
    lot provient d'une seule commande, elle-même à une seule langue_version."""
    textes = _textes_legaux_pour_langue(langue_version, textes_legaux)
    qr_cache: dict = {}

    tampon = BytesIO()
    document = _construire_document(tampon)

    elements: list = []
    for index, passeport in enumerate(passeports):
        if passeport.qr_uuid not in qr_cache:
            qr_cache[passeport.qr_uuid] = base64.b64decode(generer_qrcode_png_base64(passeport.qr_uuid))
        elements += _page_1(passeport, langue=langue_version)
        elements.append(PageBreak())
        elements += _page_2(passeport, qr_cache[passeport.qr_uuid], textes, langue=langue_version)
        elements.append(PageBreak())
        elements += _page_3(langue=langue_version)
        elements.append(PageBreak())
        elements += _page_4(passeport, langue=langue_version)
        if index < len(passeports) - 1:
            elements.append(PageBreak())

    document.build(elements)
    return tampon.getvalue()
