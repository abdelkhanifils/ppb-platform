/**
 * Identité visuelle globale de la plateforme (module Personnalisation),
 * consommée côté application mobile terrain. Miroir de
 * frontend/src/lib/branding.ts (Web Admin) — même backend
 * (GET/PATCH /branding), même comportement de repli silencieux si le
 * réseau est indisponible : un agent hors-ligne garde l'apparence par
 * défaut, jamais un écran bloqué pour une question d'esthétique.
 *
 * Différence avec le Web Admin : ce thème utilise des variables HSL
 * (shadcn/ui — voir src/index.css, ex. `--primary: 12 62% 38%`), pas des
 * couleurs hexadécimales directes. `hexVersHsl` convertit la couleur reçue
 * du backend (format `#RRGGBB`) vers le triplet `H S% L%` attendu par ces
 * variables.
 */
import { useEffect, useState } from 'react';
import { apiBaseUrlCourante } from './i18n';

const PREFIXE = '/api/v1';

export interface Branding {
  nom_application: string;
  couleur_primaire: string;
  couleur_primaire_claire: string;
  a_logo: boolean;
  a_icone: boolean;
  version: number;
}

let brandingCourant: Branding | null = null;
const ecouteurs = new Set<(b: Branding) => void>();

export function brandingActuel(): Branding | null {
  return brandingCourant;
}

function urlBranding(chemin: string): string {
  return `${apiBaseUrlCourante()}${PREFIXE}/branding${chemin}`;
}

export function urlLogoActuel(): string | null {
  return brandingCourant?.a_logo ? urlBranding(`/logo?v=${brandingCourant.version}`) : null;
}

function hexVersHsl(hex: string): string | null {
  const correspondance = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!correspondance) return null;
  const entier = parseInt(correspondance[1], 16);
  const r = ((entier >> 16) & 255) / 255;
  const g = ((entier >> 8) & 255) / 255;
  const b = (entier & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const delta = max - min;
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / delta + (g < b ? 6 : 0)) * 60;
        break;
      case g:
        h = ((b - r) / delta + 2) * 60;
        break;
      default:
        h = ((r - g) / delta + 4) * 60;
    }
  }
  return `${h.toFixed(1)} ${(s * 100).toFixed(0)}% ${(l * 100).toFixed(0)}%`;
}

function appliquer(branding: Branding): void {
  const hslPrimaire = hexVersHsl(branding.couleur_primaire);
  if (hslPrimaire) {
    document.documentElement.style.setProperty('--primary', hslPrimaire);
    document.documentElement.style.setProperty('--sidebar-primary', hslPrimaire);
    document.documentElement.style.setProperty('--ring', hslPrimaire);
  }

  document.title = branding.nom_application;

  // Volontairement AUCUN écrasement de l'icône/favicon/manifest ici,
  // contrairement au frontend Web Admin. L'icône personnalisée
  // (Administration → Apparence) est stockée dans une table PARTAGÉE côté
  // backend, utilisée par les deux applications — l'appliquer aveuglément
  // ici ferait que mobile et frontend affichent la même image d'onglet dès
  // qu'un Super Admin personnalise l'une des deux, ce qui est précisément
  // ce qu'on veut éviter : chaque application garde sa propre identité
  // d'icône (celle intégrée au build, voir vite.config.ts — tête de bœuf),
  // même si les couleurs d'interface, elles, restent partagées ci-dessus.
}

/** À appeler une fois, au démarrage de l'application (main.tsx), avant ou
 * en parallèle du premier rendu — voir docstring du module pour le repli
 * silencieux en cas d'échec réseau. */
export async function chargerEtAppliquerBranding(): Promise<void> {
  try {
    const reponse = await fetch(urlBranding(''));
    if (!reponse.ok) return;
    const data: Branding = await reponse.json();
    brandingCourant = data;
    appliquer(data);
    for (const ecouteur of ecouteurs) ecouteur(data);
  } catch {
    // Repli silencieux — voir docstring ci-dessus.
  }
}

/** Hook réactif — voir frontend/src/lib/branding.ts::useBranding pour la
 * raison d'être (un composant peut se monter avant que le chargement initial
 * ne soit résolu). */
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
