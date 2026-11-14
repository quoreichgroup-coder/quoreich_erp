import { useEffect, useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Download,
  Plus,
  FileText,
  ShoppingBag,
  Truck,
  BookOpen,
  Loader2,
  ArrowRight,
  CheckCircle2,
  Receipt,
  Lock,
} from "lucide-react";
import { useTableFeatures } from "@/hooks/use-table-features";
import { SortableHead, FilterBar, PaginationBar } from "@/components/DataTableControls";
import { GLPostingKPIsLive, GLBatchHistoryLive } from "@/hooks/use-gl-batches";
import {
  useQuotations,
  useSalesOrders,
  useDeliveryNotes,
  useCreateQuotation,
  useCreateSalesOrder,
  useConvertQuoteToSO,
  useConfirmSO,
  usePostDelivery,
  useInvoiceFromDelivery,
  useMySalesRoles,
  useSoLines,
  useQuoteLines,
  useDnLines,
  useCustomerExposure,
  useCreateOrderFromQuote,
  useUpdateQuotation,
  useDeleteQuotation,
  useUpdateSalesOrder,
  useDeleteSalesOrder,
  useBulkSales,
  useCustomerReturns,
  useCreateCustomerReturn,
  useCreditCustomerReturn,
  type CustomerReturn,
  type SalesLine,
} from "@/hooks/use-sales-data";
import { useCustomers } from "@/hooks/use-ar-data";
import { useTaxCodes } from "@/hooks/use-tax-codes";
import { emptyLine, invoiceTotals, type DraftLine } from "@/lib/invoice-lines";
import { CommercialLinesEditor, CommercialTotals, toSalesLines } from "@/components/CommercialLinesEditor";
import { useMyAccess } from "@/hooks/use-my-access";
import { DocumentDetail, documentFileName } from "@/components/DocumentDetail";
import { exportToCSV } from "@/lib/csv-export";
import { exportToPDF } from "@/lib/pdf-export";
import { toast } from "sonner";
import { SALES_ROLE_HINTS } from "@/lib/sales-roles";
import { SalesEmptyState } from "@/components/SalesEmptyState";


const fmt = (n: number) => Number(n || 0).toLocaleString("fr-FR");

const EXPORT_HINT_ID = "sales-tx-export-hint";

const statusStyle = (s: string) => {
  switch (s) {
    case "accepted":
    case "converted":
    case "delivered":
    case "completed":
      return "bg-success/15 text-success border-success/20";
    case "sent":
    case "confirmed":
    case "in_production":
    case "partially_delivered":
      return "bg-blue-500/15 text-blue-700 border-blue-500/20";
    case "expired":
    case "cancelled":
      return "bg-destructive/15 text-destructive border-destructive/20";
    case "pending_approval":
      return "bg-amber-500/15 text-amber-700 border-amber-500/20";
    default:
      return "bg-muted text-muted-foreground";
  }
};

/* ──────── CLIENT CHOISI : ENCOURS ET LIMITE ──────── */
// Affiché dès le choix du client (devis, commande) : on voit ce qu'il doit avant de s'engager.
function CustomerExposureBanner({ customerId }: { customerId: string }) {
  const { data: customers = [] } = useCustomers();
  const { data: exp } = useCustomerExposure(customerId || undefined);
  if (!customerId || !exp) return null;
  const limit = Number((customers.find((c) => c.id === customerId) as { credit_limit?: number } | undefined)?.credit_limit ?? 0);
  const over = limit > 0 && exp.outstanding > limit;
  return (
    <div className="rounded border border-border bg-muted/30 p-2 text-xs flex flex-wrap gap-x-6 gap-y-1" data-testid="customer-exposure">
      <span>Encours : <strong className="tabular-nums">{fmt(exp.outstanding)} XOF</strong> ({exp.invoices} facture(s) ouverte(s))</span>
      <span className={exp.overdue > 0 ? "text-destructive" : "text-muted-foreground"}>Échu : <span className="tabular-nums">{fmt(exp.overdue)} XOF</span></span>
      <span className={over ? "text-destructive" : "text-muted-foreground"}>Limite de crédit : {limit > 0 ? `${fmt(limit)} XOF` : "aucune"}</span>
    </div>
  );
}

const OPEN_QUOTE = new Set(["draft", "sent", "accepted", "partially_converted"]);

/* ──────── LIGNES D'UN DEVIS À COMMANDER (V44) ──────── */
function QuoteLinesPicker({ quoteId, qtys, onChange }: {
  quoteId: string; qtys: Record<string, string>; onChange: (q: Record<string, string>) => void;
}) {
  const { data: lines = [], isLoading } = useQuoteLines(quoteId);
  const remaining = (l: SalesLine) => Number(l.quantity) - Number(l.quantity_ordered ?? 0);
  const open = lines.filter((l) => remaining(l) > 0);
  if (isLoading) return <p className="text-xs text-muted-foreground">Chargement des lignes…</p>;
  const allOn = open.length > 0 && open.every((l) => Number(qtys[l.id] ?? 0) > 0);
  return (
    <div className="space-y-2" data-testid="quote-lines-picker">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium">Lignes du devis</p>
        <Button type="button" size="sm" variant="outline" className="h-7 text-[10px]"
          onClick={() => onChange(allOn ? {} : Object.fromEntries(open.map((l) => [l.id, String(remaining(l))])))}>
          {allOn ? "Tout désélectionner" : "Tout reprendre"}
        </Button>
      </div>
      <table className="w-full text-xs">
        <thead><tr className="text-muted-foreground border-b border-border">
          <th className="w-8" /><th className="text-left py-1">Libellé</th><th className="text-right">P.U.</th><th className="text-right">Remise</th>
          <th className="text-right">TVA</th><th className="text-right">Devisé</th><th className="text-right">Déjà commandé</th><th className="text-right w-24">À commander</th>
        </tr></thead>
        <tbody>
          {lines.map((l, i) => {
            const rest = remaining(l);
            const on = Number(qtys[l.id] ?? 0) > 0;
            return (
              <tr key={l.id} className="border-b border-border/50">
                <td><input type="checkbox" aria-label={`Choisir la ligne ${i + 1}`} disabled={rest <= 0} checked={on}
                  onChange={(e) => onChange({ ...qtys, [l.id]: e.target.checked ? String(rest) : "" })} /></td>
                <td className="py-1">{l.description}</td>
                <td className="text-right tabular-nums">{fmt(Number(l.unit_price))}</td>
                <td className="text-right tabular-nums">{Number(l.discount_pct) ? `${Number(l.discount_pct)} %` : ""}</td>
                <td className="text-right">{l.tax_code?.code ?? "—"}</td>
                <td className="text-right tabular-nums">{fmt(Number(l.quantity))}</td>
                <td className="text-right tabular-nums">{fmt(Number(l.quantity_ordered ?? 0))}</td>
                <td className="text-right">
                  <Input aria-label={`Quantité à commander ligne ${i + 1}`} inputMode="decimal" className="h-7 text-xs text-right"
                    disabled={rest <= 0} value={qtys[l.id] ?? ""} placeholder={rest > 0 ? String(rest) : "0"}
                    onChange={(e) => onChange({ ...qtys, [l.id]: e.target.value })} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ──────── VUE D'UNE PIÈCE : EN-TÊTE, LIGNES, PIED ; EXPORTER, IMPRIMER ──────── */
type SalesView = { kind: "qt" | "so" | "dn"; doc: any } | null;

function SalesDocDialog({ view, onClose }: { view: SalesView; onClose: () => void }) {
  const qt = useQuoteLines(view?.kind === "qt" ? view.doc.id : undefined);
  const so = useSoLines(view?.kind === "so" ? view.doc.id : undefined);
  const dn = useDnLines(view?.kind === "dn" ? view.doc.id : undefined);
  if (!view) return null;
  const { kind, doc } = view;
  const lines = ((kind === "qt" ? qt.data : kind === "so" ? so.data : dn.data) ?? []) as SalesLine[];
  const net = lines.reduce((s, l) => s + Number(l.total), 0);
  const tax = lines.reduce((s, l) => s + Number(l.tax_amount ?? 0), 0);
  const title = kind === "qt" ? `Devis ${doc.quote_number}` : kind === "so" ? `Commande ${doc.so_number}` : `Livraison ${doc.dn_number}`;
  const header: [string, React.ReactNode][] = kind === "qt"
    ? [["Client", doc.customer?.name], ["Statut", doc.status], ["Date", doc.quote_date], ["Validité", doc.valid_until]]
    : kind === "so"
      ? [["Client", doc.customer?.name], ["Statut", doc.status], ["Date", doc.order_date], ["Devis d'origine", doc.quotation?.quote_number ?? "—"],
         ...(doc.credit_override_reason ? [["Dépassement de crédit accordé", doc.credit_override_reason] as [string, string]] : [])]
      : [["Client", doc.customer?.name], ["Statut", doc.status], ["Date", doc.delivery_date], ["Commande", doc.sales_order?.so_number ?? "—"],
         ["Facture", doc.ar_invoice_id ? "préparée" : "—"]];
  const extra = kind === "qt" ? { label: "Commandé", v: (l: SalesLine) => fmt(Number(l.quantity_ordered ?? 0)) }
    : kind === "so" ? { label: "Livré", v: (l: SalesLine) => fmt(Number(l.quantity_delivered ?? 0)) } : null;
  const columns = [{ label: "Libellé" }, { label: "Qté", align: "right" as const }, { label: "P.U.", align: "right" as const },
    { label: "Remise", align: "right" as const }, { label: "TVA", align: "right" as const }, { label: "Montant HT", align: "right" as const },
    ...(extra ? [{ label: extra.label, align: "right" as const }] : [])];
  const rows = lines.map((l) => [l.description, fmt(Number(l.quantity)), fmt(Number(l.unit_price)),
    Number(l.discount_pct) ? `${Number(l.discount_pct)} %` : "", l.tax_code?.code ?? "—", fmt(Number(l.total)),
    ...(extra ? [extra.v(l)] : [])]);
  const footer: [string, React.ReactNode, boolean?][] = [["Total HT", `${fmt(net)} XOF`], ["TVA", `${fmt(tax)} XOF`],
    ["Total TTC", `${fmt(net + tax)} XOF`, true]];
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle className="text-sm">{title}</DialogTitle></DialogHeader>
        <DocumentDetail header={header} columns={columns} rows={rows} footer={footer} title={title} fileName={documentFileName(title)}
          emptyLines="Chargement des lignes…" />
      </DialogContent>
    </Dialog>
  );
}

/* ──────── RETOUR CLIENT SUR LIVRAISON (V50) ──────── */
function ReturnDialog({ dn, onClose }: { dn: any | null; onClose: () => void }) {
  const { data: lines = [] } = useDnLines(dn?.id);
  const create = useCreateCustomerReturn();
  const { data: access } = useMyAccess();
  const canCredit = (access?.permissions ?? []).includes("ar.credit_note");
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [withCredit, setWithCredit] = useState(true);
  if (!dn) return null;
  const rest = (l: SalesLine) => Number(l.quantity) - Number(l.quantity_returned ?? 0);
  const chosen = lines.map((l) => ({ dn_line_id: l.id, quantity: Number(String(qtys[l.id] ?? "").replace(",", ".")) || 0 })).filter((l) => l.quantity > 0);
  const invoiced = !!dn.ar_invoice_id;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-sm">Retour client sur la livraison {dn.dn_number}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Les articles stockés reviennent en stock au coût de leur sortie. {invoiced
            ? "La livraison est facturée : un avoir lié peut être émis sur les lignes retournées."
            : "La livraison n'est pas encore facturée : la facture ne reprendra que le livré non retourné."}
        </p>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label className="text-xs" htmlFor="return-reason">Motif (obligatoire)</Label>
            <Input id="return-reason" className="h-8 text-xs" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Casse, erreur de livraison, non conforme…" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="return-date">Date du retour</Label>
            <Input id="return-date" type="date" className="h-8 text-xs" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <table className="w-full text-xs">
          <thead><tr className="text-muted-foreground border-b border-border">
            <th className="text-left py-1">Libellé</th><th className="text-right">Livré</th><th className="text-right">Déjà retourné</th><th className="text-right w-28">À retourner</th>
          </tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.id} className="border-b border-border/50">
                <td className="py-1">{l.description}</td>
                <td className="text-right tabular-nums">{fmt(Number(l.quantity))}</td>
                <td className="text-right tabular-nums">{fmt(Number(l.quantity_returned ?? 0))}</td>
                <td className="text-right">
                  <Input aria-label={`Quantité retournée ligne ${i + 1}`} inputMode="decimal" className="h-7 text-xs text-right" placeholder="0"
                    disabled={rest(l) <= 0} value={qtys[l.id] ?? ""} onChange={(e) => setQtys({ ...qtys, [l.id]: e.target.value })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {invoiced && (
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={withCredit && canCredit} disabled={!canCredit} onChange={(e) => setWithCredit(e.target.checked)} />
            Émettre l'avoir lié maintenant {canCredit ? "" : "(droit « avoir client » requis : le comptable l'émettra depuis l'onglet Retours)"}
          </label>
        )}
        <DialogFooter>
          <Button variant="outline" size="sm" className="text-xs" onClick={onClose}>Annuler</Button>
          <Button size="sm" className="text-xs" disabled={!reason.trim() || chosen.length === 0 || create.isPending}
            onClick={() => create.mutate({ dnId: dn.id, reason: reason.trim(), date, lines: chosen, withCreditNote: invoiced && withCredit && canCredit },
              { onSuccess: () => { setReason(""); setQtys({}); onClose(); } })}>
            {create.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Enregistrer le retour"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReturnsTab() {
  const { data: returns = [], isLoading } = useCustomerReturns();
  const credit = useCreditCustomerReturn();
  const { data: access } = useMyAccess();
  const canCredit = (access?.permissions ?? []).includes("ar.credit_note");
  const [view, setView] = useState<CustomerReturn | null>(null);
  return (
    <Card className="border-border">
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-6 text-center"><Loader2 className="w-4 h-4 animate-spin inline" /></div>
        ) : returns.length === 0 ? (
          <p className="p-6 text-center text-xs text-muted-foreground">Aucun retour client. Un retour s'enregistre depuis une livraison validée (bouton « Retour »).</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableCell className="text-[11px] font-medium text-muted-foreground">N° retour</TableCell>
                <TableCell className="text-[11px] font-medium text-muted-foreground">Date</TableCell>
                <TableCell className="text-[11px] font-medium text-muted-foreground">Client</TableCell>
                <TableCell className="text-[11px] font-medium text-muted-foreground">Livraison</TableCell>
                <TableCell className="text-[11px] font-medium text-muted-foreground">Motif</TableCell>
                <TableCell className="text-[11px] font-medium text-muted-foreground">Avoir</TableCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {returns.map((r) => (
                <TableRow key={r.id} className="text-xs cursor-pointer hover:bg-muted/40" data-testid="return-row" onClick={() => setView(r)}>
                  <TableCell className="font-mono text-primary">{r.return_number}</TableCell>
                  <TableCell>{r.return_date}</TableCell>
                  <TableCell className="font-medium">{r.customer?.name}</TableCell>
                  <TableCell className="font-mono text-muted-foreground">{r.delivery?.dn_number}</TableCell>
                  <TableCell className="truncate max-w-[16rem]">{r.reason}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {r.credit_note ? <span className="font-mono">{r.credit_note.credit_note_number}</span>
                      : r.delivery?.ar_invoice_id && canCredit ? (
                        <Button size="sm" variant="ghost" className="h-6 text-[10px]" disabled={credit.isPending} onClick={() => credit.mutate(r.id)}>Émettre l'avoir</Button>
                      ) : <span className="text-muted-foreground">{r.delivery?.ar_invoice_id ? "à établir" : "non facturée"}</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {view && (
        <Dialog open onOpenChange={(o) => { if (!o) setView(null); }}>
          <DialogContent className="max-w-3xl">
            <DialogHeader><DialogTitle className="text-sm">Retour {view.return_number}</DialogTitle></DialogHeader>
            <DocumentDetail title={`Retour client ${view.return_number}`} fileName={documentFileName(`retour-${view.return_number}`)}
              header={[["Client", view.customer?.name], ["Livraison", view.delivery?.dn_number], ["Date", view.return_date],
                ["Motif", view.reason], ["Avoir", view.credit_note?.credit_note_number ?? "—"]]}
              columns={[{ label: "Libellé" }, { label: "Qté retournée", align: "right" }, { label: "P.U. vente", align: "right" },
                { label: "Coût de rentrée", align: "right" }, { label: "Valeur vente HT", align: "right" }]}
              rows={(view.lines ?? []).map((l) => [l.description, fmt(Number(l.quantity)), fmt(Number(l.unit_price)), fmt(Number(l.unit_cost)),
                fmt(Number(l.quantity) * Number(l.unit_price))])}
              footer={[["Quantité retournée", fmt((view.lines ?? []).reduce((s, l) => s + Number(l.quantity), 0))],
                ["Valeur de vente HT", `${fmt((view.lines ?? []).reduce((s, l) => s + Number(l.quantity) * Number(l.unit_price), 0))} XOF`, true]]} />
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}

/* ──────── ACTIONS GROUPÉES ──────── */
function BulkBar({ count, onClear, children }: { count: number; onClear: () => void; children: React.ReactNode }) {
  if (count === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border bg-muted/30 text-xs" data-testid="sales-bulk-bar">
      <span className="font-medium">{count} pièce(s) sélectionnée(s)</span>
      {children}
      <Button size="sm" variant="ghost" className="h-7 text-xs ml-auto" onClick={onClear}>Effacer la sélection</Button>
    </div>
  );
}

function SelectBox({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <TableCell onClick={(e) => e.stopPropagation()} className="w-8">
      <input type="checkbox" aria-label={label} className="rounded border-input" checked={checked} onChange={onChange} />
    </TableCell>
  );
}

/* ──────── MODIFIER UN DEVIS OU UNE COMMANDE LIBRE (V46) ──────── */
type EditTarget = { kind: "qt"; doc: any } | { kind: "so"; doc: any } | null;

function EditSalesDocDialog({ target, onClose }: { target: EditTarget; onClose: () => void }) {
  const { data: customers = [] } = useCustomers();
  const { data: taxCodes = [] } = useTaxCodes();
  const qtLines = useQuoteLines(target?.kind === "qt" ? target.doc.id : undefined);
  const soLines = useSoLines(target?.kind === "so" ? target.doc.id : undefined);
  const updQ = useUpdateQuotation();
  const updO = useUpdateSalesOrder();
  const [form, setForm] = useState({ customer_id: "", date: "", valid_until: "" });
  const [lines, setLines] = useState<DraftLine[] | null>(null);
  const source = (target?.kind === "qt" ? qtLines.data : soLines.data) as SalesLine[] | undefined;
  useEffect(() => {
    if (!target) { setLines(null); return; }
    setForm({
      customer_id: target.doc.customer_id,
      date: target.kind === "qt" ? target.doc.quote_date : target.doc.order_date,
      valid_until: target.kind === "qt" ? target.doc.valid_until ?? "" : "",
    });
  }, [target]);
  useEffect(() => {
    if (target && source && lines === null) {
      setLines(source.map((l) => ({
        description: l.description, quantity: String(l.quantity), unitPrice: String(l.unit_price),
        discountPct: Number(l.discount_pct) ? String(Number(l.discount_pct)) : "", taxCodeId: l.tax_code_id ?? "",
      })));
    }
  }, [target, source, lines]);
  if (!target) return null;
  const current = lines ?? [];
  const { allValid } = invoiceTotals(current, taxCodes);
  const pending = updQ.isPending || updO.isPending;
  const title = target.kind === "qt" ? `Modifier le devis ${target.doc.quote_number}` : `Modifier la commande ${target.doc.so_number}`;
  const save = async () => {
    if (!allValid) { toast.error("Complétez chaque ligne (désignation, quantité, prix, remise 0–100 %)"); return; }
    if (target.kind === "qt") {
      await updQ.mutateAsync({ id: target.doc.id, customer_id: form.customer_id, quote_date: form.date,
        valid_until: form.valid_until, lines: toSalesLines(current) });
    } else {
      await updO.mutateAsync({ id: target.doc.id, order_date: form.date, lines: toSalesLines(current) });
    }
    setLines(null);
    onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) { setLines(null); onClose(); } }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle className="text-sm">{title}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="edit-customer">Client</Label>
              <select id="edit-customer" className="w-full h-8 px-2 rounded-md border border-input bg-background text-xs"
                value={form.customer_id} disabled={target.kind === "so"}
                onChange={(e) => setForm((f) => ({ ...f, customer_id: e.target.value }))}>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="edit-date">Date</Label>
              <Input id="edit-date" type="date" className="h-8 text-xs" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
            </div>
            {target.kind === "qt" && (
              <div className="space-y-1.5">
                <Label className="text-xs" htmlFor="edit-validity">Validité</Label>
                <Input id="edit-validity" type="date" className="h-8 text-xs" value={form.valid_until} onChange={(e) => setForm((f) => ({ ...f, valid_until: e.target.value }))} />
              </div>
            )}
          </div>
          {lines === null ? (
            <p className="text-xs text-muted-foreground">Chargement des lignes…</p>
          ) : (
            <>
              <CommercialLinesEditor lines={current} onChange={setLines} taxCodes={taxCodes} testId="sales-lines" linePrefix="sales-line" />
              <CommercialTotals lines={current} taxCodes={taxCodes} testId="sales-totals" />
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" className="text-xs" onClick={() => { setLines(null); onClose(); }}>Annuler</Button>
          <Button size="sm" className="text-xs" disabled={pending || lines === null} onClick={save}>
            {pending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Enregistrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateQuotationDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: customers = [] } = useCustomers();
  const create = useCreateQuotation();
  const [form, setForm] = useState({
    customer_id: "",
    quote_date: new Date().toISOString().split("T")[0],
    valid_until: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0],
  });
  const { data: taxCodes = [] } = useTaxCodes();
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const { allValid } = invoiceTotals(lines, taxCodes);

  const handleCreate = async () => {
    if (!form.customer_id || !allValid) {
      toast.error("Choisissez le client et complétez chaque ligne (désignation, quantité, prix, remise 0–100 %)");
      return;
    }
    await create.mutateAsync({
      customer_id: form.customer_id,
      quote_date: form.quote_date,
      valid_until: form.valid_until,
      lines: toSalesLines(lines),
    });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-sm">Nouveau devis</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <CustomerExposureBanner customerId={form.customer_id} />
          <div className="space-y-1.5">
            <Label className="text-xs">Client *</Label>
            <select
              className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
              value={form.customer_id}
              onChange={(e) => setForm((f) => ({ ...f, customer_id: e.target.value }))}
            >
              <option value="">— Sélectionner —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">N° Devis</Label>
              <Input
                className="h-8 text-xs"
                readOnly
                placeholder="Attribué à la création"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Date</Label>
              <Input
                type="date"
                className="h-8 text-xs"
                value={form.quote_date}
                onChange={(e) => setForm((f) => ({ ...f, quote_date: e.target.value }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Validité</Label>
              <Input
                type="date"
                className="h-8 text-xs"
                value={form.valid_until}
                onChange={(e) => setForm((f) => ({ ...f, valid_until: e.target.value }))}
              />
            </div>
          </div>
          <CommercialLinesEditor lines={lines} onChange={setLines} taxCodes={taxCodes} testId="sales-lines" linePrefix="sales-line" />
          <CommercialTotals lines={lines} taxCodes={taxCodes} testId="sales-totals" />
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" className="text-xs" onClick={onClose}>
            Annuler
          </Button>
          <Button size="sm" className="text-xs" onClick={handleCreate} disabled={create.isPending}>
            {create.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Créer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateOrderDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: customers = [] } = useCustomers();
  const create = useCreateSalesOrder();
  const fromQuote = useCreateOrderFromQuote();
  const { data: quotations = [] } = useQuotations();
  const [quoteId, setQuoteId] = useState("");
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    customer_id: "",
    order_date: new Date().toISOString().split("T")[0],
  });
  const { data: taxCodes = [] } = useTaxCodes();
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const { allValid } = invoiceTotals(lines, taxCodes);

  const handleCreate = async () => {
    if (quoteId) {
      const chosen = Object.entries(qtys).map(([id, q]) => ({ quote_line_id: id, quantity: Number(String(q).replace(",", ".")) }))
        .filter((l) => l.quantity > 0);
      if (chosen.length === 0) { toast.error("Choisissez au moins une ligne du devis"); return; }
      await fromQuote.mutateAsync({ quoteId, orderDate: form.order_date, lines: chosen });
      onClose();
      return;
    }
    if (!form.customer_id || !allValid) {
      toast.error("Choisissez le client et complétez chaque ligne (désignation, quantité, prix, remise 0–100 %)");
      return;
    }
    await create.mutateAsync({
      customer_id: form.customer_id,
      order_date: form.order_date,
      lines: toSalesLines(lines),
    });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-sm">Nouvelle commande</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Client *</Label>
            <select
              className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
              value={form.customer_id}
              onChange={(e) => { setForm((f) => ({ ...f, customer_id: e.target.value })); setQuoteId(""); setQtys({}); }}
            >
              <option value="">— Sélectionner —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <CustomerExposureBanner customerId={form.customer_id} />
          {form.customer_id && (
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="order-source-quote">Devis ouvert du client</Label>
              <select id="order-source-quote" className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                value={quoteId} onChange={(e) => { setQuoteId(e.target.value); setQtys({}); }}>
                <option value="">— Aucun : saisie libre des lignes —</option>
                {quotations
                  .filter((q) => q.customer_id === form.customer_id && OPEN_QUOTE.has(q.status)
                    && (!q.valid_until || q.valid_until >= new Date().toISOString().split("T")[0]))
                  .map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.quote_number} · {q.quote_date} · {fmt(Number(q.total_ttc ?? q.total))} XOF TTC{q.status === "partially_converted" ? " · partiellement commandé" : ""}
                    </option>
                  ))}
              </select>
              <p className="text-[11px] text-muted-foreground">Seuls les devis non expirés de ce client, avec un reste à commander, sont proposés.</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">N° Commande</Label>
              <Input
                className="h-8 text-xs"
                readOnly
                placeholder="Attribué à la création"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Date</Label>
              <Input
                type="date"
                className="h-8 text-xs"
                value={form.order_date}
                onChange={(e) => setForm((f) => ({ ...f, order_date: e.target.value }))}
              />
            </div>
          </div>
          {quoteId ? (
            <QuoteLinesPicker quoteId={quoteId} qtys={qtys} onChange={setQtys} />
          ) : (
            <>
              <CommercialLinesEditor lines={lines} onChange={setLines} taxCodes={taxCodes} testId="sales-lines" linePrefix="sales-line" />
              <CommercialTotals lines={lines} taxCodes={taxCodes} testId="sales-totals" />
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" className="text-xs" onClick={onClose}>
            Annuler
          </Button>
          <Button size="sm" className="text-xs" onClick={handleCreate} disabled={create.isPending || fromQuote.isPending}>
            {create.isPending || fromQuote.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Créer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeliverDialog({
  soId,
  onClose,
}: {
  soId: string | null;
  onClose: () => void;
}) {
  const { data: lines = [] } = useSoLines(soId || undefined);
  const post = usePostDelivery();
  const [qtys, setQtys] = useState<Record<string, string>>({});

  const submit = async () => {
    if (!soId) return;
    const payload = lines
      .map((l) => {
        const row = l as { id: string; quantity: number; quantity_delivered: number };
        const remaining = Number(row.quantity) - Number(row.quantity_delivered || 0);
        const q = parseFloat(qtys[row.id] ?? String(remaining));
        return { so_line_id: row.id, quantity: q };
      })
      .filter((x) => x.quantity > 0);
    if (payload.length === 0) {
      toast.error("Aucune quantité à livrer");
      return;
    }
    await post.mutateAsync({ so_id: soId, lines: payload });
    onClose();
  };

  return (
    <Dialog open={!!soId} onOpenChange={onClose}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-sm">Enregistrer la livraison</DialogTitle>
        </DialogHeader>
        {lines.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4">
            Cette commande n'a pas de lignes — créez-les d'abord avant de livrer.
          </p>
        ) : (
          <div className="space-y-2 max-h-80 overflow-auto">
            {lines.map((l) => {
              const row = l as {
                id: string;
                description: string | null;
                quantity: number;
                quantity_delivered: number;
              };
              const remaining = Number(row.quantity) - Number(row.quantity_delivered || 0);
              return (
                <div
                  key={row.id}
                  className="flex items-center gap-2 p-2 border border-border rounded text-xs"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{row.description || "—"}</div>
                    <div className="text-[10px] text-muted-foreground">
                      Commandé {fmt(row.quantity)} · Livré {fmt(row.quantity_delivered || 0)} ·
                      Reste {fmt(remaining)}
                    </div>
                  </div>
                  <Input
                    type="number"
                    className="h-7 w-24 text-xs"
                    placeholder={String(remaining)}
                    value={qtys[row.id] ?? ""}
                    onChange={(e) => setQtys((q) => ({ ...q, [row.id]: e.target.value }))}
                  />
                </div>
              );
            })}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" size="sm" className="text-xs" onClick={onClose}>
            Annuler
          </Button>
          <Button size="sm" className="text-xs" onClick={submit} disabled={post.isPending}>
            {post.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Livrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function SalesTransactions() {
  const { data: quotations = [], isLoading: loadingQt } = useQuotations();
  const { data: orders = [], isLoading: loadingSo } = useSalesOrders();
  const { data: deliveries = [], isLoading: loadingDn } = useDeliveryNotes();
  const { data: customers = [] } = useCustomers();
  const { data: perms } = useMySalesRoles();
  const convert = useConvertQuoteToSO();
  const confirmSo = useConfirmSO();
  const invoice = useInvoiceFromDelivery();

  const [showNewQuote, setShowNewQuote] = useState(false);
  const [showNewOrder, setShowNewOrder] = useState(false);
  const [confirmConvertId, setConfirmConvertId] = useState<string | null>(null);
  const [confirmSoId, setConfirmSoId] = useState<string | null>(null);
  const [creditBlock, setCreditBlock] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const { data: myAccess } = useMyAccess();
  const canOverride = (myAccess?.permissions ?? []).includes("sales.credit_override");
  const [deliverSoId, setDeliverSoId] = useState<string | null>(null);
  const [salesView, setSalesView] = useState<SalesView>(null);
  const [returnDn, setReturnDn] = useState<any | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget>(null);
  const deleteQuote = useDeleteQuotation();
  const bulk = useBulkSales();
  const [selQt, setSelQt] = useState<Set<string>>(new Set());
  const [selSo, setSelSo] = useState<Set<string>>(new Set());
  const [selDn, setSelDn] = useState<Set<string>>(new Set());
  const flip = (set: Set<string>, id: string) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); return n; };
  const runBulk = (action: Parameters<typeof bulk.mutate>[0]["action"], ids: string[], question: string, clear: () => void) => {
    if (ids.length === 0) return;
    if (window.confirm(question)) bulk.mutate({ action, ids }, { onSuccess: clear });
  };
  const deleteOrder = useDeleteSalesOrder();
  const [confirmInvoiceDnId, setConfirmInvoiceDnId] = useState<string | null>(null);

  // Global filters: période + client + onglet actif (pour export CSV)
  const today = new Date().toISOString().slice(0, 10);
  const ninetyAgo = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(ninetyAgo);
  const [dateTo, setDateTo] = useState(today);
  const [customerId, setCustomerId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"quotations" | "orders" | "deliveries">("quotations");

  const inRange = (d?: string | null) =>
    !d || ((!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo));
  const matchCustomer = (cid?: string | null) => !customerId || cid === customerId;

  const fQuotations = quotations.filter(
    (q) => inRange(q.quote_date) && matchCustomer(q.customer_id)
  );
  const fOrders = orders.filter(
    (o) => inRange(o.order_date) && matchCustomer(o.customer_id)
  );
  const fDeliveries = deliveries.filter(
    (d) => inRange(d.delivery_date) && matchCustomer(d.customer_id)
  );

  const customerOptions = customers.map((c) => c.name);

  const qtRows = fQuotations.map((q) => ({
    raw: q,
    id: q.quote_number,
    quoteId: q.id,
    date: q.quote_date,
    customer: q.customer?.name || "—",
    total: Number((q as { total_ttc?: number }).total_ttc ?? q.total),
    validUntil: q.valid_until || "—",
    status: q.status,
  }));

  const soRows = fOrders.map((o) => ({
    raw: o,
    id: o.so_number,
    soId: o.id,
    date: o.order_date,
    customer: o.customer?.name || "—",
    qtRef: o.quotation?.quote_number || "—",
    total: Number((o as { total_ttc?: number }).total_ttc ?? o.total),
    status: o.status,
  }));

  const dnRows = fDeliveries.map((d) => ({
    raw: d,
    id: d.dn_number,
    dnId: d.id,
    soRef: d.sales_order?.so_number || "—",
    date: d.delivery_date,
    customer: d.customer?.name || "—",
    status: d.status,
    invoiced: !!d.ar_invoice_id,
  }));

  const qtTable = useTableFeatures({
    data: qtRows,
    pageSize: 10,
    searchableKeys: ["id", "customer"],
    filterConfigs: [
      {
        key: "status",
        label: "Status",
        options: ["draft", "sent", "accepted", "expired", "converted"],
      },
      { key: "customer", label: "Customer", options: customerOptions },
    ],
  });
  const soTable = useTableFeatures({
    data: soRows,
    pageSize: 10,
    searchableKeys: ["id", "customer"],
    filterConfigs: [
      {
        key: "status",
        label: "Status",
        options: ["draft", "confirmed", "partially_delivered", "delivered", "cancelled"],
      },
      { key: "customer", label: "Customer", options: customerOptions },
    ],
  });
  const dnTable = useTableFeatures({
    data: dnRows,
    pageSize: 10,
    searchableKeys: ["id", "customer", "soRef"],
    filterConfigs: [
      { key: "status", label: "Status", options: ["draft", "completed", "cancelled"] },
      { key: "customer", label: "Customer", options: customerOptions },
    ],
  });

  const canConfirm = perms?.canConfirm;
  const canDeliver = perms?.canDeliver;
  const canInvoice = perms?.canInvoice;
  const noSalesRole = perms && !perms.isAdmin && (perms.roles?.length ?? 0) === 0;

  const customerName = customerId
    ? customers.find((c) => c.id === customerId)?.name ?? "—"
    : "Tous";
  const filterSummary = (statusFilter?: string) =>
    `Période ${dateFrom} → ${dateTo} · Client : ${customerName}${
      statusFilter ? ` · Statut : ${statusFilter}` : ""
    }`;

  const handleExport = () => {
    if (!perms?.canExport) {
      toast.error("Export refusé — rôle Manager ou Controller requis");
      return;
    }
    const rowsByTab = {
      quotations: qtTable.processedData,
      orders: soTable.processedData,
      deliveries: dnTable.processedData,
    } as const;
    if (rowsByTab[activeTab].length === 0) {
      toast.info("Aucune donnée à exporter (vérifiez les filtres)");
      return;
    }
    if (activeTab === "quotations") {

      exportToCSV(
        qtTable.processedData,
        [
          { key: "id", header: "Devis" },
          { key: "date", header: "Date" },
          { key: "customer", header: "Client" },
          { key: "total", header: "Total (XOF)" },
          { key: "validUntil", header: "Valide jusqu'au" },
          { key: "status", header: "Statut" },
        ],
        `quotations-${dateFrom}-${dateTo}`
      );
    } else if (activeTab === "orders") {
      exportToCSV(
        soTable.processedData,
        [
          { key: "id", header: "Commande" },
          { key: "date", header: "Date" },
          { key: "customer", header: "Client" },
          { key: "qtRef", header: "Devis" },
          { key: "total", header: "Total (XOF)" },
          { key: "status", header: "Statut" },
        ],
        `sales-orders-${dateFrom}-${dateTo}`
      );
    } else {
      exportToCSV(
        dnTable.processedData,
        [
          { key: "id", header: "BL" },
          { key: "date", header: "Date" },
          { key: "customer", header: "Client" },
          { key: "soRef", header: "Commande" },
          { key: "status", header: "Statut" },
          { key: "invoiced", header: "Facturé" },
        ],
        `deliveries-${dateFrom}-${dateTo}`
      );
    }
  };

  const handleExportPdf = () => {
    if (!perms?.canExport) {
      toast.error("Export refusé — rôle Manager ou Controller requis");
      return;
    }
    const rowsByTab = {
      quotations: qtTable.processedData,
      orders: soTable.processedData,
      deliveries: dnTable.processedData,
    } as const;
    const columnsByTab = {
      quotations: [
        { key: "id", header: "Devis" }, { key: "date", header: "Date" },
        { key: "customer", header: "Client" }, { key: "total", header: "Total XOF" },
        { key: "validUntil", header: "Valide jusqu'au" }, { key: "status", header: "Statut" },
      ],
      orders: [
        { key: "id", header: "Commande" }, { key: "date", header: "Date" },
        { key: "customer", header: "Client" }, { key: "qtRef", header: "Devis" },
        { key: "total", header: "Total XOF" }, { key: "status", header: "Statut" },
      ],
      deliveries: [
        { key: "id", header: "Bon de livraison" }, { key: "date", header: "Date" },
        { key: "customer", header: "Client" }, { key: "soRef", header: "Commande" },
        { key: "status", header: "Statut" }, { key: "invoiced", header: "Facturé" },
      ],
    };
    const rows = rowsByTab[activeTab];
    if (rows.length === 0) {
      toast.info("Aucune donnée à exporter (vérifiez les filtres)");
      return;
    }
    exportToPDF({
      filename: `${activeTab}-${dateFrom}-${dateTo}.pdf`,
      title: activeTab === "quotations" ? "Devis clients" : activeTab === "orders" ? "Commandes de vente" : "Bons de livraison",
      subtitle: `${rows.length} document(s) · ${filterSummary()}`,
      columns: columnsByTab[activeTab],
      rows: rows as unknown as Record<string, unknown>[],
    });
  };


  return (
    <PageShell>
      <Breadcrumb
        items={[{ label: "Finance" }, { label: "Sales", href: "/sales" }, { label: "Transactions" }]}
      />
      <GuidanceBanner
        title="Sales Transactions"
        description="Cycle Quote → SO → Delivery → Facture avec actions sécurisées par rôle."
      />

      {noSalesRole && (
        <Card className="border-amber-500/30 bg-amber-500/5 mb-4">
          <CardContent className="p-3 flex items-start gap-2">
            <Lock className="w-4 h-4 text-amber-700 mt-0.5" />
            <p className="text-xs text-muted-foreground">
              Lecture seule — aucun rôle Sales attribué. Demandez à un administrateur dans{" "}
              <strong>Settings → Users</strong>.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between mb-3">
        <h1 className="text-lg font-semibold text-foreground">Sales Transactions</h1>
        <div className="flex gap-2">
          {perms?.canCreate && (
            <>
              <Button size="sm" className="gap-1.5" onClick={() => setShowNewQuote(true)}>
                <Plus className="w-3.5 h-3.5" />
                New Quote
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowNewOrder(true)}>
                <ShoppingBag className="w-3.5 h-3.5" />
                New Order
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={handleExport}
            disabled={!perms?.canExport}
            aria-label={
              perms?.canExport
                ? `Exporter l'onglet ${activeTab} en CSV`
                : `Export CSV désactivé — ${SALES_ROLE_HINTS.export}`
            }
            aria-describedby={!perms?.canExport ? EXPORT_HINT_ID : undefined}
            title={
              perms?.canExport
                ? `Exporter l'onglet ${activeTab} en CSV (${filterSummary()})`
                : SALES_ROLE_HINTS.export
            }
          >
            {perms?.canExport ? (
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
            ) : (
              <Lock className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            Export CSV
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={handleExportPdf}
            disabled={!perms?.canExport}
            aria-label="Exporter l'onglet actif en PDF"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            Export PDF
          </Button>
          {!perms?.canExport && (
            <span id={EXPORT_HINT_ID} className="sr-only">
              {SALES_ROLE_HINTS.export}
            </span>
          )}

        </div>
      </div>

      {/* Global filters: période + client */}
      <Card className="border-border mb-4">
        <CardContent className="p-3 flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-[10px] uppercase text-muted-foreground">Du</Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-8 text-xs w-36"
            />
          </div>
          <div>
            <Label className="text-[10px] uppercase text-muted-foreground">Au</Label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-8 text-xs w-36"
            />
          </div>
          <div className="min-w-[200px]">
            <Label className="text-[10px] uppercase text-muted-foreground">Client</Label>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="h-8 text-xs w-full border border-border rounded-md bg-background px-2"
            >
              <option value="">Tous les clients</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          {(dateFrom !== ninetyAgo || dateTo !== today || customerId) && (
            <Button
              size="sm"
              variant="ghost"
              className="text-xs h-8"
              onClick={() => {
                setDateFrom(ninetyAgo);
                setDateTo(today);
                setCustomerId("");
              }}
            >
              Réinitialiser
            </Button>
          )}
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
        <TabsList className="mb-4">
          <TabsTrigger value="quotations" className="gap-1.5">
            <FileText className="w-3.5 h-3.5" />
            Quotations ({fQuotations.length})
          </TabsTrigger>
          <TabsTrigger value="orders" className="gap-1.5">
            <ShoppingBag className="w-3.5 h-3.5" />
            Sales Orders ({fOrders.length})
          </TabsTrigger>
          <TabsTrigger value="deliveries" className="gap-1.5">
            <Truck className="w-3.5 h-3.5" />
            Deliveries ({fDeliveries.length})
          </TabsTrigger>
          <TabsTrigger value="returns" className="gap-1.5">
            <Truck className="w-3.5 h-3.5 rotate-180" />
            Retours
          </TabsTrigger>
        </TabsList>


        {/* QUOTATIONS */}
        <TabsContent value="quotations">
          <Card className="border-border">
            <CardContent className="p-0">
              {(() => {
                const choix = qtRows.filter((q) => selQt.has(q.quoteId));
                const supprimables = choix.filter((q) => ["draft", "sent", "accepted", "expired"].includes(q.status)).map((q) => q.quoteId);
                return (
                  <BulkBar count={choix.length} onClear={() => setSelQt(new Set())}>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => exportToCSV(choix.map((q) => ({ numero: q.id, date: q.date, client: q.customer, ttc: q.total, validite: q.validUntil, statut: q.status })),
                      [{ key: "numero", header: "N° devis" }, { key: "date", header: "Date" }, { key: "client", header: "Client" }, { key: "ttc", header: "Total TTC" }, { key: "validite", header: "Validité" }, { key: "statut", header: "Statut" }], "devis-selection")}>Exporter la sélection</Button>
                    {perms?.canCreate && supprimables.length > 0 && (
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" disabled={bulk.isPending}
                        onClick={() => runBulk("deleteQuotes", supprimables, `Supprimer ${supprimables.length} devis ? (un devis déjà commandé est refusé)`, () => setSelQt(new Set()))}>
                        Supprimer ({supprimables.length})
                      </Button>
                    )}
                  </BulkBar>
                );
              })()}
              <FilterBar
                search={qtTable.search}
                onSearch={qtTable.setSearch}
                filters={qtTable.filters}
                onFilter={qtTable.setFilter}
                onClear={qtTable.clearFilters}
                filterConfigs={qtTable.filterConfigs}
                activeCount={qtTable.activeFilterCount}
                searchPlaceholder="Search quotes…"
              />
              {loadingQt ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : qtTable.pagedData.length === 0 ? (
                <div className="p-4">
                  <SalesEmptyState
                    title={
                      quotations.length === 0
                        ? "Aucun devis enregistré"
                        : "Aucun devis ne correspond aux filtres"
                    }
                    filterSummary={filterSummary(qtTable.filters.status as string | undefined)}
                    hint={
                      quotations.length > 0
                        ? "Élargissez la période, changez de client ou réinitialisez le statut."
                        : undefined
                    }
                    missingRoleFor={!perms?.canCreate ? "create" : undefined}
                  />
                </div>


              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableCell className="w-8"><input type="checkbox" aria-label="Sélectionner tous les devis" className="rounded border-input"
                        checked={qtTable.pagedData.length > 0 && qtTable.pagedData.every((q) => selQt.has(q.quoteId))}
                        onChange={(e) => setSelQt(e.target.checked ? new Set(qtTable.pagedData.map((q) => q.quoteId)) : new Set())} /></TableCell>
                      <SortableHead label="Quote #" sortKey="id" sort={qtTable.sort} onSort={qtTable.toggleSort} />
                      <SortableHead label="Date" sortKey="date" sort={qtTable.sort} onSort={qtTable.toggleSort} />
                      <SortableHead label="Customer" sortKey="customer" sort={qtTable.sort} onSort={qtTable.toggleSort} />
                      <SortableHead label="Total TTC (XOF)" sortKey="total" sort={qtTable.sort} onSort={qtTable.toggleSort} className="text-right" />
                      <SortableHead label="Valid Until" sortKey="validUntil" sort={qtTable.sort} onSort={qtTable.toggleSort} />
                      <SortableHead label="Status" sortKey="status" sort={qtTable.sort} onSort={qtTable.toggleSort} />
                      <TableCell className="text-[11px] font-medium text-muted-foreground">Actions</TableCell>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {qtTable.pagedData.map((q) => (
                      <TableRow key={q.id} className="text-xs cursor-pointer hover:bg-muted/40" data-testid="sales-row" title="Voir le détail" onClick={() => setSalesView({ kind: "qt", doc: q.raw })}>
                        <SelectBox checked={selQt.has(q.quoteId)} onChange={() => setSelQt((s) => flip(s, q.quoteId))} label={`Sélectionner le devis ${q.id}`} />
                        <TableCell className="font-mono text-primary">{q.id}</TableCell>
                        <TableCell>{q.date}</TableCell>
                        <TableCell className="font-medium">{q.customer}</TableCell>
                        <TableCell className="text-right font-mono">{fmt(Number((q as { total_ttc?: number }).total_ttc ?? q.total))}</TableCell>
                        <TableCell className="text-muted-foreground">{q.validUntil}</TableCell>
                        <TableCell>
                          <Badge className={`text-[10px] ${statusStyle(q.status)}`} variant="outline">
                            {q.status}
                          </Badge>
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <div className="flex gap-1">
                          {perms?.canCreate && ["draft", "sent", "accepted"].includes(q.status) && (
                            <>
                              <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setEditTarget({ kind: "qt", doc: q.raw })}>Modifier</Button>
                              <Button size="sm" variant="ghost" className="h-6 text-[10px] text-destructive" disabled={deleteQuote.isPending}
                                onClick={() => { if (window.confirm(`Supprimer le devis ${q.id} ?`)) deleteQuote.mutate(q.quoteId); }}>Supprimer</Button>
                            </>
                          )}
                          {q.status !== "converted" && q.status !== "expired" ? (
                            canConfirm ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 text-[10px] gap-1"
                                onClick={() => setConfirmConvertId(q.quoteId)}
                              >
                                <ArrowRight className="w-3 h-3" />
                                Convertir → SO
                              </Button>
                            ) : (
                              <Badge variant="outline" className="text-[10px] gap-1" role="img" aria-label={`Action verrouillée — ${SALES_ROLE_HINTS.confirm}`} title={SALES_ROLE_HINTS.confirm}>
                                <Lock className="w-3 h-3" />
                                RBAC
                              </Badge>
                            )
                          ) : (
                            <span className="text-[10px] text-muted-foreground">—</span>
                          )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <PaginationBar
                page={qtTable.page}
                totalPages={qtTable.totalPages}
                totalItems={qtTable.totalItems}
                pageSize={qtTable.pageSize}
                onPageChange={qtTable.setPage}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* SALES ORDERS */}
        <TabsContent value="orders">
          <Card className="border-border">
            <CardContent className="p-0">
              {(() => {
                const choix = soRows.filter((o) => selSo.has(o.soId));
                const brouillons = choix.filter((o) => o.status === "draft").map((o) => o.soId);
                return (
                  <BulkBar count={choix.length} onClear={() => setSelSo(new Set())}>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => exportToCSV(choix.map((o) => ({ numero: o.id, date: o.date, client: o.customer, devis: o.qtRef, ttc: o.total, statut: o.status })),
                      [{ key: "numero", header: "N° commande" }, { key: "date", header: "Date" }, { key: "client", header: "Client" }, { key: "devis", header: "Devis" }, { key: "ttc", header: "Total TTC" }, { key: "statut", header: "Statut" }], "commandes-selection")}>Exporter la sélection</Button>
                    {canConfirm && brouillons.length > 0 && (
                      <Button size="sm" variant="outline" className="h-7 text-xs" disabled={bulk.isPending}
                        onClick={() => runBulk("confirmOrders", brouillons, `Confirmer ${brouillons.length} commande(s) ? (limite de crédit contrôlée pour chacune)`, () => setSelSo(new Set()))}>
                        Confirmer ({brouillons.length})
                      </Button>
                    )}
                    {perms?.canCreate && brouillons.length > 0 && (
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" disabled={bulk.isPending}
                        onClick={() => runBulk("deleteOrders", brouillons, `Supprimer ${brouillons.length} commande(s) en brouillon ?`, () => setSelSo(new Set()))}>
                        Supprimer ({brouillons.length})
                      </Button>
                    )}
                  </BulkBar>
                );
              })()}
              <FilterBar
                search={soTable.search}
                onSearch={soTable.setSearch}
                filters={soTable.filters}
                onFilter={soTable.setFilter}
                onClear={soTable.clearFilters}
                filterConfigs={soTable.filterConfigs}
                activeCount={soTable.activeFilterCount}
                searchPlaceholder="Search orders…"
              />
              {loadingSo ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : soTable.pagedData.length === 0 ? (
                <div className="p-4">
                  <SalesEmptyState
                    title={
                      orders.length === 0
                        ? "Aucune commande enregistrée"
                        : "Aucune commande ne correspond aux filtres"
                    }
                    filterSummary={filterSummary(soTable.filters.status as string | undefined)}
                    hint={
                      orders.length > 0
                        ? "Élargissez la période, changez de client ou réinitialisez le statut."
                        : undefined
                    }
                    missingRoleFor={!canConfirm ? "confirm" : undefined}
                  />
                </div>


              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableCell className="w-8"><input type="checkbox" aria-label="Sélectionner toutes les commandes" className="rounded border-input"
                        checked={soTable.pagedData.length > 0 && soTable.pagedData.every((o) => selSo.has(o.soId))}
                        onChange={(e) => setSelSo(e.target.checked ? new Set(soTable.pagedData.map((o) => o.soId)) : new Set())} /></TableCell>
                      <SortableHead label="SO #" sortKey="id" sort={soTable.sort} onSort={soTable.toggleSort} />
                      <SortableHead label="Date" sortKey="date" sort={soTable.sort} onSort={soTable.toggleSort} />
                      <SortableHead label="Customer" sortKey="customer" sort={soTable.sort} onSort={soTable.toggleSort} />
                      <SortableHead label="Quote Ref" sortKey="qtRef" sort={soTable.sort} onSort={soTable.toggleSort} />
                      <SortableHead label="Total TTC (XOF)" sortKey="total" sort={soTable.sort} onSort={soTable.toggleSort} className="text-right" />
                      <SortableHead label="Status" sortKey="status" sort={soTable.sort} onSort={soTable.toggleSort} />
                      <TableCell className="text-[11px] font-medium text-muted-foreground">Actions</TableCell>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {soTable.pagedData.map((so) => (
                      <TableRow key={so.id} className="text-xs cursor-pointer hover:bg-muted/40" data-testid="sales-row" title="Voir le détail" onClick={() => setSalesView({ kind: "so", doc: so.raw })}>
                        <SelectBox checked={selSo.has(so.soId)} onChange={() => setSelSo((s) => flip(s, so.soId))} label={`Sélectionner la commande ${so.id}`} />
                        <TableCell className="font-mono text-primary">{so.id}</TableCell>
                        <TableCell>{so.date}</TableCell>
                        <TableCell className="font-medium">{so.customer}</TableCell>
                        <TableCell className="font-mono text-muted-foreground">{so.qtRef}</TableCell>
                        <TableCell className="text-right font-mono">{fmt(Number((so as { total_ttc?: number }).total_ttc ?? so.total))}</TableCell>
                        <TableCell>
                          <Badge className={`text-[10px] ${statusStyle(so.status)}`} variant="outline">
                            {so.status}
                          </Badge>
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <div className="flex gap-1">
                            {so.status === "draft" && perms?.canCreate && (
                              <>
                                {!so.raw.quotation_id && (
                                  <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setEditTarget({ kind: "so", doc: so.raw })}>Modifier</Button>
                                )}
                                <Button size="sm" variant="ghost" className="h-6 text-[10px] text-destructive" disabled={deleteOrder.isPending}
                                  onClick={() => { if (window.confirm(`Supprimer la commande ${so.id} ?` + (so.raw.quotation_id ? " Les quantités reviennent au devis." : ""))) deleteOrder.mutate(so.soId); }}>Supprimer</Button>
                              </>
                            )}
                            {so.status === "draft" &&
                              (canConfirm ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 text-[10px] gap-1"
                                  onClick={() => setConfirmSoId(so.soId)}
                                >
                                  <CheckCircle2 className="w-3 h-3" />
                                  Confirmer
                                </Button>
                              ) : (
                                <Badge variant="outline" className="text-[10px] gap-1" role="img" aria-label={`Action verrouillée — ${SALES_ROLE_HINTS.confirm}`} title={SALES_ROLE_HINTS.confirm}>
                                  <Lock className="w-3 h-3" />
                                  RBAC
                                </Badge>
                              ))}
                            {(so.status === "confirmed" || so.status === "partially_delivered") &&
                              (canDeliver ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 text-[10px] gap-1"
                                  onClick={() => setDeliverSoId(so.soId)}
                                >
                                  <Truck className="w-3 h-3" />
                                  Livrer
                                </Button>
                              ) : (
                                <Badge variant="outline" className="text-[10px] gap-1" role="img" aria-label={`Action verrouillée — ${SALES_ROLE_HINTS.deliver}`} title={SALES_ROLE_HINTS.deliver}>
                                  <Lock className="w-3 h-3" />
                                  RBAC
                                </Badge>
                              ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <PaginationBar
                page={soTable.page}
                totalPages={soTable.totalPages}
                totalItems={soTable.totalItems}
                pageSize={soTable.pageSize}
                onPageChange={soTable.setPage}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* DELIVERIES */}
        <TabsContent value="deliveries">
          <Card className="border-border">
            <CardContent className="p-0">
              {(() => {
                const choix = dnRows.filter((d) => selDn.has(d.dnId));
                const aFacturer = choix.filter((d) => d.status === "completed" && !d.invoiced).map((d) => d.dnId);
                return (
                  <BulkBar count={choix.length} onClear={() => setSelDn(new Set())}>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => exportToCSV(choix.map((d) => ({ numero: d.id, commande: d.soRef, date: d.date, client: d.customer, statut: d.status, facture: d.invoiced ? "oui" : "non" })),
                      [{ key: "numero", header: "N° livraison" }, { key: "commande", header: "Commande" }, { key: "date", header: "Date" }, { key: "client", header: "Client" }, { key: "statut", header: "Statut" }, { key: "facture", header: "Facturée" }], "livraisons-selection")}>Exporter la sélection</Button>
                    {canInvoice && aFacturer.length > 0 && (
                      <Button size="sm" variant="outline" className="h-7 text-xs" disabled={bulk.isPending}
                        onClick={() => runBulk("invoiceDeliveries", aFacturer, `Préparer ${aFacturer.length} facture(s) brouillon ?`, () => setSelDn(new Set()))}>
                        Facturer ({aFacturer.length})
                      </Button>
                    )}
                  </BulkBar>
                );
              })()}
              <FilterBar
                search={dnTable.search}
                onSearch={dnTable.setSearch}
                filters={dnTable.filters}
                onFilter={dnTable.setFilter}
                onClear={dnTable.clearFilters}
                filterConfigs={dnTable.filterConfigs}
                activeCount={dnTable.activeFilterCount}
                searchPlaceholder="Search deliveries…"
              />
              {loadingDn ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : dnTable.pagedData.length === 0 ? (
                <div className="p-4">
                  <SalesEmptyState
                    title={
                      deliveries.length === 0
                        ? "Aucune livraison enregistrée"
                        : "Aucune livraison ne correspond aux filtres"
                    }
                    filterSummary={filterSummary(dnTable.filters.status as string | undefined)}
                    hint={
                      deliveries.length > 0
                        ? "Élargissez la période, changez de client ou réinitialisez le statut."
                        : undefined
                    }
                    missingRoleFor={
                      !canDeliver ? "deliver" : !canInvoice ? "invoice" : undefined
                    }
                  />
                </div>


              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableCell className="w-8"><input type="checkbox" aria-label="Sélectionner toutes les livraisons" className="rounded border-input"
                        checked={dnTable.pagedData.length > 0 && dnTable.pagedData.every((d) => selDn.has(d.dnId))}
                        onChange={(e) => setSelDn(e.target.checked ? new Set(dnTable.pagedData.map((d) => d.dnId)) : new Set())} /></TableCell>
                      <SortableHead label="DN #" sortKey="id" sort={dnTable.sort} onSort={dnTable.toggleSort} />
                      <SortableHead label="SO Ref" sortKey="soRef" sort={dnTable.sort} onSort={dnTable.toggleSort} />
                      <SortableHead label="Date" sortKey="date" sort={dnTable.sort} onSort={dnTable.toggleSort} />
                      <SortableHead label="Customer" sortKey="customer" sort={dnTable.sort} onSort={dnTable.toggleSort} />
                      <SortableHead label="Status" sortKey="status" sort={dnTable.sort} onSort={dnTable.toggleSort} />
                      <TableCell className="text-[11px] font-medium text-muted-foreground">Actions</TableCell>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dnTable.pagedData.map((d) => (
                      <TableRow key={d.id} className="text-xs cursor-pointer hover:bg-muted/40" data-testid="sales-row" title="Voir le détail" onClick={() => setSalesView({ kind: "dn", doc: d.raw })}>
                        <SelectBox checked={selDn.has(d.dnId)} onChange={() => setSelDn((s) => flip(s, d.dnId))} label={`Sélectionner la livraison ${d.id}`} />
                        <TableCell className="font-mono text-primary">{d.id}</TableCell>
                        <TableCell className="font-mono text-muted-foreground">{d.soRef}</TableCell>
                        <TableCell>{d.date}</TableCell>
                        <TableCell className="font-medium">{d.customer}</TableCell>
                        <TableCell>
                          <Badge className={`text-[10px] ${statusStyle(d.status)}`} variant="outline">
                            {d.status}
                          </Badge>
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <div className="flex gap-1 items-center">
                          {d.status === "completed" && canDeliver && (
                            <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setReturnDn(d.raw)}>Retour</Button>
                          )}
                          {d.invoiced ? (
                            <Badge variant="outline" className="text-[10px] gap-1">
                              <Receipt className="w-3 h-3" />
                              Facturé
                            </Badge>
                          ) : d.status === "completed" ? (
                            canInvoice ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 text-[10px] gap-1"
                                onClick={() => setConfirmInvoiceDnId(d.dnId)}
                              >
                                <Receipt className="w-3 h-3" />
                                Facturer
                              </Button>
                            ) : (
                              <Badge variant="outline" className="text-[10px] gap-1" role="img" aria-label={`Action verrouillée — ${SALES_ROLE_HINTS.invoice}`} title={SALES_ROLE_HINTS.invoice}>
                                <Lock className="w-3 h-3" />
                                RBAC
                              </Badge>
                            )
                          ) : (
                            <span className="text-[10px] text-muted-foreground">—</span>
                          )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <PaginationBar
                page={dnTable.page}
                totalPages={dnTable.totalPages}
                totalItems={dnTable.totalItems}
                pageSize={dnTable.pageSize}
                onPageChange={dnTable.setPage}
              />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="returns">
          <ReturnsTab />
        </TabsContent>
      </Tabs>

      <div className="space-y-4 mt-6">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">GL Posting — Sales</h2>
        </div>
        <GLPostingKPIsLive module="Sales" />
        <GLBatchHistoryLive module="Sales" />
      </div>

      <CreateQuotationDialog open={showNewQuote} onClose={() => setShowNewQuote(false)} />
      <CreateOrderDialog open={showNewOrder} onClose={() => setShowNewOrder(false)} />
      <DeliverDialog soId={deliverSoId} onClose={() => setDeliverSoId(null)} />
      <SalesDocDialog view={salesView} onClose={() => setSalesView(null)} />
      <ReturnDialog dn={returnDn} onClose={() => setReturnDn(null)} />
      <EditSalesDocDialog target={editTarget} onClose={() => setEditTarget(null)} />

      <AlertDialog open={!!confirmConvertId} onOpenChange={(o) => !o && setConfirmConvertId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Convertir ce devis en commande ?</AlertDialogTitle>
            <AlertDialogDescription>
              Une nouvelle commande de vente sera créée avec les mêmes lignes. Le devis sera marqué
              comme converti.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (confirmConvertId) await convert.mutateAsync(confirmConvertId);
                setConfirmConvertId(null);
              }}
            >
              {convert.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Convertir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmSoId} onOpenChange={(o) => !o && setConfirmSoId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer cette commande ?</AlertDialogTitle>
            <AlertDialogDescription>
              La commande passera au statut « confirmed » et pourra être livrée. La limite de crédit du client
              est contrôlée : au-delà, seul un utilisateur habilité peut confirmer, en donnant un motif.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {creditBlock && (
            <div className="space-y-1.5" data-testid="credit-block">
              <p className="text-xs text-destructive">{creditBlock}</p>
              {canOverride ? (
                <>
                  <Label className="text-xs" htmlFor="credit-override-reason">Motif du dépassement (obligatoire)</Label>
                  <Input id="credit-override-reason" className="h-8 text-xs" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
                </>
              ) : (
                <p className="text-xs text-muted-foreground">Demandez la levée à un responsable habilité (droit « dépassement de crédit »).</p>
              )}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setCreditBlock(null); setOverrideReason(""); }}>Annuler</AlertDialogCancel>
            <Button
              size="sm"
              disabled={confirmSo.isPending || (!!creditBlock && (!canOverride || !overrideReason.trim()))}
              onClick={async () => {
                if (!confirmSoId) return;
                try {
                  await confirmSo.mutateAsync({ soId: confirmSoId, reason: creditBlock ? overrideReason.trim() : undefined });
                  setConfirmSoId(null);
                  setCreditBlock(null);
                  setOverrideReason("");
                } catch (e) {
                  const err = e as { code?: string; message?: string };
                  if (err.code === "QG010" && /Limite de crédit/.test(err.message ?? "")) setCreditBlock(err.message ?? "");
                  else setConfirmSoId(null);
                }
              }}
            >
              {confirmSo.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : creditBlock ? "Confirmer malgré le dépassement" : "Confirmer"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!confirmInvoiceDnId}
        onOpenChange={(o) => !o && setConfirmInvoiceDnId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Générer la facture client ?</AlertDialogTitle>
            <AlertDialogDescription>
              Une facture AR sera créée à partir de cette livraison et reliée à la commande
              d'origine.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (confirmInvoiceDnId) await invoice.mutateAsync(confirmInvoiceDnId);
                setConfirmInvoiceDnId(null);
              }}
            >
              {invoice.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Facturer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}
