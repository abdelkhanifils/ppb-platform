/**
 * Détection des champs à cases (nom, CNI, téléphone, pays/localité,
 * province...) par leur SIGNATURE DE COULEUR, en complément de l'ancrage
 * sur le libellé imprimé voisin (voir ocr.ts).
 *
 * Le gabarit imprimé (backend/app/services/pdf_passeport.py::
 * _champ_avec_cases) dessine SYSTÉMATIQUEMENT chaque champ manuscrit avec
 * un fond crème/doré clair (#f3ead9) et des séparateurs dorés foncés
 * (#c9a35c) entre chaque caractère — une géométrie connue et constante,
 * bien plus précise qu'une fenêtre de pixels devinée sous ou à droite d'un
 * libellé (l'ancienne approche, qui pouvait capturer un libellé voisin ou
 * rater une seconde colonne — voir ANCRES_PERSONNE dans ocr.ts).
 *
 * PUR Canvas/JS, PAS d'OpenCV : un blocage complet de l'écran de capture a
 * déjà été causé par le chargement d'OpenCV.js sur un téléphone d'entrée de
 * gamme (voir ocr.ts::DETECTION_PERSPECTIVE_ACTIVE, désactivé pour cette
 * raison). Cette détection par couleur reste volontairement un simple
 * parcours de pixels — rapide, sans dépendance externe, aucun risque
 * comparable.
 *
 * Repli systématique : si rien n'est détecté (photo trop sombre, couleurs
 * délavées par la lumière, gabarit d'une version antérieure), la fonction
 * renvoie un tableau vide — l'appelant (ocr.ts) retombe alors sur la
 * recherche par ancrage existante, sans aucun blocage.
 */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export const COULEUR_FOND_CASE: RGB = { r: 0xf3, g: 0xea, b: 0xd9 };
export const COULEUR_BORD_CASE: RGB = { r: 0xc9, g: 0xa3, b: 0x5c };
/** Vert institutionnel du cadre imprimé — voir
 * backend/app/services/pdf_passeport.py::_fond_page (canvas_obj.rect, VERT). */
export const COULEUR_CADRE_VERT: RGB = { r: 0x0f, g: 0x51, b: 0x32 };
const TOLERANCE_COULEUR = 32;

export function distanceCouleur(a: RGB, b: RGB): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

export interface ChampDetecte {
  /** Coordonnées dans le repère de l'image SOURCE fournie (pas de la copie réduite d'analyse). */
  x: number;
  y: number;
  largeur: number;
  hauteur: number;
  /** Position des séparateurs internes, relative au bord gauche du champ (x=0 = bord gauche). */
  bornesCases: number[];
}

/**
 * Repère toutes les bandes horizontales de couleur "fond de case" dans
 * l'image, puis leurs séparateurs verticaux internes le cas échéant.
 *
 * Analyse sur une copie réduite (≤1000px de large) pour rester rapide même
 * sur une photo haute résolution — même principe de prudence que la
 * réduction déjà appliquée ailleurs dans ce projet pour les calculs
 * pixel par pixel sur téléphone d'entrée de gamme.
 */
export function detecterChamps(source: HTMLCanvasElement | HTMLImageElement | ImageBitmap): ChampDetecte[] {
  const largeurSource = 'width' in source ? source.width : 0;
  const hauteurSource = 'height' in source ? source.height : 0;
  if (!largeurSource || !hauteurSource) return [];

  const LARGEUR_ANALYSE = 1000;
  const echelle = Math.min(1, LARGEUR_ANALYSE / largeurSource);
  const canvasReduit = document.createElement('canvas');
  canvasReduit.width = Math.max(1, Math.round(largeurSource * echelle));
  canvasReduit.height = Math.max(1, Math.round(hauteurSource * echelle));
  const ctx = canvasReduit.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(source as CanvasImageSource, 0, 0, canvasReduit.width, canvasReduit.height);

  const L = canvasReduit.width;
  const H = canvasReduit.height;
  let image: ImageData;
  try {
    image = ctx.getImageData(0, 0, L, H);
  } catch {
    return [];
  }
  const data = image.data;

  const pixel = (x: number, y: number): RGB => {
    const i = (y * L + x) * 4;
    return { r: data[i], g: data[i + 1], b: data[i + 2] };
  };
  const estFond = (x: number, y: number): boolean => distanceCouleur(pixel(x, y), COULEUR_FOND_CASE) <= TOLERANCE_COULEUR;
  const estBord = (x: number, y: number): boolean => distanceCouleur(pixel(x, y), COULEUR_BORD_CASE) <= TOLERANCE_COULEUR;

  // 1. Proportion de pixels "fond de case" par ligne — repère les bandes horizontales.
  const PAS_X = 2; // un pixel sur deux suffit très largement, deux fois plus rapide
  const proportionParLigne = new Float32Array(H);
  for (let y = 0; y < H; y += 1) {
    let compte = 0;
    let total = 0;
    for (let x = 0; x < L; x += PAS_X) {
      total += 1;
      if (estFond(x, y)) compte += 1;
    }
    proportionParLigne[y] = total > 0 ? compte / total : 0;
  }

  const SEUIL_LIGNE = 0.2; // au moins 20% de la largeur en couleur de case
  const HAUTEUR_MIN_BANDE = 4; // filtre le bruit isolé
  const bandes: Array<{ yDebut: number; yFin: number }> = [];
  let yDebutCourant = -1;
  for (let y = 0; y < H; y += 1) {
    const active = proportionParLigne[y] >= SEUIL_LIGNE;
    if (active && yDebutCourant === -1) yDebutCourant = y;
    if (!active && yDebutCourant !== -1) {
      if (y - yDebutCourant >= HAUTEUR_MIN_BANDE) bandes.push({ yDebut: yDebutCourant, yFin: y });
      yDebutCourant = -1;
    }
  }
  if (yDebutCourant !== -1 && H - yDebutCourant >= HAUTEUR_MIN_BANDE) bandes.push({ yDebut: yDebutCourant, yFin: H });

  // 2. Pour chaque bande : bornes gauche/droite réelles, puis séparateurs internes.
  const champs: ChampDetecte[] = [];
  for (const bande of bandes) {
    const yMilieu = Math.round((bande.yDebut + bande.yFin) / 2);
    let xGauche = -1;
    let xDroite = -1;
    for (let x = 0; x < L; x += 1) {
      if (estFond(x, yMilieu) || estBord(x, yMilieu)) {
        if (xGauche === -1) xGauche = x;
        xDroite = x;
      }
    }
    const LARGEUR_MIN_CHAMP = 20;
    if (xGauche === -1 || xDroite - xGauche < LARGEUR_MIN_CHAMP) continue;

    // Séparateurs : colonnes majoritairement "bord" sur la hauteur de la bande.
    const bornesCases: number[] = [];
    const pasY = Math.max(1, Math.round((bande.yFin - bande.yDebut) / 8));
    for (let x = xGauche; x <= xDroite; x += 1) {
      let compteBord = 0;
      let total = 0;
      for (let y = bande.yDebut; y < bande.yFin; y += pasY) {
        total += 1;
        if (estBord(x, y)) compteBord += 1;
      }
      if (total > 0 && compteBord / total >= 0.55) bornesCases.push(x - xGauche);
    }

    champs.push({
      x: Math.round(xGauche / echelle),
      y: Math.round(bande.yDebut / echelle),
      largeur: Math.round((xDroite - xGauche) / echelle),
      hauteur: Math.round((bande.yFin - bande.yDebut) / echelle),
      bornesCases: bornesCases.map((b) => Math.round(b / echelle)),
    });
  }

  return champs;
}

/** Le champ détecté le plus proche d'un point de référence (ex. le coin
 * bas-gauche d'un libellé imprimé), dans un rayon raisonnable — au-delà,
 * mieux vaut ne rien proposer que d'associer un champ au mauvais libellé. */
export function champLePlusProche(
  champs: ChampDetecte[],
  xRef: number,
  yRef: number,
  rayonMax = 260,
): ChampDetecte | null {
  let meilleur: ChampDetecte | null = null;
  let meilleureDistance = Infinity;
  for (const champ of champs) {
    // Distance au coin haut-gauche du champ : c'est la zone la plus proche
    // d'un libellé situé au-dessus ou à gauche, la disposition systématique
    // sur ce gabarit (jamais de champ au-dessus/à gauche de son libellé).
    const d = Math.hypot(champ.x - xRef, champ.y - yRef);
    if (d < meilleureDistance) {
      meilleureDistance = d;
      meilleur = champ;
    }
  }
  return meilleureDistance <= rayonMax ? meilleur : null;
}
