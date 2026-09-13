"""creation table localites avec donnees initiales

Revision ID: 47c24c5fd719
Revises: 4be950408d46
Create Date: 2026-09-13 09:00:00.000000

"""
from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa

revision: str = '47c24c5fd719'
down_revision: Union[str, None] = '4be950408d46'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Reprend les localités jusqu'ici figées dans mobile/src/lib/paysLocalites.ts
# (uniquement les 6 pays CEMAC : ce sont les seuls présents dans la table
# `pays`, les pays voisins hors CEMAC n'y existent pas — voir la docstring
# du modèle Localite pour le raisonnement complet), avec la province de
# rattachement de chacune. Association initiale établie à partir du
# découpage administratif officiel de chaque pays — à vérifier/corriger
# depuis Administration > Pays & Frontières pour les quelques cas limites
# (localités proches d'une frontière provinciale interne).
LOCALITES_PAR_PAYS: dict[str, list[tuple[str, str]]] = {
    "CMR": [
        ("Abang-Minko", "Sud"),
        ("Amchidé", "Extrême-Nord"),
        ("Binder", "Nord"),
        ("Blangoua", "Extrême-Nord"),
        ("Campo", "Sud"),
        ("Dembo", "Extrême-Nord"),
        ("Doumrou", "Extrême-Nord"),
        ("Ekok", "Sud-Ouest"),
        ("Ekondo-Titi", "Sud-Ouest"),
        ("Fotokol", "Extrême-Nord"),
        ("Garoua-Boulaï", "Est"),
        ("Giti", "Adamaoua"),
        ("Guider", "Nord"),
        ("Idenau", "Sud-Ouest"),
        ("Katoa", "Extrême-Nord"),
        ("Kenzou", "Est"),
        ("Kousséri", "Extrême-Nord"),
        ("Kyé-Ossi", "Sud"),
        ("Mbaïboum", "Adamaoua"),
        ("Moloundou", "Est"),
        ("Touboro", "Nord"),
        ("Yagoua", "Extrême-Nord"),
    ],
    "TCD": [
        ("Adré", "Ouaddaï"),
        ("Baïbokoum", "Logone Oriental"),
        ("Bongor", "Mayo-Kebbi Est"),
        ("Daboua", "Lac"),
        ("Doba", "Logone Oriental"),
        ("Fianga", "Mayo-Kebbi Ouest"),
        ("Goré", "Logone Oriental"),
        ("Guelendeng", "Chari-Baguirmi"),
        ("Kouri Bougoudi", "Ennedi Est"),
        ("Léré", "Mayo-Kebbi Ouest"),
        ("Maro", "Moyen-Chari"),
        ("Moundou", "Logone Occidental"),
        ("N'Gueli", "Chari-Baguirmi"),
        ("Ounianga Kébir", "Ennedi Est"),
        ("Rig-Rig", "Kanem"),
        ("Sido", "Moyen-Chari"),
        ("Tine", "Wadi Fira"),
        ("Tissi", "Sila"),
        ("Wour", "Tibesti"),
    ],
    "CAF": [
        ("Amada-Gaza", "Vakaga"),
        ("Bambouti", "Haut-Mbomou"),
        ("Bangassou", "Mbomou"),
        ("Bangui", "Bangui"),
        ("Birao", "Vakaga"),
        ("Cantonnier", "Nana-Mambéré"),
        ("Gamboula", "Mambéré-Kadéï"),
        ("Kabo", "Ouham"),
        ("Libongo", "Sangha-Mbaéré"),
        ("Markounda", "Ouham"),
        ("Mobaye", "Basse-Kotto"),
        ("Mongoumba", "Lobaye"),
        ("Ngaoundaye", "Ouham-Pendé"),
        ("Paoua", "Ouham-Pendé"),
        ("Salo", "Sangha-Mbaéré"),
        ("Sido", "Ouham"),
    ],
    "COG": [
        ("Bétou", "Likouala"),
        ("Dolisie", "Niari"),
        ("Impfondo", "Likouala"),
        ("Kellé", "Cuvette-Ouest"),
        ("Kimongo", "Niari"),
        ("Lukolela", "Likouala"),
        ("Mbinda", "Niari"),
        ("Ngoio", "Kouilou"),
        ("Ngongo", "Kouilou"),
        ("Nyanga", "Niari"),
        ("Nzassi", "Kouilou"),
    ],
    "GAB": [
        ("Añisok", "Woleu-Ntem"),
        ("Bakoumba", "Haut-Ogooué"),
        ("Bitam", "Woleu-Ntem"),
        ("Cocobeach", "Estuaire"),
        ("Doussala", "Nyanga"),
        ("Eboro", "Woleu-Ntem"),
        ("Evinayong", "Woleu-Ntem"),
        ("Franceville", "Haut-Ogooué"),
        ("Lekoko", "Ogooué-Ivindo"),
        ("Medouneu", "Woleu-Ntem"),
        ("Mekambo", "Ogooué-Ivindo"),
        ("Tchibanga", "Nyanga"),
        ("Zadie", "Ogooué-Ivindo"),
    ],
    "GNQ": [
        ("Cogo", "Litoral"),
        ("Ebebiyin", "Kié-Ntem"),
        ("Rio Campo", "Litoral"),
    ],
}


def upgrade() -> None:
    op.create_table(
        "localites",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("pays_id", sa.Integer(), sa.ForeignKey("pays.id"), nullable=False),
        sa.Column("nom", sa.String(length=150), nullable=False),
        sa.Column("province", sa.String(length=150), nullable=True),
        sa.Column("actif", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("cree_le", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("modifie_le", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("pays_id", "nom", name="uq_localite_pays_nom"),
    )

    connexion = op.get_bind()
    lignes_pays = connexion.execute(sa.text("SELECT id, code_iso FROM pays")).fetchall()
    id_par_code_iso = {code_iso: id_ for id_, code_iso in lignes_pays}

    table_localites = sa.table(
        "localites",
        sa.column("id", sa.String),
        sa.column("pays_id", sa.Integer),
        sa.column("nom", sa.String),
        sa.column("province", sa.String),
    )
    lignes_a_inserer = []
    for code_iso, localites in LOCALITES_PAR_PAYS.items():
        pays_id = id_par_code_iso.get(code_iso)
        if pays_id is None:
            continue  # Pays pas encore seedé sur cet environnement — rien à insérer pour lui.
        for nom, province in localites:
            lignes_a_inserer.append({"id": str(uuid.uuid4()), "pays_id": pays_id, "nom": nom, "province": province})
    if lignes_a_inserer:
        op.bulk_insert(table_localites, lignes_a_inserer)


def downgrade() -> None:
    op.drop_table("localites")
