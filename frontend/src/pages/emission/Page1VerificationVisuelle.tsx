import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { validerPageLocalement } from "@/db/queueEmission";
import { useI18n } from "@/lib/i18n";

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
  const { t } = useI18n();
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
      <h2 className="text-base font-semibold text-gray-900">{t("page1.titre")}</h2>
      <p className="text-sm text-gray-500">{t("page1.intro")}</p>

      <ul className="space-y-2 rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-700">
        <li>• {t("page1.critere_numero")}</li>
        <li>• {t("page1.critere_qr")}</li>
        <li>• {t("page1.critere_zone")}</li>
        <li>• {t("page1.critere_securite")}</li>
      </ul>

      <button
        onClick={confirmer}
        disabled={enCours}
        className="flex w-full items-center justify-center gap-2 rounded-md bg-cebevirha px-4 py-3 text-sm font-medium text-white hover:bg-cebevirha-light disabled:opacity-50"
      >
        <ShieldCheck size={18} />
        {enCours ? t("page1.validation") : t("page1.valider")}
      </button>
    </div>
  );
}
