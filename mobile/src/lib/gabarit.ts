/**
 * Positions FIXES de chaque champ à cases, mesurées directement sur le
 * gabarit réellement imprimé (backend/app/services/pdf_passeport.py —
 * pages 3 et 4, jamais générées avec du contenu variable : ce sont des
 * gabarits figés, voir _page_3()/_page_4() qui ne prennent aucun paramètre
 * dépendant du passeport pour leur mise en page).
 *
 * Coordonnées en POURCENTAGE, relatives au CADRE VERT IMPRIMÉ (pas à la
 * feuille A5 entière) — c'est cette zone précise que Capture.tsx recadre
 * réellement au moment de la photo (voir calculerGeometrieGuide). Mesurées
 * à 200 DPI sur un rendu réel du gabarit, script de mesure archivé dans
 * l'historique de cette conversation si un nouveau calibrage est
 * nécessaire un jour (ex. après une modification du gabarit imprimé).
 *
 * Principe : si le cadrage de la photo suit bien le cadre vert imprimé
 * (voir le repère visuel dans Capture.tsx), la position de chaque champ
 * devient PRÉVISIBLE — plus besoin de deviner en cherchant un libellé
 * imprimé ou une couleur : on sait déjà où chercher. Une case sans aucune
 * écriture est un résultat normal et attendu (l'agent n'a pas rempli ce
 * champ, ou une seule personne concernée sur les deux prévues) — traité
 * comme "rien à lire ici", jamais comme une erreur.
 */

export interface ZonePct {
  xDebut: number;
  xFin: number;
  yDebut: number;
  yFin: number;
  /** Nombre de cases individuelles composant ce champ — voir
   * backend/app/services/pdf_passeport.py, chaque champ n'a pas forcément
   * le même nombre (10 pour les champs de la page 3, mais 8 pour une date
   * de vaccination et 13 pour un lieu de vaccination — vérifié dans le
   * code, pas une supposition). */
  nbCases: number;
}

/** Légère marge de tolérance autour de chaque zone mesurée, pour absorber
 * un cadrage jamais parfaitement pixel pour pixel malgré le repère visuel.
 * Appliquée uniquement au RECADRAGE (voir ocr.ts::decouperZone) — jamais au
 * calcul des séparateurs entre cases individuelles, qui doit rester basé
 * sur la zone EXACTE mesurée pour tomber juste. */
export const MARGE_TOLERANCE_PCT = 1.2;

export const GABARIT_PAGE3 = {
  eleveur: {
    nom_prenom: { xDebut: 1.18, xFin: 41.2, yDebut: 18.05, yFin: 20.75, nbCases: 10 },
    numero_cni: { xDebut: 1.18, xFin: 41.2, yDebut: 25.41, yFin: 28.11, nbCases: 10 },
    telephone: { xDebut: 1.18, xFin: 41.2, yDebut: 32.77, yFin: 35.41, nbCases: 10 },
  },
  convoyeur: {
    nom_prenom: { xDebut: 51.18, xFin: 91.2, yDebut: 18.05, yFin: 20.75, nbCases: 10 },
    numero_cni: { xDebut: 51.18, xFin: 91.2, yDebut: 25.41, yFin: 28.11, nbCases: 10 },
    telephone: { xDebut: 51.18, xFin: 91.2, yDebut: 32.77, yFin: 35.41, nbCases: 10 },
  },
  itineraire: {
    // Champ combiné pays+localité (une seule rangée de cases sur le papier
    // — voir reconnaitrePays dans ocr.ts) : le préfixe (code ISO ou nom) est
    // séparé de la localité après lecture, pas avant.
    origine_pays_localite: { xDebut: 1.36, xFin: 37.21, yDebut: 46.6, yFin: 49.31, nbCases: 10 },
    destination_pays_localite: { xDebut: 51.45, xFin: 87.21, yDebut: 46.6, yFin: 49.31, nbCases: 10 },
    province_origine: { xDebut: 1.36, xFin: 37.21, yDebut: 55.03, yFin: 57.74, nbCases: 10 },
    province_destination: { xDebut: 51.45, xFin: 87.21, yDebut: 55.03, yFin: 57.74, nbCases: 10 },
  },
} as const;

/** Ordre des maladies tel qu'imprimé sur le gabarit (grille 2×2 — voir
 * _page_4()::maladies) : Peste (haut-gauche), Péripneumonie (haut-droite),
 * Charbon (bas-gauche), Trypanosomiase (bas-droite). Chaque bloc a sa
 * propre rangée Date (8 cases) puis sa propre rangée Lieu (13 cases —
 * volontairement différent, vérifié dans pdf_passeport.py::_page_4). */
export const GABARIT_PAGE4 = {
  peste_petits_ruminants: {
    date: { xDebut: 1.18, xFin: 27.5, yDebut: 18.24, yFin: 20.44, nbCases: 8 },
    lieu: { xDebut: 1.18, xFin: 43.92, yDebut: 22.64, yFin: 24.84, nbCases: 13 },
  },
  peripneumonie_contagieuse: {
    date: { xDebut: 51.18, xFin: 77.5, yDebut: 18.24, yFin: 20.44, nbCases: 8 },
    lieu: { xDebut: 51.18, xFin: 93.92, yDebut: 22.64, yFin: 24.84, nbCases: 13 },
  },
  charbon: {
    date: { xDebut: 1.18, xFin: 27.5, yDebut: 31.07, yFin: 33.27, nbCases: 8 },
    lieu: { xDebut: 1.18, xFin: 43.92, yDebut: 35.53, yFin: 37.74, nbCases: 13 },
  },
  trypanosomiase: {
    date: { xDebut: 51.18, xFin: 77.5, yDebut: 31.07, yFin: 33.27, nbCases: 8 },
    lieu: { xDebut: 51.18, xFin: 93.92, yDebut: 35.53, yFin: 37.74, nbCases: 13 },
  },
} as const;
