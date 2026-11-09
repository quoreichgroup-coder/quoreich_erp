import { useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { StatusBadge } from "@/components/StatusBadge";
import { cn } from "@/lib/utils";
import {
  Search, Download, Plus, Filter, FileText, CreditCard,
  Eye, CheckCircle, X, Clock, BookOpen, Loader2, AlertTriangle,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GLPostingKPIsLive, GLBatchHistoryLive } from "@/hooks/use-gl-batches";
import { toast } from "sonner";
import {
  useAPInvoices, useCreateAPInvoice, useUpdateAPInvoice, useRecordAPPayment, useSuppliers,
  type APInvoice,
} from "@/hooks/use-ap-data";

const fmt = (n: number) => n.toLocaleString("fr-FR");
const fmtCurrency = (n: number) => `${fmt(n)} XOF`;

function statusLabel(s: string) {
  const map: Record<string, string> = { draft: "Draft", open: "Open", partially_paid: "Partial", paid: "Paid", overdue: "Overdue" };
  return map[s] || s;
}
function statusType(s: string) {
  const map: Record<string, string> = { draft: "info", open: "info", partially_paid: "warning", paid: "success", overdue: "error" };
  return map[s] || "info";
}
function approvalLabel(s: string) {
  const map: Record<string, string> = { pending: "Pending", approved: "Approved", rejected: "Rejected" };
  return map[s] || s;
}
function approvalType(s: string) {
  const map: Record<string, string> = { pending: "warning", approved: "success", rejected: "error" };
  return map[s] || "info";
}

/* ──────── CREATE INVOICE DIALOG ──────── */
function CreateInvoiceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: suppliers = [] } = useSuppliers();
  const createInvoice = useCreateAPInvoice();
  const [form, setForm] = useState({
    supplier_id: "",
    invoice_number: `BILL-${Date.now().toString(36).toUpperCase()}`,
    invoice_date: new Date().toISOString().split("T")[0],
    due_date: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0],
    subtotal: "",
    tax_amount: "0",
  });

  const subtotal = parseFloat(form.subtotal) || 0;
  const tax = parseFloat(form.tax_amount) || 0;
  const total = subtotal + tax;

  const handleCreate = async () => {
    if (!form.supplier_id || subtotal <= 0) { toast.error("Remplissez tous les champs"); return; }
    await createInvoice.mutateAsync({ ...form, subtotal, tax_amount: tax, total });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Nouvelle facture fournisseur</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Fournisseur *</Label>
            <select className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm" value={form.supplier_id} onChange={e => setForm(f => ({ ...f, supplier_id: e.target.value }))}>
              <option value="">— Sélectionner —</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">N° Facture</Label>
              <Input className="h-8 text-xs" value={form.invoice_number} onChange={e => setForm(f => ({ ...f, invoice_number: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Date</Label>
              <Input type="date" className="h-8 text-xs" value={form.invoice_date} onChange={e => setForm(f => ({ ...f, invoice_date: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Échéance</Label>
              <Input type="date" className="h-8 text-xs" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Montant HT</Label>
              <Input type="number" className="h-8 text-xs" value={form.subtotal} onChange={e => setForm(f => ({ ...f, subtotal: e.target.value }))} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">TVA (XOF)</Label>
            <Input type="number" className="h-8 text-xs" value={form.tax_amount} onChange={e => setForm(f => ({ ...f, tax_amount: e.target.value }))} />
          </div>
          <div className="bg-muted/30 rounded p-3 text-xs">
            <div className="flex justify-between"><span>Sous-total</span><span className="tabular-nums">{fmtCurrency(subtotal)}</span></div>
            <div className="flex justify-between"><span>TVA</span><span className="tabular-nums">{fmtCurrency(tax)}</span></div>
            <div className="flex justify-between font-medium border-t border-border mt-1.5 pt-1.5"><span>Total TTC</span><span className="tabular-nums">{fmtCurrency(total)}</span></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" className="text-xs" onClick={onClose}>Annuler</Button>
          <Button size="sm" className="text-xs" onClick={handleCreate} disabled={createInvoice.isPending}>
            {createInvoice.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Créer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ──────── PAYMENT DIALOG ──────── */
function PaymentDialog({ inv, open, onClose }: { inv: APInvoice; open: boolean; onClose: () => void }) {
  const recordPayment = useRecordAPPayment();
  const outstanding = inv.total - inv.amount_paid;
  const [amount, setAmount] = useState(outstanding.toString());
  const [reference, setReference] = useState("");
  const [payDate, setPayDate] = useState(new Date().toISOString().split("T")[0]);
  const [method, setMethod] = useState("bank_transfer");
  const parsedAmount = parseFloat(amount) || 0;
  const isPartial = parsedAmount < outstanding && parsedAmount > 0;
  const remaining = outstanding - parsedAmount;

  const handlePay = async () => {
    if (parsedAmount <= 0 || parsedAmount > outstanding) { toast.error("Montant invalide"); return; }
    await recordPayment.mutateAsync({
      ap_invoice_id: inv.id,
      amount: parsedAmount,
      payment_date: payDate,
      payment_method: method,
      reference,
    });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2"><CreditCard className="w-4 h-4 text-primary" /> Paiement — {inv.invoice_number}</DialogTitle>
          <DialogDescription className="text-xs">{inv.supplier?.name} · Restant: {fmtCurrency(outstanding)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label className="text-xs">Date</Label><Input type="date" className="h-8 text-xs" value={payDate} onChange={e => setPayDate(e.target.value)} /></div>
            <div className="space-y-1.5"><Label className="text-xs">Méthode</Label>
              <select className="w-full h-8 px-2 rounded-md border border-input bg-background text-xs" value={method} onChange={e => setMethod(e.target.value)}>
                {["bank_transfer", "check", "cash", "wire"].map(m => <option key={m} value={m}>{m.replace("_", " ")}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Montant (XOF)</Label>
            <Input type="number" className="h-8 text-xs tabular-nums" value={amount} onChange={e => setAmount(e.target.value)} />
            <div className="flex items-center gap-2 mt-1">
              <button className="text-[10px] px-2 py-0.5 rounded bg-muted hover:bg-muted/80 text-foreground" onClick={() => setAmount(outstanding.toString())}>Totalité</button>
              <button className="text-[10px] px-2 py-0.5 rounded bg-muted hover:bg-muted/80 text-foreground" onClick={() => setAmount((outstanding / 2).toString())}>50%</button>
            </div>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Référence</Label><Input className="h-8 text-xs" value={reference} onChange={e => setReference(e.target.value)} placeholder="ex: VIR-OUT-20260308" /></div>
          <div className="bg-muted/30 rounded p-3 space-y-1.5 text-xs">
            <div className="flex justify-between"><span className="text-muted-foreground">Total facture</span><span className="tabular-nums">{fmtCurrency(inv.total)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Déjà payé</span><span className="tabular-nums">{fmtCurrency(inv.amount_paid)}</span></div>
            <div className="flex justify-between font-medium"><span>Ce paiement</span><span className="tabular-nums text-primary">{fmtCurrency(parsedAmount)}</span></div>
            <div className="flex justify-between border-t border-border pt-1.5 mt-1.5">
              <span className="font-medium">Restant</span>
              <span className={cn("tabular-nums font-medium", remaining <= 0 ? "text-success" : "text-foreground")}>{fmtCurrency(Math.max(remaining, 0))}</span>
            </div>
            {isPartial && <p className="text-[10px] text-amber-600 flex items-center gap-1 mt-1"><AlertTriangle className="w-3 h-3" /> Paiement partiel</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" className="text-xs" onClick={onClose}>Annuler</Button>
          <Button size="sm" className="text-xs" onClick={handlePay} disabled={recordPayment.isPending}>
            {recordPayment.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <><CheckCircle className="w-3 h-3 mr-1" /> Payer</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ──────── SIDE PANEL ──────── */
function InvoicePanel({ inv, onClose, onCreatePayment }: { inv: APInvoice; onClose: () => void; onCreatePayment: () => void }) {
  const outstanding = inv.total - inv.amount_paid;
  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-full max-w-lg bg-card border-l border-border shadow-xl flex flex-col animate-in slide-in-from-right">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground">{inv.invoice_number}</p>
            <p className="text-xs text-muted-foreground">{inv.supplier?.name}</p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={approvalType(inv.approval_status)} label={approvalLabel(inv.approval_status)} />
            <button onClick={onClose} className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground"><X className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-5">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">Détails</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                ["Date facture", inv.invoice_date],
                ["Échéance", inv.due_date],
                ["Montant HT", fmtCurrency(inv.subtotal)],
                ["TVA", fmtCurrency(inv.tax_amount)],
                ["Total TTC", fmtCurrency(inv.total)],
                ["Payé", fmtCurrency(inv.amount_paid)],
                ["Restant", fmtCurrency(outstanding)],
                ["Statut", statusLabel(inv.status)],
              ].map(([label, value]) => (
                <div key={label}>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
                  <p className="text-sm text-foreground mt-0.5 font-medium tabular-nums">{value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="p-4 border-t border-border flex items-center gap-2">
          {inv.status !== "paid" && inv.approval_status === "approved" && (
            <Button size="sm" className="text-xs gap-1.5" onClick={onCreatePayment}><CreditCard className="w-3.5 h-3.5" /> Create Payment</Button>
          )}
          <Button variant="outline" size="sm" className="text-xs gap-1.5 ml-auto"><Eye className="w-3.5 h-3.5" /> View GL Entry</Button>
        </div>
      </div>
    </div>
  );
}

/* ──────── MAIN ──────── */
export default function APTransactions() {
  const { data: invoices = [], isLoading } = useAPInvoices();
  const updateInvoice = useUpdateAPInvoice();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [approvalFilter, setApprovalFilter] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [selectedInv, setSelectedInv] = useState<APInvoice | null>(null);
  const [paymentInv, setPaymentInv] = useState<APInvoice | null>(null);
  const [showCreateInvoice, setShowCreateInvoice] = useState(false);

  const statusOptions = ["all", "draft", "open", "partially_paid", "paid", "overdue"];
  const approvalOptions = ["all", "pending", "approved", "rejected"];

  const filtered = invoices.filter(inv => {
    if (statusFilter !== "all" && inv.status !== statusFilter) return false;
    if (approvalFilter !== "all" && inv.approval_status !== approvalFilter) return false;
    if (search && !inv.invoice_number.toLowerCase().includes(search.toLowerCase()) && !(inv.supplier?.name || "").toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const totalPayable = filtered.filter(i => i.status !== "paid").reduce((s, i) => s + (i.total - i.amount_paid), 0);

  const handleApprove = async (inv: APInvoice) => {
    await updateInvoice.mutateAsync({ id: inv.id, approval_status: "approved", status: "open" });
    toast.success("Facture approuvée");
  };

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance", href: "/" }, { label: "Payables", href: "/payables" }, { label: "Supplier Invoices" }]} />

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Supplier Invoices</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Gestion des factures fournisseurs, approbation et paiements</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" className="text-xs gap-1.5" onClick={() => setShowCreateInvoice(true)}><Plus className="w-3.5 h-3.5" /> New Supplier Invoice</Button>
          <Button variant="outline" size="sm" className="text-xs gap-1.5"><Download className="w-3.5 h-3.5" /> Export</Button>
        </div>
      </div>

      {/* KPI Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Total Payable", value: fmtCurrency(totalPayable), color: "text-foreground" },
          { label: "Pending Approval", value: invoices.filter(i => i.approval_status === "pending").length.toString(), color: "text-amber-600" },
          { label: "Approved", value: invoices.filter(i => i.approval_status === "approved").length.toString(), color: "text-success" },
          { label: "Paid", value: invoices.filter(i => i.status === "paid").length.toString(), color: "text-primary" },
        ].map(k => (
          <div key={k.label} className="bg-card rounded-lg border border-border p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{k.label}</p>
            <p className={cn("text-xl font-semibold tabular-nums mt-1", k.color)}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="card-elevated p-3 flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" placeholder="Search by invoice or supplier..." className="w-full h-9 pl-9 pr-3 rounded-md border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button onClick={() => setShowFilters(!showFilters)} className={cn("btn-outline text-xs flex items-center gap-1.5 px-3 py-2 rounded-md border border-input hover:bg-muted", showFilters && "bg-muted")}>
          <Filter className="w-3.5 h-3.5" /> Filters
        </button>
        <span className="text-xs text-muted-foreground ml-auto tabular-nums">{filtered.length} factures · Payable: {fmtCurrency(totalPayable)}</span>
      </div>

      {showFilters && (
        <div className="card-elevated p-3 flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">Status</label>
            <select className="h-8 px-2 rounded border border-input bg-background text-xs" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              {statusOptions.map(s => <option key={s} value={s}>{s === "all" ? "Tous" : statusLabel(s)}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">Approval</label>
            <select className="h-8 px-2 rounded border border-input bg-background text-xs" value={approvalFilter} onChange={e => setApprovalFilter(e.target.value)}>
              {approvalOptions.map(s => <option key={s} value={s}>{s === "all" ? "Tous" : approvalLabel(s)}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* Data Table */}
      <div className="card-elevated overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>N° Facture</th>
                <th>Fournisseur</th>
                <th>Date</th>
                <th>Échéance</th>
                <th className="text-right">Total</th>
                <th className="text-right">Restant</th>
                <th>Statut</th>
                <th>Approbation</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={9} className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-8 text-muted-foreground">
                  {invoices.length === 0 ? "Aucune facture — créez votre première facture AP" : "Aucun résultat"}
                </td></tr>
              ) : (
                filtered.map(inv => {
                  const outstanding = inv.total - inv.amount_paid;
                  return (
                    <tr key={inv.id} className="cursor-pointer" onClick={() => setSelectedInv(inv)}>
                      <td className="font-medium text-foreground tabular-nums">{inv.invoice_number}</td>
                      <td>{inv.supplier?.name || "—"}</td>
                      <td className="tabular-nums text-muted-foreground">{inv.invoice_date}</td>
                      <td className="tabular-nums text-muted-foreground">{inv.due_date}</td>
                      <td className="text-right tabular-nums font-medium">{fmt(inv.total)}</td>
                      <td className={cn("text-right tabular-nums font-medium", outstanding === 0 ? "text-success" : "text-foreground")}>{fmt(outstanding)}</td>
                      <td><StatusBadge status={statusType(inv.status)} label={statusLabel(inv.status)} /></td>
                      <td><StatusBadge status={approvalType(inv.approval_status)} label={approvalLabel(inv.approval_status)} /></td>
                      <td onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          {inv.approval_status === "pending" && (
                            <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => handleApprove(inv)}>
                              <CheckCircle className="w-3 h-3 mr-1" /> Approve
                            </Button>
                          )}
                          {inv.approval_status === "approved" && inv.status !== "paid" && (
                            <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => setPaymentInv(inv)}>
                              <CreditCard className="w-3 h-3 mr-1" /> Pay
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* GL Posting Section */}
      <div className="space-y-4 mt-6">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">GL Posting — Accounts Payable</h2>
        </div>
        <GLPostingKPIsLive module="AP" />
        <GLBatchHistoryLive module="AP" />
      </div>

      {/* Dialogs */}
      <CreateInvoiceDialog open={showCreateInvoice} onClose={() => setShowCreateInvoice(false)} />

      {selectedInv && (
        <InvoicePanel
          inv={selectedInv}
          onClose={() => setSelectedInv(null)}
          onCreatePayment={() => { setPaymentInv(selectedInv); setSelectedInv(null); }}
        />
      )}

      {paymentInv && (
        <PaymentDialog
          inv={paymentInv}
          open={!!paymentInv}
          onClose={() => setPaymentInv(null)}
        />
      )}
    </PageShell>
  );
}
