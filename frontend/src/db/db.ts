import { openDB, type IDBPDatabase } from "idb";
import { NOM_BASE, VERSION_BASE, type PPBEmissionDB } from "./schema";

let promesseBase: Promise<IDBPDatabase<PPBEmissionDB>> | null = null;

/**
 * Ouvre (ou crée) la base IndexedDB de l'application d'émission. Appelé une
 * seule fois par session — le résultat est mis en cache dans le module.
 * Utilisable aussi bien depuis l'application (React) que depuis le Service
 * Worker (src/sw.ts), qui partagent la même origine et donc la même base.
 */
export function obtenirBase(): Promise<IDBPDatabase<PPBEmissionDB>> {
  if (!promesseBase) {
    promesseBase = openDB<PPBEmissionDB>(NOM_BASE, VERSION_BASE, {
      upgrade(db, oldVersion) {
        // v1 — création initiale. Toute évolution future du schéma
        // s'ajoute avec un `if (oldVersion < N)`, jamais en modifiant la
        // structure déjà livrée dans une version antérieure.
        if (oldVersion < 1) {
          const passeports = db.createObjectStore("passeports_precharges", { keyPath: "id" });
          passeports.createIndex("par-qr_uuid", "qr_uuid", { unique: true });

          db.createObjectStore("schemas_formulaire", { keyPath: "code" });

          const file = db.createObjectStore("file_synchronisation", { keyPath: "id" });
          file.createIndex("par-passeport", "passeport_id");
          file.createIndex("par-statut", "statut");

          db.createObjectStore("numerisations_confirmees", { keyPath: ["passeport_id", "page_num"] });

          db.createObjectStore("parametres_locaux", { keyPath: "cle" });
        }

        // v2 — OCR assisté (pages 3/4) : file d'attente des photos prises
        // hors-ligne + suggestions reçues du serveur, en attente d'être
        // proposées à l'agent (voir schema.ts pour le principe général).
        if (oldVersion < 2) {
          const photosOcr = db.createObjectStore("photos_ocr_en_attente", { keyPath: "id" });
          photosOcr.createIndex("par-passeport-page", ["passeport_id", "page_num"]);

          db.createObjectStore("suggestions_ocr", { keyPath: ["passeport_id", "page_num"] });
        }
      },
    });
  }
  return promesseBase;
}
