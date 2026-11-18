/**
 * Impression d'une pièce (devis, commande, livraison, facture, avoir, relevé, écriture…) au format
 * document A4 portrait, commun à tout l'ERP :
 *
 *   ┌ identité légale du vendeur (raison sociale, adresse, RCCM, IFU, régime, service des impôts) ┐
 *   │                                               TITRE DE LA PIÈCE · n° · date d'édition       │
 *   ├ cadre d'en-tête : tiers, dates, références, conditions                                      ┤
 *   ├ lignes (montants alignés à droite)                                                          ┤
 *   ├ pied : totaux à droite, montant arrêté en lettres, coordonnées bancaires                     ┤
 *   └ bas de page : mentions, page i / n                                                          ┘
 *
 * Références : Burkina Faso, CGI art. 562 et 564 (identité du vendeur et du client professionnel
 * sur la facture) ; pratique OHADA du « montant arrêté en lettres ». L'édition officielle (modèles
 * versionnés, archivage, facture électronique certifiée) relève du Lot 6 ; une mention vide est
 * imprimée « à renseigner » pour qu'elle se voie.
 */
import { toast } from "sonner";
import { pdfSafe } from "@/lib/pdf-export";
import { buildXlsxSheet, downloadXlsx, type XlsxCell } from "@/lib/xlsx";

export interface CompanyIdentity {
  name: string;
  legal_name?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  rccm?: string | null;
  tax_id?: string | null;
  tax_regime?: string | null;
  tax_office?: string | null;
  bank_details?: string | null;
}

export interface DocumentPdf {
  title: string;
  fileName: string;
  company?: CompanyIdentity | null;
  /** Ligne sous le titre (période, filtres, statut). */
  subtitle?: string;
  header: [string, string][];
  columns: { label: string; align?: "left" | "right" }[];
  rows: string[][];
  footer: [string, string, boolean?][];
  /** Devise du document (code ISO 4217) : sert au montant en lettres. */
  currency?: string | null;
  /** Montant arrêté en lettres ; par défaut seulement pour une pièce commerciale (total TTC ou net à payer). */
  amountInWords?: boolean;
  /** Mentions, conditions, observations. */
  notes?: string | null;
  /** Cadres de signature (« Établi par », « Approuvé par »…). */
  signatures?: string[];
  orientation?: "portrait" | "landscape";
}

/** Libellé de la devise pour le montant en lettres. */
export function currencyWords(code?: string | null): string {
  const c = (code || "XOF").toUpperCase();
  const known: Record<string, string> = { XOF: "francs CFA", XAF: "francs CFA", EUR: "euros", USD: "dollars des États-Unis",
    GNF: "francs guinéens", GHS: "cedis", NGN: "nairas", MAD: "dirhams", CDF: "francs congolais", GBP: "livres sterling" };
  return known[c] ?? c;
}

const BLEU: [number, number, number] = [0, 98, 219]; // charte : #0062db
const GRIS: [number, number, number] = [110, 110, 110];

/* ── Montant en lettres (francs CFA, entiers) ── */
const UNITES = ["zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze",
  "treize", "quatorze", "quinze", "seize", "dix-sept", "dix-huit", "dix-neuf"];
const DIZAINES = ["", "", "vingt", "trente", "quarante", "cinquante", "soixante", "soixante", "quatre-vingt", "quatre-vingt"];

function moinsDeCent(n: number): string {
  if (n < 20) return UNITES[n];
  const d = Math.floor(n / 10), u = n % 10;
  if (d === 7 || d === 9) {
    const reste = 10 + u;
    return DIZAINES[d] + (d === 7 && u === 1 ? "-et-" : "-") + UNITES[reste];
  }
  if (u === 0) return DIZAINES[d] + (d === 8 ? "s" : "");
  if (u === 1 && d !== 8) return `${DIZAINES[d]}-et-un`;
  return `${DIZAINES[d]}-${UNITES[u]}`;
}

function moinsDeMille(n: number): string {
  const c = Math.floor(n / 100), r = n % 100;
  const cents = c === 0 ? "" : c === 1 ? "cent" : `${UNITES[c]} cent${r === 0 ? "s" : ""}`;
  if (r === 0) return cents || "zéro";
  return (cents ? `${cents} ` : "") + moinsDeCent(r);
}

/** 1 250 300 → « un million deux cent cinquante mille trois cents » (règles de 1990 non appliquées). */
export function montantEnLettres(montant: number): string {
  let n = Math.round(Math.abs(montant));
  if (n === 0) return "zéro";
  const parts: string[] = [];
  const echelles: [number, string, string][] = [[1e9, "milliard", "milliards"], [1e6, "million", "millions"]];
  for (const [v, sing, plur] of echelles) {
    const q = Math.floor(n / v);
    if (q > 0) { parts.push(`${q === 1 ? "un" : moinsDeMille(q)} ${q === 1 ? sing : plur}`); n %= v; }
  }
  const milliers = Math.floor(n / 1000);
  if (milliers > 0) {
    // « mille » est invariable ; « deux cents mille » → « deux cent mille ».
    parts.push(milliers === 1 ? "mille" : `${moinsDeMille(milliers).replace(/cents$/, "cent")} mille`);
    n %= 1000;
  }
  if (n > 0) parts.push(moinsDeMille(n));
  return parts.join(" ");
}

const nombre = (s: string) => Number(s.replace(/[^\d,-]/g, "").replace(",", "."));
const ou = (v: string | null | undefined) => (v && v.trim() ? v.trim() : "à renseigner");

/** Construit et télécharge le PDF ; rend false (et le signale) en cas d'échec, sans rejeter. */
export async function printDocumentPDF(raw: DocumentPdf): Promise<boolean> {
  try {
    const d = safeDocument(raw);
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
    const doc = new jsPDF({ orientation: d.orientation ?? "portrait", unit: "pt", format: "a4" });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const M = 40;
    const c = d.company;

    // Identité de la société émettrice.
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(...BLEU);
    doc.text(doc.splitTextToSize(pdfSafe(c?.legal_name || c?.name || "Société"), W / 2 - M - 10)[0] as string, M, M + 4);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(40);
    const id = [
      c?.address, [c?.phone, c?.email].filter(Boolean).join(" · "),
      `RCCM : ${ou(c?.rccm)}   ·   IFU / NIF : ${ou(c?.tax_id)}`,
      `Régime d'imposition : ${ou(c?.tax_regime)}   ·   Service des impôts : ${ou(c?.tax_office)}`,
    ].filter((x): x is string => !!x && x.trim() !== "");
    const idLignes = id.flatMap((l) => doc.splitTextToSize(pdfSafe(l), W / 2 - M - 10) as string[]);
    doc.text(idLignes, M, M + 18);

    // Titre et sous-titre.
    doc.setFont("helvetica", "bold"); doc.setTextColor(20);
    const titre = d.title.toUpperCase();
    const largeurTitre = W / 2 - M;
    let taille = 15;
    doc.setFontSize(taille);
    while (taille > 10 && doc.getTextWidth(titre) > largeurTitre) doc.setFontSize(--taille);
    const titreLignes = doc.splitTextToSize(titre, largeurTitre) as string[];
    doc.text(titreLignes, W - M, M + 4, { align: "right" });
    const titreH = (titreLignes.length - 1) * (taille + 2);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...GRIS);
    doc.text(`Édité le ${new Date().toLocaleDateString("fr-FR")}`, W - M, M + 18 + titreH, { align: "right" });
    const sousTitre = d.subtitle ? doc.splitTextToSize(d.subtitle, W / 2 - M) as string[] : [];
    if (sousTitre.length) doc.text(sousTitre, W - M, M + 30 + titreH, { align: "right" });

    // Cadre d'en-tête : deux colonnes libellé / valeur ; les valeurs longues passent à la ligne.
    let y = Math.max(M + 18 + idLignes.length * 10, M + 30 + titreH + sousTitre.length * 10) + 14;
    const half = Math.ceil(d.header.length / 2);
    const colW = (W - 2 * M) / 2;
    const valueW = colW - 112;
    doc.setFontSize(8.5);
    const wrapped = d.header.map(([label, value]) => ({ label, lines: doc.splitTextToSize(value || "—", valueW) as string[] }));
    const rowsH = Array.from({ length: Math.max(half, 1) }, (_, r) =>
      Math.max(wrapped[r]?.lines.length ?? 1, wrapped[r + half]?.lines.length ?? 1) * 11 + 3);
    const boxH = rowsH.reduce((a, b) => a + b, 0) + 10;
    doc.setDrawColor(210); doc.setLineWidth(0.6);
    doc.roundedRect(M, y, W - 2 * M, boxH, 3, 3);
    let yy = y + 14;
    rowsH.forEach((h, r) => {
      [wrapped[r], wrapped[r + half]].forEach((cell, col) => {
        if (!cell || (col === 1 && r + half >= wrapped.length)) return;
        const x = M + 8 + col * colW;
        doc.setFontSize(7); doc.setTextColor(...GRIS); doc.text(cell.label.toUpperCase(), x, yy);
        doc.setFontSize(8.5); doc.setTextColor(20); doc.text(cell.lines, x + 100, yy);
      });
      yy += h;
    });
    y += boxH + 14;

    // Lignes.
    autoTable(doc, {
      head: [d.columns.map((col) => col.label)],
      body: d.rows.length ? d.rows : [[{ content: "Aucune ligne.", colSpan: d.columns.length, styles: { halign: "center", textColor: 120 } }]],
      startY: y,
      margin: { left: M, right: M, bottom: 50 },
      styles: { fontSize: 8, cellPadding: 4, textColor: 30, lineColor: [225, 225, 225], lineWidth: 0.4, overflow: "linebreak" },
      headStyles: { fillColor: BLEU, textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [246, 248, 252] },
      rowPageBreak: "avoid",
      showHead: "everyPage",
      columnStyles: Object.fromEntries(d.columns.map((col, i) => [i, { halign: col.align === "right" ? "right" : "left" }])),
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;

    // Pied : totaux à droite.
    const totW = 240;
    const need = d.footer.length * 14 + (d.notes ? 40 : 0) + (d.signatures?.length ? 80 : 0) + 40;
    if (y + need > H - 50) { doc.addPage(); y = M; }
    d.footer.forEach(([label, value, strong]) => {
      doc.setFont("helvetica", strong ? "bold" : "normal"); doc.setFontSize(strong ? 9.5 : 8.5); doc.setTextColor(20);
      if (strong) { doc.setDrawColor(150); doc.line(W - M - totW, y - 9, W - M, y - 9); }
      doc.text(label, W - M - totW, y);
      doc.text(value, W - M, y, { align: "right" });
      y += 14;
    });

    // Montant arrêté en lettres : pièces commerciales (total TTC, net à payer), dans la devise du document.
    const total = [...d.footer].reverse().find(([l, , st]) => st && /TTC|net à payer/i.test(l));
    const words = d.amountInWords ?? !!total;
    const amountLine = total ?? [...d.footer].reverse().find(([, , st]) => st);
    if (words && amountLine && Number.isFinite(nombre(amountLine[1])) && nombre(amountLine[1]) !== 0) {
      y += 6;
      doc.setFont("helvetica", "italic"); doc.setFontSize(8.5); doc.setTextColor(40);
      const phrase = `Arrêté le présent document à la somme de ${montantEnLettres(nombre(amountLine[1]))} ${currencyWords(d.currency)}.`;
      doc.text(doc.splitTextToSize(phrase, W - 2 * M), M, y);
      y += 14;
    }
    if (d.notes) {
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(40);
      const n = doc.splitTextToSize(d.notes, W - 2 * M) as string[];
      doc.text(n, M, y + 4);
      y += n.length * 10 + 8;
    }
    if (c?.bank_details && words) {
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(40);
      doc.text(doc.splitTextToSize(`Règlement : ${c.bank_details}`, W - 2 * M), M, y + 4);
      y += 16;
    }

    // Cadres de signature.
    if (d.signatures?.length) {
      y += 10;
      const n = d.signatures.length;
      const gap = 16;
      const bw = (W - 2 * M - gap * (n - 1)) / n;
      d.signatures.forEach((label, i) => {
        const x = M + i * (bw + gap);
        doc.setDrawColor(190); doc.roundedRect(x, y, bw, 60, 3, 3);
        doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...GRIS);
        doc.text(label, x + 6, y + 12);
        doc.text("Date et signature", x + 6, y + 54);
      });
    }

    // Bas de page.
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setDrawColor(220); doc.line(M, H - 34, W - M, H - 34);
      doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...GRIS);
      doc.text(`${c?.legal_name || c?.name || ""} — ${d.title} — document édité par QUOREICH ERP`, M, H - 22);
      doc.text(`Page ${p} / ${pages}`, W - M, H - 22, { align: "right" });
    }

    doc.save(d.fileName.endsWith(".pdf") ? d.fileName : `${d.fileName}.pdf`);
    return true;
  } catch (e) {
    toast.error("Impossible de générer le PDF", { description: e instanceof Error ? e.message : "Erreur inattendue — réessayez." });
    return false;
  }
}

/** Date ISO (AAAA-MM-JJ) imprimée au format français (JJ/MM/AAAA) ; tout autre texte inchangé. */
export function dateFr(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
}

/** Pièce dont tous les textes sont imprimables par la police du PDF. */
function safeDocument(d: DocumentPdf): DocumentPdf {
  return {
    ...d,
    title: pdfSafe(d.title), subtitle: d.subtitle ? pdfSafe(d.subtitle) : d.subtitle, notes: d.notes ? pdfSafe(d.notes) : d.notes,
    header: d.header.map(([l, v]) => [pdfSafe(l), dateFr(pdfSafe(v ?? ""))]),
    columns: d.columns.map((col) => ({ ...col, label: pdfSafe(col.label) })),
    rows: d.rows.map((r) => r.map((v) => dateFr(pdfSafe(v ?? "")))),
    footer: d.footer.map(([l, v, st]) => [pdfSafe(l), pdfSafe(v ?? ""), st]),
    signatures: d.signatures?.map(pdfSafe),
  };
}

/** Même document en Excel : identité, titre, en-tête, lignes (nombres conservés en nombres), totaux, signatures. */
export function documentXlsxBytes(d: DocumentPdf): Uint8Array {
  const c = d.company;
  const n = Math.max(d.columns.length, 4);
  const pad = (cells: XlsxCell[]) => [...cells, ...Array(Math.max(0, n - cells.length)).fill({ v: "" })];
  const num = (v: string, align?: string): XlsxCell => {
    const x = nombre(v);
    return align === "right" && v.trim() !== "" && Number.isFinite(x) ? { v: x } : { v };
  };
  const grid: XlsxCell[][] = [];
  grid.push(pad([{ v: c?.legal_name || c?.name || "Société", style: 3 }]));
  for (const line of [c?.address, [c?.phone, c?.email].filter(Boolean).join(" · "),
    `RCCM : ${ou(c?.rccm)} · IFU / NIF : ${ou(c?.tax_id)}`]) if (line) grid.push(pad([{ v: line }]));
  grid.push(pad([]));
  grid.push(pad([{ v: d.title.toUpperCase(), style: 5 }]));
  if (d.subtitle) grid.push(pad([{ v: d.subtitle }]));
  grid.push(pad([{ v: `Édité le ${new Date().toLocaleDateString("fr-FR")}` }]));
  grid.push(pad([]));
  for (const [label, value] of d.header) grid.push(pad([{ v: label, style: 3 }, { v: value || "—" }]));
  grid.push(pad([]));
  const headRow = grid.length;
  grid.push(pad(d.columns.map((col) => ({ v: col.label, style: 1 as const }))));
  for (const r of d.rows) grid.push(pad(r.map((v, i) => num(v, d.columns[i]?.align))));
  grid.push(pad([]));
  for (const [label, value, strong] of d.footer) {
    const x = nombre(value);
    grid.push(pad([...Array(n - 2).fill({ v: "" }), { v: label, style: strong ? 3 : 0 }, Number.isFinite(x) ? { v: x, style: strong ? 4 : 2 } : { v: value }]));
  }
  if (d.notes) { grid.push(pad([])); grid.push(pad([{ v: d.notes }])); }
  if (d.signatures?.length) { grid.push(pad([])); grid.push(pad(d.signatures.map((s) => ({ v: `${s} : ________________`, style: 3 as const })))); }
  const widths = Array.from({ length: n }, (_, i) => Math.min(50, Math.max(12, (d.columns[i]?.label.length ?? 10) + 4,
    ...d.rows.slice(0, 300).map((r) => String(r[i] ?? "").length + 2), i === 0 ? 28 : 0)));
  void headRow;
  return buildXlsxSheet(grid, widths, d.title.slice(0, 31));
}

export function exportDocumentXLSX(d: DocumentPdf) {
  downloadXlsx(documentXlsxBytes(d), d.fileName.replace(/\.pdf$/, ""));
}
