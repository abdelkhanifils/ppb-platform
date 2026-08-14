import { apiClient } from "@/api/client";
import { obtenirBaseControle } from "./dbControle";

/**
 * Cache local de la clé publique de vérification (GET /passeports/cle-publique,
 * sans authentification côté backend — c'est par nature une donnée publique).
 * Change rarement (rotation de clé exceptionnelle, sous contrôle strict de la
 * CEBEVIRHA) : offline-first, comme les schémas du Module 4.
 */
const CLE_PARAMETRE = "cle_publique_pem";

export async function obtenirClePubliqueLocale(): Promise<string | undefined> {
  const db = await obtenirBaseControle();
  const entree = await db.get("parametres_locaux_controle", CLE_PARAMETRE);
  return entree?.valeur;
}

export async function rafraichirClePublique(): Promise<string> {
  const { data } = await apiClient.get<string>("/passeports/cle-publique", { responseType: "text" });
  const db = await obtenirBaseControle();
  await db.put("parametres_locaux_controle", { cle: CLE_PARAMETRE, valeur: data });
  return data;
}
