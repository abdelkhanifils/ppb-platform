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

  // 1. Plus longue plage CONTIGUË de couleur "case" par ligne — PAS une
  // proportion sur la largeur totale de la photo. Une case comme « Nom et
  // prénom » n'occupe qu'une fraction de la largeur de la page (encore
  // moins en disposition à deux colonnes) : exiger qu'un pourcentage global
  // de la ligne entière soit coloré ratait donc SYSTÉMATIQUEMENT toute case
  // isolée, même parfaitement reconnue pixel par pixel (confirmé : la carte
  // thermique montrait du vert/bleu net sur les cases, mais aucune zone
  // n'était pourtant détectée — la reconnaissance couleur fonctionnait, le
  // seuil de regroupement était juste inadapté à la taille réelle d'une case
  // par rapport à la largeur totale de la photo).
  const TROU_MAX_LIGNE = 10;
  const pasX = 2; // un pixel sur deux suffit très largement, deux fois plus rapide
  const plusLonguePlage = (y: number): number => {
    let maxPlage = 0;
    let debut = -1;
    let dernierActif = -1;
    for (let x = 0; x < L; x += pasX) {
      const actif = estFond(x, y) || estBord(x, y);
      if (actif) {
        if (debut === -1) debut = x;
        dernierActif = x;
      } else if (debut !== -1 && x - dernierActif > TROU_MAX_LIGNE) {
        maxPlage = Math.max(maxPlage, dernierActif - debut);
        debut = -1;
      }
    }
    if (debut !== -1) maxPlage = Math.max(maxPlage, dernierActif - debut);
    return maxPlage;
  };

  const LARGEUR_MIN_PLAGE = 40; // au moins ~40px dans l'image réduite (≤1000px de large)
  const ligneActive = new Uint8Array(H);
  for (let y = 0; y < H; y += 1) {
    ligneActive[y] = plusLonguePlage(y) >= LARGEUR_MIN_PLAGE ? 1 : 0;
  }

  const HAUTEUR_MIN_BANDE = 4; // filtre le bruit isolé
  const bandes: Array<{ yDebut: number; yFin: number }> = [];
  let yDebutCourant = -1;
  for (let y = 0; y < H; y += 1) {
    const active = ligneActive[y] === 1;
    if (active && yDebutCourant === -1) yDebutCourant = y;
    if (!active && yDebutCourant !== -1) {
      if (y - yDebutCourant >= HAUTEUR_MIN_BANDE) bandes.push({ yDebut: yDebutCourant, yFin: y });
      yDebutCourant = -1;
    }
  }
  if (yDebutCourant !== -1 && H - yDebutCourant >= HAUTEUR_MIN_BANDE) bandes.push({ yDebut: yDebutCourant, yFin: H });

  // 2. Pour chaque bande : SEGMENTS contigus (pas juste min/max) — une
  // disposition à deux colonnes (propriétaire/convoyeur côte à côte) a DEUX
  // champs séparés par un espace sur la même bande horizontale ; prendre
  // juste le pixel le plus à gauche et le plus à droite les aurait fusionnés
  // en un seul champ, ce qui aurait cassé exactement le cas qu'on cherche à
  // corriger avec ce module (mélange entre colonnes).
  const TROU_MAX = 12; // tolère un petit trou (anti-crénelage, reflet local) sans couper le segment
  const champs: ChampDetecte[] = [];
  for (const bande of bandes) {
    const yMilieu = Math.round((bande.yDebut + bande.yFin) / 2);
    const actif = new Uint8Array(L);
    for (let x = 0; x < L; x += 1) {
      actif[x] = estFond(x, yMilieu) || estBord(x, yMilieu) ? 1 : 0;
    }

    const segments: Array<{ debut: number; fin: number }> = [];
    let debut = -1;
    let dernierActif = -1;
    for (let x = 0; x < L; x += 1) {
      if (actif[x]) {
        if (debut === -1) debut = x;
        dernierActif = x;
      } else if (debut !== -1 && x - dernierActif > TROU_MAX) {
        segments.push({ debut, fin: dernierActif });
        debut = -1;
      }
    }
    if (debut !== -1) segments.push({ debut, fin: dernierActif });

    const LARGEUR_MIN_CHAMP = 20;
    for (const segment of segments) {
      const xGauche = segment.debut;
      const xDroite = segment.fin;
      if (xDroite - xGauche < LARGEUR_MIN_CHAMP) continue;

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

export interface CadreDetecte {
  x: number;
  y: number;
  largeur: number;
  hauteur: number;
}

/**
 * Détecte la boîte englobante du cadre vert imprimé sur la photo, en
 * repérant simplement le pixel vert le plus extérieur dans chaque
 * direction — le cadre est TOUJOURS l'élément vert le plus externe de la
 * page (les bandeaux de titre, également verts, sont toujours à
 * l'intérieur), donc cette approche simple suffit sans avoir à distinguer
 * un trait fin d'un bandeau plein.
 *
 * Corrige un bug confirmé en test réel : les coordonnées fixes de
 * ./gabarit.ts supposent que la photo recadrée correspond exactement au
 * cadre vert (voir Capture.tsx) — mais deux photos réelles peuvent avoir
 * une marge de fond légèrement différente autour de ce cadre selon la
 * précision de l'alignement de l'agent, décalant TOUS les champs de la
 * même façon. Recalculer la vraie zone de référence sur CHAQUE photo,
 * plutôt que de supposer un cadrage toujours identique, élimine ce
 * décalage systématique.
 *
 * Repli : `null` si aucun pixel vert n'est trouvé (photo très sombre,
 * cadre hors champ...) — l'appelant retombe alors sur les coordonnées du
 * gabarit appliquées à la photo entière, comportement d'avant cette
 * détection, jamais un blocage.
 */
export function detecterCadreVert(source: HTMLCanvasElement | HTMLImageElement | ImageBitmap): CadreDetecte | null {
  const largeurSource = 'width' in source ? source.width : 0;
  const hauteurSource = 'height' in source ? source.height : 0;
  if (!largeurSource || !hauteurSource) return null;

  const LARGEUR_ANALYSE = 800;
  const echelle = Math.min(1, LARGEUR_ANALYSE / largeurSource);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(largeurSource * echelle));
  canvas.height = Math.max(1, Math.round(hauteurSource * echelle));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source as CanvasImageSource, 0, 0, canvas.width, canvas.height);

  let image: ImageData;
  try {
    image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return null;
  }
  const data = image.data;
  const L = canvas.width;
  const H = canvas.height;
  const TOLERANCE = 55;

  let xMin = L;
  let xMax = -1;
  let yMin = H;
  let yMax = -1;

  // Pas de 2 : un pixel sur deux suffit largement pour une boîte englobante,
  // deux fois plus rapide — prudence après le blocage déjà rencontré avec un
  // calcul pixel par pixel trop gourmand (voir perspective.ts, désactivé).
  const PAS = 2;
  for (let y = 0; y < H; y += PAS) {
    for (let x = 0; x < L; x += PAS) {
      const i = (y * L + x) * 4;
      if (distanceCouleur({ r: data[i], g: data[i + 1], b: data[i + 2] }, COULEUR_CADRE_VERT) <= TOLERANCE) {
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
      }
    }
  }

  if (xMax < 0 || yMax < 0) return null;

  return {
    x: Math.round(xMin / echelle),
    y: Math.round(yMin / echelle),
    largeur: Math.round((xMax - xMin) / echelle),
    hauteur: Math.round((yMax - yMin) / echelle),
  };
}

/**
 * Carte thermique de diagnostic : reproduit la photo avec chaque pixel
 * classé par l'algorithme teinté (vert = reconnu comme fond de case, bleu =
 * reconnu comme séparateur, inchangé sinon). Sert à voir IMMÉDIATEMENT si
 * la détection de couleur repère quoi que ce soit sur une vraie photo,
 * plutôt que de deviner un nouveau réglage de tolérance à l'aveugle —
 * indispensable après un premier essai réel où AUCUN champ n'a été détecté
 * (tolérance calibrée sur les couleurs d'impression pures, jamais testée
 * face aux variations réelles de lumière/compression JPEG).
 *
 * Toujours sur la copie réduite utilisée pour l'analyse (voir
 * detecterChamps) — c'est exactement ce que l'algorithme "voit", pas la
 * photo pleine résolution.
 */
export function genererCarteThermique(source: HTMLCanvasElement | HTMLImageElement | ImageBitmap): HTMLCanvasElement | null {
  const largeurSource = 'width' in source ? source.width : 0;
  const hauteurSource = 'height' in source ? source.height : 0;
  if (!largeurSource || !hauteurSource) return null;

  const LARGEUR_ANALYSE = 1000;
  const echelle = Math.min(1, LARGEUR_ANALYSE / largeurSource);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(largeurSource * echelle));
  canvas.height = Math.max(1, Math.round(hauteurSource * echelle));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source as CanvasImageSource, 0, 0, canvas.width, canvas.height);

  let image: ImageData;
  try {
    image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return null;
  }
  const data = image.data;

  for (let i = 0; i < data.length; i += 4) {
    const c: RGB = { r: data[i], g: data[i + 1], b: data[i + 2] };
    if (distanceCouleur(c, COULEUR_FOND_CASE) <= TOLERANCE_COULEUR) {
      data[i] = 0; data[i + 1] = 255; data[i + 2] = 0; // vert vif = fond reconnu
    } else if (distanceCouleur(c, COULEUR_BORD_CASE) <= TOLERANCE_COULEUR) {
      data[i] = 0; data[i + 1] = 100; data[i + 2] = 255; // bleu vif = séparateur reconnu
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}
