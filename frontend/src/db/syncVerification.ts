import { apiClient } from "@/api/client";
import type {
  CacheVerificationComplet,
  CacheVerificationDelta,
  ItineraireVerificationApi,
  PasseportVerificationApi,
} from "@/types/controle";
import { obtenirBaseControle } from "./dbControle";
import { CLE_DERNIERE_SYNCHRONISATION } from "./schemaControle";

/**
 * Synchronisation différentielle de l'index de vérification — Module 5
 * (Document technique §3, M5 : « Synchronisation automatique (push + pull) »).
 *
 * Principe : ne jamais retélécharger tout l'index à chaque fois. Le dernier
 * horodatage de synchronisation réussie (`horodatage_serveur` renvoyé par le
 * backend, PAS l'horloge locale de l'appareil — évite toute dérive d'horloge
 * entre le poste et le serveur) est conservé dans IndexedDB ; seul ce qui a
 * été publié après cet horodatage est redemandé
 * (GET /controles/cache-verification/delta?depuis=...). Le tout premier appel
 * (aucun horodatage local, ex. première installation d'un poste) bascule sur
 * le téléchargement complet (GET /controles/cache-verification).
 *
 * Déclenchement : voir hooks/useDeltaSync.ts — automatique dès détection
 * réseau, jamais une action manuelle de l'agent.
 */

async function obtenirDerniereSynchronisation(): Promise<string | null> {
  const db = await obtenirBaseControle();
  const entree = await db.get("parametres_locaux_controle", CLE_DERNIERE_SYNCHRONISATION);
  return entree?.valeur ?? null;
}

async function enregistrerDerniereSynchronisation(horodatageServeur: string): Promise<void> {
  const db = await obtenirBaseControle();
  await db.put("parametres_locaux_controle", { cle: CLE_DERNIERE_SYNCHRONISATION, valeur: horodatageServeur });
}

async function fusionnerPasseports(passeports: PasseportVerificationApi[]): Promise<void> {
  if (passeports.length === 0) return;
  const db = await obtenirBaseControle();
  const tx = db.transaction("passeports_verification", "readwrite");
  const maintenant = new Date().toISOString();
  await Promise.all([...passeports.map((p) => tx.store.put({ ...p, recu_le: maintenant })), tx.done]);
}

async function fusionnerItineraires(itineraires: ItineraireVerificationApi[]): Promise<void> {
  if (itineraires.length === 0) return;
  const db = await obtenirBaseControle();
  const tx = db.transaction("itineraires_verification", "readwrite");
  const maintenant = new Date().toISOString();
  await Promise.all([...itineraires.map((i) => tx.store.put({ ...i, recu_le: maintenant })), tx.done]);
}

/**
 * Point d'entrée unique de la synchronisation — bascule automatiquement entre
 * téléchargement complet (première fois) et delta (fois suivantes). Ne lève
 * jamais d'exception pour une simple absence de réseau : l'appelant
 * (useDeltaSync) est responsable de ne l'invoquer que quand `navigator.onLine`
 * est vrai, et toute erreur réseau résiduelle (ex. coupure pendant l'appel)
 * remonte normalement pour que l'appelant puisse réessayer plus tard.
 */
export async function synchroniserIndexVerification(): Promise<{ passeports: number; itineraires: number }> {
  const depuis = await obtenirDerniereSynchronisation();

  if (depuis === null) {
    const { data } = await apiClient.get<CacheVerificationComplet>("/controles/cache-verification");
    await fusionnerPasseports(data.passeports);
    await fusionnerItineraires(data.itineraires);
    await enregistrerDerniereSynchronisation(data.horodatage_serveur);
    return { passeports: data.passeports.length, itineraires: data.itineraires.length };
  }

  const { data } = await apiClient.get<CacheVerificationDelta>("/controles/cache-verification/delta", {
    params: { depuis },
  });
  await fusionnerPasseports(data.passeports_delta);
  await fusionnerItineraires(data.itineraires_delta);
  await enregistrerDerniereSynchronisation(data.horodatage_serveur);
  return { passeports: data.passeports_delta.length, itineraires: data.itineraires_delta.length };
}

export async function trouverPasseportParQrUuid(qrUuid: string) {
  const db = await obtenirBaseControle();
  return db.getFromIndex("passeports_verification", "par-qr_uuid", qrUuid);
}

export async function trouverItinerairePourPasseport(passeportId: string) {
  const db = await obtenirBaseControle();
  return db.get("itineraires_verification", passeportId);
}
