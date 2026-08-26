/**
 * Contrôle d'alignement EN DIRECT, pendant l'aperçu caméra.
 *
 * Repose en priorité sur les 4 marqueurs de coin imprimés sur le gabarit
 * (voir ./homographie.ts et backend/app/services/pdf_passeport.py::
 * _fond_page) — un carré noir plein est un repère net, sans ambiguïté avec
 * le fond de page, contrairement à une simple couleur (confondue à tort
 * avec le papier sous certains éclairages, confirmé en test réel). Repli
 * sur un contrôle de couleur plus approximatif pour les carnets déjà
 * imprimés avant l'ajout de ces marqueurs.
 *
 * Reste volontairement léger : recherche LOCALISÉE des 4 marqueurs (jamais
 * une analyse de l'image entière), à un rythme mesuré (quelques fois par
 * seconde, jamais à chaque image vidéo) — une vraie détection de contours
 * en continu (Canny + OpenCV) a déjà bloqué l'écran de capture plus de 60
 * secondes sur un téléphone d'entrée de gamme lors d'une analyse UNIQUE,
 * ponctuelle (voir ocr.ts::DETECTION_PERSPECTIVE_ACTIVE, désactivé pour
 * cette raison) — l'exécuter en continu aurait un risque au moins aussi
 * élevé. Cette approche reste structurellement à l'abri de ce risque : la
 * recherche de marqueurs ne traite jamais que 4 petites fenêtres, jamais
 * l'image entière.
 */
import { COULEUR_CADRE_VERT, COULEUR_FOND_CASE, COULEUR_BORD_CASE, distanceCouleur } from './detectionCases';
import { detecterMarqueurs } from './homographie';

export interface ZoneVideo {
  x: number;
  y: number;
  largeur: number;
  hauteur: number;
}

export interface ResultatAlignement {
  alignementBon: boolean;
  proportionVertPerimetre: number;
  proportionContenu: number;
  /** true si les 4 marqueurs de coin ont été trouvés — signal fort, prime
   * sur le contrôle de couleur quand disponible. */
  marqueursTrouves: boolean;
}

const SEUIL_VERT_PERIMETRE = 0.08;
const SEUIL_CONTENU = 0.1;
const LARGEUR_ECHANTILLON = 160;
/** Échantillon plus grand, dédié à la recherche de marqueurs : un carré de
 * 2,2mm sur une page de 148mm doit rester assez net pour être repéré de
 * façon fiable (quelques pixels par côté à 160px de large serait trop
 * imprécis) — reste néanmoins minime comparé à la photo finale. */
const LARGEUR_ECHANTILLON_MARQUEURS = 480;

/** Vérifie la présence des 4 marqueurs de coin dans la zone du cadre-guide
 * — repli silencieux (false) sur toute erreur ou absence, jamais un blocage. */
function verifierMarqueurs(video: HTMLVideoElement, zone: ZoneVideo): boolean {
  if (zone.largeur <= 0 || zone.hauteur <= 0) return false;
  const echelle = LARGEUR_ECHANTILLON_MARQUEURS / zone.largeur;
  const hauteurEchantillon = Math.max(1, Math.round(zone.hauteur * echelle));

  const canvas = document.createElement('canvas');
  canvas.width = LARGEUR_ECHANTILLON_MARQUEURS;
  canvas.height = hauteurEchantillon;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;

  try {
    ctx.drawImage(video, zone.x, zone.y, zone.largeur, zone.hauteur, 0, 0, canvas.width, canvas.height);
  } catch {
    return false;
  }

  // Le cadre-guide EST l'estimation de la zone du cadre vert ici (l'agent
  // aligne visuellement le document dessus) — les 4 coins de l'échantillon
  // servent donc directement de point de départ pour la recherche localisée.
  const marqueurs = detecterMarqueurs(canvas, { x: 0, y: 0, largeur: canvas.width, hauteur: canvas.height });
  return marqueurs !== null;
}

/**
 * Échantillonne la zone vidéo (coordonnées PIXELS NATIFS de la vidéo, pas
 * coordonnées écran) correspondant au cadre-guide, et classe les couleurs
 * rencontrées. Retourne un repli "non aligné" (jamais une exception) sur
 * toute erreur — un souci ici ne doit jamais interrompre l'aperçu caméra,
 * seulement priver l'agent de la capture automatique (il garde toujours la
 * capture manuelle).
 */
export function verifierAlignement(video: HTMLVideoElement, zone: ZoneVideo): ResultatAlignement {
  const repli: ResultatAlignement = {
    alignementBon: false,
    proportionVertPerimetre: 0,
    proportionContenu: 0,
    marqueursTrouves: false,
  };
  if (zone.largeur <= 0 || zone.hauteur <= 0) return repli;

  // Priorité aux marqueurs de coin — signal net, sans ambiguïté. Un carnet
  // imprimé avant leur ajout au gabarit n'en montrera jamais : repli
  // silencieux sur le contrôle de couleur juste en dessous.
  if (verifierMarqueurs(video, zone)) {
    return { alignementBon: true, proportionVertPerimetre: 1, proportionContenu: 1, marqueursTrouves: true };
  }

  const echelle = LARGEUR_ECHANTILLON / zone.largeur;
  const hauteurEchantillon = Math.max(1, Math.round(zone.hauteur * echelle));

  const canvas = document.createElement('canvas');
  canvas.width = LARGEUR_ECHANTILLON;
  canvas.height = hauteurEchantillon;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return repli;

  try {
    ctx.drawImage(video, zone.x, zone.y, zone.largeur, zone.hauteur, 0, 0, LARGEUR_ECHANTILLON, hauteurEchantillon);
  } catch {
    return repli;
  }

  let image: ImageData;
  try {
    image = ctx.getImageData(0, 0, LARGEUR_ECHANTILLON, hauteurEchantillon);
  } catch {
    return repli;
  }
  const data = image.data;
  const L = LARGEUR_ECHANTILLON;
  const H = hauteurEchantillon;

  const estVert = (i: number) =>
    distanceCouleur({ r: data[i], g: data[i + 1], b: data[i + 2] }, COULEUR_CADRE_VERT) <= 65;
  const estCaseOuVert = (i: number) => {
    const c = { r: data[i], g: data[i + 1], b: data[i + 2] };
    return distanceCouleur(c, COULEUR_FOND_CASE) <= 45 || distanceCouleur(c, COULEUR_BORD_CASE) <= 45 || estVert(i);
  };

  // Périmètre (bande de ~6% près de chaque bord) : c'est là que doit se
  // trouver le cadre vert imprimé si l'agent a bien aligné le document.
  // Intérieur : doit montrer du contenu imprimé (cases ou vert), pas un
  // aplat uniforme (fond vide, main, table).
  const marge = Math.round(Math.min(L, H) * 0.06);
  let comptePerimetre = 0;
  let totalPerimetre = 0;
  let compteContenu = 0;
  let totalContenu = 0;

  for (let y = 0; y < H; y += 3) {
    for (let x = 0; x < L; x += 3) {
      const i = (y * L + x) * 4;
      const surPerimetre = x < marge || x >= L - marge || y < marge || y >= H - marge;
      if (surPerimetre) {
        totalPerimetre += 1;
        if (estVert(i)) comptePerimetre += 1;
      } else {
        totalContenu += 1;
        if (estCaseOuVert(i)) compteContenu += 1;
      }
    }
  }

  const proportionVertPerimetre = totalPerimetre > 0 ? comptePerimetre / totalPerimetre : 0;
  const proportionContenu = totalContenu > 0 ? compteContenu / totalContenu : 0;

  return {
    alignementBon: proportionVertPerimetre >= SEUIL_VERT_PERIMETRE && proportionContenu >= SEUIL_CONTENU,
    proportionVertPerimetre,
    proportionContenu,
    marqueursTrouves: false,
  };
}
