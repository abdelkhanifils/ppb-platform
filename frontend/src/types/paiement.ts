// Miroir de backend/app/schemas/paiement.py

export type MoyenPaiement = "mobile_money" | "carte_bancaire" | "virement" | "especes" | "cheque";
export type StatutPaiement = "initie" | "en_attente_validation" | "valide" | "echoue" | "rembourse";

export interface Paiement {
  id: string;
  commande_id: string;
  montant: number;
  devise: string;
  moyen: MoyenPaiement;
  statut: StatutPaiement;
}

export const LIBELLES_MOYEN_PAIEMENT: Record<MoyenPaiement, string> = {
  mobile_money: "Mobile Money",
  carte_bancaire: "Carte bancaire",
  virement: "Virement",
  especes: "Espèces",
  cheque: "Chèque",
};

export const LIBELLES_STATUT_PAIEMENT: Record<StatutPaiement, string> = {
  initie: "Initié",
  en_attente_validation: "En attente de validation",
  valide: "Validé",
  echoue: "Échoué",
  rembourse: "Remboursé",
};
