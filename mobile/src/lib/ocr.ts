/**
 * Reconnaissance hors connexion des pages 3 et 4 du Passeport pour Bétail.
 *
 * Pourquoi une heuristique et pas un modèle d'écriture manuscrite : lire une
 * écriture cursive libre dans un navigateur, sans réseau, n'est pas fiable.
 * En revanche, le gabarit du PPB porte des libellés IMPRIMÉS fixes et connus
 * d'avance (« Nom et prénom », « N° CNI », « Bovins », ...) que l'OCR
 * reconnaît très bien. On repère donc chaque libellé imprimé, puis on lit la
 * valeur manuscrite située juste EN DESSOUS (ou à droite pour un tableau).
 * Cet ancrage relatif à du texte connu résiste bien mieux à une photo prise à
 * main levée qu'une position absolue en pixels.
 *
 * Trois enseignements du terrain sont intégrés ici, après un retour « l'OCR ne
 * fait rien » :
 *
 * 1. ANCRAGE TOLÉRANT. Exiger la séquence exacte « nom et prenom » condamnait
 *    TOUS les champs dès qu'une seule lettre était mal lue (« Nom ef prénom »),
 *    et « N° CNI » échouait presque toujours, le « ° » étant lu « e », « o »
 *    ou « % ». On ancre désormais sur un mot-clé distinctif unique, comparé de
 *    façon approximative (distance d'édition) — un caractère manqué ne fait
 *    plus perdre le champ.
 *
 * 2. AUCUN BLOCAGE SILENCIEUX. Si un fichier du moteur (WASM, données de
 *    langue) manque sur le déploiement, `createWorker` peut ne jamais rendre la
 *    main : l'écran restait indéfiniment sur « Lecture de la page… », ce que
 *    l'agent interprète, à raison, comme « ça ne fait rien ». Chaque étape est
 *    donc bornée dans le temps et échoue avec une cause nommée.
 *
 * 3. DIAGNOSTIC LISIBLE. Le nombre de mots reconnus et le texte brut sont
 *    remontés à l'interface : c'est la seule façon, sans console de navigateur,
 *    de distinguer « photo illisible » de « photo lue mais gabarit non
 *    reconnu ».
 *
 * Limite assumée : la reconnaissance reste une AIDE au pré-remplissage. Chaque
 * champ est renvoyé avec un indice de confiance et l'agent corrige librement.
 * Aucune valeur n'est jamais imposée, et un échec total de l'OCR laisse le
 * formulaire entièrement utilisable à la main.
 */
import { createWorker, PSM, type Worker } from 'tesseract.js';
import { creerBitmap } from './imagerie';
import { redresserDocument } from './perspective';
import { detecterChamps, champLePlusProche, detecterCadreVert, type ChampDetecte, type CadreDetecte } from './detectionCases';
import { detecterMarqueurs, calculerHomographie, appliquerHomographie, type Point } from './homographie';
import { GABARIT_PAGE3, GABARIT_PAGE4, type ZonePct } from './gabarit';

/**
 * Correction de perspective (OpenCV.js, voir ./perspective.ts) désactivée
 * pour l'instant — DEUX blocages complets de l'écran de capture confirmés
 * en conditions réelles sur téléphone de terrain, malgré la réduction de la
 * photo avant détection (qui ne résout que le temps de CALCUL). Le vrai
 * problème est le CHARGEMENT/l'initialisation d'opencv.js lui-même : sur un
 * appareil d'entrée de gamme, cette étape peut à elle seule bloquer le fil
 * d'exécution du navigateur assez longtemps pour rendre inopérant tout
 * minuteur de sécurité (JavaScript est mono-thread : un blocage empêche
 * même l'annulation programmée de s'exécuter).
 *
 * Le code de détection (perspective.ts, imagerie.ts) reste en place, prêt à
 * être réactivé — la vraie solution est de déplacer ce calcul dans un Web
 * Worker (fil séparé, où un blocage n'affecte jamais l'écran), pas encore
 * fait. Tant que ce n'est pas le cas, mieux vaut revenir au comportement
 * précédent, connu pour fonctionner, que de risquer de bloquer un agent sur
 * le terrain.
 */
const DETECTION_PERSPECTIVE_ACTIVE = false;
import type {
  DonneesPage3,
  DonneesPage4,
  EffectifEspece,
  EspeceTroupeau,
  MaladieControlee,
} from './db';
import { ESPECES_PASSEPORT, MALADIES_CONTROLEES, PAYS_CEMAC, page3Vide, page4Vide, type PaysReference } from './db';

/* ------------------------------------------------------------------ */
/* Erreurs et délais                                                   */
/* ------------------------------------------------------------------ */

/** Échec nommé du moteur — le message est destiné à être affiché tel quel. */
export class ErreurOcr extends Error {}

/** Chargement du moteur (WASM + données de langue) : généreux, mais borné. */
const DELAI_CHARGEMENT_MS = 60_000;
/** Reconnaissance d'une page déjà chargée en mémoire. */
const DELAI_RECONNAISSANCE_MS = 90_000;

/**
 * Borne une promesse dans le temps.
 *
 * Indispensable ici : une promesse qui ne se résout jamais (asset absent,
 * worker tué par le navigateur faute de mémoire) laisse l'interface figée sur
 * un indicateur de progression, sans aucun message. Mieux vaut échouer en
 * nommant la cause que faire attendre indéfiniment un agent sur le terrain.
 */
async function borner<T>(promesse: Promise<T>, delaiMs: number, message: string): Promise<T> {
  let minuteur: number | undefined;
  try {
    return await Promise.race([
      promesse,
      new Promise<never>((_, rejeter) => {
        minuteur = window.setTimeout(() => rejeter(new ErreurOcr(message)), delaiMs);
      }),
    ]);
  } finally {
    window.clearTimeout(minuteur);
  }
}

/* ------------------------------------------------------------------ */
/* Confiance                                                           */
/* ------------------------------------------------------------------ */

export type NiveauConfiance = 'haute' | 'moyenne' | 'basse' | 'aucune';

/** Confiance par chemin de champ, ex. `eleveur.nom_prenom`, `especes.bovin`. */
export type CarteConfiance = Record<string, NiveauConfiance>;

function niveauDepuisScore(score: number): NiveauConfiance {
  if (score >= 80) return 'haute';
  if (score >= 55) return 'moyenne';
  return 'basse';
}

/* ------------------------------------------------------------------ */
/* Prétraitement de l'image                                            */
/* ------------------------------------------------------------------ */

const LARGEUR_CIBLE = 1800;

/**
 * Niveaux de gris, puis binarisation par seuil LOCAL. Une photo de terrain est
 * rarement uniformément éclairée (ombre du corps de l'agent, plein soleil sur
 * une moitié de page) : un seuil global effacerait la moitié de l'écriture,
 * d'où le seuil calculé par tuile.
 *
 * Une tuile de contraste quasi nul (marge blanche, aplat d'encre) est laissée
 * BLANCHE au lieu d'être binarisée : sans cette garde, le grain du papier
 * devenait un semis de faux caractères qui noyait les vrais libellés et
 * ruinait leur reconnaissance.
 *
 * `source` accepte aussi un `HTMLCanvasElement` (sortie de
 * `redresserDocument`, voir ./perspective.ts) : évite un aller-retour
 * inutile par un ré-encodage Blob quand la photo a déjà été redressée.
 */
export async function pretraiterImage(source: Blob | HTMLCanvasElement): Promise<HTMLCanvasElement> {
  let bitmap: ImageBitmap | HTMLImageElement | HTMLCanvasElement;
  if (source instanceof HTMLCanvasElement) {
    bitmap = source;
  } else {
    try {
      bitmap = await creerBitmap(source);
    } catch {
      throw new ErreurOcr('Photo illisible : reprenez la photo.');
    }
  }
  const largeurSource = 'width' in bitmap ? bitmap.width : LARGEUR_CIBLE;
  const hauteurSource = 'height' in bitmap ? bitmap.height : LARGEUR_CIBLE;

  // On agrandit une photo trop petite, et on réduit une photo de 12 Mpx : au
  // delà de ~1800 px de large le gain de précision est nul et le temps de
  // traitement double sur un téléphone d'entrée de gamme. Plafond
  // d'agrandissement plus généreux pour une source déjà petite au départ
  // (typiquement une case individuelle, voir lireCaseParCase, ~60-110px
  // avant mise à l'échelle) : un agrandissement x2 seulement laissait
  // Tesseract travailler sur une image encore minuscule, sans commune
  // mesure avec la résolution habituelle d'une page entière.
  const echelle = LARGEUR_CIBLE / Math.max(largeurSource, 1);
  const capAgrandissement = largeurSource < 200 ? 6 : 2;
  const facteur = Math.min(capAgrandissement, Math.max(0.4, echelle));
  const largeur = Math.max(1, Math.round(largeurSource * facteur));
  const hauteur = Math.max(1, Math.round(hauteurSource * facteur));

  const canvas = document.createElement('canvas');
  canvas.width = largeur;
  canvas.height = hauteur;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ErreurOcr('Traitement d’image indisponible sur cet appareil.');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, largeur, hauteur);
  if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close();

  const image = ctx.getImageData(0, 0, largeur, hauteur);
  const pixels = image.data;

  const gris = new Uint8ClampedArray(largeur * hauteur);
  for (let i = 0, j = 0; i < pixels.length; i += 4, j += 1) {
    gris[j] = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
  }

  const TUILE_BASE = 40;
  const MARGE = 10; // évite de transformer le grain du papier en fausses lettres
  const CONTRASTE_MIN = 14; // écart-type en dessous duquel la tuile est « vide »

  // Sur une image bien plus petite que la tuile de base — typiquement une
  // case individuelle recadrée (voir lireCaseParCase, ~60-110px de large
  // AVANT mise à l'échelle) — découper en grille de tuiles de 40px produit
  // une tuile unique mal formée ou deux tuiles très déséquilibrées, dont
  // les statistiques (moyenne, écart-type) ne représentent plus
  // correctement le contenu réel. Confirmé en test réel : les cases
  // individuelles ressortaient toutes déformées par un même artefact en
  // équerre à la frontière de tuile, quel que soit le caractère
  // réellement écrit. Sur une image aussi petite, une seule tuile
  // couvrant l'image entière (seuil global, pas de découpage) donne un
  // résultat bien plus fidèle.
  //
  // Décision basée sur la taille D'ORIGINE (largeurSource/hauteurSource),
  // PAS sur la taille après mise à l'échelle (largeur/hauteur) : cette
  // dernière dépend de capAgrandissement ci-dessus (jusqu'à ×6 pour une
  // petite source), qui peut à lui seul dépasser un seuil basé sur la
  // taille finale — un premier réglage de ce correctif s'est heurté
  // exactement à ce piège (seuil sur la taille finale, rendu inefficace
  // par l'agrandissement plus généreux ajouté juste après).
  const estPetiteSource = largeurSource < 200 || hauteurSource < 200;
  const TUILE = estPetiteSource ? Math.max(largeur, hauteur) : TUILE_BASE;

  for (let ty = 0; ty < hauteur; ty += TUILE) {
    for (let tx = 0; tx < largeur; tx += TUILE) {
      const finX = Math.min(tx + TUILE, largeur);
      const finY = Math.min(ty + TUILE, hauteur);

      let somme = 0;
      let sommeCarres = 0;
      let nombre = 0;
      for (let y = ty; y < finY; y += 1) {
        for (let x = tx; x < finX; x += 1) {
          const valeur = gris[y * largeur + x];
          somme += valeur;
          sommeCarres += valeur * valeur;
          nombre += 1;
        }
      }
      const moyenne = nombre > 0 ? somme / nombre : 255;
      const variance = nombre > 0 ? Math.max(0, sommeCarres / nombre - moyenne * moyenne) : 0;
      const ecartType = Math.sqrt(variance);
      const tuileUniforme = ecartType < CONTRASTE_MIN;
      const seuil = moyenne - MARGE;

      for (let y = ty; y < finY; y += 1) {
        for (let x = tx; x < finX; x += 1) {
          const indice = y * largeur + x;
          // Une tuile uniforme sombre est de l'encre pleine (photo, aplat) :
          // la rendre blanche est préférable à un bruit noir illisible.
          const valeur = tuileUniforme ? 255 : gris[indice] < seuil ? 0 : 255;
          const p = indice * 4;
          pixels[p] = valeur;
          pixels[p + 1] = valeur;
          pixels[p + 2] = valeur;
          pixels[p + 3] = 255;
        }
      }
    }
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

/* ------------------------------------------------------------------ */
/* Moteur Tesseract (assets locaux — aucun appel réseau)               */
/* ------------------------------------------------------------------ */

interface MotReconnu {
  texte: string;
  confiance: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

let promesseWorker: Promise<Worker> | null = null;

async function creerWorker(): Promise<Worker> {
  const worker = await createWorker('fra', 1, {
    workerPath: '/ocr/worker.min.js',
    corePath: '/ocr/',
    langPath: '/ocr/lang',
    gzip: true,
  });
  await worker.setParameters({ preserve_interword_spaces: '1' });
  return worker;
}

async function obtenirWorker(): Promise<Worker> {
  if (!promesseWorker) {
    promesseWorker = borner(
      creerWorker(),
      DELAI_CHARGEMENT_MS,
      'Le moteur de lecture n’a pas fini de se charger. Rechargez la dernière version depuis les réglages, avec du réseau, puis réessayez.',
    ).catch((erreur) => {
      // Sans cette remise à zéro, un premier échec (mémoire insuffisante,
      // asset absent) condamnerait l'OCR pour toute la session.
      promesseWorker = null;
      throw erreur instanceof ErreurOcr
        ? erreur
        : new ErreurOcr(
            `Moteur de lecture indisponible : ${erreur instanceof Error ? erreur.message : 'cause inconnue'}.`,
          );
    });
  }
  return promesseWorker;
}

/** Préchauffage optionnel — évite d'attendre le chargement du WASM après la photo. */
export async function prechaufferOcr(): Promise<boolean> {
  try {
    await obtenirWorker();
    return true;
  } catch {
    return false;
  }
}

interface MotBrut {
  text?: string;
  confidence?: number;
  bbox?: { x0: number; y0: number; x1: number; y1: number };
}

interface LectureBrute {
  mots: MotReconnu[];
  texte: string;
}

async function reconnaitre(canvas: HTMLCanvasElement): Promise<LectureBrute> {
  const worker = await obtenirWorker();
  const resultat = await borner(
    worker.recognize(canvas, {}, { blocks: true, text: true }),
    DELAI_RECONNAISSANCE_MS,
    'La lecture de la photo a dépassé le temps imparti. Reprenez une photo plus nette et mieux cadrée.',
  );

  const donnees = resultat.data as unknown as {
    text?: string;
    words?: MotBrut[];
    blocks?: Array<{ paragraphs?: Array<{ lines?: Array<{ words?: MotBrut[] }> }> }>;
  };

  // `data.words` n'est pas garanti selon la version et les options : repli sur
  // l'arborescence blocs → paragraphes → lignes → mots.
  let bruts: MotBrut[] = donnees.words ?? [];
  if (bruts.length === 0 && donnees.blocks) {
    bruts = donnees.blocks.flatMap((bloc) =>
      (bloc.paragraphs ?? []).flatMap((paragraphe) =>
        (paragraphe.lines ?? []).flatMap((ligne) => ligne.words ?? []),
      ),
    );
  }

  const mots = bruts
    .filter((mot) => (mot.text ?? '').trim().length > 0 && mot.bbox)
    .map((mot) => ({
      texte: (mot.text ?? '').trim(),
      confiance: typeof mot.confidence === 'number' ? mot.confidence : 0,
      xMin: mot.bbox!.x0,
      xMax: mot.bbox!.x1,
      yMin: mot.bbox!.y0,
      yMax: mot.bbox!.y1,
    }));

  return { mots, texte: (donnees.text ?? '').trim() };
}

/* ------------------------------------------------------------------ */
/* Reconstruction des lignes et recherche approximative de libellés    */
/* ------------------------------------------------------------------ */

function normaliser(texte: string): string {
  return texte
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .toLowerCase()
    .trim();
}

function centreY(mot: MotReconnu): number {
  return (mot.yMin + mot.yMax) / 2;
}

/** Regroupe des mots isolés en lignes de lecture, l'OCR ne les livrant pas ordonnées. */
function regrouperEnLignes(mots: MotReconnu[]): MotReconnu[][] {
  const tries = [...mots].sort((a, b) => centreY(a) - centreY(b));
  const lignes: MotReconnu[][] = [];

  for (const mot of tries) {
    const centre = centreY(mot);
    let place = false;
    for (const ligne of lignes) {
      const centreLigne = ligne.reduce((s, m) => s + centreY(m), 0) / ligne.length;
      const hauteurMoyenne = ligne.reduce((s, m) => s + (m.yMax - m.yMin), 0) / ligne.length;
      if (Math.abs(centre - centreLigne) < Math.max(hauteurMoyenne * 0.6, 6)) {
        ligne.push(mot);
        place = true;
        break;
      }
    }
    if (!place) lignes.push([mot]);
  }

  for (const ligne of lignes) ligne.sort((a, b) => a.xMin - b.xMin);
  lignes.sort((a, b) => {
    const ca = a.reduce((s, m) => s + centreY(m), 0) / a.length;
    const cb = b.reduce((s, m) => s + centreY(m), 0) / b.length;
    return ca - cb;
  });
  return lignes;
}

/** Distance d'édition, bornée : au-delà de `plafond` la valeur exacte est inutile. */
function distance(a: string, b: string, plafond: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > plafond) return plafond + 1;

  let precedente = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const courante = [i, ...new Array<number>(b.length).fill(0)];
    let minimumLigne = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cout = a[i - 1] === b[j - 1] ? 0 : 1;
      courante[j] = Math.min(courante[j - 1] + 1, precedente[j] + 1, precedente[j - 1] + cout);
      minimumLigne = Math.min(minimumLigne, courante[j]);
    }
    if (minimumLigne > plafond) return plafond + 1;
    precedente = courante;
  }
  return precedente[b.length];
}

/**
 * Correspondance approximative d'un mot lu avec un mot-clé attendu.
 *
 * L'OCR d'un libellé imprimé se trompe surtout d'un ou deux caractères
 * (« prenom » → « prenorn », « CNI » → « CN1 »). Une tolérance proportionnelle
 * à la longueur du mot-clé rattrape ces cas sans ouvrir la porte aux
 * rapprochements absurdes sur les mots très courts.
 */
function correspond(motLu: string, motCle: string): boolean {
  if (motLu === motCle) return true;
  if (motCle.length >= 5 && motLu.length >= 4 && motLu.startsWith(motCle.slice(0, 4))) return true;
  const tolerance = motCle.length <= 3 ? 0 : motCle.length <= 6 ? 1 : 2;
  return tolerance > 0 && distance(motLu, motCle, tolerance) <= tolerance;
}

/**
 * Reconnaissance du pays CEMAC (dictionnaire fermé à 6 entrées) dans le
 * texte lu au tout début du champ papier combiné « Pays / Localité » (voir
 * pdf_passeport.py::_page_3 — UNE SEULE rangée de 10 cases pour les deux
 * informations, pas deux champs séparés). Un code ISO à 3 lettres (CMR,
 * GAB, TCD, CAF, COG, GNQ) tient exactement en préfixe de ces 10 cases,
 * laissant les cases restantes à la localité — c'est le format attendu.
 *
 * Le nom complet du pays (« CAMEROUN ») est tenté en repli, pour l'agent
 * qui écrit le nom entier plutôt que le code : au-delà de 10 cases, il
 * déborderait visuellement de la ligne, mais l'OCR peut malgré tout le
 * lire s'il déborde légèrement sur la case suivante.
 *
 * Retourne `null` si rien ne correspond avec une confiance suffisante —
 * l'appelant garde alors tout le texte comme localité, un résultat au
 * moins aussi bon qu'avant cette reconnaissance.
 */
function reconnaitrePays(texteLu: string): { pays: PaysReference; longueurConsommee: number } | null {
  const texte = texteLu.toUpperCase().trim();
  if (!texte) return null;

  // Priorité au MOT COMPLET (ex. "CAMEROUN") — bug confirmé en test réel
  // avec l'ordre inverse : le préfixe à 3 lettres "CAM" est à distance 1
  // du code ISO du Centrafrique ("CAF", un seul caractère diffère),
  // suffisant pour déclencher une correspondance erronée AVANT même que
  // le mot complet "CAMEROUN" ait sa chance d'être comparé au bon pays.
  // Un agent qui écrit le nom en toutes lettres (le cas le plus courant,
  // largement plus fiable qu'un code à 3 lettres) doit être reconnu en
  // priorité ; le préfixe à 3 lettres ne sert plus que de repli pour un
  // agent qui aurait écrit uniquement le code ISO, sans le nom complet.
  const premierMot = texte.split(/\s+/)[0] ?? '';
  if (premierMot.length >= 4) {
    for (const pays of PAYS_CEMAC) {
      const debutNom = pays.nom.toUpperCase().slice(0, premierMot.length);
      if (distance(premierMot, debutNom, 2) <= 2) {
        return { pays, longueurConsommee: premierMot.length };
      }
    }
  }

  const prefixe3 = texte.slice(0, 3);
  for (const pays of PAYS_CEMAC) {
    if (distance(prefixe3, pays.code_iso, 1) <= 1) {
      return { pays, longueurConsommee: 3 };
    }
  }

  return null;
}

interface Ancre {
  ligneIndex: number;
  xMin: number;
  xMax: number;
  /** Bas du mot-ancre en pixels — c'est ce repère, pas `ligneIndex` (un
   * simple numéro de ligne abstrait), qui permet de comparer sa position
   * réelle à celle d'un champ détecté par couleur (voir
   * valeurDuChampPrecise). */
  yMax: number;
}

/**
 * Toutes les positions d'un libellé, repérées par un mot-clé DISTINCTIF.
 *
 * Ancrer sur un seul mot-clé (« cni », « telephone », « bovins ») au lieu de la
 * séquence complète du libellé est le changement décisif : le gabarit ne
 * contient qu'une occurrence de chacun par section, et un mot voisin mal lu ne
 * fait plus échouer la recherche.
 *
 * Tri par ligne PUIS par abscisse : le gabarit place le propriétaire et le
 * convoyeur soit côte à côte (deux colonnes), soit l'un sous l'autre (deux
 * sections empilées). Cet ordre de lecture naturel couvre les deux
 * dispositions, là où un tri par abscisse seul inversait les deux personnes
 * dans la version empilée.
 *
 * IMPORTANT : contrairement à l'ancienne version de cette fonction, TOUTES
 * les occurrences d'une même ligne sont conservées, pas seulement la
 * première. En disposition côte à côte, le libellé « Nom et prénom »
 * apparaît DEUX FOIS sur la MÊME ligne horizontale (une fois pour le
 * propriétaire, une fois pour le convoyeur) — s'arrêter à la première
 * occurrence laissait alors la case convoyeur systématiquement vide, quelle
 * que soit la qualité de la photo (bug confirmé en test réel). Le tri par
 * abscisse ensuite les remet dans le bon ordre gauche→droite.
 */
function chercherAncres(lignes: MotReconnu[][], motsCles: string[]): Ancre[] {
  const cles = motsCles.map(normaliser).filter(Boolean);
  const ancres: Ancre[] = [];

  lignes.forEach((ligne, index) => {
    for (const mot of ligne) {
      const lu = normaliser(mot.texte);
      if (!lu) continue;
      if (cles.some((cle) => correspond(lu, cle))) {
        ancres.push({ ligneIndex: index, xMin: mot.xMin, xMax: mot.xMax, yMax: mot.yMax });
        // (volontairement pas de `break` ici — voir la docstring ci-dessus)
      }
    }
  });

  return ancres.sort((a, b) => a.ligneIndex - b.ligneIndex || a.xMin - b.xMin);
}

/**
 * Sous-titres et préfixes IMPRIMÉS du gabarit. Le passeport place
 * systématiquement une traduction anglaise sous chaque libellé français : sans
 * cette liste, « Phone number » serait pris pour le numéro de téléphone
 * manuscrit. On saute donc les lignes connues du gabarit plutôt qu'un nombre
 * fixe de lignes, plus robuste aux variations de cadrage.
 */
const MOTS_DE_GABARIT = [
  'first',
  'last',
  'name',
  'and',
  'national',
  'id',
  'number',
  'phone',
  'origin',
  'destination',
  'country',
  'locality',
  'province',
  'region',
  'date',
  'place',
  'pest',
  'small',
  'ruminants',
  'contagious',
  'bovine',
  'peripneumonia',
  'anthrax',
  'trypanosomiasis',
  'males',
  'females',
  'young',
  'adults',
  'total',
  'jj',
  'mm',
  'aaaa',
  'lieu',
  'nom',
  'prenom',
  'et',
  'cni',
  'telephone',
  'pays',
  'localite',
  'jeunes',
  'adultes',
  'femelles',
  'male',
].map(normaliser);

/** Vrai si le texte lu n'est visiblement qu'un libellé imprimé, pas une valeur. */
function estTexteDeGabarit(texte: string): boolean {
  const mots = normaliser(texte).split(/\s+/).filter(Boolean);
  if (mots.length === 0) return true;
  return mots.every((mot) => MOTS_DE_GABARIT.some((cle) => correspond(mot, cle)));
}

interface ValeurLue {
  texte: string;
  confiance: number;
}

function assembler(candidats: MotReconnu[]): ValeurLue | null {
  if (candidats.length === 0) return null;
  const texte = nettoyerValeur(candidats.map((m) => m.texte).join(' '));
  if (!texte || estTexteDeGabarit(texte)) return null;
  const confiance = candidats.reduce((s, m) => s + m.confiance, 0) / candidats.length;
  return { texte, confiance };
}

/** Valeur manuscrite lue sous un libellé, dans une bande verticale alignée avec lui. */
function valeurSous(
  lignes: MotReconnu[][],
  ancre: Ancre,
  largeurColonne = 420,
): ValeurLue | null {
  const fin = Math.min(ancre.ligneIndex + 5, lignes.length);
  for (let i = ancre.ligneIndex + 1; i < fin; i += 1) {
    const candidats = lignes[i]
      .filter((mot) => {
        const centre = (mot.xMin + mot.xMax) / 2;
        return centre >= ancre.xMin - 40 && centre <= ancre.xMin + largeurColonne;
      })
      .sort((a, b) => a.xMin - b.xMin);
    const valeur = assembler(candidats);
    if (valeur) return valeur;
  }
  return null;
}

/** Valeur écrite sur la MÊME ligne, à droite du libellé (« Téléphone : 6xx xx »). */
function valeurADroite(lignes: MotReconnu[][], ancre: Ancre): ValeurLue | null {
  const ligne = lignes[ancre.ligneIndex];
  if (!ligne) return null;
  const candidats = ligne.filter((mot) => mot.xMin >= ancre.xMax - 2).sort((a, b) => a.xMin - b.xMin);
  return assembler(candidats);
}

/**
 * Valeur d'un champ : à droite d'abord, en dessous ensuite.
 *
 * Les deux dispositions existent sur le gabarit selon la version linguistique,
 * et une photo légèrement inclinée peut faire basculer une valeur « en
 * dessous » sur la ligne du libellé. Essayer les deux double le taux de
 * pré-remplissage sans jamais inventer de valeur.
 */
function valeurDuChamp(
  lignes: MotReconnu[][],
  ancre: Ancre,
  largeurColonne?: number,
): ValeurLue | null {
  return valeurADroite(lignes, ancre) ?? valeurSous(lignes, ancre, largeurColonne);
}

/**
 * Lit directement le contenu d'un champ détecté par sa couleur (voir
 * ./detectionCases.ts), recadré précisément et analysé SEUL — élimine le
 * risque de mélange avec un champ voisin. `valeurSous`/`valeurADroite`
 * devinent une fenêtre de recherche (ex. 420px de large) autour du libellé
 * imprimé ; en disposition à deux colonnes rapprochées (propriétaire /
 * convoyeur), cette fenêtre pouvait empiéter sur la colonne voisine et
 * capturer sa valeur à la place de la bonne — confirmé en test réel
 * (valeurs mélangées entre champs).
 *
 * Repli : renvoie `null` si le recadrage échoue ou si rien n'est lu — dans
 * ce cas l'appelant retombe sur `valeurDuChamp` (fenêtre devinée), qui
 * fonctionnait déjà raisonnablement bien pour certains champs (nom/prénom,
 * confirmé) — jamais de régression.
 */
async function lireChampCible(canvasCouleur: HTMLCanvasElement, champ: ChampDetecte): Promise<ValeurLue | null> {
  if (champ.largeur <= 0 || champ.hauteur <= 0) return null;
  const MARGE = 4;
  const largeurCrop = champ.largeur + MARGE * 2;
  const hauteurCrop = champ.hauteur + MARGE * 2;
  const canvasCrop = document.createElement('canvas');
  canvasCrop.width = largeurCrop;
  canvasCrop.height = hauteurCrop;
  const ctx = canvasCrop.getContext('2d');
  if (!ctx) return null;
  // Marge blanche autour du recadrage : Tesseract lit mieux un caractère
  // qui n'est pas collé au bord de l'image.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, largeurCrop, hauteurCrop);
  try {
    ctx.drawImage(
      canvasCouleur,
      Math.max(0, champ.x - MARGE),
      Math.max(0, champ.y - MARGE),
      largeurCrop,
      hauteurCrop,
      0,
      0,
      largeurCrop,
      hauteurCrop,
    );
    const canvasPretraite = await pretraiterImage(canvasCrop);
    const { mots } = await reconnaitre(canvasPretraite);
    return assembler(mots.sort((a, b) => a.xMin - b.xMin));
  } catch {
    return null;
  }
}

/**
 * Valeur d'un champ : priorité à la lecture ciblée sur le champ détecté par
 * couleur le plus proche du libellé (précise, voir lireChampCible
 * ci-dessus) ; repli sur la fenêtre de recherche devinée (valeurDuChamp) si
 * aucune correspondance de couleur n'est trouvée à proximité.
 */
async function valeurDuChampPrecise(
  canvasCouleur: HTMLCanvasElement | null,
  champsDetectes: ChampDetecte[],
  lignes: MotReconnu[][],
  ancre: Ancre,
  largeurColonne?: number,
): Promise<ValeurLue | null> {
  if (canvasCouleur && champsDetectes.length > 0) {
    // Point de référence : coin bas-gauche du libellé (xMin, yMax) — le
    // champ à cases correspondant se trouve toujours juste en dessous ou
    // juste à droite sur ce gabarit, jamais au-dessus ni à gauche.
    const champ = champLePlusProche(champsDetectes, ancre.xMin, ancre.yMax);
    if (champ) {
      const valeur = await lireChampCible(canvasCouleur, champ);
      if (valeur) return valeur;
    }
  }
  return valeurDuChamp(lignes, ancre, largeurColonne);
}

function nettoyerValeur(texte: string): string {
  return texte
    .replace(/\s{2,}/g, ' ')
    .replace(/^[:.\-–—·|/\\]+\s*/, '')
    .replace(/\s*[|]+\s*$/, '')
    .trim();
}

/* ------------------------------------------------------------------ */
/* Mots-clés d'ancrage du gabarit (toujours en français : ils décrivent */
/* le document papier, pas l'interface)                                */
/* ------------------------------------------------------------------ */

const ANCRES_PERSONNE: Array<{
  cle: 'nom_prenom' | 'numero_cni' | 'telephone';
  motsCles: string[];
}> = [
  { cle: 'nom_prenom', motsCles: ['prenom', 'prenoms'] },
  { cle: 'numero_cni', motsCles: ['cni'] },
  { cle: 'telephone', motsCles: ['telephone', 'tel'] },
];

const ANCRES_ITINERAIRE: Array<{
  cle: 'province_origine' | 'province_destination';
  motsCles: string[];
  /** Rang de l'occurrence attendue parmi les ancres du même mot-clé. */
  rang: number;
}> = [
  { cle: 'province_origine', motsCles: ['province'], rang: 0 },
  { cle: 'province_destination', motsCles: ['province'], rang: 1 },
];

/**
 * Pays + localité (champ papier COMBINÉ, une seule rangée de 10 cases —
 * voir reconnaitrePays ci-dessus). « Localité » n'a jamais été une case
 * séparée sur le gabarit imprimé réel : l'ancienne version de ce fichier
 * cherchait un ancrage sur ce mot comme s'il l'était, ce qui ne pouvait
 * jamais trouver la bonne valeur manuscrite. Corrigé ici en même temps que
 * l'ajout de la reconnaissance de pays.
 */
const ANCRES_PAYS: Array<{
  clePays: 'pays_origine_id' | 'pays_destination_id';
  cleLocalite: 'localite_origine' | 'localite_destination';
  rang: number;
}> = [
  { clePays: 'pays_origine_id', cleLocalite: 'localite_origine', rang: 0 },
  { clePays: 'pays_destination_id', cleLocalite: 'localite_destination', rang: 1 },
];

const ANCRES_ESPECES: Array<[string[], EspeceTroupeau]> = [
  [['bovins', 'bovin'], 'bovin'],
  [['ovins', 'ovin'], 'ovin'],
  [['caprins', 'caprin'], 'caprin'],
  [['camelins', 'camelin'], 'camelin'],
];

const ANCRES_MALADIES: Array<[string[], MaladieControlee]> = [
  [['ruminants'], 'peste_petits_ruminants'],
  [['peripneumonie'], 'peripneumonie_contagieuse'],
  [['charbon'], 'charbon'],
  [['trypanosomiase'], 'trypanosomiase'],
];

/* ------------------------------------------------------------------ */
/* Résultats                                                           */
/* ------------------------------------------------------------------ */

/** Éléments communs de diagnostic, affichés quand rien n'a pu être lu. */
export interface CaptureCelluleDiagnostic {
  /** 'vide' = jugée sans encre, jamais envoyée à la lecture (fin de champ
   * supposée) ; 'lu' = un caractère a été reconnu ; 'echec' = envoyée à la
   * lecture mais aucun caractère n'en est ressorti. */
  statut: 'vide' | 'lu' | 'echec';
  image: string;
  caractere?: string;
  confiance?: number;
}

export interface CaptureDiagnostic {
  /** Nom lisible du champ (ex. "Éleveur — Nom et prénom"). */
  champ: string;
  /** Image exacte envoyée à la lecture (avant découpage en cases
   * individuelles), au format data URL — permet de voir directement si le
   * recadrage tombe au bon endroit, sans deviner à partir du texte produit. */
  image: string;
  /** Le détail case par case — répond à une question précise : la lecture
   * s'arrête-t-elle trop tôt (cases jugées vides à tort), ou lit-elle bien
   * toutes les cases mais se trompe sur leur contenu ? Ce sont deux bugs
   * très différents, indiscernables depuis le seul texte final produit. */
  cellules: CaptureCelluleDiagnostic[];
}

export interface DiagnosticOcr {
  /** Nombre de mots que l'OCR a réellement isolés sur la photo. */
  nombreMots: number;
  /** Texte brut reconnu, tronqué — preuve visible que le moteur a fonctionné. */
  texteBrut: string;
  /** Champs détectés par couleur (voir detectionCases.ts) — utile pour
   * vérifier visuellement, écran par écran, que chaque case est bien
   * repérée au bon endroit avant de faire confiance à la valeur lue. */
  champsDetectes: ChampDetecte[];
  /** Une image par champ du gabarit, montrant exactement la zone recadrée
   * envoyée à la lecture — voir CaptureDiagnostic ci-dessus. */
  capturesDiagnostic: CaptureDiagnostic[];
  /** Position exacte des 4 marqueurs de coin détectés (voir
   * ./homographie.ts) — vide si aucun n'a été trouvé (repli sur l'ancrage
   * seul) ou pour la méthode locale, qui ne les utilise pas. */
  pointsMarqueurs: Point[];
}

export interface ResultatOcrPage3 extends DiagnosticOcr {
  donnees: DonneesPage3;
  confiances: CarteConfiance;
  nombreChampsLus: number;
}

export interface ResultatOcrPage4 extends DiagnosticOcr {
  donnees: DonneesPage4;
  confiances: CarteConfiance;
  nombreChampsLus: number;
}

const LONGUEUR_TEXTE_DIAGNOSTIC = 600;

/** Ne garde qu'un numéro de téléphone plausible : chiffres, espaces, `+`. */
/**
 * Corrige les confusions chiffre/lettre les plus fréquentes d'un OCR entraîné
 * surtout sur de l'imprimé face à un chiffre manuscrit (O/0, I·l/1, S/5,
 * B/8, Z/2, G/6) — appliqué uniquement au téléphone, un champ purement
 * numérique (voir nettoyerTelephone) où la substitution ne risque jamais de
 * corrompre une vraie lettre. Volontairement PAS appliqué à la CNI : son
 * format mélange parfois lettres et chiffres selon le pays, une correction
 * aveugle y détruirait des valeurs réellement alphanumériques.
 */
function corrigerConfusionsChiffres(texte: string): string {
  return texte.replace(/[OoIlSsBZzGq]/g, (car) => {
    switch (car) {
      case 'O': case 'o': return '0';
      case 'I': case 'l': return '1';
      case 'S': case 's': return '5';
      case 'B': return '8';
      case 'Z': case 'z': return '2';
      case 'G': return '6';
      case 'q': return '9';
      default: return car;
    }
  });
}

function nettoyerTelephone(texte: string): string {
  const filtre = corrigerConfusionsChiffres(texte)
    .replace(/[^\d+\s]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return filtre.replace(/[^\d]/g, '').length >= 6 ? filtre : '';
}

/** Normalise une date manuscrite (JJ/MM/AAAA, JJ MM AAAA, JJ-MM-AA) vers AAAA-MM-JJ. */
export function normaliserDate(texte: string): string | null {
  const chiffres = texte.match(/\d+/g);
  if (!chiffres || chiffres.length < 3) return null;
  const [j, m, a] = chiffres;
  const jour = Number(j);
  const mois = Number(m);
  let annee = Number(a);
  if (a.length <= 2) annee += annee < 70 ? 2000 : 1900;
  if (jour < 1 || jour > 31 || mois < 1 || mois > 12 || annee < 1990 || annee > 2100) return null;
  return `${annee}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
}

/**
 * Normalise une date lue case par case au format JJMMAAAA CONTINU, sans
 * séparateur imprimé entre les groupes (voir GABARIT_PAGE4 — 8 cases par
 * date de vaccination, contrairement aux autres champs qui n'ont pas de
 * regroupement interne visible). `normaliserDate` ci-dessus suppose des
 * séparateurs (JJ/MM/AAAA) pour distinguer les trois groupes — inutilisable
 * ici, la lecture case par case ne renvoie qu'une suite de chiffres.
 */
function normaliserDateCases(texte: string): string | null {
  const chiffres = texte.replace(/\D/g, '');
  if (chiffres.length < 6) return null;
  // Accepte 6 chiffres (JJMMAA, année sur 2 chiffres) ou 8 (JJMMAAAA) — un
  // agent peut remplir moins de cases que le maximum prévu.
  const jour = Number(chiffres.slice(0, 2));
  const mois = Number(chiffres.slice(2, 4));
  let annee = Number(chiffres.slice(4, chiffres.length >= 8 ? 8 : 6));
  if (chiffres.length < 8) annee += annee < 70 ? 2000 : 1900;
  if (jour < 1 || jour > 31 || mois < 1 || mois > 12 || annee < 1990 || annee > 2100) return null;
  return `${annee}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
}

/**
 * Image COULEUR (jamais convertie en niveaux de gris) à partir de la même
 * source que le reste du pipeline — nécessaire pour la détection par
 * couleur (voir detectionCases.ts) : `pretraiterImage` binarise en noir et
 * blanc, ce qui détruit justement le signal de couleur recherché ici.
 * Repli : `null` sur toute erreur — la détection par couleur est alors
 * simplement absente pour cette lecture, sans jamais bloquer le reste.
 */
export async function versCanvasCouleur(source: Blob | HTMLCanvasElement): Promise<HTMLCanvasElement | null> {
  try {
    if (source instanceof HTMLCanvasElement) return source;
    const bitmap = await creerBitmap(source);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap as CanvasImageSource, 0, 0);
    if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close();
    return canvas;
  } catch {
    return null;
  }
}

/**
 * Découpe une zone (voir ./gabarit.ts) avec une marge de tolérance pour le
 * cadrage, tout en gardant la position EXACTE de la zone mesurée à
 * l'intérieur du recadrage — nécessaire pour effacerSeparateurs ci-dessous,
 * qui doit connaître les vraies bornes du champ, pas une version élargie.
 *
 * `cadre`, si fourni (voir detecterCadreVert), sert de RÉFÉRENTIEL au lieu
 * de la photo entière — corrige un bug confirmé en test réel : deux photos
 * peuvent avoir une marge de fond légèrement différente autour du cadre
 * vert imprimé selon la précision de l'alignement de l'agent, ce qui
 * décale TOUS les champs de la même façon si on suppose que la photo
 * correspond exactement au cadre (voir ./gabarit.ts pour le détail). `null`
 * = repli sur la photo entière, comportement d'avant cette détection.
 */
interface ZonePixels {
  x: number;
  y: number;
  largeur: number;
  hauteur: number;
  nbCases: number;
}

/** Convertit une zone du gabarit (pourcentages, voir ./gabarit.ts) en
 * pixels réels, relatifs au cadre vert détecté sur cette photo précise
 * (voir detecterCadreVert) — ou à la photo entière si la détection du
 * cadre a échoué (repli, comportement d'avant cette détection). */
function zoneGabaritEnPixels(
  zone: ZonePct,
  cadre: CadreDetecte | null,
  canvasCouleur: HTMLCanvasElement,
  homographie: number[] | null,
): ZonePixels {
  if (homographie) {
    // Transforme les 4 coins de la zone (repère normalisé [0,1], voir
    // ./homographie.ts) pour obtenir leur position réelle sur la photo, en
    // tenant compte d'une éventuelle déformation de perspective — bien
    // plus précis qu'une simple mise à l'échelle linéaire à partir du seul
    // cadre détecté (voir la note dans ./homographie.ts : la vraie source
    // d'imprécision est la prise de photo, pas l'impression).
    const coins = [
      appliquerHomographie(homographie, zone.xDebut / 100, zone.yDebut / 100),
      appliquerHomographie(homographie, zone.xFin / 100, zone.yDebut / 100),
      appliquerHomographie(homographie, zone.xDebut / 100, zone.yFin / 100),
      appliquerHomographie(homographie, zone.xFin / 100, zone.yFin / 100),
    ];
    const xs = coins.map((p) => p.x);
    const ys = coins.map((p) => p.y);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);
    return {
      x: Math.round(xMin),
      y: Math.round(yMin),
      largeur: Math.round(xMax - xMin),
      hauteur: Math.round(yMax - yMin),
      nbCases: zone.nbCases,
    };
  }

  const referentielX = cadre?.x ?? 0;
  const referentielY = cadre?.y ?? 0;
  const referentielL = cadre?.largeur ?? canvasCouleur.width;
  const referentielH = cadre?.hauteur ?? canvasCouleur.height;
  return {
    x: referentielX + Math.round((zone.xDebut / 100) * referentielL),
    y: referentielY + Math.round((zone.yDebut / 100) * referentielH),
    largeur: Math.round(((zone.xFin - zone.xDebut) / 100) * referentielL),
    hauteur: Math.round(((zone.yFin - zone.yDebut) / 100) * referentielH),
    nbCases: zone.nbCases,
  };
}

/**
 * Affine la position d'un champ en combinant position FIXE (gabarit) et
 * détection par COULEUR (voir detectionCases.ts) — la position du gabarit
 * sert de zone de recherche, la case détectée par couleur la plus proche à
 * l'intérieur donne la position réelle sur CETTE photo précise, si elle
 * est trouvée.
 *
 * Nécessaire même avec le cadre vert déjà recalé par photo (voir
 * detecterCadreVert) : la position exacte d'une case à l'intérieur de la
 * page peut elle-même varier légèrement d'un tirage papier à l'autre
 * (positionnement de la feuille dans l'imprimante lors du tirage), ce
 * qu'un simple recalage global du cadre ne peut pas absorber — confirmé en
 * test réel par des résultats incohérents d'une photo à l'autre sur un
 * même gabarit. Repli sur la position fixe telle quelle si rien n'est
 * détecté à proximité (jamais de blocage).
 */
function affinerZoneParCouleur(zonePixels: ZonePixels, champsDetectes: ChampDetecte[]): ZonePixels {
  if (champsDetectes.length === 0) return zonePixels;
  // Rayon de recherche généreux (une fois et demie la plus grande dimension
  // attendue) : couvre un écart d'impression réaliste sans risquer
  // d'accrocher un champ complètement différent sur la page.
  const rayon = Math.max(zonePixels.largeur, zonePixels.hauteur) * 1.5;
  const champ = champLePlusProche(champsDetectes, zonePixels.x, zonePixels.y, rayon);
  if (!champ) return zonePixels;

  // Garde-fous avant d'accepter cet affinage : mieux vaut garder la
  // position fixe (déjà raisonnable) que de sauter sur une détection
  // aberrante — bug confirmé en test réel (fond de page confondu avec une
  // case sous certain éclairage, produisant des rectangles hauts et
  // étroits n'importe où sur la page).
  const formeVraisemblable = champ.largeur >= champ.hauteur * 2;
  const tailleVraisemblable =
    champ.largeur >= zonePixels.largeur * 0.5 &&
    champ.largeur <= zonePixels.largeur * 1.8 &&
    champ.hauteur >= zonePixels.hauteur * 0.5 &&
    champ.hauteur <= zonePixels.hauteur * 2.2;
  if (!formeVraisemblable || !tailleVraisemblable) return zonePixels;

  return { x: champ.x, y: champ.y, largeur: champ.largeur, hauteur: champ.hauteur, nbCases: zonePixels.nbCases };
}

/** Recadre une zone déjà résolue en pixels, avec une légère marge
 * proportionnelle à sa propre taille (pas à la page entière) — s'applique
 * aussi bien à une zone fixe qu'à une zone déjà affinée par couleur. */
function decouperZonePixels(
  canvasCouleur: HTMLCanvasElement,
  zone: ZonePixels,
): { canvas: HTMLCanvasElement; offsetXPx: number; largeurExactePx: number } {
  const margeX = Math.round(zone.largeur * 0.03);
  const margeY = Math.round(zone.hauteur * 0.15);

  const xPad = Math.max(0, zone.x - margeX);
  const yPad = Math.max(0, zone.y - margeY);
  const largeurPad = zone.largeur + margeX * 2;
  const hauteurPad = zone.hauteur + margeY * 2;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, largeurPad);
  canvas.height = Math.max(1, hauteurPad);
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(canvasCouleur, xPad, yPad, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
  }

  return { canvas, offsetXPx: zone.x - xPad, largeurExactePx: zone.largeur };
}

const JEU_LETTRES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const JEU_CHIFFRES = '0123456789';
type JeuCaracteres = 'lettres' | 'chiffres';

/**
 * Vérifie qu'une case binarisée contient effectivement un peu d'encre (pas
 * juste du bruit de papier ou de compression photo) — évite d'appeler
 * Tesseract sur une case réellement vide, qui produit parfois un caractère
 * halluciné à partir de rien plutôt que de renvoyer une absence de résultat.
 */
function contientDeLEncre(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  let image: ImageData;
  try {
    image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return true; // par prudence, tenter quand même la lecture
  }
  const data = image.data;
  let sombres = 0;
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    total += 1;
    if (data[i] < 128) sombres += 1; // pretraiterImage binarise déjà en N&B
  }
  return total > 0 && sombres / total >= 0.02;
}

/**
 * Lit UN SEUL caractère isolé, avec un alphabet restreint (lettres OU
 * chiffres selon le champ, jamais les deux) et un mode de segmentation
 * Tesseract dédié à un caractère unique — plus précis qu'une lecture de
 * mot/ligne complète sur une case aussi petite.
 *
 * Remet toujours les réglages Tesseract à leur état par défaut après
 * lecture (`finally`) : le même moteur partagé (voir obtenirWorker) sert
 * aussi aux lectures pleine page ailleurs dans ce fichier, qui doivent
 * retrouver un alphabet et une segmentation non restreints.
 */
async function reconnaitreUnCaractere(
  canvas: HTMLCanvasElement,
  jeu: JeuCaracteres,
): Promise<{ caractere: string; confiance: number } | null> {
  const worker = await obtenirWorker();
  const whitelist = jeu === 'chiffres' ? JEU_CHIFFRES : JEU_LETTRES;
  try {
    await worker.setParameters({
      tessedit_char_whitelist: whitelist,
      tessedit_pageseg_mode: PSM.SINGLE_CHAR,
    });
    const resultat = await borner(
      worker.recognize(canvas, {}, { text: true }),
      DELAI_RECONNAISSANCE_MS,
      'Lecture case par case trop longue.',
    );
    const texte = (resultat.data.text ?? '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
    const confiance = typeof resultat.data.confidence === 'number' ? resultat.data.confidence : 0;
    if (!texte) return null;
    return { caractere: texte[0], confiance };
  } catch {
    return null;
  } finally {
    try {
      await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: PSM.AUTO });
    } catch {
      /* pas grave si la remise à zéro échoue, la prochaine lecture ciblée la referait de toute façon */
    }
  }
}

/**
 * Lit un champ à cases CARACTÈRE PAR CARACTÈRE — chaque case est recadrée,
 * binarisée puis analysée SEULE, avec un alphabet restreint et un mode de
 * segmentation dédié à un caractère isolé. Plus lent qu'une lecture de la
 * bande entière (jusqu'à `nbCases` appels au lieu d'un seul), mais choisi
 * après que la lecture en bloc — même séparateurs effacés, même ligne
 * dominante isolée — a continué à produire des résultats inexploitables
 * sur plusieurs photos réelles de suite. Reproduit l'approche recommandée
 * dès le départ par le document de stratégie de ce chantier (§8 —
 * exploiter les cases individuelles).
 *
 * S'arrête à la première case manifestement vide : les cases suivantes
 * sont alors considérées non remplies, ce qui est le cas normal pour un
 * champ plus court que le nombre maximal de cases (ex. un numéro à 8
 * chiffres dans un champ qui en prévoit 10).
 */
async function lireCaseParCase(
  canvasCouleur: HTMLCanvasElement,
  zone: ZonePct,
  cadre: CadreDetecte | null,
  homographie: number[] | null,
  jeu: JeuCaracteres,
  champsDetectes: ChampDetecte[],
  nomChamp: string,
  captures: CaptureDiagnostic[],
): Promise<ValeurLue | null> {
  const zonePixelsBrute = zoneGabaritEnPixels(zone, cadre, canvasCouleur, homographie);
  // L'affinage par couleur (voir affinerZoneParCouleur) reste un filet de
  // sécurité utile quand les marqueurs de coin sont introuvables (carnets
  // déjà imprimés avant leur ajout au gabarit, ou marqueur occulté sur la
  // photo) — mais une fois l'homographie calculée à partir de 4 points
  // connus, elle est déjà plus précise que ce que la couleur peut
  // apporter ; la couleur peut alors seulement dégrader la position
  // (confirmé en test réel : fond de page confondu avec une case sous
  // certains éclairages).
  const zonePixels = homographie ? zonePixelsBrute : affinerZoneParCouleur(zonePixelsBrute, champsDetectes);
  const { canvas, offsetXPx, largeurExactePx } = decouperZonePixels(canvasCouleur, zonePixels);

  // Capture diagnostique : l'image EXACTE envoyée à la lecture, avant tout
  // découpage en cases individuelles — permet de voir directement si le
  // recadrage tombe au bon endroit, plutôt que de deviner à partir du
  // texte produit (souvent illisible en cas d'échec, ce qui ne dit rien
  // sur la cause : mauvais recadrage ? mauvaise lecture du contenu ?).
  const captureChamp: CaptureDiagnostic = { champ: nomChamp, image: '', cellules: [] };
  try {
    captureChamp.image = canvas.toDataURL('image/png');
  } catch {
    /* diagnostic non bloquant : une image en moins n'empêche pas la lecture */
  }
  captures.push(captureChamp);

  if (largeurExactePx <= 0) return null;
  const largeurCase = largeurExactePx / zone.nbCases;
  const hauteur = canvas.height;

  let texte = '';
  let sommeConfiance = 0;
  let compte = 0;

  for (let i = 0; i < zone.nbCases; i += 1) {
    const xCase = offsetXPx + i * largeurCase;
    // Rognage intérieur : exclut les bords de case (traits séparateurs)
    // sans avoir à les repeindre — ne garde que le cœur de la case.
    const margeInterieure = largeurCase * 0.16;
    const xDebutCase = Math.max(0, Math.round(xCase + margeInterieure));
    const xFinCase = Math.min(canvas.width, Math.round(xCase + largeurCase - margeInterieure));
    const largeurCaseRognee = xFinCase - xDebutCase;
    if (largeurCaseRognee <= 4) continue;

    const caseCanvas = document.createElement('canvas');
    caseCanvas.width = largeurCaseRognee;
    caseCanvas.height = hauteur;
    const ctx = caseCanvas.getContext('2d');
    if (!ctx) continue;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, largeurCaseRognee, hauteur);
    ctx.drawImage(canvas, xDebutCase, 0, largeurCaseRognee, hauteur, 0, 0, largeurCaseRognee, hauteur);

    let pretraite: HTMLCanvasElement;
    try {
      pretraite = await pretraiterImage(caseCanvas);
    } catch {
      break;
    }

    let imageCellule = '';
    try {
      imageCellule = pretraite.toDataURL('image/png');
    } catch {
      /* diagnostic non bloquant */
    }

    if (!contientDeLEncre(pretraite)) {
      captureChamp.cellules.push({ statut: 'vide', image: imageCellule });
      break;
    }

    const resultat = await reconnaitreUnCaractere(pretraite, jeu);
    if (!resultat) {
      captureChamp.cellules.push({ statut: 'echec', image: imageCellule });
      continue;
    }
    captureChamp.cellules.push({
      statut: 'lu',
      image: imageCellule,
      caractere: resultat.caractere,
      confiance: Math.round(resultat.confiance),
    });
    texte += resultat.caractere;
    sommeConfiance += resultat.confiance;
    compte += 1;
  }

  if (!texte) return null;
  return { texte, confiance: compte > 0 ? sommeConfiance / compte : 0 };
}

/** Page 3 — propriétaire, convoyeur et trajet déclaré. */
export async function lirePage3(photo: Blob, paysAgent: number | null): Promise<ResultatOcrPage3> {

  // Repli silencieux intégré à redresserDocument : `redresse` vaut `null` si
  // la détection échoue pour n'importe quelle raison, et on lit alors la
  // photo brute exactement comme avant ce module — jamais de blocage.
  // (voir DETECTION_PERSPECTIVE_ACTIVE ci-dessus : désactivé pour l'instant)
  const redresse = DETECTION_PERSPECTIVE_ACTIVE ? await redresserDocument(photo) : null;
  const source = redresse ?? photo;
  const canvasCouleur = await versCanvasCouleur(source);
  // Cadre vert réellement détecté sur CETTE photo — sert de référentiel aux
  // coordonnées fixes du gabarit (voir zoneGabaritEnPixels), pour
  // ne plus supposer que le cadrage est toujours identique d'une photo à
  // l'autre (bug confirmé en test réel : marge de fond variable autour du
  // cadre imprimé selon la précision de l'alignement de l'agent).
  const cadre = canvasCouleur ? detecterCadreVert(canvasCouleur) : null;
  // Marqueurs de coin (voir ./homographie.ts) : quand ils sont trouvés,
  // l'homographie calculée à partir de leur position réelle est plus
  // précise que le simple cadre détecté — elle absorbe une déformation de
  // perspective non uniforme (photo prise avec un léger angle), ce qu'une
  // mise à l'échelle linéaire ne peut pas faire. `null` sur un carnet
  // imprimé avant l'ajout des marqueurs, ou si l'un des 4 est occulté sur
  // la photo — repli silencieux sur le cadre seul, jamais de blocage.
  const marqueurs = canvasCouleur && cadre ? detecterMarqueurs(canvasCouleur, cadre) : null;
  const homographie = marqueurs ? calculerHomographie(marqueurs) : null;
  // Champs détectés par couleur — filet de sécurité pour les photos sans
  // homographie disponible (voir lireCaseParCase). Une fois l'homographie
  // calculée, elle prime : la couleur peut alors seulement dégrader la
  // position (confirmé en test réel : fond de page confondu avec une case
  // sous certains éclairages).
  const champsDetectes = canvasCouleur ? detecterChamps(canvasCouleur) : [];
  const capturesDiagnostic: CaptureDiagnostic[] = [];

  const donnees = page3Vide(paysAgent);
  const confiances: CarteConfiance = {};
  let lus = 0;

  // --- Méthode principale : gabarit à positions FIXES (voir ./gabarit.ts) ---
  // Le cadrage de la photo suit le repère visuel affiché à l'écran (voir
  // Capture.tsx) — la position de chaque champ est donc connue d'avance,
  // mesurée une fois sur le vrai gabarit imprimé. Plus fiable que deviner
  // une fenêtre de recherche autour d'un libellé ou une couleur : on sait
  // déjà où chercher, sans avoir à le retrouver à chaque photo.
  if (canvasCouleur) {
    const roles: Array<['eleveur' | 'convoyeur', keyof typeof GABARIT_PAGE3.eleveur, JeuCaracteres, string]> = [
      ['eleveur', 'nom_prenom', 'lettres', 'Propriétaire — Nom et prénom'],
      ['eleveur', 'numero_cni', 'chiffres', 'Propriétaire — N° CNI'],
      ['eleveur', 'telephone', 'chiffres', 'Propriétaire — Téléphone'],
      ['convoyeur', 'nom_prenom', 'lettres', 'Convoyeur — Nom et prénom'],
      ['convoyeur', 'numero_cni', 'chiffres', 'Convoyeur — N° CNI'],
      ['convoyeur', 'telephone', 'chiffres', 'Convoyeur — Téléphone'],
    ];
    for (const [role, cle, jeu, nom] of roles) {
      const zone = GABARIT_PAGE3[role][cle];
      const valeur = await lireCaseParCase(canvasCouleur, zone, cadre, homographie, jeu, champsDetectes, nom, capturesDiagnostic);
      if (!valeur || !valeur.texte) continue;
      const texteChamp = cle === 'telephone' ? nettoyerTelephone(valeur.texte) : valeur.texte;
      if (!texteChamp) continue;
      donnees[role][cle] = texteChamp;
      confiances[`${role}.${cle}`] = niveauDepuisScore(valeur.confiance);
      lus += 1;
    }

    const provinces: Array<['province_origine' | 'province_destination', string]> = [
      ['province_origine', 'Origine — Province / Région'],
      ['province_destination', 'Destination — Province / Région'],
    ];
    for (const [cle, nom] of provinces) {
      const valeur = await lireCaseParCase(
        canvasCouleur,
        GABARIT_PAGE3.itineraire[cle],
        cadre,
        homographie,
        'lettres',
        champsDetectes,
        nom,
        capturesDiagnostic,
      );
      if (!valeur || !valeur.texte) continue;
      donnees.itineraire[cle] = valeur.texte;
      confiances[`itineraire.${cle}`] = niveauDepuisScore(valeur.confiance);
      lus += 1;
    }

    const paysChamps: Array<[
      'origine_pays_localite' | 'destination_pays_localite',
      'pays_origine_id' | 'pays_destination_id',
      'localite_origine' | 'localite_destination',
      string,
    ]> = [
      ['origine_pays_localite', 'pays_origine_id', 'localite_origine', 'Origine — Pays / Localité'],
      ['destination_pays_localite', 'pays_destination_id', 'localite_destination', 'Destination — Pays / Localité'],
    ];
    for (const [cleZone, clePays, cleLocalite, nom] of paysChamps) {
      const valeur = await lireCaseParCase(
        canvasCouleur,
        GABARIT_PAGE3.itineraire[cleZone],
        cadre,
        homographie,
        'lettres',
        champsDetectes,
        nom,
        capturesDiagnostic,
      );
      if (!valeur || !valeur.texte) continue;
      const correspondance = reconnaitrePays(valeur.texte);
      if (correspondance) {
        donnees.itineraire[clePays] = correspondance.pays.id;
        confiances[`itineraire.${clePays}`] = niveauDepuisScore(valeur.confiance);
        lus += 1;
        const reste = valeur.texte.trim().slice(correspondance.longueurConsommee).trim();
        if (reste) {
          donnees.itineraire[cleLocalite] = reste;
          confiances[`itineraire.${cleLocalite}`] = niveauDepuisScore(valeur.confiance);
          lus += 1;
        }
      } else {
        donnees.itineraire[cleLocalite] = valeur.texte;
        confiances[`itineraire.${cleLocalite}`] = niveauDepuisScore(valeur.confiance);
        lus += 1;
      }
    }
  }

  // --- Repli : lecture par ancrage/couleur (ancienne méthode) ---
  // Utilisée UNIQUEMENT si le gabarit fixe n'a presque rien trouvé — signe
  // probable d'un cadrage éloigné du repère visuel (photo reprise sans
  // suivre le cadre vert, ancienne habitude, etc.). Ce seuil (2) reste
  // volontairement bas : le gabarit fixe est fiable dès qu'il trouve
  // ne serait-ce qu'un ou deux champs, pas besoin d'un repli si la photo
  // était globalement correcte mais qu'un agent a simplement laissé
  // certaines cases vides.
  const canvas = await pretraiterImage(source);
  const { mots, texte } = await reconnaitre(canvas);

  if (lus < 2) {
    const lignes = regrouperEnLignes(mots);

    for (const { cle, motsCles } of ANCRES_PERSONNE) {
      const ancres = chercherAncres(lignes, motsCles);
      const rolesRepli: Array<'eleveur' | 'convoyeur'> = ['eleveur', 'convoyeur'];
      for (const [index, role] of rolesRepli.entries()) {
        const ancre = ancres[index];
        if (!ancre) continue;
        const valeur = await valeurDuChampPrecise(canvasCouleur, champsDetectes, lignes, ancre);
        if (!valeur) continue;
        const texteChamp = cle === 'telephone' ? nettoyerTelephone(valeur.texte) : valeur.texte;
        if (!texteChamp) continue;
        donnees[role][cle] = texteChamp;
        confiances[`${role}.${cle}`] = niveauDepuisScore(valeur.confiance);
        lus += 1;
      }
    }

    for (const { cle, motsCles, rang } of ANCRES_ITINERAIRE) {
      const ancre = chercherAncres(lignes, motsCles)[rang];
      if (!ancre) continue;
      const valeur = await valeurDuChampPrecise(canvasCouleur, champsDetectes, lignes, ancre);
      if (!valeur || !valeur.texte) continue;
      donnees.itineraire[cle] = valeur.texte;
      confiances[`itineraire.${cle}`] = niveauDepuisScore(valeur.confiance);
      lus += 1;
    }

    for (const { clePays, cleLocalite, rang } of ANCRES_PAYS) {
      const ancre = chercherAncres(lignes, ['pays'])[rang];
      if (!ancre) continue;
      const valeur = await valeurDuChampPrecise(canvasCouleur, champsDetectes, lignes, ancre);
      if (!valeur || !valeur.texte) continue;

      const correspondance = reconnaitrePays(valeur.texte);
      if (correspondance) {
        donnees.itineraire[clePays] = correspondance.pays.id;
        confiances[`itineraire.${clePays}`] = niveauDepuisScore(valeur.confiance);
        lus += 1;
        const reste = valeur.texte.trim().slice(correspondance.longueurConsommee).trim();
        if (reste) {
          donnees.itineraire[cleLocalite] = reste;
          confiances[`itineraire.${cleLocalite}`] = niveauDepuisScore(valeur.confiance);
          lus += 1;
        }
      } else {
        donnees.itineraire[cleLocalite] = valeur.texte;
        confiances[`itineraire.${cleLocalite}`] = niveauDepuisScore(valeur.confiance);
        lus += 1;
      }
    }
  }

  return {
    donnees,
    confiances,
    nombreChampsLus: lus,
    nombreMots: mots.length,
    texteBrut: texte.slice(0, LONGUEUR_TEXTE_DIAGNOSTIC),
    champsDetectes,
    capturesDiagnostic,
    pointsMarqueurs: [],
  };
}

/**
 * Convertit le résultat de la reconnaissance CÔTÉ SERVEUR (Google Vision,
 * voir lib/sync.ts::reconnaitrePageCloud et backend/app/services/
 * ocr_service.py) vers la même structure que la reconnaissance locale
 * (ResultatOcrPage3) — le formulaire n'a pas à savoir laquelle des deux
 * voies a produit le résultat.
 *
 * Deux différences volontaires avec la voie locale :
 * - Le serveur renvoie le champ pays+localité combiné tel quel dans
 *   `localite_origine`/`localite_destination` (voir ocr_service.py::
 *   LIBELLES_ITINERAIRE) — la séparation pays/localité (reconnaitrePays,
 *   déjà écrite pour la voie locale) est réappliquée ici, à l'identique.
 * - Google Vision ne renvoie pas de confiance par champ dans la forme
 *   actuelle du service : chaque champ reçu est marqué confiance
 *   « moyenne » par défaut — l'agent le vérifie comme n'importe quel champ
 *   pré-rempli, jamais un chiffre de confiance inventé.
 */
export function convertirChampsCloudPage3(champsServeur: unknown, paysAgent: number | null): ResultatOcrPage3 {
  const donnees = page3Vide(paysAgent);
  const confiances: CarteConfiance = {};
  let lus = 0;

  const c = (champsServeur ?? {}) as {
    eleveur?: Record<string, string>;
    convoyeur?: Record<string, string>;
    itineraire?: Record<string, string>;
  };

  for (const [role, cle] of [
    ['eleveur', 'nom_prenom'], ['eleveur', 'numero_cni'], ['eleveur', 'telephone'],
    ['convoyeur', 'nom_prenom'], ['convoyeur', 'numero_cni'], ['convoyeur', 'telephone'],
  ] as const) {
    const valeur = c[role]?.[cle];
    if (!valeur) continue;
    const texteChamp = cle === 'telephone' ? nettoyerTelephone(valeur) : valeur;
    if (!texteChamp) continue;
    donnees[role][cle] = texteChamp;
    confiances[`${role}.${cle}`] = 'moyenne';
    lus += 1;
  }

  const province = c.itineraire?.province_origine;
  if (province) {
    donnees.itineraire.province_origine = province;
    confiances['itineraire.province_origine'] = 'moyenne';
    lus += 1;
  }
  const provinceDest = c.itineraire?.province_destination;
  if (provinceDest) {
    donnees.itineraire.province_destination = provinceDest;
    confiances['itineraire.province_destination'] = 'moyenne';
    lus += 1;
  }

  for (const [cleServeur, clePays, cleLocalite] of [
    ['localite_origine', 'pays_origine_id', 'localite_origine'],
    ['localite_destination', 'pays_destination_id', 'localite_destination'],
  ] as const) {
    const brut = c.itineraire?.[cleServeur];
    if (!brut) continue;
    const correspondance = reconnaitrePays(brut);
    if (correspondance) {
      donnees.itineraire[clePays] = correspondance.pays.id;
      confiances[`itineraire.${clePays}`] = 'moyenne';
      lus += 1;
      const reste = brut.trim().slice(correspondance.longueurConsommee).trim();
      if (reste) {
        donnees.itineraire[cleLocalite] = reste;
        confiances[`itineraire.${cleLocalite}`] = 'moyenne';
        lus += 1;
      }
    } else {
      donnees.itineraire[cleLocalite] = brut;
      confiances[`itineraire.${cleLocalite}`] = 'moyenne';
      lus += 1;
    }
  }

  return { donnees, confiances, nombreChampsLus: lus, nombreMots: 0, texteBrut: '', champsDetectes: [], capturesDiagnostic: [], pointsMarqueurs: [] };
}

/** Voir convertirChampsCloudPage3 — même principe pour la page 4. */
export function convertirChampsCloudPage4(champsServeur: unknown): ResultatOcrPage4 {
  const donnees = page4Vide();
  const confiances: CarteConfiance = {};
  let lus = 0;

  const c = (champsServeur ?? {}) as {
    effectifs?: Array<{
      espece: EspeceTroupeau;
      nombre_males: number;
      nombre_femelles_jeunes: number;
      nombre_femelles_adultes: number;
      nombre_total: number;
    }>;
    vaccinations?: Array<{ maladie: MaladieControlee; date_vaccination: string | null; lieu: string | null }>;
  };

  for (const effectifServeur of c.effectifs ?? []) {
    const index = donnees.especes.findIndex((e) => e.espece === effectifServeur.espece);
    if (index < 0) continue;
    donnees.especes[index] = { ...effectifServeur };
    confiances[`especes.${effectifServeur.espece}`] = 'moyenne';
    lus += 1;
  }

  for (const vaccinServeur of c.vaccinations ?? []) {
    const index = donnees.vaccinations.findIndex((v) => v.maladie === vaccinServeur.maladie);
    if (index < 0) continue;
    if (vaccinServeur.date_vaccination) {
      const dateLue = normaliserDate(vaccinServeur.date_vaccination) ?? new Date().toISOString().slice(0, 10);
      donnees.vaccinations[index].date_vaccination = dateLue;
      confiances[`vaccinations.${vaccinServeur.maladie}`] = 'moyenne';
      lus += 1;
    }
    if (vaccinServeur.lieu) {
      donnees.vaccinations[index].lieu = vaccinServeur.lieu;
      confiances[`vaccinations.${vaccinServeur.maladie}.lieu`] = 'moyenne';
      lus += 1;
    }
  }

  return { donnees, confiances, nombreChampsLus: lus, nombreMots: 0, texteBrut: '', champsDetectes: [], capturesDiagnostic: [], pointsMarqueurs: [] };
}

export interface MotCloud {
  texte: string;
  x_min: number;
  x_max: number;
  y_min: number;
  y_max: number;
}

/** Concatène, dans l'ordre horizontal, les mots dont le CENTRE tombe dans
 * la zone donnée — un mot à cheval sur la frontière (rare) est affecté à
 * la zone qui contient son centre, jamais compté deux fois ni perdu. */
function texteDansZone(mots: MotCloud[], zone: ZonePixels): string {
  const correspondants = mots.filter((m) => {
    const cx = (m.x_min + m.x_max) / 2;
    const cy = (m.y_min + m.y_max) / 2;
    return cx >= zone.x && cx <= zone.x + zone.largeur && cy >= zone.y && cy <= zone.y + zone.hauteur;
  });
  correspondants.sort((a, b) => a.x_min - b.x_min);
  return correspondants.map((m) => m.texte).join(' ').trim();
}

/**
 * Approche HYBRIDE (proposée par l'utilisateur) : NOTRE système de
 * position (marqueurs de coin + homographie, voir ./homographie.ts —
 * éprouvé précis, y compris sur une photo légèrement inclinée) détermine
 * OÙ se trouve chaque champ ; la LECTURE vient de Google Vision (voir
 * lib/sync.ts::reconnaitrePageCloud), bien supérieure à un moteur local
 * sur de l'écriture manuscrite.
 *
 * Remplace l'ancrage sur libellé imprimé (voir ocr_service.py côté
 * backend, conservé comme repli si aucun marqueur n'est détecté sur la
 * photo — carnet imprimé avant leur ajout au gabarit) : au lieu de
 * chercher "Nom et prénom" dans le texte reconnu puis deviner la valeur
 * juste en dessous, on sait déjà exactement où chercher, et on ne demande
 * à Google Vision QUE de lire ce qui s'y trouve.
 */
export async function assemblerChampsCloudPage3(
  mots: MotCloud[],
  canvasCouleur: HTMLCanvasElement,
  paysAgent: number | null,
): Promise<ResultatOcrPage3> {
  const cadre = detecterCadreVert(canvasCouleur);
  const marqueurs = cadre ? detecterMarqueurs(canvasCouleur, cadre) : null;
  const homographie = marqueurs ? calculerHomographie(marqueurs) : null;

  const donnees = page3Vide(paysAgent);
  const confiances: CarteConfiance = {};
  // Rectangles RÉELLEMENT utilisés pour filtrer les mots de Google Vision —
  // remplace, pour cette méthode, le diagnostic visuel conçu à l'origine
  // pour la détection par couleur (voir detectionCases.ts) : sans ça,
  // l'écran de diagnostic n'avait rien à montrer dès que le cloud
  // fonctionnait, laissant croire à tort qu'il n'y avait pas de diagnostic
  // possible pour cette méthode (confirmé en test réel).
  const champsDetectes: ChampDetecte[] = [];
  const enregistrerZone = (zonePixels: ZonePixels) => {
    champsDetectes.push({ x: zonePixels.x, y: zonePixels.y, largeur: zonePixels.largeur, hauteur: zonePixels.hauteur, bornesCases: [] });
  };
  // Points EXACTS des 4 marqueurs détectés — exposés séparément des zones
  // de champ (voir pointsMarqueurs sur le résultat) pour un affichage
  // visuel bien plus grand et distinct : un marqueur ne fait que 14px sur
  // une photo de plusieurs milliers de pixels de large, invisible s'il est
  // dessiné avec le même style discret qu'un rectangle de champ.
  const pointsMarqueurs = marqueurs
    ? [marqueurs.hautGauche, marqueurs.hautDroit, marqueurs.basGauche, marqueurs.basDroit]
    : [];
  let lus = 0;

  const roles: Array<['eleveur' | 'convoyeur', keyof typeof GABARIT_PAGE3.eleveur]> = [
    ['eleveur', 'nom_prenom'], ['eleveur', 'numero_cni'], ['eleveur', 'telephone'],
    ['convoyeur', 'nom_prenom'], ['convoyeur', 'numero_cni'], ['convoyeur', 'telephone'],
  ];
  for (const [role, cle] of roles) {
    const zonePixels = zoneGabaritEnPixels(GABARIT_PAGE3[role][cle], cadre, canvasCouleur, homographie);
    enregistrerZone(zonePixels);
    const texte = texteDansZone(mots, zonePixels);
    if (!texte) continue;
    const texteChamp = cle === 'telephone' ? nettoyerTelephone(texte) : texte;
    if (!texteChamp) continue;
    donnees[role][cle] = texteChamp;
    confiances[`${role}.${cle}`] = 'haute';
    lus += 1;
  }

  for (const cle of ['province_origine', 'province_destination'] as const) {
    const zonePixels = zoneGabaritEnPixels(GABARIT_PAGE3.itineraire[cle], cadre, canvasCouleur, homographie);
    enregistrerZone(zonePixels);
    const texte = texteDansZone(mots, zonePixels);
    if (!texte) continue;
    donnees.itineraire[cle] = texte;
    confiances[`itineraire.${cle}`] = 'haute';
    lus += 1;
  }

  for (const [cleZone, clePays, cleLocalite] of [
    ['origine_pays_localite', 'pays_origine_id', 'localite_origine'],
    ['destination_pays_localite', 'pays_destination_id', 'localite_destination'],
  ] as const) {
    const zonePixels = zoneGabaritEnPixels(GABARIT_PAGE3.itineraire[cleZone], cadre, canvasCouleur, homographie);
    enregistrerZone(zonePixels);
    const texte = texteDansZone(mots, zonePixels);
    if (!texte) continue;
    const correspondance = reconnaitrePays(texte);
    if (correspondance) {
      donnees.itineraire[clePays] = correspondance.pays.id;
      confiances[`itineraire.${clePays}`] = 'haute';
      lus += 1;
      const reste = texte.trim().slice(correspondance.longueurConsommee).trim();
      if (reste) {
        donnees.itineraire[cleLocalite] = reste;
        confiances[`itineraire.${cleLocalite}`] = 'haute';
        lus += 1;
      }
    } else {
      donnees.itineraire[cleLocalite] = texte;
      confiances[`itineraire.${cleLocalite}`] = 'haute';
      lus += 1;
    }
  }

  return {
    donnees,
    confiances,
    nombreChampsLus: lus,
    nombreMots: mots.length,
    texteBrut: mots.map((m) => m.texte).join(' ').slice(0, LONGUEUR_TEXTE_DIAGNOSTIC),
    champsDetectes,
    capturesDiagnostic: [],
    pointsMarqueurs,
  };
}

/** Voir assemblerChampsCloudPage3 — même principe pour la page 4. */
export async function assemblerChampsCloudPage4(mots: MotCloud[], canvasCouleur: HTMLCanvasElement): Promise<ResultatOcrPage4> {
  const cadre = detecterCadreVert(canvasCouleur);
  const marqueurs = cadre ? detecterMarqueurs(canvasCouleur, cadre) : null;
  const homographie = marqueurs ? calculerHomographie(marqueurs) : null;

  const donnees = page4Vide();
  const confiances: CarteConfiance = {};
  const champsDetectes: ChampDetecte[] = [];
  const enregistrerZone = (zonePixels: ZonePixels) => {
    champsDetectes.push({ x: zonePixels.x, y: zonePixels.y, largeur: zonePixels.largeur, hauteur: zonePixels.hauteur, bornesCases: [] });
  };
  const pointsMarqueurs = marqueurs
    ? [marqueurs.hautGauche, marqueurs.hautDroit, marqueurs.basGauche, marqueurs.basDroit]
    : [];
  let lus = 0;

  for (const maladie of Object.keys(GABARIT_PAGE4) as Array<keyof typeof GABARIT_PAGE4>) {
    const zones = GABARIT_PAGE4[maladie];

    const zoneDatePixels = zoneGabaritEnPixels(zones.date, cadre, canvasCouleur, homographie);
    enregistrerZone(zoneDatePixels);
    const texteDate = texteDansZone(mots, zoneDatePixels);
    const dateLue = texteDate ? normaliserDateCases(texteDate) : null;
    const date = dateLue ?? new Date().toISOString().slice(0, 10);
    const indexVaccination = donnees.vaccinations.findIndex((v) => v.maladie === maladie);
    if (indexVaccination >= 0) donnees.vaccinations[indexVaccination].date_vaccination = date;
    confiances[`vaccinations.${maladie}`] = dateLue ? 'haute' : 'basse';
    lus += 1;

    const zoneLieuPixels = zoneGabaritEnPixels(zones.lieu, cadre, canvasCouleur, homographie);
    enregistrerZone(zoneLieuPixels);
    const texteLieu = texteDansZone(mots, zoneLieuPixels);
    if (texteLieu && indexVaccination >= 0) {
      donnees.vaccinations[indexVaccination].lieu = texteLieu;
      confiances[`vaccinations.${maladie}.lieu`] = 'haute';
      lus += 1;
    }
  }

  return {
    donnees,
    confiances,
    nombreChampsLus: lus,
    nombreMots: mots.length,
    texteBrut: mots.map((m) => m.texte).join(' ').slice(0, LONGUEUR_TEXTE_DIAGNOSTIC),
    champsDetectes,
    capturesDiagnostic: [],
    pointsMarqueurs,
  };
}

/** Page 4 — effectifs par espèce et vaccinations. */
export async function lirePage4(photo: Blob): Promise<ResultatOcrPage4> {
  // (voir DETECTION_PERSPECTIVE_ACTIVE en tête de fichier : désactivé pour l'instant)
  const redresse = DETECTION_PERSPECTIVE_ACTIVE ? await redresserDocument(photo) : null;
  const source = redresse ?? photo;
  const canvasCouleur = await versCanvasCouleur(source);
  const cadre = canvasCouleur ? detecterCadreVert(canvasCouleur) : null;
  const marqueurs = canvasCouleur && cadre ? detecterMarqueurs(canvasCouleur, cadre) : null;
  const homographie = marqueurs ? calculerHomographie(marqueurs) : null;
  const champsDetectes = canvasCouleur ? detecterChamps(canvasCouleur) : [];
  const capturesDiagnostic: CaptureDiagnostic[] = [];
  const canvas = await pretraiterImage(source);
  const { mots, texte } = await reconnaitre(canvas);
  const lignes = regrouperEnLignes(mots);

  const donnees = page4Vide();
  const confiances: CarteConfiance = {};
  let lus = 0;

  for (const [motsCles, espece] of ANCRES_ESPECES) {
    const ancre = chercherAncres(lignes, motsCles)[0];
    if (!ancre) continue;

    // Le tableau se lit sur la MÊME ligne que le nom de l'espèce : on ne
    // retient que les cellules situées à droite du libellé.
    const nombres = lignes[ancre.ligneIndex]
      .filter((mot) => mot.xMin >= ancre.xMax - 4)
      .sort((a, b) => a.xMin - b.xMin)
      .map((mot) => ({ valeur: corrigerConfusionsChiffres(mot.texte).replace(/[^\d]/g, ''), confiance: mot.confiance }))
      .filter((cellule) => cellule.valeur.length > 0 && cellule.valeur.length <= 5);

    if (nombres.length < 3) continue;

    const effectif = lireEffectif(
      espece,
      nombres.map((n) => Number(n.valeur)),
    );
    if (!effectif) continue;

    const index = donnees.especes.findIndex((e) => e.espece === espece);
    if (index >= 0) donnees.especes[index] = effectif;
    const confiance = nombres.reduce((s, n) => s + n.confiance, 0) / nombres.length;
    confiances[`especes.${espece}`] = niveauDepuisScore(confiance);
    lus += 1;
  }

  // --- Vaccinations : gabarit à positions fixes (voir ./gabarit.ts) ---
  // Contrairement au tableau des effectifs (une grille classique, pas des
  // cases colorées individuelles), chaque bloc maladie a bien un fond de
  // case mesurable — Date ET Lieu sont donc lus directement par leur
  // position connue, ce que l'ancienne méthode ne faisait QUE pour la date
  // (le lieu, bien que présent dans le type de données depuis le début,
  // n'était en réalité jamais lu).
  for (const maladie of Object.keys(GABARIT_PAGE4) as Array<keyof typeof GABARIT_PAGE4>) {
    const zones = GABARIT_PAGE4[maladie];
    let dateLue: string | null = null;
    let confianceDate: number | null = null;

    if (canvasCouleur) {
      const valeurDate = await lireCaseParCase(
        canvasCouleur,
        zones.date,
        cadre,
        homographie,
        'chiffres',
        champsDetectes,
        `${maladie} — Date`,
        capturesDiagnostic,
      );
      if (valeurDate?.texte) {
        dateLue = normaliserDateCases(valeurDate.texte);
        if (dateLue) confianceDate = valeurDate.confiance;
      }
      const valeurLieu = await lireCaseParCase(
        canvasCouleur,
        zones.lieu,
        cadre,
        homographie,
        'lettres',
        champsDetectes,
        `${maladie} — Lieu`,
        capturesDiagnostic,
      );
      if (valeurLieu?.texte) {
        const index = donnees.vaccinations.findIndex((v) => v.maladie === maladie);
        if (index >= 0) donnees.vaccinations[index].lieu = valeurLieu.texte;
        confiances[`vaccinations.${maladie}.lieu`] = niveauDepuisScore(valeurLieu.confiance);
        lus += 1;
      }
    }

    // Repli pour la date uniquement si le gabarit fixe n'a rien donné —
    // l'ancrage par libellé reste un filet de sécurité valable pour ce
    // champ précis, déjà éprouvé.
    if (!dateLue) {
      const ancre = chercherAncres(lignes, ANCRES_MALADIES.find(([, m]) => m === maladie)?.[0] ?? [])[0];
      if (ancre) {
        const valeur = valeurDuChamp(lignes, ancre, 300);
        if (valeur) {
          dateLue = normaliserDate(valeur.texte);
          if (dateLue) confianceDate = valeur.confiance;
        }
      }
    }

    // Règle métier : le vétérinaire qui vaccine le troupeau est le même qui
    // émet le passeport, le même jour — la date de vaccination coïncide donc
    // presque toujours avec la date d'émission (le mois et l'année, en
    // particulier, quasiment sans exception). Une écriture manuscrite illisible
    // ou une case vide sur la photo ne doit donc pas laisser le champ vide :
    // la date du jour est une estimation nettement plus utile qu'une case
    // blanche, à confirmer ou corriger par l'agent comme n'importe quel autre
    // champ pré-rempli.
    const date = dateLue ?? new Date().toISOString().slice(0, 10);
    const index = donnees.vaccinations.findIndex((v) => v.maladie === maladie);
    if (index >= 0) donnees.vaccinations[index].date_vaccination = date;
    // Confiance "basse" pour une date déduite (pas lue) : l'agent doit la
    // parcourir avant de valider, même si la valeur affichée est déjà juste
    // dans l'immense majorité des cas.
    confiances[`vaccinations.${maladie}`] = dateLue && confianceDate !== null ? niveauDepuisScore(confianceDate) : 'basse';
    lus += 1;
  }

  return {
    donnees,
    confiances,
    nombreChampsLus: lus,
    nombreMots: mots.length,
    texteBrut: texte.slice(0, LONGUEUR_TEXTE_DIAGNOSTIC),
    champsDetectes,
    capturesDiagnostic,
    pointsMarqueurs: [],
  };
}

/**
 * Le tableau papier a 5 colonnes numériques : Mâles, Femelles > Jeunes,
 * Femelles > Adultes, Femelles > Total, puis TOTAL général. En pratique
 * beaucoup d'agents laissent le sous-total « Femelles » vide et écrivent
 * directement le total général. Les deux cas sont traités explicitement :
 * prendre « les 4 premiers nombres » donnerait un total FAUX si les 5 colonnes
 * étaient un jour toutes remplies.
 */
function lireEffectif(espece: EspeceTroupeau, nombres: number[]): EffectifEspece | null {
  if (nombres.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (nombres.length < 3) return null;

  const [males, jeunes, adultes] = nombres;

  // Le total reste une donnée dérivée : la somme des colonnes fait foi, et
  // l'agent voit de toute façon un indice de confiance sur la ligne.
  const total = males + jeunes + adultes;
  if (total === 0) return null;

  return {
    espece,
    nombre_males: males,
    nombre_femelles_jeunes: jeunes,
    nombre_femelles_adultes: adultes,
    nombre_total: total,
  };
}

export function especesOrdonnees(): EspeceTroupeau[] {
  return ESPECES_PASSEPORT;
}

export function maladiesOrdonnees(): MaladieControlee[] {
  return MALADIES_CONTROLEES;
}