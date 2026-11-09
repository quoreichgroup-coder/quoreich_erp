import { useMemo, useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Package, AlertTriangle, TrendingUp, ArrowDownLeft, ArrowUpRight, ClipboardCheck,
  ArrowLeftRight, ClipboardEdit,
} from "lucide-react";
import {
  ResponsiveContainer, Tooltip, PieChart, Pie, Cell,
} from "recharts";
import {
  useInventoryKpisView,
  useStockValuation,
  useLowStockAlerts,
  useStockMovements,
  useWarehouses,
  useInventoryCounts,
} from "@/hooks/use-inventory-data";

const fmt = (n: number) => Math.round(n).toLocaleString("fr-FR");
const COLORS = [
  "hsl(220, 50%, 40%)", "hsl(150, 50%, 40%)", "hsl(35, 80%, 50%)",
  "hsl(0, 60%, 50%)", "hsl(280, 50%, 50%)", "hsl(190, 55%, 40%)",
];

export default function Inventory() {
  const [warehouseId, setWarehouseId] = useState<string>("");

  const { data: kpis } = useInventoryKpisView();
  const { data: valuation = [] } = useStockValuation();
  const { data: lowStock = [] } = useLowStockAlerts();
  const { data: warehouses = [] } = useWarehouses();
  const { data: movements = [] } = useStockMovements(
    warehouseId ? { warehouseId } : undefined,
  );
  const { data: counts = [] } = useInventoryCounts();

  // Warehouse filtered valuation (view returns rows per warehouse)
  const filteredValuation = useMemo(
    () => (warehouseId
      ? valuation.filter((v) => {
          const wh = warehouses.find((w) => w.id === warehouseId);
          return wh ? v.warehouse_code === wh.code : true;
        })
      : valuation),
    [valuation, warehouseId, warehouses],
  );

  const totalValue = filteredValuation.reduce((s, r) => s + Number(r.stock_value || 0), 0);
  const activeItems = kpis?.active_items ?? 0;
  const lowStockCount = warehouseId
    ? lowStock.filter((l) => filteredValuation.some((v) => v.item_id === l.item_id)).length
    : (kpis?.low_stock_items ?? lowStock.length);
  const outOfStockCount = kpis?.out_of_stock_items ?? lowStock.filter((l) => Number(l.quantity_on_hand) === 0).length;

  // MTD inbound / outbound from real movements
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  type Mvt = { movement_date: string; movement_type: string; quantity: number };
  const mtd = (movements as Mvt[]).filter((m) => m.movement_date >= monthStart);
  const isTransfer = (t: string) => t === "transfer_in" || t === "transfer_out" || t === "transfer";
  const isAdjust = (t: string) => t.startsWith("adjust");
  const inbound = mtd.filter((m) => Number(m.quantity) > 0 && !isTransfer(m.movement_type) && !isAdjust(m.movement_type));
  const outbound = mtd.filter((m) => Number(m.quantity) < 0 && !isTransfer(m.movement_type) && !isAdjust(m.movement_type));
  const transfers = mtd.filter((m) => isTransfer(m.movement_type));
  const adjustments = mtd.filter((m) => isAdjust(m.movement_type));
  const inboundUnits = inbound.reduce((s, m) => s + Math.abs(Number(m.quantity)), 0);
  const outboundUnits = outbound.reduce((s, m) => s + Math.abs(Number(m.quantity)), 0);
  const transferUnits = transfers.reduce((s, m) => s + Math.abs(Number(m.quantity)), 0);
  const adjustNetUnits = adjustments.reduce((s, m) => s + Number(m.quantity), 0);

  const openCounts = (counts as Array<{ status: string }>).filter((c) => c.status !== "posted").length;

  const kpiCards = [
    { label: "Articles actifs", value: String(activeItems), icon: Package, color: "text-primary", change: `${kpis?.active_items ?? 0} référencés` },
    { label: "Valeur stock", value: fmt(totalValue), sub: "XOF", icon: TrendingUp, color: "text-success", change: warehouseId ? "filtré entrepôt" : "tous entrepôts" },
    { label: "Alertes stock bas", value: String(lowStockCount), icon: AlertTriangle, color: "text-destructive", change: `${outOfStockCount} en rupture` },
    { label: "Entrées (MTD)", value: String(inbound.length), icon: ArrowDownLeft, color: "text-primary", change: `${fmt(inboundUnits)} unités` },
    { label: "Sorties (MTD)", value: String(outbound.length), icon: ArrowUpRight, color: "text-success", change: `${fmt(outboundUnits)} unités` },
    { label: "Transferts (MTD)", value: String(transfers.length), icon: ArrowLeftRight, color: "text-sky-600", change: `${fmt(transferUnits)} unités` },
    { label: "Ajustements (MTD)", value: String(adjustments.length), icon: ClipboardEdit, color: "text-violet-600", change: `${adjustNetUnits >= 0 ? "+" : ""}${fmt(adjustNetUnits)} net` },
    { label: "Inventaires ouverts", value: String(openCounts), icon: ClipboardCheck, color: "text-amber-600", change: `${counts.length} au total` },
  ];

  // Stock value by warehouse (from valuation view)
  const byWarehouse = useMemo(() => {
    const map = new Map<string, number>();
    for (const v of filteredValuation) {
      const key = v.warehouse_code || v.warehouse_name || "—";
      map.set(key, (map.get(key) ?? 0) + Number(v.stock_value || 0));
    }
    return Array.from(map.entries()).map(([name, value], i) => ({ name, value, fill: COLORS[i % COLORS.length] }));
  }, [filteredValuation]);

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Stock" }]} />
      <GuidanceBanner
        title="Tableau de bord Stock"
        description="Indicateurs temps réel (valorisation CMP, alertes seuil, mouvements, inventaires) consolidés depuis la base."
      />

      <div className="flex items-end justify-between mb-4 gap-4">
        <h1 className="text-lg font-semibold text-foreground">Vue d'ensemble Stock</h1>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Entrepôt</Label>
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
          >
            <option value="">Tous les entrepôts</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-4">
        {kpiCards.map((k) => (
          <Card key={k.label} className="border-border">
            <CardContent className="p-3.5">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{k.label}</span>
                <k.icon className={`w-3.5 h-3.5 ${k.color}`} />
              </div>
              <p className="text-lg font-semibold text-foreground tabular-nums">
                {k.value}{" "}
                {k.sub && <span className="text-[10px] font-normal text-muted-foreground">{k.sub}</span>}
              </p>
              <p className="text-[11px] text-muted-foreground">{k.change}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border-border">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Valeur stock par entrepôt</CardTitle></CardHeader>
          <CardContent className="p-4 pt-2">
            {byWarehouse.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-xs text-muted-foreground">Aucune valorisation</div>
            ) : (
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={byWarehouse} dataKey="value" cx="50%" cy="50%" outerRadius={70}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                      {byWarehouse.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => `${fmt(v)} XOF`} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Articles sous seuil</CardTitle></CardHeader>
          <CardContent className="p-0">
            {lowStock.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-xs text-muted-foreground">Tous les articles sont au-dessus du seuil</div>
            ) : (
              <table className="w-full text-xs">
                <thead><tr className="border-b border-border bg-muted/30">
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Article</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Dispo</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Seuil</th>
                  <th className="px-3 py-2 text-center font-medium text-muted-foreground">État</th>
                </tr></thead>
                <tbody>{lowStock.slice(0, 10).map((i) => (
                  <tr key={i.item_id} className="border-b border-border hover:bg-muted/20">
                    <td className="px-3 py-2 font-medium">{i.code} — {i.name}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(Number(i.quantity_on_hand))}</td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">{fmt(Number(i.threshold))}</td>
                    <td className="px-3 py-2 text-center">
                      <Badge variant="outline" className={`text-[10px] ${Number(i.quantity_on_hand) === 0 ? "bg-destructive/15 text-destructive" : "bg-amber-500/15 text-amber-700"}`}>
                        {Number(i.quantity_on_hand) === 0 ? "Rupture" : "Bas"}
                      </Badge>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
