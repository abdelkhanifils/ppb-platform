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
}

/** Légère marge de tolérance autour de chaque zone mesurée, pour absorber
 * un cadrage jamais parfaitement pixel pour pixel malgré le repère visuel. */
const MARGE_TOLERANCE_PCT = 1.2;

function avecMarge(zone: ZonePct): ZonePct {
  return {
    xDebut: Math.max(0, zone.xDebut - MARGE_TOLERANCE_PCT),
    xFin: Math.min(100, zone.xFin + MARGE_TOLERANCE_PCT),
    yDebut: Math.max(0, zone.yDebut - MARGE_TOLERANCE_PCT),
    yFin: Math.min(100, zone.yFin + MARGE_TOLERANCE_PCT),
  };
}

export const GABARIT_PAGE3 = {
  eleveur: {
    nom_prenom: avecMarge({ xDebut: 1.18, xFin: 41.2, yDebut: 18.05, yFin: 20.75 }),
    numero_cni: avecMarge({ xDebut: 1.18, xFin: 41.2, yDebut: 25.41, yFin: 28.11 }),
    telephone: avecMarge({ xDebut: 1.18, xFin: 41.2, yDebut: 32.77, yFin: 35.41 }),
  },
  convoyeur: {
    nom_prenom: avecMarge({ xDebut: 51.18, xFin: 91.2, yDebut: 18.05, yFin: 20.75 }),
    numero_cni: avecMarge({ xDebut: 51.18, xFin: 91.2, yDebut: 25.41, yFin: 28.11 }),
    telephone: avecMarge({ xDebut: 51.18, xFin: 91.2, yDebut: 32.77, yFin: 35.41 }),
  },
  itineraire: {
    // Champ combiné pays+localité (une seule rangée de cases sur le papier
    // — voir reconnaitrePays dans ocr.ts) : le préfixe (code ISO ou nom) est
    // séparé de la localité après lecture, pas avant.
    origine_pays_localite: avecMarge({ xDebut: 1.36, xFin: 37.21, yDebut: 46.6, yFin: 49.31 }),
    destination_pays_localite: avecMarge({ xDebut: 51.45, xFin: 87.21, yDebut: 46.6, yFin: 49.31 }),
    province_origine: avecMarge({ xDebut: 1.36, xFin: 37.21, yDebut: 55.03, yFin: 57.74 }),
    province_destination: avecMarge({ xDebut: 51.45, xFin: 87.21, yDebut: 55.03, yFin: 57.74 }),
  },
} as const;

/** Ordre des maladies tel qu'imprimé sur le gabarit (grille 2×2 — voir
 * _page_4()::maladies) : Peste (haut-gauche), Péripneumonie (haut-droite),
 * Charbon (bas-gauche), Trypanosomiase (bas-droite). Chaque bloc a sa
 * propre rangée Date puis sa propre rangée Lieu. */
export const GABARIT_PAGE4 = {
  peste_petits_ruminants: {
    date: avecMarge({ xDebut: 1.18, xFin: 27.5, yDebut: 18.24, yFin: 20.44 }),
    lieu: avecMarge({ xDebut: 1.18, xFin: 43.92, yDebut: 22.64, yFin: 24.84 }),
  },
  peripneumonie_contagieuse: {
    date: avecMarge({ xDebut: 51.18, xFin: 77.5, yDebut: 18.24, yFin: 20.44 }),
    lieu: avecMarge({ xDebut: 51.18, xFin: 93.92, yDebut: 22.64, yFin: 24.84 }),
  },
  charbon: {
    date: avecMarge({ xDebut: 1.18, xFin: 27.5, yDebut: 31.07, yFin: 33.27 }),
    lieu: avecMarge({ xDebut: 1.18, xFin: 43.92, yDebut: 35.53, yFin: 37.74 }),
  },
  trypanosomiase: {
    date: avecMarge({ xDebut: 51.18, xFin: 77.5, yDebut: 31.07, yFin: 33.27 }),
    lieu: avecMarge({ xDebut: 51.18, xFin: 93.92, yDebut: 35.53, yFin: 37.74 }),
  },
} as const;
