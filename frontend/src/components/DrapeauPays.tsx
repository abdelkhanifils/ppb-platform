/**
 * Drapeaux des 6 pays CEMAC en SVG intégré — les emojis de drapeau
 * (combinaison de deux "regional indicator symbols" Unicode) ne s'affichent
 * PAS comme des drapeaux sur de nombreuses configurations Windows : la
 * police système n'a pas le rendu composé et affiche à la place les deux
 * lettres du code pays côte à côte (confirmé en test réel — capture
 * d'écran montrant "CM", "TD", "GA", "GQ" en toutes lettres au lieu des
 * drapeaux). Des SVG intégrés évitent complètement ce problème : aucune
 * dépendance à une police d'emoji, un rendu identique partout.
 *
 * Formes simplifiées (bandes de couleur uniquement, sans les emblèmes
 * centraux comme l'étoile ou les armoiries) — l'essentiel pour identifier
 * un pays au premier coup d'œil dans une liste, sans la complexité d'un
 * tracé détaillé.
 */
import type { CSSProperties } from "react";

interface ProprietesDrapeau {
  className?: string;
  style?: CSSProperties;
}

const BASE = { width: "1.2em", height: "0.8em", verticalAlign: "-0.1em" } as const;

function DrapeauCameroun({ className, style }: ProprietesDrapeau) {
  return (
    <svg viewBox="0 0 3 2" className={className} style={{ ...BASE, ...style }} aria-hidden="true">
      <rect width="1" height="2" fill="#007a5e" />
      <rect x="1" width="1" height="2" fill="#ce1126" />
      <rect x="2" width="1" height="2" fill="#fcd116" />
      <path d="M1.5 0.75 L1.6 1.05 L1.92 1.05 L1.66 1.24 L1.76 1.55 L1.5 1.36 L1.24 1.55 L1.34 1.24 L1.08 1.05 L1.4 1.05 Z" fill="#fcd116" />
    </svg>
  );
}

function DrapeauCentrafrique({ className, style }: ProprietesDrapeau) {
  return (
    <svg viewBox="0 0 3 2" className={className} style={{ ...BASE, ...style }} aria-hidden="true">
      <rect width="3" height="2" fill="#003082" />
      <rect y="0.5" width="3" height="0.375" fill="#fff" />
      <rect y="0.875" width="3" height="0.375" fill="#289728" />
      <rect y="1.25" width="3" height="0.375" fill="#fcd116" />
      <rect y="1.625" width="3" height="0.375" fill="#fcd116" />
      <rect x="1.35" width="0.3" height="2" fill="#d21034" />
      <path d="M0.5 0.15 L0.57 0.35 L0.78 0.35 L0.61 0.47 L0.68 0.67 L0.5 0.55 L0.32 0.67 L0.39 0.47 L0.22 0.35 L0.43 0.35 Z" fill="#fcd116" />
    </svg>
  );
}

function DrapeauCongo({ className, style }: ProprietesDrapeau) {
  return (
    <svg viewBox="0 0 3 2" className={className} style={{ ...BASE, ...style }} aria-hidden="true">
      <polygon points="0,0 3,0 3,0.7 0,2" fill="#009543" />
      <polygon points="3,0 3,2 0,2 0,1.3" fill="#dc241f" />
      <polygon points="0,0.7 3,0 3,0.7 0,1.3" fill="#fbde4a" />
    </svg>
  );
}

function DrapeauGabon({ className, style }: ProprietesDrapeau) {
  return (
    <svg viewBox="0 0 3 2" className={className} style={{ ...BASE, ...style }} aria-hidden="true">
      <rect width="3" height="0.667" fill="#009e60" />
      <rect y="0.667" width="3" height="0.667" fill="#fcd116" />
      <rect y="1.333" width="3" height="0.667" fill="#3a75c4" />
    </svg>
  );
}

function DrapeauGuineeEquatoriale({ className, style }: ProprietesDrapeau) {
  return (
    <svg viewBox="0 0 3 2" className={className} style={{ ...BASE, ...style }} aria-hidden="true">
      <rect width="3" height="0.667" fill="#3e9a00" />
      <rect y="0.667" width="3" height="0.667" fill="#fff" />
      <rect y="1.333" width="3" height="0.667" fill="#e32118" />
      <polygon points="0,0 1.1,1 0,2" fill="#003876" />
    </svg>
  );
}

function DrapeauTchad({ className, style }: ProprietesDrapeau) {
  return (
    <svg viewBox="0 0 3 2" className={className} style={{ ...BASE, ...style }} aria-hidden="true">
      <rect width="1" height="2" fill="#002664" />
      <rect x="1" width="1" height="2" fill="#fecb00" />
      <rect x="2" width="1" height="2" fill="#c60c30" />
    </svg>
  );
}

const COMPOSANTS_DRAPEAUX: Record<string, (p: ProprietesDrapeau) => JSX.Element> = {
  CMR: DrapeauCameroun,
  CAF: DrapeauCentrafrique,
  COG: DrapeauCongo,
  GAB: DrapeauGabon,
  GNQ: DrapeauGuineeEquatoriale,
  TCD: DrapeauTchad,
};

/** Icône de drapeau pour un code pays à 3 lettres — rend un simple carré
 * gris si le code n'est pas l'un des 6 pays CEMAC connus (ne casse jamais
 * l'affichage d'une liste pour un pays mal configuré). */
export function DrapeauPays({ codeIso, className, style }: { codeIso: string | undefined | null } & ProprietesDrapeau) {
  const Composant = codeIso ? COMPOSANTS_DRAPEAUX[codeIso.toUpperCase()] : undefined;
  if (!Composant) {
    return <span className={className} style={{ ...BASE, ...style, display: "inline-block", background: "#e5e7eb", borderRadius: 2 }} aria-hidden="true" />;
  }
  return <Composant className={className} style={style} />;
}
