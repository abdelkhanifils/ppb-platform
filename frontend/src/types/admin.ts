// Miroir de backend/app/schemas/admin.py — vue "administration" (écriture),
// complémentaire de types/emission.ts qui couvre la vue publique en lecture
// seule (ChampSchema/SchemaFormulaire, consommée par le Module 4).
import type { TypeChamp } from "./emission";

export interface FormulaireAdmin {
  id: string;
  code: string;
  nom: string;
  description: string | null;
  schema_version: number;
}

export interface ChampAdmin {
  id: string;
  formulaire_id: string;
  code_champ: string;
  libelle_fr: string;
  libelle_en: string | null;
  libelle_ar: string | null;
  type_champ: TypeChamp;
  obligatoire: boolean;
  ordre_affichage: number;
  actif: boolean;
  version: number;
}

export interface ChampCreate {
  code_champ: string;
  libelle_fr: string;
  libelle_en?: string;
  libelle_ar?: string;
  type_champ: TypeChamp;
  obligatoire: boolean;
  ordre_affichage: number;
  regle_validation?: string;
  options_liste?: { valeurs: string[] };
}

export type TypeParametre = "string" | "int" | "decimal" | "bool";

export interface Parametre {
  cle: string;
  valeur: string;
  type: TypeParametre;
  description: string | null;
}

export type StatutTexteGabarit = "propose" | "valide" | "rejete";

export interface TexteGabarit {
  id: string;
  gabarit_version: number;
  cle: string;
  langue: string;
  valeur: string;
  statut: StatutTexteGabarit;
  propose_par_id: string;
  valide_par_id: string | null;
}

export interface CompletionGabarit {
  gabarit_version: number;
  total: number;
  par_statut: Record<StatutTexteGabarit, number>;
}

export const LIBELLES_TYPE_CHAMP: Record<TypeChamp, string> = {
  texte: "Texte",
  nombre: "Nombre",
  date: "Date",
  liste: "Liste (choix)",
  booleen: "Oui / Non",
};

export const LIBELLES_STATUT_GABARIT: Record<StatutTexteGabarit, string> = {
  propose: "Proposé — en attente de validation",
  valide: "Validé",
  rejete: "Rejeté",
};
