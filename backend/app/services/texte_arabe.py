"""
Préparation du texte arabe pour reportlab — Module 3 (Impression), version
FR/AR du PPB.

reportlab n'a AUCUN support natif de la mise en forme bidirectionnelle : un
texte arabe passé tel quel à un `Paragraph` s'affiche avec des lettres
isolées (non jointes, comme à l'impression au lieu de l'écriture attachée)
et dans le mauvais sens de lecture. Deux étapes sont nécessaires avant de le
donner à reportlab :

1. `arabic_reshaper` — recompose les lettres arabes dans leur forme jointe
   correcte selon leur position dans le mot (initiale/médiane/finale/isolée).
2. `python-bidi` — réordonne le texte recomposé dans l'ordre visuel gauche-
   à-droite attendu par le moteur de mise en page de reportlab (qui affiche
   toujours ses caractères de gauche à droite) — c'est ce réordonnancement
   qui produit, une fois affiché, un rendu visuellement correct de droite à
   gauche.

Une troisième condition, hors de ce module, est nécessaire : une police
contenant réellement les glyphes arabes (Helvetica n'en a aucun) — voir
`app/services/pdf_passeport.py::CHEMIN_POLICE_ARABE`, téléchargée au
moment de la construction de l'image Docker (voir le Dockerfile).

Repli explicite : si `arabic_reshaper`/`python-bidi` sont indisponibles pour
une raison quelconque (échec d'installation, environnement dégradé), le
texte brut est renvoyé tel quel plutôt que de faire échouer toute la
génération du document — mieux vaut un rendu arabe dégradé qu'un PDF qui ne
se génère pas du tout.
"""
import logging

logger = logging.getLogger("ppb.texte_arabe")


def preparer_texte_arabe(texte: str) -> str:
    try:
        import arabic_reshaper
        from bidi.algorithm import get_display

        texte_recompose = arabic_reshaper.reshape(texte)
        return get_display(texte_recompose)
    except Exception:
        logger.warning("Mise en forme du texte arabe indisponible — affichage en texte brut, non façonné.", exc_info=True)
        return texte
