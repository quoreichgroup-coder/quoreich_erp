import { FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportToCSV } from "@/lib/csv-export";
import { exportToXLSX } from "@/lib/xlsx";

/*
 * Export d'un tableau en Excel (.xlsx : une valeur par cellule, en-tête figé et filtrable) ou en CSV
 * (séparateur « ; », lisible en colonnes par Excel en français). Mêmes colonnes et en-têtes.
 */
type Column<T> = { key: keyof T; header: string; width?: number };

export function ExportButtons<T extends Record<string, unknown>>({ label, rows, columns, filename, sheetName, disabled }: {
  label: string; rows: T[]; columns: Column<T>[]; filename: string; sheetName?: string; disabled?: boolean;
}) {
  const off = disabled || rows.length === 0;
  return (
    <span className="inline-flex" role="group" aria-label={label}>
      <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 rounded-r-none" disabled={off}
        onClick={() => exportToXLSX(rows, columns, filename, sheetName ?? label)}><FileSpreadsheet className="w-3.5 h-3.5" /> {label} (Excel)</Button>
      <Button size="sm" variant="outline" className="h-8 text-xs rounded-l-none border-l-0" disabled={off} aria-label={`${label} (CSV)`}
        onClick={() => exportToCSV(rows, columns, filename)}>CSV</Button>
    </span>
  );
}
