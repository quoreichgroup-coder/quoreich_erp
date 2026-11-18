import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useInventorySettings, useWarehouses } from "@/hooks/use-inventory-data";
import { CYCLE_BASIS_LABEL, CYCLE_CLASS_LABEL, inventoryCycleAnalysis, type CycleClass } from "@/lib/inventory-cycle-count";

const fmt = (amount: number) => amount.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

export function InventoryCycleAnalysisCard({ tenantId, canPlan }: { tenantId: string; canPlan: boolean }) {
  const { data: warehouses = [], isError: warehousesError } = useWarehouses();
  const { data: settings } = useInventorySettings();
  const [selected, setSelected] = useState<string>();
  const suggested = typeof settings?.default_warehouse_id === "string" ? settings.default_warehouse_id : undefined;
  const warehouse = selected ?? suggested ?? (warehouses.length === 1 ? warehouses[0].id : "");
  const analysis = useQuery({
    queryKey: ["inventory-cycle-analysis", tenantId, warehouse],
    enabled: Boolean(warehouse), retry: false, queryFn: () => inventoryCycleAnalysis(tenantId, warehouse),
  });
  const report = analysis.data?.configured ? analysis.data : undefined;

  return <Card className="border-border">
    <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Analyse ABC par dépôt</CardTitle></CardHeader>
    <CardContent className="space-y-3 p-4 pt-2">
      <div className="space-y-1">
        <Label htmlFor="inventory-abc-depot">Dépôt de l’analyse</Label>
        <select id="inventory-abc-depot" className="block h-9 w-full rounded-md border border-input bg-background px-2"
          value={warehouse} onChange={(event) => setSelected(event.target.value)}>
          <option value="">Choisir un dépôt</option>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
        </select>
      </div>
      {warehousesError && <p role="alert" className="text-sm text-destructive">Les dépôts n’ont pas pu être chargés.</p>}
      {analysis.isFetching && <p role="status" className="text-sm">Calcul du classement…</p>}
      {analysis.isError && <div role="alert" className="text-sm text-destructive">{analysis.error.message}{" "}
        <Button size="sm" variant="outline" onClick={() => void analysis.refetch()}>Réessayer</Button></div>}
      {analysis.isSuccess && !report && <p className="text-sm">
        Le classement utilise la règle du tournant. Configurez-la dans{" "}
        <Link className="text-primary underline" to="/inventory/settings?tab=inventaires">Paramètres → Inventaires</Link>.
      </p>}
      {report && <>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {CYCLE_BASIS_LABEL[report.basis]}{report.lookback_months !== null ? ` · ${report.lookback_months} mois` : ""}
            {" · "}{report.total_articles} article(s) analysé(s), {report.due_total} à échéance.
          </p>
          {canPlan && <Button asChild size="sm" variant="outline">
            <Link to={`/inventory/transactions?${new URLSearchParams({ tab: "inventory-cycle", depot: warehouse })}`}>
              Préparer le tournant
            </Link>
          </Button>}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(Object.keys(CYCLE_CLASS_LABEL) as CycleClass[]).map((key) => {
            const total = report.classes.find((row) => row.class === key);
            return <div key={key} className="space-y-1 rounded-md border p-2 text-sm">
              <p className="font-medium">{CYCLE_CLASS_LABEL[key]}</p>
              <p>{total?.articles ?? 0} article(s)</p>
              <p className="text-xs text-muted-foreground">{total?.due ?? 0} à compter</p>
              <p className="text-xs text-muted-foreground">
                {report.total_weight ? fmt((total?.weight ?? 0) * 100 / report.total_weight) : "0"} % de la valeur
              </p>
            </div>;
          })}
        </div>
        {!!report.top.length && <>
          <p className="text-xs text-muted-foreground">Articles de plus forte valeur selon la base choisie.</p>
          <Table>
            <TableHeader><TableRow>{["Article", "Valeur comptable", "% cumulé", "Classe"].map((label) =>
              <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader>
            <TableBody>{report.top.map((row) => <TableRow key={row.item_id}>
              <TableCell>{row.code} — {row.name}</TableCell><TableCell>{fmt(row.weight)}</TableCell>
              <TableCell>{row.cumulative_percent === null ? "—" : `${fmt(row.cumulative_percent)} %`}</TableCell>
              <TableCell><Badge variant="secondary">{CYCLE_CLASS_LABEL[row.class]}</Badge></TableCell>
            </TableRow>)}</TableBody>
          </Table>
        </>}
      </>}
    </CardContent>
  </Card>;
}
