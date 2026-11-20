import { isValidElement, type ReactNode } from "react";
import { Attachments } from "@/components/Attachments";
import type { AttachmentDocType } from "@/lib/attachments";
import { Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportToCSV } from "@/lib/csv-export";
import { exportDocumentXLSX, printDocumentPDF, type DocumentPdf, type CompanyIdentity } from "@/lib/document-pdf";
import { supabase } from "@/integrations/supabase/client";
import { fetchTenantId } from "@/hooks/use-tenant";
import { apiGet, isApiEnabled } from "@/api/client";

export type DetailColumn = { label: string; align?: "left" | "right" };

/**
 * Lecture d'une pièce en trois zones (SAP / Sage) : en-tête (champs), lignes (grille), pied
 * (totaux calculés). Utilisé par les vues de détail des commandes, réceptions, demandes et
 * factures. L'édition officielle imprimée (modèles PDF archivés) relève du Lot 6.
 */
/** Nom de fichier à partir du titre d'une pièce : « Devis QT-2026-0001 » → « devis-qt-2026-0001 ». */
export function documentFileName(title: string): string {
  return title.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}

/** Texte d'une cellule pour l'export (les cellules sont des chaînes ou des nombres ; le reste est ignoré). */
function texte(v: ReactNode): string {
  if (v === null || v === undefined || typeof v === "boolean") return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map(texte).join("");
  if (isValidElement(v)) return texte((v.props as { children?: ReactNode }).children);
  return "";
}

/** Options d'impression d'une pièce (devise, mentions, signatures, orientation, sous-titre). */
export type DocumentPrintOptions = Pick<DocumentPdf, "currency" | "notes" | "signatures" | "orientation" | "subtitle" | "amountInWords">;

/**
 * Export d'une pièce, utilisable par tout écran : PDF A4 (identité de la société, en-tête, lignes, totaux,
 * mentions, signatures), Excel (même mise en page, nombres conservés) ou CSV (« ; »).
 */
export async function exportDocument(kind: "pdf" | "xlsx" | "csv", d: Omit<DocumentPdf, "company">) {
  if (kind === "csv") {
    const keys = d.columns.map((_, i) => `c${i}`);
    const extra = (pairs: [string, string][]) => pairs.map(([l, v]) => {
      const row: Record<string, string> = Object.fromEntries(keys.map((k) => [k, ""]));
      row[keys[0]] = l;
      row[keys[keys.length - 1]] = v;
      return row;
    });
    const data = d.rows.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ""])));
    exportToCSV([...extra(d.header), ...data, ...extra(d.footer.map(([l, v]) => [l, v]))], keys.map((k, i) => ({ key: k, header: d.columns[i].label })), d.fileName);
    return;
  }
  const full: DocumentPdf = { ...d, company: await companyIdentity() };
  if (kind === "xlsx") exportDocumentXLSX(full);
  else await printDocumentPDF(full);
}

function exporter(kind: "csv" | "pdf" | "xlsx", title: string, fileName: string, header: [string, ReactNode][],
  columns: DetailColumn[], rows: ReactNode[][], footer: [string, ReactNode, boolean?][], options: DocumentPrintOptions) {
  void exportDocument(kind, {
    title, fileName, ...options,
    header: header.map(([l, v]) => [l, texte(v)]),
    columns,
    rows: rows.map((r) => columns.map((_, i) => texte(r[i]))),
    footer: footer.map(([l, v, strong]) => [l, texte(v), strong]),
  });
}

/** Identité légale de la société (V47) pour l'en-tête imprimé ; sans elle, mentions « à renseigner ». */
async function companyIdentity(): Promise<CompanyIdentity | null> {
  try {
    if (isApiEnabled()) return await apiGet<CompanyIdentity | null>("/api/v1/company/identity");
    const tenantId = await fetchTenantId();
    const { data } = await (supabase as any).from("tenants")
      .select("name, legal_name, address, phone, email, rccm, tax_id, tax_regime, tax_office, bank_details").eq("id", tenantId).single();
    return (data as CompanyIdentity) ?? null;
  } catch {
    return null;
  }
}

export function DocumentDetail({ header, columns, rows, footer, emptyLines = "Aucune ligne.", title, fileName, print = {}, attachments }: {
  header: [string, ReactNode][];
  columns: DetailColumn[];
  rows: ReactNode[][];
  footer: [string, ReactNode, boolean?][];
  emptyLines?: string;
  /** Avec un titre et un nom de fichier : boutons « Imprimer » (PDF), « Excel » et « CSV ». */
  title?: string;
  fileName?: string;
  /** Devise, mentions, signatures, orientation de la pièce imprimée. */
  print?: DocumentPrintOptions;
  /** Pièces jointes de la pièce affichée (V138). */
  attachments?: { docType: AttachmentDocType; docId: string | null | undefined };
}) {
  return (
    <div className="space-y-4" data-testid="document-detail">
      {title && fileName && (
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs gap-1" data-testid="btn-document-csv"
            onClick={() => exporter("csv", title, fileName, header, columns, rows, footer, print)}>
            <Download className="w-3 h-3" /> CSV
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs gap-1" data-testid="btn-document-xlsx"
            onClick={() => exporter("xlsx", title, fileName, header, columns, rows, footer, print)}>
            <Download className="w-3 h-3" /> Excel
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs gap-1" data-testid="btn-document-pdf"
            onClick={() => exporter("pdf", title, fileName, header, columns, rows, footer, print)}>
            <Printer className="w-3 h-3" /> Imprimer
          </Button>
        </div>
      )}
      <section aria-label="En-tête" className="grid grid-cols-2 gap-x-6 gap-y-2">
        {header.map(([label, value]) => (
          <div key={label}>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
            <p className="text-sm text-foreground">{value ?? "—"}</p>
          </div>
        ))}
      </section>

      <section aria-label="Lignes" className="border border-border rounded-md overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted/30 text-muted-foreground">
            <tr>{columns.map((c) => <th key={c.label} className={`p-2 ${c.align === "right" ? "text-right" : "text-left"}`}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={columns.length} className="p-4 text-center text-muted-foreground">{emptyLines}</td></tr>
            ) : rows.map((r, i) => (
              <tr key={i} className="border-t border-border">
                {r.map((cell, j) => (
                  <td key={j} className={`p-2 ${columns[j]?.align === "right" ? "text-right tabular-nums" : ""}`}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-label="Pied" className="ml-auto w-full max-w-xs space-y-1 text-xs">
        {footer.map(([label, value, strong]) => (
          <div key={label} className={`flex justify-between ${strong ? "font-semibold border-t border-border pt-1" : ""}`}>
            <span className={strong ? "" : "text-muted-foreground"}>{label}</span>
            <span className="tabular-nums">{value}</span>
          </div>
        ))}
      </section>
      {attachments && <Attachments docType={attachments.docType} docId={attachments.docId} />}
    </div>
  );
}

/** Boutons « Imprimer » (PDF A4) et « Excel » d'une pièce construite à la demande, pour tout écran. */
export function DocumentPrintButtons({ build, disabled = false, testId = "document-print", excel = true }: {
  build: () => Omit<DocumentPdf, "company">; disabled?: boolean; testId?: string;
  /** Faux quand l'écran offre déjà un Excel dédié (ex. feuille de comptage réimportable). */
  excel?: boolean;
}) {
  return (
    <div className="inline-flex gap-1" data-testid={testId}>
      <Button type="button" size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={disabled} onClick={() => void exportDocument("pdf", build())}>
        <Printer className="w-3 h-3" /> Imprimer
      </Button>
      {excel && (
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={disabled} onClick={() => void exportDocument("xlsx", build())}>
          <Download className="w-3 h-3" /> Excel
        </Button>
      )}
    </div>
  );
}
