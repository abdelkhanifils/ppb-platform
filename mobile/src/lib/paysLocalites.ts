// Données de référence : pays, provinces et localités frontalières, pour
// les listes déroulantes du trajet (Itineraire) et du lieu de vaccination.
//
// Deux listes VOLONTAIREMENT DISTINCTES, jamais mélangées :
// - PROVINCES : découpage administratif officiel des 6 pays CEMAC membres
//   uniquement (un pays voisin hors CEMAC n'en a pas ici — voir
//   provincesPourPays, qui renvoie alors juste "Autres").
// - LOCALITES : villes/postes frontaliers réels documentés, pour les 6 pays
//   CEMAC ET leurs 7 voisins hors CEMAC.
//
// Chaque liste se termine toujours par "Autres" — champ de secours si la
// valeur recherchée n'y figure pas.

export const MENTION_AUTRE = "Autres";

// Provinces/régions officielles — 6 pays CEMAC uniquement.
const PROVINCES_PAR_PAYS: Record<string, string[]> = {
  "CMR": ["Adamaoua", "Centre", "Est", "Extrême-Nord", "Littoral", "Nord", "Nord-Ouest", "Ouest", "Sud", "Sud-Ouest"],
  "TCD": ["Barh El Gazel", "Batha", "Borkou", "Chari-Baguirmi", "Ennedi Est", "Ennedi Ouest", "Guéra", "Hadjer-Lamis", "Kanem", "Lac", "Logone Occidental", "Logone Oriental", "Mandoul", "Mayo-Kebbi Est", "Mayo-Kebbi Ouest", "Moyen-Chari", "N'Djaména", "Ouaddaï", "Salamat", "Sila", "Tandjilé", "Tibesti", "Wadi Fira"],
  "CAF": ["Bamingui-Bangoran", "Bangui", "Basse-Kotto", "Haut-Mbomou", "Haute-Kotto", "Kémo", "Lobaye", "Mambéré-Kadéï", "Mbomou", "Nana-Grébizi", "Nana-Mambéré", "Ombella-M'Poko", "Ouaka", "Ouham", "Ouham-Pendé", "Sangha-Mbaéré", "Vakaga"],
  "COG": ["Bouenza", "Brazzaville", "Cuvette", "Cuvette-Ouest", "Kouilou", "Likouala", "Lékoumou", "Niari", "Plateaux", "Pointe-Noire", "Pool", "Sangha"],
  "GAB": ["Estuaire", "Haut-Ogooué", "Moyen-Ogooué", "Ngounié", "Nyanga", "Ogooué-Ivindo", "Ogooué-Lolo", "Ogooué-Maritime", "Woleu-Ntem"],
  "GNQ": ["Annobón", "Bioko Norte", "Bioko Sur", "Centro Sur", "Kié-Ntem", "Litoral", "Wele-Nzas"],
};

// Localités / postes frontaliers réels — 6 pays CEMAC + 7 pays voisins hors CEMAC.
const LOCALITES_PAR_PAYS: Record<string, string[]> = {
  "CMR": ["Abang-Minko", "Amchidé", "Binder", "Blangoua", "Campo", "Dembo", "Doumrou", "Ekok", "Ekondo-Titi", "Fotokol", "Garoua-Boulaï", "Giti", "Guider", "Idenau", "Katoa", "Kenzou", "Kousséri", "Kyé-Ossi", "Mbaïboum", "Moloundou", "Touboro", "Yagoua"],
  "TCD": ["Adré", "Baïbokoum", "Bongor", "Daboua", "Doba", "Fianga", "Goré", "Guelendeng", "Kouri Bougoudi", "Léré", "Maro", "Moundou", "N'Gueli", "Ounianga Kébir", "Rig-Rig", "Sido", "Tine", "Tissi", "Wour"],
  "CAF": ["Amada-Gaza", "Bambouti", "Bangassou", "Bangui", "Birao", "Cantonnier", "Gamboula", "Kabo", "Libongo", "Markounda", "Mobaye", "Mongoumba", "Ngaoundaye", "Paoua", "Salo", "Sido"],
  "COG": ["Bétou", "Dolisie", "Impfondo", "Kellé", "Kimongo", "Lukolela", "Mbinda", "Ngoio", "Ngongo", "Nyanga", "Nzassi"],
  "GAB": ["Añisok", "Bakoumba", "Bitam", "Cocobeach", "Doussala", "Eboro", "Evinayong", "Franceville", "Lekoko", "Medouneu", "Mekambo", "Tchibanga", "Zadie"],
  "GNQ": ["Cogo", "Ebebiyin", "Rio Campo"],
  "NGA": ["Banki", "Calabar", "Ekang", "Gamboru Ngala", "Mfum", "Mubi", "Oron", "Sahuda"],
  "SDN": ["Am Dafok", "El Geneina", "Tine", "Um Dukhun"],
  "SSD": ["Source Yubu"],
  "LBY": ["Koufra", "Maaten al-Sarra"],
  "NER": ["Diffa", "N'Gourti"],
  "COD": ["Kinshasa", "Lukolela", "Mbandaka", "Mobayi-Mbongo", "Ndu", "Zongo"],
  "AGO": ["Cabinda", "Massabi"],
};

export function provincesPourPays(code: string): string[] {
  const provinces = PROVINCES_PAR_PAYS[code];
  return provinces ? [...provinces, MENTION_AUTRE] : [MENTION_AUTRE];
}

export function localitesPourPays(code: string): string[] {
  const localites = LOCALITES_PAR_PAYS[code];
  return localites ? [...localites, MENTION_AUTRE] : [MENTION_AUTRE];
}

/** Alias explicite de localitesPourPays — même liste (déjà uniquement des
 * villes/postes frontaliers, jamais de provinces) — pour le lieu de
 * vaccination, scopé au pays émetteur du passeport (voir PageForms.tsx). */
export const localitesFrontalieresPourPays = localitesPourPays;
