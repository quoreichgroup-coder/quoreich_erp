import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FileText, Loader2 } from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { ExportButtons } from "@/components/ExportButtons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMyAccess } from "@/hooks/use-my-access";
import {
  DEFAULT_BUDGET_SETTINGS, fetchBudgetAmounts, useBudgetControlSettings, useBudgetList, useBudgetMonthlyActual, useBudgetPriorYearMonthly, useBudgetStatus,
  type BudgetStatusRow,
} from "@/hooks/use-budget-control";
import { fetchForecastAmounts, useBudgetForecasts } from "@/hooks/use-budget-forecasts";
import { ANNUAL_SPREAD_LABELS, bySection, compareAmounts, consumptionPct, monthlySeries, natureOf, rootLines, totals, type BudgetNature, type CompareLine } from "@/lib/budget-forecast";
import { exportToPDF } from "@/lib/pdf-export";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";

/*
 * Budget → Rapports (V79) : budget / réalisé par ligne, par section analytique, mensuel, et comparaison de deux
 * budgets ou versions de prévision. Données de la base (budget de contrôle approuvé, écritures, versions) ; exports
 * Excel, CSV et PDF identiques à l'écran, droit budget.export.
 */
const fmt = (n: number) => Number(n || 0).toLocaleString("fr-FR", { maximumFractionDigits: 0 });
const NATURE_LABEL: Record<BudgetNature, string> = { expense: "Charges", revenue: "Produits" };
const TABS = [["lines", "Budget / réalisé"], ["sections", "Par section"], ["monthly", "Mensuel"], ["compare", "Comparaison"]] as const;
const periodLabel = (p: string) => (p.length === 4 ? `Année ${p}` : `${p.slice(5, 7)}/${p.slice(0, 4)}`);

type Col<T> = { key: keyof T & string; header: string; width?: number; num?: boolean };

function ReportActions<T extends Record<string, unknown>>({ canExport, title, filename, rows, columns }: { canExport: boolean; title: string; filename: string; rows: T[]; columns: Col<T>[] }) {
  if (!canExport) return null;
  return (
    <div className="flex gap-2">
      <ExportButtons pdf={false} label="Exporter" filename={filename} sheetName={title.slice(0, 30)} rows={rows} columns={columns.map((c) => ({ key: c.key, header: c.header, width: c.width }))} />
      <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" disabled={rows.length === 0}
        onClick={() => void exportToPDF({ filename, title, orientation: "landscape", rows,
          columns: columns.map((c) => ({ key: c.key, header: c.header, format: c.num ? (r: T) => fmt(Number(r[c.key] ?? 0)) : undefined })) })}>
        <FileText className="w-3.5 h-3.5" />PDF</Button>
    </div>
  );
}

export default function BudgetReporting() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(([t]) => t === params.get("tab")) ? params.get("tab")! : "lines";
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const validYear = /^\d{4}$/.test(year);
  const status = useBudgetStatus(validYear ? year : "");
  const rows = useMemo(() => status.data ?? [], [status.data]);
  const natures = (["expense", "revenue"] as BudgetNature[]).filter((n) => rows.some((r) => natureOf(r) === n));
  const [natureChoice, setNature] = useState<BudgetNature>("expense");
  const nature = natures.includes(natureChoice) ? natureChoice : natures[0] ?? "expense";
  const canExport = (useMyAccess().data?.permissions ?? []).includes("budget.export");
  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Comptabilité et finance" }, { label: "Budget et prévisions", href: "/budget" }, { label: "Rapports" }]} />
      <GuidanceBanner title="Rapports budgétaires" description="Budget de contrôle approuvé comparé au réalisé comptable, par ligne, par section analytique et par mois ; comparaison de deux budgets ou versions de prévision. Charges (plafond) et produits (objectif) séparés." />
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <h1 className="text-lg font-semibold text-foreground">Rapports budgétaires</h1>
        <div className="flex items-end gap-2">
          {tab !== "compare" && natures.length > 1 && (
            <div className="flex gap-1" role="tablist" aria-label="Nature">
              {natures.map((n) => <button key={n} role="tab" aria-selected={nature === n} onClick={() => setNature(n)}
                className={cn("px-3 py-1.5 text-xs rounded-md border", nature === n ? "border-primary text-primary bg-primary/5 font-medium" : "border-border text-muted-foreground")}>{NATURE_LABEL[n]}</button>)}
            </div>)}
          <div className="space-y-1"><Label className="text-xs" htmlFor="br-year">Exercice</Label>
            <Input id="br-year" className="h-8 w-24 text-xs" maxLength={4} value={year} onChange={(e) => setYear(e.target.value.trim())} /></div>
        </div>
      </div>
      <div className="flex gap-1 border-b border-border mb-4 overflow-x-auto" role="tablist">
        {TABS.map(([v, l]) => (
          <button key={v} role="tab" aria-selected={tab === v} onClick={() => setParams({ tab: v })}
            className={cn("px-3 py-2 text-xs border-b-2 -mb-px whitespace-nowrap", tab === v ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}>{l}</button>))}
      </div>
      {status.error && <p className="text-xs text-destructive mb-3" role="alert">{(status.error as Error).message}</p>}
      {tab === "compare" ? <CompareReport year={year} canExport={canExport} />
        : status.isPending && validYear ? <Loader2 className="w-4 h-4 animate-spin" />
        : rows.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="report-empty">Aucun budget de contrôle approuvé pour {year}.</p>
        : tab === "lines" ? <LinesReport rows={rows} nature={nature} year={year} canExport={canExport} />
        : tab === "sections" ? <SectionsReport rows={rows} nature={nature} year={year} canExport={canExport} />
        : <MonthlyReport rows={rows} nature={nature} year={year} canExport={canExport} />}
    </PageShell>
  );
}

function LinesReport({ rows, nature, year, canExport }: { rows: BudgetStatusRow[]; nature: BudgetNature; year: string; canExport: boolean }) {
  const rev = nature === "revenue";
  const shown = rows.filter((r) => natureOf(r) === nature);
  const roots = new Set(rootLines(shown).map((r) => r.line_id));
  const t = totals(rows, nature);
  const data = shown.map((r) => ({ compte: r.account_code, intitule: r.account_name, section: r.analytic_code ? `${r.analytic_code} ${r.analytic_name}` : "Toutes", periode: periodLabel(r.period),
    budget: r.planned, preengage: r.precommitted, engage: r.committed, realise: r.actual, ecart: rev ? r.actual - r.planned : r.available, taux: consumptionPct(r) ?? "" }));
  const cols: Col<(typeof data)[number]>[] = [{ key: "compte", header: "Compte", width: 12 }, { key: "intitule", header: "Intitulé", width: 34 }, { key: "section", header: "Section", width: 20 },
    { key: "periode", header: "Période", width: 14 }, { key: "budget", header: rev ? "Objectif" : "Budget", width: 15, num: true },
    ...(rev ? [] : [{ key: "preengage", header: "Pré-engagé", width: 15, num: true } as Col<(typeof data)[number]>, { key: "engage", header: "Engagé", width: 15, num: true } as Col<(typeof data)[number]>]),
    { key: "realise", header: "Réalisé", width: 15, num: true }, { key: "ecart", header: rev ? "Écart (réalisé − objectif)" : "Disponible", width: 18, num: true },
    { key: "taux", header: rev ? "Réalisation (%)" : "Consommation (%)", width: 14 }];
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><ReportActions canExport={canExport} title={`Budget / réalisé ${year} — ${NATURE_LABEL[nature]}`} filename={`budget-realise-${year}-${nature}`} rows={data} columns={cols} /></div>
      <div className="card-elevated overflow-x-auto">
        <table className="w-full text-xs" data-testid="report-lines">
          <thead><tr className="bg-muted/30 text-muted-foreground">{cols.map((c) => <th key={c.key} className={cn("p-2", c.num || c.key === "taux" ? "text-right" : "text-left")}>{c.header}</th>)}</tr></thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={r.line_id} data-testid="report-line" className={cn("border-t border-border/50", !roots.has(r.line_id) && "text-muted-foreground")}>
                {cols.map((c) => <td key={c.key} className={cn("p-2", c.num || c.key === "taux" ? "text-right tabular-nums" : "", c.key === "ecart" && Number(data[i].ecart) < 0 && "text-destructive")}>
                  {c.num ? fmt(Number(data[i][c.key])) : c.key === "taux" ? (data[i].taux === "" ? "—" : `${data[i].taux} %`) : String(data[i][c.key])}</td>)}
              </tr>))}
            <tr className="border-t border-border font-semibold bg-muted/20"><td className="p-2" colSpan={4}>Total (lignes non couvertes par une autre)</td>
              <td className="p-2 text-right tabular-nums">{fmt(t.planned)}</td>
              {!rev && <><td className="p-2 text-right tabular-nums">{fmt(t.precommitted)}</td><td className="p-2 text-right tabular-nums">{fmt(t.committed)}</td></>}
              <td className="p-2 text-right tabular-nums">{fmt(t.actual)}</td><td className="p-2 text-right tabular-nums">{fmt(rev ? t.actual - t.planned : t.available)}</td><td /></tr>
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">Lignes en gris : couvertes par une ligne plus large (compte parent ou budget général), hors du total.</p>
    </div>
  );
}

function SectionsReport({ rows, nature, year, canExport }: { rows: BudgetStatusRow[]; nature: BudgetNature; year: string; canExport: boolean }) {
  const rev = nature === "revenue";
  const data = bySection(rows, nature).map((s) => ({ section: s.section, budget: s.planned, preengage: s.precommitted, engage: s.committed, realise: s.actual,
    ecart: rev ? s.actual - s.planned : s.available, taux: s.planned > 0 ? Math.round(((s.precommitted + s.committed + s.actual) / s.planned) * 1000) / 10 : "" }));
  const cols: Col<(typeof data)[number]>[] = [{ key: "section", header: "Section", width: 28 }, { key: "budget", header: rev ? "Objectif" : "Budget", width: 15, num: true },
    { key: "preengage", header: "Pré-engagé", width: 15, num: true }, { key: "engage", header: "Engagé", width: 15, num: true }, { key: "realise", header: "Réalisé", width: 15, num: true },
    { key: "ecart", header: rev ? "Écart" : "Disponible", width: 15, num: true }, { key: "taux", header: "Taux (%)", width: 10 }];
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><ReportActions canExport={canExport} title={`Budget par section ${year} — ${NATURE_LABEL[nature]}`} filename={`budget-sections-${year}-${nature}`} rows={data} columns={cols} /></div>
      <div className="card-elevated overflow-x-auto">
        <table className="w-full text-xs" data-testid="report-sections">
          <thead><tr className="bg-muted/30 text-muted-foreground">{cols.map((c) => <th key={c.key} className={cn("p-2", c.key === "section" ? "text-left" : "text-right")}>{c.header}</th>)}</tr></thead>
          <tbody>
            {data.length === 0 && <tr><td colSpan={cols.length} className="p-4 text-center text-muted-foreground">Aucune ligne de budget sur une section analytique.</td></tr>}
            {data.map((d) => (
              <tr key={d.section} data-testid="report-section" className="border-t border-border/50">
                {cols.map((c) => <td key={c.key} className={cn("p-2", c.key !== "section" && "text-right tabular-nums", c.key === "ecart" && d.ecart < 0 && "text-destructive")}>
                  {c.num ? fmt(Number(d[c.key])) : c.key === "taux" ? (d.taux === "" ? "—" : `${d.taux} %`) : String(d[c.key])}</td>)}
              </tr>))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MonthlyReport({ rows, nature, year, canExport }: { rows: BudgetStatusRow[]; nature: BudgetNature; year: string; canExport: boolean }) {
  const { data: settings } = useBudgetControlSettings();
  const spread = settings?.annual_spread ?? DEFAULT_BUDGET_SETTINGS.annual_spread;
  const method = settings?.forecast_method ?? DEFAULT_BUDGET_SETTINGS.forecast_method;
  const monthly = useBudgetMonthlyActual(year);
  const prior = useBudgetPriorYearMonthly(year, spread === "prior_year");
  const today = useMemo(() => new Date(), []);
  const series = monthlySeries(rows, monthly.data ?? [], year, today, { nature, spread, prior: prior.data, method });
  const data = series.map((p) => ({ mois: p.month, budget: p.planned, realise: p.actual ?? 0, ecart: p.actual == null ? 0 : (nature === "revenue" ? p.actual - p.planned : p.planned - p.actual),
    cumulBudget: p.cumulPlanned, cumulRealise: p.cumulActual ?? 0 }));
  const cols: Col<(typeof data)[number]>[] = [{ key: "mois", header: "Mois", width: 10 }, { key: "budget", header: "Budget du mois", width: 16, num: true },
    { key: "realise", header: "Réalisé", width: 16, num: true }, { key: "ecart", header: "Écart", width: 16, num: true },
    { key: "cumulBudget", header: "Budget cumulé", width: 16, num: true }, { key: "cumulRealise", header: "Réalisé cumulé", width: 16, num: true }];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">Lignes annuelles réparties {ANNUAL_SPREAD_LABELS[spread].toLowerCase()} (Paramètres du budget) ; mois à venir : réalisé non encore connu.</p>
        <ReportActions canExport={canExport} title={`Budget mensuel ${year} — ${NATURE_LABEL[nature]}`} filename={`budget-mensuel-${year}-${nature}`} rows={data} columns={cols} />
      </div>
      <div className="card-elevated p-3">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={series}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
            <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => fmt(v)} width={80} />
            <Tooltip formatter={(v) => (v == null ? "—" : fmt(Number(v)))} contentStyle={{ fontSize: 11, background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="planned" name="Budget" fill="hsl(var(--chart-1))" radius={[3, 3, 0, 0]} />
            <Bar dataKey="actual" name="Réalisé" fill="hsl(var(--chart-2))" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="card-elevated overflow-x-auto">
        <table className="w-full text-xs" data-testid="report-monthly">
          <thead><tr className="bg-muted/30 text-muted-foreground">{cols.map((c) => <th key={c.key} className={cn("p-2", c.num ? "text-right" : "text-left")}>{c.header}</th>)}</tr></thead>
          <tbody>{data.map((d, i) => (
            <tr key={d.mois} data-testid="report-month" className="border-t border-border/50">
              {cols.map((c) => <td key={c.key} className={cn("p-2", c.num && "text-right tabular-nums", c.key === "ecart" && d.ecart < 0 && "text-destructive")}>
                {c.num ? (series[i].actual == null && (c.key === "realise" || c.key === "ecart" || c.key === "cumulRealise") ? "—" : fmt(Number(d[c.key]))) : String(d[c.key])}</td>)}
            </tr>))}</tbody>
        </table>
      </div>
    </div>
  );
}

type Source = { value: string; label: string };

function CompareReport({ year, canExport }: { year: string; canExport: boolean }) {
  const { data: budgets = [] } = useBudgetList();
  const { data: versions = [] } = useBudgetForecasts(year);
  const sources: Source[] = [...budgets.map((b) => ({ value: `b:${b.id}`, label: `Budget « ${b.name} » (${b.fiscal_year})` })),
    ...versions.map((v) => ({ value: `f:${v.id}`, label: `Prévision « ${v.name} » (${v.fiscal_year}, ${v.status === "published" ? "publiée" : "brouillon"})` }))];
  const [a, setA] = useState(""), [b, setB] = useState("");
  const load = (s: string) => (s.startsWith("b:") ? fetchBudgetAmounts(s.slice(2)) : fetchForecastAmounts(s.slice(2)));
  const q = useQuery({ queryKey: ["budget-compare", a, b], enabled: !!a && !!b, queryFn: async () => compareAmounts(await load(a), await load(b)) });
  const lines: CompareLine[] = q.data ?? [];
  const label = (s: string) => sources.find((x) => x.value === s)?.label ?? "";
  const data = lines.map((l) => ({ compte: l.account, section: l.section || "Toutes", a: l.a, b: l.b, ecart: l.diff, pct: l.pct ?? "" }));
  const cols: Col<(typeof data)[number]>[] = [{ key: "compte", header: "Compte", width: 12 }, { key: "section", header: "Section", width: 18 },
    { key: "a", header: "Source A", width: 16, num: true }, { key: "b", header: "Source B", width: 16, num: true }, { key: "ecart", header: "Écart (B − A)", width: 16, num: true },
    { key: "pct", header: "Écart (%)", width: 10 }];
  const sel = (id: string, v: string, set: (s: string) => void, l: string) => (
    <div className="space-y-1"><Label className="text-xs" htmlFor={id}>{l}</Label>
      <select id={id} className="h-8 w-80 max-w-full rounded-md border border-input bg-background px-2 text-xs" value={v} onChange={(e) => set(e.target.value)}>
        <option value="">— choisir —</option>{sources.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select></div>);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        {sel("cmp-a", a, setA, "Source A (référence)")}{sel("cmp-b", b, setB, "Source B (comparée)")}
        <ReportActions canExport={canExport} title={`Comparaison : ${label(a)} / ${label(b)}`} filename={`comparaison-budgets-${year}`} rows={data} columns={cols} />
      </div>
      <p className="text-[11px] text-muted-foreground">Budgets : tous exercices ; versions de prévision : celles de l'exercice {year}. Montants par compte × section (les lignes mensuelles d'un budget sont additionnées) ; pas de total : une section et le budget général de son compte se recouvrent.</p>
      {q.error && <p className="text-xs text-destructive" role="alert">{(q.error as Error).message}</p>}
      {!a || !b ? <p className="text-xs text-muted-foreground">Choisissez deux sources.</p> : q.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : (
        <div className="card-elevated overflow-x-auto">
          <table className="w-full text-xs" data-testid="report-compare">
            <thead><tr className="bg-muted/30 text-muted-foreground">{cols.map((c) => <th key={c.key} className={cn("p-2", c.num || c.key === "pct" ? "text-right" : "text-left")}>{c.header}</th>)}</tr></thead>
            <tbody>
              {data.length === 0 && <tr><td colSpan={cols.length} className="p-4 text-center text-muted-foreground">Aucune ligne.</td></tr>}
              {data.map((d) => (
                <tr key={`${d.compte}|${d.section}`} data-testid="report-compare-line" className="border-t border-border/50">
                  {cols.map((c) => <td key={c.key} className={cn("p-2", (c.num || c.key === "pct") && "text-right tabular-nums")}>
                    {c.num ? fmt(Number(d[c.key])) : c.key === "pct" ? (d.pct === "" ? "—" : `${d.pct} %`) : String(d[c.key])}</td>)}
                </tr>))}
            </tbody>
          </table>
        </div>)}
    </div>
  );
}
