import { FileSpreadsheet, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportToCSV } from "@/lib/csv-export";
import { exportToXLSX } from "@/lib/xlsx";
import { exportToPDF } from "@/lib/pdf-export";

/*
 * Export d'un tableau en Excel (.xlsx : une valeur par cellule, en-tête figé et filtrable) ou en CSV
 * (séparateur « ; », lisible en colonnes par Excel en français) ou en PDF A4 paysage (liste imprimable).
 * Mêmes lignes, mêmes colonnes et en-têtes dans les trois formats.
 */
type Column<T> = { key: keyof T; header: string; width?: number };

export function ExportButtons<T extends Record<string, unknown>>({ label, rows, columns, filename, sheetName, disabled, pdfTitle, pdfSubtitle, pdf = true }: {
  label: string; rows: T[]; columns: Column<T>[]; filename: string; sheetName?: string; disabled?: boolean;
  /** Titre de la liste imprimée (par défaut le libellé). */
  pdfTitle?: string; pdfSubtitle?: string;
  /** Faux quand l'écran a déjà son propre PDF (masquage, aperçu). */
  pdf?: boolean;
}) {
  const off = disabled || rows.length === 0;
  return (
    <span className="inline-flex" role="group" aria-label={label}>
      <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 rounded-r-none" disabled={off}
        onClick={() => exportToXLSX(rows, columns, filename, sheetName ?? label)}><FileSpreadsheet className="w-3.5 h-3.5" /> {label} (Excel)</Button>
      <Button size="sm" variant="outline" className={`h-8 text-xs border-l-0 ${pdf ? "rounded-none" : "rounded-l-none"}`} disabled={off} aria-label={`${label} (CSV)`}
        onClick={() => exportToCSV(rows, columns, filename)}>CSV</Button>
      {pdf && (
      <Button size="sm" variant="outline" className="h-8 text-xs gap-1 rounded-l-none border-l-0" disabled={off} aria-label={`${label} (PDF)`}
        onClick={() => void exportToPDF({ filename, title: pdfTitle ?? label, subtitle: pdfSubtitle ?? `${rows.length} ligne(s) · édité le ${new Date().toLocaleDateString("fr-FR")}`,
          columns: columns.map((c) => ({ key: c.key as string, header: c.header,
            format: (r: T) => { const v = r[c.key]; return typeof v === "number" ? v.toLocaleString("fr-FR", { maximumFractionDigits: 2 }) : v == null ? "" : String(v); } })),
          rows })}><FileText className="w-3 h-3" /> PDF</Button>
      )}
    </span>
  );
}
