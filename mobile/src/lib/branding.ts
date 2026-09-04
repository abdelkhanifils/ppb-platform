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
