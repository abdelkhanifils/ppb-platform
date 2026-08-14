import { useCallback, useEffect, useState } from "react";
import { rafraichirClePublique } from "@/db/cacheClePublique";
import { compterControlesEnAttente, viderFileControles } from "@/db/queueControle";
import { synchroniserIndexVerification } from "@/db/syncVerification";

const INTERVALLE_REPLI_MS = 30_000;

/**
 * Synchronisation automatique du Module 5, déclenchée à la détection réseau —
 * jamais une action manuelle de l'agent (Document technique §3, M5 :
 * « Synchronisation automatique... L'application de contrôle récupère les
 * deux [identité et itinéraire] dès qu'elle détecte une connexion, sans
 * action de l'agent »).
 *
 * Trois volets synchronisés ensemble à chaque déclenchement :
 * 1. Descente — index de vérification (delta identité + itinéraire).
 * 2. Descente — clé publique (rarement modifiée, mais doit rester à jour).
 * 3. Montée — contrôles enregistrés hors-ligne, remontés vers le serveur.
 *
 * Même architecture que useSyncManager (Module 4) : écouteur `online` +
 * intervalle de repli pour les navigateurs où cet événement est peu fiable
 * (fréquent sur mobile) — fonctionne identiquement sur tous les navigateurs,
 * contrairement à la Background Sync API du Service Worker (absente sur
 * Safari/iOS), traitée ailleurs comme un pur accélérateur best-effort.
 */
export function useDeltaSync() {
  const [enLigne, setEnLigne] = useState(navigator.onLine);
  const [synchronisationEnCours, setSynchronisationEnCours] = useState(false);
  const [derniereErreur, setDerniereErreur] = useState<string | null>(null);
  const [controlesEnAttente, setControlesEnAttente] = useState(0);

  const synchroniser = useCallback(async () => {
    if (!navigator.onLine) return;
    setSynchronisationEnCours(true);
    try {
      await Promise.all([synchroniserIndexVerification(), rafraichirClePublique(), viderFileControles()]);
      setControlesEnAttente(await compterControlesEnAttente());
      setDerniereErreur(null);
    } catch {
      setDerniereErreur("Synchronisation incomplète — nouvel essai automatique sous peu.");
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
    void compterControlesEnAttente().then(setControlesEnAttente);

    return () => {
      window.removeEventListener("online", surConnexion);
      window.removeEventListener("offline", surDeconnexion);
      window.clearInterval(intervalle);
    };
  }, [synchroniser]);

  return { enLigne, synchronisationEnCours, derniereErreur, controlesEnAttente, synchroniserMaintenant: synchroniser };
}
