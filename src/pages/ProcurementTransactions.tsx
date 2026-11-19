import { exportToCSV } from "@/lib/csv-export";
import { BulkBar, BulkButton, SelectAllHead, SelectCell, check, useBulkRun, useSelection, type Selection } from "@/components/BulkSelection";
import { ExportMenu } from "@/components/ExportMenu";
import { exportTable, type ExportFormat } from "@/lib/table-export";
import { useEffect, useState } from "react";
import type React from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, Plus, ShoppingCart, Package, CheckCircle, Truck, FileSearch, BookOpen, Loader2, Undo2 } from "lucide-react";
import { GLPostingKPIsLive, GLBatchHistoryLive } from "@/hooks/use-gl-batches";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import {
  useRequisitions,
  useCreateRequisition,
  usePurchaseOrders,
  useCreatePurchaseOrder,
  useApprovalQueue,
  useUpdateProcurementDraft,
  useGoodsReceipts,
  useCreateGoodsReceipt,
  useCompleteGoodsReceipt,
  useConvertPRToPO,
  useMyProcurementRoles,

} from "@/hooks/use-procurement-data";

import { useSuppliers } from "@/hooks/use-ap-data";
import { isReceivable, linesToReceive, validateReceipt } from "@/lib/goods-receipt";
import { DocumentLinesEditor } from "@/components/DocumentLinesEditor";
import { AnalyticSelectors } from "@/components/AnalyticSelectors";
import { useDocumentAnalytics, useLineAnalytics, type LineAnalytics } from "@/hooks/use-document-analytics";
import { LineAnalyticsEditor } from "@/components/LineAnalyticsEditor";
import { DocumentDetail, documentFileName } from "@/components/DocumentDetail";
import { ProcurementLifecycleActions } from "@/components/ProcurementLifecycleActions";
import { SupplierReturnDialog, SupplierReturnsList } from "@/components/SupplierReturns";
import { ReplenishmentProposalsPanel } from "@/components/Replenishment";
import { PurchaseFollowupPanel } from "@/components/PurchaseFollowup";
import { INCOTERMS } from "@/lib/supplier";
import { useSupplierReturns } from "@/hooks/use-supplier-returns";
import { useMyAccess } from "@/hooks/use-my-access";
import { documentFooter, emptyDocLine, toLines, validateDocLines, type DraftDocLine } from "@/lib/document-lines";
import { apiDelete, apiGet, apiPost, isApiEnabled } from "@/api/client";

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

// ── Pièces d'achat : en-tête, lignes, pied ─────────────────────────────
// Le pied (total) est calculé à partir des lignes, jamais saisi ; la base le recalcule de même.

function useMyTenantId() {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["my-profile", user?.id],
    queryFn: async () => {
      if (isApiEnabled()) return apiGet<{ tenant_id: string } | null>("/api/v1/me");
      const { data } = await supabase.from("profiles").select("tenant_id").eq("id", user!.id).single();
      return data;
    },
    enabled: !!user,
  });
  return data?.tenant_id as string | undefined;
}

const toDraftLines = (rows: any[] | undefined, price: string): DraftDocLine[] =>
  rows && rows.length
    ? rows.map((l) => ({ description: l.description ?? "", quantity: String(l.quantity), unitPrice: String(l[price] ?? "") }))
    : [emptyDocLine()];

type LineWithAnalytics = DraftDocLine & { analytics?: LineAnalytics };

/** Lignes enregistrables (libellé renseigné), chacune avec ses sections. */
function withAnalytics(lines: DraftDocLine[]) {
  const kept = (lines as LineWithAnalytics[]).filter((l) => l.description.trim() !== "");
  return toLines(kept).map((l, i) => ({ ...l, analytics: kept[i].analytics }));
}

/** En modification : sections de chaque ligne existante, reportées sur les lignes du formulaire (même ordre). */
function useEditLineAnalytics(kind: "PR" | "PO", rows: any[] | undefined, setLines: (f: (ls: DraftDocLine[]) => DraftDocLine[]) => void) {
  const ids = (rows ?? []).map((r) => r.id as string).filter(Boolean);
  const { data } = useLineAnalytics(kind, ids);
  useEffect(() => {
    if (!data || data.size === 0) return;
    setLines((ls) => ls.map((l, i) => (ids[i] && data.get(ids[i]) ? { ...l, analytics: data.get(ids[i]) } as DraftDocLine : l)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
}

function CreateRequisitionDialog({ open, onOpenChange, edit }: { open: boolean; onOpenChange: (v: boolean) => void; edit?: any }) {
  const { user } = useAuth();
  const tenantId = useMyTenantId();
  const createPR = useCreateRequisition();
  const updateDraft = useUpdateProcurementDraft();
  const [desc, setDesc] = useState(edit?.description ?? "");
  const [reqDate, setReqDate] = useState<string>(() => edit?.request_date ?? new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<DraftDocLine[]>(() => toDraftLines(edit?.lines, "estimated_unit_cost"));
  const [error, setError] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<Record<string, string>>({});
  const saved = useDocumentAnalytics("PR", edit?.id);
  useEffect(() => { if (saved.data) setAnalytics(saved.data); }, [saved.data]);
  useEditLineAnalytics("PR", edit?.lines, setLines);
  const reset = () => { setDesc(""); setReqDate(new Date().toISOString().slice(0, 10)); setLines([emptyDocLine()]); setError(null); setAnalytics({}); };

  const handleSubmit = () => {
    if (!desc.trim()) { setError("Objet de la demande requis."); return; }
    const problem = validateDocLines(lines);
    if (problem) { setError(problem); return; }
    if (!tenantId || !user) { setError("Profil en cours de chargement, réessayez."); return; }
    const rows = withAnalytics(lines);
    if (edit) {
      updateDraft.mutate(
        { docType: "PR", id: edit.id, header: { description: desc.trim(), request_date: reqDate, estimated_total: documentFooter(lines).total }, lines: rows, analytics },
        { onSuccess: () => onOpenChange(false) });
      return;
    }
    createPR.mutate({
      pr_number: `PR-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`,
      description: desc.trim(),
      request_date: reqDate,
      estimated_total: documentFooter(lines).total,
      tenant_id: tenantId,
      requested_by: user.id,
      lines: rows.map((l) => ({ description: l.description, quantity: l.quantity, estimated_unit_cost: l.unitPrice, analytics: l.analytics })),
      analytics,
    }, { onSuccess: () => { onOpenChange(false); reset(); } });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle className="text-sm">{edit ? "Modifier la demande " + edit.pr_number : "Nouvelle demande d'achat"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="sm:col-span-3"><Label className="text-xs" htmlFor="pr-desc">Objet de la demande</Label>
              <Input id="pr-desc" value={desc} onChange={e => setDesc(e.target.value)} placeholder="Ex : équipement informatique du service comptable" /></div>
            <div><Label className="text-xs" htmlFor="pr-date">Date de la demande</Label>
              <Input id="pr-date" type="date" value={reqDate} onChange={e => setReqDate(e.target.value)} /></div>
          </div>
          <DocumentLinesEditor lines={lines} onChange={setLines} priceLabel="Coût estimé" />
          <AnalyticSelectors date={reqDate} value={analytics} idPrefix="pr"
            onChange={(axis, value) => setAnalytics((a) => ({ ...a, [axis]: value }))} />
          <LineAnalyticsEditor lines={lines as LineWithAnalytics[]} onChange={(ls) => setLines(ls)} date={reqDate} idPrefix="pr" />
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button size="sm" onClick={handleSubmit} disabled={createPR.isPending}>
            {(createPR.isPending || updateDraft.isPending) && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}{edit ? "Enregistrer" : "Créer la demande"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreatePODialog({ open, onOpenChange, edit }: { open: boolean; onOpenChange: (v: boolean) => void; edit?: any }) {
  const { user } = useAuth();
  const tenantId = useMyTenantId();
  const createPO = useCreatePurchaseOrder();
  const updateDraft = useUpdateProcurementDraft();
  const { data: suppliers } = useSuppliers();
  const [supplierId, setSupplierId] = useState(edit?.supplier_id ?? "");
  const [orderDate, setOrderDate] = useState(() => edit?.order_date ?? new Date().toISOString().slice(0, 10));
  const [expectedDate, setExpectedDate] = useState<string>(edit?.expected_date ?? "");
  const [incoterm, setIncoterm] = useState<string>(edit?.incoterm ?? "");
  const [lines, setLines] = useState<DraftDocLine[]>(() => toDraftLines(edit?.lines, "unit_cost"));
  const supplier: any = (suppliers || []).find((s: any) => s.id === supplierId);
  const [error, setError] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<Record<string, string>>({});
  const saved = useDocumentAnalytics("PO", edit?.id);
  useEffect(() => { if (saved.data) setAnalytics(saved.data); }, [saved.data]);
  useEditLineAnalytics("PO", edit?.lines, setLines);
  const reset = () => { setSupplierId(""); setLines([emptyDocLine()]); setError(null); setAnalytics({}); };

  const handleSubmit = () => {
    if (!supplierId) { setError("Choisissez le fournisseur."); return; }
    const problem = validateDocLines(lines);
    if (problem) { setError(problem); return; }
    if (!tenantId || !user) { setError("Profil en cours de chargement, réessayez."); return; }
    if (edit) {
      updateDraft.mutate(
        { docType: "PO", id: edit.id, header: { supplier_id: supplierId, order_date: orderDate, expected_date: expectedDate || null, incoterm: incoterm || null }, lines: withAnalytics(lines), analytics },
        { onSuccess: () => onOpenChange(false) });
      return;
    }
    createPO.mutate({
      po_number: `PO-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`,
      supplier_id: supplierId,
      order_date: orderDate,
      expected_date: expectedDate || null,
      incoterm: incoterm || null,
      total: documentFooter(lines).total,
      tenant_id: tenantId,
      created_by: user.id,
      lines: withAnalytics(lines).map((l) => ({ description: l.description, quantity: l.quantity, unit_cost: l.unitPrice, analytics: l.analytics })),
      analytics,
    }, { onSuccess: () => { onOpenChange(false); reset(); } });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle className="text-sm">{edit ? "Modifier la commande " + edit.po_number : "Nouvelle commande fournisseur"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div><Label className="text-xs" htmlFor="po-supplier">Fournisseur</Label>
              <select id="po-supplier" className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">— Sélectionner —</option>
                {(suppliers || []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div><Label className="text-xs" htmlFor="po-date">Date de commande</Label>
              <Input id="po-date" type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} /></div>
            <div><Label className="text-xs" htmlFor="po-expected">Livraison prévue</Label>
              <Input id="po-expected" type="date" min={orderDate} value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
              {!expectedDate && <p className="text-[10px] text-muted-foreground mt-0.5">Vide : date de commande + {supplier?.lead_time_days ?? 0} j (délai du fournisseur)</p>}</div>
            <div><Label className="text-xs" htmlFor="po-incoterm">Incoterm</Label>
              <select id="po-incoterm" className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm" value={incoterm} onChange={(e) => setIncoterm(e.target.value)}>
                <option value="">{supplier?.default_incoterm ? `Celui du fournisseur (${supplier.default_incoterm})` : "—"}</option>
                {INCOTERMS.map((i) => <option key={i.code} value={i.code}>{i.code} — {i.label}</option>)}
              </select></div>
          </div>
          <DocumentLinesEditor lines={lines} onChange={setLines} />
          <AnalyticSelectors date={orderDate} value={analytics} idPrefix="po"
            onChange={(axis, value) => setAnalytics((a) => ({ ...a, [axis]: value }))} />
          <LineAnalyticsEditor lines={lines as LineWithAnalytics[]} onChange={(ls) => setLines(ls)} date={orderDate} idPrefix="po" />
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button size="sm" onClick={handleSubmit} disabled={createPO.isPending}>
            {(createPO.isPending || updateDraft.isPending) && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}{edit ? "Enregistrer" : "Créer la commande"}
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

function CreateReceiptDialog({ open, onOpenChange, pos, grs, returns = [], refreshing = false }: {
  returns?: { po_line_id: string; quantity: number; replacement_expected: boolean }[];
  open: boolean; onOpenChange: (v: boolean) => void; pos: any[]; grs: any[]; refreshing?: boolean;
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
  const lines = po ? linesToReceive(po.id, po.lines ?? [], grs, returns) : [];

  // Pied de la réception : quantité et valeur (au coût de la ligne de commande) reçues maintenant.
  const qtyOf = (id: string) => { const n = Number(String(qty[id] ?? "").replace(",", ".")); return Number.isFinite(n) && n > 0 ? n : 0; };
  const receivedNow = lines.reduce((s, l) => s + qtyOf(l.id), 0);
  const receivedValue = lines.reduce((s, l) => s + qtyOf(l.id) * Number(l.unit_cost || 0), 0);
  const reset = () => { setSupplierId(""); setPoId(""); setQty({}); setError(null); };
  const chooseSupplier = (id: string) => { setSupplierId(id); setPoId(""); setQty({}); setError(null); };
  const choosePo = (id: string) => {
    setPoId(id);
    const p = receivable.find((x) => x.id === id);
    const l = p ? linesToReceive(p.id, p.lines ?? [], grs, returns) : [];
    setQty(Object.fromEntries(l.map((x) => [x.id, String(x.remaining)])));
    setError(null);
  };
  // Réceptions rechargées pendant que la fenêtre est ouverte (réception précédente tout juste enregistrée) :
  // le restant à recevoir est recalculé, jamais proposé sur des données périmées.
  useEffect(() => {
    if (!poId) return;
    const p = receivable.find((x) => x.id === poId);
    const l = p ? linesToReceive(p.id, p.lines ?? [], grs, returns) : [];
    setQty(Object.fromEntries(l.map((x) => [x.id, String(x.remaining)])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grs]);

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
            </TableBody>
            <TableFooter>
              <TableRow className="text-xs font-medium">
                <TableCell colSpan={4}>Total reçu maintenant · valeur au coût de la commande</TableCell>
                <TableCell className="text-right tabular-nums" data-testid="gr-footer">
                  {fmt(receivedNow)} · {fmt(receivedValue)} XOF
                </TableCell>
              </TableRow>
            </TableFooter></Table>
          )}
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={() => submit(false)} disabled={!po || createGR.isPending || refreshing}>Enregistrer en attente</Button>
          <Button size="sm" onClick={() => submit(true)} disabled={!po || createGR.isPending || refreshing}>
            {createGR.isPending && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}Enregistrer et valider
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Lecture d'une pièce d'achat : en-tête, lignes, pied ───────────────

/* ──────── ACTIONS GROUPÉES (demandes, commandes) ──────── */
const STATUT_ACHAT: Record<string, string> = {
  draft: "Brouillon", pending_approval: "En approbation", approved: "Approuvée", rejected: "Rejetée", cancelled: "Annulée",
  converted: "Convertie", ordered: "Commandée", partially_received: "Reçue partiellement", received: "Reçue", closed: "Clôturée",
};
const statutAchat = (s: string) => STATUT_ACHAT[s] ?? s;

function ProcurementBulkBar({ docType, sel, approvals }: { docType: "PR" | "PO"; sel: Selection<any>; approvals: any[] }) {
  const bulk = useBulkRun();
  const db = supabase as any;
  const docs = sel.chosen;
  const pendingOf = (id: string) => approvals.filter((a) => a.doc_id === id && a.status === "pending").sort((a, b) => a.level_order - b.level_order)[0];
  const editables = docs.filter((d) => d.status === "draft" || d.status === "rejected").map((d) => d.id);
  const enApprobation = docs.filter((d) => d.status === "pending_approval" && pendingOf(d.id)).map((d) => d.id);
  const annulables = docs.filter((d) => !["cancelled", "converted", "received", "closed"].includes(d.status)).map((d) => d.id);
  const invalidate = ["purchase-requisitions", "purchase-orders", "procurement-approvals", "budget-status"];
  const nom = docType === "PR" ? "demande(s)" : "commande(s)";
  const go = (ids: string[], question: string, done: string, run: (id: string) => Promise<void>) => {
    if (ids.length && window.confirm(question)) bulk.mutate({ ids, run, done, invalidate }, { onSuccess: sel.clear });
  };
  const cols = docType === "PR"
    ? [{ key: "numero", header: "N° demande" }, { key: "objet", header: "Objet" }, { key: "total", header: "Total estimé" }, { key: "statut", header: "Statut" }, { key: "date", header: "Date" }]
    : [{ key: "numero", header: "N° commande" }, { key: "fournisseur", header: "Fournisseur" }, { key: "total", header: "Total" }, { key: "statut", header: "Statut" }, { key: "date", header: "Date" }];
  const rows = docs.map((d) => docType === "PR"
    ? { numero: d.pr_number, objet: d.description ?? "", total: Number(d.estimated_total ?? 0), statut: statutAchat(d.status), date: d.request_date }
    : { numero: d.po_number, fournisseur: d.supplier?.name ?? "", total: Number(d.total ?? 0), statut: statutAchat(d.status), date: d.order_date });
  return (
    <BulkBar count={docs.length} onClear={sel.clear} testId={`bulk-bar-${docType.toLowerCase()}`}>
      <ExportMenu size="sm" variant="outline" className="h-7 text-xs" onPick={(f) => exportTable(f, rows as any[], cols as any, docType === "PR" ? "demandes-achat-selection" : "commandes-selection", docType === "PR" ? "Demandes d'achat" : "Commandes d'achat")}>Exporter</ExportMenu>
      <BulkButton count={editables.length} label="Soumettre" disabled={bulk.isPending}
        onClick={() => go(editables, `Soumettre ${editables.length} ${nom} à l'approbation ?`, `${nom} soumise(s)`,
          async (id) => { if (isApiEnabled()) { await apiPost(`/api/v1/procurement/documents/${docType}/${id}/submit`, {}); return; } check(await db.rpc("procurement_submit", { _doc_type: docType, _doc_id: id })); })} />
      <BulkButton count={enApprobation.length} label="Approuver le niveau en cours" disabled={bulk.isPending}
        onClick={() => go(enApprobation, `Approuver le niveau en cours de ${enApprobation.length} ${nom} ? (refusé pour vos propres pièces et sans le droit du niveau)`, "étape(s) approuvée(s)",
          async (id) => { if (isApiEnabled()) { await apiPost(`/api/v1/procurement/approvals/${pendingOf(id).id}/approve`, { comment: "Approbation groupée" }); return; }
            check(await db.rpc("approve_procurement_step", { _approval_id: pendingOf(id).id, _comment: "Approbation groupée" })); })} />
      <BulkButton count={annulables.length} label="Annuler" disabled={bulk.isPending}
        onClick={() => {
          const r = window.prompt(`Motif de l'annulation de ${annulables.length} ${nom}`);
          if (r && r.trim()) bulk.mutate({ ids: annulables, done: `${nom} annulée(s)`, invalidate,
            run: async (id) => { if (isApiEnabled()) { await apiPost(`/api/v1/procurement/documents/${docType}/${id}/cancel`, { reason: r.trim() }); return; }
              check(await db.rpc("procurement_cancel", { _doc_type: docType, _doc_id: id, _reason: r.trim() })); } }, { onSuccess: sel.clear });
        }} />
      <BulkButton count={editables.length} label="Supprimer" danger disabled={bulk.isPending}
        onClick={() => go(editables, `Supprimer ${editables.length} ${nom} (brouillons ou rejetées) ?`, `${nom} supprimée(s)`, async (id) => {
          if (isApiEnabled()) { await apiDelete(`/api/v1/procurement/documents/${docType}/${id}`); return; }
          const { data, error } = await db.from(docType === "PR" ? "purchase_requisitions" : "purchase_orders").delete().eq("id", id).select("id");
          if (error) throw new Error(error.message);
          if (!data?.length) throw new Error("Pièce introuvable ou non supprimable.");
        })} />
    </BulkBar>
  );
}

const rowId = (r: any) => r.id as string;
type DocView = { kind: "pr" | "po" | "gr"; doc: any } | null;

function ProcurementDocDialog({ view, onClose, pos, grs, returns = [] }: {
  view: DocView; onClose: () => void; pos: any[]; grs: any[];
  returns?: { po_line_id: string; quantity: number; replacement_expected: boolean }[];
}) {
  if (!view) return null;
  const { kind, doc } = view;
  let title = "", header: [string, React.ReactNode][] = [], columns: { label: string; align?: "right" }[] = [],
    rows: React.ReactNode[][] = [], footer: [string, React.ReactNode, boolean?][] = [];
  if (kind === "pr") {
    const lines = doc.lines ?? [];
    title = `Demande d'achat ${doc.pr_number}`;
    header = [["Objet", doc.description], ["Statut", doc.status], ["Date", doc.request_date], ["Commande", doc.po_id ? "convertie" : "—"]];
    columns = [{ label: "Libellé" }, { label: "Qté", align: "right" }, { label: "Coût estimé", align: "right" }, { label: "Montant", align: "right" }];
    rows = lines.map((l: any) => [l.description, fmt(Number(l.quantity)), fmt(Number(l.estimated_unit_cost)), fmt(Number(l.total))]);
    footer = [["Lignes", String(lines.length)], ["Total estimé", `${fmt(lines.reduce((s: number, l: any) => s + Number(l.total), 0))} XOF`, true]];
  } else if (kind === "po") {
    const lines = linesToReceive(doc.id, doc.lines ?? [], grs, returns);
    title = `Commande ${doc.po_number}`;
    header = [["Fournisseur", doc.supplier?.name], ["Statut", doc.status], ["Date de commande", doc.order_date], ["Lignes", String(lines.length)]];
    columns = [{ label: "Libellé" }, { label: "Qté", align: "right" }, { label: "P.U.", align: "right" }, { label: "Montant", align: "right" }, { label: "Reçu", align: "right" }];
    rows = lines.map((l) => [l.description, fmt(Number(l.quantity)), fmt(Number(l.unit_cost)), fmt(Number(l.quantity) * Number(l.unit_cost)), fmt(l.received)]);
    const total = lines.reduce((s, l) => s + Number(l.quantity) * Number(l.unit_cost), 0);
    const recu = lines.reduce((s, l) => s + l.received * Number(l.unit_cost), 0);
    footer = [["Total commandé", `${fmt(total)} XOF`, true], ["Reçu (valeur)", `${fmt(recu)} XOF`], ["Reste à recevoir", `${fmt(total - recu)} XOF`]];
  } else {
    const po = pos.find((p) => p.id === doc.po_id);
    const poLines = new Map((po?.lines ?? []).map((l: any) => [l.id, l]));
    const lines = doc.lines ?? [];
    title = `Réception ${doc.gr_number}`;
    header = [["Commande", doc.po?.po_number], ["Fournisseur", doc.po?.supplier?.name], ["Date de réception", doc.receipt_date], ["Statut", doc.status]];
    columns = [{ label: "Libellé" }, { label: "Reçu", align: "right" }, { label: "Refusé", align: "right" }, { label: "Valeur", align: "right" }];
    rows = lines.map((l: any) => {
      const pl: any = poLines.get(l.po_line_id);
      return [pl?.description ?? "—", fmt(Number(l.quantity_received)), fmt(Number(l.quantity_rejected)), fmt(Number(l.quantity_received) * Number(pl?.unit_cost ?? 0))];
    });
    const qte = lines.reduce((s: number, l: any) => s + Number(l.quantity_received), 0);
    const valeur = lines.reduce((s: number, l: any) => s + Number(l.quantity_received) * Number((poLines.get(l.po_line_id) as any)?.unit_cost ?? 0), 0);
    footer = [["Quantité reçue", fmt(qte)], ["Valeur au coût de la commande", `${fmt(valeur)} XOF`, true]];
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle className="text-sm">{title}</DialogTitle></DialogHeader>
        <DocumentDetail header={header} columns={columns} rows={rows} footer={footer} title={title}
          fileName={documentFileName(title)} print={{ amountInWords: false,
            signatures: view.kind === "gr" ? ["Réceptionné par", "Contrôlé par"] : view.kind === "pr" ? ["Demandeur", "Approbateur"] : ["Émis par", "Approuvé par"] }} />
      </DialogContent>
    </Dialog>
  );
}

export default function ProcurementTransactions() {
  const { user } = useAuth();
  const { data: requisitions, isLoading: loadingPR } = useRequisitions();
  const { data: purchaseOrders, isLoading: loadingPO } = usePurchaseOrders();
  const { data: goodsReceipts, isLoading: loadingGR, isFetching: refreshingGR } = useGoodsReceipts();
  const { data: approvals = [] } = useApprovalQueue(undefined, "all");
  const [editPR, setEditPR] = useState<any | null>(null);
  const [editPO, setEditPO] = useState<any | null>(null);
  const completeGR = useCompleteGoodsReceipt();
  const { data: supplierReturns = [] } = useSupplierReturns();
  const returnLines = supplierReturns.flatMap((r) => r.lines);
  const { data: access } = useMyAccess();
  const canReturn = (access?.permissions ?? []).includes("procurement.return");
  const [returnGR, setReturnGR] = useState<any | null>(null);

  const [showCreatePR, setShowCreatePR] = useState(false);
  const [showCreatePO, setShowCreatePO] = useState(false);
  const [showCreateGR, setShowCreateGR] = useState(false);
  const [docView, setDocView] = useState<DocView>(null);
  const [tab, setTab] = useState("requisitions");
  // Export de l'onglet affiché, avec les mêmes lignes que l'écran.
  const exportTab = (f: ExportFormat = "csv") => {
    if (tab === "po") exportTable(f, pos.map((p: any) => ({ numero: p.po_number, fournisseur: p.supplier?.name ?? "", date: p.order_date, total: p.total, statut: p.status, lignes: p.lines?.length ?? 0 })),
      [{ key: "numero", header: "N° commande" }, { key: "fournisseur", header: "Fournisseur" }, { key: "date", header: "Date" }, { key: "total", header: "Total" }, { key: "statut", header: "Statut" }, { key: "lignes", header: "Lignes" }], "commandes");
    else if (tab === "gr") exportTable(f, grs.map((g: any) => ({ numero: g.gr_number, commande: g.po?.po_number ?? "", fournisseur: g.po?.supplier?.name ?? "", date: g.receipt_date, statut: g.status, lignes: g.lines?.length ?? 0 })),
      [{ key: "numero", header: "N° réception" }, { key: "commande", header: "Commande" }, { key: "fournisseur", header: "Fournisseur" }, { key: "date", header: "Date" }, { key: "statut", header: "Statut" }, { key: "lignes", header: "Lignes" }], "receptions");
    else exportTable(f, prs.map((r: any) => ({ numero: r.pr_number, objet: r.description, total: r.estimated_total, statut: r.status, date: r.request_date, commande: r.po_id ? "oui" : "" })),
      [{ key: "numero", header: "N° demande" }, { key: "objet", header: "Objet" }, { key: "total", header: "Total estimé" }, { key: "statut", header: "Statut" }, { key: "date", header: "Date" }, { key: "commande", header: "Convertie" }], "demandes-achat");
  };
  const [convertPR, setConvertPR] = useState<any | null>(null);
  const { data: suppliers } = useSuppliers();
  const convertMutation = useConvertPRToPO();
  const { data: perms } = useMyProcurementRoles();

  const [convertSupplier, setConvertSupplier] = useState<string>("");


  const prs = requisitions || [];
  const pos = purchaseOrders || [];
  const selPR = useSelection<any>(prs, rowId);
  const selPO = useSelection<any>(pos, rowId);
  const grs = goodsReceipts || [];

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Procurement", href: "/procurement" }, { label: "Transactions" }]} />
      <GuidanceBanner title="Procurement Transactions" description="Full procurement cycle: Requisition → PO → Goods Receipt → Invoice Matching. All data is live from the database." />

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-foreground">Procurement Transactions</h1>
        <div className="flex gap-2">
          <Button size="sm" className="gap-1.5" disabled={!perms?.canRequisition} title={perms && !perms.canRequisition ? "Droit requis : procurement.requisition" : undefined} onClick={() => setShowCreatePR(true)}><Plus className="w-3.5 h-3.5" />New Requisition</Button>
          <Button size="sm" variant="outline" className="gap-1.5" disabled={!perms?.canOrder} title={perms && !perms.canOrder ? "Droit requis : procurement.order" : undefined} onClick={() => setShowCreatePO(true)}><Package className="w-3.5 h-3.5" />New PO</Button>
          <Button size="sm" variant="outline" className="gap-1.5" disabled={!perms?.canReceive} title={perms && !perms.canReceive ? "Droit requis : procurement.receive" : undefined} onClick={() => setShowCreateGR(true)}><Truck className="w-3.5 h-3.5" />Nouvelle réception</Button>
          <ExportMenu size="sm" variant="outline" className="gap-1.5" data-testid="btn-export-csv" onPick={(f) => void exportTab(f)}><Download className="w-3.5 h-3.5" />Export</ExportMenu>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {[
          { label: "Requisitions", value: prs.length, sub: `${prs.filter((r: any) => r.status === "draft").length} draft` },
          { label: "Purchase Orders", value: pos.length, sub: `${fmt(pos.reduce((s: number, p: any) => s + p.total, 0))} XOF` },
          { label: "Goods Receipts", value: grs.length, sub: `${grs.filter((g: any) => g.status === "completed").length} completed` },
          { label: "Pending Approval", value: prs.filter((r: any) => r.status === "pending_approval").length + pos.filter((p: any) => p.status === "pending_approval").length, sub: "demandes et commandes soumises" },
        ].map(k => (
          <div key={k.label} className="bg-card rounded-lg border border-border p-3">
            <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">{k.label}</span>
            <div className="text-lg font-semibold text-foreground tabular-nums mt-0.5">{k.value}</div>
            <span className="text-[10px] text-muted-foreground">{k.sub}</span>
          </div>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="requisitions" className="gap-1.5"><ShoppingCart className="w-3.5 h-3.5" />Requisitions ({prs.length})</TabsTrigger>
          <TabsTrigger value="po" className="gap-1.5"><Package className="w-3.5 h-3.5" />Purchase Orders ({pos.length})</TabsTrigger>
          <TabsTrigger value="gr" className="gap-1.5"><Truck className="w-3.5 h-3.5" />Goods Receipt ({grs.length})</TabsTrigger>
          <TabsTrigger value="returns" className="gap-1.5"><Undo2 className="w-3.5 h-3.5" />Retours ({supplierReturns.length})</TabsTrigger>
          <TabsTrigger value="replenishment">Réapprovisionnement</TabsTrigger>
          <TabsTrigger value="followup">Suivi des livraisons</TabsTrigger>
          <TabsTrigger value="workflow" className="gap-1.5"><CheckCircle className="w-3.5 h-3.5" />Approval Workflow</TabsTrigger>
        </TabsList>

        {/* Requisitions Tab */}
        <TabsContent value="requisitions">
          <Card className="border-border"><CardContent className="p-0">
            {loadingPR ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
            ) : (
              <>
              <ProcurementBulkBar docType="PR" sel={selPR} approvals={approvals} />
              <Table><TableHeader><TableRow className="bg-muted/30">
                <SelectAllHead sel={selPR} pageIds={prs.map((r: any) => r.id)} label="Sélectionner toutes les demandes" />
                <TableHead className="text-xs">N° demande</TableHead>
                <TableHead className="text-xs">Objet</TableHead>
                <TableHead className="text-xs text-right">Total estimé</TableHead>
                <TableHead className="text-xs">Statut</TableHead>
                <TableHead className="text-xs">Commande</TableHead>
                <TableHead className="text-xs">Date</TableHead>
                <TableHead className="text-xs">Actions</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {prs.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-xs text-muted-foreground py-8">Aucune demande d'achat</TableCell></TableRow>
                ) : prs.map((pr: any) => (
                  <TableRow key={pr.id} className="text-xs">
                    <SelectCell sel={selPR} id={pr.id} label={`Sélectionner ${pr.pr_number}`} />
                    <TableCell className="font-mono text-primary">{pr.pr_number}</TableCell>
                    <TableCell className="font-medium max-w-[200px] truncate">{pr.description}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(pr.estimated_total)}</TableCell>
                    <TableCell><Badge className={`text-[10px] ${statusBadge(pr.status)}`} variant="outline">{statutAchat(pr.status)}</Badge></TableCell>
                    <TableCell className="font-mono text-[10px]">{pr.po_id ? "→ commande" : "—"}</TableCell>
                    <TableCell>{pr.request_date}</TableCell>
                    <TableCell className="space-x-1">
                      <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setDocView({ kind: "pr", doc: pr })}>Voir</Button>
                      <ProcurementLifecycleActions docType="PR" doc={pr} approvals={approvals} onEdit={() => setEditPR(pr)} />
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
              </>
            )}
          </CardContent></Card>
        </TabsContent>

        {/* Purchase Orders Tab */}
        <TabsContent value="po">
          <Card className="border-border"><CardContent className="p-0">
            {loadingPO ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
            ) : (
              <>
              <ProcurementBulkBar docType="PO" sel={selPO} approvals={approvals} />
              <Table><TableHeader><TableRow className="bg-muted/30">
                <SelectAllHead sel={selPO} pageIds={pos.map((r: any) => r.id)} label="Sélectionner toutes les commandes" />
                <TableHead className="text-xs">N° commande</TableHead>
                <TableHead className="text-xs">Fournisseur</TableHead>
                <TableHead className="text-xs text-right">Total</TableHead>
                <TableHead className="text-xs">Statut</TableHead>
                <TableHead className="text-xs">Lignes</TableHead>
                <TableHead className="text-xs">Date</TableHead>
                <TableHead className="text-xs">Actions</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {pos.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-xs text-muted-foreground py-8">Aucune commande d'achat</TableCell></TableRow>
                ) : pos.map((po: any) => (
                  <TableRow key={po.id} className="text-xs">
                    <SelectCell sel={selPO} id={po.id} label={`Sélectionner ${po.po_number}`} />
                    <TableCell className="font-mono text-primary">{po.po_number}</TableCell>
                    <TableCell className="font-medium">{(po.supplier as any)?.name || "—"}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(po.total)}</TableCell>
                    <TableCell><Badge className={`text-[10px] ${statusBadge(po.status)}`} variant="outline">{statutAchat(po.status)}</Badge></TableCell>
                    <TableCell className="text-[10px]">{po.lines?.length || 0} ligne(s)</TableCell>
                    <TableCell>{po.order_date}</TableCell>
                    <TableCell className="space-x-1">
                      <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setDocView({ kind: "po", doc: po })}>Voir</Button>
                      <ProcurementLifecycleActions docType="PO" doc={po} approvals={approvals} onEdit={() => setEditPO(po)} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody></Table>
              </>
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
                    <TableCell className="space-x-1">
                      <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setDocView({ kind: "gr", doc: gr })}>Voir</Button>
                      {gr.status === "completed" && canReturn && (
                        <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setReturnGR(gr)}>Retour</Button>
                      )}
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

        {/* Retours fournisseurs (V52) */}
        <TabsContent value="returns">
          <Card className="border-border"><CardContent className="p-0">
            <SupplierReturnsList />
          </CardContent></Card>
        </TabsContent>

        {/* Réapprovisionnement (V54) */}
        <TabsContent value="replenishment">
          <Card className="border-border"><CardContent className="p-4"><ReplenishmentProposalsPanel /></CardContent></Card>
        </TabsContent>

        {/* Suivi des livraisons (V56) */}
        <TabsContent value="followup">
          <Card className="border-border"><CardContent className="p-4"><PurchaseFollowupPanel /></CardContent></Card>
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
      {editPR && <CreateRequisitionDialog open edit={editPR} onOpenChange={(o) => { if (!o) setEditPR(null); }} />}
      {editPO && <CreatePODialog open edit={editPO} onOpenChange={(o) => { if (!o) setEditPO(null); }} />}
      <CreateReceiptDialog open={showCreateGR} onOpenChange={setShowCreateGR} pos={pos} grs={grs} returns={returnLines} refreshing={refreshingGR} />
      {returnGR && (
        <SupplierReturnDialog open gr={returnGR} onClose={() => setReturnGR(null)}
          poLines={(pos.find((p: any) => p.id === returnGR.po_id)?.lines ?? []) as any[]} />
      )}
      <ProcurementDocDialog view={docView} onClose={() => setDocView(null)} pos={pos} grs={grs} returns={returnLines} />

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
