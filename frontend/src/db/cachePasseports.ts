import { apiClient } from "@/api/client";
import type { PasseportPrecharge } from "@/types/emission";
import { obtenirBase } from "./db";

/**
 * Cache local des passeports au statut VIERGE assignés à l'agent (son pays)
 * — indispensable pour que le scan QR (page 2) fonctionne hors-ligne : sans
 * ce cache, un agent en zone blanche ne pourrait vérifier qu'un QR scanné
 * correspond bien à un passeport réellement imprimé pour lui.
 */

export async function rafraichirPasseportsPrecharges(): Promise<number> {
  const { data } = await apiClient.get<PasseportPrecharge[]>("/passeports/cache-emission");
  const db = await obtenirBase();
  const tx = db.transaction("passeports_precharges", "readwrite");
  const maintenant = new Date().toISOString();
  await Promise.all([
    ...data.map((p) => tx.store.put({ ...p, recupere_le: maintenant })),
    tx.done,
  ]);
  return data.length;
}

export async function trouverParQrUuid(qrUuid: string) {
  const db = await obtenirBase();
  return db.getFromIndex("passeports_precharges", "par-qr_uuid", qrUuid);
}

export async function listerPasseportsPrecharges(): Promise<PasseportPrecharge[]> {
  const db = await obtenirBase();
  return db.getAll("passeports_precharges");
}

/** Retire un passeport du cache local une fois ses 4 pages synchronisées —
 * évite qu'il reste proposé au scan alors qu'il est déjà émis. */
export async function retirerPasseportPrecharge(id: string): Promise<void> {
  const db = await obtenirBase();
  await db.delete("passeports_precharges", id);
}
