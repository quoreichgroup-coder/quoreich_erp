import { useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { StatusBadge } from "@/components/StatusBadge";
import { cn } from "@/lib/utils";
import {
  Search, Download, Plus, Filter, CreditCard, Send, FileText,
  Eye, CheckCircle, ChevronDown, X, Users, Clock, AlertTriangle,
  MessageSquare, UserCheck, BookOpen, Receipt, Loader2,
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
  useARInvoices, useCreateARInvoice, useRecordARPayment, useCustomers,
  type ARInvoice,
} from "@/hooks/use-ar-data";

/* ──────── HELPERS ──────── */
const fmt = (n: number) => n.toLocaleString("fr-FR");
const fmtCurrency = (n: number) => `${fmt(n)} XOF`;

function daysDiff(due: string): number {
  const d = new Date(due);
  const today = new Date();
  return Math.floor((today.getTime() - d.getTime()) / 86400000);
}

function statusLabel(s: string) {
  const map: Record<string, string> = { draft: "Draft", open: "Open", partially_paid: "Partially Paid", paid: "Paid", overdue: "Overdue" };
  return map[s] || s;
}
function statusType(s: string) {
  const map: Record<string, string> = { draft: "info", open: "info", partially_paid: "warning", paid: "success", overdue: "error" };
  return map[s] || "info";
}

/* ──────── CREATE INVOICE DIALOG ──────── */
function CreateInvoiceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: customers = [] } = useCustomers();
  const createInvoice = useCreateARInvoice();
  const [form, setForm] = useState({
    customer_id: "",
    invoice_number: `INV-${Date.now().toString(36).toUpperCase()}`,
    invoice_date: new Date().toISOString().split("T")[0],
    due_date: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0],
    subtotal: "",
    tax_amount: "0",
  });

  const subtotal = parseFloat(form.subtotal) || 0;
  const tax = parseFloat(form.tax_amount) || 0;
  const total = subtotal + tax;

  const handleCreate = async () => {
    if (!form.customer_id || subtotal <= 0) { toast.error("Remplissez tous les champs"); return; }
    await createInvoice.mutateAsync({
      ...form,
      subtotal,
      tax_amount: tax,
      total,
    });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Nouvelle facture AR</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Client *</Label>
            <select className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm" value={form.customer_id} onChange={e => setForm(f => ({ ...f, customer_id: e.target.value }))}>
              <option value="">— Sélectionner —</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
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
              <Label className="text-xs">Montant HT (XOF)</Label>
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

/* ──────── PAYMENT RECORDING DIALOG ──────── */
function PaymentDialog({ inv, open, onClose }: { inv: ARInvoice; open: boolean; onClose: () => void }) {
  const recordPayment = useRecordARPayment();
  const outstanding = inv.total - inv.amount_paid;
  const [amount, setAmount] = useState(outstanding.toString());
  const [reference, setReference] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split("T")[0]);
  const [method, setMethod] = useState("bank_transfer");

  const parsedAmount = parseFloat(amount) || 0;
  const isPartial = parsedAmount < outstanding && parsedAmount > 0;
  const remaining = outstanding - parsedAmount;

  const handleRecord = async () => {
    if (parsedAmount <= 0 || parsedAmount > outstanding) { toast.error("Montant invalide"); return; }
    await recordPayment.mutateAsync({
      ar_invoice_id: inv.id,
      amount: parsedAmount,
      payment_date: paymentDate,
      payment_method: method,
      reference,
    });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-primary" />
            Enregistrer paiement — {inv.invoice_number}
          </DialogTitle>
          <DialogDescription className="text-xs">{inv.customer?.name} · Restant: {fmtCurrency(outstanding)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Date</Label>
              <Input type="date" className="h-8 text-xs" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Méthode</Label>
              <select className="w-full h-8 px-2 rounded-md border border-input bg-background text-xs" value={method} onChange={e => setMethod(e.target.value)}>
                {["bank_transfer", "check", "cash", "mobile_money"].map(m => <option key={m} value={m}>{m.replace("_", " ")}</option>)}
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
          <div className="space-y-1.5">
            <Label className="text-xs">Référence</Label>
            <Input className="h-8 text-xs" value={reference} onChange={e => setReference(e.target.value)} placeholder="ex: VIR-BQ-20260308" />
          </div>
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
          <Button size="sm" className="text-xs" onClick={handleRecord} disabled={recordPayment.isPending}>
            {recordPayment.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <><CheckCircle className="w-3 h-3 mr-1" /> Enregistrer</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ──────── SIDE PANEL ──────── */
function InvoicePanel({ inv, onClose, onRecordPayment }: { inv: ARInvoice; onClose: () => void; onRecordPayment: () => void }) {
  const outstanding = inv.total - inv.amount_paid;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-full max-w-lg bg-card border-l border-border shadow-xl flex flex-col animate-in slide-in-from-right">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground">{inv.invoice_number}</p>
            <p className="text-xs text-muted-foreground">{inv.customer?.name}</p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={statusType(inv.status)} label={statusLabel(inv.status)} />
            <button onClick={onClose} className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground"><X className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-5">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">Résumé facture</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                ["Date facture", inv.invoice_date],
                ["Échéance", inv.due_date],
                ["Montant total", fmtCurrency(inv.total)],
                ["Solde restant", fmtCurrency(outstanding)],
                ["Payé", fmtCurrency(inv.amount_paid)],
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
        <div className="p-4 border-t border-border flex items-center gap-2 flex-wrap">
          {inv.status !== "paid" && (
            <Button size="sm" className="text-xs gap-1.5" onClick={onRecordPayment}><CreditCard className="w-3.5 h-3.5" /> Enregistrer paiement</Button>
          )}
          <Button variant="outline" size="sm" className="text-xs gap-1.5 ml-auto"><Eye className="w-3.5 h-3.5" /> Voir écriture GL</Button>
        </div>
      </div>
    </div>
  );
}

/* ──────── MAIN ──────── */
export default function ARTransactions() {
  const { data: invoices = [], isLoading } = useARInvoices();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedInv, setSelectedInv] = useState<ARInvoice | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [paymentInv, setPaymentInv] = useState<ARInvoice | null>(null);
  const [showCreateInvoice, setShowCreateInvoice] = useState(false);

  const statusOptions = ["all", "draft", "open", "partially_paid", "paid", "overdue"];

  const filtered = invoices.filter(inv => {
    if (statusFilter !== "all" && inv.status !== statusFilter) return false;
    if (search && !inv.invoice_number.toLowerCase().includes(search.toLowerCase()) && !(inv.customer?.name || "").toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };
  const toggleAll = () => {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map(i => i.id)));
  };

  const totalOutstanding = filtered.reduce((s, i) => s + (i.total - i.amount_paid), 0);

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance", href: "/" }, { label: "Receivables", href: "/receivables" }, { label: "Transactions" }]} />

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Accounts Receivable Transactions</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Gestion des factures clients, encaissements et recouvrement</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" className="text-xs gap-1.5" onClick={() => setShowCreateInvoice(true)}><Plus className="w-3.5 h-3.5" /> Créer facture</Button>
          <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={() => { const unpaid = filtered.find(i => i.status !== "paid"); if (unpaid) setPaymentInv(unpaid); }}><CreditCard className="w-3.5 h-3.5" /> Enregistrer paiement</Button>
          <Button variant="outline" size="sm" className="text-xs gap-1.5" data-testid="btn-export-csv" onClick={handleExport}><Download className="w-3.5 h-3.5" /> Export</Button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="card-elevated p-3 flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Rechercher par numéro ou client..."
            className="w-full h-9 pl-9 pr-3 rounded-md border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select className="h-9 px-3 rounded-md border border-input bg-background text-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          {statusOptions.map(s => <option key={s} value={s}>{s === "all" ? "Tous" : statusLabel(s)}</option>)}
        </select>
        <span className="text-xs text-muted-foreground ml-auto tabular-nums">{filtered.length} factures · Restant: {fmtCurrency(totalOutstanding)}</span>
      </div>

      {/* Data Table */}
      <div className="card-elevated overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th className="w-10"><input type="checkbox" className="rounded border-input" checked={selectedIds.size === filtered.length && filtered.length > 0} onChange={toggleAll} /></th>
                <th>N° Facture</th>
                <th>Client</th>
                <th>Date</th>
                <th>Échéance</th>
                <th className="text-right">Total</th>
                <th className="text-right">Restant</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={8} className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-8 text-muted-foreground">
                  {invoices.length === 0 ? "Aucune facture — créez votre première facture AR" : "Aucun résultat"}
                </td></tr>
              ) : (
                filtered.map(inv => {
                  const outstanding = inv.total - inv.amount_paid;
                  return (
                    <tr key={inv.id} className="cursor-pointer" onClick={() => setSelectedInv(inv)}>
                      <td onClick={e => e.stopPropagation()}>
                        <input type="checkbox" className="rounded border-input" checked={selectedIds.has(inv.id)} onChange={() => toggleSelect(inv.id)} />
                      </td>
                      <td className="font-medium text-foreground tabular-nums">{inv.invoice_number}</td>
                      <td>{inv.customer?.name || "—"}</td>
                      <td className="tabular-nums text-muted-foreground">{inv.invoice_date}</td>
                      <td className={cn("tabular-nums", inv.status === "overdue" ? "text-destructive font-medium" : "text-muted-foreground")}>{inv.due_date}</td>
                      <td className="text-right tabular-nums">{fmt(inv.total)}</td>
                      <td className={cn("text-right tabular-nums font-medium", outstanding === 0 ? "text-success" : "text-foreground")}>{fmt(outstanding)}</td>
                      <td>
                        <StatusBadge status={statusType(inv.status)} label={statusLabel(inv.status)} />
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
          <h2 className="text-sm font-semibold text-foreground">GL Posting — Accounts Receivable</h2>
        </div>
        <GLPostingKPIsLive module="AR" />
        <GLBatchHistoryLive module="AR" />
      </div>

      {/* Dialogs */}
      <CreateInvoiceDialog open={showCreateInvoice} onClose={() => setShowCreateInvoice(false)} />

      {selectedInv && (
        <InvoicePanel
          inv={selectedInv}
          onClose={() => setSelectedInv(null)}
          onRecordPayment={() => { setPaymentInv(selectedInv); setSelectedInv(null); }}
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
