/**
 * Types du résultat renvoyé par l'endpoint OCR (backend, voir
 * app/services/ocr_service.py::extraire_champs_page3/4) — des SUGGESTIONS
 * à proposer dans le formulaire, jamais une saisie déjà validée. Chaque
 * champ est optionnel : absent quand rien n'a été reconnu avec confiance
 * (voir la docstring du service backend — jamais une valeur inventée).
 */

export interface ChampsOcrPersonne {
  nom_prenom?: string;
  numero_cni?: string;
  telephone?: string;
}

export interface ChampsOcrItineraire {
  province_origine?: string;
  province_destination?: string;
  localite_origine?: string;
  localite_destination?: string;
}

export interface ChampsOcrPage3 {
  eleveur: ChampsOcrPersonne;
  convoyeur: ChampsOcrPersonne;
  itineraire: ChampsOcrItineraire;
}

export interface ChampsOcrEffectif {
  espece: "bovin" | "ovin" | "caprin" | "camelin";
  nombre_males: number;
  nombre_femelles_jeunes: number;
  nombre_femelles_adultes: number;
  nombre_total: number;
}

export interface ChampsOcrVaccination {
  maladie: string;
  date_vaccination: string | null;
  lieu: string | null;
}

export interface ChampsOcrPage4 {
  effectifs: ChampsOcrEffectif[];
  vaccinations: ChampsOcrVaccination[];
}

export interface ReponseOcrApi<T> {
  champs: T;
}
