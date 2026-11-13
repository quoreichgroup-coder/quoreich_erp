import type { RowInput } from "jspdf-autotable";
import { toast } from "sonner";

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
 * page qui sait exporter.
 *
 * Échec : la plupart des appelants ignorent la promesse (bouton « PDF » d'un écran). Un rejet y
 * devenait un rejet non géré, sans aucun message pour l'utilisateur. Par défaut l'échec est donc
 * signalé ici, par un toast, et la promesse se résout à `false` — elle ne rejette jamais.
 * Un appelant qui gère lui-même l'échec (message propre, audit, toast de succès à n'afficher
 * qu'après coup) passe `{ throwOnError: true }` et l'attend avec `await`.
 */
export async function exportToPDF<T extends Record<string, unknown>>(
  opts: PdfExportOptions<T>,
  { throwOnError = false }: { throwOnError?: boolean } = {},
): Promise<boolean> {
  try {
    await renderPdf(opts);
    return true;
  } catch (e) {
    if (throwOnError) throw e;
    toast.error("Impossible de générer le PDF", {
      description: e instanceof Error && e.message ? e.message : "Erreur inattendue — réessayez.",
    });
    return false;
  }
}

async function renderPdf<T extends Record<string, unknown>>(opts: PdfExportOptions<T>): Promise<void> {
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