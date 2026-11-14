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
import { DocumentDetail } from "@/components/DocumentDetail";
import { JournalEntryPreview } from "@/components/JournalEntryPreview";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GLPostingKPIsLive, GLBatchHistoryLive } from "@/hooks/use-gl-batches";
import { toast } from "sonner";
import {
  useARInvoices, useARInvoiceLines, useCreateARInvoice, useCustomers, useARInvoicePayments,
  useReverseARReceipt, useEmitARInvoice, useDeleteARDraft, useSetARDraftLineTax, useBulkARDrafts,
  type ARInvoice, type Payment,
} from "@/hooks/use-ar-data";
import { useMyAccess } from "@/hooks/use-my-access";
import { CreditNoteDialog, CreditNotesList } from "@/components/ARCreditNotes";
import { CustomerStatementDialog } from "@/components/CustomerStatement";
import { AdvanceDialog, CustomerCreditsList, InvoiceCredits } from "@/components/ARCustomerCredits";
import { useARLetterings } from "@/hooks/use-ar-credits";
import { apiDownloadCsv, isApiEnabled } from "@/api/client";
import { exportToCSV } from "@/lib/csv-export";
import { AnalyticSelectors } from "@/components/AnalyticSelectors";
import { useAnalyticsSetup, useCustomerAnalyticDefaults } from "@/hooks/use-analytics-setup";
import { useAccountingSetup } from "@/hooks/use-accounting-setup";
import { requiredAxisIds } from "@/lib/analytics-setup";
import { useTaxCodes } from "@/hooks/use-tax-codes";
import { emptyLine, invoiceTotals, type DraftLine } from "@/lib/invoice-lines";
import { CommercialLinesEditor, CommercialTotals } from "@/components/CommercialLinesEditor";

/* ──────── HELPERS ──────── */
const fmt = (n: number) => n.toLocaleString("fr-FR");
const fmtCurrency = (n: number) => `${fmt(n)} XOF`;

function daysDiff(due: string): number {
  const d = new Date(due);
  const today = new Date();
  return Math.floor((today.getTime() - d.getTime()) / 86400000);
}

function statusLabel(s: string) {
  const map: Record<string, string> = {
    draft: "Brouillon", sent: "Émise", open: "Émise", posted: "Émise", partially_paid: "Partiellement réglée",
    paid: "Réglée", overdue: "En retard", cancelled: "Annulée",
  };
  return map[s] || s;
}
function statusType(s: string) {
  const map: Record<string, string> = { draft: "info", sent: "info", open: "info", posted: "info", partially_paid: "warning", paid: "success", overdue: "error", cancelled: "error" };
  return map[s] || "info";
}
const today = () => new Date().toISOString().split("T")[0];
const addDays = (iso: string, days: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
};

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
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const { subtotal, tax, total, allValid } = invoiceTotals(lines, taxCodes);

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
            <select className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm" value={form.customer_id} onChange={e => {
              const id = e.target.value;
              // Échéance = date de facture + conditions de paiement du client (modifiable).
              const terms = Number(customers.find(c => c.id === id)?.payment_terms ?? 30) || 30;
              setForm(f => ({ ...f, customer_id: id, due_date: addDays(f.invoice_date, terms) }));
            }}>
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
          <CommercialLinesEditor lines={lines} onChange={setLines} taxCodes={taxCodes} />
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
          <CommercialTotals lines={lines} taxCodes={taxCodes} />
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
const fmtNum = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

/* ──────── SIDE PANEL ──────── */
/* Règlements de la facture : encaissements et annulations (V42, contre-passation motivée). */
function InvoicePayments({ inv, canReverse }: { inv: ARInvoice; canReverse: boolean }) {
  const { data: payments = [], isLoading } = useARInvoicePayments(inv.id);
  const reverse = useReverseARReceipt();
  const [target, setTarget] = useState<Payment | null>(null);
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(today());
  const reversed = new Set(payments.filter((p) => p.reversal_of).map((p) => p.reversal_of));
  // Encaissements et imputations d'avoir (V45).
  if (isLoading || payments.length === 0) return null;
  return (
    <section aria-label="Règlements" className="space-y-2">
      <h3 className="text-xs font-semibold text-foreground">Règlements</h3>
      <table className="w-full text-xs">
        <thead><tr className="text-muted-foreground"><th className="text-left">Date</th><th className="text-left">Référence</th>
          <th className="text-right">Montant</th><th /></tr></thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.id} data-testid="ar-payment-row" className={cn(p.reversal_of && "text-muted-foreground")}>
              <td className="tabular-nums">{p.payment_date}</td>
              <td>{p.reference || "—"}{p.reversal_reason ? ` · ${p.reversal_reason}` : ""}</td>
              <td className="text-right tabular-nums">{fmt(Number(p.amount))}</td>
              <td className="text-right">
                {p.payment_type === "ar_credit" ? <span>Avoir</span>
                  : p.payment_type === "ar_advance" ? <span>Acompte</span>
                  : p.reversal_of ? <span>Annulation</span>
                  : reversed.has(p.id) ? <span>Annulé</span>
                  : canReverse ? (
                    <Button size="sm" variant="ghost" className="h-6 text-[10px] text-destructive"
                      onClick={() => { setTarget(p); setReason(""); setDate(today()); }}>Annuler</Button>
                  ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Dialog open={!!target} onOpenChange={(o) => { if (!o) setTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Annuler l'encaissement {target?.reference || ""}</DialogTitle>
            <DialogDescription className="text-xs">
              L'écriture bancaire est contre-passée et la facture redevient due. L'encaissement d'origine reste visible.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="ar-reversal-reason">Motif (obligatoire)</Label>
              <Input id="ar-reversal-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Chèque impayé, erreur de saisie…" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="ar-reversal-date">Date d'annulation</Label>
              <Input id="ar-reversal-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setTarget(null)}>Retour</Button>
            <Button size="sm" variant="destructive" disabled={!reason.trim() || reverse.isPending}
              onClick={() => target && reverse.mutate({ invoiceId: inv.id, paymentId: target.id, reason: reason.trim(), date },
                { onSuccess: () => setTarget(null) })}>
              Annuler l'encaissement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/* Brouillon (préparé depuis une livraison, V42) : codes TVA par ligne, puis émission. */
function DraftActions({ inv, onDone }: { inv: ARInvoice; onDone: () => void }) {
  const lines = useARInvoiceLines(inv.id);
  const { data: taxCodes = [] } = useTaxCodes();
  const setTax = useSetARDraftLineTax();
  const emit = useEmitARInvoice();
  const remove = useDeleteARDraft();
  const sansCode = (lines.data ?? []).filter((l) => !l.tax_code_id).length;
  return (
    <section aria-label="Brouillon" className="space-y-2 rounded border border-border p-3">
      <h3 className="text-xs font-semibold text-foreground">Brouillon à compléter</h3>
      <p className="text-[11px] text-muted-foreground">
        Choisir le code TVA de chaque ligne (exonérée : laisser « Sans TVA »), puis émettre : le numéro légal
        et l'écriture comptable sont attribués à l'émission. Une facture émise ne se modifie plus.
      </p>
      {(lines.data ?? []).map((l) => (
        <div key={l.id ?? l.line_no} className="flex items-center gap-2 text-xs">
          <span className="flex-1 truncate">{l.line_no}. {l.description}</span>
          <select aria-label={`Code TVA ligne ${l.line_no}`} className="h-7 rounded border border-input bg-background px-2 text-xs"
            value={l.tax_code_id ?? ""} disabled={!l.id || setTax.isPending}
            onChange={(e) => l.id && setTax.mutate({ lineId: l.id, taxCodeId: e.target.value || null })}>
            <option value="">Sans TVA</option>
            {taxCodes.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.code} — {fmtNum(t.rate)} %</option>)}
          </select>
        </div>
      ))}
      <div className="flex gap-2 pt-1">
        <Button size="sm" className="text-xs gap-1.5" disabled={emit.isPending}
          onClick={() => {
            if (sansCode > 0 && !window.confirm(sansCode + " ligne(s) sans code TVA : émettre sans TVA sur ces lignes ?")) return;
            emit.mutate(inv.id, { onSuccess: onDone });
          }}>
          <Send className="w-3.5 h-3.5" /> Émettre
        </Button>
        <Button size="sm" variant="ghost" className="text-xs text-destructive" disabled={remove.isPending}
          onClick={() => { if (window.confirm("Supprimer ce brouillon ?")) remove.mutate(inv.id, { onSuccess: onDone }); }}>
          Supprimer le brouillon
        </Button>
      </div>
    </section>
  );
}

function InvoicePanel({ inv, onClose, onRecordPayment }: { inv: ARInvoice; onClose: () => void; onRecordPayment: () => void }) {
  const outstanding = inv.total - inv.amount_paid;
  const lines = useARInvoiceLines(inv.id);
  const { data: access } = useMyAccess();
  const perms = new Set(access?.permissions ?? []);
  const isWriter = (access?.roles ?? []).some((r) => r === "admin" || r === "accountant");
  const [creditOpen, setCreditOpen] = useState(false);

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
          <DocumentDetail
            header={[
              ["Client", inv.customer?.name], ["Statut", statusLabel(inv.status)],
              ["Date facture", inv.invoice_date], ["Échéance", inv.due_date],
            ]}
            columns={[{ label: "Libellé" }, { label: "Qté", align: "right" }, { label: "P.U.", align: "right" },
              { label: "Remise", align: "right" }, { label: "TVA", align: "right" }, { label: "Montant HT", align: "right" }]}
            rows={(lines.data ?? []).map((l) => [l.description, fmtNum(l.quantity), fmtNum(l.unit_price),
              l.discount_pct ? `${fmtNum(l.discount_pct)} %` : "", l.tax_code ?? "—", fmtNum(l.net_amount)])}
            emptyLines={lines.isLoading ? "Chargement des lignes…" : "Facture sans lignes (saisie en en-tête seul)."}
            footer={[
              ["Total HT", fmtCurrency(inv.subtotal)], ["TVA", fmtCurrency(inv.tax_amount)],
              ["Total TTC", fmtCurrency(inv.total), true], ["Déjà réglé", fmtCurrency(inv.amount_paid)],
              ["Reste à payer", fmtCurrency(outstanding), true],
            ]}
          />
          {inv.status === "draft" && isWriter && !isApiEnabled() && <DraftActions inv={inv} onDone={onClose} />}
          <InvoicePayments inv={inv} canReverse={perms.has("ar.reverse_receipt")} />
          {!isApiEnabled() && <InvoiceCredits inv={inv} canApply={perms.has("ar.receipt")} />}
          <CreditNotesList invoiceId={inv.id} />
          <JournalEntryPreview entryId={(inv as any).journal_entry_id} />
        </div>
        <div className="p-4 border-t border-border flex items-center gap-2 flex-wrap">
          {!["draft", "cancelled"].includes(inv.status) && perms.has("ar.credit_note") && (
            <Button size="sm" variant="outline" className="text-xs gap-1.5" onClick={() => setCreditOpen(true)}>
              <FileText className="w-3.5 h-3.5" /> Créer un avoir
            </Button>
          )}
          <CreditNoteDialog inv={inv} open={creditOpen} onClose={() => setCreditOpen(false)} />
          {!["paid", "draft", "cancelled"].includes(inv.status) && perms.has("ar.receipt") && (
            <Button size="sm" className="text-xs gap-1.5" onClick={onRecordPayment}><CreditCard className="w-3.5 h-3.5" /> Enregistrer paiement</Button>
          )}
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
  const [statementOpen, setStatementOpen] = useState(false);
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const { data: letterings } = useARLetterings(invoices.filter((i) => i.status === "paid").map((i) => i.id).sort().join(","));
  const bulk = useBulkARDrafts();

  const statusOptions = ["all", "draft", "sent", "partially_paid", "paid", "overdue"];
  const { data: access } = useMyAccess();
  const canReceive = (access?.permissions ?? []).includes("ar.receipt");
  const isWriter = (access?.roles ?? []).some((r) => r === "admin" || r === "accountant");

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
          {isWriter && <Button size="sm" className="text-xs gap-1.5" onClick={() => setShowCreateInvoice(true)}><Plus className="w-3.5 h-3.5" /> Créer facture</Button>}
          {canReceive && <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={() => { setPaymentInv(null); setSettlementOpen(true); }}><CreditCard className="w-3.5 h-3.5" /> Encaissement client</Button>}
          {canReceive && !isApiEnabled() && <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={() => setAdvanceOpen(true)}><Receipt className="w-3.5 h-3.5" /> Acompte client</Button>}
          <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={() => setStatementOpen(true)}><BookOpen className="w-3.5 h-3.5" /> Relevé de compte</Button>
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

      {/* Actions groupées sur la sélection */}
      {selectedIds.size > 0 && (() => {
        const choix = invoices.filter((i) => selectedIds.has(i.id));
        const brouillons = choix.filter((i) => i.status === "draft").map((i) => i.id);
        return (
          <div className="flex flex-wrap items-center gap-2 mb-2 px-3 py-2 rounded-md border border-border bg-muted/30 text-xs" data-testid="ar-bulk-bar">
            <span className="font-medium">{choix.length} facture(s) sélectionnée(s)</span>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => exportToCSV(choix.map((i) => ({
              numero: i.invoice_number, client: i.customer?.name ?? "", date: i.invoice_date, echeance: i.due_date,
              ht: i.subtotal, tva: i.tax_amount, ttc: i.total, regle: i.amount_paid, reste: i.total - i.amount_paid, statut: statusLabel(i.status),
            })), [{ key: "numero", header: "N° facture" }, { key: "client", header: "Client" }, { key: "date", header: "Date" },
              { key: "echeance", header: "Échéance" }, { key: "ht", header: "HT" }, { key: "tva", header: "TVA" }, { key: "ttc", header: "TTC" },
              { key: "regle", header: "Réglé" }, { key: "reste", header: "Reste dû" }, { key: "statut", header: "Statut" }], "factures-clients-selection")}>
              Exporter la sélection
            </Button>
            {isWriter && !isApiEnabled() && brouillons.length > 0 && (
              <>
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={bulk.isPending}
                  onClick={() => { if (window.confirm(`Émettre ${brouillons.length} brouillon(s) ? Le numéro légal et l'écriture seront attribués.`)) bulk.mutate({ ids: brouillons, action: "emit" }, { onSuccess: () => setSelectedIds(new Set()) }); }}>
                  Émettre les brouillons ({brouillons.length})
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" disabled={bulk.isPending}
                  onClick={() => { if (window.confirm(`Supprimer ${brouillons.length} brouillon(s) ?`)) bulk.mutate({ ids: brouillons, action: "delete" }, { onSuccess: () => setSelectedIds(new Set()) }); }}>
                  Supprimer les brouillons ({brouillons.length})
                </Button>
              </>
            )}
            <span className="text-muted-foreground">Une facture émise se corrige par un avoir ; les encaissements se font par client (« Encaissement client »).</span>
            <Button size="sm" variant="ghost" className="h-7 text-xs ml-auto" onClick={() => setSelectedIds(new Set())}>Effacer la sélection</Button>
          </div>
        );
      })()}

      {/* Data Table */}
      <div className="card-elevated overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th className="w-10"><input type="checkbox" aria-label="Tout sélectionner" className="rounded border-input" checked={selectedIds.size === filtered.length && filtered.length > 0} onChange={toggleAll} /></th>
                <th>N° Facture</th>
                <th>Client</th>
                <th>Date</th>
                <th>Échéance</th>
                <th className="text-right">Total</th>
                <th className="text-right">Restant</th>
                <th>Statut</th>
                <th title="Code de lettrage : facture soldée et pièces qui la soldent">Lettrage</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={9} className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-8 text-muted-foreground">
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
                      <td className="font-mono text-xs text-muted-foreground" data-testid="ar-lettering">{letterings?.get(inv.id)?.code ?? ""}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Acomptes et crédits clients (V49) */}
      {!isApiEnabled() && (
        <div className="mt-6 rounded-md border border-border bg-card p-4">
          <CustomerCreditsList canRefund={(access?.permissions ?? []).includes("ar.refund")} />
        </div>
      )}

      {/* Avoirs clients (V45) */}
      <div className="mt-6 rounded-md border border-border bg-card p-4">
        <CreditNotesList title="Avoirs clients" />
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
      <CustomerStatementDialog open={statementOpen} onClose={() => setStatementOpen(false)} />
      <AdvanceDialog open={advanceOpen} onClose={() => setAdvanceOpen(false)} />

      {selectedInv && (
        <InvoicePanel
          // La facture à jour (après un encaissement, une imputation, un avoir), pas la copie du clic.
          inv={invoices.find((i) => i.id === selectedInv.id) ?? selectedInv}
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
