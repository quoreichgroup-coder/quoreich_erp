import { exportToCSV } from "@/lib/csv-export";
import { useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ShoppingCart, FileText, Users, Clock, Download, Plus, AlertTriangle, CheckCircle, XCircle, Package, Truck, BarChart3, Loader2 } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { cn } from "@/lib/utils";
import {
  useRequisitions,
  usePurchaseOrders,
  useGoodsReceipts,
  useApproveRequisition,
  useApprovePurchaseOrder,
} from "@/hooks/use-procurement-data";
import { useSuppliers } from "@/hooks/use-ap-data";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";

const fmt = (n: number) => n.toLocaleString("fr-FR");
const PIE_COLORS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))", "hsl(var(--muted-foreground))"];

const statusBadge = (s: string) => {
  switch (s) {
    case "approved": case "converted": case "completed": case "received": return "bg-success/15 text-success border-success/20";
    case "draft": case "pending": return "bg-muted text-muted-foreground";
    default: return "bg-amber-500/15 text-amber-700 border-amber-500/20";
  }
};

const approvalWorkflow = [
  { level: "L1", label: "Manager Direct", threshold: "< 10M XOF", sla: "24h" },
  { level: "L2", label: "Head of Department", threshold: "10M – 50M XOF", sla: "48h" },
  { level: "L3", label: "CFO / Finance Director", threshold: "50M – 200M XOF", sla: "72h" },
  { level: "L4", label: "CEO / Board", threshold: "> 200M XOF", sla: "5 jours" },
];

export default function Procurement() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: requisitions, isLoading: loadingPR } = useRequisitions();
  const { data: purchaseOrders, isLoading: loadingPO } = usePurchaseOrders();
  const { data: goodsReceipts, isLoading: loadingGR } = useGoodsReceipts();
  const { data: suppliers } = useSuppliers();
  const approvePR = useApproveRequisition();
  const approvePO = useApprovePurchaseOrder();

  const [selectedPR, setSelectedPR] = useState<any | null>(null);

  const prs = requisitions || [];
  const pos = purchaseOrders || [];
  const grs = goodsReceipts || [];
  const supps = suppliers || [];

  const totalPRValue = prs.reduce((s: number, p: any) => s + p.estimated_total, 0);
  const totalPOValue = pos.reduce((s: number, p: any) => s + p.total, 0);
  const draftPRs = prs.filter((r: any) => r.status === "draft").length;
  const draftPOs = pos.filter((p: any) => p.status === "draft").length;
  const completedGRs = grs.filter((g: any) => g.status === "completed").length;

  // Spend by supplier for charts
  const spendBySupplier = pos.reduce((acc: Record<string, number>, po: any) => {
    const name = (po.supplier as any)?.name || "Unknown";
    acc[name] = (acc[name] || 0) + po.total;
    return acc;
  }, {});
  const spendPieData = Object.entries(spendBySupplier).map(([name, amount]) => ({ name, amount }));

  const isLoading = loadingPR || loadingPO || loadingGR;

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Procurement", href: "/procurement" }]} />
      <GuidanceBanner title="Procurement" description="Purchase requisitions, PO tracking, multi-level approvals, supplier performance, and spend analytics — all from live data." />

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-foreground">Procurement</h1>
        <div className="flex gap-2">
          <Button size="sm" className="gap-1.5" onClick={() => navigate("/procurement/transactions")}><Plus className="w-3.5 h-3.5" />New Requisition</Button>
          <Button size="sm" variant="outline" className="gap-1.5" data-testid="btn-export-csv" onClick={() => exportToCSV(
            (purchaseOrders ?? []).map((p: any) => ({ numero: p.po_number, fournisseur: p.supplier?.name ?? "", date: p.order_date, total: p.total, statut: p.status })),
            [{ key: "numero", header: "N° commande" }, { key: "fournisseur", header: "Fournisseur" }, { key: "date", header: "Date" }, { key: "total", header: "Total" }, { key: "statut", header: "Statut" }], "commandes")}><Download className="w-3.5 h-3.5" />Export</Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        <Card className="border-border"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><ShoppingCart className="w-3.5 h-3.5" />Requisitions</div>
          <div className="text-xl font-bold text-foreground">{prs.length}</div>
          <div className="text-[11px] text-muted-foreground mt-1">{draftPRs} draft</div>
        </CardContent></Card>
        <Card className="border-border"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><FileText className="w-3.5 h-3.5" />PR Value</div>
          <div className="text-xl font-bold text-foreground">{fmt(totalPRValue)}</div>
          <div className="text-[11px] text-muted-foreground mt-1">XOF</div>
        </CardContent></Card>
        <Card className="border-border"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Package className="w-3.5 h-3.5" />Purchase Orders</div>
          <div className="text-xl font-bold text-foreground">{pos.length}</div>
          <div className="text-[11px] text-muted-foreground mt-1">{fmt(totalPOValue)} XOF</div>
        </CardContent></Card>
        <Card className="border-border"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Truck className="w-3.5 h-3.5" />Goods Receipts</div>
          <div className="text-xl font-bold text-foreground">{grs.length}</div>
          <div className="text-[11px] text-muted-foreground mt-1">{completedGRs} completed</div>
        </CardContent></Card>
        <Card className="border-border"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Users className="w-3.5 h-3.5" />Suppliers</div>
          <div className="text-xl font-bold text-foreground">{supps.length}</div>
          <div className="text-[11px] text-muted-foreground mt-1">active</div>
        </CardContent></Card>
        <Card className="border-border"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><AlertTriangle className="w-3.5 h-3.5" />Pending Approval</div>
          <div className={cn("text-xl font-bold", (draftPRs + draftPOs) > 0 ? "text-amber-600" : "text-foreground")}>{draftPRs + draftPOs}</div>
          <div className="text-[11px] text-muted-foreground mt-1">across PR & PO</div>
        </CardContent></Card>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <Tabs defaultValue="requisitions">
          <TabsList className="mb-4">
            <TabsTrigger value="requisitions" className="gap-1.5"><ShoppingCart className="w-3.5 h-3.5" />Requisitions ({prs.length})</TabsTrigger>
            <TabsTrigger value="po" className="gap-1.5"><Package className="w-3.5 h-3.5" />Purchase Orders ({pos.length})</TabsTrigger>
            <TabsTrigger value="workflow" className="gap-1.5"><CheckCircle className="w-3.5 h-3.5" />Approval Workflow</TabsTrigger>
            <TabsTrigger value="reporting" className="gap-1.5"><BarChart3 className="w-3.5 h-3.5" />Reporting</TabsTrigger>
          </TabsList>

          {/* Requisitions */}
          <TabsContent value="requisitions">
            <Card className="border-border"><CardContent className="p-0">
              <Table><TableHeader><TableRow className="bg-muted/30">
                <TableHead className="text-xs">PR #</TableHead>
                <TableHead className="text-xs">Description</TableHead>
                <TableHead className="text-xs text-right">Est. Total</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">PO Ref</TableHead>
                <TableHead className="text-xs">Date</TableHead>
                <TableHead className="text-xs">Actions</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {prs.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-xs text-muted-foreground py-8">No requisitions yet</TableCell></TableRow>
                ) : prs.map((pr: any) => (
                  <TableRow key={pr.id} className="text-xs cursor-pointer hover:bg-muted/20" onClick={() => setSelectedPR(pr)}>
                    <TableCell className="font-mono text-primary">{pr.pr_number}</TableCell>
                    <TableCell className="font-medium max-w-[200px] truncate">{pr.description}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(pr.estimated_total)}</TableCell>
                    <TableCell><Badge className={`text-[10px] ${statusBadge(pr.status)}`} variant="outline">{pr.status}</Badge></TableCell>
                    <TableCell className="font-mono text-[10px]">{pr.po_id ? "→ PO" : "—"}</TableCell>
                    <TableCell>{pr.request_date}</TableCell>
                    <TableCell>
                      {pr.status === "draft" && (
                        <Button size="sm" variant="ghost" className="h-6 text-[10px] text-success"
                          onClick={(e) => { e.stopPropagation(); approvePR.mutate({ id: pr.id, approved_by: user!.id }); }}>
                          Approve
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody></Table>
            </CardContent></Card>
          </TabsContent>

          {/* Purchase Orders */}
          <TabsContent value="po">
            <Card className="border-border"><CardContent className="p-0">
              <Table><TableHeader><TableRow className="bg-muted/30">
                <TableHead className="text-xs">PO #</TableHead>
                <TableHead className="text-xs">Supplier</TableHead>
                <TableHead className="text-xs text-right">Total</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Lines</TableHead>
                <TableHead className="text-xs">Date</TableHead>
                <TableHead className="text-xs">Actions</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {pos.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-xs text-muted-foreground py-8">No purchase orders yet</TableCell></TableRow>
                ) : pos.map((po: any) => (
                  <TableRow key={po.id} className="text-xs">
                    <TableCell className="font-mono text-primary">{po.po_number}</TableCell>
                    <TableCell className="font-medium">{(po.supplier as any)?.name || "—"}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(po.total)}</TableCell>
                    <TableCell><Badge className={`text-[10px] ${statusBadge(po.status)}`} variant="outline">{po.status}</Badge></TableCell>
                    <TableCell className="text-[10px]">{po.lines?.length || 0} items</TableCell>
                    <TableCell>{po.order_date}</TableCell>
                    <TableCell>
                      {po.status === "draft" && (
                        <Button size="sm" variant="ghost" className="h-6 text-[10px] text-success"
                          onClick={() => approvePO.mutate({ id: po.id, approved_by: user!.id })}>
                          Approve
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody></Table>
            </CardContent></Card>
          </TabsContent>

          {/* Approval Workflow */}
          <TabsContent value="workflow">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card className="border-border">
                <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Niveaux d'Approbation</CardTitle></CardHeader>
                <CardContent className="p-4 pt-0 space-y-3">
                  {approvalWorkflow.map((w, i) => (
                    <div key={w.level} className="flex items-center gap-4 p-3 rounded-lg border border-border bg-muted/20">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">{w.level}</div>
                      <div className="flex-1">
                        <div className="text-sm font-medium text-foreground">{w.label}</div>
                        <div className="text-xs text-muted-foreground">{w.threshold}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-medium text-foreground">SLA: {w.sla}</div>
                        {i < approvalWorkflow.length - 1 && <div className="text-[10px] text-muted-foreground">Escalade → {approvalWorkflow[i + 1].level}</div>}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="border-border">
                <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Demandes en Attente</CardTitle></CardHeader>
                <CardContent className="p-4 pt-0 space-y-2">
                  {prs.filter((r: any) => r.status === "draft").map((r: any) => (
                    <div key={r.id} className="flex items-center gap-3 p-3 rounded-lg border border-border">
                      <div className="flex-1">
                        <div className="text-xs font-medium">{r.description}</div>
                        <div className="text-[10px] text-muted-foreground">{r.pr_number}</div>
                      </div>
                      <div className="text-xs font-mono font-medium">{fmt(r.estimated_total)} XOF</div>
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] gap-1"
                          onClick={() => approvePR.mutate({ id: r.id, approved_by: user!.id })}>
                          <CheckCircle className="w-3 h-3 text-success" />Approuver
                        </Button>
                      </div>
                    </div>
                  ))}
                  {prs.filter((r: any) => r.status === "draft").length === 0 && (
                    <div className="text-center text-muted-foreground text-xs py-6">Aucune demande en attente</div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Reporting */}
          <TabsContent value="reporting">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card className="border-border">
                <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Dépenses par Fournisseur</CardTitle></CardHeader>
                <CardContent className="p-4 pt-0">
                  {spendPieData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <PieChart>
                        <Pie data={spendPieData} dataKey="amount" nameKey="name" cx="50%" cy="50%" outerRadius={100}
                          label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                          labelLine={{ stroke: "hsl(var(--muted-foreground))" }}>
                          {spendPieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v: number) => `${fmt(v)} XOF`} contentStyle={{ fontSize: 11, background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="text-center text-muted-foreground text-xs py-16">Pas encore de données</div>
                  )}
                </CardContent>
              </Card>

              <Card className="border-border">
                <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Top Fournisseurs par Valeur PO</CardTitle></CardHeader>
                <CardContent className="p-4 pt-0">
                  {spendPieData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={spendPieData.sort((a, b) => b.amount - a.amount)} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                        <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" width={130} />
                        <Tooltip formatter={(v: number) => `${fmt(v)} XOF`} contentStyle={{ fontSize: 11, background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6 }} />
                        <Bar dataKey="amount" name="PO Value" fill="hsl(var(--chart-2))" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="text-center text-muted-foreground text-xs py-16">Pas encore de données</div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      )}

      {/* Side Panel */}
      <Sheet open={!!selectedPR} onOpenChange={() => setSelectedPR(null)}>
        <SheetContent className="w-[400px] sm:w-[480px]">
          {selectedPR && (
            <>
              <SheetHeader>
                <SheetTitle className="text-sm">{selectedPR.pr_number} — Détail</SheetTitle>
              </SheetHeader>
              <div className="mt-4 space-y-4">
                <div><div className="text-xs text-muted-foreground">Description</div><div className="text-sm font-medium">{selectedPR.description}</div></div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div><span className="text-muted-foreground">Status:</span> <Badge className={`text-[10px] ${statusBadge(selectedPR.status)}`} variant="outline">{selectedPR.status}</Badge></div>
                  <div><span className="text-muted-foreground">Total:</span> {fmt(selectedPR.estimated_total)} XOF</div>
                  <div><span className="text-muted-foreground">Date:</span> {selectedPR.request_date}</div>
                  <div><span className="text-muted-foreground">Lines:</span> {selectedPR.lines?.length || 0}</div>
                </div>
                {selectedPR.lines && selectedPR.lines.length > 0 && (
                  <div>
                    <div className="text-xs font-medium mb-2">Lines</div>
                    <div className="space-y-1.5">
                      {selectedPR.lines.map((l: any) => (
                        <div key={l.id} className="flex justify-between text-xs p-2 bg-muted/30 rounded">
                          <span>{l.description}</span>
                          <span className="font-mono">{l.quantity} × {fmt(l.estimated_unit_cost)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {selectedPR.status === "draft" && (
                  <Button size="sm" className="w-full gap-1.5"
                    onClick={() => { approvePR.mutate({ id: selectedPR.id, approved_by: user!.id }); setSelectedPR(null); }}>
                    <CheckCircle className="w-3.5 h-3.5" />Approuver cette demande
                  </Button>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </PageShell>
  );
}
