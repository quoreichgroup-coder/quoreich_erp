import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { exportToCSV } from "@/lib/csv-export";
import { exportToPDF } from "@/lib/pdf-export";
import { cn } from "@/lib/utils";
import { useTenantId } from "@/hooks/use-tenant";
import { combineStatementComparison, fiscalYearStartDate, shiftStatementDate } from "@/lib/financial-statement-period";

/*
 * États financiers par rubriques (V63, lot PC-2) : compte de résultat (TA … XI) et bilan (AD … DZ)
 * SYSCOHADA, calculés par la base à partir de règles d'affectation en données (aucun numéro de compte
 * dans l'écran ni dans le code). Les exceptions d'affectation sont propres à la société.
 */
type Line = { line_code: string; label: string; line_order: number; kind: "detail" | "total"; amount: number; amount_prior: number | null };
type TenantInfo = { currency: string; fiscal_year_start: number };
type StatementData = { lines: Line[]; priorAvailable: boolean };
const LAYOUTS: [string, string][] = [["CR_SYSCOHADA", "Compte de résultat SYSCOHADA"], ["BILAN_SYSCOHADA", "Bilan SYSCOHADA"]];
const fmt = (n: number) => Number(n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const year = new Date().getFullYear();

export function FinancialStatementPanel() {
  const [layout, setLayout] = useState("CR_SYSCOHADA");
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [defaultPeriodSet, setDefaultPeriodSet] = useState(false);
  const { data: tenantId } = useTenantId();
  const { data: tenant } = useQuery({
    queryKey: ["financial-statement-tenant", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("tenants").select("currency, fiscal_year_start").eq("id", tenantId!).single();
      if (error) throw error;
      return data as TenantInfo;
    },
  });
  useEffect(() => {
    if (tenant && !defaultPeriodSet) {
      setFrom(fiscalYearStartDate(new Date().toISOString().slice(0, 10), tenant.fiscal_year_start));
      setDefaultPeriodSet(true);
    }
  }, [tenant, defaultPeriodSet]);
  const isBalance = layout === "BILAN_SYSCOHADA";
  const priorFrom = useMemo(() => isBalance ? null : shiftStatementDate(from, -1), [isBalance, from]);
  const priorTo = useMemo(() => shiftStatementDate(to, -1), [to]);
  const { data: statement, isLoading, error } = useQuery({
    queryKey: ["financial-statement", tenantId, layout, from, to, priorFrom, priorTo],
    enabled: !!tenantId && !!from && !!to && from <= to,
    queryFn: async (): Promise<StatementData> => {
      const journalQuery = supabase.from("journal_entries").select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId!).in("status", ["posted", "reversed"]);
      if (isBalance) journalQuery.lte("entry_date", priorTo);
      else journalQuery.gte("entry_date", priorFrom!).lte("entry_date", priorTo);
      const [current, prior, history] = await Promise.all([
        (supabase as any).rpc("financial_statement", { _layout: layout, _from: isBalance ? null : from, _to: to }),
        (supabase as any).rpc("financial_statement", { _layout: layout, _from: priorFrom, _to: priorTo }),
        journalQuery,
      ]);
      if (current.error) throw current.error;
      if (prior.error) throw prior.error;
      if (history.error) throw history.error;
      const currentLines = (current.data ?? []) as Omit<Line, "amount_prior">[];
      const priorLines = (prior.data ?? []) as Omit<Line, "amount_prior">[];
      const priorAvailable = (history.count ?? 0) > 0;
      return {
        priorAvailable,
        lines: combineStatementComparison(currentLines, priorLines, priorAvailable),
      };
    },
  });
  const lines = statement?.lines ?? [];
  const currency = tenant?.currency ?? "—";
  const title = `${LAYOUTS.find(([v]) => v === layout)?.[1]} — ${isBalance ? `au ${to}` : `du ${from} au ${to}`} · comparatif N-1`;
  const rows = lines.map((l) => ({ code: l.line_code, rubrique: l.label, montant: Number(l.amount), montant_n_1: l.amount_prior == null ? "—" : Number(l.amount_prior) }));
  const cols: { key: "code" | "rubrique" | "montant" | "montant_n_1"; header: string }[] = [
    { key: "code", header: "Réf." }, { key: "rubrique", header: "Rubrique" },
    { key: "montant", header: `Montant (${currency})` }, { key: "montant_n_1", header: `N-1 (${currency})` },
  ];

  return (
    <section aria-label="États financiers SYSCOHADA" className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 bg-card border border-border rounded-lg p-3">
        <div className="space-y-1"><Label className="text-xs" htmlFor="fs-layout">État</Label>
          <select id="fs-layout" className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={layout} onChange={(e) => setLayout(e.target.value)}>
            {LAYOUTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></div>
        {!isBalance && <div className="space-y-1"><Label className="text-xs" htmlFor="fs-from">Du</Label>
          <Input id="fs-from" type="date" className="h-8 text-xs w-40" value={from} onChange={(e) => setFrom(e.target.value)} /></div>}
        <div className="space-y-1"><Label className="text-xs" htmlFor="fs-to">Au</Label>
          <Input id="fs-to" type="date" className="h-8 text-xs w-40" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" className="h-8 text-xs" disabled={rows.length === 0}
            onClick={() => exportToCSV(rows, cols, isBalance ? "bilan-syscohada" : "compte-de-resultat-syscohada")}>Exporter</Button>
          <Button size="sm" variant="outline" className="h-8 text-xs" disabled={rows.length === 0}
            onClick={() => exportToPDF({ filename: isBalance ? "bilan-syscohada" : "compte-de-resultat-syscohada", title, columns: cols, rows, orientation: "portrait" })}>Imprimer</Button>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">Rubriques calculées sur les écritures validées ; N-1 compare la même période ou la même date d’arrêté. Sans historique comptable N-1, le comparatif reste indisponible. Les correspondances SYSCOHADA doivent être validées par l’expert-comptable.</p>
      {error && <p className="text-xs text-destructive" role="alert">{(error as Error).message}</p>}
      {isLoading ? <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div> : (
        <div className="card-elevated overflow-x-auto">
          <table className="w-full text-xs" data-testid="financial-statement">
            <thead><tr className="bg-muted/30 text-muted-foreground"><th className="text-left p-2 w-16">Réf.</th><th className="text-left">Rubrique</th><th className="text-right pr-3">Montant ({currency})</th><th className="text-right pr-3">N-1 ({currency})</th></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.line_code} data-testid="statement-line" className={cn("border-t border-border/50", l.kind === "total" && "bg-muted/20 font-semibold")}>
                  <td className="p-2 font-mono">{l.line_code}</td><td>{l.label}</td>
                  <td className={cn("text-right pr-3 tabular-nums", Number(l.amount) < 0 && "text-destructive")}>{fmt(l.amount)} {currency}</td>
                  <td className={cn("text-right pr-3 tabular-nums", l.amount_prior != null && Number(l.amount_prior) < 0 && "text-destructive")}>{l.amount_prior == null ? "—" : `${fmt(l.amount_prior)} ${currency}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
