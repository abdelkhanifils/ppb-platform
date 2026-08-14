"""
Module Administration — configuration dynamique (Document technique, section 4).

Principes appliqués :
- Seul le rôle Super Admin peut créer/modifier/désactiver un champ ou un
  paramètre (RBAC : `require_roles(Role.SUPER_ADMIN)` sur chaque route
  d'écriture — pas d'exception).
- Les champs structurels (identifiants, statuts, numéro de passeport,
  signature) figurent sur une liste blanche non modifiable par ce
  mécanisme, quel que soit le rôle.
- La désactivation d'un champ est toujours logique (jamais physique) :
  les données historiques saisies avec une version antérieure du
  formulaire restent intactes et consultables.
- Toute action (ajout, modification, désactivation de champ ; modification
  de paramètre) est journalisée dans la piste d'audit, immuable
  (app.services.audit), avec auteur, horodatage, ancienne et nouvelle valeur.
- `DefinitionFormulaire.schema_version` est incrémentée à chaque changement
  de champ : c'est cette version que le endpoint public de schéma expose,
  et que les applications comparent pour détecter qu'elles doivent
  régénérer dynamiquement le formulaire affiché — sans mise à jour ni
  redéploiement (même mécanisme de propagation que pour les passeports).
- Le gabarit imprimé du PPB (TexteGabarit) suit un circuit distinct et
  volontairement plus restrictif (« quatre yeux » : proposition puis
  validation par un second compte Super Admin).
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import CurrentUser, get_current_user, require_roles
from app.core.rbac import Role
from app.db.session import get_db
from app.models.admin import (
    DefinitionChamp,
    DefinitionFormulaire,
    Parametre,
    StatutTexteGabarit,
    TexteGabarit,
    TypeParametre,
)
from app.schemas.admin import (
    ChampCreate,
    ChampOut,
    ChampUpdate,
    FormulaireOut,
    ParametreOut,
    ParametreUpdate,
    TexteGabaritOut,
    TexteGabaritProposer,
    TexteGabaritRejeter,
)
from app.services.audit import journaliser

router = APIRouter(prefix="/admin", tags=["Module Administration"])

# Champs structurels jamais pilotables par la configuration dynamique (Document technique §4) —
# liste blanche non modifiable par ce mécanisme, quel que soit le rôle.
CHAMPS_STRUCTURELS_INTERDITS = {
    "id",
    "statut",
    "numero_pays",
    "numero_annee",
    "numero_lot",
    "qr_uuid",
    "hash_sha256",
    "signature",
    "gabarit_version",
}


# --- Formulaires et champs --------------------------------------------------------------------


@router.get("/formulaires", response_model=list[FormulaireOut])
async def lister_formulaires(db: AsyncSession = Depends(get_db)) -> list[FormulaireOut]:
    result = await db.execute(select(DefinitionFormulaire))
    return [FormulaireOut.model_validate(f) for f in result.scalars().all()]


async def _get_formulaire_ou_404(code: str, db: AsyncSession) -> DefinitionFormulaire:
    result = await db.execute(select(DefinitionFormulaire).where(DefinitionFormulaire.code == code))
    formulaire = result.scalar_one_or_none()
    if formulaire is None:
        raise HTTPException(status_code=404, detail="Formulaire introuvable.")
    return formulaire


@router.get("/formulaires/{code}/champs", response_model=list[ChampOut])
async def lister_champs(code: str, inclure_inactifs: bool = True, db: AsyncSession = Depends(get_db)) -> list[ChampOut]:
    """`inclure_inactifs=True` par défaut — les champs désactivés restent visibles pour l'historique."""
    formulaire = await _get_formulaire_ou_404(code, db)
    query = select(DefinitionChamp).where(DefinitionChamp.formulaire_id == formulaire.id).order_by(
        DefinitionChamp.ordre_affichage
    )
    if not inclure_inactifs:
        query = query.where(DefinitionChamp.actif.is_(True))
    result = await db.execute(query)
    return [ChampOut.model_validate(c) for c in result.scalars().all()]


@router.post(
    "/formulaires/{code}/champs",
    response_model=ChampOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(Role.SUPER_ADMIN))],
)
async def ajouter_champ(
    code: str,
    payload: ChampCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ChampOut:
    if payload.code_champ in CHAMPS_STRUCTURELS_INTERDITS:
        raise HTTPException(status_code=409, detail="Champ structurel — non modifiable par cette voie.")

    formulaire = await _get_formulaire_ou_404(code, db)

    result = await db.execute(
        select(DefinitionChamp).where(
            DefinitionChamp.formulaire_id == formulaire.id, DefinitionChamp.code_champ == payload.code_champ
        )
    )
    if result.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="Un champ avec ce code existe déjà pour ce formulaire.")

    champ = DefinitionChamp(formulaire_id=formulaire.id, **payload.model_dump())
    db.add(champ)
    formulaire.schema_version += 1
    await db.flush()

    await journaliser(
        db,
        utilisateur_id=current_user.id,
        action="champ.ajoute",
        entite="DefinitionChamp",
        entite_id=champ.id,
        nouvelle_valeur=payload.model_dump(mode="json"),
    )
    await db.commit()
    await db.refresh(champ)
    return ChampOut.model_validate(champ)


@router.patch(
    "/formulaires/{code}/champs/{champ_id}",
    response_model=ChampOut,
    dependencies=[Depends(require_roles(Role.SUPER_ADMIN))],
)
async def modifier_champ(
    code: str,
    champ_id: str,
    payload: ChampUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ChampOut:
    champ = await db.get(DefinitionChamp, champ_id)
    if champ is None or champ.formulaire_id != (await _get_formulaire_ou_404(code, db)).id:
        raise HTTPException(status_code=404, detail="Champ introuvable pour ce formulaire.")

    changements = payload.model_dump(exclude_unset=True)
    if not changements:
        raise HTTPException(status_code=422, detail="Aucun champ à modifier fourni.")

    ancienne_valeur = {k: getattr(champ, k) for k in changements}
    for cle, valeur in changements.items():
        setattr(champ, cle, valeur)
    champ.version += 1

    formulaire = await db.get(DefinitionFormulaire, champ.formulaire_id)
    formulaire.schema_version += 1
    await db.flush()

    await journaliser(
        db,
        utilisateur_id=current_user.id,
        action="champ.modifie",
        entite="DefinitionChamp",
        entite_id=champ.id,
        ancienne_valeur=ancienne_valeur,
        nouvelle_valeur=changements,
    )
    await db.commit()
    await db.refresh(champ)
    return ChampOut.model_validate(champ)


@router.delete(
    "/formulaires/{code}/champs/{champ_id}",
    dependencies=[Depends(require_roles(Role.SUPER_ADMIN))],
)
async def desactiver_champ(
    code: str,
    champ_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Suppression logique uniquement — les données historiques restent consultables et exportables."""
    champ = await db.get(DefinitionChamp, champ_id)
    if champ is None:
        raise HTTPException(status_code=404, detail="Champ introuvable.")

    champ.actif = False
    formulaire = await db.get(DefinitionFormulaire, champ.formulaire_id)
    formulaire.schema_version += 1
    await db.flush()

    await journaliser(
        db,
        utilisateur_id=current_user.id,
        action="champ.desactive",
        entite="DefinitionChamp",
        entite_id=champ.id,
        ancienne_valeur={"actif": True},
        nouvelle_valeur={"actif": False},
    )
    await db.commit()
    return {"id": champ.id, "actif": False, "schema_version": formulaire.schema_version}


# --- Paramètres système -----------------------------------------------------------------------


@router.get("/parametres", response_model=list[ParametreOut])
async def lister_parametres(db: AsyncSession = Depends(get_db)) -> list[ParametreOut]:
    result = await db.execute(select(Parametre))
    return [ParametreOut.model_validate(p) for p in result.scalars().all()]


def _valider_type_parametre(type_parametre: TypeParametre, valeur: str) -> None:
    """Le paramètre est stocké en texte mais typé — validé côté backend avant écriture,
    indépendamment du frontend, comme pour le plafond de paiement en ligne (Module 2)."""
    try:
        if type_parametre == TypeParametre.INT:
            int(valeur)
        elif type_parametre == TypeParametre.DECIMAL:
            float(valeur)
        elif type_parametre == TypeParametre.BOOL:
            if valeur.lower() not in ("true", "false"):
                raise ValueError
    except ValueError:
        raise HTTPException(
            status_code=422, detail=f"Valeur '{valeur}' incompatible avec le type '{type_parametre.value}'."
        )


@router.patch(
    "/parametres/{cle}",
    response_model=ParametreOut,
    dependencies=[Depends(require_roles(Role.SUPER_ADMIN))],
)
async def modifier_parametre(
    cle: str,
    payload: ParametreUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ParametreOut:
    result = await db.execute(select(Parametre).where(Parametre.cle == cle))
    parametre = result.scalar_one_or_none()
    if parametre is None:
        raise HTTPException(status_code=404, detail="Paramètre introuvable.")

    _valider_type_parametre(parametre.type, payload.valeur)

    ancienne_valeur = parametre.valeur
    parametre.valeur = payload.valeur
    await db.flush()

    await journaliser(
        db,
        utilisateur_id=current_user.id,
        action="parametre.modifie",
        entite="Parametre",
        entite_id=parametre.id,
        ancienne_valeur={"valeur": ancienne_valeur},
        nouvelle_valeur={"valeur": payload.valeur},
    )
    await db.commit()
    await db.refresh(parametre)
    # Application immédiate aux opérations suivantes (ex. Module 1 relit prix_unitaire_ppb à
    # chaque calcul de facture) — aucune intervention sur le code ni sur le schéma de base.
    return ParametreOut.model_validate(parametre)


# --- Gabarit du passeport — circuit « quatre yeux » --------------------------------------------


@router.get("/gabarit/{version}/completion")
async def completion_gabarit(version: int, db: AsyncSession = Depends(get_db)):
    """Diagnostic de complétude d'une version du gabarit — le circuit à deux
    comptes valide chaque texte individuellement ; c'est à l'administrateur de
    vérifier ICI que TOUS les textes attendus pour une version sont VALIDE
    avant de la référencer dans une AutorisationImpression ou une attribution
    (voir app.services.attribution, `gabarit_version` figé par passeport à
    l'attribution — aucune correction rétroactive possible ensuite)."""
    result = await db.execute(select(TexteGabarit).where(TexteGabarit.gabarit_version == version))
    textes = result.scalars().all()
    compte = {statut.value: 0 for statut in StatutTexteGabarit}
    for texte in textes:
        compte[texte.statut.value] += 1
    return {"gabarit_version": version, "total": len(textes), "par_statut": compte}


@router.get("/gabarit/{version}/textes")
async def lister_textes_gabarit(version: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(TexteGabarit).where(TexteGabarit.gabarit_version == version))
    return [{"cle": t.cle, "langue": t.langue, "valeur": t.valeur, "statut": t.statut} for t in result.scalars().all()]


@router.post(
    "/gabarit/textes/proposer",
    response_model=TexteGabaritOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(Role.SUPER_ADMIN))],
)
async def proposer_texte_gabarit(
    payload: TexteGabaritProposer,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TexteGabaritOut:
    # Empêche une double proposition simultanée pour le même (cle, langue,
    # gabarit_version) — la seconde devrait rejeter ou remplacer explicitement
    # la première (via /rejeter), jamais coexister silencieusement.
    result = await db.execute(
        select(TexteGabarit).where(
            TexteGabarit.cle == payload.cle,
            TexteGabarit.langue == payload.langue,
            TexteGabarit.gabarit_version == payload.gabarit_version_courante,
            TexteGabarit.statut == StatutTexteGabarit.PROPOSE,
        )
    )
    if result.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=409,
            detail="Une proposition est déjà en attente pour ce (cle, langue, gabarit_version) — rejetez-la avant d'en soumettre une nouvelle.",
        )

    texte = TexteGabarit(
        gabarit_version=payload.gabarit_version_courante,
        cle=payload.cle,
        langue=payload.langue,
        valeur=payload.valeur,
        statut=StatutTexteGabarit.PROPOSE,
        propose_par_id=current_user.id,
    )
    db.add(texte)
    await db.flush()
    await journaliser(
        db,
        utilisateur_id=current_user.id,
        action="texte_gabarit.propose",
        entite="TexteGabarit",
        entite_id=texte.id,
        nouvelle_valeur=payload.model_dump(),
    )
    await db.commit()
    await db.refresh(texte)
    return TexteGabaritOut.model_validate(texte)


@router.post(
    "/gabarit/textes/{texte_id}/valider",
    response_model=TexteGabaritOut,
    dependencies=[Depends(require_roles(Role.SUPER_ADMIN))],
)
async def valider_texte_gabarit(
    texte_id: str, current_user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> TexteGabaritOut:
    """Principe des quatre yeux : le validateur ne peut jamais être le proposant.

    Corrections apportées lors de la revue de sécurité (voir SECURITY_REVIEW.md) :
    - Garde d'état : seule une proposition encore au statut PROPOSE peut être
      validée — un texte déjà VALIDE ou REJETE ne peut plus être retraité
      (empêche une revalidation accidentelle ou malveillante).
    - `gabarit_version` n'est plus incrémentée à la validation : elle est
      figée dès la proposition (`gabarit_version_courante`, choisie par le
      proposant) — l'incrémentation systématique précédente pouvait désynchroniser
      plusieurs textes proposés ensemble pour une même nouvelle version.
    """
    texte = await db.get(TexteGabarit, texte_id)
    if texte is None:
        raise HTTPException(status_code=404, detail="Proposition introuvable.")
    if texte.statut != StatutTexteGabarit.PROPOSE:
        raise HTTPException(status_code=409, detail=f"Ce texte est déjà au statut '{texte.statut.value}' — ni validable ni rejetable.")
    if texte.propose_par_id == current_user.id:
        raise HTTPException(status_code=409, detail="Le proposant ne peut pas valider sa propre proposition.")

    texte.statut = StatutTexteGabarit.VALIDE
    texte.valide_par_id = current_user.id
    await db.flush()
    await journaliser(
        db,
        utilisateur_id=current_user.id,
        action="texte_gabarit.valide",
        entite="TexteGabarit",
        entite_id=texte.id,
        nouvelle_valeur={"gabarit_version": texte.gabarit_version},
    )
    await db.commit()
    await db.refresh(texte)
    return TexteGabaritOut.model_validate(texte)


@router.post(
    "/gabarit/textes/{texte_id}/rejeter",
    response_model=TexteGabaritOut,
    dependencies=[Depends(require_roles(Role.SUPER_ADMIN))],
)
async def rejeter_texte_gabarit(
    texte_id: str,
    payload: TexteGabaritRejeter,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TexteGabaritOut:
    texte = await db.get(TexteGabarit, texte_id)
    if texte is None:
        raise HTTPException(status_code=404, detail="Proposition introuvable.")
    if texte.statut != StatutTexteGabarit.PROPOSE:
        raise HTTPException(status_code=409, detail=f"Ce texte est déjà au statut '{texte.statut.value}' — ni validable ni rejetable.")

    texte.statut = StatutTexteGabarit.REJETE
    await db.flush()
    await journaliser(
        db,
        utilisateur_id=current_user.id,
        action="texte_gabarit.rejete",
        entite="TexteGabarit",
        entite_id=texte.id,
        nouvelle_valeur={"motif": payload.motif},
    )
    await db.commit()
    await db.refresh(texte)
    return TexteGabaritOut.model_validate(texte)
