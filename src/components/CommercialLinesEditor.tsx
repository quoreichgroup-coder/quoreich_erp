import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { emptyLine, invoiceTotals, type DraftLine, type TaxCode } from "@/lib/invoice-lines";
import { useTranslation } from "react-i18next";
import { useLocaleFormat } from "@/hooks/use-locale-format";
import { useTenantCurrency } from "@/hooks/use-tenant-currency";

/*
 * Lignes d'une pièce commerciale (facture client, devis, commande) : libellé, quantité, prix,
 * remise, code TVA, HT de la ligne ; et pied HT / TVA / TTC. Le calcul affiché est celui de la base
 * (compute_ar_invoice_line, V21 ; lignes de vente, V43) : la base recalcule et fait foi.
 */
export function CommercialLinesEditor({
  lines, onChange, taxCodes, testId = "invoice-lines", linePrefix = "invoice-line",
}: {
  lines: DraftLine[];
  onChange: (lines: DraftLine[]) => void;
  taxCodes: TaxCode[];
  testId?: string;
  linePrefix?: string;
}) {
  const { t } = useTranslation("documents");
  const f = useLocaleFormat();
  const fmt = (n: number) => f.number(n);
  const active = taxCodes.filter((code) => code.active);
  const { amounts } = invoiceTotals(lines, taxCodes);
  const setLine = (i: number, patch: Partial<DraftLine>) => onChange(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  return (
    <div className="space-y-2" data-testid={testId}>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-1.5 pr-2 font-medium">{t("lines.description")}</th>
              <th className="py-1.5 pr-2 font-medium text-right w-20">{t("lines.quantity")}</th>
              <th className="py-1.5 pr-2 font-medium text-right w-28">{t("lines.unit_price")}</th>
              <th className="py-1.5 pr-2 font-medium text-right w-20">{t("lines.discount")}</th>
              <th className="py-1.5 pr-2 font-medium w-32">{t("lines.vat")}</th>
              <th className="py-1.5 pr-2 font-medium text-right w-28">{t("lines.net")}</th>
              <th className="w-8"><span className="sr-only">{t("lines.remove")}</span></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-b border-border/50" data-testid={`${linePrefix}-${i + 1}`}>
                <td className="py-1 pr-2"><Input aria-label={t("lines.description_n", { n: i + 1 })} className="h-8 text-xs" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} /></td>
                <td className="py-1 pr-2"><Input aria-label={t("lines.quantity_n", { n: i + 1 })} inputMode="decimal" className="h-8 text-xs text-right" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} /></td>
                <td className="py-1 pr-2"><Input aria-label={t("lines.unit_price_n", { n: i + 1 })} inputMode="decimal" className="h-8 text-xs text-right" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} /></td>
                <td className="py-1 pr-2"><Input aria-label={t("lines.discount_n", { n: i + 1 })} inputMode="decimal" placeholder="0" className="h-8 text-xs text-right" value={l.discountPct} onChange={(e) => setLine(i, { discountPct: e.target.value })} /></td>
                <td className="py-1 pr-2">
                  <select aria-label={t("lines.vat_n", { n: i + 1 })} className="w-full h-8 px-2 rounded-md border border-input bg-background text-xs" value={l.taxCodeId} onChange={(e) => setLine(i, { taxCodeId: e.target.value })}>
                    <option value="">{t("lines.no_vat")}</option>
                    {active.map((code) => <option key={code.id} value={code.id}>{code.code} · {f.number(code.rate)} %</option>)}
                  </select>
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">{amounts[i]?.valid ? fmt(amounts[i].net) : "—"}</td>
                <td className="py-1 text-right">
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" aria-label={t("lines.remove_n", { n: i + 1 })}
                    disabled={lines.length === 1} onClick={() => onChange(lines.filter((_, k) => k !== i))}>×</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1" data-testid="btn-add-line"
        onClick={() => onChange([...lines, emptyLine(lines[lines.length - 1]?.taxCodeId ?? "")])}>
        <Plus className="w-3 h-3" /> {t("lines.add")}
      </Button>
      {active.length === 0 && (
        <p className="text-xs text-muted-foreground">{t("lines.no_tax_codes")}</p>
      )}
    </div>
  );
}

/** `currency` : devise de la pièce ; à défaut, celle de la société (jamais déduite de la langue). */
export function CommercialTotals({ lines, taxCodes, testId, currency }: { lines: DraftLine[]; taxCodes: TaxCode[]; testId?: string; currency?: string }) {
  const { subtotal, tax, total } = invoiceTotals(lines, taxCodes);
  const { t } = useTranslation("documents");
  const f = useLocaleFormat();
  const companyCurrency = useTenantCurrency();
  const code = currency ?? companyCurrency;
  const fmt = (n: number) => f.number(n);
  return (
    <div className="bg-muted/30 rounded p-3 text-xs" data-testid={testId}>
      <div className="flex justify-between"><span>{t("lines.subtotal")}</span><span className="tabular-nums">{fmt(subtotal)} {code}</span></div>
      <div className="flex justify-between"><span>{t("lines.vat")}</span><span className="tabular-nums">{fmt(tax)} {code}</span></div>
      <div className="flex justify-between font-medium border-t border-border mt-1.5 pt-1.5"><span>{t("lines.total")}</span><span className="tabular-nums">{fmt(total)} {code}</span></div>
    </div>
  );
}

/** Lignes saisies → charge utile des fonctions de vente (V43). */
export function toSalesLines(lines: DraftLine[]) {
  const n = (s: string) => Number(String(s).replace(",", "."));
  return lines.map((l) => ({
    description: l.description.trim(),
    quantity: n(l.quantity),
    unit_price: n(l.unitPrice),
    discount_pct: l.discountPct === "" ? 0 : n(l.discountPct),
    tax_code_id: l.taxCodeId || null,
  }));
}
