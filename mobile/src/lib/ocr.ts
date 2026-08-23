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
import { createWorker, type Worker } from 'tesseract.js';
import { creerBitmap } from './imagerie';
import { redresserDocument } from './perspective';
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
  // traitement double sur un téléphone d'entrée de gamme.
  const echelle = LARGEUR_CIBLE / Math.max(largeurSource, 1);
  const facteur = Math.min(2, Math.max(0.4, echelle));
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

  const TUILE = 40;
  const MARGE = 10; // évite de transformer le grain du papier en fausses lettres
  const CONTRASTE_MIN = 14; // écart-type en dessous duquel la tuile est « vide »

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

  const prefixe3 = texte.slice(0, 3);
  for (const pays of PAYS_CEMAC) {
    if (distance(prefixe3, pays.code_iso, 1) <= 1) {
      return { pays, longueurConsommee: 3 };
    }
  }

  const premierMot = texte.split(/\s+/)[0] ?? '';
  if (premierMot.length >= 4) {
    for (const pays of PAYS_CEMAC) {
      const debutNom = pays.nom.toUpperCase().slice(0, premierMot.length);
      if (distance(premierMot, debutNom, 2) <= 2) {
        return { pays, longueurConsommee: premierMot.length };
      }
    }
  }

  return null;
}

interface Ancre {
  ligneIndex: number;
  xMin: number;
  xMax: number;
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
 */
function chercherAncres(lignes: MotReconnu[][], motsCles: string[]): Ancre[] {
  const cles = motsCles.map(normaliser).filter(Boolean);
  const ancres: Ancre[] = [];

  lignes.forEach((ligne, index) => {
    for (const mot of ligne) {
      const lu = normaliser(mot.texte);
      if (!lu) continue;
      if (cles.some((cle) => correspond(lu, cle))) {
        ancres.push({ ligneIndex: index, xMin: mot.xMin, xMax: mot.xMax });
        break; // une seule ancre par ligne : le libellé ne se répète pas
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
export interface DiagnosticOcr {
  /** Nombre de mots que l'OCR a réellement isolés sur la photo. */
  nombreMots: number;
  /** Texte brut reconnu, tronqué — preuve visible que le moteur a fonctionné. */
  texteBrut: string;
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

/** Page 3 — propriétaire, convoyeur et trajet déclaré. */
export async function lirePage3(photo: Blob, paysAgent: number | null): Promise<ResultatOcrPage3> {
  // Repli silencieux intégré à redresserDocument : `redresse` vaut `null` si
  // la détection échoue pour n'importe quelle raison, et on lit alors la
  // photo brute exactement comme avant ce module — jamais de blocage.
  const redresse = await redresserDocument(photo);
  const canvas = await pretraiterImage(redresse ?? photo);
  const { mots, texte } = await reconnaitre(canvas);
  const lignes = regrouperEnLignes(mots);

  const donnees = page3Vide(paysAgent);
  const confiances: CarteConfiance = {};
  let lus = 0;

  for (const { cle, motsCles } of ANCRES_PERSONNE) {
    const ancres = chercherAncres(lignes, motsCles);
    // Ordre de lecture du gabarit : propriétaire d'abord, convoyeur ensuite.
    const roles: Array<'eleveur' | 'convoyeur'> = ['eleveur', 'convoyeur'];
    roles.forEach((role, index) => {
      const ancre = ancres[index];
      if (!ancre) return;
      const valeur = valeurDuChamp(lignes, ancre);
      if (!valeur) return;
      const texteChamp = cle === 'telephone' ? nettoyerTelephone(valeur.texte) : valeur.texte;
      if (!texteChamp) return;
      donnees[role][cle] = texteChamp;
      confiances[`${role}.${cle}`] = niveauDepuisScore(valeur.confiance);
      lus += 1;
    });
  }

  for (const { cle, motsCles, rang } of ANCRES_ITINERAIRE) {
    const ancre = chercherAncres(lignes, motsCles)[rang];
    if (!ancre) continue;
    const valeur = valeurDuChamp(lignes, ancre);
    if (!valeur || !valeur.texte) continue;
    donnees.itineraire[cle] = valeur.texte;
    confiances[`itineraire.${cle}`] = niveauDepuisScore(valeur.confiance);
    lus += 1;
  }

  for (const { clePays, cleLocalite, rang } of ANCRES_PAYS) {
    const ancre = chercherAncres(lignes, ['pays'])[rang];
    if (!ancre) continue;
    const valeur = valeurDuChamp(lignes, ancre);
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
      // Aucun pays reconnu avec confiance suffisante : on garde tout le
      // texte comme localité — au moins aussi bon que le comportement
      // d'avant cette reconnaissance (pays_origine_id reste sur son défaut,
      // l'agent le corrige au besoin dans le sélecteur déjà existant).
      donnees.itineraire[cleLocalite] = valeur.texte;
      confiances[`itineraire.${cleLocalite}`] = niveauDepuisScore(valeur.confiance);
      lus += 1;
    }
  }

  return {
    donnees,
    confiances,
    nombreChampsLus: lus,
    nombreMots: mots.length,
    texteBrut: texte.slice(0, LONGUEUR_TEXTE_DIAGNOSTIC),
  };
}

/** Page 4 — effectifs par espèce et vaccinations. */
export async function lirePage4(photo: Blob): Promise<ResultatOcrPage4> {
  const redresse = await redresserDocument(photo);
  const canvas = await pretraiterImage(redresse ?? photo);
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

  for (const [motsCles, maladie] of ANCRES_MALADIES) {
    const ancre = chercherAncres(lignes, motsCles)[0];
    if (!ancre) continue;
    const valeur = valeurDuChamp(lignes, ancre, 300);
    const dateLue = valeur ? normaliserDate(valeur.texte) : null;
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
    confiances[`vaccinations.${maladie}`] = dateLue && valeur ? niveauDepuisScore(valeur.confiance) : 'basse';
    lus += 1;
  }

  return {
    donnees,
    confiances,
    nombreChampsLus: lus,
    nombreMots: mots.length,
    texteBrut: texte.slice(0, LONGUEUR_TEXTE_DIAGNOSTIC),
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