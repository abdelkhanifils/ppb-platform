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
  hash_sha256: string;
  signature: string; // base64 — signature ECDSA P-256 (DER) ou RSA-2048 (PKCS1v15)
  statut: string;
}

export interface ItineraireVerificationApi {
  passeport_id: string;
  pays_origine_id: number;
  province_origine: string;
  pays_destination_id: number;
  province_destination: string;
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
}

export interface ControleResultatApi {
  resultat: ResultatControle;
  signature_valide: boolean | null;
  itineraire_disponible_localement: boolean;
  conforme_itineraire: boolean | null;
}
