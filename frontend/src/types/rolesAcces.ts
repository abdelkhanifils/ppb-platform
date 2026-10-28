import type { Role } from "@/types/roles";

export interface FonctionnaliteCatalogue {
  code: string;
  module: string;
  libelle: string;
  reservee_super_admin: boolean;
}

export interface LigneRole {
  role: Role;
  verrouille: boolean;
  permissions: string[];
  defaut: string[];
}

export interface MatriceRoles {
  catalogue: FonctionnaliteCatalogue[];
  roles: LigneRole[];
}

export interface UtilisateurPresence {
  id: string;
  nom_complet: string;
  email: string;
  role: Role;
  pays: string | null;
  derniere_activite: string | null;
  en_ligne: boolean;
}

export interface Presence {
  seuil_minutes: number;
  en_ligne: number;
  total_actifs: number;
  par_role: Record<string, number>;
  utilisateurs: UtilisateurPresence[];
}
