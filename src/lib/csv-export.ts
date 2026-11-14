/*
 * Export CSV sans dépendance, au format qu'Excel en français ouvre en colonnes : séparateur « ; »,
 * fins de ligne Windows, nombres à virgule décimale, encodage UTF-8 avec BOM (accents corrects).
 * Avec une virgule pour séparateur, Excel (paramètres régionaux français) mettait toute la ligne dans
 * la colonne A. Les imports de l'application détectent le séparateur (« ; » ou « , »).
 */
export const CSV_SEPARATOR = ";";

export function csvValue(v: unknown): string {
  const s = v === null || v === undefined ? "" : typeof v === "number" && Number.isFinite(v) ? String(v).replace(".", ",") : String(v);
  return /[";\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCSV<T extends Record<string, unknown>>(rows: T[], columns: { key: keyof T; header: string }[]): string {
  const header = columns.map((c) => csvValue(c.header)).join(CSV_SEPARATOR);
  const body = rows.map((r) => columns.map((c) => csvValue(r[c.key])).join(CSV_SEPARATOR));
  return "\uFEFF" + [header, ...body].join("\r\n") + "\r\n";
}

export function exportToCSV<T extends Record<string, unknown>>(
  rows: T[],
  columns: { key: keyof T; header: string }[],
  filename: string
) {
  const blob = new Blob([buildCSV(rows, columns)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
