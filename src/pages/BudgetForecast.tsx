import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { ExportButtons } from "@/components/ExportButtons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBudgetControlSettings, useBudgetMonthlyActual, useBudgetStatus } from "@/hooks/use-budget-control";
import { elapsedMonths, forecastRows, monthlySeries, totals, type ForecastRow } from "@/lib/budget-forecast";
import { cn } from "@/lib/utils";
import { useMyAccess } from "@/hooks/use-my-access";
import { BudgetForecastVersions } from "@/components/BudgetForecastVersions";

/*
 * Budget et prévisions — tableau de bord (V77). Budget de contrôle approuvé de l'exercice, consommation
 * (pré-engagé, engagé, réalisé) et atterrissage de fin d'exercice : le plus prudent entre ce qui est déjà
 * acquis ou réservé et le réalisé extrapolé au rythme mensuel moyen. Aucune donnée de démonstration.
 */
const fmt = (n: number) => Number(n || 0).toLocaleString("fr-FR", { maximumFractionDigits: 0 });
const STATUS: Record<ForecastRow["status"], [string, string]> = {
  over: ["Dépassement prévu", "text-destructive"], risk: ["Proche du budget", "text-warning"], ok: ["Dans le budget", "text-success"],
};

function Kpi({ id, label, value, hint, tone }: { id: string; label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="card-elevated p-3" data-testid={`budget-kpi-${id}`}>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("text-lg font-semibold tabular-nums", tone)}>{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function BudgetForecast() {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const validYear = /^\d{4}$/.test(year);
  const status = useBudgetStatus(validYear ? year : "");
  const monthly = useBudgetMonthlyActual(validYear ? year : "");
  const { data: settings } = useBudgetControlSettings();
  const today = useMemo(() => new Date(), []);
  const rows = useMemo(() => status.data ?? [], [status.data]);
  const threshold = settings?.alert_threshold_pct ?? 90;
  const forecast = useMemo(() => forecastRows(rows, year, today, threshold), [rows, year, today, threshold]);
  const series = useMemo(() => monthlySeries(rows, monthly.data ?? [], year, today), [rows, monthly.data, year, today]);
  const t = totals(rows);
  const landing = forecast.reduce((s, f) => s + f.landing, 0);
  const m = elapsedMonths(year, today);
  const permissions = useMyAccess().data?.permissions ?? [];
  const canExport = permissions.includes("budget.export");
  const canForecast = permissions.includes("budget.forecast");

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Comptabilité et finance" }, { label: "Budget et prévisions", href: "/budget" }, { label: "Tableau de bord" }]} />
      <GuidanceBanner title="Budget et prévisions"
        description="Budget de contrôle approuvé de l'exercice, consommé (demandes d'achat pré-engagées, commandes engagées, écritures réalisées) et atterrissage de fin d'exercice. L'atterrissage retient le plus prudent de deux estimations : ce qui est déjà acquis ou réservé, ou le réalisé extrapolé au rythme mensuel moyen." />
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <h1 className="text-lg font-semibold text-foreground">Budget et prévisions {validYear ? year : ""}</h1>
        <div className="flex items-end gap-2">
          <div className="space-y-1"><Label className="text-xs" htmlFor="bf-year">Exercice</Label>
            <Input id="bf-year" className="h-8 w-24 text-xs" maxLength={4} value={year} onChange={(e) => setYear(e.target.value.trim())} /></div>
          {canExport && <ExportButtons label="Exporter les prévisions" filename={`previsions-budgetaires-${year}`} sheetName="Prévisions"
            rows={forecast.map((f) => ({ compte: f.account_code, intitule: f.account_name, section: f.section ?? "Toutes", budget: f.planned, realise: f.actual, engage: f.committed,
              preengage: f.precommitted, connu: f.known, rythme: f.runRate ?? "", atterrissage: f.landing, ecart: f.variance, etat: STATUS[f.status][0] }))}
            columns={[{ key: "compte", header: "Compte", width: 12 }, { key: "intitule", header: "Intitulé", width: 34 }, { key: "section", header: "Section", width: 22 },
              { key: "budget", header: "Budget", width: 15 }, { key: "realise", header: "Réalisé", width: 15 }, { key: "engage", header: "Engagé", width: 15 },
              { key: "preengage", header: "Pré-engagé", width: 15 }, { key: "connu", header: "Acquis et réservé", width: 17 }, { key: "rythme", header: "Rythme actuel", width: 15 },
              { key: "atterrissage", header: "Atterrissage", width: 15 }, { key: "ecart", header: "Écart", width: 15 }, { key: "etat", header: "État", width: 18 }]} />}
        </div>
      </div>

      {status.error && <p className="text-xs text-destructive mb-3" role="alert">{(status.error as Error).message}</p>}
      {status.isPending && validYear ? <Loader2 className="w-4 h-4 animate-spin" /> : rows.length === 0 ? (
        <Card className="border-border"><CardContent className="p-6 text-sm text-muted-foreground" data-testid="budget-forecast-empty">
          Aucun budget de contrôle approuvé pour {year}. Préparez-le et faites-le approuver dans <Link className="text-primary underline" to="/budget/transactions">Transactions</Link>.
        </CardContent></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
            <Kpi id="planned" label="Budget" value={fmt(t.planned)} hint="Lignes racines, sans double compte" />
            <Kpi id="consumed" label="Consommé" value={fmt(t.precommitted + t.committed + t.actual)}
              hint={`Pré-engagé ${fmt(t.precommitted)} · engagé ${fmt(t.committed)} · réalisé ${fmt(t.actual)}`} />
            <Kpi id="available" label="Disponible" value={fmt(t.available)} tone={t.available < 0 ? "text-destructive" : undefined} />
            <Kpi id="landing" label="Atterrissage prévu" value={fmt(landing)} hint={m === 0 ? "Exercice non commencé : engagements connus" : `${m} mois écoulé(s) sur 12`} />
            <Kpi id="variance" label="Écart prévu" value={fmt(t.planned - landing)} tone={t.planned - landing < 0 ? "text-destructive" : "text-success"} hint="Budget − atterrissage" />
          </div>

          <Card className="border-border mb-4">
            <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Cumul de l'exercice : budget, réalisé et prévision</CardTitle></CardHeader>
            <CardContent className="p-4 pt-0" data-testid="budget-forecast-chart">
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={series}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => fmt(v)} width={80} />
                  <Tooltip formatter={(v) => (v == null ? "—" : fmt(Number(v)))} contentStyle={{ fontSize: 11, background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="cumulPlanned" name="Budget cumulé" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="cumulActual" name="Réalisé cumulé" stroke="hsl(var(--chart-2))" strokeWidth={2} connectNulls={false} />
                  <Line type="monotone" dataKey="cumulForecast" name="Prévision cumulée" stroke="hsl(var(--chart-3))" strokeDasharray="5 4" dot={false} />
                </LineChart>
              </ResponsiveContainer>
              <p className="text-[10px] text-muted-foreground">Une ligne annuelle est répartie par douzièmes ; la prévision prolonge le réalisé jusqu'à l'atterrissage, réparti également sur les mois restants.</p>
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Atterrissage par compte et section</CardTitle></CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-xs" data-testid="budget-forecast">
                <thead><tr className="bg-muted/30 text-muted-foreground">
                  <th className="text-left p-2">Compte</th><th className="text-left">Section</th><th className="text-right">Budget</th><th className="text-right">Réalisé</th>
                  <th className="text-right">Engagé</th><th className="text-right">Pré-engagé</th><th className="text-right">Acquis et réservé</th><th className="text-right">Rythme actuel</th>
                  <th className="text-right">Atterrissage</th><th className="text-right">Écart</th><th className="text-left pl-3 pr-2">État</th></tr></thead>
                <tbody>
                  {forecast.map((f) => (
                    <tr key={f.key} data-testid="forecast-row" className="border-t border-border/50">
                      <td className="p-2"><span className="font-mono">{f.account_code}</span> {f.account_name}</td><td>{f.section ?? "Toutes"}</td>
                      <td className="text-right tabular-nums">{fmt(f.planned)}</td><td className="text-right tabular-nums">{fmt(f.actual)}</td>
                      <td className="text-right tabular-nums">{fmt(f.committed)}</td><td className="text-right tabular-nums">{fmt(f.precommitted)}</td>
                      <td className="text-right tabular-nums">{fmt(f.known)}</td><td className="text-right tabular-nums">{f.runRate == null ? "—" : fmt(f.runRate)}</td>
                      <td className="text-right tabular-nums font-medium">{fmt(f.landing)}</td>
                      <td className={cn("text-right tabular-nums", f.variance < 0 && "text-destructive")}>{fmt(f.variance)}</td>
                      <td className={cn("pl-3 pr-2 whitespace-nowrap", STATUS[f.status][1])}>{STATUS[f.status][0]}</td>
                    </tr>))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
      {validYear && <BudgetForecastVersions year={year} status={rows} forecast={forecast} canForecast={canForecast} canExport={canExport} />}
    </PageShell>
  );
}
