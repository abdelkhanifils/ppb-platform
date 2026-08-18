import { apiClient } from "@/api/client";
import type { ChampsOcrPage3, ChampsOcrPage4, ReponseOcrApi } from "@/types/ocr";
import { obtenirBase } from "./db";

/**
 * OCR assisté (pages 3/4) — deux temps, jamais couplés directement :
 * 1. La photo est mise en attente localement dès qu'elle est prise (voir
 *    `mettreEnAttentePhotoOcr`) — fonctionne hors-ligne.
 * 2. Dès que le réseau est là, `traiterFileOcr` envoie les photos en
 *    attente et enregistre les suggestions reçues (voir
 *    `enregistrerSuggestion`) — que la page 3/4 concernée soit ouverte à
 *    ce moment-là ou non. L'agent la découvre à l'ouverture de la page
 *    (voir `obtenirEtConsommerSuggestion`), jamais imposée silencieusement.
 */

function genererIdLocal(): string {
  return crypto.randomUUID();
}

export async function mettreEnAttentePhotoOcr(passeportId: string, pageNum: 3 | 4, photo: Blob): Promise<void> {
  const db = await obtenirBase();
  await db.put("photos_ocr_en_attente", {
    id: genererIdLocal(),
    passeport_id: passeportId,
    page_num: pageNum,
    photo,
    cree_le: new Date().toISOString(),
    tentatives: 0,
    derniere_erreur: null,
  });
}

export async function compterPhotosEnAttente(): Promise<number> {
  const db = await obtenirBase();
  return db.count("photos_ocr_en_attente");
}

async function enregistrerSuggestion(passeportId: string, pageNum: 3 | 4, champs: ChampsOcrPage3 | ChampsOcrPage4): Promise<void> {
  const db = await obtenirBase();
  await db.put("suggestions_ocr", { passeport_id: passeportId, page_num: pageNum, champs, recue_le: new Date().toISOString() });
}

/** Renvoie la suggestion en attente pour cette page, et la retire du store
 * (consommée une seule fois — un nouvel appel OCR en produira une nouvelle
 * si besoin, jamais une suggestion périmée qui traînerait indéfiniment). */
export async function obtenirEtConsommerSuggestion(
  passeportId: string,
  pageNum: 3 | 4
): Promise<ChampsOcrPage3 | ChampsOcrPage4 | null> {
  const db = await obtenirBase();
  const entree = await db.get("suggestions_ocr", [passeportId, pageNum]);
  if (!entree) return null;
  await db.delete("suggestions_ocr", [passeportId, pageNum]);
  return entree.champs;
}

/** Envoie immédiatement une photo (agent en ligne au moment de la prise) —
 * ne passe PAS par la file d'attente locale : retour direct pour un
 * pré-remplissage instantané, plus réactif que d'attendre le prochain
 * passage de `traiterFileOcr`. En cas d'échec réseau, l'appelant peut
 * retomber sur `mettreEnAttentePhotoOcr`. */
export async function envoyerPhotoOcrImmediatement(
  passeportId: string,
  pageNum: 3 | 4,
  photo: Blob
): Promise<ChampsOcrPage3 | ChampsOcrPage4> {
  const formulaire = new FormData();
  formulaire.append("photo", photo, `page${pageNum}.jpg`);
  const { data } = await apiClient.post<ReponseOcrApi<ChampsOcrPage3 | ChampsOcrPage4>>(
    `/numerisations/${passeportId}/pages/${pageNum}/ocr`,
    formulaire,
    { headers: { "Content-Type": "multipart/form-data" } }
  );
  return data.champs;
}

/** Traite la file d'attente locale — appelé par le gestionnaire de
 * synchronisation (voir hooks/useSyncManager.ts) dès que le réseau revient.
 * Chaque photo traitée avec succès est retirée de la file ; un échec
 * incrémente son compteur de tentatives et reste en attente (jamais
 * silencieusement perdue). */
export async function traiterFileOcr(): Promise<{ traitees: number; echouees: number }> {
  const db = await obtenirBase();
  const enAttente = await db.getAll("photos_ocr_en_attente");
  let traitees = 0;
  let echouees = 0;

  for (const entree of enAttente) {
    try {
      const champs = await envoyerPhotoOcrImmediatement(entree.passeport_id, entree.page_num, entree.photo);
      await enregistrerSuggestion(entree.passeport_id, entree.page_num, champs);
      await db.delete("photos_ocr_en_attente", entree.id);
      traitees += 1;
    } catch (erreur) {
      await db.put("photos_ocr_en_attente", {
        ...entree,
        tentatives: entree.tentatives + 1,
        derniere_erreur: erreur instanceof Error ? erreur.message : "Erreur inconnue",
      });
      echouees += 1;
    }
  }

  return { traitees, echouees };
}
