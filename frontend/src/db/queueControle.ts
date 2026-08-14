import { apiClient } from "@/api/client";
import type { ControleCreate, ControleResultatApi } from "@/types/controle";
import { obtenirBaseControle } from "./dbControle";
import type { ControleLocal } from "./schemaControle";

/**
 * File de synchronisation des contrôles — Module 5. Symétrique de
 * db/queueEmission.ts (Module 4) : le résultat affiché à l'agent vient
 * TOUJOURS de la vérification locale (signature + conformité, calculées
 * hors-ligne — voir services/verificationSignature.ts et
 * services/conformiteItineraire.ts), jamais d'une attente réseau. L'envoi au
 * serveur (POST /controles) est une remontée best-effort pour l'historique et
 * les statistiques centralisées — la décision terrain, elle, est déjà prise.
 */

function genererIdLocal(): string {
  return crypto.randomUUID();
}

export async function enregistrerControleLocalement(controle: Omit<ControleLocal, "id" | "cree_le" | "statut_envoi" | "tentatives">): Promise<void> {
  const db = await obtenirBaseControle();
  const entree: ControleLocal = {
    ...controle,
    id: genererIdLocal(),
    cree_le: new Date().toISOString(),
    statut_envoi: "en_attente",
    tentatives: 0,
  };
  await db.add("controles_locaux", entree);

  if (navigator.onLine) void viderFileControles();
}

let videEnCours = false;

/** Envoie au serveur tous les contrôles en attente — réentrant, comme
 * viderFile côté Module 4. */
export async function viderFileControles(): Promise<{ envoyes: number; echoues: number }> {
  if (videEnCours) return { envoyes: 0, echoues: 0 };
  videEnCours = true;

  try {
    const db = await obtenirBaseControle();
    const enAttente = (await db.getAllFromIndex("controles_locaux", "par-statut", "en_attente")).sort((a, b) =>
      a.cree_le.localeCompare(b.cree_le)
    );

    let envoyes = 0;
    let echoues = 0;

    for (const entree of enAttente) {
      try {
        const payload: ControleCreate = {
          passeport_id: entree.passeport_id,
          poste_id: entree.poste_id,
          mode: entree.mode,
          latitude: entree.latitude,
          longitude: entree.longitude,
        };
        await apiClient.post<ControleResultatApi>("/controles", payload);

        entree.statut_envoi = "envoyee";
        await db.put("controles_locaux", entree);
        envoyes += 1;
      } catch (erreur) {
        const estErreurHttp =
          typeof erreur === "object" && erreur !== null && "response" in erreur && (erreur as { response?: unknown }).response !== undefined;
        entree.tentatives += 1;
        entree.statut_envoi = estErreurHttp ? "echouee" : "en_attente";
        await db.put("controles_locaux", entree);
        echoues += 1;
        if (!estErreurHttp) break; // hors-ligne : inutile d'essayer les suivants maintenant
      }
    }

    return { envoyes, echoues };
  } finally {
    videEnCours = false;
  }
}

export async function compterControlesEnAttente(): Promise<number> {
  const db = await obtenirBaseControle();
  return (await db.getAllFromIndex("controles_locaux", "par-statut", "en_attente")).length;
}
