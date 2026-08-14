import { apiClient } from "@/api/client";
import type { SchemaFormulaire } from "@/types/emission";
import { obtenirBase } from "./db";

/**
 * Cache local des schémas dynamiques publiés par le Module Administration
 * (endpoint public GET /formulaires/{code}/schema). Offline-first : l'écran
 * de saisie lit TOUJOURS le cache local en premier — jamais d'attente
 * réseau bloquante pour afficher un formulaire déjà connu — et se contente
 * de rafraîchir le cache en tâche de fond dès que le réseau est là.
 *
 * `schema_version` (voir Document technique, Module Administration) permet
 * de savoir si le cache est encore à jour sans avoir à comparer les champs
 * un par un : un simple GET suffit, et le serveur fait foi.
 */

const CODES_FORMULAIRES_EMISSION = ["eleveur", "convoyeur", "troupeau"] as const;

export async function obtenirSchemaLocal(code: string): Promise<SchemaFormulaire | undefined> {
  const db = await obtenirBase();
  return db.get("schemas_formulaire", code);
}

export async function rafraichirSchema(code: string): Promise<SchemaFormulaire> {
  const { data } = await apiClient.get<SchemaFormulaire>(`/formulaires/${code}/schema`);
  const db = await obtenirBase();
  await db.put("schemas_formulaire", { ...data, recupere_le: new Date().toISOString() });
  return data;
}

/** À appeler à l'ouverture de l'app (ou en tâche de fond périodique) quand le
 * réseau est disponible — précharge les 3 formulaires du Module 4 avant que
 * l'agent n'en ait besoin sur le terrain, sans jamais bloquer l'UI dessus. */
export async function prechargerTousLesSchemas(): Promise<void> {
  await Promise.allSettled(CODES_FORMULAIRES_EMISSION.map((code) => rafraichirSchema(code)));
}
