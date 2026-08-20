// Miroir de backend/app/schemas/utilisateur.py — vue "administration" (CRUD
// complet, y compris `actif`), complémentaire de Utilisateur (types/roles.ts)
// qui reste la vue "profil du compte connecté" (GET /auth/moi).
import type { Role } from "./roles";

export interface UtilisateurAdmin {
  id: string;
  email: string;
  nom_complet: string;
  role: Role;
  pays_id: number | null;
  actif: boolean;
}

export interface UtilisateurCreate {
  email: string;
  mot_de_passe: string;
  nom_complet: string;
  role: Role;
  pays_id: number | null;
}

export interface UtilisateurUpdate {
  nom_complet?: string;
  role?: Role;
  pays_id?: number | null;
  actif?: boolean;
}
