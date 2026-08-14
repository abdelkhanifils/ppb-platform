import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import type { ResultatControle } from "@/types/controle";

interface ResultatControleCarteProps {
  numero: string;
  resultat: ResultatControle;
  signatureValide: boolean;
  conformeItineraire: boolean | null;
}

const STYLES: Record<ResultatControle, { fond: string; texte: string; icone: typeof CheckCircle2; libelle: string }> = {
  valide: { fond: "bg-green-50 border-green-200", texte: "text-green-800", icone: CheckCircle2, libelle: "PASSEPORT VALIDE" },
  refuse: { fond: "bg-red-50 border-red-200", texte: "text-red-800", icone: XCircle, libelle: "REFUSÉ" },
  a_verifier: { fond: "bg-amber-50 border-amber-200", texte: "text-amber-800", icone: AlertTriangle, libelle: "À VÉRIFIER — repli papier" },
};

/** Affiche le résultat d'un contrôle — calculé intégralement en local (voir
 * services/verificationSignature.ts et services/conformiteItineraire.ts),
 * jamais en attente d'une réponse serveur. */
export default function ResultatControleCarte({ numero, resultat, signatureValide, conformeItineraire }: ResultatControleCarteProps) {
  const style = STYLES[resultat];
  const Icone = style.icone;

  return (
    <div className={`space-y-3 rounded-lg border-2 p-5 ${style.fond}`}>
      <div className={`flex items-center gap-2 ${style.texte}`}>
        <Icone size={28} />
        <p className="text-lg font-bold">{style.libelle}</p>
      </div>
      <p className="font-mono text-sm text-gray-700">{numero}</p>

      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt className="text-gray-500">Authenticité (signature)</dt>
        <dd className={signatureValide ? "text-green-700" : "text-red-700"}>{signatureValide ? "Confirmée" : "Invalide"}</dd>

        <dt className="text-gray-500">Conformité au trajet</dt>
        <dd className={conformeItineraire === null ? "text-amber-700" : conformeItineraire ? "text-green-700" : "text-red-700"}>
          {conformeItineraire === null ? "Non vérifiable — voir document papier" : conformeItineraire ? "Conforme" : "Non conforme"}
        </dd>
      </dl>
    </div>
  );
}
