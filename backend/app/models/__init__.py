"""Point d'agrégation des modèles — importé par Alembic (env.py) pour l'autogénération."""
from app.models.pays import Pays  # noqa: F401
from app.models.utilisateur import Utilisateur  # noqa: F401
from app.models.commande import Commande  # noqa: F401
from app.models.paiement import Paiement  # noqa: F401
from app.models.passeport import CompteurNumerotation, Passeport, StatutPasseport  # noqa: F401
from app.models.autorisation_impression import AutorisationImpression  # noqa: F401
from app.models.numerisation import Numerisation  # noqa: F401
from app.models.eleveur import Eleveur  # noqa: F401
from app.models.convoyeur import Convoyeur  # noqa: F401
from app.models.troupeau import Troupeau, TroupeauEspece  # noqa: F401
from app.models.vaccination import Vaccination  # noqa: F401
from app.models.itineraire import Itineraire  # noqa: F401
from app.models.controle import Controle  # noqa: F401
from app.models.poste import Poste  # noqa: F401
from app.models.admin import (  # noqa: F401
    DefinitionFormulaire,
    DefinitionChamp,
    Parametre,
    TexteGabarit,
    TypeChamp,
    TypeParametre,
)
from app.models.audit import PisteAudit  # noqa: F401
from app.models.photo_ocr import PhotoOcr  # noqa: F401
