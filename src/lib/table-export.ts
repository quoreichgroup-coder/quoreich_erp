import { exportToCSV } from "@/lib/csv-export";
import { exportToXLSX } from "@/lib/xlsx";
import { exportToPDF } from "@/lib/pdf-export";

/*
 * Export d'une liste dans le format choisi, avec les mêmes lignes et colonnes : CSV (« ; », Excel
 * français), Excel (.xlsx, en-tête figé et filtrable) ou PDF (A4 paysage, liste imprimable).
 */
export type ExportFormat = "csv" | "xlsx" | "pdf";

/** Titre lisible tiré d'un nom de fichier (« mouvements-de-stock » → « Mouvements de stock »). */
export function titleFromFilename(filename: string): string {
  const t = filename.replace(/\.(csv|xlsx|pdf)$/i, "").replace(/[-_]+/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "Liste";
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? v.toLocaleString("fr-FR", { maximumFractionDigits: 2 }) : "";
  if (typeof v === "boolean") return v ? "Oui" : "Non";
  return String(v);
}

export function exportTable<T extends Record<string, unknown>>(
  format: ExportFormat, rows: T[], columns: { key: keyof T; header: string }[], filename: string, title?: string,
): void {
  const base = filename.replace(/\.(csv|xlsx|pdf)$/i, "");
  if (format === "csv") return exportToCSV(rows, columns, base);
  if (format === "xlsx") return exportToXLSX(rows, columns, base, (title ?? titleFromFilename(base)).slice(0, 31));
  void exportToPDF({
    filename: base, title: title ?? titleFromFilename(base),
    subtitle: `${rows.length} ligne(s) · édité le ${new Date().toLocaleDateString("fr-FR")}`,
    columns: columns.map((c) => ({ key: c.key as string, header: c.header, format: (r: T) => cellText(r[c.key]) })),
    rows,
  });
}
