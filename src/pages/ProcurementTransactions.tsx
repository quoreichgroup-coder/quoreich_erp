import { useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, Plus, ShoppingCart, Package, CheckCircle, Truck, FileSearch, BookOpen, Loader2 } from "lucide-react";
import { GLPostingKPIsLive, GLBatchHistoryLive } from "@/hooks/use-gl-batches";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import {
  useRequisitions,
  useCreateRequisition,
  useApproveRequisition,
  usePurchaseOrders,
  useCreatePurchaseOrder,
  useApprovePurchaseOrder,
  useGoodsReceipts,
  useCreateGoodsReceipt,
  useCompleteGoodsReceipt,
  useConvertPRToPO,
  useMyProcurementRoles,

} from "@/hooks/use-procurement-data";

import { useSuppliers } from "@/hooks/use-ap-data";
import { isReceivable, linesToReceive, validateReceipt } from "@/lib/goods-receipt";

const fmt = (n: number) => n.toLocaleString("fr-FR");

const approvalWorkflow = [
  { level: "L1", label: "Manager Direct", threshold: "< 10 000 000 XOF", sla: "24h" },
  { level: "L2", label: "Head of Department", threshold: "10M – 50M XOF", sla: "48h" },
  { level: "L3", label: "CFO / Finance Director", threshold: "50M – 200M XOF", sla: "72h" },
  { level: "L4", label: "CEO / Board", threshold: "> 200M XOF", sla: "5 jours" },
];

const statusBadge = (s: string) => {
  switch (s) {
    case "approved": case "converted": case "completed": return "bg-success/15 text-success border-success/20";
    case "draft": case "pending": return "bg-muted text-muted-foreground";
    default: return "bg-amber-500/15 text-amber-700 border-amber-500/20";
  }
};

// ── Create Requisition Dialog ──────────────────────────────────────────

function CreateRequisitionDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { user } = useAuth();
  const createPR = useCreateRequisition();
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");

  const { data: profile } = useQuery({
    queryKey: ["my-profile"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("tenant_id").eq("id", user!.id).single();
      return data;
    },
    enabled: !!user,
  });

  const handleSubmit = () => {
    if (!desc || !amount || !profile?.tenant_id || !user) return;
    const num = `PR-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`;
    createPR.mutate({
      pr_number: num,
      description: desc,
      estimated_total: parseFloat(amount),
      tenant_id: profile.tenant_id,
      requested_by: user.id,
      lines: [{ description: desc, quantity: 1, estimated_unit_cost: parseFloat(amount) }],
    }, {
      onSuccess: () => { onOpenChange(false); setDesc(""); setAmount(""); },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle className="text-sm">New Purchase Requisition</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label className="text-xs">Description</Label><Input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Ex: Serveurs Dell x5" /></div>
          <div><Label className="text-xs">Estimated Total (XOF)</Label><Input type="number" value={amount} onChange={e => setAmount(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button size="sm" onClick={handleSubmit} disabled={createPR.isPending}>
            {createPR.isPending && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Create PO Dialog ──────────────────────────────────────────────────

function CreatePODialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { user } = useAuth();
  const createPO = useCreatePurchaseOrder();
  const { data: suppliers } = useSuppliers();
  const { data: requisitions } = useRequisitions();
  const [supplierId, setSupplierId] = useState("");
  const [prId, setPrId] = useState("");
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");

  const { data: profile } = useQuery({
    queryKey: ["my-profile"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("tenant_id").eq("id", user!.id).single();
      return data;
    },
    enabled: !!user,
  });

  const approvedPRs = (requisitions || []).filter((r: any) => r.status === "approved");

  const handleSubmit = () => {
    if (!supplierId || !amount || !profile?.tenant_id || !user) return;
    const num = `PO-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`;
    createPO.mutate({
      po_number: num,
      supplier_id: supplierId,
      total: parseFloat(amount),
      tenant_id: profile.tenant_id,
      created_by: user.id,
      requisition_id: prId || undefined,
      lines: [{ description: desc || "Item", quantity: 1, unit_cost: parseFloat(amount) }],
    }, {
      onSuccess: () => { onOpenChange(false); setSupplierId(""); setAmount(""); setDesc(""); setPrId(""); },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle className="text-sm">New Purchase Order</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label className="text-xs">Supplier</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
              <SelectContent>{(suppliers || []).map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {approvedPRs.length > 0 && (
            <div><Label className="text-xs">From Requisition (optional)</Label>
              <Select value={prId} onValueChange={setPrId}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>{approvedPRs.map((r: any) => <SelectItem key={r.id} value={r.id}>{r.pr_number} — {r.description}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div><Label className="text-xs">Description</Label><Input value={desc} onChange={e => setDesc(e.target.value)} /></div>
          <div><Label className="text-xs">Total (XOF)</Label><Input type="number" value={amount} onChange={e => setAmount(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button size="sm" onClick={handleSubmit} disabled={createPO.isPending}>
            {createPO.isPending && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}Create PO
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Component ──────────────────────────────────────────────────

// ── Create Goods Receipt Dialog ───────────────────────────────────────
// En-tête (commande, date) puis lignes (quantité reçue par ligne de commande, plafonnée au
// restant) ; la base crée la réception en attente, ajoute les lignes et la valide (V34).

function CreateReceiptDialog({ open, onOpenChange, pos, grs }: {
  open: boolean; onOpenChange: (v: boolean) => void; pos: any[]; grs: any[];
}) {
  const { user } = useAuth();
  const createGR = useCreateGoodsReceipt();
  const [supplierId, setSupplierId] = useState("");
  const [poId, setPoId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [qty, setQty] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  // Fournisseur d'abord (SAP MIGO, Sage X3 réception) : on ne réceptionne que ses commandes.
  const receivableAll = pos.filter((p) => isReceivable(p.status));
  const supplierOptions = Array.from(
    new Map(receivableAll.map((p) => [p.supplier_id, p.supplier?.name ?? "—"])).entries(),
  ).sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  const receivable = receivableAll.filter((p) => p.supplier_id === supplierId);
  const po = receivable.find((p) => p.id === poId);
  const lines = po ? linesToReceive(po.id, po.lines ?? [], grs) : [];

  const reset = () => { setSupplierId(""); setPoId(""); setQty({}); setError(null); };
  const chooseSupplier = (id: string) => { setSupplierId(id); setPoId(""); setQty({}); setError(null); };
  const choosePo = (id: string) => {
    setPoId(id);
    const p = receivable.find((x) => x.id === id);
    const l = p ? linesToReceive(p.id, p.lines ?? [], grs) : [];
    setQty(Object.fromEntries(l.map((x) => [x.id, String(x.remaining)])));
    setError(null);
  };

  const submit = (complete: boolean) => {
    if (!po || !user) return;
    const entries = lines.map((l) => ({ po_line_id: l.id, item_id: l.item_id, quantity: Number(qty[l.id] ?? 0), remaining: l.remaining }));
    const problem = validateReceipt(entries);
    if (problem) { setError(problem); return; }
    createGR.mutate({
      gr_number: `GR-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`,
      po_id: po.id,
      tenant_id: po.tenant_id,
      received_by: user.id,
      receipt_date: date,
      complete,
      lines: entries.filter((e) => e.quantity > 0).map((e) => ({ po_line_id: e.po_line_id, item_id: e.item_id ?? undefined, quantity_received: e.quantity })),
    }, { onSuccess: () => { onOpenChange(false); reset(); } });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle className="text-sm">Nouvelle réception de marchandises</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs" htmlFor="gr-supplier">Fournisseur</Label>
              <select id="gr-supplier" className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm" value={supplierId}
                onChange={(e) => chooseSupplier(e.target.value)}>
                <option value="">— Sélectionner —</option>
                {supplierOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs" htmlFor="gr-po">Commande</Label>
              <select id="gr-po" className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm" value={poId}
                onChange={(e) => choosePo(e.target.value)} disabled={!supplierId}>
                <option value="">{supplierId ? "— Sélectionner —" : "Choisissez d'abord le fournisseur"}</option>
                {receivable.map((p) => <option key={p.id} value={p.id}>{p.po_number} · {p.order_date}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs" htmlFor="gr-date">Date de réception</Label>
              <Input id="gr-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          {receivableAll.length === 0 && <p className="text-xs text-muted-foreground">Aucune commande approuvée à réceptionner.</p>}
          {po && (
            <Table><TableHeader><TableRow className="bg-muted/30">
              <TableHead className="text-xs">Ligne</TableHead>
              <TableHead className="text-xs text-right">Commandé</TableHead>
              <TableHead className="text-xs text-right">Déjà reçu</TableHead>
              <TableHead className="text-xs text-right">Restant</TableHead>
              <TableHead className="text-xs text-right">Reçu maintenant</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {lines.map((l, i) => (
                <TableRow key={l.id} className="text-xs">
                  <TableCell>{l.description}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(l.quantity)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(l.received)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(l.remaining)}</TableCell>
                  <TableCell className="text-right">
                    <Input aria-label={`Quantité reçue ligne ${i + 1}`} inputMode="decimal" className="h-8 w-24 ml-auto text-right text-xs"
                      value={qty[l.id] ?? ""} onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))} disabled={l.remaining === 0} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody></Table>
          )}
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={() => submit(false)} disabled={!po || createGR.isPending}>Enregistrer en attente</Button>
          <Button size="sm" onClick={() => submit(true)} disabled={!po || createGR.isPending}>
            {createGR.isPending && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}Enregistrer et valider
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ProcurementTransactions() {
  const { user } = useAuth();
  const { data: requisitions, isLoading: loadingPR } = useRequisitions();
  const { data: purchaseOrders, isLoading: loadingPO } = usePurchaseOrders();
  const { data: goodsReceipts, isLoading: loadingGR } = useGoodsReceipts();
  const approvePR = useApproveRequisition();
  const approvePO = useApprovePurchaseOrder();
  const completeGR = useCompleteGoodsReceipt();

  const [showCreatePR, setShowCreatePR] = useState(false);
  const [showCreatePO, setShowCreatePO] = useState(false);
  const [showCreateGR, setShowCreateGR] = useState(false);
  const [convertPR, setConvertPR] = useState<any | null>(null);
  const { data: suppliers } = useSuppliers();
  const convertMutation = useConvertPRToPO();
  const { data: perms } = useMyProcurementRoles();

  const [convertSupplier, setConvertSupplier] = useState<string>("");


  const prs = requisitions || [];
  const pos = purchaseOrders || [];
  const grs = goodsReceipts || [];

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Procurement", href: "/procurement" }, { label: "Transactions" }]} />
      <GuidanceBanner title="Procurement Transactions" description="Full procurement cycle: Requisition → PO → Goods Receipt → Invoice Matching. All data is live from the database." />

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-foreground">Procurement Transactions</h1>
        <div className="flex gap-2">
          <Button size="sm" className="gap-1.5" onClick={() => setShowCreatePR(true)}><Plus className="w-3.5 h-3.5" />New Requisition</Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowCreatePO(true)}><Package className="w-3.5 h-3.5" />New PO</Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowCreateGR(true)}><Truck className="w-3.5 h-3.5" />Nouvelle réception</Button>
          <Button size="sm" variant="outline" className="gap-1.5"><Download className="w-3.5 h-3.5" />Export</Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {[
          { label: "Requisitions", value: prs.length, sub: `${prs.filter((r: any) => r.status === "draft").length} draft` },
          { label: "Purchase Orders", value: pos.length, sub: `${fmt(pos.reduce((s: number, p: any) => s + p.total, 0))} XOF` },
          { label: "Goods Receipts", value: grs.length, sub: `${grs.filter((g: any) => g.status === "completed").length} completed` },
          { label: "Pending Approval", value: prs.filter((r: any) => r.status === "draft").length + pos.filter((p: any) => p.status === "draft").length, sub: "across PR & PO" },
        ].map(k => (
          <div key={k.label} className="bg-card rounded-lg border border-border p-3">
            <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">{k.label}</span>
            <div className="text-lg font-semibold text-foreground tabular-nums mt-0.5">{k.value}</div>
            <span className="text-[10px] text-muted-foreground">{k.sub}</span>
          </div>
        ))}
      </div>

      <Tabs defaultValue="requisitions">
        <TabsList className="mb-4">
          <TabsTrigger value="requisitions" className="gap-1.5"><ShoppingCart className="w-3.5 h-3.5" />Requisitions ({prs.length})</TabsTrigger>
          <TabsTrigger value="po" className="gap-1.5"><Package className="w-3.5 h-3.5" />Purchase Orders ({pos.length})</TabsTrigger>
          <TabsTrigger value="gr" className="gap-1.5"><Truck className="w-3.5 h-3.5" />Goods Receipt ({grs.length})</TabsTrigger>
          <TabsTrigger value="workflow" className="gap-1.5"><CheckCircle className="w-3.5 h-3.5" />Approval Workflow</TabsTrigger>
        </TabsList>

        {/* Requisitions Tab */}
        <TabsContent value="requisitions">
          <Card className="border-border"><CardContent className="p-0">
            {loadingPR ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
            ) : (
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
                  <TableRow key={pr.id} className="text-xs">
                    <TableCell className="font-mono text-primary">{pr.pr_number}</TableCell>
                    <TableCell className="font-medium max-w-[200px] truncate">{pr.description}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(pr.estimated_total)}</TableCell>
                    <TableCell><Badge className={`text-[10px] ${statusBadge(pr.status)}`} variant="outline">{pr.status}</Badge></TableCell>
                    <TableCell className="font-mono text-[10px]">{pr.po_id ? "→ PO" : "—"}</TableCell>
                    <TableCell>{pr.request_date}</TableCell>
                    <TableCell>
                      {pr.status === "draft" && (
                        <Button size="sm" variant="ghost" className="h-6 text-[10px] text-success"
                          onClick={() => approvePR.mutate({ id: pr.id, approved_by: user!.id })}
                          disabled={approvePR.isPending}>
                          Approve
                        </Button>
                      )}
                      {pr.status === "approved" && !pr.po_id && (
                        perms?.canConvert ? (
                          <Button size="sm" variant="ghost" className="h-6 text-[10px] text-primary"
                            onClick={() => setConvertPR(pr)}>
                            Convertir → PO
                          </Button>
                        ) : (
                          <span className="text-[10px] text-muted-foreground" title="Rôle Controller ou L2+ requis">
                            🔒 Convert
                          </span>
                        )
                      )}

                    </TableCell>

                  </TableRow>
                ))}
              </TableBody></Table>
            )}
          </CardContent></Card>
        </TabsContent>

        {/* Purchase Orders Tab */}
        <TabsContent value="po">
          <Card className="border-border"><CardContent className="p-0">
            {loadingPO ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
            ) : (
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
                          onClick={() => approvePO.mutate({ id: po.id, approved_by: user!.id })}
                          disabled={approvePO.isPending}>
                          Approve
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody></Table>
            )}
          </CardContent></Card>
        </TabsContent>

        {/* Goods Receipt Tab */}
        <TabsContent value="gr">
          <Card className="border-border"><CardContent className="p-0">
            {loadingGR ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
            ) : (
              <Table><TableHeader><TableRow className="bg-muted/30">
                <TableHead className="text-xs">GR #</TableHead>
                <TableHead className="text-xs">PO Ref</TableHead>
                <TableHead className="text-xs">Supplier</TableHead>
                <TableHead className="text-xs">Date</TableHead>
                <TableHead className="text-xs">Lines</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Actions</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {grs.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-xs text-muted-foreground py-8">No goods receipts yet</TableCell></TableRow>
                ) : grs.map((gr: any) => (
                  <TableRow key={gr.id} className="text-xs">
                    <TableCell className="font-mono text-primary">{gr.gr_number}</TableCell>
                    <TableCell className="font-mono">{(gr.po as any)?.po_number || "—"}</TableCell>
                    <TableCell className="font-medium">{(gr.po as any)?.supplier?.name || "—"}</TableCell>
                    <TableCell>{gr.receipt_date}</TableCell>
                    <TableCell className="text-[10px]">{gr.lines?.length || 0} items</TableCell>
                    <TableCell><Badge className={`text-[10px] ${statusBadge(gr.status)}`} variant="outline">{gr.status}</Badge></TableCell>
                    <TableCell>
                      {gr.status === "pending" && (
                        <Button size="sm" variant="ghost" className="h-6 text-[10px] text-success"
                          onClick={() => completeGR.mutate(gr.id)}
                          disabled={completeGR.isPending}>
                          Complete
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody></Table>
            )}
          </CardContent></Card>
        </TabsContent>

        {/* Approval Workflow Tab */}
        <TabsContent value="workflow">
          <Card className="border-border"><CardContent className="p-4 space-y-3">
            {approvalWorkflow.map((w) => (
              <div key={w.level} className="flex items-center gap-4 p-3 rounded-lg border border-border bg-muted/20">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">{w.level}</div>
                <div className="flex-1"><div className="text-sm font-medium">{w.label}</div><div className="text-xs text-muted-foreground">{w.threshold}</div></div>
                <div className="text-xs font-medium">SLA: {w.sla}</div>
              </div>
            ))}
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      {/* GL Posting Section */}
      <div className="space-y-4 mt-6">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">GL Posting — Procurement</h2>
        </div>
        <GLPostingKPIsLive module="Procurement" />
        <GLBatchHistoryLive module="Procurement" />
      </div>

      {/* Dialogs */}
      <CreateRequisitionDialog open={showCreatePR} onOpenChange={setShowCreatePR} />
      <CreatePODialog open={showCreatePO} onOpenChange={setShowCreatePO} />
      <CreateReceiptDialog open={showCreateGR} onOpenChange={setShowCreateGR} pos={pos} grs={grs} />

      <Dialog open={!!convertPR} onOpenChange={(o) => { if (!o) { setConvertPR(null); setConvertSupplier(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Convertir {convertPR?.pr_number} en PO</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">Montant estimé : <span className="font-mono text-foreground">{fmt(convertPR?.estimated_total ?? 0)} XOF</span></div>
            <div>
              <Label className="text-xs">Fournisseur</Label>
              <Select value={convertSupplier} onValueChange={setConvertSupplier}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Sélectionner..." /></SelectTrigger>
                <SelectContent>
                  {(suppliers ?? []).map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setConvertPR(null)}>Annuler</Button>
            <Button size="sm" disabled={!convertSupplier || convertMutation.isPending}
              onClick={async () => {
                await convertMutation.mutateAsync({ pr_id: convertPR.id, supplier_id: convertSupplier });
                setConvertPR(null); setConvertSupplier("");
              }}>
              {convertMutation.isPending && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}Convertir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>

  );
}
