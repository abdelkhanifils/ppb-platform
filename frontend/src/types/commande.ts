// Miroir de backend/app/schemas/commande.py

export type LangueVersion = "FR/EN" | "FR/AR" | "FR/ES";
export type ModeImpression = "centralisee" | "decentralisee";
export type StatutCommande = "brouillon" | "en_attente_paiement" | "payee" | "expiree" | "annulee";

export interface Commande {
  id: string;
  pays_id: number;
  quantite: number;
  langue_version: LangueVersion;
  mode_impression: ModeImpression;
  montant_total: number;
  statut: StatutCommande;
  responsable_nom: string;
  cree_le: string;
}

export interface CommandeCreate {
  pays_id: number;
  quantite: number;
  langue_version: LangueVersion;
  mode_impression: ModeImpression;
  responsable_nom: string;
}

export const LIBELLES_STATUT_COMMANDE: Record<StatutCommande, string> = {
  brouillon: "Brouillon",
  en_attente_paiement: "En attente de paiement",
  payee: "Payée",
  expiree: "Expirée",
  annulee: "Annulée",
};
