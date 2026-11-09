import { useState, useMemo } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Plus, Download, RefreshCw, Search, X, Building2,
  TrendingDown, Calculator, BookOpen, AlertTriangle, CheckCircle2,
  Calendar, DollarSign, Percent, FileText, ArrowRight,
  Wrench, ShieldCheck, Clock, FileWarning, Briefcase
} from "lucide-react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, PieChart, Pie, Cell
} from "recharts";
import { useAssets, useAssetCategories, useAssetKpis } from "@/hooks/use-asset-data";
import { useRunMonthlyDepreciation, useMyFixedAssetRoles } from "@/hooks/use-fixed-assets-data";
import { canDo, actionTooltip } from "@/lib/fixed-assets-roles";

/* ─── Types for computed data ─── */
interface DepreciationSchedule {
  period: string;
  openingNBV: number;
  depreciationCharge: number;
  accumulatedDep: number;
  closingNBV: number;
}

/* ─── Depreciation Engine ─── */
function computeLinearSchedule(cost: number, residual: number, lifeMonths: number): DepreciationSchedule[] {
  const lifeYears = Math.ceil(lifeMonths / 12);
  const annualDep = (cost - residual) / lifeYears;
  const schedule: DepreciationSchedule[] = [];
  let nbv = cost;
  let accDep = 0;
  for (let y = 1; y <= lifeYears; y++) {
    const charge = y === lifeYears ? nbv - residual : annualDep;
    accDep += charge;
    nbv -= charge;
    schedule.push({ period: `Year ${y}`, openingNBV: nbv + charge, depreciationCharge: Math.round(charge), accumulatedDep: Math.round(accDep), closingNBV: Math.round(nbv) });
  }
  return schedule;
}

function computeDecliningSchedule(cost: number, residual: number, lifeMonths: number, rate: number = 25): DepreciationSchedule[] {
  const lifeYears = Math.ceil(lifeMonths / 12);
  const schedule: DepreciationSchedule[] = [];
  let nbv = cost;
  let accDep = 0;
  const decRate = rate / 100;
  for (let y = 1; y <= lifeYears; y++) {
    let charge = nbv * decRate;
    if (nbv - charge < residual) charge = nbv - residual;
    if (charge < 0) charge = 0;
    accDep += charge;
    nbv -= charge;
    schedule.push({ period: `Year ${y}`, openingNBV: nbv + charge, depreciationCharge: Math.round(charge), accumulatedDep: Math.round(accDep), closingNBV: Math.round(nbv) });
    if (nbv <= residual) break;
  }
  return schedule;
}

/* ─── Helpers ─── */
function statusVariant(s: string) {
  switch (s) {
    case "active": return "default";
    case "fully_depreciated": return "secondary";
    case "disposed": return "destructive";
    case "under_maintenance": return "outline";
    default: return "default";
  }
}

const fmt = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const CHART_COLORS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))"];

function HeaderActions() {
  const perms = useMyFixedAssetRoles();
  const runDep = useRunMonthlyDepreciation();
  const canCreate = canDo(perms, "create_asset");
  const canRun = canDo(perms, "run_depreciation");
  const canExport = canDo(perms, "export");
  const createTip = actionTooltip(perms, "create_asset", "Créer une immobilisation");
  const runTip = actionTooltip(perms, "run_depreciation", "Comptabiliser la dotation du mois courant");
  const exportTip = actionTooltip(perms, "export", "Exporter le registre");
  return (
    <div className="flex items-center justify-between mb-4">
      <h1 className="text-lg font-semibold text-foreground">Immobilisations</h1>
      <div className="flex gap-2">
        <Button size="sm" className="gap-1.5" disabled={!canCreate} aria-label={createTip} title={createTip}>
          <Plus className="w-3.5 h-3.5" />Nouvelle immobilisation
        </Button>
        <Button
          size="sm" variant="outline" className="gap-1.5"
          disabled={!canRun || runDep.isPending}
          aria-label={runTip} title={runTip}
          onClick={() => {
            if (!canRun) return;
            const d = new Date();
            const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
            runDep.mutate(period);
          }}
        >
          <RefreshCw className="w-3.5 h-3.5" />{runDep.isPending ? "En cours…" : "Lancer dotation"}
        </Button>
        <Button size="sm" variant="outline" className="gap-1.5" disabled={!canExport} aria-label={exportTip} title={exportTip}>
          <Download className="w-3.5 h-3.5" />Exporter
        </Button>
      </div>
    </div>
  );
}

/* ─── Component ─── */
export default function FixedAssets() {
  const { assets, totalCost, totalNBV, totalDepreciation, activeAssets, fullyDepreciated } = useAssetKpis();
  const { data: categories = [] } = useAssetCategories();
  const { isLoading } = useAssets();

  const [activeTab, setActiveTab] = useState("register");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [methodFilter, setMethodFilter] = useState("all");
  const [selectedAsset, setSelectedAsset] = useState<any>(null);
  const [detailTab, setDetailTab] = useState("summary");

  // Generate alerts from real data
  const alerts = useMemo(() => {
    const result: any[] = [];
    const now = new Date();
    assets.forEach((a: any) => {
      if (a.next_maintenance) {
        const maint = new Date(a.next_maintenance);
        const daysUntil = Math.ceil((maint.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (daysUntil <= 0) result.push({ assetCode: a.asset_code, type: "maintenance", message: `Maintenance overdue for ${a.name}`, severity: "critical", dueDate: a.next_maintenance });
        else if (daysUntil <= 14) result.push({ assetCode: a.asset_code, type: "maintenance", message: `Maintenance due in ${daysUntil} days for ${a.name}`, severity: "warning", dueDate: a.next_maintenance });
      }
      if (a.warranty_expiry) {
        const warr = new Date(a.warranty_expiry);
        const daysUntil = Math.ceil((warr.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (daysUntil <= 0) result.push({ assetCode: a.asset_code, type: "warranty", message: `Warranty expired for ${a.name}`, severity: "info", dueDate: a.warranty_expiry });
        else if (daysUntil <= 90) result.push({ assetCode: a.asset_code, type: "warranty", message: `Warranty expires in ${daysUntil} days`, severity: "warning", dueDate: a.warranty_expiry });
      }
      if (a.status === "active") {
        const elapsed = (now.getTime() - new Date(a.acquisition_date).getTime()) / (1000 * 60 * 60 * 24 * 30);
        const remaining = a.useful_life_months - elapsed;
        if (remaining <= 0) result.push({ assetCode: a.asset_code, type: "end_of_life", message: `${a.name} has exceeded useful life`, severity: "critical", dueDate: a.acquisition_date });
        else if (remaining <= 12) result.push({ assetCode: a.asset_code, type: "end_of_life", message: `${a.name} nearing end of life`, severity: "warning", dueDate: a.acquisition_date });
      }
    });
    return result.sort((a, b) => { const sev = { critical: 0, warning: 1, info: 2 } as any; return (sev[a.severity] || 2) - (sev[b.severity] || 2); });
  }, [assets]);

  const filtered = useMemo(() => {
    return assets.filter((a: any) => {
      const matchSearch = !search || a.name.toLowerCase().includes(search.toLowerCase()) || a.asset_code.toLowerCase().includes(search.toLowerCase());
      const matchCat = categoryFilter === "all" || a.category_id === categoryFilter;
      const matchStatus = statusFilter === "all" || a.status === statusFilter;
      const matchMethod = methodFilter === "all" || a.depreciation_method === methodFilter;
      return matchSearch && matchCat && matchStatus && matchMethod;
    });
  }, [assets, search, categoryFilter, statusFilter, methodFilter]);

  // Category breakdown for pie chart
  const categoryBreakdown = useMemo(() => {
    const map = new Map<string, { name: string; value: number }>();
    assets.forEach((a: any) => {
      const catName = a.category?.name || "Uncategorized";
      const existing = map.get(catName) || { name: catName, value: 0 };
      existing.value += Number(a.acquisition_cost);
      map.set(catName, existing);
    });
    return Array.from(map.values()).map((c, i) => ({ ...c, color: CHART_COLORS[i % CHART_COLORS.length] }));
  }, [assets]);

  // Depreciation schedule for selected asset
  const schedule = selectedAsset
    ? selectedAsset.depreciation_method === "declining_balance"
      ? computeDecliningSchedule(Number(selectedAsset.acquisition_cost), Number(selectedAsset.salvage_value), selectedAsset.useful_life_months)
      : computeLinearSchedule(Number(selectedAsset.acquisition_cost), Number(selectedAsset.salvage_value), selectedAsset.useful_life_months)
    : [];

  if (isLoading) {
    return (
      <PageShell>
        <Breadcrumb items={[{ label: "Finance" }, { label: "Fixed Assets" }]} />
        <div className="grid grid-cols-5 gap-3 mb-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
        <Skeleton className="h-96" />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Fixed Assets", href: "/assets" }, { label: activeTab === "register" ? "Asset Register" : activeTab === "depreciation" ? "Depreciation" : activeTab === "alerts" ? "Alerts" : activeTab === "analytics" ? "Analytics" : "GL Integration" }]} />
      <GuidanceBanner title="Fixed Assets Management" description="Manage fixed assets, depreciation (linear, declining), maintenance tracking, and automatic GL postings." />

      <HeaderActions />

      {/* KPI Cards */}
      <div className="grid grid-cols-5 gap-3 mb-4">
        <Card className="border-border"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Building2 className="w-3.5 h-3.5" />Total Acquisition</div>
          <div className="text-xl font-bold text-foreground">{fmt(totalCost)} <span className="text-xs font-normal text-muted-foreground">XOF</span></div>
          <div className="text-[11px] text-muted-foreground mt-1">{assets.length} assets</div>
        </CardContent></Card>
        <Card className="border-border"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><TrendingDown className="w-3.5 h-3.5" />Net Book Value</div>
          <div className="text-xl font-bold text-foreground">{fmt(totalNBV)} <span className="text-xs font-normal text-muted-foreground">XOF</span></div>
          <Progress value={totalCost > 0 ? (totalNBV / totalCost) * 100 : 0} className="mt-2 h-1.5" />
        </CardContent></Card>
        <Card className="border-border"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Calculator className="w-3.5 h-3.5" />Accumulated Dep.</div>
          <div className="text-xl font-bold text-foreground">{fmt(totalDepreciation)} <span className="text-xs font-normal text-muted-foreground">XOF</span></div>
        </CardContent></Card>
        <Card className="border-border"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><CheckCircle2 className="w-3.5 h-3.5" />Active</div>
          <div className="text-xl font-bold text-foreground">{activeAssets}</div>
        </CardContent></Card>
        <Card className="border-border"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><AlertTriangle className="w-3.5 h-3.5" />Alerts</div>
          <div className="text-xl font-bold text-destructive">{alerts.filter((a: any) => a.severity === "critical").length}</div>
          <div className="text-[11px] text-amber-600 mt-1">{alerts.filter((a: any) => a.severity === "warning").length} warnings</div>
        </CardContent></Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="register" className="gap-1.5"><FileText className="w-3.5 h-3.5" />Asset Register</TabsTrigger>
          <TabsTrigger value="depreciation" className="gap-1.5"><TrendingDown className="w-3.5 h-3.5" />Depreciation</TabsTrigger>
          <TabsTrigger value="alerts" className="gap-1.5"><AlertTriangle className="w-3.5 h-3.5" />Alerts ({alerts.length})</TabsTrigger>
          <TabsTrigger value="analytics" className="gap-1.5"><Calculator className="w-3.5 h-3.5" />Analytics</TabsTrigger>
        </TabsList>

        {/* ─── ASSET REGISTER ─── */}
        <TabsContent value="register">
          <div className="flex gap-4">
            <div className="w-56 shrink-0 space-y-3">
              <Card className="border-border">
                <CardHeader className="p-3 pb-2"><CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Filters</CardTitle></CardHeader>
                <CardContent className="p-3 pt-0 space-y-3">
                  <div>
                    <label className="text-[11px] text-muted-foreground mb-1 block">Category</label>
                    <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Categories</SelectItem>
                        {categories.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground mb-1 block">Status</label>
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Statuses</SelectItem>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="fully_depreciated">Fully Depreciated</SelectItem>
                        <SelectItem value="disposed">Disposed</SelectItem>
                        <SelectItem value="under_maintenance">Under Maintenance</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground mb-1 block">Method</label>
                    <Select value={methodFilter} onValueChange={setMethodFilter}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Methods</SelectItem>
                        <SelectItem value="straight_line">Straight Line</SelectItem>
                        <SelectItem value="declining_balance">Declining Balance</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => { setCategoryFilter("all"); setStatusFilter("all"); setMethodFilter("all"); setSearch(""); }}>
                    <X className="w-3 h-3 mr-1" />Clear
                  </Button>
                </CardContent>
              </Card>
            </div>

            <div className="flex-1 min-w-0">
              <div className="mb-3">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input placeholder="Search assets…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-8 text-xs" />
                </div>
              </div>
              <Card className="border-border">
                <div className="overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead className="text-[11px] font-semibold">Code</TableHead>
                        <TableHead className="text-[11px] font-semibold">Asset Name</TableHead>
                        <TableHead className="text-[11px] font-semibold">Category</TableHead>
                        <TableHead className="text-[11px] font-semibold">Method</TableHead>
                        <TableHead className="text-[11px] font-semibold text-right">Acq. Cost</TableHead>
                        <TableHead className="text-[11px] font-semibold text-right">NBV</TableHead>
                        <TableHead className="text-[11px] font-semibold">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.length === 0 ? (
                        <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">No assets found. Click "New Asset" to add one.</TableCell></TableRow>
                      ) : filtered.map((asset: any) => (
                        <TableRow key={asset.id} className="cursor-pointer hover:bg-muted/20 text-xs" onClick={() => { setSelectedAsset(asset); setDetailTab("summary"); }}>
                          <TableCell className="font-mono text-[11px] text-primary">{asset.asset_code}</TableCell>
                          <TableCell className="font-medium max-w-[180px] truncate">{asset.name}</TableCell>
                          <TableCell className="text-muted-foreground">{asset.category?.name || "—"}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[10px] capitalize">{asset.depreciation_method === "straight_line" ? "Linear" : "Declining"}</Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono">{fmt(Number(asset.acquisition_cost))}</TableCell>
                          <TableCell className="text-right font-mono font-medium">{fmt(Number(asset.net_book_value))}</TableCell>
                          <TableCell>
                            <Badge variant={statusVariant(asset.status)} className="text-[10px] capitalize">{asset.status.replace(/_/g, " ")}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex items-center justify-between px-4 py-2 border-t border-border text-[11px] text-muted-foreground">
                  <span>{filtered.length} of {assets.length} assets</span>
                </div>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* ─── DEPRECIATION TAB ─── */}
        <TabsContent value="depreciation">
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2 space-y-4">
              <Card className="border-border">
                <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Asset Distribution by Category</CardTitle></CardHeader>
                <CardContent className="p-4 pt-0">
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={categoryBreakdown}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                      <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                      <Tooltip formatter={(v: number) => fmt(v) + " XOF"} contentStyle={{ fontSize: 11, background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6 }} />
                      <Bar dataKey="value" name="Acquisition Cost" fill="hsl(var(--chart-1))" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card className="border-border">
                <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Asset Depreciation Comparison</CardTitle></CardHeader>
                <CardContent className="p-4 pt-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead className="text-[11px] font-semibold">Asset</TableHead>
                        <TableHead className="text-[11px] font-semibold">Method</TableHead>
                        <TableHead className="text-[11px] font-semibold text-right">Cost</TableHead>
                        <TableHead className="text-[11px] font-semibold text-right">NBV</TableHead>
                        <TableHead className="text-[11px] font-semibold">Progress</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {assets.filter((a: any) => a.status === "active").map((asset: any) => {
                        const depBase = Number(asset.acquisition_cost) - Number(asset.salvage_value);
                        const depPercent = depBase > 0 ? (Number(asset.accumulated_depreciation) / depBase) * 100 : 0;
                        return (
                          <TableRow key={asset.id} className="text-xs">
                            <TableCell className="font-medium">{asset.name}</TableCell>
                            <TableCell><Badge variant="outline" className="text-[10px] capitalize">{asset.depreciation_method === "straight_line" ? "Linear" : "Declining"}</Badge></TableCell>
                            <TableCell className="text-right font-mono">{fmt(Number(asset.acquisition_cost))}</TableCell>
                            <TableCell className="text-right font-mono">{fmt(Number(asset.net_book_value))}</TableCell>
                            <TableCell className="w-32">
                              <div className="flex items-center gap-2">
                                <Progress value={Math.min(depPercent, 100)} className="h-1.5 flex-1" />
                                <span className="text-[10px] text-muted-foreground w-8 text-right">{Math.round(depPercent)}%</span>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-4">
              <Card className="border-border">
                <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Asset Distribution</CardTitle></CardHeader>
                <CardContent className="p-4 pt-0">
                  {categoryBreakdown.length > 0 ? (
                    <>
                      <ResponsiveContainer width="100%" height={200}>
                        <PieChart>
                          <Pie data={categoryBreakdown} cx="50%" cy="50%" innerRadius={45} outerRadius={75} dataKey="value" paddingAngle={3}>
                            {categoryBreakdown.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                          </Pie>
                          <Tooltip formatter={(v: number) => fmt(v) + " XOF"} contentStyle={{ fontSize: 11, background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6 }} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="space-y-2 mt-2">
                        {categoryBreakdown.map((cat) => (
                          <div key={cat.name} className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2">
                              <div className="w-2.5 h-2.5 rounded-full" style={{ background: cat.color }} />
                              <span className="text-muted-foreground">{cat.name}</span>
                            </div>
                            <span className="font-mono font-medium">{fmt(cat.value)}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="text-center text-sm text-muted-foreground py-8">No data</div>
                  )}
                </CardContent>
              </Card>

              <Card className="border-border">
                <CardHeader className="p-4 pb-2"><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="w-3.5 h-3.5 text-destructive" />Depreciation Alerts</CardTitle></CardHeader>
                <CardContent className="p-4 pt-0 space-y-2">
                  {assets.filter((a: any) => a.status === "fully_depreciated").length === 0 ? (
                    <div className="text-xs text-muted-foreground">No fully depreciated assets</div>
                  ) : assets.filter((a: any) => a.status === "fully_depreciated").map((a: any) => (
                    <div key={a.id} className="flex items-start gap-2 p-2 bg-destructive/5 border border-destructive/20 rounded text-xs">
                      <AlertTriangle className="w-3 h-3 text-destructive mt-0.5 shrink-0" />
                      <div><span className="font-medium">{a.asset_code}</span> — Fully depreciated. Review for disposal.</div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* ─── ALERTS TAB ─── */}
        <TabsContent value="alerts">
          <div className="space-y-2">
            {alerts.length === 0 ? (
              <Card className="border-border"><CardContent className="p-8 text-center text-sm text-muted-foreground">No alerts at this time.</CardContent></Card>
            ) : alerts.map((alert: any, i: number) => {
              const Icon = alert.type === "maintenance" ? Wrench : alert.type === "warranty" ? ShieldCheck : alert.type === "end_of_life" ? FileWarning : AlertTriangle;
              const bg = alert.severity === "critical" ? "bg-destructive/5 border-destructive/20" : alert.severity === "warning" ? "bg-amber-500/5 border-amber-500/20" : "bg-muted/30 border-border";
              const iconColor = alert.severity === "critical" ? "text-destructive" : alert.severity === "warning" ? "text-amber-600" : "text-muted-foreground";
              return (
                <div key={i} className={`flex items-start gap-3 p-3 rounded-lg border ${bg} text-xs`}>
                  <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${iconColor}`} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <Badge variant="outline" className="text-[10px] capitalize">{alert.type.replace(/_/g, " ")}</Badge>
                      <span className="font-mono text-primary">{alert.assetCode}</span>
                    </div>
                    <div className="text-foreground">{alert.message}</div>
                    <div className="text-muted-foreground mt-1">Due: {alert.dueDate}</div>
                  </div>
                  <Badge variant={alert.severity === "critical" ? "destructive" : alert.severity === "warning" ? "secondary" : "outline"} className="text-[10px]">{alert.severity}</Badge>
                </div>
              );
            })}
          </div>
        </TabsContent>

        {/* ─── ANALYTICS TAB ─── */}
        <TabsContent value="analytics">
          <div className="grid grid-cols-2 gap-4">
            <Card className="border-border">
              <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">By Category</CardTitle></CardHeader>
              <CardContent className="p-4 pt-0">
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={categoryBreakdown} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" width={120} />
                    <Tooltip formatter={(v: number) => fmt(v) + " XOF"} contentStyle={{ fontSize: 11, background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6 }} />
                    <Bar dataKey="value" name="Acquisition Cost" fill="hsl(var(--chart-1))" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="border-border">
              <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Asset Summary</CardTitle></CardHeader>
              <CardContent className="p-4 pt-0">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead className="text-[11px] font-semibold">Category</TableHead>
                      <TableHead className="text-[11px] font-semibold text-right">Assets</TableHead>
                      <TableHead className="text-[11px] font-semibold text-right">Cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {categoryBreakdown.map(d => {
                      const count = assets.filter((a: any) => (a.category?.name || "Uncategorized") === d.name).length;
                      return (
                        <TableRow key={d.name} className="text-xs">
                          <TableCell className="font-medium">{d.name}</TableCell>
                          <TableCell className="text-right">{count}</TableCell>
                          <TableCell className="text-right font-mono">{fmt(d.value)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card className="border-border col-span-2">
              <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">GL Posting Rules</CardTitle></CardHeader>
              <CardContent className="p-4 pt-0 space-y-2 text-xs text-muted-foreground">
                <div className="flex items-start gap-2"><ArrowRight className="w-3 h-3 mt-0.5 text-primary shrink-0" />Acquisition: Debit Asset, Credit Bank/Vendor</div>
                <div className="flex items-start gap-2"><ArrowRight className="w-3 h-3 mt-0.5 text-primary shrink-0" />Depreciation: Debit Expense, Credit Acc. Dep.</div>
                <div className="flex items-start gap-2"><ArrowRight className="w-3 h-3 mt-0.5 text-primary shrink-0" />Disposal: Debit Acc. Dep. + Bank, Credit Asset ± Gain/Loss</div>
                <div className="flex items-start gap-2"><ArrowRight className="w-3 h-3 mt-0.5 text-primary shrink-0" />Revaluation: Debit Asset, Credit Revaluation Reserve</div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* ─── Detail Side Panel ─── */}
      <Sheet open={!!selectedAsset} onOpenChange={(o) => !o && setSelectedAsset(null)}>
        <SheetContent className="w-[520px] sm:max-w-[520px] overflow-y-auto">
          {selectedAsset && (
            <>
              <SheetHeader>
                <SheetTitle className="text-base flex items-center gap-2">
                  <Badge variant={statusVariant(selectedAsset.status)} className="text-[10px] capitalize">{selectedAsset.status.replace(/_/g, " ")}</Badge>
                  {selectedAsset.asset_code} — {selectedAsset.name}
                </SheetTitle>
              </SheetHeader>

              <Tabs value={detailTab} onValueChange={setDetailTab} className="mt-4">
                <TabsList className="w-full">
                  <TabsTrigger value="summary" className="flex-1 text-xs">Summary</TabsTrigger>
                  <TabsTrigger value="schedule" className="flex-1 text-xs">Depreciation</TabsTrigger>
                </TabsList>

                <TabsContent value="summary" className="mt-4 space-y-4">
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    {[
                      ["Category", selectedAsset.category?.name || "—"],
                      ["Location", selectedAsset.location || "—"],
                      ["Method", selectedAsset.depreciation_method],
                      ["Useful Life", `${selectedAsset.useful_life_months} months`],
                      ["Acquisition Date", selectedAsset.acquisition_date],
                      ["Warranty End", selectedAsset.warranty_expiry || "—"],
                      ["Next Maintenance", selectedAsset.next_maintenance || "—"],
                      ["Assigned To", selectedAsset.assigned_to || "—"],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <div className="text-muted-foreground">{label}</div>
                        <div className="font-medium text-foreground">{value}</div>
                      </div>
                    ))}
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div><div className="text-muted-foreground">Acquisition Cost</div><div className="font-mono font-bold text-foreground">{fmt(Number(selectedAsset.acquisition_cost))} XOF</div></div>
                      <div><div className="text-muted-foreground">Salvage Value</div><div className="font-mono font-medium text-foreground">{fmt(Number(selectedAsset.salvage_value))} XOF</div></div>
                      <div><div className="text-muted-foreground">Acc. Depreciation</div><div className="font-mono font-medium text-foreground">{fmt(Number(selectedAsset.accumulated_depreciation))} XOF</div></div>
                      <div><div className="text-muted-foreground">Net Book Value</div><div className="font-mono font-bold text-primary">{fmt(Number(selectedAsset.net_book_value))} XOF</div></div>
                    </div>
                    {(() => {
                      const depBase = Number(selectedAsset.acquisition_cost) - Number(selectedAsset.salvage_value);
                      const pct = depBase > 0 ? (Number(selectedAsset.accumulated_depreciation) / depBase) * 100 : 0;
                      return (
                        <>
                          <Progress value={pct} className="h-2" />
                          <div className="text-[11px] text-muted-foreground text-center">{Math.round(pct)}% depreciated · {selectedAsset.depreciation_method} · {selectedAsset.useful_life_months} months</div>
                        </>
                      );
                    })()}
                  </div>
                </TabsContent>

                <TabsContent value="schedule" className="mt-4">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead className="text-[11px] font-semibold">Period</TableHead>
                        <TableHead className="text-[11px] font-semibold text-right">Opening NBV</TableHead>
                        <TableHead className="text-[11px] font-semibold text-right">Charge</TableHead>
                        <TableHead className="text-[11px] font-semibold text-right">Acc. Dep.</TableHead>
                        <TableHead className="text-[11px] font-semibold text-right">Closing NBV</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {schedule.map((row) => (
                        <TableRow key={row.period} className="text-xs">
                          <TableCell>{row.period}</TableCell>
                          <TableCell className="text-right font-mono">{fmt(row.openingNBV)}</TableCell>
                          <TableCell className="text-right font-mono text-destructive">{fmt(row.depreciationCharge)}</TableCell>
                          <TableCell className="text-right font-mono">{fmt(row.accumulatedDep)}</TableCell>
                          <TableCell className="text-right font-mono font-medium">{fmt(row.closingNBV)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TabsContent>
              </Tabs>
            </>
          )}
        </SheetContent>
      </Sheet>
    </PageShell>
  );
}
