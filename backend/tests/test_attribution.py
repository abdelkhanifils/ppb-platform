"""Tests de app.services.attribution — numérotation Pays/Année/Lot, QR Code,
signature numérique et publication automatique vers l'index de vérification
(Module 3, Document technique §3 M3)."""
import hashlib
from datetime import datetime, timezone

import pytest

from app.core.signing import cle_publique_pem, verifier
from app.models.commande import Commande, StatutCommande
from app.models.passeport import Passeport
from app.services.attribution import attribuer_passeports_pour_commande, construire_chaine_canonique


async def _creer_commande(db, pays_id: int, user_id: str, quantite: int) -> Commande:
    commande = Commande(
        pays_id=pays_id,
        quantite=quantite,
        langue_version="FR/EN",
        mode_impression="centralisee",
        montant_total=quantite * 1500,
        statut=StatutCommande.PAYEE,
        responsable_nom="Test",
        cree_par_id=user_id,
    )
    db.add(commande)
    await db.commit()
    await db.refresh(commande)
    return commande


@pytest.mark.asyncio
async def test_numerotation_sequentielle_et_zero_paddee(db, admin_national_cmr, pays_cameroun):
    user, _ = admin_national_cmr
    commande = await _creer_commande(db, pays_cameroun.id, user.id, quantite=5)

    passeports = await attribuer_passeports_pour_commande(db, commande)
    await db.commit()

    annee_courante = str(datetime.now(timezone.utc).year)
    numeros = sorted(p.numero_lot for p in passeports)
    assert numeros == [str(n).zfill(7) for n in range(1, 6)]
    assert all(p.numero_pays == pays_cameroun.code_numerique for p in passeports)
    assert all(p.numero_annee == annee_courante for p in passeports)


@pytest.mark.asyncio
async def test_numerotation_continue_entre_deux_commandes_du_meme_pays(db, admin_national_cmr, pays_cameroun):
    """Deux attributions successives pour le même pays ne doivent jamais se
    chevaucher — le compteur (pays, année) est réservé de façon atomique."""
    user, _ = admin_national_cmr
    commande_1 = await _creer_commande(db, pays_cameroun.id, user.id, quantite=3)
    passeports_1 = await attribuer_passeports_pour_commande(db, commande_1)
    await db.commit()

    commande_2 = await _creer_commande(db, pays_cameroun.id, user.id, quantite=2)
    passeports_2 = await attribuer_passeports_pour_commande(db, commande_2)
    await db.commit()

    numeros_1 = {p.numero_lot for p in passeports_1}
    numeros_2 = {p.numero_lot for p in passeports_2}
    assert numeros_1.isdisjoint(numeros_2)
    assert numeros_1 == {"0000001", "0000002", "0000003"}
    assert numeros_2 == {"0000004", "0000005"}


@pytest.mark.asyncio
async def test_compteur_independant_par_pays(db, admin_national_cmr, admin_national_tcd, pays_cameroun, pays_tchad):
    """Le Cameroun et le Tchad numérotent chacun à partir de 1 — le compteur
    est scopé par (pays, année), pas global."""
    user_cmr, _ = admin_national_cmr
    user_tcd, _ = admin_national_tcd

    commande_cmr = await _creer_commande(db, pays_cameroun.id, user_cmr.id, quantite=2)
    passeports_cmr = await attribuer_passeports_pour_commande(db, commande_cmr)
    await db.commit()

    commande_tcd = await _creer_commande(db, pays_tchad.id, user_tcd.id, quantite=2)
    passeports_tcd = await attribuer_passeports_pour_commande(db, commande_tcd)
    await db.commit()

    assert {p.numero_lot for p in passeports_cmr} == {"0000001", "0000002"}
    assert {p.numero_lot for p in passeports_tcd} == {"0000001", "0000002"}
    assert all(p.numero_pays == pays_cameroun.code_numerique for p in passeports_cmr)
    assert all(p.numero_pays == pays_tchad.code_numerique for p in passeports_tcd)


@pytest.mark.asyncio
async def test_qr_uuid_unique_par_passeport(db, admin_national_cmr, pays_cameroun):
    user, _ = admin_national_cmr
    commande = await _creer_commande(db, pays_cameroun.id, user.id, quantite=10)

    passeports = await attribuer_passeports_pour_commande(db, commande)
    await db.commit()

    qr_uuids = [p.qr_uuid for p in passeports]
    assert len(qr_uuids) == len(set(qr_uuids))  # tous distincts


@pytest.mark.asyncio
async def test_hash_sha256_correspond_a_la_chaine_canonique(db, admin_national_cmr, pays_cameroun):
    user, _ = admin_national_cmr
    commande = await _creer_commande(db, pays_cameroun.id, user.id, quantite=1)

    passeports = await attribuer_passeports_pour_commande(db, commande)
    await db.commit()
    passeport = passeports[0]

    chaine_attendue = construire_chaine_canonique(
        passeport.numero_pays, passeport.numero_annee, passeport.numero_lot, passeport.qr_uuid
    )
    assert passeport.hash_sha256 == hashlib.sha256(chaine_attendue.encode("utf-8")).hexdigest()


@pytest.mark.asyncio
async def test_signature_verifiable_avec_la_cle_publique(db, admin_national_cmr, pays_cameroun):
    """La signature stockée doit être vérifiable avec la SEULE clé publique —
    exactement ce que fait l'application de contrôle hors-ligne (Module 5)."""
    user, _ = admin_national_cmr
    commande = await _creer_commande(db, pays_cameroun.id, user.id, quantite=1)

    passeports = await attribuer_passeports_pour_commande(db, commande)
    await db.commit()
    passeport = passeports[0]

    empreinte = bytes.fromhex(passeport.hash_sha256)
    pem_publique = cle_publique_pem()

    assert verifier(empreinte, passeport.signature, pem_publique) is True


@pytest.mark.asyncio
async def test_signature_invalide_si_empreinte_alteree(db, admin_national_cmr, pays_cameroun):
    """Toute altération après coup (falsification) doit invalider la vérification."""
    user, _ = admin_national_cmr
    commande = await _creer_commande(db, pays_cameroun.id, user.id, quantite=1)

    passeports = await attribuer_passeports_pour_commande(db, commande)
    await db.commit()
    passeport = passeports[0]

    empreinte_falsifiee = hashlib.sha256(b"donnees-falsifiees").digest()
    pem_publique = cle_publique_pem()

    assert verifier(empreinte_falsifiee, passeport.signature, pem_publique) is False


@pytest.mark.asyncio
async def test_attribution_publie_automatiquement_vers_index_verification(db, admin_national_cmr, pays_cameroun):
    """Chaque passeport attribué doit être immédiatement publié (publie_le
    renseigné), dans la même transaction que l'attribution."""
    user, _ = admin_national_cmr
    commande = await _creer_commande(db, pays_cameroun.id, user.id, quantite=3)

    passeports = await attribuer_passeports_pour_commande(db, commande)
    await db.commit()

    assert all(p.publie_le is not None for p in passeports)


@pytest.mark.asyncio
async def test_attribution_statut_initial_precharge(db, admin_national_cmr, pays_cameroun):
    from app.models.passeport import StatutPasseport

    user, _ = admin_national_cmr
    commande = await _creer_commande(db, pays_cameroun.id, user.id, quantite=1)

    passeports = await attribuer_passeports_pour_commande(db, commande)
    await db.commit()

    assert passeports[0].statut == StatutPasseport.PRECHARGE


# --- Code de vérification (comparaison visuelle papier/app, Module 5) ----------------------


@pytest.mark.asyncio
async def test_attribution_genere_un_code_verification(db, pays_cameroun, admin_national_cmr):
    user, _ = admin_national_cmr
    commande = await _creer_commande(db, pays_cameroun.id, user.id, quantite=3)

    passeports = await attribuer_passeports_pour_commande(db, commande)

    for p in passeports:
        assert p.code_verification is not None
        assert len(p.code_verification) == 6
        # Ni 0/O ni 1/I/L — ambigus à l'œil, exclus délibérément de l'alphabet.
        assert not any(car in p.code_verification for car in "01OIL")


@pytest.mark.asyncio
async def test_codes_verification_sont_distincts_au_sein_dun_lot(db, pays_cameroun, admin_national_cmr):
    """Pas une garantie d'unicité stricte (l'alphabet à 6 caractères sur 32
    symboles rend une collision extrêmement improbable, jamais impossible),
    mais un lot de taille normale ne doit jamais en produire une."""
    user, _ = admin_national_cmr
    commande = await _creer_commande(db, pays_cameroun.id, user.id, quantite=50)

    passeports = await attribuer_passeports_pour_commande(db, commande)

    codes = [p.code_verification for p in passeports]
    assert len(codes) == len(set(codes))
