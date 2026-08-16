// Miroir de backend/app/services/statistiques.py et backend/app/services/geospatial.py

export interface StatistiquesParPays {
  pays_id: number;
  code_iso: string;
  nom: string;
  nb_commandes: number;
  montant_encaisse_xaf: number;
  passeports_par_statut: Record<string, number>;
  controles_par_resultat: Record<string, number>;
}

export interface PhaseEntonnoir {
  statut: string;
  nombre: number;
}

export interface TableauBordRegional {
  par_pays: StatistiquesParPays[];
  entonnoir_global: PhaseEntonnoir[];
  totaux: {
    nb_pays: number;
    nb_commandes_total: number;
    montant_encaisse_total_xaf: number;
  };
}

export interface StatistiquesParPoste {
  poste_id: string;
  code: string;
  nom: string;
  pays_id: number;
  latitude: number;
  longitude: number;
  controles_par_resultat: Record<string, number>;
  total_controles: number;
}

export interface ClusterMouvements {
  cluster_id: number;
  nombre: number;
  latitude_centre: number;
  longitude_centre: number;
  valides: number;
  refuses: number;
  a_verifier: number;
}

export const LIBELLES_PHASE: Record<string, string> = {
  precharge: "Préchargé",
  vierge: "Vierge (imprimé)",
  emis: "Émis",
  controle: "Contrôlé",
  revoque: "Révoqué",
};

// --- Vue croisée pays x année --------------------------------------------------------------

export interface StatistiquesParPaysAnnee {
  pays_id: number;
  annee: number;
  nb_commandes: number;
  montant_commandes_xaf: number;
  montant_encaisse_xaf: number;
  moyens_paiement: Record<string, number>;
  nb_passeports_imprimes: number;
  nb_controles: number;
  controles_par_resultat: Record<string, number>;
}

export const LIBELLES_MOYEN_PAIEMENT_COURT: Record<string, string> = {
  virement: "Virement",
  especes: "Espèces",
  cheque: "Chèque",
  mobile_money: "Mobile Money",
  carte_bancaire: "Carte",
};
