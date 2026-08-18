import type { DBSchema } from "idb";
import type { DonneesPage, PasseportPrecharge, SchemaFormulaire } from "@/types/emission";
import type { ChampsOcrPage3, ChampsOcrPage4 } from "@/types/ocr";

/**
 * Schéma IndexedDB de l'application d'émission (Module 4).
 *
 * Principe directeur — Document technique, Module 4 : « aucune image n'est
 * transmise ni conservée » pour la VALIDATION des pages. SEULE EXCEPTION,
 * ajoutée en v2 : la photo prise pour l'OCR assisté (pré-remplissage des
 * pages 3/4) — voir `photos_ocr_en_attente` ci-dessous. C'est un choix
 * délibéré, distinct, jamais une remise en cause du principe pour le reste
 * de la base : la photo ne quitte l'appareil que vers l'appel OCR, n'est
 * jamais elle-même synchronisée comme donnée de numérisation, et est
 * retirée de cette file dès que l'envoi réussit (elle continue d'exister
 * temporairement côté serveur ensuite — voir backend/app/models/photo_ocr.py).
 *
 * Sept object stores :
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
 * - `photos_ocr_en_attente` (v2) — photos capturées pour l'OCR assisté, en
 *   attente d'envoi (hors-ligne, ou réseau instable) — jamais synchronisées
 *   comme donnée de page, uniquement pour déclencher la reconnaissance dès
 *   que le réseau revient.
 * - `suggestions_ocr` (v2) — champs suggérés par l'OCR une fois reçus du
 *   serveur, en attente d'être proposés à l'agent la prochaine fois qu'il
 *   ouvre cette page pour ce passeport (voir Page3Identification/Page4Troupeau).
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
  photos_ocr_en_attente: {
    key: string; // id local (uuid généré côté client)
    value: {
      id: string;
      passeport_id: string;
      page_num: 3 | 4;
      photo: Blob;
      cree_le: string;
      tentatives: number;
      derniere_erreur: string | null;
    };
    indexes: { "par-passeport-page": [string, number] };
  };
  suggestions_ocr: {
    key: [string, number]; // [passeport_id, page_num]
    value: {
      passeport_id: string;
      page_num: 3 | 4;
      champs: ChampsOcrPage3 | ChampsOcrPage4;
      recue_le: string;
    };
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
export const VERSION_BASE = 2;
