import type { RowInput } from "jspdf-autotable";
import { toast } from "sonner";

/**
 * Texte imprimable par les polices standard du PDF (jeu WinAnsi) : les espaces insécables que
 * produit `toLocaleString("fr-FR")` (U+202F, U+00A0) s'imprimaient « 125/000 », et quelques signes
 * (flèche, moins typographique, ≤ ≥) n'existent pas dans la police.
 */
export function pdfSafe(s: string): string {
  return s.replace(/[\u202f\u00a0\u2007\u2009]/g, " ").replace(/\u2192/g, "->").replace(/\u2190/g, "<-")
    .replace(/\u2212/g, "-").replace(/\u2264/g, "<=").replace(/\u2265/g, ">=").replace(/\u2713/g, "oui");
}

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
  doc.text(pdfSafe(opts.title), margin, margin);

  doc.setFontSize(9);
  doc.setTextColor(110);
  const stamp = new Date().toLocaleString("fr-FR");
  doc.text(`Généré le ${stamp}`, margin, margin + 14);
  // Sous-titre replié à la largeur de la page (en-tête d'une pièce : plusieurs champs).
  const subtitleLines: string[] = opts.subtitle
    ? doc.splitTextToSize(pdfSafe(opts.subtitle), doc.internal.pageSize.getWidth() - 2 * margin)
    : [];
  if (subtitleLines.length) doc.text(subtitleLines, margin, margin + 28);

  const head = [opts.columns.map((c) => pdfSafe(c.header))];
  const body: RowInput[] = opts.rows.map((row) =>
    opts.columns.map((c) => {
      const v = c.format ? c.format(row) : (row[c.key as keyof T] as unknown);
      if (v === null || v === undefined) return "";
      return pdfSafe(typeof v === "number" && Number.isFinite(v)
        ? v.toLocaleString("fr-FR", { maximumFractionDigits: 2 })
        : String(v));
    }),
  );

  autoTable(doc, {
    head,
    body,
    startY: margin + (subtitleLines.length ? 28 + subtitleLines.length * 11 : 26),
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255 },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    margin: { left: margin, right: margin },
    showHead: "everyPage",
    rowPageBreak: "avoid",
  });

  const pageCount = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page);
    doc.setFontSize(8);
    doc.setTextColor(110);
    doc.text(`${page} / ${pageCount}`, pageWidth - margin, pageHeight - margin / 2, { align: "right" });
  }

  const name = opts.filename.endsWith(".pdf") ? opts.filename : `${opts.filename}.pdf`;
  doc.save(name);
}
