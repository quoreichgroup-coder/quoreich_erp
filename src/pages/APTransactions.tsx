import { exportToCSV } from "@/lib/csv-export";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
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
import { SettlementDialog } from "@/components/SettlementDialog";
import { DocumentDetail } from "@/components/DocumentDetail";
import { JournalEntryPreview } from "@/components/JournalEntryPreview";
import { APCreditNoteDialog, APCreditNotesList } from "@/components/SupplierReturns";
import { usePurchaseOrders } from "@/hooks/use-procurement-data";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GLPostingKPIsLive, GLBatchHistoryLive } from "@/hooks/use-gl-batches";
import { toast } from "sonner";
import {
  useAPInvoices, useCreateAPInvoice, useUpdateAPInvoice, useSuppliers,
  useAPInvoiceApprovals, useSubmitAPInvoice, useDecideAPInvoice, useDeleteAPInvoiceDraft,
  type APInvoice, type APInvoiceApproval,
} from "@/hooks/use-ap-data";
import { useAuth } from "@/contexts/AuthContext";
import { useMyAccess } from "@/hooks/use-my-access";

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
  const map: Record<string, string> = { draft: "Brouillon", pending: "Brouillon", submitted: "Soumise", approved: "Approuvée", rejected: "Rejetée" };
  return map[s] || s;
}
function approvalType(s: string) {
  const map: Record<string, string> = { draft: "info", pending: "info", submitted: "warning", approved: "success", rejected: "error" };
  return map[s] || "info";
}

/* ──────── CREATE INVOICE DIALOG ──────── */
function CreateInvoiceDialog({ open, onClose, edit }: { open: boolean; onClose: () => void; edit?: APInvoice }) {
  const { data: suppliers = [] } = useSuppliers();
  const { data: purchaseOrders = [] } = usePurchaseOrders();
  const createInvoice = useCreateAPInvoice();
  const updateInvoice = useUpdateAPInvoice();
  const [form, setForm] = useState({
    supplier_id: edit?.supplier_id ?? "",
    po_id: (edit as any)?.po_id ?? "",
    invoice_number: edit?.invoice_number ?? `BILL-${Date.now().toString(36).toUpperCase()}`,
    invoice_date: edit?.invoice_date ?? new Date().toISOString().split("T")[0],
    due_date: edit?.due_date ?? new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0],
    subtotal: edit ? String(edit.subtotal) : "",
    tax_amount: edit ? String(edit.tax_amount) : "0",
  });

  const subtotal = parseFloat(form.subtotal) || 0;
  const tax = parseFloat(form.tax_amount) || 0;
  const total = subtotal + tax;

  // Commandes du fournisseur choisi seulement (la base refuse une commande d'un autre, V36).
  const supplierOrders = (purchaseOrders as any[]).filter((p) => p.supplier_id === form.supplier_id
    && ["approved", "ordered", "partially_received", "received"].includes(p.status));

  const handleCreate = async () => {
    if (!form.supplier_id || subtotal <= 0) { toast.error("Remplissez tous les champs"); return; }
    try {
      if (edit) {
        // Brouillon ou facture rejetée seulement : la base refuse au-delà (V41).
        await updateInvoice.mutateAsync({ id: edit.id, ...form, po_id: form.po_id || null, subtotal, tax_amount: tax, total } as any);
      } else {
        await createInvoice.mutateAsync({ ...form, po_id: form.po_id || null, subtotal, tax_amount: tax, total });
      }
      onClose();
    } catch {
      // Le refus est déjà affiché par le hook (toast) ; le formulaire reste ouvert pour corriger.
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">{edit ? "Modifier la facture " + edit.invoice_number : "Nouvelle facture fournisseur"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Fournisseur *</Label>
            <select className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm" value={form.supplier_id} onChange={e => setForm(f => ({ ...f, supplier_id: e.target.value, po_id: "" }))}>
              <option value="">— Sélectionner —</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="ap-po">Commande d'origine</Label>
            <select id="ap-po" className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm" value={form.po_id}
              onChange={e => setForm(f => ({ ...f, po_id: e.target.value }))} disabled={!form.supplier_id}>
              <option value="">{form.supplier_id ? (supplierOrders.length ? "— Aucune —" : "Aucune commande de ce fournisseur") : "Choisissez d'abord le fournisseur"}</option>
              {supplierOrders.map((p) => <option key={p.id} value={p.id}>{p.po_number} · {p.order_date} · {Number(p.total).toLocaleString("fr-FR")} XOF</option>)}
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
            {createInvoice.isPending || updateInvoice.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : edit ? "Enregistrer" : "Créer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ──────── PAYMENT DIALOG ──────── */
/* ──────── SIDE PANEL ──────── */
function InvoicePanel({ inv, onClose, onCreatePayment }: { inv: APInvoice; onClose: () => void; onCreatePayment: () => void }) {
  const outstanding = inv.total - inv.amount_paid;
  const { data: access } = useMyAccess();
  const canPay = (access?.permissions ?? []).includes("ap.pay");
  const canCredit = (access?.permissions ?? []).includes("ap.credit_note");
  const [creditOpen, setCreditOpen] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={`Facture ${inv.invoice_number}`} className="w-full max-w-lg bg-card border-l border-border shadow-xl flex flex-col animate-in slide-in-from-right">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground">{inv.invoice_number}</p>
            <p className="text-xs text-muted-foreground">{inv.supplier?.name}</p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={approvalType(inv.approval_status)} label={approvalLabel(inv.approval_status)} />
            <button type="button" onClick={onClose} aria-label="Fermer" className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground"><X className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-5">
          <DocumentDetail
            header={[
              ["Fournisseur", inv.supplier?.name], ["Statut", `${statusLabel(inv.status)} · ${approvalLabel(inv.approval_status)}`],
              ["Date facture", inv.invoice_date], ["Échéance", inv.due_date],
            ]}
            columns={[{ label: "Libellé" }, { label: "Montant HT", align: "right" }]}
            rows={[]}
            emptyLines="Facture saisie en en-tête seul : les lignes de facture fournisseur arrivent au Lot 3 (étape 4, avec le rapprochement commande / réception)."
            footer={[
              ["Total HT", fmtCurrency(inv.subtotal)], ["TVA déductible", fmtCurrency(inv.tax_amount)],
              ["Total TTC", fmtCurrency(inv.total), true], ["Déjà payé", fmtCurrency(inv.amount_paid)],
              ["Reste à payer", fmtCurrency(outstanding), true],
            ]}
          />
          <JournalEntryPreview entryId={(inv as any).journal_entry_id} />
          <APCreditNotesList invoiceId={inv.id} title="Avoirs sur cette facture" />
        </div>
        <div className="p-4 border-t border-border flex items-center gap-2">
          {inv.status !== "paid" && inv.approval_status === "approved" && canPay && (
            <Button size="sm" className="text-xs gap-1.5" onClick={onCreatePayment}><CreditCard className="w-3.5 h-3.5" /> Payer</Button>
          )}
          {inv.approval_status === "approved" && canCredit && (
            <Button size="sm" variant="outline" className="text-xs" onClick={() => setCreditOpen(true)}>Créer un avoir</Button>
          )}
          <APCreditNoteDialog inv={inv} open={creditOpen} onClose={() => setCreditOpen(false)} />
        </div>
      </div>
    </div>
  );
}

/* ──────── CYCLE DE VIE (V41) ──────── */
// Brouillon / rejetée → Modifier, Soumettre, Supprimer ; soumise → niveau en cours, et pour un tiers
// habilité Approuver / Rejeter. La base applique paramètres, seuils, ordre et séparation des tâches.
function APInvoiceActions({ inv, approvals, onEdit }: { inv: APInvoice; approvals: APInvoiceApproval[]; onEdit: () => void }) {
  const { user } = useAuth();
  const { data: access } = useMyAccess();
  const submit = useSubmitAPInvoice();
  const decide = useDecideAPInvoice();
  const remove = useDeleteAPInvoiceDraft();
  const [rejet, setRejet] = useState(false);
  const [motif, setMotif] = useState("");
  const s = inv.approval_status;
  const isCreator = user?.id === inv.created_by;
  const pending = approvals.filter((a) => a.invoice_id === inv.id && a.status === "pending").sort((a, b) => a.level_order - b.level_order)[0];
  const dejaDecide = approvals.some((a) => a.invoice_id === inv.id && a.status === "approved" && a.decided_by === user?.id);
  const peutDecider = !!pending && !isCreator && !dejaDecide
    && (access?.permissions ?? []).includes(`ap.approve_l${Math.min(pending.level_order, 4)}`);
  const b = "h-7 text-[10px]";
  return (
    <>
      {(s === "draft" || s === "pending" || s === "rejected") && (
        <>
          <Button size="sm" variant="ghost" className={b} onClick={onEdit}>Modifier</Button>
          <Button size="sm" variant="outline" className={b} disabled={submit.isPending} onClick={() => submit.mutate(inv.id)}>Soumettre</Button>
          <Button size="sm" variant="ghost" className={`${b} text-destructive`} disabled={remove.isPending}
            onClick={() => { if (window.confirm("Supprimer cette facture ?")) remove.mutate(inv.id); }}>Supprimer</Button>
        </>
      )}
      {s === "submitted" && pending && (
        <>
          <span className="text-[10px] text-muted-foreground" data-testid="ap-approval-level">
            {pending.level_label}{isCreator ? " · vous êtes l'auteur" : ""}
          </span>
          {peutDecider && (
            <>
              <Button size="sm" variant="outline" className={`${b} text-success`} disabled={decide.isPending}
                onClick={() => decide.mutate({ approvalId: pending.id, approve: true })}>
                <CheckCircle className="w-3 h-3 mr-1" /> Approuver
              </Button>
              <Button size="sm" variant="ghost" className={`${b} text-destructive`} onClick={() => { setMotif(""); setRejet(true); }}>Rejeter</Button>
            </>
          )}
        </>
      )}
      <Dialog open={rejet} onOpenChange={setRejet}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-sm">Rejeter la facture {inv.invoice_number}</DialogTitle></DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="ap-reject-reason">Motif (obligatoire)</Label>
            <Input id="ap-reject-reason" value={motif} onChange={(e) => setMotif(e.target.value)} />
          </div>
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setRejet(false)}>Retour</Button>
            <Button size="sm" variant="destructive" disabled={!motif.trim() || decide.isPending}
              onClick={() => pending && decide.mutate({ approvalId: pending.id, approve: false, comment: motif.trim() }, { onSuccess: () => setRejet(false) })}>
              Rejeter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ──────── MAIN ──────── */
/* ──────── RÈGLEMENTS (onglet) ──────── */
const METHOD_LABELS: Record<string, string> = { bank_transfer: "Virement", cash: "Espèces", check: "Chèque", mobile_money: "Mobile money" };

function PaymentsTab({ onOpenInvoice }: { onOpenInvoice: (invoiceId: string) => void }) {
  const qc = useQueryClient();
  const { data: access } = useMyAccess();
  const canReverse = (access?.permissions ?? []).includes("ap.reverse_payment");
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState<any | null>(null);
  const [reason, setReason] = useState("");
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["ap-payments", "all"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("payments")
        .select("id, payment_date, amount, payment_method, reference, reversal_of, reversal_reason, ap_invoice_id, invoice:ap_invoices(invoice_number, supplier:suppliers(name))")
        .eq("payment_type", "ap_payment").order("payment_date", { ascending: false }).order("created_at", { ascending: false }).limit(1000);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  // Annulation d'un paiement : contre-passation motivée (V42, droit ap.reverse_payment).
  const reverse = useMutation({
    mutationFn: async ({ id, motif }: { id: string; motif: string }) => {
      const { error } = await (supabase as any).rpc("reverse_settlement", { _payment_id: id, _reason: motif, _reversal_date: new Date().toISOString().split("T")[0] });
      if (error) throw error;
    },
    onSuccess: () => {
      for (const k of ["ap-payments", "ap-invoices"]) qc.invalidateQueries({ queryKey: [k] });
      toast.success("Paiement annulé (écriture contre-passée)");
      setTarget(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const reversed = new Set(rows.filter((r) => r.reversal_of).map((r) => r.reversal_of));
  const q = search.trim().toLowerCase();
  const shown = rows.filter((r) => !q || `${r.reference ?? ""} ${r.invoice?.invoice_number ?? ""} ${r.invoice?.supplier?.name ?? ""}`.toLowerCase().includes(q));
  const total = shown.reduce((t, r) => t + Number(r.amount), 0);
  return (
    <div className="space-y-3">
      <div className="card-elevated p-3 flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" aria-label="Rechercher un paiement" placeholder="Rechercher par référence, facture ou fournisseur..."
            className="w-full h-9 pl-9 pr-3 rounded-md border border-input bg-background text-sm" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={() => exportToCSV(shown.map((r) => ({
          date: r.payment_date, reference: r.reference ?? "", fournisseur: r.invoice?.supplier?.name ?? "", facture: r.invoice?.invoice_number ?? "",
          montant: Number(r.amount), mode: METHOD_LABELS[r.payment_method] ?? r.payment_method,
          etat: r.reversal_of ? "Annulation" : reversed.has(r.id) ? "Annulé" : "Enregistré",
        })), [{ key: "date", header: "Date" }, { key: "reference", header: "Référence" }, { key: "fournisseur", header: "Fournisseur" },
          { key: "facture", header: "Facture" }, { key: "montant", header: "Montant" }, { key: "mode", header: "Mode" }, { key: "etat", header: "État" }], "paiements-fournisseurs")}>
          <Download className="w-3.5 h-3.5" /> Export
        </Button>
        <span className="text-xs text-muted-foreground ml-auto tabular-nums">{shown.length} paiements · Net : {fmtCurrency(total)}</span>
      </div>
      <div className="card-elevated overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>Date</th><th>Référence</th><th>Fournisseur</th><th>Facture</th><th>Mode</th><th className="text-right">Montant</th><th>État</th><th /></tr></thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={8} className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" /></td></tr>
              ) : shown.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-8 text-muted-foreground">Aucun paiement</td></tr>
              ) : shown.map((r) => (
                <tr key={r.id} data-testid="ap-payment-row" className="cursor-pointer" title="Ouvrir la facture" onClick={() => r.ap_invoice_id && onOpenInvoice(r.ap_invoice_id)}>
                  <td className="tabular-nums">{r.payment_date}</td>
                  <td>{r.reference || "—"}</td>
                  <td>{r.invoice?.supplier?.name ?? "—"}</td>
                  <td className="font-mono">{r.invoice?.invoice_number ?? "—"}</td>
                  <td>{METHOD_LABELS[r.payment_method] ?? r.payment_method}</td>
                  <td className={cn("text-right tabular-nums", Number(r.amount) < 0 && "text-destructive")}>{fmt(Number(r.amount))}</td>
                  <td className="text-xs text-muted-foreground">{r.reversal_of ? `Annulation${r.reversal_reason ? ` · ${r.reversal_reason}` : ""}` : reversed.has(r.id) ? "Annulé" : "Enregistré"}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {canReverse && !r.reversal_of && !reversed.has(r.id) && (
                      <Button size="sm" variant="ghost" className="h-6 text-[10px] text-destructive" onClick={() => { setTarget(r); setReason(""); }}>Annuler</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Dialog open={!!target} onOpenChange={(o) => { if (!o) setTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-sm">Annuler le paiement {target?.reference || ""}</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">L'écriture fournisseur / banque est contre-passée et la facture redevient à payer. Le paiement d'origine reste visible.</p>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="ap-reversal-reason">Motif (obligatoire)</Label>
            <Input id="ap-reversal-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setTarget(null)}>Retour</Button>
            <Button size="sm" variant="destructive" disabled={!reason.trim() || reverse.isPending}
              onClick={() => target && reverse.mutate({ id: target.id, motif: reason.trim() })}>Annuler le paiement</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ──────── APPROBATIONS (onglet) : factures soumises, niveau en cours, historique ──────── */
function ApprovalsTab({ invoices, approvals, onOpenInvoice, onEdit }: {
  invoices: APInvoice[]; approvals: APInvoiceApproval[]; onOpenInvoice: (inv: APInvoice) => void; onEdit: (inv: APInvoice) => void;
}) {
  const soumises = invoices.filter((i) => i.approval_status === "submitted");
  const byId = new Map(invoices.map((i) => [i.id, i]));
  const decisions = approvals.filter((a) => a.status === "approved" || a.status === "rejected")
    .sort((a, b) => String(b.decided_at ?? "").localeCompare(String(a.decided_at ?? ""))).slice(0, 50);
  const STATUT: Record<string, string> = { approved: "Approuvé", rejected: "Rejeté" };
  return (
    <div className="space-y-4">
      <div className="card-elevated overflow-hidden">
        <div className="px-4 py-2 border-b border-border text-xs font-semibold">À approuver ({soumises.length})</div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>Facture</th><th>Fournisseur</th><th>Date</th><th className="text-right">TTC</th><th>Niveau et actions</th></tr></thead>
            <tbody>
              {soumises.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-6 text-muted-foreground">Aucune facture en attente d'approbation</td></tr>
              ) : soumises.map((inv) => (
                <tr key={inv.id} data-testid="ap-approval-row" className="cursor-pointer" onClick={() => onOpenInvoice(inv)}>
                  <td className="font-mono">{inv.invoice_number}</td>
                  <td>{inv.supplier?.name ?? "—"}</td>
                  <td className="tabular-nums">{inv.invoice_date}</td>
                  <td className="text-right tabular-nums">{fmt(inv.total)}</td>
                  <td onClick={(e) => e.stopPropagation()}><div className="flex items-center gap-1"><APInvoiceActions inv={inv} approvals={approvals} onEdit={() => onEdit(inv)} /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card-elevated overflow-hidden">
        <div className="px-4 py-2 border-b border-border text-xs font-semibold">Dernières décisions</div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>Facture</th><th>Niveau</th><th>Décision</th><th>Date</th><th>Commentaire</th></tr></thead>
            <tbody>
              {decisions.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-6 text-muted-foreground">Aucune décision enregistrée</td></tr>
              ) : decisions.map((a) => (
                <tr key={a.id}>
                  <td className="font-mono">{byId.get(a.invoice_id)?.invoice_number ?? "—"}</td>
                  <td>{a.level_label}</td>
                  <td>{STATUT[a.status] ?? a.status}</td>
                  <td className="tabular-nums">{a.decided_at ? String(a.decided_at).slice(0, 10) : "—"}</td>
                  <td className="text-muted-foreground">{a.comment ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function APTransactions() {
  const { data: invoices = [], isLoading } = useAPInvoices();
  const { data: suppliers = [] } = useSuppliers();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [approvalFilter, setApprovalFilter] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [selectedInv, setSelectedInv] = useState<APInvoice | null>(null);
  const [settlementOpen, setSettlementOpen] = useState(false);
  const [paymentInv, setPaymentInv] = useState<APInvoice | null>(null);
  const [showCreateInvoice, setShowCreateInvoice] = useState(false);
  const [editInv, setEditInv] = useState<APInvoice | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const TABS = ["invoices", "payments", "credit-notes", "approvals", "posting"];
  const tab = TABS.includes(searchParams.get("tab") ?? "") ? searchParams.get("tab")! : "invoices";
  const { data: approvals = [] } = useAPInvoiceApprovals();
  const { data: myAccess } = useMyAccess();
  // V42 : un paiement demande le droit ap.pay (contrôlé en base).
  const canPay = (myAccess?.permissions ?? []).includes("ap.pay");

  const statusOptions = ["all", "draft", "open", "partially_paid", "paid", "overdue"];
  const approvalOptions = ["all", "pending", "approved", "rejected"];

  const filtered = invoices.filter(inv => {
    if (statusFilter !== "all" && inv.status !== statusFilter) return false;
    if (approvalFilter !== "all" && inv.approval_status !== approvalFilter) return false;
    if (search && !inv.invoice_number.toLowerCase().includes(search.toLowerCase()) && !(inv.supplier?.name || "").toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const totalPayable = filtered.filter(i => i.status !== "paid").reduce((s, i) => s + (i.total - i.amount_paid), 0);


  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Achats et fournisseurs", href: "/" }, { label: "Comptes fournisseurs", href: "/payables" }, { label: "Transactions" }]} />

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Comptes fournisseurs — Transactions</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Factures fournisseurs, règlements, approbations, comptabilisation</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" className="text-xs gap-1.5" onClick={() => setShowCreateInvoice(true)}><Plus className="w-3.5 h-3.5" /> Nouvelle facture fournisseur</Button>
          {canPay && <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={() => { setPaymentInv(null); setSettlementOpen(true); }}><CreditCard className="w-3.5 h-3.5" /> Règlement fournisseur</Button>}
          <Button variant="outline" size="sm" className="text-xs gap-1.5" data-testid="btn-export-csv" onClick={() => exportToCSV(
            filtered.map(i => ({ numero: i.invoice_number, fournisseur: i.supplier?.name ?? "", date: i.invoice_date, echeance: i.due_date,
              ht: i.subtotal, tva: i.tax_amount, ttc: i.total, paye: i.amount_paid, reste: i.total - i.amount_paid, statut: i.status, approbation: i.approval_status })),
            [{ key: "numero", header: "N° facture" }, { key: "fournisseur", header: "Fournisseur" }, { key: "date", header: "Date" }, { key: "echeance", header: "Échéance" },
             { key: "ht", header: "HT" }, { key: "tva", header: "TVA" }, { key: "ttc", header: "TTC" }, { key: "paye", header: "Payé" }, { key: "reste", header: "Reste" },
             { key: "statut", header: "Statut" }, { key: "approbation", header: "Approbation" }], "factures-fournisseurs")}><Download className="w-3.5 h-3.5" /> Export</Button>
        </div>
      </div>

      {/* KPI Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Reste à payer", value: fmtCurrency(totalPayable), color: "text-foreground" },
          { label: "En attente d'approbation", value: invoices.filter(i => i.approval_status === "submitted").length.toString(), color: "text-amber-600" },
          { label: "Approuvées", value: invoices.filter(i => i.approval_status === "approved").length.toString(), color: "text-success" },
          { label: "Réglées", value: invoices.filter(i => i.status === "paid").length.toString(), color: "text-primary" },
        ].map(k => (
          <div key={k.label} className="bg-card rounded-lg border border-border p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{k.label}</p>
            <p className={cn("text-xl font-semibold tabular-nums mt-1", k.color)}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Une pièce par onglet, comme Approvisionnement (standard de présentation des modules). */}
      <Tabs value={tab} onValueChange={(v) => setSearchParams((sp) => { sp.set("tab", v); return sp; }, { replace: true })}>
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="invoices">Factures ({invoices.length})</TabsTrigger>
          <TabsTrigger value="payments">Règlements</TabsTrigger>
          <TabsTrigger value="credit-notes">Avoirs</TabsTrigger>
          <TabsTrigger value="approvals">Approbations ({invoices.filter((i) => i.approval_status === "submitted").length})</TabsTrigger>
          <TabsTrigger value="posting">Comptabilisation</TabsTrigger>
        </TabsList>

        <TabsContent value="invoices" className="space-y-3">
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
                          <APInvoiceActions inv={inv} approvals={approvals} onEdit={() => setEditInv(inv)} />
                          {inv.approval_status === "approved" && inv.status !== "paid" && canPay && (
                            <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => { setPaymentInv(inv); setSettlementOpen(true); }}>
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

        </TabsContent>

        <TabsContent value="payments">
          <PaymentsTab onOpenInvoice={(id) => { const inv = invoices.find((i) => i.id === id); if (inv) setSelectedInv(inv); }} />
        </TabsContent>

        <TabsContent value="credit-notes">
          <div className="rounded-md border border-border bg-card p-4">
            <APCreditNotesList />
          </div>
        </TabsContent>

        <TabsContent value="approvals">
          <ApprovalsTab invoices={invoices} approvals={approvals} onOpenInvoice={setSelectedInv} onEdit={setEditInv} />
        </TabsContent>

        <TabsContent value="posting" className="space-y-4">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Comptabilisation — journaux et lots des comptes fournisseurs</h2>
          </div>
          <GLPostingKPIsLive module="AP" />
          <GLBatchHistoryLive module="AP" />
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <CreateInvoiceDialog open={showCreateInvoice} onClose={() => setShowCreateInvoice(false)} />
      {editInv && <CreateInvoiceDialog open edit={editInv} onClose={() => setEditInv(null)} />}

      {selectedInv && (
        <InvoicePanel
          inv={invoices.find((i) => i.id === selectedInv.id) ?? selectedInv}
          onClose={() => setSelectedInv(null)}
          onCreatePayment={() => { setPaymentInv(selectedInv); setSettlementOpen(true); setSelectedInv(null); }}
        />
      )}

      <SettlementDialog
        kind="ap"
        open={settlementOpen}
        onClose={() => { setSettlementOpen(false); setPaymentInv(null); }}
        parties={suppliers}
        invoices={invoices}
        initialPartyId={paymentInv?.supplier_id}
        initialInvoiceId={paymentInv?.id}
      />
    </PageShell>
  );
}
