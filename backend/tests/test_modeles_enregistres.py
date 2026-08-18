"""Garde-fou structurel : chaque modèle SQLAlchemy doit être importé dans
app/models/__init__.py, sinon Alembic (autogenerate) l'ignore SILENCIEUSEMENT
lors de la génération d'une migration — bug réel vécu avec PhotoOcr
(table jamais créée en production, découverte seulement via un 500 en
production : "relation photos_ocr does not exist"). Ce test empêche toute
récidive : un nouveau fichier de modèle oublié ici fait échouer la suite,
avant même d'atteindre la production."""
import ast
from pathlib import Path

DOSSIER_MODELES = Path(__file__).resolve().parent.parent / "app" / "models"


def test_tous_les_modeles_sont_importes_dans_init():
    fichiers_modeles = {
        f.stem for f in DOSSIER_MODELES.glob("*.py") if f.stem not in ("__init__",)
    }

    contenu_init = (DOSSIER_MODELES / "__init__.py").read_text()
    arbre = ast.parse(contenu_init)
    modules_importes = {
        node.module.rsplit(".", 1)[-1]
        for node in ast.walk(arbre)
        if isinstance(node, ast.ImportFrom) and node.module and node.module.startswith("app.models.")
    }

    manquants = fichiers_modeles - modules_importes
    assert not manquants, (
        f"Modèle(s) jamais importé(s) dans app/models/__init__.py : {manquants} — "
        f"Alembic ne les verra jamais pour l'autogénération de migration."
    )
