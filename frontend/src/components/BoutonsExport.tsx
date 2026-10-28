import { usePeriode } from "@/lib/periode";
import { FileDown, FileSpreadsheet } from "lucide-react";
import { exporterExcel, exporterPDF, type ColonneExport } from "@/lib/export";
import { useI18n } from "@/lib/i18n";

/**
 * Paire de boutons d'export (PDF, Excel), attachée à chaque section
 * exportable de Statistiques — voir lib/export.ts pour la logique
 * commune. `lignes`/`colonnes` doivent refléter EXACTEMENT ce qui est
 * affiché à l'écran au moment du clic (mêmes filtres appliqués), jamais
 * une requête séparée : l'agent exporte ce qu'il voit, pas autre chose.
 */
export function BoutonsExport({
  nomBase,
  titre,
  colonnes,
  lignes,
  periode: periodeFournie,
}: {
  nomBase: string;
  titre: string;
  colonnes: ColonneExport[];
  lignes: Record<string, string | number>[];
  /** Période propre à la section (sinon la période globale des statistiques). */
  periode?: { debut: string; fin: string };
}) {
  const { t } = useI18n();
  const periodeCtx = usePeriode();
  const p = periodeFournie ?? periodeCtx;
  const fr = (d: string) => new Date(d).toLocaleDateString("fr-FR");
  const periode = p.debut || p.fin ? `du ${p.debut ? fr(p.debut) : "…"} au ${p.fin ? fr(p.fin) : "…"}` : "";
  const desactive = lignes.length === 0;
  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => exporterPDF(nomBase, titre, colonnes, lignes, periode)}
        disabled={desactive}
        title={t("statistiques.exporter_pdf")}
        className="flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <FileDown size={13} /> PDF
      </button>
      <button
        onClick={() => exporterExcel(nomBase, titre, colonnes, lignes, periode)}
        disabled={desactive}
        title={t("statistiques.exporter_excel_titre")}
        className="flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <FileSpreadsheet size={13} /> Excel
      </button>
    </div>
  );
}
