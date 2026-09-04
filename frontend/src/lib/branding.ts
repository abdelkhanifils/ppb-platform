import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { apiClient } from "@/api/client";

// Miroir de backend/app/schemas/branding.py::BrandingOut
export interface Branding {
  nom_application: string;
  couleur_primaire: string;
  couleur_primaire_claire: string;
  a_logo: boolean;
  a_icone: boolean;
  a_cachet: boolean;
  version: number;
  zone: string;
}

export const ZONE_GLOBAL = "global";
export const ZONE_EMISSION = "emission";
export const ZONE_CONTROLE = "controle";

/** Zone de personnalisation associée à un chemin de route — voir
 * app/models/branding.py::ZONES_VALIDES pour la définition complète de
 * chaque zone. Le web n'a besoin de distinguer que "controle" (le reste du
 * tableau de bord web reste "global") ; "emission" ne concerne que
 * l'application mobile (voir mobile/src/lib/branding.ts). */
function zonePourChemin(pathname: string): string {
  return pathname.startsWith("/controle") ? ZONE_CONTROLE : ZONE_GLOBAL;
}

// Une entrée de cache par zone déjà chargée — évite de re-télécharger à
// chaque changement de route la personnalisation d'une zone déjà vue.
const cacheParZone = new Map<string, Branding>();
const ecouteursParZone = new Map<string, Set<(b: Branding) => void>>();

function urlLogo(zone: string, version: number): string {
  return `${apiClient.defaults.baseURL}/branding/logo?zone=${zone}&v=${version}`;
}

function urlIcone(zone: string, version: number): string {
  return `${apiClient.defaults.baseURL}/branding/icone?zone=${zone}&v=${version}`;
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
  // usage un par un. S'applique quelle que soit la zone : la zone
  // "controle" a ses propres couleurs tant qu'elle est active à l'écran.
  document.documentElement.style.setProperty("--couleur-primaire", branding.couleur_primaire);
  document.documentElement.style.setProperty("--couleur-primaire-claire", branding.couleur_primaire_claire);

  document.title = branding.nom_application;

  if (branding.a_icone) {
    const icone = urlIcone(branding.zone, branding.version);
    definirOuCreerLien("icon").href = icone;
    definirOuCreerLien("apple-touch-icon").href = icone;
  }

  // Manifest PWA généré dynamiquement côté serveur (voir
  // GET /branding/manifest.webmanifest) — remplace tout manifest statique :
  // l'icône et le nom déclarés suivent le Super Admin sans reconstruction.
  definirOuCreerLien("manifest").href = `${apiClient.defaults.baseURL}/branding/manifest.webmanifest?zone=${branding.zone}`;
}

async function chargerZone(zone: string): Promise<Branding | null> {
  try {
    const { data } = await apiClient.get<Branding>("/branding", { params: { zone } });
    cacheParZone.set(zone, data);
    for (const ecouteur of ecouteursParZone.get(zone) ?? []) ecouteur(data);
    return data;
  } catch {
    return null; // repli silencieux — voir docstring de chargerEtAppliquerBranding
  }
}

/**
 * À appeler une fois, au tout début du démarrage de l'application
 * (main.tsx), AVANT même le premier rendu React — donc avant que le routeur
 * ne sache sur quelle route l'utilisateur se trouve. Charge et applique
 * systématiquement la zone "global" : c'est la meilleure apparence par
 * défaut disponible à ce stade (favicon/titre corrects dès le premier
 * instant), quitte à ce que useBranding() (voir plus bas), une fois le
 * routeur monté, bascule vers "controle" si la route le justifie. Échec
 * silencieux (hors-ligne, backend indisponible) : les couleurs par défaut
 * déjà présentes dans tailwind.config s'appliquent alors, exactement comme
 * avant l'existence de ce module — jamais un écran bloqué pour une question
 * d'apparence.
 */
export async function chargerEtAppliquerBranding(): Promise<void> {
  const data = await chargerZone(ZONE_GLOBAL);
  if (data) appliquer(data);
}

/** Branding de la zone "global" telle que chargée au démarrage — pour les
 * lectures ponctuelles hors composant React (aucun cas d'usage courant,
 * conservé pour compatibilité avec du code qui lirait l'état de façon
 * synchrone). Préférer useBranding() dans un composant. */
export function brandingActuel(): Branding | null {
  return cacheParZone.get(ZONE_GLOBAL) ?? null;
}

/**
 * Hook réactif, conscient de la route actuelle : sur `/controle`, renvoie
 * (et applique — titre, favicon, couleurs) la personnalisation de la zone
 * "controle" ; partout ailleurs, celle de la zone "global". Un changement
 * de route recharge/réapplique automatiquement la bonne zone — y compris en
 * quittant `/controle`, où la zone "global" est réappliquée.
 */
export function useBranding(): Branding | null {
  const { pathname } = useLocation();
  const zone = zonePourChemin(pathname);
  const [branding, setBranding] = useState<Branding | null>(cacheParZone.get(zone) ?? null);

  useEffect(() => {
    let annule = false;
    const dejaEnCache = cacheParZone.get(zone);
    if (dejaEnCache) {
      setBranding(dejaEnCache);
    } else {
      void chargerZone(zone).then((data) => {
        if (!annule && data) setBranding(data);
      });
    }
    if (!ecouteursParZone.has(zone)) ecouteursParZone.set(zone, new Set());
    const ecouteurs = ecouteursParZone.get(zone)!;
    ecouteurs.add(setBranding);
    return () => {
      annule = true;
      ecouteurs.delete(setBranding);
    };
  }, [zone]);

  useEffect(() => {
    if (branding) appliquer(branding);
  }, [branding]);

  return branding;
}

/** URL du logo à afficher dans l'UI (Connexion, en-tête...) pour la zone
 * "global" — `null` tant qu'aucun logo n'a été configuré. Utilisé hors
 * composant (voir Connexion.tsx, appelé avant le premier rendu réactif) ;
 * dans un composant qui doit suivre la zone courante (ex. l'en-tête du
 * tableau de bord, qui doit afficher le logo "controle" sur cette page),
 * préférer construire l'URL à partir du `zone`/`version` renvoyés par
 * useBranding() directement. */
export function urlLogoActuel(): string | null {
  const b = cacheParZone.get(ZONE_GLOBAL);
  return b?.a_logo ? urlLogo(ZONE_GLOBAL, b.version) : null;
}

/** URL du logo pour une zone et une version données — pour un composant qui
 * suit useBranding() et doit construire l'URL de l'image lui-même. */
export function urlLogoPourZone(zone: string, version: number): string {
  return urlLogo(zone, version);
}
