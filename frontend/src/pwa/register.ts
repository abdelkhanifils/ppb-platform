// Enregistrement du Service Worker — voir src/sw.ts pour la justification de
// `registerType: "prompt"` (jamais de mise à jour forcée en session).
// `virtual:pwa-register` est généré par vite-plugin-pwa à la compilation.
import { registerSW } from "virtual:pwa-register";

export type RappelMiseAJourDisponible = () => void;

/**
 * Enregistre le Service Worker et retourne une fonction à appeler quand
 * l'agent choisit d'appliquer une mise à jour en attente (ex. depuis un
 * bandeau "Nouvelle version disponible" affiché par l'app). Tant que
 * l'agent n'a pas cliqué, l'ancienne version continue de tourner — aucune
 * saisie terrain en cours n'est jamais interrompue par une mise à jour.
 */
export function enregistrerServiceWorker(surMiseAJourDisponible: RappelMiseAJourDisponible): void {
  const appliquerMiseAJour = registerSW({
    immediate: true,
    onNeedRefresh() {
      surMiseAJourDisponible();
    },
    onOfflineReady() {
      // L'app shell est entièrement disponible hors-ligne — rien à faire,
      // mais un point d'extension utile pour un futur indicateur discret.
    },
  });

  // Exposé pour que le bandeau de mise à jour (UI) puisse déclencher le
  // rechargement au moment choisi par l'agent.
  (window as unknown as { __ppbAppliquerMiseAJour?: () => Promise<void> }).__ppbAppliquerMiseAJour = () =>
    appliquerMiseAJour(true);
}
