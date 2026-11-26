import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, type MobileTableColumn } from "@/components/ui/table";
import { PageHeader } from "@/components/PageHeader";
import { DocumentDrawer } from "@/components/DocumentDrawer";
import { currencyChoices, useBaseCurrency, useExchangeRates } from "@/hooks/use-exchange-rates";
import { useEffect, useMemo, useRef, useState } from "react";
import { ExportMenu } from "@/components/ExportMenu";
import { exportTable, type ExportFormat } from "@/lib/table-export";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
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
import { DocumentDetail, documentFileName } from "@/components/DocumentDetail";
import { DocumentEditions } from "@/components/DocumentEditions";
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
import { apiDownloadCsv, apiGet, isApiEnabled } from "@/api/client";
import { exportToCSV } from "@/lib/csv-export";
import { AnalyticSelectors } from "@/components/AnalyticSelectors";
import { useAnalyticsSetup, useCustomerAnalyticDefaults } from "@/hooks/use-analytics-setup";
import { useAccountingSetup } from "@/hooks/use-accounting-setup";
import { requiredAxisIds } from "@/lib/analytics-setup";
import { useTaxCodes } from "@/hooks/use-tax-codes";
import { emptyLine, invoiceTotals, type DraftLine } from "@/lib/invoice-lines";
import { CommercialLinesEditor, CommercialTotals } from "@/components/CommercialLinesEditor";


const financeMobileColumns = {
  "invoices": [
    {
      "label": "Sélection",
      "kind": "selection"
    },
    {
      "label": "N° facture",
      "kind": "primary"
    },
    {
      "label": "Client",
      "wide": true
    },
    {
      "label": "Date"
    },
    {
      "label": "Échéance"
    },
    {
      "label": "Total"
    },
    {
      "label": "Restant"
    },
    {
      "label": "Statut"
    },
    {
      "label": "Lettrage"
    }
  ],
  "receipts": [
    {
      "label": "Date"
    },
    {
      "label": "Référence",
      "kind": "primary"
    },
    {
      "label": "Client",
      "wide": true
    },
    {
      "label": "Facture",
      "wide": true
    },
    {
      "label": "Mode"
    },
    {
      "label": "Montant"
    },
    {
      "label": "État",
      "wide": true
    }
  ]
} satisfies Record<string, MobileTableColumn[]>;

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
function CreateInvoiceDialog({ open, onClose, returnFocusRef }: { open: boolean; onClose: () => void; returnFocusRef?: React.RefObject<HTMLButtonElement | null> }) {
  const { data: customers = [] } = useCustomers();
  const createInvoice = useCreateARInvoice();
  const baseCurrency = useBaseCurrency();
  const { data: rates = [] } = useExchangeRates();
  const currencies = currencyChoices(baseCurrency, rates);
  const [form, setForm] = useState({
    currency: "",
    exchange_rate: "",
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
    const foreign = Boolean(form.currency) && form.currency !== baseCurrency;
    const rateN = form.exchange_rate === "" ? null : Number(form.exchange_rate.replace(",", "."));
    if (foreign && rateN != null && (!Number.isFinite(rateN) || rateN <= 0)) { toast.error("Cours de la facture invalide"); return; }
    const missing = (analyticsSetup.data?.axes ?? []).filter((a) => required.has(a.id) && !analytics[a.id]);
    if (missing.length > 0) {
      toast.error(`Section obligatoire sur le compte de ventes ${salesAccount} : ${missing.map((a) => a.name).join(", ")}`);
      return;
    }
    try {
      const { currency: _c, exchange_rate: _r, ...header } = form;
      await createInvoice.mutateAsync({
        ...header, subtotal, tax_amount: tax, total, analytics,
        currency: foreign ? form.currency : null, exchange_rate: foreign ? rateN : null,
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
      <DialogContent returnFocusRef={returnFocusRef} className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-sm">Nouvelle facture AR</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ar-invoice-field-1" className="text-xs">Client *</Label>
            <select id="ar-invoice-field-1" className="w-full h-11 sm:h-9 px-3 rounded-md border border-input bg-background text-sm" value={form.customer_id} onChange={e => {
              const id = e.target.value;
              // Échéance = date de facture + conditions de paiement du client (modifiable).
              const terms = Number(customers.find(c => c.id === id)?.payment_terms ?? 30) || 30;
              setForm(f => ({ ...f, customer_id: id, due_date: addDays(f.invoice_date, terms) }));
            }}>
              <option value="">— Sélectionner —</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="invoice-number">N° Facture</Label>
              <Input id="invoice-number" className="h-11 sm:h-8 text-base sm:text-xs" placeholder="Attribué à l'émission" value={form.invoice_number} onChange={e => setForm(f => ({ ...f, invoice_number: e.target.value }))} />
              <p className="text-[11px] text-muted-foreground">En numérotation automatique, la série de la société fixe le numéro à l'émission.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ar-invoice-field-2" className="text-xs">Date</Label>
              <Input id="ar-invoice-field-2" type="date" className="h-11 sm:h-8 text-base sm:text-xs" value={form.invoice_date} onChange={e => setForm(f => ({ ...f, invoice_date: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ar-invoice-field-3" className="text-xs">Échéance</Label>
              <Input id="ar-invoice-field-3" type="date" className="h-11 sm:h-8 text-base sm:text-xs" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="ar-invoice-currency">
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="ar-currency">Devise</Label>
              <select id="ar-currency" className="w-full h-11 sm:h-8 px-2 rounded-md border border-input bg-background text-base sm:text-xs"
                value={form.currency || baseCurrency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value === baseCurrency ? "" : e.target.value }))}>
                {currencies.map((c) => <option key={c} value={c}>{c === baseCurrency ? `${c} (devise de la société)` : c}</option>)}
              </select>
            </div>
            {form.currency && form.currency !== baseCurrency && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs" htmlFor="ar-rate">Cours (1 {form.currency} en {baseCurrency})</Label>
                  <Input id="ar-rate" inputMode="decimal" className="h-11 sm:h-8 text-base sm:text-xs text-right" placeholder="vide = cours du jour de la facture"
                    value={form.exchange_rate} onChange={(e) => setForm((f) => ({ ...f, exchange_rate: e.target.value }))} />
                </div>
                <p className="col-span-1 sm:col-span-2 text-[11px] text-muted-foreground self-end">Prix saisis en {form.currency} ; chaque ligne est convertie en {baseCurrency} au
                  cours de la facture, figé à l'émission. La créance est suivie en {baseCurrency} et en {form.currency}.</p>
              </>
            )}
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

function InvoicePanel({ inv, onClose, onRecordPayment, returnFocusRef }: { inv: ARInvoice; onClose: () => void; onRecordPayment: () => void; returnFocusRef: React.RefObject<HTMLButtonElement | null> }) {
  const outstanding = inv.total - inv.amount_paid;
  const lines = useARInvoiceLines(inv.id);
  const { data: access } = useMyAccess();
  const perms = new Set(access?.permissions ?? []);
  const isWriter = (access?.permissions ?? []).includes("ar.invoice");
  const [creditOpen, setCreditOpen] = useState(false);
  const creditTrigger = useRef<HTMLButtonElement | null>(null);

  return (
    <DocumentDrawer title={`Facture ${inv.invoice_number}`} description={inv.customer?.name} status={<StatusBadge status={statusType(inv.status)} label={statusLabel(inv.status)} />} onClose={onClose} returnFocusRef={returnFocusRef} footer={<>

          {!["draft", "cancelled"].includes(inv.status) && perms.has("ar.credit_note") && (
            <Button ref={creditTrigger} size="sm" variant="outline" className="text-xs gap-1.5" onClick={() => setCreditOpen(true)}>
              <FileText className="w-3.5 h-3.5" /> Créer un avoir
            </Button>
          )}
          <CreditNoteDialog inv={inv} open={creditOpen} onClose={() => setCreditOpen(false)} returnFocusRef={creditTrigger} />
          {!["paid", "draft", "cancelled"].includes(inv.status) && perms.has("ar.receipt") && (
            <Button size="sm" className="text-xs gap-1.5" onClick={onRecordPayment}><CreditCard className="w-3.5 h-3.5" /> Enregistrer paiement</Button>
          )}

        </>}>

          <DocumentDetail
            title={inv.status === "draft" ? `Facture (brouillon) ${inv.invoice_number}` : `Facture ${inv.invoice_number}`}
            attachments={{ docType: "ar_invoice", docId: inv.id }}
            fileName={documentFileName(`facture-${inv.invoice_number}`)}
            print={{ currency: (inv as any).currency ?? "XOF",
              notes: (inv as any).customer?.payment_terms ? `Conditions de paiement : ${(inv as any).customer.payment_terms} jours à compter de la date de facture.` : null }}
            header={[
              ["Client", inv.customer?.name], ["Statut", statusLabel(inv.status)],
              ["Adresse du client", (inv as any).customer?.address ?? "—"], ["IFU / NIF du client", (inv as any).customer?.tax_id ?? "—"],
              ["Date facture", inv.invoice_date], ["Échéance", inv.due_date],
              ...((inv as any).currency ? [["Devise et cours", `${(inv as any).currency} · 1 ${(inv as any).currency} = ${Number((inv as any).exchange_rate).toLocaleString("fr-FR", { maximumFractionDigits: 6 })} XOF`] as [string, string]] : []),
            ]}
            columns={[{ label: "Libellé" }, { label: "Qté", align: "right" }, { label: (inv as any).currency ? `P.U. (${(inv as any).currency})` : "P.U.", align: "right" },
              { label: "Remise", align: "right" }, { label: "TVA", align: "right" }, { label: "Montant HT", align: "right" }]}
            rows={(lines.data ?? []).map((l) => [l.description, fmtNum(l.quantity), fmtNum((inv as any).currency && (l as any).fx_unit_price != null ? (l as any).fx_unit_price : l.unit_price),
              l.discount_pct ? `${fmtNum(l.discount_pct)} %` : "", l.tax_code ?? "—", fmtNum(l.net_amount)])}
            emptyLines={lines.isLoading ? "Chargement des lignes…" : "Facture sans lignes (saisie en en-tête seul)."}
            footer={[
              ["Total HT", fmtCurrency(inv.subtotal)], ["TVA", fmtCurrency(inv.tax_amount)],
              ["Total TTC", fmtCurrency(inv.total), true],
              ...((inv as any).currency ? [[`Total TTC en ${(inv as any).currency}`, `${fmtNum(Number((inv as any).fx_total))} ${(inv as any).currency}`, true] as [string, string, boolean],
                [`Reste à payer en ${(inv as any).currency}`, `${fmtNum(Math.round(outstanding / Number((inv as any).exchange_rate) * 100) / 100)} ${(inv as any).currency}`] as [string, string]] : []),
              ["Déjà réglé", fmtCurrency(inv.amount_paid)],
              ["Reste à payer", fmtCurrency(outstanding), true],
            ]}
          />
          {!["draft", "cancelled"].includes(inv.status) && <DocumentEditions key={inv.id} invoiceId={inv.id} canIssue={isWriter} />}
          {inv.status === "draft" && isWriter && <DraftActions inv={inv} onDone={onClose} />}
          <InvoicePayments inv={inv} canReverse={perms.has("ar.reverse_receipt")} />
          {<InvoiceCredits inv={inv} canApply={perms.has("ar.receipt")} />}
          <CreditNotesList invoiceId={inv.id} />
          <JournalEntryPreview entryId={(inv as any).journal_entry_id} />

      </DocumentDrawer>
  );
}

/* ──────── ENCAISSEMENTS (onglet) ──────── */
const METHOD_LABELS: Record<string, string> = { bank_transfer: "Virement", cash: "Espèces", check: "Chèque", mobile_money: "Mobile money" };

function ReceiptsTab({ onOpenInvoice }: { onOpenInvoice: (invoiceId: string, trigger?: HTMLButtonElement) => void }) {
  const [search, setSearch] = useState("");
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["ar-payments", "all-receipts"],
    queryFn: async () => {
      if (isApiEnabled()) return apiGet<any[]>("/api/v1/ar/receipts");
      const { data, error } = await (supabase as any).from("payments")
        .select("id, payment_date, amount, payment_method, reference, reversal_of, reversal_reason, ar_invoice_id, invoice:ar_invoices(invoice_number, customer:customers(name))")
        .eq("payment_type", "ar_receipt").order("payment_date", { ascending: false }).order("created_at", { ascending: false }).limit(1000);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  const reversed = new Set(rows.filter((r) => r.reversal_of).map((r) => r.reversal_of));
  const q = search.trim().toLowerCase();
  const shown = rows.filter((r) => !q || `${r.reference ?? ""} ${r.invoice?.invoice_number ?? ""} ${r.invoice?.customer?.name ?? ""}`.toLowerCase().includes(q));
  const total = shown.reduce((s2, r) => s2 + Number(r.amount), 0);
  return (
    <div className="space-y-3">
      <div className="card-elevated p-3 flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-0 basis-60">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" aria-label="Rechercher un encaissement" placeholder="Rechercher par référence, facture ou client..."
            className="w-full h-9 pl-9 pr-3 rounded-md border border-input bg-background text-sm" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <ExportMenu variant="outline" size="sm" className="text-xs gap-1.5" onPick={(f) => exportTable(f, shown.map((r) => ({
          date: r.payment_date, reference: r.reference ?? "", client: r.invoice?.customer?.name ?? "", facture: r.invoice?.invoice_number ?? "",
          montant: Number(r.amount), mode: METHOD_LABELS[r.payment_method] ?? r.payment_method,
          etat: r.reversal_of ? "Annulation" : reversed.has(r.id) ? "Annulé" : "Enregistré",
        })), [{ key: "date", header: "Date" }, { key: "reference", header: "Référence" }, { key: "client", header: "Client" },
          { key: "facture", header: "Facture" }, { key: "montant", header: "Montant" }, { key: "mode", header: "Mode" }, { key: "etat", header: "État" }], "encaissements-clients")}>
          <Download className="w-3.5 h-3.5" /> Exporter
        </ExportMenu>
        <span className="text-xs text-muted-foreground ml-auto tabular-nums">{shown.length} encaissements · Net : {fmtCurrency(total)}</span>
      </div>
      <div className="card-elevated overflow-hidden">
        <div className="overflow-x-auto">
          <Table className="data-table" mobileColumns={financeMobileColumns.receipts} aria-label="Encaissements clients">
            <TableHeader><TableRow><TableHead className="h-auto bg-muted/50 py-2.5 text-xs uppercase tracking-wider max-md:normal-case">Date</TableHead><TableHead className="h-auto bg-muted/50 py-2.5 text-xs uppercase tracking-wider max-md:normal-case">Référence</TableHead><TableHead className="h-auto bg-muted/50 py-2.5 text-xs uppercase tracking-wider max-md:normal-case">Client</TableHead><TableHead className="h-auto bg-muted/50 py-2.5 text-xs uppercase tracking-wider max-md:normal-case">Facture</TableHead><TableHead className="h-auto bg-muted/50 py-2.5 text-xs uppercase tracking-wider max-md:normal-case">Mode</TableHead><TableHead className="h-auto bg-muted/50 py-2.5 text-xs uppercase tracking-wider max-md:normal-case text-right">Montant</TableHead><TableHead className="h-auto bg-muted/50 py-2.5 text-xs uppercase tracking-wider max-md:normal-case">État</TableHead></TableRow></TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="max-md:border-b-0 px-4 py-2.5 text-center py-8"><Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" /></TableCell></TableRow>
              ) : shown.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="max-md:border-b-0 px-4 py-2.5 text-center py-8 text-muted-foreground">Aucun encaissement</TableCell></TableRow>
              ) : shown.map((r) => (
                <TableRow key={r.id} data-testid="receipt-row" className="cursor-pointer" title="Ouvrir la facture" onClick={() => r.ar_invoice_id && onOpenInvoice(r.ar_invoice_id)}>
                  <TableCell className="max-md:border-b-0 px-4 py-2.5 tabular-nums md:whitespace-nowrap">{r.payment_date}</TableCell>
                  <TableCell className="max-md:border-b-0 px-4 py-2.5 md:whitespace-nowrap">{r.reference || "—"}</TableCell>
                  <TableCell className="max-md:border-b-0 px-4 py-2.5"><span className="block md:max-w-64 md:truncate" title={r.invoice?.customer?.name ?? "—"}>{r.invoice?.customer?.name ?? "—"}</span></TableCell>
                  <TableCell className="max-md:border-b-0 px-4 py-2.5 font-mono"><Button type="button" variant="link" disabled={!r.ar_invoice_id} className="h-auto min-h-11 max-w-full md:min-h-0 md:whitespace-nowrap whitespace-normal break-words p-0 text-left font-mono" onClick={event => { event.stopPropagation(); if (r.ar_invoice_id) onOpenInvoice(r.ar_invoice_id, event.currentTarget); }}>{r.invoice?.invoice_number ?? "—"}</Button></TableCell>
                  <TableCell className="max-md:border-b-0 px-4 py-2.5">{METHOD_LABELS[r.payment_method] ?? r.payment_method}</TableCell>
                  <TableCell className={cn("max-md:border-b-0 px-4 py-2.5", cn("text-right tabular-nums", Number(r.amount) < 0 && "text-destructive"))}>{fmt(Number(r.amount))}</TableCell>
                  <TableCell className="max-md:border-b-0 px-4 py-2.5 text-xs text-muted-foreground">{r.reversal_of ? `Annulation${r.reversal_reason ? ` · ${r.reversal_reason}` : ""}` : reversed.has(r.id) ? "Annulé" : "Enregistré"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

/* ──────── MAIN ──────── */
export default function ARTransactions() {
  const invoiceTrigger = useRef<HTMLButtonElement | null>(null);
  const createTrigger = useRef<HTMLButtonElement | null>(null);
  const settlementTrigger = useRef<HTMLButtonElement | null>(null);
  const advanceTrigger = useRef<HTMLButtonElement | null>(null);
  const openInvoice = (inv: ARInvoice, trigger: HTMLButtonElement | null = null) => { invoiceTrigger.current = trigger; setSelectedInv(inv); };
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
  const [searchParams, setSearchParams] = useSearchParams();
  const TABS = ["invoices", "receipts", "credit-notes", "credits", "posting"];
  const tab = TABS.includes(searchParams.get("tab") ?? "") ? searchParams.get("tab")! : "invoices";
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const { data: letterings } = useARLetterings(invoices.filter((i) => i.status === "paid").map((i) => i.id).sort().join(","));
  const bulk = useBulkARDrafts();

  const statusOptions = ["all", "draft", "sent", "partially_paid", "paid", "overdue"];
  const { data: access } = useMyAccess();
  const canReceive = (access?.permissions ?? []).includes("ar.receipt");
  const isWriter = (access?.permissions ?? []).includes("ar.invoice");

  const filtered = invoices.filter(inv => {
    if (statusFilter !== "all" && inv.status !== statusFilter) return false;
    if (search && !inv.invoice_number.toLowerCase().includes(search.toLowerCase()) && !(inv.customer?.name || "").toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Avec l'API, l'export est celui du serveur (périmètre société garanti côté serveur, AR-REC) :
  // il couvre toutes les factures visibles, pas seulement le filtre affiché. Sans API, on
  // exporte les lignes filtrées déjà chargées.
  const handleExport = async (f: ExportFormat = "csv") => {
    try {
      if (isApiEnabled() && f === "csv") {
        await apiDownloadCsv("/api/v1/ar/invoices/export", "factures-clients.csv");
        return;
      }
      exportTable(f,
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
      <Breadcrumb items={[{ label: "Ventes et clients", href: "/" }, { label: "Comptes clients", href: "/receivables" }, { label: "Transactions" }]} />

      <PageHeader title="Comptes clients — Transactions" description="Factures, encaissements, avoirs, acomptes et crédits clients, comptabilisation" actions={<>
          {isWriter && <Button size="sm" className="text-xs gap-1.5" ref={createTrigger} onClick={() => setShowCreateInvoice(true)}><Plus className="w-3.5 h-3.5" /> Créer facture</Button>}
          {canReceive && <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={event => { settlementTrigger.current = event.currentTarget; setPaymentInv(null); setSettlementOpen(true); }}><CreditCard className="w-3.5 h-3.5" /> Encaissement client</Button>}
          {canReceive && <Button ref={advanceTrigger} variant="outline" size="sm" className="text-xs gap-1.5" onClick={() => setAdvanceOpen(true)}><Receipt className="w-3.5 h-3.5" /> Acompte client</Button>}
          <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={() => setStatementOpen(true)}><BookOpen className="w-3.5 h-3.5" /> Relevé de compte</Button>
          <ExportMenu variant="outline" size="sm" className="text-xs gap-1.5" data-testid="btn-export-csv" onPick={(f) => void handleExport(f)}><Download className="w-3.5 h-3.5" /> Exporter</ExportMenu></>} />

      {/* Une pièce par onglet, comme Approvisionnement (standard de présentation des modules). */}
      <Tabs value={tab} onValueChange={(v) => setSearchParams((sp) => { sp.set("tab", v); return sp; }, { replace: true })}>
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="invoices">Factures ({invoices.length})</TabsTrigger>
          <TabsTrigger value="receipts">Encaissements</TabsTrigger>
          <TabsTrigger value="credit-notes">Avoirs</TabsTrigger>
          {<TabsTrigger value="credits">Acomptes et crédits</TabsTrigger>}
          <TabsTrigger value="posting">Comptabilisation</TabsTrigger>
        </TabsList>

        <TabsContent value="invoices" className="space-y-3">
      {/* Toolbar */}
      <div className="card-elevated p-3 flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-0 basis-60">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            aria-label="Rechercher une facture client"
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
            <ExportMenu size="sm" variant="outline" className="h-7 text-xs" onPick={(f) => exportTable(f, choix.map((i) => ({
              numero: i.invoice_number, client: i.customer?.name ?? "", date: i.invoice_date, echeance: i.due_date,
              ht: i.subtotal, tva: i.tax_amount, ttc: i.total, regle: i.amount_paid, reste: i.total - i.amount_paid, statut: statusLabel(i.status),
            })), [{ key: "numero", header: "N° facture" }, { key: "client", header: "Client" }, { key: "date", header: "Date" },
              { key: "echeance", header: "Échéance" }, { key: "ht", header: "HT" }, { key: "tva", header: "TVA" }, { key: "ttc", header: "TTC" },
              { key: "regle", header: "Réglé" }, { key: "reste", header: "Reste dû" }, { key: "statut", header: "Statut" }], "factures-clients-selection")}>
              Exporter la sélection
            </ExportMenu>
            {isWriter && brouillons.length > 0 && (
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
          <Table className="data-table" mobileColumns={financeMobileColumns.invoices} aria-label="Factures clients">
            <TableHeader>
              <TableRow>
                <TableHead className="h-auto bg-muted/50 py-2.5 text-xs uppercase tracking-wider max-md:normal-case w-10"><input type="checkbox" aria-label="Sélectionner toutes les factures clients" className="rounded border-input" checked={selectedIds.size === filtered.length && filtered.length > 0} onChange={toggleAll} /></TableHead>
                <TableHead className="h-auto bg-muted/50 py-2.5 text-xs uppercase tracking-wider max-md:normal-case">N° Facture</TableHead>
                <TableHead className="h-auto bg-muted/50 py-2.5 text-xs uppercase tracking-wider max-md:normal-case">Client</TableHead>
                <TableHead className="h-auto bg-muted/50 py-2.5 text-xs uppercase tracking-wider max-md:normal-case">Date</TableHead>
                <TableHead className="h-auto bg-muted/50 py-2.5 text-xs uppercase tracking-wider max-md:normal-case">Échéance</TableHead>
                <TableHead className="h-auto bg-muted/50 py-2.5 text-xs uppercase tracking-wider max-md:normal-case text-right">Total</TableHead>
                <TableHead className="h-auto bg-muted/50 py-2.5 text-xs uppercase tracking-wider max-md:normal-case text-right">Restant</TableHead>
                <TableHead className="h-auto bg-muted/50 py-2.5 text-xs uppercase tracking-wider max-md:normal-case">Statut</TableHead>
                <TableHead title="Code de lettrage : facture soldée et pièces qui la soldent" className="h-auto bg-muted/50 py-2.5 text-xs uppercase tracking-wider max-md:normal-case">Lettrage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={9} className="max-md:border-b-0 px-4 py-2.5 text-center py-8"><Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" /></TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="max-md:border-b-0 px-4 py-2.5 text-center py-8 text-muted-foreground">
                  {invoices.length === 0 ? "Aucune facture — créez votre première facture AR" : "Aucun résultat"}
                </TableCell></TableRow>
              ) : (
                filtered.map(inv => {
                  const outstanding = inv.total - inv.amount_paid;
                  return (
                    <TableRow key={inv.id} className="cursor-pointer" onClick={() => openInvoice(inv)}>
                      <TableCell onClick={e => e.stopPropagation()} className="max-md:border-b-0 px-4 py-2.5">
                        <input type="checkbox" aria-label={`Sélectionner ${inv.invoice_number}`} className="rounded border-input" checked={selectedIds.has(inv.id)} onChange={() => toggleSelect(inv.id)} />
                      </TableCell>
                      <TableCell className="max-md:border-b-0 px-4 py-2.5 font-medium text-foreground tabular-nums"><Button type="button" variant="link" className="h-auto min-h-11 max-w-full md:min-h-0 md:whitespace-nowrap whitespace-normal break-words p-0 text-left font-medium" onClick={event => { event.stopPropagation(); openInvoice(inv, event.currentTarget); }}>{inv.invoice_number}</Button></TableCell>
                      <TableCell className="max-md:border-b-0 px-4 py-2.5"><span className="block md:max-w-64 md:truncate" title={inv.customer?.name || "—"}>{inv.customer?.name || "—"}</span></TableCell>
                      <TableCell className="max-md:border-b-0 px-4 py-2.5 tabular-nums text-muted-foreground md:whitespace-nowrap">{inv.invoice_date}</TableCell>
                      <TableCell className={cn("md:whitespace-nowrap", cn("max-md:border-b-0 px-4 py-2.5", cn("tabular-nums", inv.status === "overdue" ? "text-destructive font-medium" : "text-muted-foreground")))}>{inv.due_date}</TableCell>
                      <TableCell className="max-md:border-b-0 px-4 py-2.5 text-right tabular-nums">{fmt(inv.total)}</TableCell>
                      <TableCell className={cn("max-md:border-b-0 px-4 py-2.5", cn("text-right tabular-nums font-medium", outstanding === 0 ? "text-success" : "text-foreground"))}>{fmt(outstanding)}</TableCell>
                      <TableCell className="max-md:border-b-0 px-4 py-2.5">
                        <StatusBadge status={statusType(inv.status)} label={statusLabel(inv.status)} />
                      </TableCell>
                      <TableCell className="max-md:border-b-0 px-4 py-2.5 font-mono text-xs text-muted-foreground" data-testid="ar-lettering">{letterings?.get(inv.id)?.code ?? ""}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

        </TabsContent>

        <TabsContent value="receipts">
          <ReceiptsTab onOpenInvoice={(id, trigger) => { const inv = invoices.find((i) => i.id === id); if (inv) openInvoice(inv, trigger); }} />
        </TabsContent>

        <TabsContent value="credit-notes">
          <div className="rounded-md border border-border bg-card p-4">
            <CreditNotesList title="Avoirs clients" />
          </div>
        </TabsContent>

        <TabsContent value="credits">
          <div className="rounded-md border border-border bg-card p-4">
            <CustomerCreditsList canRefund={(access?.permissions ?? []).includes("ar.refund")} />
          </div>
        </TabsContent>

        <TabsContent value="posting" className="space-y-4">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Comptabilisation — journaux et lots des comptes clients</h2>
          </div>
          <GLPostingKPIsLive module="AR" />
          <GLBatchHistoryLive module="AR" />
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <CreateInvoiceDialog returnFocusRef={createTrigger} open={showCreateInvoice} onClose={() => setShowCreateInvoice(false)} />
      <CustomerStatementDialog open={statementOpen} onClose={() => setStatementOpen(false)} />
      <AdvanceDialog open={advanceOpen} onClose={() => setAdvanceOpen(false)} returnFocusRef={advanceTrigger} />

      {selectedInv && (
        <InvoicePanel
          returnFocusRef={invoiceTrigger}
          // La facture à jour (après un encaissement, une imputation, un avoir), pas la copie du clic.
          inv={invoices.find((i) => i.id === selectedInv.id) ?? selectedInv}
          onClose={() => setSelectedInv(null)}
          onRecordPayment={() => { settlementTrigger.current = invoiceTrigger.current; invoiceTrigger.current = null; setPaymentInv(selectedInv); setSettlementOpen(true); setSelectedInv(null); }}
        />
      )}

      <SettlementDialog
        returnFocusRef={settlementTrigger}
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
