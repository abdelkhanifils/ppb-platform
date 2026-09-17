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
      upgrade(db, ancienneVersion, _nouvelleVersion, transaction) {
        // Toujours garder ce garde-fou (objectStoreNames.contains) même à
        // la toute première création : IndexedDB rappelle `upgrade` avec
        // ancienneVersion=0 pour une base neuve, mais aussi à chaque
        // montée de version ultérieure — recréer un magasin déjà existant
        // lèverait une erreur et casserait l'ouverture de la base entière.
        if (!db.objectStoreNames.contains("passeports_verification")) {
          const passeports = db.createObjectStore("passeports_verification", { keyPath: "id" });
          passeports.createIndex("par-qr_uuid", "qr_uuid", { unique: true });
          passeports.createIndex("par-numero", "numero");
        } else if (ancienneVersion < 2) {
          // Base déjà existante en v1 : ajoute seulement l'index manquant,
          // sur les lignes déjà présentes — aucune donnée à migrer,
          // IndexedDB construit l'index a posteriori automatiquement.
          transaction.objectStore("passeports_verification").createIndex("par-numero", "numero");
        }

        if (!db.objectStoreNames.contains("itineraires_verification")) {
          db.createObjectStore("itineraires_verification", { keyPath: "passeport_id" });
        }

        if (!db.objectStoreNames.contains("controles_locaux")) {
          const controles = db.createObjectStore("controles_locaux", { keyPath: "id" });
          controles.createIndex("par-statut", "statut_envoi");
        }

        if (!db.objectStoreNames.contains("parametres_locaux_controle")) {
          db.createObjectStore("parametres_locaux_controle", { keyPath: "cle" });
        }
      },
    });
  }
  return promesseBase;
}
