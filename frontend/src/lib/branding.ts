import { useEffect, useState } from "react";
import { apiClient } from "@/api/client";

// Miroir de backend/app/schemas/branding.py::BrandingOut
export interface Branding {
  nom_application: string;
  couleur_primaire: string;
  couleur_primaire_claire: string;
  a_logo: boolean;
  a_icone: boolean;
  version: number;
}

let brandingCourant: Branding | null = null;

export function brandingActuel(): Branding | null {
  return brandingCourant;
}

function urlLogo(version: number): string {
  return `${apiClient.defaults.baseURL}/branding/logo?v=${version}`;
}

function urlIcone(version: number): string {
  return `${apiClient.defaults.baseURL}/branding/icone?v=${version}`;
}

function definirOuCreerLien(rel: string): HTMLLinkElement {
  let lien = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!lien) {
    lien = document.createElement("link");
    lien.rel = rel;
    document.head.appendChild(lien);
  }
  return lien;
}

function appliquer(branding: Branding): void {
  // Couleurs — les fichiers tailwind.config de cette app référencent ces
  // variables CSS (voir "cebevirha": "var(--couleur-primaire, #0f5132)"),
  // donc TOUTES les classes déjà utilisées dans le code (bg-cebevirha,
  // text-cebevirha, ...) suivent automatiquement, sans modifier chaque
  // usage un par un.
  document.documentElement.style.setProperty("--couleur-primaire", branding.couleur_primaire);
  document.documentElement.style.setProperty("--couleur-primaire-claire", branding.couleur_primaire_claire);

  document.title = branding.nom_application;

  if (branding.a_icone) {
    const icone = urlIcone(branding.version);
    definirOuCreerLien("icon").href = icone;
    definirOuCreerLien("apple-touch-icon").href = icone;
  }

  // Manifest PWA généré dynamiquement côté serveur (voir
  // GET /branding/manifest.webmanifest) — remplace tout manifest statique :
  // l'icône et le nom déclarés suivent le Super Admin sans reconstruction.
  definirOuCreerLien("manifest").href = `${apiClient.defaults.baseURL}/branding/manifest.webmanifest`;
}

/**
 * À appeler une fois, au démarrage de l'application (main.tsx). Échec
 * silencieux (hors-ligne, backend indisponible) : les couleurs par défaut
 * déjà présentes dans tailwind.config s'appliquent alors, exactement comme
 * avant l'existence de ce module — jamais un écran bloqué pour une question
 * d'apparence.
 */
export async function chargerEtAppliquerBranding(): Promise<void> {
  try {
    const { data } = await apiClient.get<Branding>("/branding");
    brandingCourant = data;
    appliquer(data);
    for (const ecouteur of ecouteurs) ecouteur(data);
  } catch {
    // Repli silencieux — voir docstring ci-dessus.
  }
}

const ecouteurs = new Set<(b: Branding) => void>();

/** Hook réactif pour un composant affichant le logo ou le nom (Connexion,
 * en-tête...) : `chargerEtAppliquerBranding` s'exécute une seule fois au
 * démarrage (main.tsx), potentiellement avant le premier rendu de ces
 * composants — un simple accès à `brandingActuel()` risquerait donc de
 * rater la mise à jour. Ce hook s'abonne pour re-rendre dès que la réponse
 * arrive, même si elle arrive après le montage du composant. */
export function useBranding(): Branding | null {
  const [branding, setBranding] = useState<Branding | null>(brandingCourant);
  useEffect(() => {
    if (brandingCourant) {
      setBranding(brandingCourant);
      return;
    }
    ecouteurs.add(setBranding);
    return () => {
      ecouteurs.delete(setBranding);
    };
  }, []);
  return branding;
}

/** URL du logo à afficher dans l'UI (Connexion, en-tête...) — `null` tant
 * qu'aucun logo n'a été configuré, pour permettre à l'appelant un repli. */
export function urlLogoActuel(): string | null {
  return brandingCourant?.a_logo ? urlLogo(brandingCourant.version) : null;
}
