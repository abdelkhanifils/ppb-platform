/**
 * Contrôle d'alignement EN DIRECT, pendant l'aperçu caméra — version
 * volontairement allégée d'une détection de bordure complète.
 *
 * Une vraie détection des 4 coins (Canny + contours OpenCV) a déjà bloqué
 * l'écran de capture plus de 60 secondes sur un téléphone d'entrée de
 * gamme lors d'une analyse UNIQUE, ponctuelle (voir ocr.ts::
 * DETECTION_PERSPECTIVE_ACTIVE, désactivé pour cette raison). L'exécuter en
 * CONTINU, plusieurs fois par seconde, pendant que l'agent tient la
 * caméra — comme le ferait une vraie app de scan professionnelle — serait
 * un calcul encore plus lourd, en boucle, sur ce même type d'appareil déjà
 * en échec sur la version la plus légère : un risque jugé trop important.
 *
 * Ce module fait un compromis : au lieu de chercher la géométrie exacte de
 * la bordure, il échantillonne périodiquement une petite grille de points
 * dans la zone du cadre-guide et vérifie la présence des COULEURS
 * attendues (cadre vert institutionnel près des bords, cases crème/doré à
 * l'intérieur — voir ./detectionCases.ts) — un calcul très bon marché
 * (quelques centaines de lectures de pixels), sans commune mesure avec une
 * analyse de contours sur l'image entière.
 */
import { COULEUR_CADRE_VERT, COULEUR_FOND_CASE, COULEUR_BORD_CASE, distanceCouleur } from './detectionCases';

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
}

const SEUIL_VERT_PERIMETRE = 0.12;
const SEUIL_CONTENU = 0.15;
const LARGEUR_ECHANTILLON = 160;

/**
 * Échantillonne la zone vidéo (coordonnées PIXELS NATIFS de la vidéo, pas
 * coordonnées écran) correspondant au cadre-guide, et classe les couleurs
 * rencontrées. Retourne un repli "non aligné" (jamais une exception) sur
 * toute erreur — un souci ici ne doit jamais interrompre l'aperçu caméra,
 * seulement priver l'agent de la capture automatique (il garde toujours la
 * capture manuelle).
 */
export function verifierAlignement(video: HTMLVideoElement, zone: ZoneVideo): ResultatAlignement {
  const repli: ResultatAlignement = { alignementBon: false, proportionVertPerimetre: 0, proportionContenu: 0 };
  if (zone.largeur <= 0 || zone.hauteur <= 0) return repli;

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
    distanceCouleur({ r: data[i], g: data[i + 1], b: data[i + 2] }, COULEUR_CADRE_VERT) <= 45;
  const estCaseOuVert = (i: number) => {
    const c = { r: data[i], g: data[i + 1], b: data[i + 2] };
    return distanceCouleur(c, COULEUR_FOND_CASE) <= 32 || distanceCouleur(c, COULEUR_BORD_CASE) <= 32 || estVert(i);
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
  };
}
