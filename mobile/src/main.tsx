import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './styles/rtl.css';
import { loadRuntimeConfig } from './lib/config.ts';
import { chargerEtAppliquerBranding, urlManifesteDynamique } from './lib/branding.ts';

/** Remplace le <link rel="manifest"> — pointant par défaut vers le
 * manifeste STATIQUE généré à la construction (icône figée, tête de bœuf,
 * voir vite.config.ts) — par le manifeste DYNAMIQUE du backend, qui reflète
 * l'icône réellement uploadée via Administration > Apparence. Sans ce
 * remplacement, Android installe toujours l'icône intégrée à l'application,
 * quel que soit ce qui a été uploadé côté serveur — c'est le manifeste lié
 * dans le <head> au moment de l'installation qui fait foi, jamais un autre
 * consulté ensuite. Doit s'exécuter AVANT que l'utilisateur ne puisse
 * installer l'application, donc avant le premier rendu — voir
 * initializeApp() ci-dessous, appelé après loadRuntimeConfig() (l'URL de
 * l'API doit être connue en premier, voir sa propre docstring). Repli
 * silencieux sur le manifeste statique si cet appel échoue (hors-ligne à
 * la toute première visite, avant tout cache) : mieux vaut une icône par
 * défaut installable que pas d'installation possible du tout. */
function remplacerLienManifeste(): void {
  const lien = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (lien) lien.href = urlManifesteDynamique();
}

// Load runtime configuration before rendering the app
async function initializeApp() {
  // Prerendered blog pages are served as pure static HTML for SEO.
  // Intentionally skip React mounting so the crawler-facing markup stays
  // lightweight and self-contained — no client-side hydration needed.
  if (
    document
      .querySelector('meta[name="prerender-static-page"]')
      ?.getAttribute('content') === 'blog'
  ) {
    return;
  }

  try {
    await loadRuntimeConfig();
    console.log('Runtime configuration loaded successfully');
  } catch (error) {
    console.warn(
      'Failed to load runtime configuration, using defaults:',
      error
    );
  }

  remplacerLienManifeste();

  // Attendu (contrairement à avant) avant le premier rendu, pour éviter
  // exactement le défaut initialement accepté ici : le logo par défaut
  // s'affichait un court instant à l'ouverture de l'app, avant d'être
  // remplacé par le logo personnalisé dès que /branding répondait — un
  // battement visuel gênant à l'usage réel, remonté après coup. Après
  // loadRuntimeConfig() ci-dessus, pas en parallèle : chargerEtAppliquerBranding()
  // s'appuie sur l'URL d'API que loadRuntimeConfig() détermine, un ordre
  // différent risquerait de cibler le mauvais serveur. Délai plafonné à
  // 1,5s : au-delà (réseau très lent ou hors-ligne), on abandonne l'attente
  // et on rend l'app avec l'apparence par défaut plutôt que de la bloquer
  // indéfiniment — le battement redevient alors possible dans ce cas
  // précis, mais seulement dans ce cas, nettement plus rare que le
  // chargement normal.
  const delaiMaximal = new Promise<void>((resoudre) => setTimeout(resoudre, 1500));
  await Promise.race([chargerEtAppliquerBranding(), delaiMaximal]);

  // Render the app
  createRoot(document.getElementById('root')!).render(<App />);
}

// Initialize the app
initializeApp();
