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

export async function enregistrerControleLocalement(
  controle: Omit<ControleLocal, "id" | "cree_le" | "statut_envoi" | "tentatives" | "brouillon">,
  options: { brouillon?: boolean } = {}
): Promise<string> {
  const db = await obtenirBaseControle();
  const entree: ControleLocal = {
    ...controle,
    id: genererIdLocal(),
    cree_le: new Date().toISOString(),
    statut_envoi: "en_attente",
    tentatives: 0,
    brouillon: options.brouillon ? true : undefined,
  };
  await db.add("controles_locaux", entree);

  if (!options.brouillon && navigator.onLine) void viderFileControles();
  return entree.id;
}

/** Met à jour le signalement d'un contrôle encore en brouillon (l'agent choisit ou change
 * le type d'incident après l'affichage du résultat). Sans effet si le contrôle est déjà parti. */
export async function mettreAJourSignalementLocal(id: string, type_incident?: string, details_incident?: string): Promise<void> {
  const db = await obtenirBaseControle();
  const entree = await db.get("controles_locaux", id);
  if (!entree || !entree.brouillon) return;
  entree.type_incident = type_incident || undefined;
  entree.details_incident = details_incident?.trim() || undefined;
  await db.put("controles_locaux", entree);
}

/** Passe un brouillon en « à envoyer » puis lance l'envoi. */
export async function validerBrouillonControle(id: string | null): Promise<void> {
  if (!id) return;
  const db = await obtenirBaseControle();
  const entree = await db.get("controles_locaux", id);
  if (entree?.brouillon) {
    entree.brouillon = undefined;
    await db.put("controles_locaux", entree);
  }
  if (navigator.onLine) void viderFileControles();
}

/** Filet de sécurité : tout brouillon restant (agent parti de l'écran, application fermée) est
 * promu en contrôle à envoyer — un contrôle effectué n'est jamais perdu. */
export async function validerTousBrouillonsControle(): Promise<void> {
  const db = await obtenirBaseControle();
  const tous = await db.getAllFromIndex("controles_locaux", "par-statut", "en_attente");
  let nb = 0;
  for (const entree of tous) {
    if (entree.brouillon) {
      entree.brouillon = undefined;
      await db.put("controles_locaux", entree);
      nb += 1;
    }
  }
  if (nb > 0 && navigator.onLine) void viderFileControles();
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
      if (entree.brouillon) continue; // signalement encore en cours de saisie
      try {
        const payload: ControleCreate = {
          passeport_id: entree.passeport_id,
          qr_uuid: entree.qr_uuid,
          poste_id: entree.poste_id,
          mode: entree.mode,
          latitude: entree.latitude,
          longitude: entree.longitude,
          motif: entree.motif,
          type_incident: entree.type_incident,
          details_incident: entree.details_incident,
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
