import { openDB, type IDBPDatabase } from "idb";
import { NOM_BASE_CONTROLE, VERSION_BASE_CONTROLE, type PPBControleDB } from "./schemaControle";

let promesseBase: Promise<IDBPDatabase<PPBControleDB>> | null = null;

/** Ouvre (ou crée) la base IndexedDB de l'application de contrôle — indépendante
 * de `ppb-emission` (Module 4) : deux applications terrain distinctes, deux
 * bases distinctes, même si elles partagent le même bundle React dans ce
 * dépôt monorepo. */
export function obtenirBaseControle(): Promise<IDBPDatabase<PPBControleDB>> {
  if (!promesseBase) {
    promesseBase = openDB<PPBControleDB>(NOM_BASE_CONTROLE, VERSION_BASE_CONTROLE, {
      upgrade(db) {
        const passeports = db.createObjectStore("passeports_verification", { keyPath: "id" });
        passeports.createIndex("par-qr_uuid", "qr_uuid", { unique: true });

        db.createObjectStore("itineraires_verification", { keyPath: "passeport_id" });

        const controles = db.createObjectStore("controles_locaux", { keyPath: "id" });
        controles.createIndex("par-statut", "statut_envoi");

        db.createObjectStore("parametres_locaux_controle", { keyPath: "cle" });
      },
    });
  }
  return promesseBase;
}
