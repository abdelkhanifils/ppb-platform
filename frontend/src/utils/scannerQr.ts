/**
 * Configuration partagée des deux scanners QR de la plateforme (Module 4 —
 * Page2ScanQR, Module 5 — ScannerControle). Le cadre de visée (`qrbox`) est
 * calculé à partir de la taille RÉELLE du flux caméra affiché, plutôt que
 * fixé en dur (ex. 250x250 px) : sur un petit écran, une taille fixe peut
 * dépasser la zone visible ou mal correspondre au flux vidéo réel — obligeant
 * l'utilisateur à repositionner son téléphone pour recadrer manuellement.
 * html5-qrcode accepte une fonction ici précisément pour ce cas — voir sa
 * documentation officielle sur `qrbox` en callback.
 */
export function qrboxAdaptatif(largeurVue: number, hauteurVue: number): { width: number; height: number } {
  const cote = Math.floor(Math.min(largeurVue, hauteurVue) * 0.7);
  const taille = Math.max(180, Math.min(cote, 320)); // bornes raisonnables, jamais trop petit ni trop grand
  return { width: taille, height: taille };
}

export const CONFIG_SCANNER_QR = {
  fps: 10,
  qrbox: qrboxAdaptatif,
  aspectRatio: 1.0, // flux vidéo carré — évite les bandes noires/étirements selon les téléphones
};
