/**
 * Détection des 4 marqueurs de coin (carrés noirs pleins imprimés aux
 * angles du cadre vert — voir backend/app/services/pdf_passeport.py::
 * _fond_page) et calcul d'une transformation de perspective précise à
 * partir de ces 4 points.
 *
 * Principe (proposé et validé avec l'utilisateur avant implémentation) :
 * le cadre vert et son contenu sont imprimés dans la MÊME passe
 * d'impression, sur le même PDF — un défaut de positionnement de la
 * feuille dans l'imprimante déplace cadre ET contenu ENSEMBLE, comme un
 * seul bloc rigide. La vraie source d'imprécision n'est donc pas
 * l'impression, mais la PRISE DE PHOTO : si le téléphone n'est pas
 * parfaitement perpendiculaire à la page, la déformation de perspective
 * qui en résulte n'est PAS uniforme (le haut de la page peut être
 * légèrement plus proche de l'appareil que le bas), ce qu'un simple calcul
 * de pourcentage linéaire ne peut pas corriger.
 *
 * Avec 4 points de référence à position connue, on peut calculer une vraie
 * transformation géométrique (homographie) qui absorbe cette déformation
 * — contrairement à la détection de contours par OpenCV (voir
 * perspective.ts, désactivée après un blocage complet de l'écran sur un
 * téléphone d'entrée de gamme), cette approche ne demande qu'un
 * balayage de pixels localisé autour de 4 petites zones, jamais un
 * traitement de l'image entière : le risque de blocage est structurellement
 * écarté, pas seulement optimisé.
 */

interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface QuatreCoins {
  hautGauche: Point;
  hautDroit: Point;
  basGauche: Point;
  basDroit: Point;
}

const SEUIL_NOIR = 70; // un marqueur imprimé est un noir plein, bien en dessous de tout autre élément de la page

function estNoir(r: number, g: number, b: number): boolean {
  return r < SEUIL_NOIR && g < SEUIL_NOIR && b < SEUIL_NOIR;
}

/**
 * Cherche le marqueur noir dans une petite fenêtre autour d'un point
 * attendu, et renvoie le CENTRE DE MASSE des pixels noirs trouvés (plus
 * précis qu'une simple boîte englobante face au bruit de compression JPEG
 * en bordure du marqueur).
 */
function chercherMarqueurLocal(
  data: Uint8ClampedArray,
  largeurImage: number,
  hauteurImage: number,
  centreX: number,
  centreY: number,
  rayonFenetre: number,
  tailleMarqueurAttendue: number,
): Point | null {
  const xDebut = Math.max(0, Math.round(centreX - rayonFenetre));
  const xFin = Math.min(largeurImage, Math.round(centreX + rayonFenetre));
  const yDebut = Math.max(0, Math.round(centreY - rayonFenetre));
  const yFin = Math.min(hauteurImage, Math.round(centreY + rayonFenetre));

  let sommeX = 0;
  let sommeY = 0;
  let compte = 0;
  for (let y = yDebut; y < yFin; y += 1) {
    for (let x = xDebut; x < xFin; x += 1) {
      const i = (y * largeurImage + x) * 4;
      if (estNoir(data[i], data[i + 1], data[i + 2])) {
        sommeX += x;
        sommeY += y;
        compte += 1;
      }
    }
  }

  // Un marqueur réel occupe un petit bloc COMPACT de pixels noirs — trop
  // peu signale du bruit isolé (texte fin, ombre) ; trop signale à
  // l'inverse un grand aplat sombre (écriture dense, ombre étendue) capté
  // à tort depuis qu'une fenêtre de recherche plus large a été nécessaire
  // (voir detecterMarqueurs ci-dessous) — sans ce plafond, un tel aplat
  // dominerait le calcul du centre et donnerait un point très éloigné du
  // vrai marqueur.
  const SEUIL_PIXELS_MIN = 6;
  const airesMarqueurAttendue = tailleMarqueurAttendue * tailleMarqueurAttendue;
  const SEUIL_PIXELS_MAX = Math.max(SEUIL_PIXELS_MIN * 4, airesMarqueurAttendue * 4);
  if (compte < SEUIL_PIXELS_MIN || compte > SEUIL_PIXELS_MAX) return null;
  return { x: sommeX / compte, y: sommeY / compte };
}

/**
 * Détecte les 4 marqueurs de coin sur la photo, à partir d'une estimation
 * initiale de la zone du cadre (voir detecterCadreVert dans
 * detectionCases.ts) — cette estimation sert uniquement de point de départ
 * pour la recherche localisée de chaque marqueur, pas de résultat final.
 *
 * Repli : `null` si un seul des 4 marqueurs est introuvable — mieux vaut
 * alors retomber sur le cadre vert détecté (moins précis mais fiable) que
 * de calculer une homographie à partir de points partiellement devinés.
 */
export function detecterMarqueurs(
  source: HTMLCanvasElement,
  estimationCadre: { x: number; y: number; largeur: number; hauteur: number },
): QuatreCoins | null {
  const ctx = source.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  let image: ImageData;
  try {
    image = ctx.getImageData(0, 0, source.width, source.height);
  } catch {
    return null;
  }
  const { data } = image;

  // Fenêtre volontairement généreuse (20% de la plus grande dimension du
  // cadre estimé, contre 12% initialement) : un léger écart de cadrage à la
  // capture suffisait à faire sortir le vrai marqueur de la fenêtre de
  // recherche, faisant systématiquement échouer la détection — confirmé en
  // test réel sur plusieurs photos avec un simple décalage de prise de vue,
  // pas un angle prononcé. Combinée à l'estimation de cadre désormais
  // robuste aux pixels aberrants (percentiles plutôt que min/max, voir
  // detectionCases.ts::detecterCadreVert) et au plafond de taille dans
  // chercherMarqueurLocal ci-dessus, cette marge plus large absorbe
  // l'imprécision résiduelle sans risquer d'accrocher un grand aplat sombre
  // (le marqueur reste un carré compact, facilement discriminé par sa
  // taille même dans une fenêtre de recherche plus grande).
  const rayonFenetre = Math.max(estimationCadre.largeur, estimationCadre.hauteur) * 0.2;

  // Taille attendue d'un marqueur en pixels sur CETTE photo : le cadre vert
  // correspond à environ 140mm de large sur le papier (148mm - la marge de
  // 4mm de chaque côté, voir pdf_passeport.py::_fond_page), le marqueur
  // fait 2,2mm — la règle de trois donne sa taille en pixels à partir de la
  // largeur de cadre estimée.
  const tailleMarqueurAttendue = (2.2 / 140) * estimationCadre.largeur;

  const coinsEstimes = {
    hautGauche: { x: estimationCadre.x, y: estimationCadre.y },
    hautDroit: { x: estimationCadre.x + estimationCadre.largeur, y: estimationCadre.y },
    basGauche: { x: estimationCadre.x, y: estimationCadre.y + estimationCadre.hauteur },
    basDroit: { x: estimationCadre.x + estimationCadre.largeur, y: estimationCadre.y + estimationCadre.hauteur },
  };

  const resultats: Partial<QuatreCoins> = {};
  for (const [cle, estime] of Object.entries(coinsEstimes) as Array<[keyof QuatreCoins, Point]>) {
    const trouve = chercherMarqueurLocal(data, source.width, source.height, estime.x, estime.y, rayonFenetre, tailleMarqueurAttendue);
    if (!trouve) return null;
    resultats[cle] = trouve;
  }

  return resultats as QuatreCoins;
}

/**
 * Calcule l'homographie (transformation de perspective) faisant
 * correspondre un repère normalisé [0,1]×[0,1] (0=coin haut-gauche du
 * cadre, 1=coin bas-droit) aux 4 points RÉELLEMENT détectés sur la photo —
 * absorbe une déformation de perspective non uniforme (photo prise avec un
 * léger angle), ce qu'une simple mise à l'échelle linéaire ne peut pas
 * faire.
 *
 * Résolution directe (4 points = système déterminé, pas une régression) —
 * élimination de Gauss avec pivot partiel sur 8 équations à 8 inconnues,
 * un calcul négligeable en temps de traitement (aucune commune mesure avec
 * un balayage de pixels sur l'image entière).
 */
export function calculerHomographie(coins: QuatreCoins): number[] | null {
  const src: Array<[number, number]> = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ];
  const dst: Array<[number, number]> = [
    [coins.hautGauche.x, coins.hautGauche.y],
    [coins.hautDroit.x, coins.hautDroit.y],
    [coins.basGauche.x, coins.basGauche.y],
    [coins.basDroit.x, coins.basDroit.y],
  ];

  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const [x, y] = src[i];
    const [xp, yp] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -x * xp, -y * xp]);
    b.push(xp);
    A.push([0, 0, 0, x, y, 1, -x * yp, -y * yp]);
    b.push(yp);
  }

  const h = resoudreSystemeLineaire(A, b);
  if (!h) return null;
  return [...h, 1];
}

/** Élimination de Gauss avec pivot partiel — `null` si le système est
 * dégénéré (4 points alignés ou confondus, cas anormal jamais attendu en
 * pratique pour 4 vrais coins de page). */
function resoudreSystemeLineaire(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((ligne, i) => [...ligne, b[i]]);

  for (let col = 0; col < n; col += 1) {
    let lignePivotMax = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(M[r][col]) > Math.abs(M[lignePivotMax][col])) lignePivotMax = r;
    }
    [M[col], M[lignePivotMax]] = [M[lignePivotMax], M[col]];
    const pivot = M[col][col];
    if (Math.abs(pivot) < 1e-9) return null;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const facteur = M[r][col] / pivot;
      for (let c = col; c <= n; c += 1) M[r][c] -= facteur * M[col][c];
    }
  }

  return M.map((ligne, i) => ligne[n] / ligne[i]);
}

/** Applique l'homographie à un point du repère normalisé [0,1]×[0,1] pour
 * obtenir sa position réelle en pixels sur la photo. */
export function appliquerHomographie(h: number[], x: number, y: number): Point {
  const [h11, h12, h13, h21, h22, h23, h31, h32] = h;
  const denom = h31 * x + h32 * y + 1;
  return { x: (h11 * x + h12 * y + h13) / denom, y: (h21 * x + h22 * y + h23) / denom };
}
