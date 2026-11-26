import { useSearchParams } from "react-router-dom";
import { ExportMenu } from "@/components/ExportMenu";
import { exportTable, type ExportFormat } from "@/lib/table-export";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMemo, useRef, useState } from "react";
import { PageShell } from "@/components/PageShell";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHeader, TableRow, type MobileTableColumn } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, BookOpen, Lock, Play } from "lucide-react";
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
import { useReverseLastDepreciation } from "@/hooks/use-asset-accounting";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { exportToCSV } from "@/lib/csv-export";
import { apiGet, isApiEnabled } from "@/api/client";


const fmt = (n: number) => Math.round(n).toLocaleString("fr-FR");

const assetTypeLabel: Record<string, string> = { Acquisition: "Acquisition", Depreciation: "Dotation", Disposal: "Cession" };
const assetColumns = [
  { label: "Référence", kind: "primary", sortable: true },
  { label: "Date", sortable: true },
  { label: "Type", sortable: true },
  { label: "Actif", wide: true, sortable: true },
  { label: "Montant", sortable: true },
  { label: "Statut", sortable: true },
] satisfies MobileTableColumn[];

function useDepreciationEntries() {
  return useQuery({
    queryKey: ["depreciation-entries"],
    queryFn: async () => {
      const { data, error } = isApiEnabled() ? { data: await apiGet<any[]>("/api/v1/assets/depreciation-entries"), error: null } : await supabase
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
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") === "posting" ? "posting" : "documents";
  const { data: assets = [], isLoading: la } = useAssets();
  const { data: depEntries = [], isLoading: ld } = useDepreciationEntries();
  const { data: disposals = [], isLoading: ldis } = useAssetDisposals();
  const runDep = useRunMonthlyDepreciation();
  const reverseDep = useReverseLastDepreciation();
  const reverseTrigger = useRef<HTMLButtonElement | null>(null);
  const [reverseOpen, setReverseOpen] = useState(false);
  const [reversalReason, setReversalReason] = useState("");
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

  const handleExport = (f: ExportFormat = "csv") => {
    if (!canDo(perms, "export")) return;
    exportTable(f, 
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
      <Breadcrumb items={[{ label: "Finance" }, { label: "Immobilisations", href: "/assets" }, { label: "Transactions" }]} />
      <GuidanceBanner title="Transactions Immobilisations" description="Acquisitions, dotations et cessions, avec suivi des écritures comptables." />

      {/* Une pièce par onglet, comme Approvisionnement (standard de présentation des modules). */}
      <Tabs value={tab} onValueChange={(v) => setSearchParams((sp) => { sp.set("tab", v); return sp; }, { replace: true })}>
        <TabsList className="h-auto flex-wrap justify-start mb-4">
          <TabsTrigger value="documents">Mouvements d'immobilisations</TabsTrigger>
          <TabsTrigger value="posting">Comptabilisation</TabsTrigger>
        </TabsList>
        <TabsContent value="documents">

      <PageHeader className="mb-4" title="Transactions d’immobilisations" actions={<>
          <Input type="month" aria-label="Mois des amortissements" value={period} onChange={(e) => setPeriod(e.target.value)} className="h-11 w-40 text-sm sm:h-8 sm:text-xs" />
          {canDo(perms, "run_depreciation") && (
            <Button ref={reverseTrigger} size="sm" variant="outline" className="gap-1.5" disabled={reverseDep.isPending}
              onClick={() => { setReversalReason(""); setReverseOpen(true); }}>
              Contre-passer le dernier calcul
            </Button>
          )}
          <Button
            size="sm" className="gap-1.5"
            disabled={!canDo(perms, "run_depreciation") || runDep.isPending}
            onClick={() => runDep.mutate(`${period}-01`)}
            title={depTooltip}
          >
            {canDo(perms, "run_depreciation") ? <Play className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
            Calculer les amortissements
          </Button>
          <ExportMenu
            size="sm" variant="outline" className="gap-1.5"
            disabled={!canDo(perms, "export") || rows.length === 0}
            onPick={(f) => void handleExport(f)}
            aria-label={exportTooltip} title={exportTooltip}
          >
            {canDo(perms, "export") ? <Download className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
            Export CSV
          </ExportMenu>
        </>} />

      <Card className="border-border mb-2"><CardContent className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-5">
        <span className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-5">Filtres :</span>
        <Input type="date" aria-label="Date de début" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-11 w-full min-w-0 text-sm sm:h-8 sm:text-xs" placeholder="Du" />
        <Input type="date" aria-label="Date de fin" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-11 w-full min-w-0 text-sm sm:h-8 sm:text-xs" placeholder="Au" />
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger aria-label="Type de mouvement" className="h-11 w-full min-w-0 text-sm sm:h-8 sm:text-xs"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous types</SelectItem>
            <SelectItem value="Acquisition">Acquisition</SelectItem>
            <SelectItem value="Depreciation">Dotation</SelectItem>
            <SelectItem value="Disposal">Cession</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger aria-label="Statut du mouvement" className="h-11 w-full min-w-0 text-sm sm:h-8 sm:text-xs"><SelectValue placeholder="Statut" /></SelectTrigger>
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
            <Table mobileColumns={assetColumns} aria-label="Mouvements d’immobilisations">
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
                    <TableCell className="font-mono text-primary md:whitespace-nowrap">{t.ref}</TableCell>
                    <TableCell className="font-mono text-muted-foreground md:whitespace-nowrap">{t.date}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{assetTypeLabel[t.type] ?? t.type}</Badge></TableCell>
                    <TableCell className="font-medium max-w-[200px] truncate" title={t.asset}>{t.asset}</TableCell>
                    <TableCell className="text-right font-mono">{maskAmount(perms, t.amount)}</TableCell>
                    <TableCell>
                      <StatusBadge status={t.status === "Posted" ? "success" : "warning"} label={t.status === "Posted" ? "Comptabilisé" : "En attente"} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <PaginationBar page={table.page} totalPages={table.totalPages} totalItems={table.totalItems} pageSize={table.pageSize} onPageChange={table.setPage} />
          </>
        )}
      </CardContent></Card>

        </TabsContent>
        <TabsContent value="posting">
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Comptabilisation GL — Immobilisations</h2>
        </div>
        <GLPostingKPIsLive module="Assets" />
        <GLBatchHistoryLive module="Assets" />
      </div>
        </TabsContent>
      </Tabs>
      <Dialog open={reverseOpen} onOpenChange={open => { if (!reverseDep.isPending) setReverseOpen(open); }}>
        <DialogContent returnFocusRef={reverseTrigger}>
          <DialogHeader>
            <DialogTitle>Contre-passer le dernier calcul</DialogTitle>
            <DialogDescription>Indiquez le motif de la contre-passation du dernier calcul d’amortissements.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="fa-reversal-reason">Motif (obligatoire)</Label>
            <Input id="fa-reversal-reason" value={reversalReason} onChange={event => setReversalReason(event.target.value)}
              disabled={reverseDep.isPending} className="h-11 text-base" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={reverseDep.isPending} onClick={() => setReverseOpen(false)}>Annuler</Button>
            <Button type="button" variant="destructive" disabled={!reversalReason.trim() || !canDo(perms, "run_depreciation") || reverseDep.isPending}
              onClick={() => reverseDep.mutate(reversalReason.trim(), { onSuccess: () => setReverseOpen(false) })}>
              {reverseDep.isPending ? "Contre-passation…" : "Contre-passer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
