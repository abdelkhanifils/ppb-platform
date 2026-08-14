import { apiClient } from "@/api/client";
import type { DonneesPage } from "@/types/emission";
import { obtenirBase } from "./db";
import type { EntreeFileSynchronisation } from "./schema";

/**
 * File de synchronisation du Module 4 — cœur du fonctionnement hors-ligne.
 *
 * Principe : `validerPageLocalement` est LA seule action que l'écran de
 * saisie déclenche à la validation d'une page par l'agent. Elle écrit dans
 * IndexedDB de façon synchrone et fiable, puis tente un envoi immédiat si le
 * réseau est là — mais l'agent n'attend jamais cet envoi : la validation
 * terrain est déjà actée localement, l'UI peut passer à la page suivante
 * sans délai. C'est `viderFile` (déclenchée par useSyncManager et par le
 * Service Worker) qui a la charge de faire converger la file locale vers le
 * serveur, avec autant de tentatives que nécessaire.
 */

function genererIdLocal(): string {
  return crypto.randomUUID();
}

export async function validerPageLocalement(
  passeportId: string,
  pageNum: 1 | 2 | 3 | 4,
  donneesJson: DonneesPage
): Promise<void> {
  const db = await obtenirBase();
  const entree: EntreeFileSynchronisation = {
    id: genererIdLocal(),
    passeport_id: passeportId,
    page_num: pageNum,
    donnees_json: donneesJson,
    cree_le: new Date().toISOString(),
    statut: "en_attente",
    tentatives: 0,
    derniere_erreur: null,
  };
  await db.add("file_synchronisation", entree);

  // Tentative immédiate, best-effort — jamais bloquante pour l'agent.
  if (navigator.onLine) {
    void viderFile();
  }
}

/**
 * Pages déjà actées pour un passeport donné — qu'elles soient encore en file
 * locale ou déjà confirmées côté serveur. Sert à l'UI de progression
 * (« 2 sur 4 pages validées ») sans jamais dépendre du réseau.
 */
export async function obtenirProgressionPasseport(passeportId: string): Promise<Set<1 | 2 | 3 | 4>> {
  const db = await obtenirBase();
  const toutesConfirmees = await db.getAll("numerisations_confirmees");
  const enFilePourPasseport = await db.getAllFromIndex("file_synchronisation", "par-passeport", passeportId);

  const pages = new Set<1 | 2 | 3 | 4>();
  for (const confirmee of toutesConfirmees) {
    if (confirmee.passeport_id === passeportId) pages.add(confirmee.page_num);
  }
  for (const enFile of enFilePourPasseport) {
    pages.add(enFile.page_num);
  }
  return pages;
}

let videEnCours = false;

/**
 * Envoie au serveur toutes les entrées en attente, dans l'ordre de création
 * (une page 3 doit arriver avant une page 4 pour le même passeport — le
 * backend n'impose pas cet ordre, mais le respecter simplifie le diagnostic
 * en cas d'échec partiel). Réentrant : un appel concurrent pendant qu'un
 * autre est en cours ne fait rien (évite l'envoi en double).
 */
export async function viderFile(): Promise<{ envoyees: number; echouees: number }> {
  if (videEnCours) return { envoyees: 0, echouees: 0 };
  videEnCours = true;

  try {
    const db = await obtenirBase();
    const enAttente = (await db.getAllFromIndex("file_synchronisation", "par-statut", "en_attente")).sort((a, b) =>
      a.cree_le.localeCompare(b.cree_le)
    );

    let envoyees = 0;
    let echouees = 0;

    for (const entree of enAttente) {
      try {
        // Le backend expose `donnees_json: dict | None` comme UNIQUE paramètre de
        // corps, sans `embed=True` — FastAPI attend donc le corps JSON brut (le
        // dict lui-même, ou `null`), jamais un objet enveloppant. Un `{ donnees_json: ... }`
        // serait accepté par erreur comme un dict à un seul champ et casserait
        // silencieusement la création des entités métier côté serveur.
        //
        // Piège Axios : `axios.post(url, null)` n'envoie généralement AUCUN corps
        // (null n'est pas reconnu comme un objet à sérialiser) — sans corps, un
        // paramètre de corps obligatoire côté FastAPI répond 422. On force donc
        // explicitement la sérialisation JSON, y compris pour `null` (pages 1 et 2).
        await apiClient.post(
          `/numerisations/${entree.passeport_id}/pages/${entree.page_num}`,
          JSON.stringify(entree.donnees_json),
          { headers: { "Content-Type": "application/json" } }
        );

        await db.delete("file_synchronisation", entree.id);
        await db.put("numerisations_confirmees", {
          passeport_id: entree.passeport_id,
          page_num: entree.page_num,
          synchronisee_le: new Date().toISOString(),
        });
        envoyees += 1;
      } catch (erreur) {
        // Erreur réseau (hors-ligne, timeout) : on retentera plus tard, sans
        // pénaliser l'entrée. Erreur HTTP 4xx (ex. passeport déjà émis) :
        // on la marque "echouee" pour que l'UI puisse alerter l'agent — la
        // renvoyer indéfiniment n'aurait aucune chance d'aboutir.
        const estErreurHttp = erreurEstReponseHttp(erreur);
        entree.tentatives += 1;
        entree.derniere_erreur = messageErreur(erreur);
        entree.statut = estErreurHttp ? "echouee" : "en_attente";
        await db.put("file_synchronisation", entree);
        echouees += 1;
        if (!estErreurHttp) break; // hors-ligne : inutile d'essayer les suivantes maintenant
      }
    }

    return { envoyees, echouees };
  } finally {
    videEnCours = false;
  }
}

/** Entrées bloquées en erreur définitive (4xx) — nécessitent une action de
 * l'agent (correction) ou d'un superviseur, jamais un simple nouvel essai. */
export async function listerEntreesEnEchec(): Promise<EntreeFileSynchronisation[]> {
  const db = await obtenirBase();
  return db.getAllFromIndex("file_synchronisation", "par-statut", "echouee");
}

export async function reessayerEntree(id: string): Promise<void> {
  const db = await obtenirBase();
  const entree = await db.get("file_synchronisation", id);
  if (!entree) return;
  entree.statut = "en_attente";
  await db.put("file_synchronisation", entree);
  if (navigator.onLine) void viderFile();
}

function erreurEstReponseHttp(erreur: unknown): boolean {
  return (
    typeof erreur === "object" &&
    erreur !== null &&
    "response" in erreur &&
    (erreur as { response?: unknown }).response !== undefined
  );
}

function messageErreur(erreur: unknown): string {
  if (erreurEstReponseHttp(erreur)) {
    const avecReponse = erreur as { response: { status: number; data?: { detail?: string } } };
    return avecReponse.response.data?.detail ?? `Erreur HTTP ${avecReponse.response.status}`;
  }
  return "Réseau indisponible — nouvel essai automatique dès que possible.";
}
