import { useEffect, useState } from "react";

/** Écoute l'événement `ppb:maj-disponible` (voir main.tsx) et laisse l'agent
 * choisir le moment d'appliquer la mise à jour — jamais de rechargement forcé
 * pendant une saisie terrain en cours (voir la justification dans src/sw.ts). */
export default function BandeauMiseAJour() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const surEvenement = () => setVisible(true);
    window.addEventListener("ppb:maj-disponible", surEvenement);
    return () => window.removeEventListener("ppb:maj-disponible", surEvenement);
  }, []);

  if (!visible) return null;

  const appliquer = () => {
    const fn = (window as unknown as { __ppbAppliquerMiseAJour?: () => Promise<void> }).__ppbAppliquerMiseAJour;
    void fn?.();
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-between gap-3 bg-cebevirha px-4 py-3 text-sm text-white">
      <span>Une nouvelle version de l'application est disponible.</span>
      <button onClick={appliquer} className="rounded-md bg-white/20 px-3 py-1.5 font-medium hover:bg-white/30">
        Mettre à jour
      </button>
    </div>
  );
}
