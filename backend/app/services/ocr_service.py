"""
OCR assisté (Module 4, pages 3 et 4) — reconnaissance automatique du
contenu manuscrit d'une page de PPB photographiée, pour pré-remplir le
formulaire de saisie plutôt que de le laisser entièrement vide. L'agent
reste TOUJOURS libre de corriger chaque champ ensuite — jamais une saisie
imposée (voir frontend, Page3Identification/Page4Troupeau, mode "pré-rempli").

Principe de l'extraction : le gabarit du PPB (voir pdf_passeport.py) a des
libellés IMPRIMÉS fixes et connus à l'avance ("Nom et prénom", "N° CNI",
"Bovins", ...) — l'OCR du texte imprimé est fiable, bien plus que celui de
l'écriture manuscrite. On cherche donc chaque libellé dans le texte reconnu,
puis on prend le texte manuscrit situé juste EN DESSOUS (ou à droite pour un
tableau) comme valeur du champ — un ancrage relatif à du texte connu, plus
robuste face à une photo prise à main levée qu'une position absolue en
pixels sur la page.

AVERTISSEMENT HONNÊTE : cette heuristique n'a jamais pu être testée avec de
vraies photos ni un vrai appel réseau à Google Vision — seul un bac à sable
sans accès Internet a servi à écrire ce module. Un compte de service
Google Cloud a bien été fourni et testé (authentification : construction
du JWT signé, vérifiée cryptographiquement avec la clé publique
correspondante — voir tests/test_ocr_service.py), donc l'AUTHENTIFICATION
est du code réel, testé avec les vraies données. Ce qui reste NON vérifié :
l'appel HTTP effectif à l'API Vision (aucun appel réseau sortant possible
ici) et, surtout, la qualité de reconnaissance sur une vraie photo prise à
main levée. Seule la logique d'extraction (regroupement en lignes,
recherche de libellés, lecture de la valeur associée) a été vérifiée avec
des données simulées reproduisant la structure attendue d'une réponse
Google Vision. Un ajustement sera presque certainement nécessaire une fois
testé sur des photos réelles — c'est attendu, pas un signe d'échec.
"""
import base64
import json
import re
import time
import unicodedata

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

from app.core.config import settings

URL_GOOGLE_VISION = "https://vision.googleapis.com/v1/images:annotate"
PORTEE_CLOUD_PLATFORM = "https://www.googleapis.com/auth/cloud-platform"

# Jeton d'accès mis en cache en mémoire (par processus) — un jeton OAuth2
# Google dure environ 1h, inutile d'en redemander un à chaque photo. Rejeté
# 60 secondes avant sa vraie expiration par prudence (latence réseau).
_jeton_cache: dict = {"valeur": None, "expire_a": 0.0}


class OcrIndisponible(Exception):
    """Aucun compte de service configuré, jeton impossible à obtenir, ou
    appel au service échoué — jamais une exception qui remonte comme une
    erreur 500 opaque : l'appelant (voir l'endpoint dans
    app/api/v1/endpoints/numerisations.py) la transforme en réponse claire,
    et le formulaire manuel reste utilisable dans tous les cas."""


def _charger_identifiants() -> dict:
    if not settings.GOOGLE_VISION_SERVICE_ACCOUNT_JSON_B64:
        raise OcrIndisponible("Aucun compte de service Google Cloud configuré (GOOGLE_VISION_SERVICE_ACCOUNT_JSON_B64).")
    try:
        brut = base64.b64decode(settings.GOOGLE_VISION_SERVICE_ACCOUNT_JSON_B64)
        return json.loads(brut)
    except (ValueError, json.JSONDecodeError) as exc:
        raise OcrIndisponible(f"GOOGLE_VISION_SERVICE_ACCOUNT_JSON_B64 illisible : {exc}") from exc


def _b64url(donnees: bytes) -> str:
    return base64.urlsafe_b64encode(donnees).rstrip(b"=").decode("ascii")


def _construire_jwt_signe(identifiants: dict) -> str:
    """Jeton d'assertion signé (RFC 7523, JWT Bearer Token Flow) — la brique
    d'authentification d'un compte de service Google Cloud, sans dépendre
    de la bibliothèque officielle `google-auth` (déjà `cryptography` dans ce
    projet pour la signature ECDSA du QR Code — RSA/SHA256 ici, même
    bibliothèque, pas de dépendance supplémentaire)."""
    maintenant = int(time.time())
    entete = {"alg": "RS256", "typ": "JWT"}
    revendications = {
        "iss": identifiants["client_email"],
        "scope": PORTEE_CLOUD_PLATFORM,
        "aud": identifiants["token_uri"],
        "exp": maintenant + 3600,
        "iat": maintenant,
    }
    segment = _b64url(json.dumps(entete, separators=(",", ":")).encode()) + "." + _b64url(
        json.dumps(revendications, separators=(",", ":")).encode()
    )
    cle_privee = serialization.load_pem_private_key(identifiants["private_key"].encode(), password=None)
    signature = cle_privee.sign(segment.encode(), padding.PKCS1v15(), hashes.SHA256())
    return f"{segment}.{_b64url(signature)}"


async def _obtenir_jeton_acces() -> str:
    if _jeton_cache["valeur"] and time.time() < _jeton_cache["expire_a"]:
        return _jeton_cache["valeur"]

    identifiants = _charger_identifiants()
    assertion = _construire_jwt_signe(identifiants)
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            reponse = await client.post(
                identifiants["token_uri"],
                data={"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": assertion},
            )
            reponse.raise_for_status()
            donnees = reponse.json()
    except httpx.HTTPStatusError as exc:
        try:
            detail_google = exc.response.json().get("error_description", exc.response.text)
        except (ValueError, AttributeError):
            detail_google = exc.response.text if exc.response is not None else str(exc)
        raise OcrIndisponible(f"Échec de l'obtention du jeton d'accès Google : {detail_google}") from exc
    except httpx.HTTPError as exc:
        raise OcrIndisponible(f"Échec de l'obtention du jeton d'accès Google : {exc}") from exc

    _jeton_cache["valeur"] = donnees["access_token"]
    _jeton_cache["expire_a"] = time.time() + donnees.get("expires_in", 3600) - 60
    return _jeton_cache["valeur"]


async def appeler_google_vision(image_bytes: bytes) -> list[dict]:
    """Renvoie les mots détectés — liste de
    {"texte": str, "x_min": float, "x_max": float, "y_min": float, "y_max": float}
    en coordonnées PIXEL de l'image envoyée (pas normalisées)."""
    jeton = await _obtenir_jeton_acces()

    corps = {
        "requests": [
            {
                "image": {"content": base64.b64encode(image_bytes).decode("ascii")},
                "features": [{"type": "DOCUMENT_TEXT_DETECTION"}],
                "imageContext": {"languageHints": ["fr"]},
            }
        ]
    }
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            reponse = await client.post(
                URL_GOOGLE_VISION, headers={"Authorization": f"Bearer {jeton}"}, json=corps
            )
            reponse.raise_for_status()
            donnees = reponse.json()
    except httpx.HTTPStatusError as exc:
        # `str(exc)` seul (repli ci-dessous) ne montre que le code HTTP —
        # jamais la vraie raison que Google renvoie (ex. "API non activée",
        # "facturation requise") — pourtant présente dans le corps de la
        # réponse. Bug corrigé ici après un premier diagnostic en aveugle :
        # sans ce détail, un 403 "API non activée" et un 403 "permissions
        # insuffisantes" étaient indiscernables pour qui lit l'erreur.
        try:
            detail_google = exc.response.json().get("error", {}).get("message", exc.response.text)
        except (ValueError, AttributeError):
            detail_google = exc.response.text if exc.response is not None else str(exc)
        raise OcrIndisponible(f"Appel à Google Vision échoué ({exc.response.status_code if exc.response is not None else '?'}) : {detail_google}") from exc
    except httpx.HTTPError as exc:
        raise OcrIndisponible(f"Appel à Google Vision échoué : {exc}") from exc

    reponse_image = donnees.get("responses", [{}])[0]
    if "error" in reponse_image:
        raise OcrIndisponible(f"Google Vision a renvoyé une erreur : {reponse_image['error'].get('message', '?')}")

    annotations = reponse_image.get("textAnnotations", [])
    mots = []
    for annotation in annotations[1:]:  # [0] = texte intégral concaténé, ignoré ici
        sommets = annotation.get("boundingPoly", {}).get("vertices", [])
        if not sommets:
            continue
        xs = [s.get("x", 0) for s in sommets]
        ys = [s.get("y", 0) for s in sommets]
        mots.append({"texte": annotation.get("description", ""), "x_min": min(xs), "x_max": max(xs), "y_min": min(ys), "y_max": max(ys)})
    return mots


def _normaliser(texte: str) -> str:
    """Minuscules, sans accents ni ponctuation — pour comparer un libellé
    attendu au texte reconnu sans être sensible à la casse OCR ou aux signes
    diacritiques mal reconnus."""
    sans_accents = unicodedata.normalize("NFKD", texte).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^\w\s]", "", sans_accents).lower().strip()


def _regrouper_en_lignes(mots: list[dict]) -> list[list[dict]]:
    """Reconstruit des « lignes » de texte à partir de mots isolés, en
    regroupant ceux dont le centre vertical est proche — l'API ne renvoie
    que des mots individuels avec leurs coordonnées, jamais des lignes
    prêtes à l'emploi."""
    mots_tries = sorted(mots, key=lambda m: (m["y_min"] + m["y_max"]) / 2)
    lignes: list[list[dict]] = []
    for mot in mots_tries:
        centre_y = (mot["y_min"] + mot["y_max"]) / 2
        for ligne in lignes:
            centre_ligne = sum((m["y_min"] + m["y_max"]) / 2 for m in ligne) / len(ligne)
            hauteur_moyenne = sum(m["y_max"] - m["y_min"] for m in ligne) / len(ligne)
            if abs(centre_y - centre_ligne) < max(hauteur_moyenne * 0.6, 5):
                ligne.append(mot)
                break
        else:
            lignes.append([mot])
    for ligne in lignes:
        ligne.sort(key=lambda m: m["x_min"])
    lignes.sort(key=lambda ligne: sum((m["y_min"] + m["y_max"]) / 2 for m in ligne) / len(ligne))
    return lignes


def _chercher_libelle_tous(lignes: list[list[dict]], libelle: str) -> list[dict]:
    """Toutes les occurrences d'un libellé (séquence de mots) dans les
    lignes reconstruites, triées de gauche à droite — plusieurs occurrences
    sont attendues pour les libellés dupliqués Propriétaire/Convoyeur (page
    3) ; la gauche est toujours le Propriétaire sur le gabarit. Les mots de
    ponctuation isolée (« — », « / ») se normalisent en chaîne vide et sont
    retirés de la séquence avant comparaison — sinon ils casseraient le
    rapprochement d'un libellé comme "Origine — Province / Région" avec la
    cible recherchée "Origine Province Region"."""
    cible = _normaliser(libelle).split()
    resultats = []
    for i, ligne in enumerate(lignes):
        mots_utiles = [m for m in ligne if _normaliser(m["texte"])]
        mots_normalises = [_normaliser(m["texte"]) for m in mots_utiles]
        for debut in range(len(mots_normalises) - len(cible) + 1):
            if mots_normalises[debut : debut + len(cible)] == cible:
                sous_ligne = mots_utiles[debut : debut + len(cible)]
                resultats.append(
                    {
                        "ligne_index": i,
                        "x_min": min(m["x_min"] for m in sous_ligne),
                        "x_max": max(m["x_max"] for m in sous_ligne),
                        "y_max": max(m["y_max"] for m in sous_ligne),
                    }
                )
    resultats.sort(key=lambda r: r["x_min"])
    return resultats


def _valeur_sous(lignes: list[list[dict]], position_libelle: dict, largeur_colonne: float = 320) -> str:
    """Texte manuscrit trouvé sous un libellé repéré, dans une bande
    verticale alignée avec lui.

    Bug réel corrigé ici, découvert sur une vraie photo de test (pas une
    donnée simulée) : le gabarit place SYSTÉMATIQUEMENT une ligne de
    sous-titre (traduction anglaise, ex. « Phone number » sous
    « Téléphone », voir pdf_passeport.py::_champ_avec_cases) entre le
    libellé français et la véritable rangée de cases manuscrites — parfois
    même une deuxième ligne de préfixe (« Date : », pour les maladies en
    page 4). Sans cette liste, ce sous-titre était pris pour la réponse
    elle-même (« Téléphone » récupérait le mot « Phone », pas le numéro
    écrit à la main). On saute maintenant toute ligne dont le texte
    correspond à un sous-titre/préfixe CONNU du gabarit, plutôt que de
    compter un nombre fixe de lignes à ignorer — plus robuste face aux
    petites variations de mise en page d'une vraie photo."""
    for ligne in lignes[position_libelle["ligne_index"] + 1 : position_libelle["ligne_index"] + 5]:
        candidats = [
            m
            for m in ligne
            if position_libelle["x_min"] - 30 <= (m["x_min"] + m["x_max"]) / 2 <= position_libelle["x_min"] + largeur_colonne
        ]
        if not candidats:
            continue
        candidats.sort(key=lambda m: m["x_min"])
        texte = " ".join(m["texte"] for m in candidats)
        if _normaliser(texte) in _LIGNES_A_IGNORER:
            continue
        return texte
    return ""


# Sous-titres et préfixes imprimés connus du gabarit (voir pdf_passeport.py)
# — jamais une réponse manuscrite, toujours ignorés par _valeur_sous.
_LIGNES_A_IGNORER = {
    _normaliser(t)
    for t in [
        "First and last name", "National ID number", "Phone number",
        "Origin Country Locality", "Destination Country Locality",
        "Origin Province Region", "Destination Province Region",
        "Date", "Date JJ MM AAAA", "Lieu Place",
        "Pest of small ruminants", "Contagious bovine peripneumonia",
        "Anthrax", "Trypanosomiasis",
    ]
}


LIBELLES_PERSONNE = [("Nom et prenom", "nom_prenom"), ("N CNI", "numero_cni"), ("Telephone", "telephone")]

LIBELLES_ITINERAIRE = [
    ("Origine Province Region", "province_origine"),
    ("Destination Province Region", "province_destination"),
    ("Origine Pays Localite", "localite_origine"),
    ("Destination Pays Localite", "localite_destination"),
]

LIBELLES_ESPECES = [("Bovins", "bovin"), ("Ovins", "ovin"), ("Caprins", "caprin"), ("Camelins", "camelin")]

LIBELLES_MALADIES = [
    ("Peste des Petits Ruminants", "peste_petits_ruminants"),
    ("Peripneumonie contagieuse", "peripneumonie_contagieuse"),
    ("Charbon", "charbon"),
    ("Trypanosomiase", "trypanosomiase"),
]


def extraire_champs_page3(mots: list[dict]) -> dict:
    """{"eleveur": {...}, "convoyeur": {...}, "itineraire": {...}} — champs
    absents du dict quand rien n'a été reconnu avec confiance (jamais une
    chaîne vide qui aurait l'air d'une vraie lecture)."""
    lignes = _regrouper_en_lignes(mots)
    resultat: dict = {"eleveur": {}, "convoyeur": {}, "itineraire": {}}

    for libelle, cle in LIBELLES_PERSONNE:
        occurrences = _chercher_libelle_tous(lignes, libelle)
        if len(occurrences) >= 1:
            valeur = _valeur_sous(lignes, occurrences[0])
            if valeur:
                resultat["eleveur"][cle] = valeur
        if len(occurrences) >= 2:
            valeur = _valeur_sous(lignes, occurrences[1])
            if valeur:
                resultat["convoyeur"][cle] = valeur

    for libelle, cle in LIBELLES_ITINERAIRE:
        occurrences = _chercher_libelle_tous(lignes, libelle)
        if occurrences:
            valeur = _valeur_sous(lignes, occurrences[0])
            if valeur:
                resultat["itineraire"][cle] = valeur

    return resultat


def extraire_champs_page4(mots: list[dict]) -> dict:
    """{"effectifs": [...], "vaccinations": [...]} — mêmes structures que
    EffectifEspece/DonneesVaccination côté frontend (voir types/emission.ts),
    pour un branchement direct sans transformation supplémentaire."""
    lignes = _regrouper_en_lignes(mots)
    effectifs = []
    for libelle, code in LIBELLES_ESPECES:
        occurrences = _chercher_libelle_tous(lignes, libelle)
        if not occurrences:
            continue
        ligne = lignes[occurrences[0]["ligne_index"]]
        nombres = [m["texte"].strip() for m in ligne if m["texte"].strip().isdigit()]
        # Le tableau a 5 colonnes numériques (Mâles, Femelles>Jeunes,
        # Femelles>Adultes, Femelles>Total, TOTAL général) — mais la
        # colonne "Femelles > Total" est un simple sous-total (Jeunes +
        # Adultes) que beaucoup d'agents laissent vide en pratique et
        # écrivent directement le TOTAL général à droite (vu sur une
        # vraie photo de test : 2 mâles, 0/2 femelles, TOTAL=4, sans
        # jamais remplir la case sous-total). Les deux cas sont gérés
        # explicitement plutôt que de supposer "les 4 premiers nombres
        # trouvés" — qui donnerait un résultat FAUX si les 5 colonnes
        # étaient un jour toutes remplies (le sous-total serait alors pris
        # à tort pour le total général).
        if len(nombres) == 5:
            effectifs.append(
                {
                    "espece": code,
                    "nombre_males": int(nombres[0]),
                    "nombre_femelles_jeunes": int(nombres[1]),
                    "nombre_femelles_adultes": int(nombres[2]),
                    "nombre_total": int(nombres[4]),
                }
            )
        elif len(nombres) == 4:
            effectifs.append(
                {
                    "espece": code,
                    "nombre_males": int(nombres[0]),
                    "nombre_femelles_jeunes": int(nombres[1]),
                    "nombre_femelles_adultes": int(nombres[2]),
                    "nombre_total": int(nombres[3]),
                }
            )

    vaccinations = []
    for libelle, code in LIBELLES_MALADIES:
        occurrences = _chercher_libelle_tous(lignes, libelle)
        if not occurrences:
            continue
        valeur = _valeur_sous(lignes, occurrences[0])
        if valeur:
            vaccinations.append({"maladie": code, "date_vaccination": valeur, "lieu": None})

    return {"effectifs": effectifs, "vaccinations": vaccinations}
