import { useEffect, useMemo, useState } from "react";
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
import { SettlementDialog } from "@/components/SettlementDialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GLPostingKPIsLive, GLBatchHistoryLive } from "@/hooks/use-gl-batches";
import { toast } from "sonner";
import {
  useARInvoices, useCreateARInvoice, useCustomers,
  type ARInvoice,
} from "@/hooks/use-ar-data";
import { apiDownloadCsv, isApiEnabled } from "@/api/client";
import { exportToCSV } from "@/lib/csv-export";
import { AnalyticSelectors } from "@/components/AnalyticSelectors";
import { useAnalyticsSetup, useCustomerAnalyticDefaults } from "@/hooks/use-analytics-setup";
import { useAccountingSetup } from "@/hooks/use-accounting-setup";
import { requiredAxisIds } from "@/lib/analytics-setup";
import { useTaxCodes } from "@/hooks/use-tax-codes";
import { emptyLine, invoiceTotals, type DraftLine } from "@/lib/invoice-lines";

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
    invoice_number: "",
    invoice_date: new Date().toISOString().split("T")[0],
    due_date: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0],
  });

  // Lignes (V21) : l'aperçu reproduit le calcul de la base, qui fait foi.
  const { data: taxCodes = [] } = useTaxCodes();
  const activeTaxCodes = taxCodes.filter((t) => t.active);
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const { amounts, subtotal, tax, total, allValid } = invoiceTotals(lines, taxCodes);
  const setLine = (i: number, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  // Analytique : sections par défaut du client, puis choix de l'utilisateur (prioritaire).
  const analyticsSetup = useAnalyticsSetup();
  const accountingSetup = useAccountingSetup();
  const customerDefaults = useCustomerAnalyticDefaults(form.customer_id || undefined);
  const [analytics, setAnalytics] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  useEffect(() => {
    // Nouveau client : ses défauts remplacent ceux du précédent, sauf sur les axes déjà choisis à la main.
    const defaults = Object.fromEntries((customerDefaults.data ?? []).map((d) => [d.axisId, d.valueId]));
    setAnalytics((prev) => {
      const next: Record<string, string> = { ...defaults };
      for (const axis of touched) next[axis] = prev[axis] ?? "";
      return next;
    });
  }, [customerDefaults.data, form.customer_id]); // eslint-disable-line react-hooks/exhaustive-deps
  const salesAccount = accountingSetup.data?.roles.find((r) => r.roleCode === "SALES_REVENUE")?.accountCode;
  const required = useMemo(() => requiredAxisIds(analyticsSetup.data, salesAccount), [analyticsSetup.data, salesAccount]);

  const handleCreate = async () => {
    if (!form.customer_id) { toast.error("Choisissez un client"); return; }
    if (!allValid) { toast.error("Chaque ligne doit avoir un libellé, une quantité positive, un prix et une remise entre 0 et 100 %"); return; }
    if (total <= 0) { toast.error("Le total de la facture doit être positif"); return; }
    const missing = (analyticsSetup.data?.axes ?? []).filter((a) => required.has(a.id) && !analytics[a.id]);
    if (missing.length > 0) {
      toast.error(`Section obligatoire sur le compte de ventes ${salesAccount} : ${missing.map((a) => a.name).join(", ")}`);
      return;
    }
    try {
      await createInvoice.mutateAsync({
        ...form, subtotal, tax_amount: tax, total, analytics,
        lines: lines.map((l) => ({
          description: l.description.trim(), quantity: Number(l.quantity.replace(",", ".")),
          unit_price: Number(l.unitPrice.replace(",", ".")),
          discount_pct: l.discountPct === "" ? 0 : Number(l.discountPct.replace(",", ".")),
          tax_code_id: l.taxCodeId || undefined,
        })),
      });
      onClose();
    } catch {
      /* le refus est déjà affiché par la mutation ; la saisie reste ouverte pour correction */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
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
              <Label className="text-xs" htmlFor="invoice-number">N° Facture</Label>
              <Input id="invoice-number" className="h-8 text-xs" placeholder="Attribué à l'émission" value={form.invoice_number} onChange={e => setForm(f => ({ ...f, invoice_number: e.target.value }))} />
              <p className="text-[11px] text-muted-foreground">En numérotation automatique, la série de la société fixe le numéro à l'émission.</p>
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
          </div>
          <div className="space-y-2" data-testid="invoice-lines">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="py-1.5 pr-2 font-medium">Libellé</th>
                    <th className="py-1.5 pr-2 font-medium text-right w-20">Qté</th>
                    <th className="py-1.5 pr-2 font-medium text-right w-28">Prix unitaire</th>
                    <th className="py-1.5 pr-2 font-medium text-right w-20">Remise %</th>
                    <th className="py-1.5 pr-2 font-medium w-32">TVA</th>
                    <th className="py-1.5 pr-2 font-medium text-right w-28">HT</th>
                    <th className="w-8"><span className="sr-only">Retirer</span></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i} className="border-b border-border/50" data-testid={`invoice-line-${i + 1}`}>
                      <td className="py-1 pr-2"><Input aria-label={`Libellé ligne ${i + 1}`} className="h-8 text-xs" value={l.description} onChange={e => setLine(i, { description: e.target.value })} /></td>
                      <td className="py-1 pr-2"><Input aria-label={`Quantité ligne ${i + 1}`} inputMode="decimal" className="h-8 text-xs text-right" value={l.quantity} onChange={e => setLine(i, { quantity: e.target.value })} /></td>
                      <td className="py-1 pr-2"><Input aria-label={`Prix unitaire ligne ${i + 1}`} inputMode="decimal" className="h-8 text-xs text-right" value={l.unitPrice} onChange={e => setLine(i, { unitPrice: e.target.value })} /></td>
                      <td className="py-1 pr-2"><Input aria-label={`Remise ligne ${i + 1}`} inputMode="decimal" placeholder="0" className="h-8 text-xs text-right" value={l.discountPct} onChange={e => setLine(i, { discountPct: e.target.value })} /></td>
                      <td className="py-1 pr-2">
                        <select aria-label={`Code TVA ligne ${i + 1}`} className="w-full h-8 px-2 rounded-md border border-input bg-background text-xs" value={l.taxCodeId} onChange={e => setLine(i, { taxCodeId: e.target.value })}>
                          <option value="">Sans TVA</option>
                          {activeTaxCodes.map(t => <option key={t.id} value={t.id}>{t.code} · {t.rate} %</option>)}
                        </select>
                      </td>
                      <td className="py-1 pr-2 text-right tabular-nums">{amounts[i].valid ? fmt(amounts[i].net) : "—"}</td>
                      <td className="py-1 text-right">
                        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" aria-label={`Retirer la ligne ${i + 1}`}
                          disabled={lines.length === 1} onClick={() => setLines(ls => ls.filter((_, k) => k !== i))}>×</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1" data-testid="btn-add-line"
              onClick={() => setLines(ls => [...ls, emptyLine(ls[ls.length - 1]?.taxCodeId ?? "")])}>
              <Plus className="w-3 h-3" /> Ajouter une ligne
            </Button>
            {activeTaxCodes.length === 0 && (
              <p className="text-xs text-muted-foreground">Aucun code TVA actif : créez-en dans Paramètres → Codes TVA pour facturer de la TVA.</p>
            )}
          </div>
          <AnalyticSelectors
            date={form.invoice_date}
            value={analytics}
            required={required}
            idPrefix="invoice"
            onChange={(axisId, valueId) => {
              setTouched((t) => new Set(t).add(axisId));
              setAnalytics((a) => ({ ...a, [axisId]: valueId }));
            }}
          />
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
/* ──────── SIDE PANEL ──────── */
function InvoicePanel({ inv, onClose, onRecordPayment }: { inv: ARInvoice; onClose: () => void; onRecordPayment: () => void }) {
  const outstanding = inv.total - inv.amount_paid;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={`Facture ${inv.invoice_number}`} className="w-full max-w-lg bg-card border-l border-border shadow-xl flex flex-col animate-in slide-in-from-right">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground">{inv.invoice_number}</p>
            <p className="text-xs text-muted-foreground">{inv.customer?.name}</p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={statusType(inv.status)} label={statusLabel(inv.status)} />
            <button type="button" onClick={onClose} aria-label="Fermer" className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground"><X className="w-4 h-4" /></button>
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
  const { data: customers = [] } = useCustomers();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedInv, setSelectedInv] = useState<ARInvoice | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [settlementOpen, setSettlementOpen] = useState(false);
  const [paymentInv, setPaymentInv] = useState<ARInvoice | null>(null);
  const [showCreateInvoice, setShowCreateInvoice] = useState(false);

  const statusOptions = ["all", "draft", "open", "partially_paid", "paid", "overdue"];

  const filtered = invoices.filter(inv => {
    if (statusFilter !== "all" && inv.status !== statusFilter) return false;
    if (search && !inv.invoice_number.toLowerCase().includes(search.toLowerCase()) && !(inv.customer?.name || "").toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Avec l'API, l'export est celui du serveur (périmètre société garanti côté serveur, AR-REC) :
  // il couvre toutes les factures visibles, pas seulement le filtre affiché. Sans API, on
  // exporte les lignes filtrées déjà chargées.
  const handleExport = async () => {
    try {
      if (isApiEnabled()) {
        await apiDownloadCsv("/api/v1/ar/invoices/export", "factures-clients.csv");
        return;
      }
      exportToCSV(
        filtered.map((i) => ({
          invoice_number: i.invoice_number,
          customer: i.customer?.name ?? "",
          invoice_date: i.invoice_date,
          due_date: i.due_date,
          total: i.total,
          amount_paid: i.amount_paid,
          balance: i.total - i.amount_paid,
          status: i.status,
        })),
        [
          { key: "invoice_number", header: "Numéro" },
          { key: "customer", header: "Client" },
          { key: "invoice_date", header: "Date" },
          { key: "due_date", header: "Échéance" },
          { key: "total", header: "Total TTC" },
          { key: "amount_paid", header: "Encaissé" },
          { key: "balance", header: "Solde" },
          { key: "status", header: "Statut" },
        ],
        "factures-clients",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export impossible");
    }
  };

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
          <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={() => { setPaymentInv(null); setSettlementOpen(true); }}><CreditCard className="w-3.5 h-3.5" /> Encaissement client</Button>
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
          onRecordPayment={() => { setPaymentInv(selectedInv); setSettlementOpen(true); setSelectedInv(null); }}
        />
      )}

      <SettlementDialog
        kind="ar"
        open={settlementOpen}
        onClose={() => { setSettlementOpen(false); setPaymentInv(null); }}
        parties={customers}
        invoices={invoices}
        initialPartyId={paymentInv?.customer_id}
        initialInvoiceId={paymentInv?.id}
      />
    </PageShell>
  );
}
