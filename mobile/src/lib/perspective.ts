/**
 * Détection du document et correction de perspective (OpenCV.js), AVANT la
 * lecture par Tesseract (voir ./ocr.ts).
 *
 * Bibliothèque hébergée LOCALEMENT (public/opencv/opencv.js) — même principe
 * que Tesseract (public/ocr/, voir ocr.ts) : jamais de dépendance à un CDN,
 * indispensable pour un fonctionnement hors-ligne garanti. Ce fichier doit
 * être placé manuellement dans le projet (build officiel opencv.js, non
 * fourni ici) — voir la note de déploiement qui accompagne ce module.
 *
 * REPLI SILENCIEUX SYSTÉMATIQUE : toute détection de document est un
 * problème de vision par ordinateur intrinsèquement faillible (contraste
 * insuffisant entre le papier et le fond, main ou table dans le cadre,
 * papier froissé...). Un échec ici ne doit JAMAIS bloquer l'agent : on
 * retombe alors sur la photo brute, que le pipeline existant (ancrage sur
 * les libellés imprimés, voir ocr.ts) sait déjà lire raisonnablement même
 * légèrement inclinée. Aucune exception ne remonte jamais hors de
 * `redresserDocument` — uniquement `null` en cas d'échec, quelle qu'en soit
 * la cause.
 */
import { creerBitmap } from './imagerie';

declare global {
  interface Window {
    cv?: OpenCvNamespace;
  }
}

/** Sous-ensemble minimal de l'API OpenCV.js réellement utilisé ici — la
 * bibliothèque complète n'a pas de types officiels utilisables tels quels. */
interface OpenCvMat {
  delete(): void;
  rows: number;
  data32S: Int32Array;
}
interface OpenCvMatVector {
  size(): number;
  get(i: number): OpenCvMat;
}
interface OpenCvNamespace {
  Mat: { new (): OpenCvMat; ones(r: number, c: number, type: number): OpenCvMat };
  MatVector: { new (): OpenCvMatVector };
  Size: new (w: number, h: number) => unknown;
  CV_8U: number;
  CV_32FC2: number;
  COLOR_RGBA2GRAY: number;
  RETR_LIST: number;
  CHAIN_APPROX_SIMPLE: number;
  imread(canvas: HTMLCanvasElement): OpenCvMat;
  imshow(canvas: HTMLCanvasElement, mat: OpenCvMat): void;
  cvtColor(src: OpenCvMat, dst: OpenCvMat, code: number): void;
  GaussianBlur(src: OpenCvMat, dst: OpenCvMat, size: unknown, sigma: number): void;
  Canny(src: OpenCvMat, dst: OpenCvMat, seuilBas: number, seuilHaut: number): void;
  dilate(src: OpenCvMat, dst: OpenCvMat, noyau: OpenCvMat): void;
  findContours(
    src: OpenCvMat,
    contours: OpenCvMatVector,
    hierarchie: OpenCvMat,
    mode: number,
    methode: number,
  ): void;
  arcLength(contour: OpenCvMat, ferme: boolean): number;
  approxPolyDP(contour: OpenCvMat, approx: OpenCvMat, epsilon: number, ferme: boolean): void;
  contourArea(contour: OpenCvMat): number;
  matFromArray(rows: number, cols: number, type: number, donnees: number[]): OpenCvMat;
  getPerspectiveTransform(src: OpenCvMat, dst: OpenCvMat): OpenCvMat;
  warpPerspective(src: OpenCvMat, dst: OpenCvMat, matrice: OpenCvMat, taille: unknown): void;
  onRuntimeInitialized?: () => void;
}

const DELAI_CHARGEMENT_MS = 30_000;

async function borner<T>(promesse: Promise<T>, delaiMs: number): Promise<T> {
  let minuteur: number | undefined;
  try {
    return await Promise.race([
      promesse,
      new Promise<never>((_, rejeter) => {
        minuteur = window.setTimeout(() => rejeter(new Error('délai dépassé')), delaiMs);
      }),
    ]);
  } finally {
    window.clearTimeout(minuteur);
  }
}

let promesseChargement: Promise<OpenCvNamespace> | null = null;

/** Charge opencv.js une seule fois par session ; les appels suivants
 * réutilisent la même promesse (déjà résolue après le premier succès). */
function chargerOpenCv(): Promise<OpenCvNamespace> {
  if (!promesseChargement) {
    promesseChargement = borner(
      new Promise<OpenCvNamespace>((resoudre, rejeter) => {
        if (window.cv?.Mat) {
          resoudre(window.cv);
          return;
        }
        const script = document.createElement('script');
        script.src = '/opencv/opencv.js';
        script.async = true;
        script.onload = () => {
          const cv = window.cv;
          if (!cv) {
            rejeter(new Error('OpenCV.js absent après chargement du script.'));
            return;
          }
          if (cv.Mat) {
            resoudre(cv);
            return;
          }
          // Le WASM finit de s'initialiser après l'exécution du script — ce
          // callback est le point d'entrée officiel d'opencv.js pour ça.
          cv.onRuntimeInitialized = () => resoudre(cv);
        };
        script.onerror = () => rejeter(new Error('/opencv/opencv.js introuvable.'));
        document.head.appendChild(script);
      }),
      DELAI_CHARGEMENT_MS,
    ).catch((erreur) => {
      // Remise à zéro : un premier échec (fichier absent, WASM refusé par le
      // navigateur) ne doit pas condamner la fonctionnalité pour le reste de
      // la session — un futur appel réessaiera de zéro.
      promesseChargement = null;
      throw erreur;
    });
  }
  return promesseChargement;
}

/** Précharge la bibliothèque en arrière-plan (voir prechaufferOcr, même
 * principe) — évite d'ajouter la latence de chargement APRÈS la photo. */
export async function prechaufferPerspective(): Promise<boolean> {
  try {
    await chargerOpenCv();
    return true;
  } catch {
    return false;
  }
}

type Point = [number, number];

function distance(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Ordonne 4 points en [haut-gauche, haut-droit, bas-droit, bas-gauche],
 * quel que soit l'ordre dans lequel OpenCV les a renvoyés. */
function ordonnerCoins(plats: number[]): [Point, Point, Point, Point] {
  const points: Point[] = [
    [plats[0], plats[1]],
    [plats[2], plats[3]],
    [plats[4], plats[5]],
    [plats[6], plats[7]],
  ];
  const sommes = points.map(([x, y]) => x + y);
  const differences = points.map(([x, y]) => x - y);
  const hautGauche = points[sommes.indexOf(Math.min(...sommes))];
  const basDroit = points[sommes.indexOf(Math.max(...sommes))];
  const hautDroit = points[differences.indexOf(Math.max(...differences))];
  const basGauche = points[differences.indexOf(Math.min(...differences))];
  return [hautGauche, hautDroit, basDroit, basGauche];
}

/**
 * Détecte le plus grand quadrilatère plausible sur la photo et corrige la
 * perspective pour obtenir une image plate, cadrée sur le document.
 *
 * Retourne `null` en cas d'échec (jamais une exception) — voir la docstring
 * du module : l'appelant doit alors utiliser la photo d'origine telle
 * quelle, sans bloquer l'agent.
 */
export async function redresserDocument(source: Blob): Promise<HTMLCanvasElement | null> {
  let cv: OpenCvNamespace;
  try {
    cv = await chargerOpenCv();
  } catch {
    return null;
  }

  let bitmap: ImageBitmap | HTMLImageElement;
  try {
    bitmap = await creerBitmap(source);
  } catch {
    return null;
  }

  const canvasSource = document.createElement('canvas');
  canvasSource.width = bitmap.width;
  canvasSource.height = bitmap.height;
  const ctxSource = canvasSource.getContext('2d');
  if (!ctxSource) return null;
  ctxSource.drawImage(bitmap as CanvasImageSource, 0, 0);
  if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close();

  // Détection sur une copie RÉDUITE de la photo — indispensable : Canny et
  // findContours sur une photo de téléphone en pleine résolution (souvent
  // plusieurs dizaines de millions de pixels) peuvent bloquer le fil
  // d'exécution assez longtemps pour qu'aucun minuteur JS ne parvienne à
  // s'exécuter pendant ce temps (JavaScript est mono-thread ; un calcul
  // WASM synchrone empêche même `borner()` de reprendre la main) — c'est ce
  // qui produisait un blocage total de l'écran de capture, bien au-delà du
  // délai de sécurité prévu. Les coins trouvés sur la copie réduite sont
  // ensuite remis à l'échelle réelle : la qualité du redressement final
  // (utilisé pour l'OCR) n'est jamais dégradée par cette optimisation.
  const LARGEUR_DETECTION = 900;
  const echelleDetection = Math.min(1, LARGEUR_DETECTION / canvasSource.width);
  const canvasDetection = document.createElement('canvas');
  canvasDetection.width = Math.round(canvasSource.width * echelleDetection);
  canvasDetection.height = Math.round(canvasSource.height * echelleDetection);
  const ctxDetection = canvasDetection.getContext('2d');
  if (!ctxDetection) return null;
  ctxDetection.drawImage(canvasSource, 0, 0, canvasDetection.width, canvasDetection.height);

  // Toutes les Mat OpenCV doivent être explicitement libérées (WASM, pas de
  // ramasse-miettes) — indispensable sur un téléphone d'entrée de gamme aux
  // ressources limitées, priorité déjà affirmée ailleurs dans ce projet
  // (voir ocr.ts). Le bloc try/finally garantit ce nettoyage même en cas
  // d'erreur ou de retour anticipé.
  let src: OpenCvMat | undefined;
  let srcPleineResolution: OpenCvMat | undefined;
  let gris: OpenCvMat | undefined;
  let flou: OpenCvMat | undefined;
  let bords: OpenCvMat | undefined;
  let contours: OpenCvMatVector | undefined;
  let hierarchie: OpenCvMat | undefined;

  try {
    src = cv.imread(canvasDetection);
    gris = new cv.Mat();
    cv.cvtColor(src, gris, cv.COLOR_RGBA2GRAY);
    flou = new cv.Mat();
    cv.GaussianBlur(gris, flou, new cv.Size(5, 5), 0);
    bords = new cv.Mat();
    cv.Canny(flou, bords, 50, 150);
    // Dilatation légère : referme les petites coupures dans le contour du
    // bord de page (ombre, pli, reflet) qui empêcheraient findContours de
    // le voir comme UN SEUL contour fermé.
    const noyau = cv.Mat.ones(3, 3, cv.CV_8U);
    cv.dilate(bords, bords, noyau);
    noyau.delete();

    contours = new cv.MatVector();
    hierarchie = new cv.Mat();
    cv.findContours(bords, contours, hierarchie, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    const aireImage = canvasDetection.width * canvasDetection.height;
    let meilleurQuad: number[] | null = null;
    let meilleureAire = 0;

    for (let i = 0; i < contours.size(); i += 1) {
      const contour = contours.get(i);
      const perimetre = cv.arcLength(contour, true);
      const approx = new cv.Mat();
      cv.approxPolyDP(contour, approx, 0.02 * perimetre, true);
      if (approx.rows === 4) {
        const aire = Math.abs(cv.contourArea(approx));
        // Le document doit couvrir une part significative du cadre (sinon
        // c'est un contour parasite, ex. l'ombre d'un doigt), mais jamais
        // la quasi-totalité (sinon c'est le bord de la PHOTO elle-même qui
        // a été détecté, pas un contour réel).
        if (aire > aireImage * 0.2 && aire < aireImage * 0.98 && aire > meilleureAire) {
          meilleureAire = aire;
          meilleurQuad = Array.from(approx.data32S.slice(0, 8));
        }
      }
      approx.delete();
      contour.delete();
    }

    if (!meilleurQuad) return null;

    // Remise à l'échelle réelle : les coins ont été trouvés sur la copie
    // réduite (facteur `echelleDetection`), le redressement final doit
    // s'appliquer sur la photo d'origine pour préserver sa qualité.
    const quadEchelleReelle = meilleurQuad.map((v) => v / echelleDetection);

    const coins = ordonnerCoins(quadEchelleReelle);
    const largeurCible = Math.round(Math.max(distance(coins[0], coins[1]), distance(coins[3], coins[2])));
    const hauteurCible = Math.round(Math.max(distance(coins[0], coins[3]), distance(coins[1], coins[2])));
    // En dessous de cette taille, le redressement n'apporterait rien à la
    // lecture OCR (photo déjà trop éloignée) — mieux vaut alors le repli
    // silencieux que de produire une image redressée mais inexploitable.
    if (largeurCible < 200 || hauteurCible < 200) return null;

    const src32 = cv.matFromArray(4, 1, cv.CV_32FC2, coins.flat());
    const dst32 = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0,
      largeurCible - 1, 0,
      largeurCible - 1, hauteurCible - 1,
      0, hauteurCible - 1,
    ]);
    const matriceTransfo = cv.getPerspectiveTransform(src32, dst32);
    const redresse = new cv.Mat();
    // Redressement sur l'image PLEINE RÉSOLUTION (canvasSource), jamais sur
    // la copie réduite utilisée pour la détection — c'est cette étape qui
    // conditionne la qualité de lecture OCR ensuite.
    srcPleineResolution = cv.imread(canvasSource);
    cv.warpPerspective(srcPleineResolution, redresse, matriceTransfo, new cv.Size(largeurCible, hauteurCible));

    const canvasSortie = document.createElement('canvas');
    canvasSortie.width = largeurCible;
    canvasSortie.height = hauteurCible;
    cv.imshow(canvasSortie, redresse);

    src32.delete();
    dst32.delete();
    matriceTransfo.delete();
    redresse.delete();

    return canvasSortie;
  } catch {
    // Toute erreur OpenCV (image corrompue, mémoire insuffisante...) suit le
    // même principe : repli silencieux, jamais une exception qui remonte.
    return null;
  } finally {
    src?.delete();
    srcPleineResolution?.delete();
    gris?.delete();
    flou?.delete();
    bords?.delete();
    hierarchie?.delete();
  }
}
