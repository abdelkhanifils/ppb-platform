// Miroir exact de app/core/rbac.py::Role (backend) — 8 rôles RBAC.
export enum Role {
  SUPER_ADMIN = "super_admin",
  ADMIN_NATIONAL = "admin_national",
  AGENT_EMISSION = "agent_emission",
  AGENT_CONTROLE = "agent_controle",
  VETERINAIRE = "veterinaire",
  CONSULTATION = "consultation",
  COMPTABILITE = "comptabilite",
  GESTIONNAIRE_CEBEVIRHA = "gestionnaire_cebevirha",
}

export const LIBELLES_ROLE: Record<Role, string> = {
  [Role.SUPER_ADMIN]: "Super Administrateur (CEBEVIRHA)",
  [Role.ADMIN_NATIONAL]: "Admin National (Ministère de l'Élevage)",
  [Role.AGENT_EMISSION]: "Agent d'émission",
  [Role.AGENT_CONTROLE]: "Agent de contrôle",
  [Role.VETERINAIRE]: "Vétérinaire",
  [Role.CONSULTATION]: "Consultation",
  [Role.COMPTABILITE]: "Comptabilité",
  [Role.GESTIONNAIRE_CEBEVIRHA]: "Gestionnaire (CEBEVIRHA)",
};

export interface Utilisateur {
  id: string;
  email: string;
  nom_complet: string;
  role: Role;
  pays_id: number | null;
}
