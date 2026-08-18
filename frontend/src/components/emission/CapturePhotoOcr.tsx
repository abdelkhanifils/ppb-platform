import { useState } from "react";
import axios from "axios";
import { Camera, Loader2, Sparkles } from "lucide-react";
import { envoyerPhotoOcrImmediatement, mettreEnAttentePhotoOcr } from "@/db/cacheOcr";
import type { ChampsOcrPage3, ChampsOcrPage4 } from "@/types/ocr";

interface CapturePhotoOcrProps {
  passeportId: string;
  pageNum: 3 | 4;
  onSuggestion: (champs: ChampsOcrPage3 | ChampsOcrPage4) => void;
}

/**
 * Bouton de capture photo pour le pré-remplissage OCR (pages 3/4) —
 * TOUJOURS optionnel, jamais un passage obligé : le formulaire manuel reste
 * disponible et identique juste en dessous, que cette capture soit utilisée
 * ou non (voir Page3Identification / Page4Troupeau).
 *
 * En ligne : envoi immédiat, pré-remplissage en quelques secondes.
 * Hors-ligne (ou réseau qui se révèle indisponible malgré tout) : la photo
 * est mise en attente localement (voir db/cacheOcr.ts), traitée dès que le
 * réseau revient — la suggestion apparaîtra alors au prochain passage sur
 * cette page pour ce passeport, jamais perdue.
 */
export default function CapturePhotoOcr({ passeportId, pageNum, onSuggestion }: CapturePhotoOcrProps) {
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const surSelectionPhoto = async (fichier: File) => {
    setEnCours(true);
    setMessage(null);
    try {
      if (navigator.onLine) {
        const champs = await envoyerPhotoOcrImmediatement(passeportId, pageNum, fichier);
        onSuggestion(champs);
        setMessage("Formulaire pré-rempli ci-dessous — vérifiez et corrigez si besoin avant de valider.");
      } else {
        await mettreEnAttentePhotoOcr(passeportId, pageNum, fichier);
        setMessage("Hors-ligne : la reconnaissance se fera dès que le réseau reviendra. Vous pouvez remplir manuellement en attendant.");
      }
    } catch (erreur) {
      // Distinction importante : une VRAIE coupure réseau (aucune réponse
      // reçue) justifie la mise en attente hors-ligne — mais une erreur
      // renvoyée PAR le serveur (ex. 503 « compte de service Google non
      // configuré ») n'a rien à voir avec la connexion, et la remettre en
      // attente ne ferait qu'échouer à nouveau plus tard pour la même
      // raison. Bug corrigé ici : les deux cas affichaient auparavant le
      // même message trompeur « connexion instable ».
      const estErreurReseau = axios.isAxiosError(erreur) && !erreur.response;
      const messageServeur = axios.isAxiosError(erreur) ? (erreur.response?.data as { detail?: string } | undefined)?.detail : undefined;

      if (estErreurReseau) {
        try {
          await mettreEnAttentePhotoOcr(passeportId, pageNum, fichier);
          setMessage("Connexion instable — photo mise en attente, remplissez manuellement en attendant.");
        } catch {
          setMessage("La photo n'a pas pu être prise en compte — remplissez le formulaire manuellement.");
        }
      } else {
        setMessage(
          messageServeur
            ? `Reconnaissance indisponible : ${messageServeur}`
            : "La reconnaissance a échoué (erreur serveur) — remplissez le formulaire manuellement."
        );
      }
    } finally {
      setEnCours(false);
    }
  };

  return (
    <div className="rounded-lg border border-dashed border-cebevirha/40 bg-cebevirha/5 p-3">
      <label className="flex cursor-pointer items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium text-cebevirha">
          {enCours ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
          {enCours ? "Reconnaissance en cours…" : "Photographier la page pour pré-remplir (optionnel)"}
        </span>
        <Camera size={18} className="text-cebevirha" />
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          disabled={enCours}
          onChange={(e) => {
            const fichier = e.target.files?.[0];
            if (fichier) void surSelectionPhoto(fichier);
            e.target.value = "";
          }}
        />
      </label>
      {message && <p className="mt-2 text-xs text-gray-600">{message}</p>}
    </div>
  );
}
