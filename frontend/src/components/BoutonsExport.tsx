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
}: {
  nomBase: string;
  titre: string;
  colonnes: ColonneExport[];
  lignes: Record<string, string | number>[];
}) {
  const { t } = useI18n();
  const desactive = lignes.length === 0;
  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => exporterPDF(nomBase, titre, colonnes, lignes)}
        disabled={desactive}
        title={t("statistiques.exporter_pdf")}
        className="flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <FileDown size={13} /> PDF
      </button>
      <button
        onClick={() => exporterExcel(nomBase, titre, colonnes, lignes)}
        disabled={desactive}
        title={t("statistiques.exporter_excel_titre")}
        className="flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <FileSpreadsheet size={13} /> Excel
      </button>
    </div>
  );
}
