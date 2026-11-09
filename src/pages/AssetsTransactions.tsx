import { useMemo } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, CheckCircle, Clock, BookOpen, Lock, Play } from "lucide-react";
import { useTableFeatures } from "@/hooks/use-table-features";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { SortableHead, PaginationBar } from "@/components/DataTableControls";
import { GLPostingKPIsLive, GLBatchHistoryLive } from "@/hooks/use-gl-batches";
import { useAssets } from "@/hooks/use-asset-data";
import {
  useAssetDisposals,
  useMyFixedAssetRoles,
  useRunMonthlyDepreciation,
} from "@/hooks/use-fixed-assets-data";
import { actionTooltip, canDo, maskAmount } from "@/lib/fixed-assets-roles";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { exportToCSV } from "@/lib/csv-export";


const fmt = (n: number) => Math.round(n).toLocaleString("fr-FR");

function useDepreciationEntries() {
  return useQuery({
    queryKey: ["depreciation-entries"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("depreciation_entries")
        .select("*, asset:assets(name, asset_code)")
        .order("period_date", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
}

export default function AssetsTransactions() {
  const perms = useMyFixedAssetRoles();
  const { data: assets = [], isLoading: la } = useAssets();
  const { data: depEntries = [], isLoading: ld } = useDepreciationEntries();
  const { data: disposals = [], isLoading: ldis } = useAssetDisposals();
  const runDep = useRunMonthlyDepreciation();
  const [period, setPeriod] = usePersistentState<string>("fa-tx:period", new Date().toISOString().slice(0, 7));
  const [dateFrom, setDateFrom] = usePersistentState<string>("fa-tx:dateFrom", "");
  const [dateTo, setDateTo] = usePersistentState<string>("fa-tx:dateTo", "");
  const [status, setStatus] = usePersistentState<string>("fa-tx:status", "all");
  const [typeFilter, setTypeFilter] = usePersistentState<string>("fa-tx:type", "all");

  const isLoading = la || ld || ldis;

  const rows = useMemo(() => {
    const acq = (assets as any[]).map((a) => ({
      id: a.id, ref: a.asset_code, date: a.acquisition_date, type: "Acquisition",
      asset: a.name, amount: Number(a.acquisition_cost), status: "Posted",
    }));
    const dep = (depEntries as any[]).map((d) => ({
      id: d.id, ref: d.id.slice(0, 8).toUpperCase(), date: d.period_date, type: "Depreciation",
      asset: d.asset?.name || "—", amount: Number(d.amount),
      status: d.journal_entry_id ? "Posted" : "Pending",
    }));
    const dis = (disposals as any[]).map((d) => ({
      id: d.id, ref: d.id.slice(0, 8).toUpperCase(), date: d.disposal_date, type: "Disposal",
      asset: d.asset_id, amount: Number(d.sale_price ?? 0),
      status: d.journal_entry_id ? "Posted" : "Pending",
    }));
    return [...acq, ...dep, ...dis]
      .filter((r) => (typeFilter === "all" ? true : r.type === typeFilter))
      .filter((r) => (status === "all" ? true : r.status === status))
      .filter((r) => (dateFrom ? r.date >= dateFrom : true))
      .filter((r) => (dateTo ? r.date <= dateTo : true))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [assets, depEntries, disposals, typeFilter, status, dateFrom, dateTo]);

  const table = useTableFeatures({
    data: rows, pageSize: 15,
    searchableKeys: ["ref", "asset", "type"],
    persistKey: "fa-tx:table",
  });

  const handleExport = () => {
    if (!canDo(perms, "export")) return;
    exportToCSV(
      rows.map((r) => ({
        Reference: r.ref, Date: r.date, Type: r.type, Actif: r.asset,
        Montant: r.amount, Statut: r.status,
      })),
      [
        { key: "Reference", header: "Référence" },
        { key: "Date", header: "Date" },
        { key: "Type", header: "Type" },
        { key: "Actif", header: "Actif" },
        { key: "Montant", header: "Montant (XOF)" },
        { key: "Statut", header: "Statut" },
      ],
      `assets-transactions-${new Date().toISOString().slice(0, 10)}`,
    );
  };

  const exportTooltip = actionTooltip(perms, "export", "Exporter CSV");
  const depTooltip = actionTooltip(perms, "run_depreciation", "Lancer la dotation du mois");

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Fixed Assets", href: "/assets" }, { label: "Transactions" }]} />
      <GuidanceBanner title="Transactions Immobilisations" description="Acquisitions, dotations et cessions live, avec filtres et contrôles RBAC SYSCOHADA." />

      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <h1 className="text-lg font-semibold text-foreground">Transactions</h1>
        <div className="flex gap-2 items-center">
          <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="h-8 w-[140px] text-xs" />
          <Button
            size="sm" className="gap-1.5"
            disabled={!canDo(perms, "run_depreciation") || runDep.isPending}
            onClick={() => runDep.mutate(`${period}-01`)}
            aria-label={depTooltip} title={depTooltip}
          >
            {canDo(perms, "run_depreciation") ? <Play className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
            Dotation mensuelle
          </Button>
          <Button
            size="sm" variant="outline" className="gap-1.5"
            disabled={!canDo(perms, "export") || rows.length === 0}
            onClick={handleExport}
            aria-label={exportTooltip} title={exportTooltip}
          >
            {canDo(perms, "export") ? <Download className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
            Export CSV
          </Button>
        </div>
      </div>

      <Card className="border-border mb-2"><CardContent className="p-3 flex gap-2 flex-wrap items-center">
        <span className="text-xs text-muted-foreground">Filtres :</span>
        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 w-[140px] text-xs" placeholder="Du" />
        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 w-[140px] text-xs" placeholder="Au" />
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-8 w-[160px] text-xs"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous types</SelectItem>
            <SelectItem value="Acquisition">Acquisition</SelectItem>
            <SelectItem value="Depreciation">Dotation</SelectItem>
            <SelectItem value="Disposal">Cession</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue placeholder="Statut" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous statuts</SelectItem>
            <SelectItem value="Posted">Comptabilisé</SelectItem>
            <SelectItem value="Pending">En attente</SelectItem>
          </SelectContent>
        </Select>
        {(dateFrom || dateTo || typeFilter !== "all" || status !== "all") && (
          <Button size="sm" variant="ghost" className="h-8 text-xs"
            onClick={() => { setDateFrom(""); setDateTo(""); setTypeFilter("all"); setStatus("all"); }}>
            Réinitialiser
          </Button>
        )}
      </CardContent></Card>

      <Card className="border-border"><CardContent className="p-0">
        {isLoading ? (
          <div className="p-4 space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <SortableHead label="Référence" sortKey="ref" sort={table.sort} onSort={table.toggleSort} />
                  <SortableHead label="Date" sortKey="date" sort={table.sort} onSort={table.toggleSort} />
                  <SortableHead label="Type" sortKey="type" sort={table.sort} onSort={table.toggleSort} />
                  <SortableHead label="Actif" sortKey="asset" sort={table.sort} onSort={table.toggleSort} />
                  <SortableHead label="Montant" sortKey="amount" sort={table.sort} onSort={table.toggleSort} className="text-right" />
                  <SortableHead label="Statut" sortKey="status" sort={table.sort} onSort={table.toggleSort} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {table.pagedData.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                    Aucune transaction pour les filtres sélectionnés.
                  </TableCell></TableRow>
                ) : table.pagedData.map((t: any) => (
                  <TableRow key={t.id + t.type} className="text-xs">
                    <TableCell className="font-mono text-primary">{t.ref}</TableCell>
                    <TableCell className="font-mono text-muted-foreground">{t.date}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{t.type}</Badge></TableCell>
                    <TableCell className="font-medium max-w-[200px] truncate">{t.asset}</TableCell>
                    <TableCell className="text-right font-mono">{maskAmount(perms, t.amount)}</TableCell>
                    <TableCell>
                      <Badge className={`text-[10px] ${t.status === "Posted" ? "bg-success/15 text-success border-success/20" : "bg-amber-500/15 text-amber-700 border-amber-500/20"}`} variant="outline">
                        {t.status === "Posted" ? <CheckCircle className="w-3 h-3 mr-1" /> : <Clock className="w-3 h-3 mr-1" />}{t.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <PaginationBar page={table.page} totalPages={table.totalPages} totalItems={table.totalItems} pageSize={table.pageSize} onPageChange={table.setPage} />
          </>
        )}
      </CardContent></Card>

      <div className="space-y-4 mt-6">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Comptabilisation GL — Immobilisations</h2>
        </div>
        <GLPostingKPIsLive module="Assets" />
        <GLBatchHistoryLive module="Assets" />
      </div>
    </PageShell>
  );
}
