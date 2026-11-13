import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Download, FileDown, Lock, ShieldCheck, Eye, CalendarClock, ArrowUp, ArrowDown, X, AlertTriangle, RefreshCw, Loader2 } from "lucide-react";
import {
  BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import {
  useValuationByCategory, useInventoryTurnover, useStockAging, useMyInventoryRoles,
  useAbcAnalysis, useSlowMovingItems,
  useInventoryCloseAudit, useInventoryPeriodLocks,
  useInventoryPeriodClosesPaged, fetchAllInventoryCloses,
  logInventoryExportAudit,
  type InventoryPeriodClose,
} from "@/hooks/use-inventory-data";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantId } from "@/hooks/use-tenant";
import { actionTooltip, canDo } from "@/lib/inventory-roles";
import { exportToCSV } from "@/lib/csv-export";
import { exportToPDF } from "@/lib/pdf-export";
import InventoryCloseDetailDialog from "@/components/InventoryCloseDetailDialog";
import {
  isValidPeriod,
  parseFiltersFromSearchParams, applyFilterChange, toggleSort,
  type HistoryFilters, type SortKey,
} from "@/lib/inventory-close-history";
import {
  useInventoryExportAudit, filtersToSearchParams,
  type ParsedExportAudit,
} from "@/hooks/use-inventory-export-audit";

import { toast } from "sonner";




const CLOSE_ACTION_LABEL: Record<string, { label: string; cls: string }> = {
  period_close:             { label: "Clôture",                  cls: "bg-success/15 text-success" },
  period_close_idempotent:  { label: "Re-clôture (idempotent)",  cls: "bg-muted text-muted-foreground" },
  period_close_attempt:     { label: "Tentative",                cls: "bg-amber-500/15 text-amber-700" },
  period_close_failed:      { label: "Échec",                    cls: "bg-destructive/15 text-destructive" },
};


const fmt = (n: number | null | undefined) => Math.round(Number(n || 0)).toLocaleString("fr-FR");

const AGE_ORDER = ["0-30 jours", "31-60 jours", "61-90 jours", "90+ jours"];

export default function InventoryReporting() {
  const { data: valuation = [], isLoading: vLoading } = useValuationByCategory();
  const { data: turnover = [], isLoading: tLoading } = useInventoryTurnover();
  const { data: aging = [], isLoading: aLoading } = useStockAging();
  const { data: abc = [], isLoading: abcLoading } = useAbcAnalysis();
  const { data: slow = [], isLoading: slowLoading } = useSlowMovingItems();
  const { data: closeAudit = [], isLoading: auditLoading } = useInventoryCloseAudit();
  const { data: periodLocks = [], isLoading: locksLoading } = useInventoryPeriodLocks();
  const { data: perms } = useMyInventoryRoles();
  const canExport = canDo(perms, "export");
  const { user } = useAuth();
  const { data: tenantId } = useTenantId();

  const [detail, setDetail] = useState<InventoryPeriodClose | null>(null);
  const [exporting, setExporting] = useState<null | "csv" | "pdf">(null);
  const abortRef = useRef<AbortController | null>(null);

  /* ── URL-persisted filters (shared helpers, tested) ────── */
  const [sp, setSp] = useSearchParams();
  const filters: HistoryFilters = useMemo(() => parseFiltersFromSearchParams(sp), [sp]);

  const setF = useCallback(<K extends keyof HistoryFilters>(k: K, v: HistoryFilters[K]) => {
    setSp(applyFilterChange(sp, k, v), { replace: true });
  }, [sp, setSp]);
  const onToggleSort = useCallback((k: SortKey) => {
    setSp(toggleSort(sp, k), { replace: true });
  }, [sp, setSp]);
  const resetFilters = () => setSp(new URLSearchParams(), { replace: true });

  /* ── Server-side paged + sorted closes ─────────────────── */
  const serverQueryParams = {
    page: filters.page,
    pageSize: filters.pageSize,
    sortKey: (filters.sortKey === "status_label" ? "closed_at" : filters.sortKey) as "period" | "closed_at",
    sortDir: filters.sortDir,
    from: filters.from || undefined,
    to: filters.to || undefined,
    periodSearch: filters.search || undefined,
  };
  const {
    data: paged, isLoading: closesLoading, isFetching: closesFetching,
    isError: closesError, error: closesErrObj, refetch: refetchCloses,
  } = useInventoryPeriodClosesPaged(serverQueryParams);
  const serverRows = paged?.rows ?? [];
  const serverTotal = paged?.count ?? 0;

  // Toast once per error transition so we don't spam the user on retries.
  const lastErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (closesError) {
      const msg = (closesErrObj as Error)?.message ?? "Erreur inconnue";
      if (lastErrorRef.current !== msg) {
        toast.error(`Échec chargement historique — ${msg}`, {
          action: { label: "Réessayer", onClick: () => { void refetchCloses(); } },
        });
        lastErrorRef.current = msg;
      }
    } else if (!closesFetching) {
      lastErrorRef.current = null;
    }
  }, [closesError, closesErrObj, closesFetching, refetchCloses]);

  // Augment with status from audit + apply page-level client filters (status/invalidOnly/search beyond period).
  const closeStatus = useMemo(() => {
    const m = new Map<string, { status: "ok" | "failed" | "pending"; error: string | null; attempts: number }>();
    for (const a of [...closeAudit].reverse()) {
      const period = (a.comment ?? "").split(" — ")[0];
      if (!period) continue;
      const cur = m.get(period) ?? { status: "pending", error: null, attempts: 0 };
      if (a.action === "period_close_attempt") cur.attempts += 1;
      if (a.action === "period_close" || a.action === "period_close_idempotent") { cur.status = "ok"; cur.error = null; }
      else if (a.action === "period_close_failed") {
        cur.status = "failed";
        cur.error = (a.comment ?? "").split(" — ").slice(1).join(" — ") || "Erreur inconnue";
      } else if (a.action === "period_close_attempt" && cur.status === "pending") {
        cur.status = "pending";
      }
      m.set(period, cur);
    }
    return m;
  }, [closeAudit]);

  type Row = InventoryPeriodClose & {
    status_label: string; error_message: string; closed_at_fmt: string; attempts: number;
  };
  const augment = useCallback((rows: InventoryPeriodClose[]): Row[] => rows.map((c) => {
    const s = closeStatus.get(c.period);
    return {
      ...c,
      status_label: s?.status === "failed" ? "Échec" : "Terminée",
      error_message: s?.error ?? "",
      attempts: s?.attempts ?? 0,
      closed_at_fmt: new Date(c.closed_at).toLocaleString("fr-FR"),
    };
  }), [closeStatus]);

  const augmented = useMemo(() => augment(serverRows), [serverRows, augment]);
  const q = filters.search.trim().toLowerCase();
  const pageRows = augmented.filter((r) => {
    if (filters.status === "ok" && r.status_label !== "Terminée") return false;
    if (filters.status === "failed" && r.status_label !== "Échec") return false;
    if (filters.invalidOnly && isValidPeriod(r.period) && !r.error_message) return false;
    if (q) {
      const hay = `${r.period} ${r.closed_by ?? ""} ${r.error_message}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(serverTotal / filters.pageSize));

  // Reset page if out of range when total shrinks.
  useEffect(() => {
    if (filters.page > totalPages) setF("page", 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalPages]);

  /* ── Bulk export of EVERY filtered row (no cap) ────────── */
  const runFullExport = useCallback(async (kind: "csv" | "pdf") => {
    if (!canExport) { toast.error("Export non autorisé"); return; }
    if (serverTotal === 0) { toast.error("Rien à exporter"); return; }
    const CONFIRM_THRESHOLD = 500;
    if (serverTotal > CONFIRM_THRESHOLD && !window.confirm(
      `Confirmer l'export ${kind.toUpperCase()} de ${serverTotal.toLocaleString("fr-FR")} clôtures correspondant aux filtres ? Cette opération peut prendre du temps.`,
    )) return;

    const auditFilters = {
      search: filters.search || null,
      status: filters.status,
      from: filters.from || null,
      to: filters.to || null,
      invalidOnly: filters.invalidOnly,
      sortKey: serverQueryParams.sortKey,
      sortDir: filters.sortDir,
    };

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setExporting(kind);
    const toastId = toast.loading(`Préparation de l'export ${kind.toUpperCase()} — 0 / ${serverTotal}…`, {
      action: { label: "Annuler", onClick: () => ctrl.abort() },
    });
    let loadedCount = 0;
    try {
      const all = augment(await fetchAllInventoryCloses(
        {
          sortKey: serverQueryParams.sortKey,
          sortDir: filters.sortDir,
          from: filters.from || undefined,
          to: filters.to || undefined,
          periodSearch: filters.search || undefined,
        },
        {
          signal: ctrl.signal,
          onProgress: (loaded, total) => {
            loadedCount = loaded;
            toast.loading(
              `Préparation de l'export ${kind.toUpperCase()} — ${loaded.toLocaleString("fr-FR")} / ${total.toLocaleString("fr-FR")}…`,
              { id: toastId, action: { label: "Annuler", onClick: () => ctrl.abort() } },
            );
          },
        },
      ));
      if (kind === "csv") {
        exportToCSV(
          all as unknown as Record<string, unknown>[],
          [
            { key: "period",        header: "Période" },
            { key: "closed_at_fmt", header: "Clôturée le" },
            { key: "closed_by",     header: "Par" },
            { key: "status_label",  header: "Statut" },
            { key: "items_count",   header: "Articles" },
            { key: "total_qty",     header: "Quantité" },
            { key: "total_value",   header: "Valeur (XOF)" },
            { key: "error_message", header: "Erreur" },
            { key: "attempts",      header: "Tentatives" },
          ],
          "historique-clotures-stock",
        );
      } else {
        // Attendu : le toast « terminé » et l'audit « success » ne viennent qu'après le fichier ;
        // un échec passe par le catch ci-dessous (toast d'échec + audit « failed »).
        await exportToPDF<Row>({
          filename: "historique-clotures-stock",
          title: "Historique des clôtures de stock",
          subtitle: `${all.length.toLocaleString("fr-FR")} clôture(s) — généré ${new Date().toLocaleDateString("fr-FR")}`,
          columns: [
            { key: "period",        header: "Période" },
            { key: "closed_at_fmt", header: "Clôturée le" },
            { key: "status_label",  header: "Statut" },
            { key: "items_count",   header: "Articles" },
            { key: "total_qty",     header: "Quantité" },
            { key: "total_value",   header: "Valeur (XOF)" },
            { key: "error_message", header: "Erreur" },
            { key: "attempts",      header: "Tentatives" },
          ],
          rows: all,
          orientation: "landscape",
        }, { throwOnError: true });
      }
      toast.success(`Export ${kind.toUpperCase()} terminé — ${all.length.toLocaleString("fr-FR")} ligne(s)`, { id: toastId });
      if (tenantId && user?.id) {
        void logInventoryExportAudit({
          tenantId, userId: user.id, kind, status: "success",
          rowCount: all.length, filters: auditFilters,
        });
      }
    } catch (e) {
      const msg = (e as Error)?.message ?? "Erreur";
      const aborted = ctrl.signal.aborted || /annul/i.test(msg);
      if (aborted) {
        toast.warning(`Export ${kind.toUpperCase()} annulé — ${loadedCount.toLocaleString("fr-FR")} ligne(s) chargée(s)`, { id: toastId });
      } else {
        toast.error(`Échec export ${kind.toUpperCase()} — ${msg}`, { id: toastId });
      }
      if (tenantId && user?.id) {
        void logInventoryExportAudit({
          tenantId, userId: user.id, kind,
          status: aborted ? "aborted" : "failed",
          rowCount: loadedCount, filters: auditFilters, error: msg,
        });
      }
    } finally {
      setExporting(null);
      abortRef.current = null;
    }
  }, [canExport, serverTotal, augment, serverQueryParams.sortKey, filters.sortDir, filters.from, filters.to, filters.search, filters.status, filters.invalidOnly, tenantId, user?.id]);

  const exportClosesCsv = () => { void runFullExport("csv"); };
  const exportClosesPdf = () => { void runFullExport("pdf"); };
  const cancelExport = () => {
    abortRef.current?.abort();
  };

  /* ── Recent CSV/PDF export audit + "Retenter" handler ───── */
  const { data: exportAudit = [], isLoading: exportAuditLoading } = useInventoryExportAudit(25);
  const retryExportFromAudit = useCallback((row: ParsedExportAudit) => {
    if (!row.kind) { toast.error("Type d'export inconnu — impossible de retenter"); return; }
    const sp = filtersToSearchParams(row.filters);
    setSp(sp, { replace: true });
    // Defer so the URL → filters → server query has time to refetch before exporting.
    setTimeout(() => { void runFullExport(row.kind!); }, 50);
  }, [setSp, runFullExport]);





  const agingSorted = useMemo(
    () => AGE_ORDER.map((b) => aging.find((a) => a.age_bucket === b) ?? { age_bucket: b, stock_value: 0, qty_remaining: 0, items_count: 0 }),
    [aging],
  );
  const totalAging = agingSorted.reduce((s, a) => s + Number(a.stock_value || 0), 0);
  const slowMoving = agingSorted[3]?.stock_value ?? 0;

  const totals = useMemo(() => ({
    items: valuation.reduce((s, r) => s + Number(r.items_count || 0), 0),
    qty:   valuation.reduce((s, r) => s + Number(r.total_qty || 0), 0),
    fifo:  valuation.reduce((s, r) => s + Number(r.fifo_value || 0), 0),
    avg:   valuation.reduce((s, r) => s + Number(r.avg_cost_value || 0), 0),
    var_:  valuation.reduce((s, r) => s + Number(r.variance || 0), 0),
  }), [valuation]);

  const exportValuation = () => {
    if (!canExport) { toast.error("Export non autorisé"); return; }
    exportToCSV(
      valuation as unknown as Record<string, unknown>[],
      [
        { key: "category", header: "Catégorie" },
        { key: "items_count", header: "Articles" },
        { key: "total_qty", header: "Qté" },
        { key: "fifo_value", header: "Valeur FIFO" },
        { key: "avg_cost_value", header: "Valeur CMP" },
        { key: "variance", header: "Écart" },
      ],
      "valorisation-par-categorie",
    );
  };
  const exportTurnover = () => {
    if (!canExport) { toast.error("Export non autorisé"); return; }
    exportToCSV(
      turnover as unknown as Record<string, unknown>[],
      [
        { key: "category", header: "Catégorie" },
        { key: "inv_value", header: "Valeur stock" },
        { key: "cogs_12m", header: "COGS 12 mois" },
        { key: "turnover_ratio", header: "Rotation" },
        { key: "days_on_hand", header: "Jours couverture" },
      ],
      "rotation-stock",
    );
  };
  const exportAging = () => {
    if (!canExport) { toast.error("Export non autorisé"); return; }
    exportToCSV(
      agingSorted as unknown as Record<string, unknown>[],
      [
        { key: "age_bucket", header: "Tranche" },
        { key: "stock_value", header: "Valeur" },
        { key: "qty_remaining", header: "Quantité" },
        { key: "items_count", header: "Articles" },
      ],
      "vieillissement-stock",
    );
  };

  const exportBtn = (onClick: () => void, label: string) => (
    <Button
      size="sm" variant="outline" className="h-7 text-[11px] gap-1"
      onClick={onClick} disabled={!canExport}
      aria-disabled={!canExport}
      aria-label={canExport ? label : actionTooltip(perms, "export")}
      title={canExport ? label : actionTooltip(perms, "export")}
    >
      {canExport ? <Download className="w-3 h-3" /> : <Lock className="w-3 h-3" />} {label}
    </Button>
  );

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Stock", href: "/inventory" }, { label: "Reporting" }]} />
      <GuidanceBanner
        title="Reporting Stock"
        description="Valorisation par catégorie (FIFO vs CMP), rotation 12 mois et vieillissement du stock — données live depuis la base."
      />

      <h1 className="text-lg font-semibold text-foreground">Rapports Stock</h1>

      {/* Valuation by category */}
      <Card className="border-border">
        <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm">Valorisation par catégorie — FIFO vs CMP</CardTitle>
          {exportBtn(exportValuation, "Export CSV")}
        </CardHeader>
        <CardContent className="p-0">
          {vLoading ? (
            <div className="p-6 text-center text-xs text-muted-foreground">Chargement…</div>
          ) : valuation.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">Aucune donnée de valorisation</div>
          ) : (
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border bg-muted/30">
                {["Catégorie", "Articles", "Qté totale", "Valeur FIFO (XOF)", "Valeur CMP (XOF)", "Écart"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {valuation.map((r) => (
                  <tr key={r.category} className="border-b border-border hover:bg-muted/20">
                    <td className="px-3 py-2 font-medium">{r.category}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.items_count}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(r.total_qty)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(r.fifo_value)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(r.avg_cost_value)}</td>
                    <td className={`px-3 py-2 text-right font-mono font-medium ${Number(r.variance) >= 0 ? "text-success" : "text-destructive"}`}>
                      {fmt(r.variance)}
                    </td>
                  </tr>
                ))}
                <tr className="bg-muted/30 font-medium">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right font-mono">{totals.items}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(totals.qty)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(totals.fifo)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(totals.avg)}</td>
                  <td className={`px-3 py-2 text-right font-mono ${totals.var_ >= 0 ? "text-success" : "text-destructive"}`}>{fmt(totals.var_)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Turnover */}
        <Card className="border-border">
          <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm">Rotation des stocks par catégorie (12 mois)</CardTitle>
            {exportBtn(exportTurnover, "Export")}
          </CardHeader>
          <CardContent className="p-4 pt-2">
            {tLoading ? (
              <div className="h-48 flex items-center justify-center text-xs text-muted-foreground">Chargement…</div>
            ) : turnover.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-xs text-muted-foreground">Aucun mouvement sur 12 mois</div>
            ) : (
              <>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={turnover} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis type="number" tick={{ fontSize: 10 }} />
                      <YAxis type="category" dataKey="category" tick={{ fontSize: 10 }} width={110} />
                      <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6, border: "1px solid hsl(var(--border))" }} />
                      <Bar dataKey="turnover_ratio" fill="hsl(220, 50%, 40%)" radius={[0, 4, 4, 0]} name="Ratio rotation" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-3 space-y-1.5">
                  {turnover.map((t) => (
                    <div key={t.category} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{t.category}</span>
                      <div className="flex gap-4">
                        <span className="font-mono">{Number(t.turnover_ratio).toFixed(2)}x</span>
                        <span className="text-muted-foreground tabular-nums">{t.days_on_hand ?? "—"} j de couverture</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Aging */}
        <Card className="border-border">
          <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm">Vieillissement du stock</CardTitle>
            {exportBtn(exportAging, "Export")}
          </CardHeader>
          <CardContent className="p-4 pt-2">
            {aLoading ? (
              <div className="py-8 text-center text-xs text-muted-foreground">Chargement…</div>
            ) : totalAging === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">Aucune couche FIFO active</div>
            ) : (
              <>
                <div className="space-y-3">
                  {agingSorted.map((a) => {
                    const pct = totalAging > 0 ? (Number(a.stock_value) / totalAging) * 100 : 0;
                    return (
                      <div key={a.age_bucket} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium">{a.age_bucket}</span>
                          <span className="font-mono">{fmt(a.stock_value)} XOF ({pct.toFixed(0)}%)</span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${a.age_bucket === "90+ jours" ? "bg-destructive" : "bg-primary"}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 p-3 rounded-lg bg-muted/30 border border-border">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground">Valeur totale (FIFO)</span>
                    <span className="font-mono font-semibold">{fmt(totalAging)} XOF</span>
                  </div>
                  <div className="flex items-center justify-between text-xs mt-1">
                    <span className="text-muted-foreground">Stock dormant (90+ jours)</span>
                    <Badge variant="destructive" className="text-[10px]">{fmt(slowMoving)} XOF</Badge>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ABC / Pareto */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border-border">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Analyse ABC (Pareto, 12 mois)</CardTitle></CardHeader>
          <CardContent className="p-0">
            {abcLoading ? (
              <div className="p-6 text-center text-xs text-muted-foreground">Chargement…</div>
            ) : abc.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">Pas assez de sorties sur 12 mois</div>
            ) : (
              <>
                <div className="grid grid-cols-3 border-b border-border">
                  {(["A","B","C"] as const).map((cls) => {
                    const rows = abc.filter((r) => r.abc_class === cls);
                    const value = rows.reduce((s, r) => s + Number(r.revenue_12m || 0), 0);
                    const total = abc.reduce((s, r) => s + Number(r.revenue_12m || 0), 0);
                    const pct = total > 0 ? (value / total) * 100 : 0;
                    return (
                      <div key={cls} className="p-3 border-r border-border last:border-r-0">
                        <div className="text-[10px] uppercase text-muted-foreground">Classe {cls}</div>
                        <div className="text-base font-semibold tabular-nums">{rows.length} <span className="text-[10px] font-normal text-muted-foreground">articles</span></div>
                        <div className="text-[11px] text-muted-foreground">{fmt(value)} XOF ({pct.toFixed(0)}%)</div>
                      </div>
                    );
                  })}
                </div>
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-border bg-muted/30">
                    {["Code", "Article", "Sortie 12m (XOF)", "% cumulé", "Classe"].map((h) =>
                      <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>)}
                  </tr></thead>
                  <tbody>{abc.slice(0, 15).map((r) => (
                    <tr key={r.item_id} className="border-b border-border hover:bg-muted/20">
                      <td className="px-3 py-2 font-mono text-primary">{r.code}</td>
                      <td className="px-3 py-2 font-medium truncate max-w-[200px]">{r.name}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmt(r.revenue_12m)}</td>
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground">{Number(r.cum_pct).toFixed(1)}%</td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className={`text-[10px] ${r.abc_class === "A" ? "bg-success/15 text-success" : r.abc_class === "B" ? "bg-amber-500/15 text-amber-700" : "bg-muted text-muted-foreground"}`}>
                          {r.abc_class}
                        </Badge>
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Stock lent / mort / dormant</CardTitle></CardHeader>
          <CardContent className="p-0">
            {slowLoading ? (
              <div className="p-6 text-center text-xs text-muted-foreground">Chargement…</div>
            ) : slow.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">Aucun article en stock</div>
            ) : (
              <>
                <div className="grid grid-cols-4 border-b border-border">
                  {(["Actif", "Lent", "Mort", "Dormant"] as const).map((c) => {
                    const rows = slow.filter((r) => r.movement_class === c);
                    const value = rows.reduce((s, r) => s + Number(r.stock_value || 0), 0);
                    return (
                      <div key={c} className="p-3 border-r border-border last:border-r-0">
                        <div className="text-[10px] uppercase text-muted-foreground">{c}</div>
                        <div className="text-base font-semibold tabular-nums">{rows.length}</div>
                        <div className="text-[11px] text-muted-foreground">{fmt(value)} XOF</div>
                      </div>
                    );
                  })}
                </div>
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-border bg-muted/30">
                    {["Code", "Article", "Qté", "Valeur", "Dernière sortie", "Classe"].map((h) =>
                      <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>)}
                  </tr></thead>
                  <tbody>{slow.filter((r) => r.movement_class !== "Actif").slice(0, 15).map((r) => (
                    <tr key={r.item_id} className="border-b border-border hover:bg-muted/20">
                      <td className="px-3 py-2 font-mono text-primary">{r.code}</td>
                      <td className="px-3 py-2 font-medium truncate max-w-[180px]">{r.name}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmt(r.quantity_on_hand)}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmt(r.stock_value)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.last_outbound_date ?? "—"}</td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className={`text-[10px] ${r.movement_class === "Mort" ? "bg-destructive/15 text-destructive" : r.movement_class === "Dormant" ? "bg-muted text-muted-foreground" : "bg-amber-500/15 text-amber-700"}`}>
                          {r.movement_class}
                        </Badge>
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Audit — clôtures de période & verrouillages */}
      <Card className="border-border">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" />Audit — Clôtures & Verrouillages
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="grid grid-cols-1 lg:grid-cols-2">
            <div className="border-r border-border">
              <div className="px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border bg-muted/20">
                Déclencheurs de clôture
              </div>
              {auditLoading ? (
                <div className="p-4 text-xs text-muted-foreground">Chargement…</div>
              ) : closeAudit.length === 0 ? (
                <div className="p-4 text-xs text-muted-foreground">Aucune clôture exécutée</div>
              ) : (
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-border bg-muted/30">
                    {["Quand", "Action", "Période", "Par"].map((h) =>
                      <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>)}
                  </tr></thead>
                  <tbody>{closeAudit.map((a) => (
                    <tr key={a.id} className="border-b border-border hover:bg-muted/20">
                      <td className="px-3 py-2 text-muted-foreground">{new Date(a.created_at).toLocaleString("fr-FR")}</td>
                      <td className="px-3 py-2">
                        {(() => {
                          const meta = CLOSE_ACTION_LABEL[a.action] ?? { label: a.action, cls: "bg-muted text-muted-foreground" };
                          return <Badge variant="outline" className={`text-[10px] ${meta.cls}`}>{meta.label}</Badge>;
                        })()}
                      </td>

                      <td className="px-3 py-2 font-mono">{a.comment ?? "—"}</td>
                      <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">{a.performed_by?.slice(0, 8) ?? "—"}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </div>
            <div>
              <div className="px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border bg-muted/20">
                Verrouillages de période (module stock)
              </div>
              {locksLoading ? (
                <div className="p-4 text-xs text-muted-foreground">Chargement…</div>
              ) : periodLocks.length === 0 ? (
                <div className="p-4 text-xs text-muted-foreground">Aucun verrouillage actif</div>
              ) : (
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-border bg-muted/30">
                    {["Période", "Verrouillée le", "Par", "Statut"].map((h) =>
                      <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>)}
                  </tr></thead>
                  <tbody>{periodLocks.map((l) => (
                    <tr key={l.id} className="border-b border-border hover:bg-muted/20">
                      <td className="px-3 py-2 font-mono font-medium">{l.period}</td>
                      <td className="px-3 py-2 text-muted-foreground">{new Date(l.locked_at).toLocaleString("fr-FR")}</td>
                      <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">{l.locked_by?.slice(0, 8) ?? "—"}</td>
                      <td className="px-3 py-2"><Badge variant="outline" className="bg-amber-500/15 text-amber-700 text-[10px] gap-1"><Lock className="w-2.5 h-2.5" />Verrouillée</Badge></td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Historique des clôtures — exports + détail snapshot */}
      <Card className="border-border">
        <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-primary" />Historique des clôtures de stock
            {closesFetching && !closesLoading && (
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground font-normal" aria-live="polite">
                <Loader2 className="w-3 h-3 animate-spin" /> Actualisation…
              </span>
            )}
          </CardTitle>
          <div className="flex gap-2">
            {exporting !== null && (
              <Button
                size="sm" variant="destructive" className="h-7 text-[11px] gap-1"
                onClick={cancelExport}
                data-testid="cancel-export"
                aria-label={`Annuler l'export ${exporting.toUpperCase()} en cours`}
                title="Annuler l'export en cours"
              >
                <X className="w-3 h-3" /> Annuler
              </Button>
            )}
            <Button
              size="sm" variant="outline" className="h-7 text-[11px] gap-1"
              onClick={exportClosesCsv}
              disabled={!canExport || serverTotal === 0 || exporting !== null}
              aria-label={canExport ? `Exporter en CSV les ${serverTotal} résultats filtrés` : actionTooltip(perms, "export")}
              title={canExport ? `Exporter ${serverTotal} ligne(s) au format CSV` : actionTooltip(perms, "export")}
              data-testid="export-csv"
            >
              {exporting === "csv"
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : canExport ? <Download className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
              CSV
            </Button>
            <Button
              size="sm" variant="outline" className="h-7 text-[11px] gap-1"
              onClick={exportClosesPdf}
              disabled={!canExport || serverTotal === 0 || exporting !== null}
              aria-label={canExport ? `Exporter en PDF les ${serverTotal} résultats filtrés` : actionTooltip(perms, "export")}
              title={canExport ? `Exporter ${serverTotal} ligne(s) au format PDF` : actionTooltip(perms, "export")}
              data-testid="export-pdf"
            >
              {exporting === "pdf"
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : canExport ? <FileDown className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
              PDF
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {/* Filtres — persistés dans l'URL */}
          <div className="px-4 py-3 border-b border-border bg-muted/10 flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground" htmlFor="close-search">Recherche</label>
              <Input
                id="close-search"
                value={filters.search}
                onChange={(e) => setF("search", e.target.value)}
                placeholder="Période (serveur), utilisateur, erreur (page)…"
                className="h-7 text-xs w-64"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Statut (page)</label>
              <Select value={filters.status} onValueChange={(v) => setF("status", v as HistoryFilters["status"])}>
                <SelectTrigger className="h-7 text-xs w-36" aria-label="Filtrer par statut"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous</SelectItem>
                  <SelectItem value="ok">Terminée</SelectItem>
                  <SelectItem value="failed">Échec</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground" htmlFor="close-from">Du</label>
              <Input id="close-from" type="date" value={filters.from} onChange={(e) => setF("from", e.target.value)} className="h-7 text-xs w-36" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground" htmlFor="close-to">Au</label>
              <Input id="close-to" type="date" value={filters.to} onChange={(e) => setF("to", e.target.value)} className="h-7 text-xs w-36" />
            </div>
            <label className="flex items-center gap-2 text-xs h-7">
              <Checkbox
                checked={filters.invalidOnly}
                onCheckedChange={(v) => setF("invalidOnly", v === true)}
              />
              Période invalide / erreurs
            </label>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Par page</label>
              <Select value={String(filters.pageSize)} onValueChange={(v) => setF("pageSize", Number(v))}>
                <SelectTrigger className="h-7 text-xs w-20" aria-label="Lignes par page"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[10, 25, 50, 100].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button variant="ghost" size="sm" className="h-7 text-[11px] gap-1 ml-auto" onClick={resetFilters}>
              <X className="w-3 h-3" /> Réinitialiser
            </Button>
          </div>

          {closesLoading ? (
            <div className="p-6 text-center text-xs text-muted-foreground inline-flex items-center justify-center gap-2 w-full" aria-live="polite" aria-busy="true">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Chargement de l'historique…
            </div>
          ) : closesError ? (
            <div className="p-6 text-center text-xs space-y-2" role="alert">
              <div className="inline-flex items-center gap-1.5 text-destructive">
                <AlertTriangle className="w-3.5 h-3.5" />
                Échec du chargement — {(closesErrObj as Error)?.message ?? "erreur inconnue"}
              </div>
              <div>
                <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1" onClick={() => { void refetchCloses(); }}>
                  <RefreshCw className="w-3 h-3" /> Réessayer
                </Button>
              </div>
            </div>
          ) : serverTotal === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">Aucune clôture ne correspond aux filtres</div>
          ) : (
            <>
              <table className="w-full text-xs" data-testid="close-history-table">
                <thead><tr className="border-b border-border bg-muted/30">
                  {([
                    { k: "period", h: "Période", sort: true },
                    { k: "closed_at", h: "Clôturée le", sort: true },
                    { k: null, h: "Statut" },
                    { k: null, h: "Articles" },
                    { k: null, h: "Qté" },
                    { k: null, h: "Valeur (XOF)" },
                    { k: null, h: "Contexte / Erreur" },
                    { k: null, h: "Action" },
                  ] as Array<{ k: SortKey | null; h: string; sort?: boolean }>).map(({ k, h, sort }) => {
                    const active = sort && filters.sortKey === k;
                    return (
                      <th
                        key={h}
                        scope="col"
                        aria-sort={active ? (filters.sortDir === "asc" ? "ascending" : "descending") : (sort ? "none" : undefined)}
                        className={`px-3 py-2 text-left font-medium text-muted-foreground ${sort ? "cursor-pointer select-none" : ""}`}
                      >
                        {sort && k ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                            onClick={() => onToggleSort(k)}
                            aria-label={`Trier par ${h} ${active && filters.sortDir === "asc" ? "(descendant)" : "(ascendant)"}`}
                          >
                            {h}
                            {active && (filters.sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                          </button>
                        ) : (
                          <span className="inline-flex items-center gap-1">{h}</span>
                        )}
                      </th>
                    );
                  })}
                </tr></thead>
                <tbody>{pageRows.map((c) => {
                  const failed = c.status_label === "Échec";
                  const invalid = !isValidPeriod(c.period);
                  const showContext = failed || invalid || c.attempts > 0;
                  const openDetail = () => setDetail(c);
                  const onRowKey = (e: React.KeyboardEvent<HTMLTableRowElement>) => {
                    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
                      e.preventDefault();
                      openDetail();
                    }
                  };
                  return (
                    <tr
                      key={c.id}
                      role="button"
                      tabIndex={0}
                      data-testid={`close-row-${c.id}`}
                      aria-label={`Ouvrir le détail de la clôture de la période ${c.period}, statut ${c.status_label}`}
                      className="border-b border-border hover:bg-muted/20 cursor-pointer focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary focus-visible:bg-muted/20"
                      onClick={openDetail}
                      onKeyDown={onRowKey}
                      title="Voir le détail du snapshot"
                    >
                      <td className="px-3 py-2 font-mono font-medium">
                        {c.period}
                        {invalid && <Badge variant="outline" className="ml-2 text-[9px] bg-amber-500/15 text-amber-700">invalide</Badge>}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{c.closed_at_fmt}</td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className={`text-[10px] ${failed ? "bg-destructive/15 text-destructive" : "bg-success/15 text-success"}`}>
                          {c.status_label}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{c.items_count}</td>
                      <td className="px-3 py-2 text-right font-mono">{Math.round(Number(c.total_qty || 0)).toLocaleString("fr-FR")}</td>
                      <td className="px-3 py-2 text-right font-mono font-medium">{Math.round(Number(c.total_value || 0)).toLocaleString("fr-FR")}</td>
                      <td className="px-3 py-2 text-[10px] max-w-[260px]">
                        {showContext ? (
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1 text-muted-foreground">
                              {(failed || invalid) && <AlertTriangle className="w-3 h-3 text-destructive" />}
                              <span>Période {c.period}{c.attempts > 0 ? ` · ${c.attempts} tentative${c.attempts > 1 ? "s" : ""}` : ""}{invalid ? " · format invalide" : ""}</span>
                            </div>
                            {c.error_message && (
                              <div className="text-destructive whitespace-normal break-words" title={c.error_message}>
                                {c.error_message}
                              </div>
                            )}
                          </div>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                        <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1" onClick={openDetail} aria-label={`Voir le détail de ${c.period}`}>
                          <Eye className="w-3 h-3" /> Détail
                        </Button>
                      </td>
                    </tr>
                  );
                })}</tbody>
              </table>

              <div className="px-4 py-2 border-t border-border flex items-center justify-between text-[11px] text-muted-foreground">
                <div>
                  {serverTotal} résultat(s) — page {filters.page} / {totalPages}
                  {pageRows.length !== augmented.length && (
                    <span className="ml-1 opacity-70">· {pageRows.length}/{augmented.length} après filtres de page</span>
                  )}
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={filters.page <= 1} onClick={() => setF("page", filters.page - 1)}>Précédent</Button>
                  <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={filters.page >= totalPages} onClick={() => setF("page", filters.page + 1)}>Suivant</Button>
                </div>
              </div>
            </>
          )}

        </CardContent>

      </Card>

      {/* Historique des exports — CSV/PDF récents avec retry */}
      <Card className="border-border">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileDown className="w-4 h-4 text-primary" />Historique des exports
            <span className="text-[10px] font-normal text-muted-foreground">
              (CSV/PDF récents — succès, échecs, annulations)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {exportAuditLoading ? (
            <div className="p-6 text-center text-xs text-muted-foreground inline-flex items-center justify-center gap-2 w-full" aria-live="polite" aria-busy="true">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Chargement de l'historique des exports…
            </div>
          ) : exportAudit.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">Aucun export récent</div>
          ) : (
            <table className="w-full text-xs" data-testid="export-history-table">
              <thead><tr className="border-b border-border bg-muted/30">
                {["Quand", "Utilisateur", "Type", "Lignes", "Statut", "Action"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {exportAudit.map((r) => {
                  const cls =
                    r.status_label === "Échec"  ? "bg-destructive/15 text-destructive" :
                    r.status_label === "Annulé" ? "bg-amber-500/15 text-amber-700"     :
                                                  "bg-success/15 text-success";
                  return (
                    <tr key={r.id} className="border-b border-border hover:bg-muted/20" data-testid={`export-audit-${r.id}`}>
                      <td className="px-3 py-2 text-muted-foreground">{new Date(r.created_at).toLocaleString("fr-FR")}</td>
                      <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">{r.performed_by?.slice(0, 8) ?? "—"}</td>
                      <td className="px-3 py-2 uppercase font-mono text-[10px]">{r.kind ?? "—"}</td>
                      <td className="px-3 py-2 text-right font-mono">{r.rows.toLocaleString("fr-FR")}</td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className={`text-[10px] ${cls}`}>{r.status_label}</Badge>
                        {r.error && (
                          <div className="text-[10px] text-destructive mt-0.5 truncate max-w-[260px]" title={r.error}>
                            {r.error}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Button
                          size="sm" variant="ghost" className="h-6 text-[10px] gap-1"
                          onClick={() => retryExportFromAudit(r)}
                          disabled={!canExport || !r.kind || exporting !== null}
                          aria-label={`Retenter l'export ${r.kind?.toUpperCase() ?? ""} avec les mêmes filtres`}
                          title={canExport ? "Réappliquer les filtres URL et relancer l'export" : actionTooltip(perms, "export")}
                          data-testid={`retry-export-${r.id}`}
                        >
                          <RefreshCw className="w-3 h-3" /> Retenter
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>


      <InventoryCloseDetailDialog
        open={!!detail}
        onClose={() => setDetail(null)}
        row={detail}
        canExport={canExport}
      />
    </PageShell>

  );
}
