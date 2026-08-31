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

import { detecterCadreVert, distanceCouleur } from './detectionCases';

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

// Magenta du marqueur imprimé — voir backend/app/services/pdf_passeport.py::
// _fond_page (MAGENTA_MARQUEUR, #E6007E). Remplace la détection par pure
// noirceur (essayée en premier, avec un carré noir plein) : un marqueur
// NOIR est difficile à distinguer de façon fiable au milieu de l'écriture
// manuscrite et du texte imprimé qui l'entourent, eux aussi noirs —
// confirmé par plusieurs échecs de détection en test réel malgré
// l'agrandissement du marqueur. Le magenta n'apparaît nulle part ailleurs
// sur le document (texte, cadre vert, encre manuscrite) : une détection
// par couleur précise devient possible, la même approche déjà utilisée
// avec succès pour repérer le cadre vert.
const COULEUR_MARQUEUR: RGB = { r: 0xe6, g: 0x00, b: 0x7e };
// Calibrée sur des données réelles, pas devinée : un test en conditions
// réelles (voir diagnostic écart de couleur) a montré le vrai marqueur
// imprimé à un écart de 108-118 du magenta idéal (décalage normal de
// l'appareil photo/l'éclairage), contre 159-161 pour de l'arrière-plan
// hors sujet — 130 accepte le premier groupe sans risquer le second.
const TOLERANCE_MARQUEUR = 130;

function estMarqueur(r: number, g: number, b: number): boolean {
  return distanceCouleur({ r, g, b }, COULEUR_MARQUEUR) <= TOLERANCE_MARQUEUR;
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
      if (estMarqueur(data[i], data[i + 1], data[i + 2])) {
        sommeX += x;
        sommeY += y;
        compte += 1;
      }
    }
  }

  return { centre: compte > 0 ? { x: sommeX / compte, y: sommeY / compte } : null, compte };
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
  if (compte < SEUIL_PIXELS_MIN || compte > SEUIL_PIXELS_MAX) return null;
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

  // Point de départ pour la recherche de chaque marqueur — DEUX stratégies
  // combinées, la première ayant échoué en test réel de façon révélatrice :
  //
  // 1. Coins de la photo elle-même (marge fixe ~2,7%) : reposait sur
  //    l'hypothèse que la photo confirmée par l'agent (voir
  //    AjusterCadrage.tsx) a déjà le cadre vert tout près de ses propres
  //    bords. Test réel : marge asymétrique confirmée — les 2 marqueurs du
  //    bas tombaient juste, les 2 du haut à l'intérieur du cadre, largement
  //    hors de la fenêtre de recherche. Le cadrage humain n'est donc pas
  //    fiable au point de s'y fier seul.
  // 2. Estimation par couleur du cadre vert (detecterCadreVert, déjà rendue
  //    robuste aux pixels aberrants via percentiles) : directement ancrée
  //    sur ce qui est réellement visible sur CETTE photo, indépendamment de
  //    la qualité du cadrage — reprise en priorité ; les coins de la photo
  //    ne servent plus que de repli si le cadre vert n'a pas pu être
  //    détecté du tout (photo très sombre, cadre partiellement hors champ).
  const cadreCouleur = detecterCadreVert(source);
  const RETRAIT_FRACTION = 0.027;
  const margeX = source.width * RETRAIT_FRACTION;
  const margeY = source.height * RETRAIT_FRACTION;

  const coinsEstimes = cadreCouleur
    ? {
        hautGauche: { x: cadreCouleur.x, y: cadreCouleur.y },
        hautDroit: { x: cadreCouleur.x + cadreCouleur.largeur, y: cadreCouleur.y },
        basGauche: { x: cadreCouleur.x, y: cadreCouleur.y + cadreCouleur.hauteur },
        basDroit: { x: cadreCouleur.x + cadreCouleur.largeur, y: cadreCouleur.y + cadreCouleur.hauteur },
      }
    : {
        hautGauche: { x: margeX, y: margeY },
        hautDroit: { x: source.width - margeX, y: margeY },
        basGauche: { x: margeX, y: source.height - margeY },
        basDroit: { x: source.width - margeX, y: source.height - margeY },
      };

  // Fenêtre volontairement généreuse (20% de la plus grande dimension de la
  // photo) : absorbe l'imprécision résiduelle de l'estimation, quelle que
  // soit la stratégie utilisée pour la calculer, sans risquer d'accrocher
  // un grand aplat sombre (le marqueur reste un carré compact, facilement
  // discriminé par sa taille même dans une fenêtre de recherche plus
  // grande — voir le plafond dans chercherMarqueurLocal ci-dessus).
  const rayonFenetre = Math.max(source.width, source.height) * 0.2;

  // Taille attendue d'un marqueur en pixels sur CETTE photo : le cadre vert
  // correspond à environ 140mm de large sur le papier (148mm - la marge de
  // 4mm de chaque côté), le marqueur (cercle magenta) fait 4,8mm de
  // diamètre (voir pdf_passeport.py::_fond_page, RAYON_MARQUEUR = 2,4mm) —
  // la règle de trois donne sa taille en pixels à partir de la largeur de
  // la photo.
  const largeurReference = cadreCouleur?.largeur ?? source.width;
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
  /** Nombre de pixels magenta réellement trouvés dans la fenêtre. */
  comptePixels: number;
  /** Seuils appliqués pour ce coin — pour comprendre en un coup d'œil
   * pourquoi comptePixels a été accepté ou rejeté, sans deviner. */
  seuilMin: number;
  seuilMax: number;
  accepte: boolean;
  /** Couleur RÉELLE du pixel exactement au centre de la fenêtre de
   * recherche (là où le marqueur est censé se trouver) — permet de voir
   * directement ce que la photo contient à cet endroit précis (couleur du
   * papier ? de l'encre magenta décalée par l'impression/l'éclairage ?
   * autre chose ?), plutôt que de deviner un nouveau réglage de tolérance
   * sans donnée concrète. Format "#rrggbb". */
  couleurTrouvee: string;
  /** Distance (espace RGB) entre couleurTrouvee et le magenta attendu —
   * plus c'est petit, plus proche du marqueur réel. Comparez à
   * TOLERANCE_MARQUEUR (130 actuellement) pour voir précisément de combien
   * ajuster la tolérance plutôt que deviner. */
  distanceCouleur: number;
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

  const cadreCouleur = detecterCadreVert(source);
  const RETRAIT_FRACTION = 0.027;
  const margeX = source.width * RETRAIT_FRACTION;
  const margeY = source.height * RETRAIT_FRACTION;
  const rayonFenetre = Math.max(source.width, source.height) * 0.2;
  const largeurReference = cadreCouleur?.largeur ?? source.width;
  const tailleMarqueurAttendue = (4.8 / 140) * largeurReference;
  const SEUIL_PIXELS_MIN = 6;
  const airesMarqueurAttendue = tailleMarqueurAttendue * tailleMarqueurAttendue;
  const SEUIL_PIXELS_MAX = Math.max(SEUIL_PIXELS_MIN * 4, airesMarqueurAttendue * 4);

  const coinsEstimes: Array<[string, Point]> = cadreCouleur
    ? [
        ['Haut-gauche', { x: cadreCouleur.x, y: cadreCouleur.y }],
        ['Haut-droit', { x: cadreCouleur.x + cadreCouleur.largeur, y: cadreCouleur.y }],
        ['Bas-gauche', { x: cadreCouleur.x, y: cadreCouleur.y + cadreCouleur.hauteur }],
        ['Bas-droit', { x: cadreCouleur.x + cadreCouleur.largeur, y: cadreCouleur.y + cadreCouleur.hauteur }],
      ]
    : [
        ['Haut-gauche', { x: margeX, y: margeY }],
        ['Haut-droit', { x: source.width - margeX, y: margeY }],
        ['Bas-gauche', { x: margeX, y: source.height - margeY }],
        ['Bas-droit', { x: source.width - margeX, y: source.height - margeY }],
      ];

  const meilleurCandidat = (centreX: number, centreY: number): { couleur: string; distance: number } => {
    const xDebut = Math.max(0, Math.round(centreX - rayonFenetre));
    const xFin = Math.min(source.width, Math.round(centreX + rayonFenetre));
    const yDebut = Math.max(0, Math.round(centreY - rayonFenetre));
    const yFin = Math.min(source.height, Math.round(centreY + rayonFenetre));
    let meilleureDistance = Infinity;
    let meilleurR = 0;
    let meilleurG = 0;
    let meilleurB = 0;
    // Un pixel sur 3 : suffisant pour trouver le meilleur candidat sans
    // scanner exhaustivement une fenêtre qui peut faire plusieurs centaines
    // de milliers de pixels — ce diagnostic n'est jamais sur le chemin
    // critique de la capture, mais reste appelé à chaque page scannée.
    for (let y = yDebut; y < yFin; y += 3) {
      for (let x = xDebut; x < xFin; x += 3) {
        const i = (y * source.width + x) * 4;
        const d = distanceCouleur({ r: data[i], g: data[i + 1], b: data[i + 2] }, COULEUR_MARQUEUR);
        if (d < meilleureDistance) {
          meilleureDistance = d;
          meilleurR = data[i];
          meilleurG = data[i + 1];
          meilleurB = data[i + 2];
        }
      }
    }
    const versHex = (v: number) => v.toString(16).padStart(2, '0');
    return { couleur: `#${versHex(meilleurR)}${versHex(meilleurG)}${versHex(meilleurB)}`, distance: Math.round(meilleureDistance) };
  };

  const coins = coinsEstimes.map(([nom, position]) => {
    const { compte } = scannerFenetre(data, source.width, source.height, position.x, position.y, rayonFenetre);
    const candidat = meilleurCandidat(position.x, position.y);
    return {
      nom,
      positionEstimee: position,
      comptePixels: compte,
      seuilMin: SEUIL_PIXELS_MIN,
      seuilMax: Math.round(SEUIL_PIXELS_MAX),
      accepte: compte >= SEUIL_PIXELS_MIN && compte <= SEUIL_PIXELS_MAX,
      couleurTrouvee: candidat.couleur,
      distanceCouleur: candidat.distance,
    };
  });

  return { coins, cadreVertDetecte: cadreCouleur !== null };
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
