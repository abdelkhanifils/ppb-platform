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

import { detecterCoinsCadreVert } from './detectionCases';

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

/**
 * Coins de l'homographie — voir le corps de la fonction pour le détail du
 * choix (coins du cadre vert directement, plus de marqueur séparé).
 */
export function detecterMarqueurs(source: HTMLCanvasElement): QuatreCoins | null {
  // Les marqueurs de coin imprimés (essayés successivement en carré noir,
  // cercle magenta, puis anneau noir — voir l'historique détaillé dans les
  // versions précédentes de ce fichier) sont retirés du document : demande
  // explicite de ne plus les imprimer du tout. Les coins du cadre vert
  // lui-même (déjà fiables en test réel une fois détectés indépendamment,
  // voir detecterCoinsCadreVert) servent maintenant DIRECTEMENT de coins
  // pour l'homographie — plus besoin d'une étape supplémentaire de
  // recherche de marqueur à cet endroit.
  const coinsCadre = detecterCoinsCadreVert(source);
  if (coinsCadre) return coinsCadre;

  // Repli si le cadre vert n'a pu être détecté dans AUCUN des 4 coins
  // (photo très sombre, cadre partiellement hors champ) : coins de la
  // photo elle-même (marge fixe ~2,7%), jamais vérifiés puisqu'il n'existe
  // plus de marqueur à confirmer à cet endroit — nettement moins fiable,
  // mais mieux que renoncer entièrement à l'homographie.
  const RETRAIT_FRACTION = 0.027;
  const margeX = source.width * RETRAIT_FRACTION;
  const margeY = source.height * RETRAIT_FRACTION;
  return {
    hautGauche: { x: margeX, y: margeY },
    hautDroit: { x: source.width - margeX, y: margeY },
    basGauche: { x: margeX, y: source.height - margeY },
    basDroit: { x: source.width - margeX, y: source.height - margeY },
  };
}

export interface DiagnosticCoin {
  nom: string;
  /** Position trouvée pour ce coin du cadre vert, en pixels de la photo —
   * `null` si ce coin précis n'a pas pu être détecté (couleur verte absente
   * dans sa région de recherche). */
  position: Point | null;
}

export interface DiagnosticMarqueurs {
  coins: DiagnosticCoin[];
  /** Les 4 coins du cadre vert ont-ils TOUS été détectés — condition pour
   * que l'homographie (et donc la lecture automatique positionnée) soit
   * calculée. Si faux, au moins un coin manque (voir `position: null` dans
   * `coins` pour savoir lequel) et le repli sur les coins de la photo
   * elle-même est utilisé à la place, moins fiable. */
  cadreVertDetecte: boolean;
}

/**
 * Version DIAGNOSTIC de detecterMarqueurs — expose le compte de pixels réel
 * et les seuils appliqués pour CHACUN des 4 coins, y compris ceux qui
 * échouent. Sert uniquement à comprendre précisément pourquoi la détection
 * échoue sur une photo donnée (compte trop faible ? trop élevé ? bonne
 * fenêtre mais mauvais compte ?) — jamais utilisée pour le calcul de
 * l'homographie lui-même (voir detecterMarqueurs, qui reste la version de
 * production, volontairement silencieuse sur ces détails).
 */
export function diagnostiquerMarqueurs(source: HTMLCanvasElement): DiagnosticMarqueurs {
  // Bien plus simple qu'avant la suppression des marqueurs imprimés : plus
  // de fenêtre de recherche, de compte de pixels ni de vérification de
  // forme à ce niveau — les coins du cadre vert SONT directement le
  // résultat (voir detecterMarqueurs ci-dessus). Ce diagnostic se contente
  // de rapporter, coin par coin, si detecterCoinsCadreVert l'a trouvé.
  const coinsCadre = detecterCoinsCadreVert(source);
  const coins: DiagnosticCoin[] = [
    { nom: 'Haut-gauche', position: coinsCadre?.hautGauche ?? null },
    { nom: 'Haut-droit', position: coinsCadre?.hautDroit ?? null },
    { nom: 'Bas-gauche', position: coinsCadre?.basGauche ?? null },
    { nom: 'Bas-droit', position: coinsCadre?.basDroit ?? null },
  ];
  return { coins, cadreVertDetecte: coinsCadre !== null };
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
