import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './styles/rtl.css';
import { loadRuntimeConfig } from './lib/config.ts';
import { chargerEtAppliquerBranding } from './lib/branding.ts';

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
