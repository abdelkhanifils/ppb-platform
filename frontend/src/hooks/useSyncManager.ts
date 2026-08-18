import { useCallback, useEffect, useState } from "react";
import { listerEntreesEnEchec, viderFile } from "@/db/queueEmission";
import { traiterFileOcr } from "@/db/cacheOcr";
import type { EntreeFileSynchronisation } from "@/db/schema";

const INTERVALLE_REPLI_MS = 30_000;

/**
 * Filet de sécurité universel de synchronisation — fonctionne identiquement
 * sur tous les navigateurs (contrairement à la Background Sync API du
 * Service Worker, absente sur Safari/iOS ; voir src/sw.ts). Tant que l'app
 * est ouverte :
 * - un écouteur `online` déclenche une vidange immédiate de la file ;
 * - un intervalle de repli revide la file toutes les 30 secondes, pour les
 *   navigateurs où l'événement `online` est peu fiable (courant sur mobile).
 *
 * Ce hook ne fait la synchronisation QUE quand l'app a un composant monté
 * qui l'utilise (typiquement au niveau du layout de l'app d'émission) — la
 * synchronisation app-fermée reste du ressort du Service Worker (best-effort).
 */
export function useSyncManager() {
  const [enLigne, setEnLigne] = useState(navigator.onLine);
  const [synchronisationEnCours, setSynchronisationEnCours] = useState(false);
  const [entreesEnEchec, setEntreesEnEchec] = useState<EntreeFileSynchronisation[]>([]);

  const synchroniser = useCallback(async () => {
    if (!navigator.onLine) return;
    setSynchronisationEnCours(true);
    try {
      await viderFile();
      setEntreesEnEchec(await listerEntreesEnEchec());
      await traiterFileOcr(); // photos OCR en attente — indépendant de la file de pages, jamais bloquant pour elle
    } finally {
      setSynchronisationEnCours(false);
    }
  }, []);

  useEffect(() => {
    const surConnexion = () => {
      setEnLigne(true);
      void synchroniser();
    };
    const surDeconnexion = () => setEnLigne(false);

    window.addEventListener("online", surConnexion);
    window.addEventListener("offline", surDeconnexion);

    const intervalle = window.setInterval(() => void synchroniser(), INTERVALLE_REPLI_MS);

    void synchroniser(); // tentative dès le montage

    return () => {
      window.removeEventListener("online", surConnexion);
      window.removeEventListener("offline", surDeconnexion);
      window.clearInterval(intervalle);
    };
  }, [synchroniser]);

  return { enLigne, synchronisationEnCours, entreesEnEchec, synchroniserMaintenant: synchroniser };
}
