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
  header: [string, string][];
  columns: { label: string; align?: "left" | "right" }[];
  rows: string[][];
  footer: [string, string, boolean?][];
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
export async function printDocumentPDF(d: DocumentPdf): Promise<boolean> {
  try {
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const M = 40;
    const c = d.company;

    // Identité du vendeur.
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(...BLEU);
    doc.text(c?.legal_name || c?.name || "Société", M, M + 4);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(40);
    const id = [
      c?.address, [c?.phone, c?.email].filter(Boolean).join(" · "),
      `RCCM : ${ou(c?.rccm)}   ·   IFU / NIF : ${ou(c?.tax_id)}`,
      `Régime d'imposition : ${ou(c?.tax_regime)}   ·   Service des impôts : ${ou(c?.tax_office)}`,
    ].filter((x): x is string => !!x && x.trim() !== "");
    doc.text(id, M, M + 18);

    // Titre de la pièce.
    doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(20);
    doc.text(d.title.toUpperCase(), W - M, M + 4, { align: "right" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...GRIS);
    doc.text(`Édité le ${new Date().toLocaleDateString("fr-FR")}`, W - M, M + 18, { align: "right" });

    // Cadre d'en-tête : deux colonnes libellé / valeur.
    let y = M + 18 + id.length * 10 + 14;
    doc.setDrawColor(210); doc.setLineWidth(0.6);
    const half = Math.ceil(d.header.length / 2);
    const colW = (W - 2 * M) / 2;
    const lineH = 13;
    const boxH = Math.max(half, 1) * lineH + 12;
    doc.roundedRect(M, y, W - 2 * M, boxH, 3, 3);
    d.header.forEach(([label, value], i) => {
      const col = i < half ? 0 : 1;
      const row = i < half ? i : i - half;
      const x = M + 8 + col * colW;
      const yy = y + 14 + row * lineH;
      doc.setFontSize(7); doc.setTextColor(...GRIS); doc.text(label.toUpperCase(), x, yy);
      doc.setFontSize(8.5); doc.setTextColor(20);
      const v = doc.splitTextToSize(value || "—", colW - 110)[0] ?? "";
      doc.text(v, x + 100, yy);
    });
    y += boxH + 14;

    // Lignes.
    autoTable(doc, {
      head: [d.columns.map((col) => col.label)],
      body: d.rows.length ? d.rows : [[{ content: "Aucune ligne.", colSpan: d.columns.length, styles: { halign: "center", textColor: 120 } }]],
      startY: y,
      margin: { left: M, right: M, bottom: 50 },
      styles: { fontSize: 8, cellPadding: 4, textColor: 30, lineColor: [225, 225, 225], lineWidth: 0.4 },
      headStyles: { fillColor: BLEU, textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [246, 248, 252] },
      columnStyles: Object.fromEntries(d.columns.map((col, i) => [i, { halign: col.align === "right" ? "right" : "left" }])),
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;

    // Pied : totaux à droite.
    const totW = 220;
    if (y + d.footer.length * 14 + 60 > H - 50) { doc.addPage(); y = M; }
    d.footer.forEach(([label, value, strong]) => {
      doc.setFont("helvetica", strong ? "bold" : "normal"); doc.setFontSize(strong ? 9.5 : 8.5); doc.setTextColor(20);
      if (strong) { doc.setDrawColor(150); doc.line(W - M - totW, y - 9, W - M, y - 9); }
      doc.text(label, W - M - totW, y);
      doc.text(value, W - M, y, { align: "right" });
      y += 14;
    });

    // Montant arrêté en lettres (total TTC, net à payer ou solde).
    const total = [...d.footer].reverse().find(([l, , s]) => s && /TTC|net à payer|solde|total/i.test(l));
    if (total && Number.isFinite(nombre(total[1])) && nombre(total[1]) !== 0) {
      y += 6;
      doc.setFont("helvetica", "italic"); doc.setFontSize(8.5); doc.setTextColor(40);
      const phrase = `Arrêté le présent document à la somme de ${montantEnLettres(nombre(total[1]))} francs CFA.`;
      doc.text(doc.splitTextToSize(phrase, W - 2 * M), M, y);
      y += 14;
    }
    if (c?.bank_details) {
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(40);
      doc.text(doc.splitTextToSize(`Règlement : ${c.bank_details}`, W - 2 * M), M, y + 4);
    }

    // Bas de page.
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setDrawColor(220); doc.line(M, H - 34, W - M, H - 34);
      doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...GRIS);
      doc.text(`${c?.legal_name || c?.name || ""} — document édité par QUOREICH ERP`, M, H - 22);
      doc.text(`Page ${p} / ${pages}`, W - M, H - 22, { align: "right" });
    }

    doc.save(d.fileName.endsWith(".pdf") ? d.fileName : `${d.fileName}.pdf`);
    return true;
  } catch (e) {
    toast.error("Impossible de générer le PDF", { description: e instanceof Error ? e.message : "Erreur inattendue — réessayez." });
    return false;
  }
}
