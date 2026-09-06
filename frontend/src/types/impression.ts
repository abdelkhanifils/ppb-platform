// Miroir de backend/app/schemas/passeport.py et backend/app/models/passeport.py

export type StatutPasseportAdmin = "precharge" | "vierge" | "emis" | "controle" | "revoque";

export interface PasseportResume {
  id: string;
  numero: string;
  qr_uuid: string;
  statut: StatutPasseportAdmin;
  publie: boolean;
  imprime: boolean;
}

export interface AutorisationImpression {
  id: string;
  pays_id: number;
  plage_debut: number;
  plage_fin: number;
  gabarit_version: number;
  active: boolean;
}

export const LIBELLES_STATUT_PASSEPORT: Record<StatutPasseportAdmin, string> = {
  precharge: "Préchargé — attribution faite, pas encore imprimé",
  vierge: "Vierge — imprimé, prêt pour le terrain",
  emis: "Émis — rempli sur le terrain",
  controle: "Contrôlé",
  revoque: "Révoqué",
};
