import { useState } from "react";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { FileSpreadsheet, Search } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useWarehouses } from "@/hooks/use-inventory-data";
import { InventoryCampaignTimeline } from "@/components/InventoryCampaignTimeline";
import { CAMPAIGN_CATALOG_PARAMS, CAMPAIGN_SCOPE_LABEL, CAMPAIGN_STATUS_LABEL, campaignTabTarget, fetchCampaignCatalog,
  type CampaignCatalogCursor, type CampaignCatalogFilters,
  type CampaignStatus } from "@/lib/inventory-campaign";
import { catalogueWorkbookColumns, catalogueWorkbookRows, formatCatalogDate, readCampaignCatalogAll } from "@/lib/inventory-campaign-workbook";
import { exportToXLSX } from "@/lib/xlsx";

const emptyFilters: CampaignCatalogFilters = { warehouse: "", state: "", search: "" };
const selectClass = "block h-9 w-full rounded-md border border-input bg-background px-2 text-sm";
const responsiveCell = "block p-0 md:table-cell md:p-4";
const mobileLabel = "mr-1 text-xs text-muted-foreground md:hidden";

export function InventoryCampaignCatalog({ tenantId, canCount, canReview, canExport }: {
  tenantId: string; canCount: boolean; canReview: boolean; canExport: boolean;
}) {
  const warehouses = useWarehouses();
  const [params, setParams] = useSearchParams();
  const [draft, setDraft] = useState<Partial<CampaignCatalogFilters>>({});
  const status = params.get(CAMPAIGN_CATALOG_PARAMS.state) ?? "";
  const filters: CampaignCatalogFilters = {
    warehouse: params.get(CAMPAIGN_CATALOG_PARAMS.warehouse) ?? "",
    state: Object.prototype.hasOwnProperty.call(CAMPAIGN_STATUS_LABEL, status) ? status as CampaignStatus : "",
    search: params.get(CAMPAIGN_CATALOG_PARAMS.search) ?? "",
  };
  const form = { ...filters, ...draft };
  const catalog = useInfiniteQuery({
    queryKey: ["inventory-campaign-catalog", tenantId, filters],
    initialPageParam: null as CampaignCatalogCursor | null,
    queryFn: ({ pageParam }) => fetchCampaignCatalog(tenantId, filters, pageParam),
    getNextPageParam: (page) => page.next,
    retry: false,
  });
  const download = useMutation({
    mutationFn: async (selected: CampaignCatalogFilters) => {
      const campaigns = await readCampaignCatalogAll(selected, (scope, cursor, forExport) =>
        fetchCampaignCatalog(tenantId, scope, cursor, forExport));
      if (!campaigns.length) throw new Error("Aucune campagne à exporter pour ces filtres.");
      exportToXLSX(catalogueWorkbookRows(campaigns), catalogueWorkbookColumns, "catalogue-inventaires", "Campagnes");
      return campaigns.length;
    },
  });
  const rows = catalog.data?.pages.flatMap((page) => page.campaigns) ?? [];
  const apply = (selection: CampaignCatalogFilters) => {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      for (const field of ["warehouse", "state", "search"] as const) {
        const val = selection[field].trim();
        if (val) next.set(CAMPAIGN_CATALOG_PARAMS[field], val);
        else next.delete(CAMPAIGN_CATALOG_PARAMS[field]);
      }
      return next;
    }, { replace: true });
    setDraft({});
    download.reset();
  };

  return <Card>
    <CardHeader><CardTitle className="text-base">Catalogue des campagnes</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <form className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-4" onSubmit={(event) => {
        event.preventDefault();
        apply(form);
      }}>
        <div className="space-y-1">
          <Label htmlFor="catalog-reference">Référence de campagne</Label>
          <Input id="catalog-reference" placeholder="Référence ou identifiant" value={form.search}
            onChange={(event) => setDraft({ ...draft, search: event.target.value })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="catalog-depot">Dépôt</Label>
          <select id="catalog-depot" className={selectClass} value={form.warehouse}
            onChange={(event) => setDraft({ ...draft, warehouse: event.target.value })}>
            <option value="">Tous les dépôts</option>
            {(warehouses.data ?? []).map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="catalog-status">État</Label>
          <select id="catalog-status" className={selectClass} value={form.state}
            onChange={(event) => setDraft({ ...draft, state: event.target.value as CampaignStatus | "" })}>
            <option value="">Tous les états</option>
            {Object.entries(CAMPAIGN_STATUS_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={download.isPending}><Search className="mr-1 h-4 w-4" />Filtrer</Button>
          <Button type="button" variant="outline" size="sm" disabled={download.isPending}
            onClick={() => apply(emptyFilters)}>Réinitialiser</Button>
        </div>
      </form>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {rows.length} campagne{rows.length === 1 ? "" : "s"} affichée{rows.length === 1 ? "" : "s"}
          {catalog.hasNextPage ? " · d’autres résultats sont disponibles" : ""}.
        </p>
        <div className="flex flex-wrap gap-2">
          {canCount && <Button asChild variant="outline" size="sm">
            <Link to={campaignTabTarget(params, "inventory-cycle")}>Préparer un tournant ABC</Link>
          </Button>}
          {canExport && <Button variant="outline" size="sm" disabled={!rows.length || download.isPending || catalog.isPending}
            onClick={() => download.mutate(filters)}>
            <FileSpreadsheet className="mr-1 h-4 w-4" />{download.isPending ? "Préparation de l’export…" : "Exporter le catalogue (Excel)"}
          </Button>}
        </div>
      </div>
      {warehouses.isError && <p role="alert" className="text-sm">Le filtre dépôt n’a pas pu être chargé.</p>}
      {download.isError && <p role="alert" className="text-sm text-destructive">{download.error.message}</p>}
      {download.isSuccess && <p role="status" className="text-sm">{download.data} campagne(s) dans le fichier Excel.</p>}
      {catalog.isPending && <p role="status">Chargement du catalogue…</p>}
      {catalog.isError && <div role="alert" className="text-sm text-destructive">{catalog.error.message}{" "}
        <Button variant="outline" size="sm" onClick={() => void (catalog.isFetchNextPageError ? catalog.fetchNextPage() : catalog.refetch())}>Réessayer</Button>
      </div>}
      {catalog.isSuccess && !rows.length && <p className="text-sm text-muted-foreground">Aucune campagne ne correspond aux filtres.</p>}
      {!!rows.length && <Table role="table" aria-label="Campagnes d’inventaire" className="block md:table">
        <TableHeader className="sr-only md:not-sr-only"><TableRow role="row">
          {["Référence", "Dépôt", "État", "Comptage", "Recomptage", "Ouverture", "Dernière décision", "Actions"].map((label) =>
            <TableHead role="columnheader" key={label}>{label}</TableHead>)}</TableRow></TableHeader>
        <TableBody role="rowgroup" className="block md:table-row-group">{rows.map((row) =>
          <TableRow role="row" key={row.id} className="grid grid-cols-2 items-center gap-2 py-3 md:table-row md:py-0">
          <TableCell role="cell" className={`${responsiveCell} order-1 break-all font-mono font-medium`}>{row.reference ?? row.id}</TableCell>
          <TableCell role="cell" className={`${responsiveCell} order-3 col-span-2`}>{row.warehouse_code} — {row.warehouse_name}
            <span className="block text-xs text-muted-foreground">{CAMPAIGN_SCOPE_LABEL[row.item_scope]}</span></TableCell>
          <TableCell role="cell" className={`${responsiveCell} order-2 justify-self-end`}><Badge variant={row.state === "validated" ? "default" : "secondary"}>
            {CAMPAIGN_STATUS_LABEL[row.state]}</Badge></TableCell>
          <TableCell role="cell" className={`${responsiveCell} order-4`}><span className={mobileLabel}>Comptés</span>{row.counted_lines} / {row.total_lines}</TableCell>
          <TableCell role="cell" className={`${responsiveCell} order-5`}><span className={mobileLabel}>Recomptés</span>
            {row.recount_lines ? `${row.recounted_lines} / ${row.recount_lines}` : "—"}</TableCell>
          <TableCell role="cell" className={`${responsiveCell} order-6`}><span className={`${mobileLabel} block`}>Ouverture</span>{formatCatalogDate(row.opened_at)}</TableCell>
          <TableCell role="cell" className={`${responsiveCell} order-7`}><span className={`${mobileLabel} block`}>Dernière décision</span>{formatCatalogDate(row.updated_at)}</TableCell>
          <TableCell role="cell" className={`${responsiveCell} order-8 col-span-2`}><div className="flex flex-wrap gap-1.5">
            {canCount && (row.state === "counting" || row.state === "submitted") && <Button asChild size="sm" variant="outline">
              <Link to={campaignTabTarget(params, "campaigns", { warehouse: row.warehouse_id, campaign: row.id })}>
                {row.state === "counting" ? "Compter" : "Recompter"}
              </Link>
            </Button>}
            {canReview && (row.state === "submitted" || row.state === "validated") && <Button asChild size="sm" variant="outline">
              <Link to={campaignTabTarget(params, "campaign-control", { campaign: row.id })}>
                {row.state === "validated" ? "Voir les écarts" : "Contrôler"}
              </Link>
            </Button>}
            {canReview && <InventoryCampaignTimeline tenantId={tenantId} campaignId={row.id} reference={row.reference ?? row.id} />}
          </div></TableCell>
        </TableRow>)}</TableBody>
      </Table>}
      {catalog.hasNextPage && <Button size="sm" variant="outline" disabled={catalog.isFetching}
        onClick={() => void catalog.fetchNextPage()}>{catalog.isFetchingNextPage ? "Chargement…" : "Afficher plus de campagnes"}</Button>}
    </CardContent>
  </Card>;
}
