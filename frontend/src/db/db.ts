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
      upgrade(db) {
        // v1 — création initiale. Toute évolution future du schéma (ex. v2)
        // s'ajoute ici avec un `if (oldVersion < 2) { ... }`, jamais en
        // modifiant la structure déjà livrée en v1.
        const passeports = db.createObjectStore("passeports_precharges", { keyPath: "id" });
        passeports.createIndex("par-qr_uuid", "qr_uuid", { unique: true });

        db.createObjectStore("schemas_formulaire", { keyPath: "code" });

        const file = db.createObjectStore("file_synchronisation", { keyPath: "id" });
        file.createIndex("par-passeport", "passeport_id");
        file.createIndex("par-statut", "statut");

        db.createObjectStore("numerisations_confirmees", { keyPath: ["passeport_id", "page_num"] });

        db.createObjectStore("parametres_locaux", { keyPath: "cle" });
      },
    });
  }
  return promesseBase;
}
