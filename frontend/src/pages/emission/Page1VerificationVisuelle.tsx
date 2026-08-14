import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { validerPageLocalement } from "@/db/queueEmission";

interface Page1Props {
  passeportId: string;
  onValidee: () => void;
}

/**
 * Page 1 — vérification visuelle du document physique (Document technique,
 * Module 4) : l'agent contrôle à l'œil nu la présence et la lisibilité des
 * éléments de sécurité (guilloché, zone de lecture automatique, numéro
 * imprimé) puis atteste leur conformité. AUCUNE photo n'est prise, AUCUNE
 * image n'est transmise ni conservée à cette étape — c'est le principe
 * central du Module 4, rappelé explicitement dans le document technique.
 */
export default function Page1VerificationVisuelle({ passeportId, onValidee }: Page1Props) {
  const [enCours, setEnCours] = useState(false);

  const confirmer = async () => {
    setEnCours(true);
    try {
      // donnees_json = null : cette page ne produit aucune donnée à stocker,
      // seul son franchissement (page 1 validée) importe.
      await validerPageLocalement(passeportId, 1, null);
      onValidee();
    } finally {
      setEnCours(false);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-gray-900">1 · Vérification visuelle</h2>
      <p className="text-sm text-gray-500">
        Contrôlez le document physique avant de continuer — aucune photo n'est prise à cette étape.
      </p>

      <ul className="space-y-2 rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-700">
        <li>• Le numéro imprimé correspond au lot remis (Pays-Année-N° de lot)</li>
        <li>• Le QR Code de validation est présent et net</li>
        <li>• La zone de lecture automatique n'est pas endommagée</li>
        <li>• Le guilloché et les éléments de sécurité sont visibles</li>
      </ul>

      <button
        onClick={confirmer}
        disabled={enCours}
        className="flex w-full items-center justify-center gap-2 rounded-md bg-cebevirha px-4 py-3 text-sm font-medium text-white hover:bg-cebevirha-light disabled:opacity-50"
      >
        <ShieldCheck size={18} />
        {enCours ? "Validation…" : "Document conforme — continuer"}
      </button>
    </div>
  );
}
