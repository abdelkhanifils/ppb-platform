// Miroir de backend/app/api/v1/endpoints/comptabilite.py
import type { MoyenPaiement, StatutPaiement } from "@/types/paiement";

export interface PaiementEnAttenteResume {
  id: string;
  commande_id: string;
  reference: string;
  pays: string;
  montant: number;
  devise: string;
  moyen: MoyenPaiement;
  cree_le: string;
}

export interface LigneParPays {
  pays: string;
  nb_payees: number;
  montant_payees: number;
  nb_non_payees: number;
  montant_non_payees: number;
}

export interface SyntheseComptable {
  en_attente: { nombre: number; montant: number; paiements: PaiementEnAttenteResume[] };
  commandes_payees: { nombre: number; montant: number };
  commandes_non_payees: { nombre: number; montant: number };
  montant_total_commandes: number;
  encaisse: { nombre: number; montant: number };
  par_pays: LigneParPays[];
  devise: string;
}

export interface LignePeriode {
  paiement_id: string;
  commande_id: string;
  reference: string;
  pays: string;
  quantite: number;
  montant: number;
  devise: string;
  moyen: MoyenPaiement;
  statut_paiement: StatutPaiement;
  montant_commande: number;
  statut_commande: string;
  facture_definitive: boolean;
  cree_le: string;
}

export interface PaiementsPeriode {
  lignes: LignePeriode[];
  total: number;
  montant_valide: number;
  montant_en_attente: number;
}
