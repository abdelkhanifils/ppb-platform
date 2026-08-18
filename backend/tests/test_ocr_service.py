"""Tests du Module 4 — OCR assisté (pages 3/4).

Deux niveaux, cohérents avec ce qui est réellement vérifiable ici :
1. La logique d'extraction pure (regroupement en lignes, ancrage sur les
   libellés, lecture de la valeur associée) — testée avec des données
   simulées reproduisant la structure d'une réponse Google Vision. C'est le
   seul niveau qui peut être sincèrement qualifié de « testé » : aucune
   clé API n'était disponible au moment d'écrire ce module (voir
   ocr_service.py, avertissement en tête de fichier) — l'appel réseau
   lui-même n'a jamais pu être exercé pour de vrai.
2. Le comportement de l'endpoint quand la clé API est absente (503, jamais
   une erreur opaque) et les contrôles RBAC — ceux-ci n'ont pas besoin d'un
   vrai appel réseau pour être vérifiés.
"""
import pytest

from app.services.attribution import attribuer_passeports_pour_commande
from app.services.ocr_service import extraire_champs_page3, extraire_champs_page4


def _mot(texte: str, x: int, y: int, largeur: int | None = None, hauteur: int = 18) -> dict:
    largeur = largeur or (len(texte) * 9 + 4)
    return {"texte": texte, "x_min": x, "x_max": x + largeur, "y_min": y, "y_max": y + hauteur}


# --- Extraction page 3 --------------------------------------------------------------------


def test_extraction_page3_distingue_proprietaire_et_convoyeur():
    """Le même libellé apparaît deux fois sur la page (colonne gauche =
    Propriétaire, colonne droite = Convoyeur) — l'ordre gauche->droite doit
    être respecté, jamais mélangé."""
    mots = [
        *[_mot(m, x, 100) for m, x in zip(["Nom", "et", "prénom"], [30, 75, 105])],
        *[_mot(m, x, 100) for m, x in zip(["Nom", "et", "prénom"], [430, 475, 505])],
        _mot("BRAHIM", 30, 125),
        _mot("ALIOU", 430, 125),
    ]

    resultat = extraire_champs_page3(mots)

    assert resultat["eleveur"]["nom_prenom"] == "BRAHIM"
    assert resultat["convoyeur"]["nom_prenom"] == "ALIOU"


def test_extraction_page3_ignore_la_ponctuation_du_libelle():
    """« Origine — Province / Région » doit être reconnu malgré les tirets
    et barres obliques isolés — bug réel rencontré et corrigé pendant le
    développement de cette fonctionnalité."""
    mots = [
        *[_mot(m, x, 400) for m, x in zip(["Origine", "—", "Province", "/", "Région"], [30, 110, 130, 220, 235])],
        _mot("Extrême-Nord", 30, 425),
    ]

    resultat = extraire_champs_page3(mots)

    assert resultat["itineraire"]["province_origine"] == "Extrême-Nord"


def test_extraction_page3_champ_non_rempli_reste_absent():
    """Un libellé trouvé mais rien écrit dessous (case vide sur le papier)
    ne doit jamais produire une valeur inventée."""
    mots = [_mot(m, x, 100) for m, x in zip(["Nom", "et", "prénom"], [30, 75, 105])]

    resultat = extraire_champs_page3(mots)

    assert "nom_prenom" not in resultat["eleveur"]


def test_extraction_page3_sur_liste_vide_ne_plante_pas():
    assert extraire_champs_page3([]) == {"eleveur": {}, "convoyeur": {}, "itineraire": {}}


# --- Extraction page 4 --------------------------------------------------------------------


def test_extraction_page4_lit_le_tableau_troupeau():
    mots = [
        _mot("Bovins", 30, 300), _mot("5", 250, 300), _mot("3", 320, 300), _mot("7", 390, 300), _mot("15", 460, 300),
        _mot("Ovins", 30, 340), _mot("2", 250, 340), _mot("1", 320, 340), _mot("4", 390, 340), _mot("7", 460, 340),
    ]

    resultat = extraire_champs_page4(mots)

    assert len(resultat["effectifs"]) == 2
    bovins = next(e for e in resultat["effectifs"] if e["espece"] == "bovin")
    assert bovins == {"espece": "bovin", "nombre_males": 5, "nombre_femelles_jeunes": 3, "nombre_femelles_adultes": 7, "nombre_total": 15}


def test_extraction_page4_lit_les_dates_de_vaccination():
    mots = [
        *[_mot(m, x, 500) for m, x in zip(["Peste", "des", "Petits", "Ruminants"], [30, 90, 120, 175])],
        _mot("10", 30, 525), _mot("01", 60, 525), _mot("2026", 90, 525),
    ]

    resultat = extraire_champs_page4(mots)

    assert len(resultat["vaccinations"]) == 1
    assert resultat["vaccinations"][0] == {"maladie": "peste_petits_ruminants", "date_vaccination": "10 01 2026", "lieu": None}


def test_extraction_page4_espece_sans_4_nombres_ignoree():
    """Une ligne où l'OCR n'a reconnu que 2 des 4 nombres (chiffre illisible,
    tache d'encre...) ne doit jamais produire un effectif à moitié inventé."""
    mots = [_mot("Caprins", 30, 380), _mot("3", 250, 380), _mot("1", 320, 380)]

    resultat = extraire_champs_page4(mots)

    assert resultat["effectifs"] == []


# --- Endpoint : repli propre sans clé API, et RBAC ----------------------------------------


@pytest.mark.asyncio
async def test_ocr_endpoint_sans_cle_api_renvoie_503(client, db, agent_emission_cmr, admin_national_cmr, pays_cameroun):
    """settings.GOOGLE_VISION_SERVICE_ACCOUNT_JSON_B64 est vide dans l'environnement de
    test (comme en développement tant que la clé n'a pas été fournie) — le
    formulaire manuel doit rester la seule voie, sans erreur opaque."""
    from app.models.commande import Commande, StatutCommande

    user_admin, _ = admin_national_cmr
    _, entetes_agent = agent_emission_cmr
    commande = Commande(
        pays_id=pays_cameroun.id, quantite=1, langue_version="FR/EN", mode_impression="centralisee",
        montant_total=1500, statut=StatutCommande.PAYEE, responsable_nom="Test", cree_par_id=user_admin.id,
    )
    db.add(commande)
    await db.commit()
    await db.refresh(commande)
    passeport = (await attribuer_passeports_pour_commande(db, commande))[0]
    await db.commit()

    reponse = await client.post(
        f"/api/v1/numerisations/{passeport.id}/pages/3/ocr",
        headers=entetes_agent,
        files={"photo": ("page3.jpg", b"contenu-image-factice", "image/jpeg")},
    )

    assert reponse.status_code == 503


@pytest.mark.asyncio
async def test_ocr_endpoint_page_invalide_rejetee(client, agent_emission_cmr):
    _, entetes_agent = agent_emission_cmr
    reponse = await client.post(
        "/api/v1/numerisations/un-id-quelconque/pages/2/ocr",
        headers=entetes_agent,
        files={"photo": ("page2.jpg", b"x", "image/jpeg")},
    )
    assert reponse.status_code in (404, 422)  # 404 si l'id n'existe pas est vérifié avant 422 selon l'ordre — les deux sont acceptables ici


@pytest.mark.asyncio
async def test_ocr_endpoint_refuse_agent_autre_pays(client, db, agent_emission_cmr, agent_emission_tcd, admin_national_cmr, pays_cameroun):
    from app.models.commande import Commande, StatutCommande

    user_admin, _ = admin_national_cmr
    _, entetes_agent_tcd = agent_emission_tcd
    commande = Commande(
        pays_id=pays_cameroun.id, quantite=1, langue_version="FR/EN", mode_impression="centralisee",
        montant_total=1500, statut=StatutCommande.PAYEE, responsable_nom="Test", cree_par_id=user_admin.id,
    )
    db.add(commande)
    await db.commit()
    await db.refresh(commande)
    passeport = (await attribuer_passeports_pour_commande(db, commande))[0]
    await db.commit()

    reponse = await client.post(
        f"/api/v1/numerisations/{passeport.id}/pages/3/ocr",
        headers=entetes_agent_tcd,
        files={"photo": ("page3.jpg", b"x", "image/jpeg")},
    )

    assert reponse.status_code == 403
