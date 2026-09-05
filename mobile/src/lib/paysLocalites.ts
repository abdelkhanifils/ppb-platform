// Données de référence : pays et localités pour les listes déroulantes
// en cascade du trajet (Itineraire) et du lieu de vaccination.
//
// CEMAC (6 pays membres) : provinces/régions officielles complètes — le
// bétail peut provenir de l'intérieur du pays, pas seulement des zones
// frontalières. Voisins hors CEMAC (7 pays) : limité aux localités
// frontalières réelles (postes de passage documentés), plus pertinentes que
// leur découpage administratif complet pour ce dispositif.
//
// Chaque pays se termine toujours par "Autres" — champ de secours si la
// localité recherchée n'apparaît pas dans la liste.

export const MENTION_AUTRE = "Autres";

export interface PaysAvecLocalites {
  code: string;
  nom: string;
  localites: string[];
}

// Ordre : les 6 pays CEMAC d'abord (comme le reste de la plateforme), puis
// les 7 pays voisins hors CEMAC.
export const PAYS_ET_LOCALITES: PaysAvecLocalites[] = [
  { code: "CMR", nom: "Cameroun", localites: ["Abang-Minko", "Adamaoua", "Amchidé", "Binder", "Blangoua", "Campo", "Centre", "Dembo", "Doumrou", "Ekok", "Ekondo-Titi", "Est", "Extrême-Nord", "Fotokol", "Garoua-Boulaï", "Giti", "Guider", "Idenau", "Katoa", "Kenzou", "Kousséri", "Kyé-Ossi", "Littoral", "Mbaïboum", "Moloundou", "Nord", "Nord-Ouest", "Ouest", "Sud", "Sud-Ouest", "Touboro", "Yagoua", "Autres"] },
  { code: "TCD", nom: "Tchad", localites: ["Adré", "Barh El Gazel", "Batha", "Baïbokoum", "Bongor", "Borkou", "Chari-Baguirmi", "Daboua", "Doba", "Ennedi Est", "Ennedi Ouest", "Fianga", "Goré", "Guelendeng", "Guéra", "Hadjer-Lamis", "Kanem", "Kouri Bougoudi", "Lac", "Logone Occidental", "Logone Oriental", "Léré", "Mandoul", "Maro", "Mayo-Kebbi Est", "Mayo-Kebbi Ouest", "Moundou", "Moyen-Chari", "N'Djaména", "N'Gueli", "Ouaddaï", "Ounianga Kébir", "Rig-Rig", "Salamat", "Sido", "Sila", "Tandjilé", "Tibesti", "Tine", "Tissi", "Wadi Fira", "Wour", "Autres"] },
  { code: "CAF", nom: "Centrafrique", localites: ["Amada-Gaza", "Bambouti", "Bamingui-Bangoran", "Bangassou", "Bangui", "Basse-Kotto", "Birao", "Cantonnier", "Gamboula", "Haut-Mbomou", "Haute-Kotto", "Kabo", "Kémo", "Libongo", "Lobaye", "Mambéré-Kadéï", "Markounda", "Mbomou", "Mobaye", "Mongoumba", "Nana-Grébizi", "Nana-Mambéré", "Ngaoundaye", "Ombella-M'Poko", "Ouaka", "Ouham", "Ouham-Pendé", "Paoua", "Salo", "Sangha-Mbaéré", "Sido", "Vakaga", "Autres"] },
  { code: "COG", nom: "Congo", localites: ["Bouenza", "Brazzaville", "Bétou", "Cuvette", "Cuvette-Ouest", "Dolisie", "Impfondo", "Kellé", "Kimongo", "Kouilou", "Likouala", "Lukolela", "Lékoumou", "Mbinda", "Ngoio", "Ngongo", "Niari", "Nyanga", "Nzassi", "Plateaux", "Pointe-Noire", "Pool", "Sangha", "Autres"] },
  { code: "GAB", nom: "Gabon", localites: ["Añisok", "Bakoumba", "Bitam", "Cocobeach", "Doussala", "Eboro", "Estuaire", "Evinayong", "Franceville", "Haut-Ogooué", "Lekoko", "Medouneu", "Mekambo", "Moyen-Ogooué", "Ngounié", "Nyanga", "Ogooué-Ivindo", "Ogooué-Lolo", "Ogooué-Maritime", "Tchibanga", "Woleu-Ntem", "Zadie", "Autres"] },
  { code: "GNQ", nom: "Guinée Équatoriale", localites: ["Annobón", "Bioko Norte", "Bioko Sur", "Centro Sur", "Cogo", "Ebebiyin", "Kié-Ntem", "Litoral", "Rio Campo", "Wele-Nzas", "Autres"] },
  { code: "NGA", nom: "Nigeria", localites: ["Banki", "Calabar", "Ekang", "Gamboru Ngala", "Mfum", "Mubi", "Oron", "Sahuda", "Autres"] },
  { code: "SDN", nom: "Soudan", localites: ["Am Dafok", "El Geneina", "Tine", "Um Dukhun", "Autres"] },
  { code: "SSD", nom: "Soudan du Sud", localites: ["Source Yubu", "Autres"] },
  { code: "LBY", nom: "Libye", localites: ["Koufra", "Maaten al-Sarra", "Autres"] },
  { code: "NER", nom: "Niger", localites: ["Diffa", "N'Gourti", "Autres"] },
  { code: "COD", nom: "RD Congo", localites: ["Kinshasa", "Lukolela", "Mbandaka", "Mobayi-Mbongo", "Ndu", "Zongo", "Autres"] },
  { code: "AGO", nom: "Angola", localites: ["Cabinda", "Massabi", "Autres"] },
];

export function localitesPourPays(code: string): string[] {
  return PAYS_ET_LOCALITES.find((p) => p.code === code)?.localites ?? [MENTION_AUTRE];
}

/** Toutes les localités des 6 pays CEMAC combinées, sans doublon, triées —
 * pour un champ qui n'a pas de pays associé (ex. lieu de vaccination, qui
 * n'est pas rattaché à un pays d'origine/destination précis). Les 6 premiers
 * pays de PAYS_ET_LOCALITES sont les membres CEMAC (voir leur ordre de
 * déclaration ci-dessus) ; les pays voisins hors CEMAC n'y sont volontairement
 * pas mélangés, une vaccination se faisant par construction en zone CEMAC. */
export const TOUTES_LOCALITES_CEMAC: string[] = (() => {
  const codesCemac = new Set(["CMR", "TCD", "CAF", "COG", "GAB", "GNQ"]);
  const combinees = new Set<string>();
  for (const pays of PAYS_ET_LOCALITES) {
    if (!codesCemac.has(pays.code)) continue;
    for (const loc of pays.localites) {
      if (loc !== MENTION_AUTRE) combinees.add(loc);
    }
  }
  return [...combinees].sort((a, b) => a.localeCompare(b, "fr")).concat(MENTION_AUTRE);
})();
