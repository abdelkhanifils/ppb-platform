import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

/**
 * Export Excel/PDF générique, réutilisé par chaque section de Statistiques
 * (voir <BoutonsExport> ci-dessous) — un seul point d'implémentation plutôt
 * qu'une logique dupliquée par graphique/tableau. Prend toujours des
 * données déjà tabulaires (colonnes + lignes), jamais un composant graphique
 * directement : plus fiable et lisible qu'une capture d'écran d'un
 * graphique (mise en page imprévisible selon la taille d'écran), et
 * ré-exploitable tel quel dans un tableur.
 */

export interface ColonneExport {
  cle: string;
  titre: string;
}

function nomFichierHorodate(base: string, extension: string): string {
  const horodatage = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  return `${base}-${horodatage}.${extension}`;
}

export function exporterExcel(nomBase: string, titre: string, colonnes: ColonneExport[], lignes: Record<string, string | number>[]): void {
  const feuille = XLSX.utils.json_to_sheet(
    lignes.map((ligne) => Object.fromEntries(colonnes.map((c) => [c.titre, ligne[c.cle] ?? ""]))),
    { header: colonnes.map((c) => c.titre) }
  );
  // Largeur de colonne ajustée au contenu le plus long (titre compris) —
  // sans ça, chaque colonne reste à la largeur par défaut d'Excel et le
  // fichier généré est illisible sans redimensionnement manuel.
  feuille["!cols"] = colonnes.map((c) => {
    const largeurMax = Math.max(c.titre.length, ...lignes.map((l) => String(l[c.cle] ?? "").length));
    return { wch: Math.min(largeurMax + 2, 60) };
  });
  const classeur = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(classeur, feuille, titre.slice(0, 31)); // 31 caractères : limite Excel du nom d'onglet
  XLSX.writeFile(classeur, nomFichierHorodate(nomBase, "xlsx"));
}

export function exporterPDF(nomBase: string, titre: string, colonnes: ColonneExport[], lignes: Record<string, string | number>[]): void {
  const doc = new jsPDF({ orientation: colonnes.length > 5 ? "landscape" : "portrait" });
  doc.setFontSize(14);
  doc.setTextColor(11, 107, 58); // vert CEBEVIRHA — cohérence avec le reste des documents de la plateforme
  doc.text(titre, 14, 16);
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text(`Généré le ${new Date().toLocaleString("fr-FR")} — CEBEVIRHA / FLUVIAC`, 14, 22);

  autoTable(doc, {
    startY: 28,
    head: [colonnes.map((c) => c.titre)],
    body: lignes.map((ligne) => colonnes.map((c) => String(ligne[c.cle] ?? ""))),
    headStyles: { fillColor: [11, 107, 58], textColor: 255, fontSize: 9 },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [234, 243, 236] }, // même vert clair que le reste des tableaux de la plateforme
    margin: { left: 14, right: 14 },
  });

  doc.save(nomFichierHorodate(nomBase, "pdf"));
}
