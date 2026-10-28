import { createContext, useContext } from "react";

/** Période de consultation (jours inclusifs) appliquée à toutes les statistiques :
 * « Ce mois », « Mois dernier », « Ce trimestre », « Cette année » ou un intervalle personnalisé. */
export type PresetPeriode = "tout" | "mois" | "mois_precedent" | "trimestre" | "annee" | "perso";
export interface Periode { debut: string; fin: string }

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function bornesPreset(p: PresetPeriode): Periode {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  if (p === "mois") return { debut: iso(new Date(y, m, 1)), fin: iso(new Date(y, m + 1, 0)) };
  if (p === "mois_precedent") return { debut: iso(new Date(y, m - 1, 1)), fin: iso(new Date(y, m, 0)) };
  if (p === "trimestre") {
    const q = Math.floor(m / 3) * 3;
    return { debut: iso(new Date(y, q, 1)), fin: iso(new Date(y, q + 3, 0)) };
  }
  if (p === "annee") return { debut: iso(new Date(y, 0, 1)), fin: iso(new Date(y, 11, 31)) };
  return { debut: "", fin: "" };
}

export const PRESETS_PERIODE: { cle: PresetPeriode; libelle: string }[] = [
  { cle: "tout", libelle: "Toute la période" },
  { cle: "mois", libelle: "Ce mois" },
  { cle: "mois_precedent", libelle: "Mois dernier" },
  { cle: "trimestre", libelle: "Ce trimestre" },
  { cle: "annee", libelle: "Cette année" },
  { cle: "perso", libelle: "Dates personnalisées" },
];

const PeriodeContexte = createContext<Periode>({ debut: "", fin: "" });
export const PeriodeProvider = PeriodeContexte.Provider;
export const usePeriode = () => useContext(PeriodeContexte);

/** Paramètres d'API (`debut`/`fin`) à fusionner dans une requête statistique. */
export function paramsPeriode(p: Periode): Record<string, string> {
  const r: Record<string, string> = {};
  if (p.debut) r.debut = p.debut;
  if (p.fin) r.fin = p.fin;
  return r;
}
