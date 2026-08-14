import type { DBSchema } from "idb";
import type { DonneesPage, PasseportPrecharge, SchemaFormulaire } from "@/types/emission";

/**
 * Schéma IndexedDB de l'application d'émission (Module 4).
 *
 * Principe directeur — Document technique, Module 4 : « aucune image n'est
 * transmise ni conservée ». Cette base ne contient donc QUE des données
 * structurées (texte, nombres, identifiants) : aucun object store ne stocke
 * jamais de Blob, de canvas capturé ou de photo. La page 1 (vérification
 * visuelle) ne produit d'ailleurs aucune donnée à stocker — seul son
 * franchissement (page_num=1 validée) est enregistré.
 *
 * Cinq object stores :
 * - `passeports_precharges` — cache local des numéros VIERGE disponibles
 *   pour cet agent (rafraîchi dès que le réseau est là), pour permettre la
 *   sélection au scan QR même hors-ligne.
 * - `schemas_formulaire` — cache des schémas dynamiques (eleveur, convoyeur,
 *   troupeau) publiés par le Module Administration, avec leur version.
 * - `file_synchronisation` — la file d'attente elle-même : chaque page
 *   validée par l'agent, en attente d'envoi au serveur. C'EST la source de
 *   vérité locale tant que l'envoi n'a pas réussi.
 * - `numerisations_confirmees` — miroir local des pages déjà synchronisées
 *   avec succès, pour affichage de progression sans dépendre du réseau.
 * - `parametres_locaux` — clé/valeur pour l'état de l'app (pays de l'agent,
 *   horodatage de dernière synchronisation, etc.).
 */
export interface PPBEmissionDB extends DBSchema {
  passeports_precharges: {
    key: string; // id du passeport
    value: PasseportPrecharge & { recupere_le: string };
    indexes: { "par-qr_uuid": string };
  };
  schemas_formulaire: {
    key: string; // code du formulaire ("eleveur", "convoyeur", "troupeau")
    value: SchemaFormulaire & { recupere_le: string };
  };
  file_synchronisation: {
    key: string; // id local (uuid généré côté client)
    value: EntreeFileSynchronisation;
    indexes: { "par-passeport": string; "par-statut": string };
  };
  numerisations_confirmees: {
    key: [string, number]; // [passeport_id, page_num]
    value: {
      passeport_id: string;
      page_num: 1 | 2 | 3 | 4;
      synchronisee_le: string;
    };
  };
  parametres_locaux: {
    key: string;
    value: { cle: string; valeur: string };
  };
}

export interface EntreeFileSynchronisation {
  id: string;
  passeport_id: string;
  page_num: 1 | 2 | 3 | 4;
  donnees_json: DonneesPage;
  cree_le: string; // ISO 8601 — horodatage de la VALIDATION TERRAIN, pas de l'envoi
  statut: "en_attente" | "en_cours" | "echouee";
  tentatives: number;
  derniere_erreur: string | null;
}

export const NOM_BASE = "ppb-emission";
export const VERSION_BASE = 1;
