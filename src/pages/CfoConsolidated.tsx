import { useEffect, useMemo, useRef, useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Building2, Download, RefreshCw, AlertCircle } from "lucide-react";
import {
  useAccessibleTenants,
  useConsolidatedCfoKpis,
  sumKpis,
  type ConsolidatedKpiRow,
} from "@/hooks/use-consolidated-cfo";
import { useConsolidatedTrends, type TrendMonths } from "@/hooks/use-consolidated-trends";
import { exportToCSV } from "@/lib/csv-export";
import { toast } from "sonner";

const fmt = (v: number, ccy: string) =>
  `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(v)} ${ccy}`;

import { ConsolidatedTrendsCard } from "@/components/ConsolidatedTrendsCard";
import { KpiDrilldownDialog } from "@/components/KpiDrilldownDialog";

const KPI_COLS: { key: keyof ConsolidatedKpiRow; label: string; money?: boolean; source: string }[] = [
  { key: "cash_on_hand", label: "Trésorerie", money: true, source: "bank_accounts.balance" },
  { key: "ar_outstanding", label: "Créances", money: true, source: "ar_invoices (statut ouvert)" },
  { key: "ap_outstanding", label: "Dettes", money: true, source: "ap_invoices (statut ouvert)" },
  { key: "ar_overdue", label: "AR en retard", money: true, source: "ar_invoices.due_date < today" },
  { key: "ap_overdue", label: "AP en retard", money: true, source: "ap_invoices.due_date < today" },
  { key: "open_projects", label: "Projets actifs", source: "projects.status = 'active'" },
  { key: "open_risks_high", label: "Risques élevés", source: "risk_register (risk_score >= 9, statut non clôturé)" },
  { key: "unmatched_recon_count", label: "Rapproch. ouverts", source: "bank_reconciliations (unmatched)" },
];

export default function CfoConsolidated() {
  const tenants = useAccessibleTenants();
  const [selected, setSelected] = useState<string[]>([]);
  const [trendMonths, setTrendMonths] = useState<TrendMonths>(12);
  const [drillKey, setDrillKey] = useState<keyof ConsolidatedKpiRow | null>(null);
  const drillTrigger = useRef<HTMLButtonElement | null>(null);

  const selectionInitialized = useRef(false);
  // Initialiser une fois, sans rétablir une sélection volontairement vide.
  useEffect(() => {
    if (tenants.data && !selectionInitialized.current) {
      selectionInitialized.current = true;
      setSelected(tenants.data.map((t) => t.id));
    }
  }, [tenants.data]);

  const kpis = useConsolidatedCfoKpis(selected);
  const trends = useConsolidatedTrends(selected, trendMonths);
  const totals = useMemo(() => (kpis.data ? sumKpis(kpis.data) : null), [kpis.data]);
  const drillCol = drillKey ? KPI_COLS.find((c) => c.key === drillKey) ?? null : null;

  // Toasts d'erreur explicites
  const errRefs = useRef({ tenants: false, kpis: false });
  useEffect(() => {
    if (tenants.isError && !errRefs.current.tenants) {
      errRefs.current.tenants = true;
      toast.error("Impossible de charger la liste des sociétés");
    }
    if (!tenants.isError) errRefs.current.tenants = false;
  }, [tenants.isError]);
  useEffect(() => {
    if (kpis.isError && !errRefs.current.kpis) {
      errRefs.current.kpis = true;
      toast.error("Échec du chargement des KPIs consolidés");
    }
    if (!kpis.isError) errRefs.current.kpis = false;
  }, [kpis.isError]);
  useEffect(() => {
    if (drillKey && kpis.isError) toast.error("Drill-down indisponible : données KPI manquantes");
  }, [drillKey, kpis.isError]);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const exportCsv = () => {
    if (!kpis.data?.length || !trends.data || kpis.isFetching || trends.isFetching || kpis.isError || trends.isError) {
      toast.error("Export indisponible : attendez le chargement des indicateurs et des tendances.");
      return;
    }
    const scope = kpis.data.map((r) => r.tenant_name).join(" ; ");
    const currency = totals?.currency ?? "XOF";
    const rows: Record<string, unknown>[] = [
      ...kpis.data.map((r) => ({ ...r, section: "KPI par société", scope, months: trendMonths })),
      ...trends.data.map((r) => ({ ...r, cashBalance: r.cashBalance ?? "Non renseigné", section: "Tendance consolidée", scope, months: trendMonths, currency })),
    ];
    exportToCSV(
      rows,
      [
        { key: "section", header: "Type de données" },
        { key: "scope", header: "Sociétés sélectionnées" },
        { key: "months", header: "Période (mois)" },
        { key: "tenant_name", header: "Société" },
        { key: "currency", header: "Devise" },
        ...KPI_COLS.map((c) => ({ key: c.key, header: c.label })),
        { key: "month", header: "Mois" },
        { key: "label", header: "Période" },
        { key: "revenue", header: "Total Revenue" },
        { key: "expenses", header: "Total Expenses" },
        { key: "netProfit", header: "Net Profit" },
        { key: "cashBalance", header: "Cash Balance" },
      ],
      `cfo-consolidated-${new Date().toISOString().slice(0, 10)}`,
    );
    toast.success(`Export CSV généré : indicateurs et tendances sur ${trendMonths} mois`);
  };

  const exportTrendsCsv = () => {
    const rows = trends.data ?? [];
    if (!rows.length) {
      toast.error("Aucune donnée de tendance à exporter");
      return;
    }
    exportToCSV(
      rows.map((row) => ({ ...row, cashBalance: row.cashBalance ?? "Non renseigné" })),
      [
        { key: "month", header: "Mois" },
        { key: "label", header: "Période" },
        { key: "revenue", header: "Total Revenue" },
        { key: "expenses", header: "Total Expenses" },
        { key: "netProfit", header: "Net Profit" },
        { key: "cashBalance", header: "Cash Balance" },
      ],
      `cfo-consolidated-trends-${trendMonths}m-${new Date().toISOString().slice(0, 10)}`,
    );
    toast.success("Export CSV des tendances généré");
  };


  return (
    <PageShell>
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">Cockpit CFO consolidé</h1>
        <p className="text-sm text-muted-foreground">Vue multi-sociétés des KPIs financiers</p>
      </div>
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4" /> Sociétés
            </CardTitle>
          </CardHeader>
          <CardContent>
            {tenants.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-6" />)}
              </div>
            ) : tenants.isError ? (
              <div className="text-sm text-destructive flex items-center gap-2">
                <AlertCircle className="h-4 w-4" /> Impossible de charger les sociétés.
                <Button size="sm" variant="ghost" onClick={() => tenants.refetch()}>
                  <RefreshCw className="h-3 w-3 mr-1" /> Réessayer
                </Button>
              </div>
            ) : (tenants.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aucune société accessible. Demandez à un administrateur de vous attribuer un rôle.
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {(tenants.data ?? []).map((t) => (
                  <label key={t.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={selected.includes(t.id)}
                      onCheckedChange={() => toggle(t.id)}
                    />
                    <span className="truncate">{t.name}</span>
                    <Badge variant="outline" className="text-[10px]">{t.currency}</Badge>
                  </label>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">KPIs par société</CardTitle>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => kpis.refetch()} disabled={kpis.isFetching}>
                <RefreshCw className="h-3 w-3 mr-1" /> Actualiser
              </Button>
              <Button size="sm" onClick={exportCsv} disabled={!kpis.data?.length || !trends.data || kpis.isFetching || trends.isFetching || kpis.isError || trends.isError}>
                <Download className="h-3 w-3 mr-1" /> CSV
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {selected.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sélectionnez au moins une société.</p>
            ) : kpis.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8" />)}
              </div>
            ) : kpis.isError ? (
              <div className="text-sm text-destructive flex items-center gap-2">
                <AlertCircle className="h-4 w-4" /> Erreur de chargement des KPIs.
                <Button size="sm" variant="ghost" onClick={() => kpis.refetch()}>
                  <RefreshCw className="h-3 w-3 mr-1" /> Réessayer
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Société</TableHead>
                      {KPI_COLS.map((c) => (
                        <TableHead
                          key={c.key as string}
                          className="text-right"
                        >
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Ouvrir la décomposition par société pour ${c.label}`}
                            aria-haspopup="dialog"
                            data-testid={`kpi-header-${c.key as string}`}
                            onClick={(event) => {
                              drillTrigger.current = event.currentTarget;
                              setDrillKey(c.key);
                            }}
                          >
                            {c.label}
                          </Button>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(kpis.data ?? []).map((r) => (
                      <TableRow key={r.tenant_id}>
                        <TableCell className="font-medium">
                          {r.tenant_name}
                          <span className="ml-1 text-[10px] text-muted-foreground">{r.currency}</span>
                        </TableCell>
                        {KPI_COLS.map((c) => (
                          <TableCell key={c.key as string} className="text-right tabular-nums">
                            {c.money ? fmt(Number(r[c.key]), r.currency) : Number(r[c.key])}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                    {totals && (kpis.data ?? []).length > 1 && (
                      <TableRow className="bg-muted/40 font-semibold">
                        <TableCell>Total consolidé</TableCell>
                        {KPI_COLS.map((c) => (
                          <TableCell key={c.key as string} className="text-right tabular-nums">
                            {c.money ? fmt(Number(totals[c.key as keyof typeof totals]), totals.currency) : Number(totals[c.key as keyof typeof totals])}
                          </TableCell>
                        ))}
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <ConsolidatedTrendsCard
          tenantIds={selected}
          months={trendMonths}
          onMonthsChange={setTrendMonths}
        />

        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={exportTrendsCsv} disabled={!trends.data?.length}>
            <Download className="h-3 w-3 mr-1" /> CSV tendances ({trendMonths}m)
          </Button>
        </div>
      </div>

      <KpiDrilldownDialog
        open={!!drillKey}
        onOpenChange={(o) => !o && setDrillKey(null)}
        kpiKey={drillKey}
        kpiLabel={drillCol?.label ?? ""}
        isMoney={!!drillCol?.money}
        source={drillCol?.source ?? ""}
        rows={kpis.data ?? []}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          drillTrigger.current?.focus();
        }}
      />
    </PageShell>
  );
}
