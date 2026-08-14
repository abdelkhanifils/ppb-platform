import type { DBSchema } from "idb";
import type { ItineraireVerificationApi, ModeVerification, PasseportVerificationApi, ResultatControle } from "@/types/controle";

/**
 * Schéma IndexedDB de l'application de contrôle (Module 5).
 *
 * Quatre object stores :
 * - `passeports_verification` — l'index de vérification local, alimenté par
 *   la synchronisation différentielle (voir db/syncVerification.ts). Contient
 *   `hash_sha256` et `signature`, jamais la clé privée bien sûr — c'est tout
 *   ce dont la vérification hors-ligne a besoin.
 * - `itineraires_verification` — pendant du précédent pour le trajet déclaré.
 *   Un passeport peut exister sans itinéraire synchronisé (page 3 pas encore
 *   remontée du terrain) : c'est précisément le cas qui doit rester
 *   « à vérifier », jamais bloquer ni valider par défaut.
 * - `controles_locaux` — file d'attente des contrôles enregistrés hors-ligne,
 *   en attente de remontée vers le serveur (même rôle que
 *   `file_synchronisation` côté Module 4).
 * - `parametres_locaux_controle` — dont la clé `derniere_synchronisation`,
 *   pivot de la synchronisation différentielle.
 */
export interface ControleLocal {
  id: string; // uuid généré côté client
  passeport_id: string;
  poste_id: string;
  mode: ModeVerification;
  resultat_local: ResultatControle;
  signature_valide: boolean;
  conforme_itineraire: boolean | null;
  itineraire_disponible_localement: boolean;
  latitude?: number;
  longitude?: number;
  cree_le: string; // ISO 8601 — horodatage du contrôle terrain, pas de l'envoi
  statut_envoi: "en_attente" | "envoyee" | "echouee";
  tentatives: number;
}

export interface PPBControleDB extends DBSchema {
  passeports_verification: {
    key: string; // id du passeport
    value: PasseportVerificationApi & { recu_le: string };
    indexes: { "par-qr_uuid": string };
  };
  itineraires_verification: {
    key: string; // passeport_id
    value: ItineraireVerificationApi & { recu_le: string };
  };
  controles_locaux: {
    key: string;
    value: ControleLocal;
    indexes: { "par-statut": string };
  };
  parametres_locaux_controle: {
    key: string;
    value: { cle: string; valeur: string };
  };
}

export const NOM_BASE_CONTROLE = "ppb-controle";
export const VERSION_BASE_CONTROLE = 1;

export const CLE_DERNIERE_SYNCHRONISATION = "derniere_synchronisation";
