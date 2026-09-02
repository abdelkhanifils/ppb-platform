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

// Magenta essayé ensuite (cercle plein), abandonné à son tour : la couleur
// imprimée s'est révélée décalée de façon variable selon l'éclairage et
// l'appareil photo (confirmé sur plusieurs tests réels, écart de couleur
// mesuré ~110-160 selon la photo, jamais stable) — une correspondance de
// couleur exacte n'est pas assez fiable dans des conditions de prise de vue
// réelles et variées.
//
// Retour à une détection par NOIRCEUR (déjà éprouvée fiable niveau
// position lors du tout premier essai, carré noir plein) — mais le
// marqueur est maintenant un ANNEAU (disque noir à centre blanc), pas un
// aplat plein : le problème du premier essai n'était pas de détecter du
// noir de façon fiable, mais de le confondre avec l'écriture manuscrite
// dense à proximité. Corrigé ici en exigeant une FORME précise (centre
// creux) que du texte manuscrit ne produit quasiment jamais, plutôt qu'en
// changeant de couleur — le noir reste la couleur la plus fiable à
// détecter quel que soit l'éclairage.
const SEUIL_NOIR = 70;

function estNoir(r: number, g: number, b: number): boolean {
  return r < SEUIL_NOIR && g < SEUIL_NOIR && b < SEUIL_NOIR;
}

interface ResultatScanFenetre {
  centre: Point | null;
  compte: number;
}

/** Scanne une fenêtre et renvoie le compte BRUT de pixels noirs trouvés,
 * sans jugement d'acceptation — utilisé à la fois par chercherMarqueurLocal
 * (qui applique les seuils) et par diagnostiquerMarqueurs (qui expose les
 * chiffres bruts pour comprendre POURQUOI un coin est accepté ou rejeté,
 * plutôt que de deviner de nouveaux seuils à l'aveugle). */
function scannerFenetre(
  data: Uint8ClampedArray,
  largeurImage: number,
  hauteurImage: number,
  centreX: number,
  centreY: number,
  rayonFenetre: number,
): ResultatScanFenetre {
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

  return { centre: compte > 0 ? { x: sommeX / compte, y: sommeY / compte } : null, compte };
}

/** Vérifie que le centre d'un candidat marqueur est CREUX (majoritairement
 * clair) — la signature qui distingue un anneau imprimé d'un simple bloc de
 * texte manuscrit dense, qui lui reste sombre jusqu'au centre. C'est cette
 * vérification de FORME, pas la couleur, qui évite la confusion avec
 * l'écriture — voir l'historique en tête de fichier. */
function centreEstCreux(
  data: Uint8ClampedArray,
  largeurImage: number,
  hauteurImage: number,
  centre: Point,
  rayonInterieur: number,
): boolean {
  const xDebut = Math.max(0, Math.round(centre.x - rayonInterieur));
  const xFin = Math.min(largeurImage, Math.round(centre.x + rayonInterieur));
  const yDebut = Math.max(0, Math.round(centre.y - rayonInterieur));
  const yFin = Math.min(hauteurImage, Math.round(centre.y + rayonInterieur));
  if (xFin <= xDebut || yFin <= yDebut) return false;

  let total = 0;
  let clairs = 0;
  for (let y = yDebut; y < yFin; y += 1) {
    for (let x = xDebut; x < xFin; x += 1) {
      const i = (y * largeurImage + x) * 4;
      total += 1;
      if (!estNoir(data[i], data[i + 1], data[i + 2])) clairs += 1;
    }
  }
  // Majorité franche plutôt que 50% pile : un peu de bruit/anti-crénelage
  // sur le pourtour du trou ne doit pas faire échouer un vrai anneau.
  return total > 0 && clairs / total >= 0.55;
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
  const { centre, compte } = scannerFenetre(data, largeurImage, hauteurImage, centreX, centreY, rayonFenetre);

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
  if (compte < SEUIL_PIXELS_MIN || compte > SEUIL_PIXELS_MAX || !centre) return null;

  // Rayon du trou blanc central : 1,1mm sur un marqueur de 4,8mm de
  // diamètre extérieur (voir pdf_passeport.py::_fond_page) — soit environ
  // 23% du diamètre attendu en pixels sur cette photo. Légèrement réduit
  // (0,18 au lieu de 0,229) par prudence : mieux vaut tester une zone un
  // peu plus petite que le vrai trou (marge de sécurité contre un
  // mauvais centrage) qu'une zone qui déborderait sur l'anneau noir lui-même.
  const rayonInterieur = tailleMarqueurAttendue * 0.18;
  if (!centreEstCreux(data, largeurImage, hauteurImage, centre, rayonInterieur)) return null;

  return centre;
}

/**
 * Détecte les 4 marqueurs de coin sur la photo, en partant directement des
 * 4 COINS DE LA PHOTO ELLE-MÊME — pas d'une estimation intermédiaire du
 * cadre vert par couleur (voir detecterCadreVert dans detectionCases.ts,
 * désormais utilisée uniquement comme repère pour les champs quand aucun
 * marqueur n'est trouvé, plus pour cette recherche).
 *
 * Ce choix (proposé par l'utilisateur, retenu après plusieurs échecs de
 * l'estimation par couleur) s'appuie sur un fait structurel du parcours de
 * capture : la photo envoyée ici a déjà été VALIDÉE par l'agent sur l'écran
 * d'ajustement manuel (voir AjusterCadrage.tsx — déplacer/zoomer jusqu'à
 * faire correspondre le document au cadre-guide avant de continuer). Le
 * cadre vert imprimé est donc déjà censé se trouver tout près des bords de
 * cette photo, par construction — chercher depuis les coins de l'image
 * elle-même élimine un maillon fragile (l'estimation par couleur, sensible
 * à l'éclairage) plutôt que d'essayer de le rendre encore plus tolérant.
 *
 * Repli : `null` si un seul des 4 marqueurs est introuvable — mieux vaut
 * alors retomber sur le cadre vert détecté (moins précis mais fiable) que
 * de calculer une homographie à partir de points partiellement devinés.
 */
export function detecterMarqueurs(source: HTMLCanvasElement): QuatreCoins | null {
  const ctx = source.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  let image: ImageData;
  try {
    image = ctx.getImageData(0, 0, source.width, source.height);
  } catch {
    return null;
  }
  const { data } = image;

  // Point de départ pour la recherche de chaque marqueur — TROIS stratégies
  // tentées dans l'ordre, chacune corrigeant un échec réel de la précédente :
  //
  // 1. Coins de la photo elle-même (marge fixe ~2,7%) : écarté après un
  //    test réel montrant une marge asymétrique (cadrage humain imparfait).
  // 2. Boîte englobante globale par couleur (detecterCadreVert) : écartée à
  //    son tour après un second test réel — le document contient PLUSIEURS
  //    zones vertes (le mince trait du cadre, mais aussi des bandeaux de
  //    section remplis comme « PROPRIÉTAIRE »/« CONVOYEUR »), et ces
  //    bandeaux, bien plus grands en surface que le trait du cadre,
  //    pouvaient dominer le percentile et décaler toute la boîte vers
  //    l'intérieur de la page.
  // 3. Détection INDÉPENDANTE de chaque coin (detecterCoinsCadreVert) :
  //    chaque coin est cherché séparément, dans sa propre région restreinte,
  //    en retenant le pixel vert le plus proche du coin lui-même — un
  //    bandeau interne, même présent dans cette région, n'atteint jamais le
  //    coin exact comme le fait le trait du cadre. Reprise en priorité ; les
  //    coins de la photo ne servent plus que de tout dernier repli, si la
  //    couleur verte n'a pu être détectée dans AUCUN des 4 coins.
  const coinsCadre = detecterCoinsCadreVert(source);
  const RETRAIT_FRACTION = 0.027;
  const margeX = source.width * RETRAIT_FRACTION;
  const margeY = source.height * RETRAIT_FRACTION;

  const coinsEstimes = coinsCadre
    ? coinsCadre
    : {
        hautGauche: { x: margeX, y: margeY },
        hautDroit: { x: source.width - margeX, y: margeY },
        basGauche: { x: margeX, y: source.height - margeY },
        basDroit: { x: source.width - margeX, y: source.height - margeY },
      };

  // Fenêtre de recherche : sa taille dépend de la confiance qu'on peut
  // avoir dans l'estimation de départ.
  //
  // Coins du cadre détectés indépendamment (cas normal) : fenêtre RESSERÉE
  // à 6% de la largeur du cadre (déduite de la distance entre les 2 coins du
  // haut) — cette estimation par coin est directement ancrée sur le trait du
  // cadre lui-même, pas la peine d'une fenêtre large pour l'absorber.
  //
  // Repli sur les coins de la photo (cadre vert non détecté du tout) :
  // fenêtre large conservée (20% de la photo), cette estimation étant
  // nettement moins fiable (voir plus haut dans ce fichier).
  const largeurCadre = coinsCadre ? coinsCadre.hautDroit.x - coinsCadre.hautGauche.x : null;
  const rayonFenetre = largeurCadre ? largeurCadre * 0.06 : Math.max(source.width, source.height) * 0.2;

  // Taille attendue d'un marqueur en pixels sur CETTE photo : le cadre vert
  // correspond à environ 140mm de large sur le papier (148mm - la marge de
  // 4mm de chaque côté), le marqueur (anneau noir) fait 4,8mm de
  // diamètre (voir pdf_passeport.py::_fond_page, RAYON_MARQUEUR = 2,4mm) —
  // la règle de trois donne sa taille en pixels à partir de la largeur de
  // la photo.
  const largeurReference = largeurCadre ?? source.width;
  const tailleMarqueurAttendue = (4.8 / 140) * largeurReference;

  const resultats: Partial<QuatreCoins> = {};
  for (const [cle, estime] of Object.entries(coinsEstimes) as Array<[keyof QuatreCoins, Point]>) {
    const trouve = chercherMarqueurLocal(data, source.width, source.height, estime.x, estime.y, rayonFenetre, tailleMarqueurAttendue);
    if (!trouve) return null;
    resultats[cle] = trouve;
  }

  return resultats as QuatreCoins;
}

export interface DiagnosticCoin {
  nom: string;
  /** Position estimée (centre de la fenêtre de recherche), en pixels de la photo. */
  positionEstimee: Point;
  /** Nombre de pixels noirs réellement trouvés dans la fenêtre. */
  comptePixels: number;
  /** Seuils appliqués pour ce coin — pour comprendre en un coup d'œil
   * pourquoi comptePixels a été accepté ou rejeté, sans deviner. */
  seuilMin: number;
  seuilMax: number;
  /** Le centre du candidat est-il creux (majoritairement clair) — la
   * signature qui distingue un anneau imprimé d'un bloc de texte manuscrit.
   * `null` si compte hors seuils (jamais testé, la forme n'a pas
   * d'importance si la quantité de noir est déjà incohérente). */
  centreCreux: boolean | null;
  accepte: boolean;
}

export interface DiagnosticMarqueurs {
  coins: DiagnosticCoin[];
  /** Le cadre vert a-t-il été détecté sur cette photo (voir
   * detecterCadreVert) ? Détermine quelle stratégie a positionné les 4
   * fenêtres de recherche — savoir laquelle a été utilisée évite de deviner
   * si un échec vient d'une mauvaise couleur ou d'une mauvaise position. */
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
  const ctx = source.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { coins: [], cadreVertDetecte: false };
  let image: ImageData;
  try {
    image = ctx.getImageData(0, 0, source.width, source.height);
  } catch {
    return { coins: [], cadreVertDetecte: false };
  }
  const { data } = image;

  const coinsCadre = detecterCoinsCadreVert(source);
  const RETRAIT_FRACTION = 0.027;
  const margeX = source.width * RETRAIT_FRACTION;
  const margeY = source.height * RETRAIT_FRACTION;
  // Voir le commentaire détaillé dans detecterMarqueurs ci-dessus — même
  // logique : chaque coin détecté indépendamment, fenêtre resserrée (6% de
  // la largeur du cadre) quand la détection réussit, large uniquement en
  // repli.
  const largeurCadre = coinsCadre ? coinsCadre.hautDroit.x - coinsCadre.hautGauche.x : null;
  const rayonFenetre = largeurCadre ? largeurCadre * 0.06 : Math.max(source.width, source.height) * 0.2;
  const largeurReference = largeurCadre ?? source.width;
  const tailleMarqueurAttendue = (4.8 / 140) * largeurReference;
  const SEUIL_PIXELS_MIN = 6;
  const airesMarqueurAttendue = tailleMarqueurAttendue * tailleMarqueurAttendue;
  const SEUIL_PIXELS_MAX = Math.max(SEUIL_PIXELS_MIN * 4, airesMarqueurAttendue * 4);

  const coinsEstimes: Array<[string, Point]> = coinsCadre
    ? [
        ['Haut-gauche', coinsCadre.hautGauche],
        ['Haut-droit', coinsCadre.hautDroit],
        ['Bas-gauche', coinsCadre.basGauche],
        ['Bas-droit', coinsCadre.basDroit],
      ]
    : [
        ['Haut-gauche', { x: margeX, y: margeY }],
        ['Haut-droit', { x: source.width - margeX, y: margeY }],
        ['Bas-gauche', { x: margeX, y: source.height - margeY }],
        ['Bas-droit', { x: source.width - margeX, y: source.height - margeY }],
      ];

  const rayonInterieur = tailleMarqueurAttendue * 0.18;

  const coins = coinsEstimes.map(([nom, position]) => {
    const { compte, centre } = scannerFenetre(data, source.width, source.height, position.x, position.y, rayonFenetre);
    const compteDansSeuils = compte >= SEUIL_PIXELS_MIN && compte <= SEUIL_PIXELS_MAX;
    const centreCreux = compteDansSeuils && centre ? centreEstCreux(data, source.width, source.height, centre, rayonInterieur) : null;
    return {
      nom,
      positionEstimee: position,
      comptePixels: compte,
      seuilMin: SEUIL_PIXELS_MIN,
      seuilMax: Math.round(SEUIL_PIXELS_MAX),
      centreCreux,
      accepte: compteDansSeuils && centreCreux === true,
    };
  });

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
