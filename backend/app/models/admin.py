import enum

from sqlalchemy import Boolean, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, new_uuid, str_enum
from app.models.numerisation import JSON_TYPE


class DefinitionFormulaire(TimestampMixin, Base):
    """Un formulaire configurable (ex. « eleveur », « convoyeur », « troupeau »).

    `schema_version` est incrémentée à chaque ajout, modification ou
    désactivation d'un DefinitionChamp rattaché à ce formulaire — c'est
    cette version que consomme le endpoint public /formulaires/{code}/schema
    et que les applications (Web Admin, app d'émission, portail) comparent
    pour détecter qu'une régénération du formulaire affiché est nécessaire
    (même mécanisme de propagation que pour les passeports, Module 3/5).
    """

    __tablename__ = "definitions_formulaire"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    nom: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    schema_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)


class TypeChamp(str, enum.Enum):
    TEXTE = "texte"
    NOMBRE = "nombre"
    DATE = "date"
    LISTE = "liste"
    BOOLEEN = "booleen"


class DefinitionChamp(TimestampMixin, Base):
    """Un champ configurable au sein d'un formulaire (Module Administration).

    Les champs structurels (identifiants, statuts, numéro de passeport,
    signature) NE PASSENT JAMAIS par ce mécanisme — liste blanche non
    modifiable, quel que soit le rôle (voir app.core.rbac).
    """

    __tablename__ = "definitions_champ"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    formulaire_id: Mapped[str] = mapped_column(ForeignKey("definitions_formulaire.id"), nullable=False)
    code_champ: Mapped[str] = mapped_column(String(100), nullable=False)
    libelle_fr: Mapped[str] = mapped_column(String(255), nullable=False)
    libelle_en: Mapped[str | None] = mapped_column(String(255), nullable=True)
    libelle_ar: Mapped[str | None] = mapped_column(String(255), nullable=True)
    type_champ: Mapped[TypeChamp] = mapped_column(str_enum(TypeChamp, "type_champ_enum"))
    obligatoire: Mapped[bool] = mapped_column(Boolean, default=False)
    ordre_affichage: Mapped[int] = mapped_column(Integer, default=0)
    actif: Mapped[bool] = mapped_column(Boolean, default=True)  # désactivation logique uniquement
    regle_validation: Mapped[str | None] = mapped_column(String(500), nullable=True)  # regex ou règle métier
    options_liste: Mapped[dict | None] = mapped_column(JSON_TYPE, nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)  # version propre à ce champ (historique de ses éditions)

    __table_args__ = (
        UniqueConstraint("formulaire_id", "code_champ", name="uq_definitions_champ_formulaire_code"),
    )


class TypeParametre(str, enum.Enum):
    """Le type contraint la valeur stockée (toujours en texte) — validé à l'écriture (PATCH)."""

    STRING = "string"
    INT = "int"
    DECIMAL = "decimal"
    BOOL = "bool"


class Parametre(TimestampMixin, Base):
    """Un paramètre système (prix unitaire du PPB, quantités, délais, plafonds...).

    Jamais codé en dur : lu par les modules concernés à chaque calcul
    (ex. Module 1 -> prix_unitaire_ppb, Module 2 -> plafond_paiement_en_ligne).
    """

    __tablename__ = "parametres"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    cle: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)  # ex. prix_unitaire_ppb
    valeur: Mapped[str] = mapped_column(String(500), nullable=False)  # stockage textuel, typé par `type`
    type: Mapped[TypeParametre] = mapped_column(str_enum(TypeParametre, "type_parametre_enum"), default=TypeParametre.STRING)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    modifiable_par: Mapped[str] = mapped_column(String(50), default="super_admin")


class StatutTexteGabarit(str, enum.Enum):
    PROPOSE = "propose"
    VALIDE = "valide"
    REJETE = "rejete"


class TexteGabarit(TimestampMixin, Base):
    """Un libellé ou bloc de texte légal du gabarit imprimé — jamais la mise en page ni la sécurité.

    Circuit à deux comptes (quatre yeux) : proposé par un Super Admin,
    validé par un second, ce qui fait naître une nouvelle gabarit_version
    numérotée — jamais une édition en place.
    """

    __tablename__ = "textes_gabarit"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    gabarit_version: Mapped[int] = mapped_column(Integer, nullable=False)
    cle: Mapped[str] = mapped_column(String(100), nullable=False)  # ex. bullet_2_en
    langue: Mapped[str] = mapped_column(String(5), nullable=False)  # fr, en, ar
    valeur: Mapped[str] = mapped_column(String(2000), nullable=False)
    statut: Mapped[StatutTexteGabarit] = mapped_column(
        str_enum(StatutTexteGabarit, "statut_texte_gabarit_enum"), default=StatutTexteGabarit.PROPOSE
    )
    propose_par_id: Mapped[str] = mapped_column(ForeignKey("utilisateurs.id"), nullable=False)
    valide_par_id: Mapped[str | None] = mapped_column(ForeignKey("utilisateurs.id"), nullable=True)
