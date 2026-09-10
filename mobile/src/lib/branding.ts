/**
 * Identité visuelle de la plateforme (module Personnalisation), zone
 * "emission" — consommée côté application mobile terrain. Miroir de
 * frontend/src/lib/branding.ts (Web Admin) — même backend
 * (GET/PATCH /branding?zone=emission), même comportement de repli
 * silencieux si le réseau est indisponible : un agent hors-ligne garde
 * l'apparence par défaut, jamais un écran bloqué pour une question
 * d'esthétique.
 *
 * Toujours la zone "emission" ici, sans bascule par route : il n'existe
 * PAS d'écran de contrôle frontière dans cette application mobile à ce jour
 * (vérifié dans App.tsx — seules les routes /, /emission et /emission/:id
 * existent) ; la zone "controle" (voir ZONES_VALIDES côté backend) n'a donc
 * pour l'instant de contrepartie que côté Web Admin
 * (frontend/src/pages/ControleFrontiere.tsx). Si un écran de contrôle
 * frontière est ajouté un jour à cette application, appliquer la zone
 * "controle" spécifiquement sur ses routes, sur le modèle de
 * frontend/src/lib/branding.ts::zonePourChemin.
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
const ZONE = 'emission';

export interface Branding {
  nom_application: string;
  couleur_primaire: string;
  couleur_primaire_claire: string;
  a_logo: boolean;
  a_icone: boolean;
  version: number;
  zone: string;
}

let brandingCourant: Branding | null = null;
const ecouteurs = new Set<(b: Branding) => void>();

export function brandingActuel(): Branding | null {
  return brandingCourant;
}

function urlBranding(chemin: string): string {
  const separateur = chemin.includes('?') ? '&' : '?';
  return `${apiBaseUrlCourante()}${PREFIXE}/branding${chemin}${separateur}zone=${ZONE}`;
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

function definirOuCreerLien(rel: string): HTMLLinkElement {
  let lien = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!lien) {
    lien = document.createElement('link');
    lien.rel = rel;
    document.head.appendChild(lien);
  }
  return lien;
}

function appliquer(branding: Branding): void {
  const hslPrimaire = hexVersHsl(branding.couleur_primaire);
  if (hslPrimaire) {
    document.documentElement.style.setProperty('--primary', hslPrimaire);
    document.documentElement.style.setProperty('--sidebar-primary', hslPrimaire);
    document.documentElement.style.setProperty('--ring', hslPrimaire);
  }

  document.title = branding.nom_application;

  // Icône (favicon + PWA "Ajouter à l'écran d'accueil") DÉSORMAIS appliquée
  // ici — un ancien commentaire à cet endroit expliquait pourquoi elle ne
  // l'était volontairement PAS : à l'époque, une seule personnalisation
  // partagée entre web et mobile aurait fait que les deux applications
  // affichent la même icône dès qu'une seule était personnalisée. Cette
  // raison ne tient plus depuis l'introduction des 3 zones indépendantes
  // (voir backend/app/models/branding.py::ZONES_VALIDES) : la zone
  // "emission" est désormais dédiée à cette application mobile seule,
  // aucun risque de contamination avec le web. `urlBranding` (voir
  // ci-dessus) inclut déjà `?zone=emission` sur toutes ses URLs — pas de
  // risque non plus de pointer vers l'icône d'une autre zone par erreur.
  if (branding.a_icone) {
    const icone = urlBranding(`/icone?v=${branding.version}`);
    definirOuCreerLien('icon').href = icone;
    definirOuCreerLien('apple-touch-icon').href = icone;
  }
  definirOuCreerLien('manifest').href = urlBranding('/manifest.webmanifest');
}

const CLE_BRANDING_LOCAL = 'ppb_branding_v1';

function lireBrandingPersiste(): Branding | null {
  try {
    const brut = localStorage.getItem(CLE_BRANDING_LOCAL);
    return brut ? (JSON.parse(brut) as Branding) : null;
  } catch {
    return null;
  }
}

function persisterBranding(branding: Branding): void {
  try {
    localStorage.setItem(CLE_BRANDING_LOCAL, JSON.stringify(branding));
  } catch {
    // Stockage plein/indisponible (navigation privée...) — dégradation sans
    // conséquence grave : juste un retour au logo par défaut au prochain
    // démarrage hors-ligne, jamais un blocage de l'application pour autant.
  }
}

/** À appeler une fois, au démarrage de l'application (main.tsx), avant ou
 * en parallèle du premier rendu.
 *
 * Applique D'ABORD la dernière personnalisation connue, PERSISTÉE localement
 * (localStorage) lors d'un chargement en ligne précédent — sans ça, même
 * avec le logo lui-même mis en cache par le service worker (voir
 * vite.config.ts, règle "ppb-branding"), un démarrage hors-ligne ne pouvait
 * JAMAIS savoir qu'une personnalisation existait : `brandingCourant` repart
 * à `null` à chaque redémarrage (simple variable JS, jamais persistée en
 * elle-même), la requête réseau pour le SAVOIR échoue hors-ligne, et
 * urlLogoActuel() retombait alors systématiquement sur le logo par défaut,
 * même après un usage en ligne antérieur — cause réelle du bug signalé.
 *
 * Tente ENSUITE la requête réseau, pour rafraîchir avec la version la plus
 * récente si elle a changé depuis — reste silencieuse en cas d'échec
 * (hors-ligne), l'application ayant déjà la dernière version connue
 * appliquée par l'étape précédente. */
export async function chargerEtAppliquerBranding(): Promise<void> {
  const persiste = lireBrandingPersiste();
  if (persiste) {
    brandingCourant = persiste;
    appliquer(persiste);
    for (const ecouteur of ecouteurs) ecouteur(persiste);
  }

  try {
    const reponse = await fetch(urlBranding(''));
    if (!reponse.ok) return;
    const data: Branding = await reponse.json();
    brandingCourant = data;
    persisterBranding(data);
    appliquer(data);
    for (const ecouteur of ecouteurs) ecouteur(data);
  } catch {
    // Repli silencieux — voir docstring ci-dessus : la version persistée,
    // si elle existe, reste déjà appliquée.
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
