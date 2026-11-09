import type { RowInput } from "jspdf-autotable";

export type PdfColumn<T> = {
  key: keyof T | string;
  header: string;
  /** Optional per-row formatter (e.g. for RBAC masking). */
  format?: (row: T) => string | number;
};

export type PdfExportOptions<T> = {
  filename: string;
  title: string;
  /** Sub-line under the title — useful for filter summaries. */
  subtitle?: string;
  columns: PdfColumn<T>[];
  rows: T[];
  orientation?: "portrait" | "landscape";
};

/**
 * Generic PDF table exporter — mirrors `exportToCSV` so PDF and CSV outputs
 * stay aligned (same filters, same RBAC masking via the `format` callback).
 *
 * `jspdf` et `jspdf-autotable` pèsent ensemble ~680 kB : ils sont chargés à la
 * demande, au moment du clic, au lieu d'être embarqués dans le chunk de chaque
 * page qui sait exporter. Les appelants peuvent ignorer la promesse.
 */
export async function exportToPDF<T extends Record<string, unknown>>(
  opts: PdfExportOptions<T>,
): Promise<void> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new jsPDF({ orientation: opts.orientation ?? "landscape", unit: "pt", format: "a4" });
  const margin = 32;

  doc.setFontSize(13);
  doc.text(opts.title, margin, margin);

  doc.setFontSize(9);
  doc.setTextColor(110);
  const stamp = new Date().toLocaleString("fr-FR");
  doc.text(`Généré le ${stamp}`, margin, margin + 14);
  if (opts.subtitle) doc.text(opts.subtitle, margin, margin + 28);

  const head = [opts.columns.map((c) => c.header)];
  const body: RowInput[] = opts.rows.map((row) =>
    opts.columns.map((c) => {
      const v = c.format ? c.format(row) : (row[c.key as keyof T] as unknown);
      return v === null || v === undefined ? "" : String(v);
    }),
  );

  autoTable(doc, {
    head,
    body,
    startY: margin + (opts.subtitle ? 40 : 26),
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255 },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    margin: { left: margin, right: margin },
  });

  const name = opts.filename.endsWith(".pdf") ? opts.filename : `${opts.filename}.pdf`;
  doc.save(name);
}