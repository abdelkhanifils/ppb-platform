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

// Localités frontalières UNIQUEMENT (sous-ensemble des listes ci-dessus,
// sans les provinces/régions) — pour le lieu de vaccination, scopé au seul
// pays émetteur du passeport (voir components/PageForms.tsx::FormulairePage4
// et paysEmetteurDepuisNumero). Une seule des 6 clés CEMAC utilisée ici, un
// pays voisin hors CEMAC n'étant jamais émetteur d'un PPB.
const LOCALITES_FRONTALIERES_PAR_PAYS: Record<string, string[]> = {
  CMR: ["Kousséri", "Yagoua", "Katoa", "Doumrou", "Blangoua", "Binder", "Touboro", "Mbaïboum", "Garoua-Boulaï", "Kenzou", "Giti", "Moloundou", "Kyé-Ossi", "Abang-Minko", "Campo", "Fotokol", "Amchidé", "Guider", "Dembo", "Ekok", "Idenau", "Ekondo-Titi"],
  TCD: ["N'Gueli", "Bongor", "Guelendeng", "Fianga", "Léré", "Moundou", "Sido", "Maro", "Goré", "Doba", "Baïbokoum", "Adré", "Tine", "Tissi", "Ounianga Kébir", "Wour", "Kouri Bougoudi", "Daboua", "Rig-Rig"],
  CAF: ["Sido", "Kabo", "Paoua", "Markounda", "Ngaoundaye", "Cantonnier", "Gamboula", "Amada-Gaza", "Libongo", "Salo", "Mongoumba", "Bangui", "Mobaye", "Bangassou", "Birao", "Bambouti"],
  GAB: ["Eboro", "Bitam", "Cocobeach", "Medouneu", "Añisok", "Evinayong", "Bakoumba", "Lekoko", "Franceville", "Zadie", "Mekambo", "Tchibanga", "Doussala"],
  GNQ: ["Ebebiyin", "Rio Campo", "Cogo"],
  COG: ["Mbinda", "Ngongo", "Kellé", "Dolisie", "Nyanga", "Bétou", "Impfondo", "Lukolela", "Kimongo", "Ngoio", "Nzassi"],
};

export function localitesFrontalieresPourPays(code: string): string[] {
  const localites = LOCALITES_FRONTALIERES_PAR_PAYS[code];
  return localites ? [...localites].sort((a, b) => a.localeCompare(b, "fr")).concat(MENTION_AUTRE) : [MENTION_AUTRE];
}
