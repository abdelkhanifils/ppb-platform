// Miroir des schémas backend (voir backend/app/api/v1/endpoints/controles.py
// et backend/app/schemas/controle.py). Toute divergence casse silencieusement
// la synchronisation différentielle ou la vérification locale.

export type ModeVerification = "en_ligne" | "hors_ligne";
export type ResultatControle = "valide" | "refuse" | "a_verifier";

// --- Index de vérification (identité + itinéraire) ------------------------------------------

export interface PasseportVerificationApi {
  id: string;
  numero: string; // "01-2027-0000001"
  qr_uuid: string;
  code_verification: string;
  hash_sha256: string;
  signature: string; // base64 — signature ECDSA P-256 (DER) ou RSA-2048 (PKCS1v15)
  statut: string;
}

export interface PersonneVerification {
  nom_prenom: string;
  numero_cni: string;
  telephone: string | null;
}

export interface TroupeauEspeceVerification {
  espece: string;
  nombre_males: number;
  nombre_femelles_jeunes: number;
  nombre_femelles_adultes: number;
  nombre_total: number;
}

export interface VaccinationVerification {
  maladie: string;
  date_vaccination: string | null;
  lieu: string | null;
}

export interface ItineraireVerificationApi {
  passeport_id: string;
  // `null` si le trajet implique un pays hors CEMAC — voir pays_origine_autre.
  pays_origine_id: number | null;
  pays_origine_autre: string | null;
  province_origine: string;
  localite_origine: string | null;
  pays_destination_id: number | null;
  pays_destination_autre: string | null;
  province_destination: string;
  localite_destination: string | null;
  // Renseignés seulement si l'émission terrain (Module 4) a été transmise et
  // synchronisée — voir backend/app/api/v1/endpoints/controles.py::_enrichir_avec_emission.
  // `null` : page 3 pas encore transmise (rare — un itinéraire n'existe qu'après
  // la page 3). Listes vides : page 3 transmise mais pas encore la page 4.
  eleveur: PersonneVerification | null;
  convoyeur: PersonneVerification | null;
  troupeau_especes: TroupeauEspeceVerification[];
  vaccinations: VaccinationVerification[];
}

export interface CacheVerificationComplet {
  horodatage_serveur: string; // ISO 8601 — à conserver comme point de départ du prochain delta
  passeports: PasseportVerificationApi[];
  itineraires: ItineraireVerificationApi[];
}

export interface CacheVerificationDelta {
  depuis: string;
  horodatage_serveur: string;
  passeports_delta: PasseportVerificationApi[];
  itineraires_delta: ItineraireVerificationApi[];
}

// --- Enregistrement d'un contrôle ------------------------------------------------------------

export interface ControleCreate {
  passeport_id: string;
  poste_id: string;
  mode: ModeVerification;
  latitude?: number;
  longitude?: number;
  motif?: string;
}

export interface HistoriqueControleApi {
  poste_id: string;
  resultat: ResultatControle;
  date: string; // ISO 8601
}

export interface ControleResultatApi {
  resultat: ResultatControle;
  signature_valide: boolean | null;
  itineraire_disponible_localement: boolean;
  conforme_itineraire: boolean | null;
  // Garde-fou anti-réutilisation — voir backend/app/schemas/controle.py pour
  // le détail complet du raisonnement.
  historique_controles: HistoriqueControleApi[];
  deja_valide_a_ce_poste: boolean;
  nb_scans_ce_poste: number;
  minutes_depuis_dernier_scan_ce_poste: number | null;
  motif_requis: boolean;
}

// --- Historique des contrôles (tableau de bord) -----------------------------------------------

export interface ControleHistoriqueApi {
  id: string;
  numero: string; // "01-2027-0000001"
  pays_id: number;
  poste_id: string;
  resultat: ResultatControle;
  mode: ModeVerification;
  agent_nom: string;
  date: string; // ISO 8601
}
