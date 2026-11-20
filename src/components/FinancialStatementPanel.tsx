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
import { apiGet, isApiEnabled } from "@/api/client";

/*
 * États financiers par rubriques (V63, lot PC-2) : compte de résultat (TA … XI) et bilan (AD … DZ)
 * SYSCOHADA, calculés par la base à partir de règles d'affectation en données (aucun numéro de compte
 * dans l'écran ni dans le code). Les exceptions d'affectation sont propres à la société.
 */
type Line = { line_code: string; label: string; line_order: number; kind: "detail" | "total" | "cash_open" | "cash_close"; amount: number; amount_prior: number | null };
type FlowDetail = { line_code: string; account_code: string; account_name: string; side: "debit" | "credit"; amount: number };
/** Lignes de contrôle du TFT (V122) : doivent être nulles ; leur détail par compte est affiché sous le tableau. */
const TFT_CONTROLS = ["ZN", "ZU", "ZX"];
type TenantInfo = { currency: string; fiscal_year_start: number };
type StatementData = { lines: Line[]; priorAvailable: boolean };
const LAYOUTS: [string, string][] = [["CR_SYSCOHADA", "Compte de résultat SYSCOHADA"], ["BILAN_SYSCOHADA", "Bilan SYSCOHADA"], ["TFT_SYSCOHADA", "Tableau des flux de trésorerie SYSCOHADA"]];
const FILE_NAMES: Record<string, string> = { CR_SYSCOHADA: "compte-de-resultat-syscohada", BILAN_SYSCOHADA: "bilan-syscohada", TFT_SYSCOHADA: "tableau-des-flux-syscohada" };
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
      const { data, error } = isApiEnabled() ? { data: await apiGet<any>("/api/v1/gl/company"), error: null }
        : await supabase.from("tenants").select("currency, fiscal_year_start").eq("id", tenantId!).single();
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
  const isCashFlow = layout === "TFT_SYSCOHADA";
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
      const viaApi = async () => {
        const st = (f: string | null, t: string) => apiGet<any[]>(`/api/v1/gl/financial-statement?layout=${layout}${f ? `&from=${f}` : ""}&to=${t}`);
        const [c, p, n] = await Promise.all([st(isBalance ? null : from, to), st(priorFrom, priorTo),
          apiGet<number>(`/api/v1/gl/journal-entries/count?${isBalance ? "" : `from=${priorFrom}&`}to=${priorTo}`)]);
        return [{ data: c, error: null }, { data: p, error: null }, { count: n, error: null }] as const;
      };
      const [current, prior, history] = isApiEnabled() ? await viaApi() : await Promise.all([
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
  const controlsOff = isCashFlow && lines.some((l) => TFT_CONTROLS.includes(l.line_code) && Math.abs(Number(l.amount)) >= 0.01);
  const { data: flowDetails } = useQuery({
    queryKey: ["cash-flow-details", tenantId, from, to],
    enabled: !!tenantId && isCashFlow && controlsOff,
    retry: false,
    queryFn: async (): Promise<FlowDetail[]> => {
      if (isApiEnabled()) return apiGet<FlowDetail[]>(`/api/v1/gl/cash-flow-details?layout=TFT_SYSCOHADA&from=${from}&to=${to}`);
      const { data, error } = await (supabase as any).rpc("cash_flow_details", { _layout: "TFT_SYSCOHADA", _from: from, _to: to });
      if (error) throw error;
      return ((data ?? []) as FlowDetail[]).filter((d) => d.line_code === "ZN" || d.line_code === "ZU");
    },
  });
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
            onClick={() => exportToCSV(rows, cols, FILE_NAMES[layout])}>Exporter</Button>
          <Button size="sm" variant="outline" className="h-8 text-xs" disabled={rows.length === 0}
            onClick={() => exportToPDF({ filename: FILE_NAMES[layout], title, columns: cols, rows, orientation: "portrait" })}>Imprimer</Button>
        </div>
      </div>
      {isCashFlow && <p className="text-[11px] text-muted-foreground" data-testid="cash-flow-method">Tableau calculé sur le grand livre : la trésorerie (rubrique A) regroupe les comptes du périmètre de trésorerie ; chaque mouvement des autres comptes est rangé par compte et par sens (débit / crédit) dans une rubrique. Les virements entre comptes de trésorerie et l’écriture de détermination du résultat n’y figurent pas. Les lignes de contrôle doivent être nulles : un écart vient d’un mouvement non classé ou d’une opération sans effet de trésorerie dont une seule partie est neutralisée.</p>}
      <p className="text-[11px] text-muted-foreground">Rubriques calculées sur les écritures validées ; N-1 compare la même période ou la même date d’arrêté. Sans historique comptable N-1, le comparatif reste indisponible. Les correspondances SYSCOHADA doivent être validées par l’expert-comptable.</p>
      {error && <p className="text-xs text-destructive" role="alert">{(error as Error).message}</p>}
      {isLoading ? <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div> : (
        <div className="card-elevated overflow-x-auto">
          <table className="w-full text-xs" data-testid="financial-statement">
            <thead><tr className="bg-muted/30 text-muted-foreground"><th className="text-left p-2 w-16">Réf.</th><th className="text-left">Rubrique</th><th className="text-right pr-3">Montant ({currency})</th><th className="text-right pr-3">N-1 ({currency})</th></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.line_code} data-testid="statement-line" className={cn("border-t border-border/50", (l.kind === "total" || l.kind === "cash_open") && "bg-muted/20 font-semibold",
                  isCashFlow && TFT_CONTROLS.includes(l.line_code) && "text-muted-foreground italic")}>
                  <td className="p-2 font-mono">{l.line_code}</td><td>{l.label}</td>
                  <td className={cn("text-right pr-3 tabular-nums", Number(l.amount) < 0 && "text-destructive")}>{fmt(l.amount)} {currency}</td>
                  <td className={cn("text-right pr-3 tabular-nums", l.amount_prior != null && Number(l.amount_prior) < 0 && "text-destructive")}>{l.amount_prior == null ? "—" : `${fmt(l.amount_prior)} ${currency}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {isCashFlow && !isLoading && lines.length > 0 && (controlsOff ? (
        <div className="card-elevated p-3 space-y-2" data-testid="cash-flow-controls" role="alert">
          <p className="text-xs font-medium text-destructive">Le tableau n’est pas équilibré : mouvements à classer ou à justifier</p>
          <table className="w-full text-xs">
            <thead><tr className="text-muted-foreground"><th className="text-left">Contrôle</th><th className="text-left">Compte</th><th className="text-left">Sens</th><th className="text-right">Montant</th></tr></thead>
            <tbody>{(flowDetails ?? []).map((d) => (
              <tr key={`${d.line_code}-${d.account_code}-${d.side}`} className="border-t border-border/50">
                <td className="py-1">{d.line_code === "ZU" ? "Non classé" : "Sans effet de trésorerie"}</td>
                <td>{d.account_code} — {d.account_name}</td><td>{d.side === "debit" ? "Débit" : "Crédit"}</td>
                <td className="text-right tabular-nums">{fmt(d.amount)} {currency}</td>
              </tr>))}</tbody>
          </table>
          <p className="text-[11px] text-muted-foreground">Une opération sans effet de trésorerie n’est nulle que si toutes ses lignes sont neutralisées. Les affectations par compte se règlent avec l’expert-comptable.</p>
        </div>
      ) : <p className="text-[11px] text-success" data-testid="cash-flow-balanced">Contrôles nuls : la variation des flux explique exactement la variation de la trésorerie au bilan.</p>)}
    </section>
  );
}
