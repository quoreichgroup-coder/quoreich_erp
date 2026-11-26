import { useRef, useState, type RefObject } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, type MobileTableColumn } from "@/components/ui/table";
import { DocumentDetail, documentFileName } from "@/components/DocumentDetail";
import { useAPInvoices, type APInvoice } from "@/hooks/use-ap-data";
import { useMyAccess } from "@/hooks/use-my-access";
import {
  useAPCreditNotes, useCreateAPCreditNote, useCreateSupplierReturn, useCreditSupplierReturn, useSupplierReturns,
  type APCreditNote, type SupplierReturn,
} from "@/hooks/use-supplier-returns";
import { creditNoteRoom, creditTax, returnableLines, returnValue, validateSupplierReturn, type PoLineRef } from "@/lib/supplier-return";

/*
 * Retours et avoirs fournisseurs (V52 ; SAP retour de livraison + avoir MIRO, Sage « retour
 * fournisseur » puis « avoir fournisseur »). Le retour part d'une réception validée ; l'avoir cite
 * une facture approuvée de la même commande. La base numérote, sort le stock, comptabilise et impute.
 */
const fmt = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const today = () => new Date().toISOString().split("T")[0];
const num = (s: string | undefined) => Number(String(s ?? "").replace(",", ".")) || 0;

/** Factures approuvées d'une commande, susceptibles d'être créditées. */
function useCreditableInvoices(poId: string | undefined): APInvoice[] {
  const { data: invoices = [] } = useAPInvoices();
  return invoices.filter((i: any) => i.po_id === poId && i.approval_status === "approved");
}

function InvoicePicker({ id, invoices, value, onChange, allowNone }: {
  id: string; invoices: APInvoice[]; value: string; onChange: (v: string) => void; allowNone: boolean;
}) {
  return (
    <select id={id} className="h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base sm:h-8 sm:text-xs" value={value} onChange={(e) => onChange(e.target.value)}>
      {allowNone && <option value="">Aucune — avoir à recevoir plus tard</option>}
      {!allowNone && <option value="">Choisir la facture…</option>}
      {invoices.map((i) => <option key={i.id} value={i.id}>{i.invoice_number} — {fmt(i.total)} XOF</option>)}
    </select>
  );
}

export function SupplierReturnDialog({ gr, poLines, open, onClose, returnFocusRef }: {
  gr: { id: string; gr_number: string; po_id: string; receipt_date: string; lines?: any[] | null; po?: any };
  poLines: PoLineRef[]; open: boolean; onClose: () => void; returnFocusRef?: RefObject<HTMLButtonElement | null>;
}) {
  const { data: returns = [] } = useSupplierReturns();
  const invoices = useCreditableInvoices(gr.po_id);
  const create = useCreateSupplierReturn();
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(today());
  const [replacement, setReplacement] = useState(false);
  const [invoiceId, setInvoiceId] = useState("");
  const [reference, setReference] = useState("");
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const done = returns.filter((r) => r.gr_id === gr.id).flatMap((r) => r.lines);
  const lines = returnableLines(gr.lines ?? [], poLines, done);
  const entries = lines.map((l) => ({ ...l, quantity: num(qtys[l.id]) }));
  const value = returnValue(entries);
  const invoice = invoices.find((i) => i.id === invoiceId);
  const error = validateSupplierReturn(entries, reason);

  const submit = () => create.mutate({
    grId: gr.id, reason: reason.trim(), date, replacement, invoiceId: invoiceId || null, supplierReference: reference.trim(),
    lines: entries.filter((e) => e.quantity > 0).map((e) => ({ gr_line_id: e.id, quantity: e.quantity })),
  }, { onSuccess: () => { setReason(""); setQtys({}); setInvoiceId(""); setReference(""); onClose(); } });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent returnFocusRef={returnFocusRef} className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-sm">Retour fournisseur sur la réception {gr.gr_number}</DialogTitle>
          <DialogDescription className="text-xs">
            Les quantités retournées sortent du stock au coût de la commande. Avec une facture choisie, l'avoir fournisseur
            est comptabilisé aussitôt et réduit le reste à payer ; sinon il s'établira à réception de l'avoir du fournisseur.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="col-span-1 space-y-1.5 sm:col-span-2">
              <Label className="text-xs" htmlFor="return-reason">Motif (obligatoire)</Label>
              <Input id="return-reason" className="h-11 text-base sm:h-8 sm:text-xs" value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="Articles défectueux, erreur de référence, excédent livré…" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="return-date">Date du retour</Label>
              <Input id="return-date" type="date" className="h-11 text-base sm:h-8 sm:text-xs" min={gr.receipt_date} value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div role="region" aria-label="Lignes à retourner" tabIndex={0} className="overflow-x-auto rounded-md border border-border focus-visible:outline-2 focus-visible:outline-ring">
          <table className="w-full min-w-[40rem] text-xs">
            <thead><tr className="text-muted-foreground border-b border-border">
              <th className="text-left py-1">Article</th><th className="text-right">Reçu</th><th className="text-right">Déjà retourné</th>
              <th className="text-right">Retournable</th><th className="text-right">Coût unitaire</th><th className="text-right w-28">À retourner</th>
            </tr></thead>
            <tbody>
              {lines.length === 0 ? (
                <tr><td colSpan={6} className="py-4 text-center text-muted-foreground">Aucune ligne reçue.</td></tr>
              ) : lines.map((l, i) => (
                <tr key={l.id} className="border-b border-border/50">
                  <td className="py-1">{l.description}</td>
                  <td className="text-right tabular-nums">{fmt(l.quantity_received)}</td>
                  <td className="text-right tabular-nums">{fmt(l.returned)}</td>
                  <td className="text-right tabular-nums">{fmt(l.returnable)}</td>
                  <td className="text-right tabular-nums">{fmt(l.unit_cost)}</td>
                  <td className="text-right">
                    <Input aria-label={`Quantité à retourner ligne ${i + 1}`} className="h-11 text-base text-right sm:h-8 sm:text-xs" inputMode="decimal"
                      disabled={l.returnable <= 0} value={qtys[l.id] ?? ""} onChange={(e) => setQtys({ ...qtys, [l.id]: e.target.value })} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="font-medium"><td colSpan={5} className="text-right py-1">Valeur du retour (HT)</td>
              <td className="text-right tabular-nums" data-testid="return-value">{fmt(value)} XOF</td></tr></tfoot>
          </table>
          </div>
          <label className="flex min-h-11 items-start gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-5 shrink-0" checked={replacement} onChange={(e) => setReplacement(e.target.checked)} />
            Remplacement attendu : les quantités retournées redeviennent à recevoir sur la commande
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="return-invoice">Facture fournisseur à créditer</Label>
              <InvoicePicker id="return-invoice" invoices={invoices} value={invoiceId} onChange={setInvoiceId} allowNone />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="return-reference">N° de l'avoir du fournisseur</Label>
              <Input id="return-reference" className="h-11 text-base sm:h-8 sm:text-xs" disabled={!invoiceId} value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
          </div>
          {invoice && (
            <p className="text-xs text-muted-foreground">
              Avoir : {fmt(value)} HT + {fmt(creditTax(value, invoice))} TVA (taux de la facture {invoice.invoice_number}).
            </p>
          )}
          {error && (reason || value > 0) && <p className="text-xs text-destructive" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Annuler</Button>
          <Button size="sm" onClick={submit} disabled={!!error || create.isPending}>
            {create.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />}Enregistrer le retour
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreditReturnDialog({ ret, onClose, returnFocusRef, completedFocusRef }: { ret: SupplierReturn | null; onClose: () => void; returnFocusRef?: RefObject<HTMLElement | null>; completedFocusRef?: RefObject<HTMLButtonElement | null> }) {
  const invoices = useCreditableInvoices(ret?.po_id);
  const credit = useCreditSupplierReturn();
  const [invoiceId, setInvoiceId] = useState("");
  const [reference, setReference] = useState("");
  const [date, setDate] = useState(today());
  if (!ret) return null;
  const invoice = invoices.find((i) => i.id === invoiceId);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent returnFocusRef={returnFocusRef} className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">Avoir du retour {ret.return_number}</DialogTitle>
          <DialogDescription className="text-xs">Valeur retournée : {fmt(ret.total_value)} XOF HT, TVA au taux de la facture choisie.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="credit-return-invoice">Facture de la commande {ret.po_number}</Label>
            <InvoicePicker id="credit-return-invoice" invoices={invoices} value={invoiceId} onChange={setInvoiceId} allowNone={false} />
            {invoices.length === 0 && <p className="text-xs text-muted-foreground">Aucune facture approuvée sur cette commande.</p>}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="credit-return-reference">N° de l'avoir du fournisseur</Label>
              <Input id="credit-return-reference" className="h-11 text-base sm:h-8 sm:text-xs" value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="credit-return-date">Date de l'avoir</Label>
              <Input id="credit-return-date" type="date" className="h-11 text-base sm:h-8 sm:text-xs" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          {invoice && <p className="text-xs text-muted-foreground">TTC : {fmt(ret.total_value + creditTax(ret.total_value, invoice))} XOF</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Annuler</Button>
          <Button size="sm" disabled={!invoiceId || credit.isPending}
            onClick={() => credit.mutate({ returnId: ret.id, invoiceId, supplierReference: reference.trim(), date }, { onSuccess: () => {
              // Le bouton d'avoir disparaît au succès ; la référence du retour reste.
              if (returnFocusRef && completedFocusRef?.current?.isConnected) returnFocusRef.current = completedFocusRef.current;
              onClose();
            } })}>
            Comptabiliser l'avoir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SupplierReturnView({ ret, onClose, returnFocusRef }: { ret: SupplierReturn | null; onClose: () => void; returnFocusRef?: RefObject<HTMLButtonElement | null> }) {
  if (!ret) return null;
  const title = `Retour fournisseur ${ret.return_number}`;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent returnFocusRef={returnFocusRef} className="max-w-3xl">
        <DialogHeader><DialogTitle className="text-sm">{title}</DialogTitle></DialogHeader>
        <DocumentDetail
          title={title} fileName={documentFileName(title)} attachments={{ docType: "supplier_return", docId: ret.id }}
          header={[["Fournisseur", ret.supplier_name], ["Réception", ret.gr_number], ["Commande", ret.po_number], ["Date", ret.return_date],
            ["Motif", ret.reason], ["Remplacement attendu", ret.replacement_expected ? "Oui" : "Non"],
            ["Avoir fournisseur", ret.credit_note_number ?? "À recevoir"]]}
          columns={[{ label: "Article" }, { label: "Quantité", align: "right" }, { label: "Coût unitaire", align: "right" }, { label: "Valeur", align: "right" }]}
          rows={ret.lines.map((l) => [l.description ?? "Ligne", fmt(l.quantity), fmt(l.unit_cost), fmt(Math.round(l.quantity * l.unit_cost * 100) / 100)])}
          footer={[["Valeur du retour (HT)", `${fmt(ret.total_value)} XOF`, true]]}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Onglet « Retours » des achats. */
export function SupplierReturnsList() {
  const { data: returns = [], isLoading } = useSupplierReturns();
  const { data: access } = useMyAccess();
  const canCredit = (access?.permissions ?? []).includes("ap.credit_note");
  const [view, setView] = useState<SupplierReturn | null>(null);
  const [credit, setCredit] = useState<SupplierReturn | null>(null);
  const viewTrigger = useRef<HTMLButtonElement | null>(null);
  const creditTrigger = useRef<HTMLElement | null>(null);
  const creditedReturnTrigger = useRef<HTMLButtonElement | null>(null);
  const columns: MobileTableColumn[] = [
    { label: "N° retour", kind: "primary" }, { label: "Date" }, { label: "Réception" }, { label: "Commande" },
    { label: "Fournisseur", wide: true }, { label: "Motif", wide: true }, { label: "Valeur HT", wide: true }, { label: "Avoir", wide: true },
  ];
  return (
    <section aria-label="Retours fournisseurs" className="space-y-2">
      {returns.length === 0 ? (
        <p className="text-xs text-muted-foreground p-4">{isLoading ? "Chargement…" : "Aucun retour fournisseur. Un retour part d'une réception validée (bouton « Retour »)."}</p>
      ) : (
        <Table className="text-xs" mobileColumns={columns} aria-label="Retours fournisseurs">
          <TableHeader><TableRow>
            <TableHead>N° retour</TableHead><TableHead>Date</TableHead><TableHead>Réception</TableHead>
            <TableHead>Commande</TableHead><TableHead>Fournisseur</TableHead><TableHead>Motif</TableHead>
            <TableHead className="text-right">Valeur HT</TableHead><TableHead>Avoir</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {returns.map((r) => (
              <TableRow key={r.id} data-testid="supplier-return-row" className="cursor-pointer" onClick={event => { viewTrigger.current = event.currentTarget.querySelector<HTMLButtonElement>("button"); setView(r); }}>
                <TableCell className="px-3 py-2 font-mono"><Button type="button" variant="link" className="h-auto min-h-11 max-w-full whitespace-normal break-words p-0 text-left font-mono md:min-h-0 md:whitespace-nowrap" onClick={event => { event.stopPropagation(); viewTrigger.current = event.currentTarget; setView(r); }}>{r.return_number}</Button></TableCell>
                <TableCell className="px-3 py-2 md:whitespace-nowrap">{r.return_date}</TableCell>
                <TableCell className="px-3 py-2 font-mono md:whitespace-nowrap">{r.gr_number}</TableCell>
                <TableCell className="px-3 py-2 font-mono md:whitespace-nowrap">{r.po_number}</TableCell>
                <TableCell className="px-3 py-2"><span className="block md:max-w-64 md:truncate" title={r.supplier_name}>{r.supplier_name}</span></TableCell>
                <TableCell className="px-3 py-2"><span className="block md:max-w-64 md:truncate" title={`${r.reason}${r.replacement_expected ? " · remplacement attendu" : ""}`}>{r.reason}{r.replacement_expected ? " · remplacement attendu" : ""}</span></TableCell>
                <TableCell className="px-3 py-2 text-right tabular-nums md:whitespace-nowrap">{fmt(r.total_value)}</TableCell>
                <TableCell className="px-3 py-2 max-md:border-t max-md:pt-3" onClick={(e) => e.stopPropagation()}>
                  {r.credit_note_number ? <span className="font-mono">{r.credit_note_number}</span>
                    : canCredit && r.total_value > 0 ? <Button size="sm" variant="outline" className="min-h-11 text-sm md:min-h-0 md:text-xs" onClick={event => {
                      creditTrigger.current = event.currentTarget;
                      creditedReturnTrigger.current = event.currentTarget.closest("tr")?.querySelector<HTMLButtonElement>("button") ?? null;
                      setCredit(r);
                    }}>Établir l'avoir</Button>
                    : <span className="text-muted-foreground">À recevoir</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <SupplierReturnView ret={view} onClose={() => setView(null)} returnFocusRef={viewTrigger} />
      <CreditReturnDialog ret={credit} onClose={() => setCredit(null)} returnFocusRef={creditTrigger} completedFocusRef={creditedReturnTrigger} />
    </section>
  );
}

/** Avoir fournisseur saisi sur une facture approuvée (remise, erreur de prix, retour hors réception…). */
export function APCreditNoteDialog({ inv, open, onClose, returnFocusRef }: { inv: APInvoice; open: boolean; onClose: () => void; returnFocusRef?: RefObject<HTMLButtonElement | null> }) {
  const { data: notes = [] } = useAPCreditNotes(open ? inv.id : undefined);
  const create = useCreateAPCreditNote();
  const room = creditNoteRoom(inv, notes);
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(today());
  const [sub, setSub] = useState("");
  const [tax, setTax] = useState("");
  const [reference, setReference] = useState("");
  const s = num(sub), t = num(tax);
  const error = !reason.trim() ? "Le motif est obligatoire."
    : s < 0 || t < 0 || s + t <= 0 ? "Saisissez un montant HT et / ou une TVA."
    : s > room.subtotal ? `HT au plus ${fmt(room.subtotal)} (HT de la facture moins les avoirs reçus).`
    : t > room.tax ? `TVA au plus ${fmt(room.tax)}.` : null;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent returnFocusRef={returnFocusRef} className="max-w-lg max-sm:[&_input]:min-h-11 max-sm:[&_input]:text-base">
        <DialogHeader>
          <DialogTitle className="text-sm">Avoir fournisseur sur la facture {inv.invoice_number}</DialogTitle>
          <DialogDescription className="text-xs">
            Écriture inverse au journal des achats (Fournisseurs / Achats / TVA récupérable), imputée sur le reste à payer.
            Pour des marchandises renvoyées, passer plutôt par le retour sur la réception (le stock suit).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="ap-credit-reason">Motif (obligatoire)</Label>
            <Input id="ap-credit-reason" className="h-8 text-xs" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Remise, erreur de prix, ristourne…" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="ap-credit-subtotal">Montant HT (reste {fmt(room.subtotal)})</Label>
              <Input id="ap-credit-subtotal" className="h-8 text-xs text-right" inputMode="decimal" value={sub}
                onChange={(e) => { setSub(e.target.value); setTax(String(creditTax(num(e.target.value), inv))); }} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="ap-credit-tax">TVA (reste {fmt(room.tax)})</Label>
              <Input id="ap-credit-tax" className="h-8 text-xs text-right" inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="ap-credit-reference">N° de l'avoir du fournisseur</Label>
              <Input id="ap-credit-reference" className="h-8 text-xs" value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="ap-credit-date">Date de l'avoir</Label>
              <Input id="ap-credit-date" type="date" className="h-8 text-xs" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <p className="text-xs font-medium">Total TTC : {fmt(s + t)} XOF</p>
          {error && (reason || sub) && <p className="text-xs text-destructive" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Annuler</Button>
          <Button size="sm" disabled={!!error || create.isPending}
            onClick={() => create.mutate({ invoiceId: inv.id, reason: reason.trim(), date, subtotal: s, tax: t, supplierReference: reference.trim() },
              { onSuccess: () => { setReason(""); setSub(""); setTax(""); setReference(""); onClose(); } })}>
            Comptabiliser l'avoir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function APCreditNoteView({ note, onClose, returnFocusRef }: { note: APCreditNote | null; onClose: () => void; returnFocusRef?: RefObject<HTMLButtonElement | null> }) {
  if (!note) return null;
  const title = `Avoir fournisseur ${note.credit_note_number}`;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent returnFocusRef={returnFocusRef} className="max-w-2xl">
        <DialogHeader><DialogTitle className="text-sm">{title}</DialogTitle></DialogHeader>
        <DocumentDetail
          title={title} fileName={documentFileName(title)} attachments={{ docType: "ap_credit_note", docId: note.id }}
          header={[["Fournisseur", note.supplier_name], ["Facture d'origine", note.invoice_number], ["Date", note.credit_date],
            ["Réf. fournisseur", note.supplier_reference ?? "—"], ["Retour", note.return_number ?? "—"], ["Motif", note.reason]]}
          columns={[{ label: "Libellé" }, { label: "Montant", align: "right" }]}
          rows={[["Achats (HT)", fmt(note.subtotal)], ["TVA récupérable", fmt(note.tax_amount)]]}
          footer={[["Total TTC", `${fmt(note.total)} XOF`, true], ["Imputé sur la facture", `${fmt(note.amount_allocated)} XOF`],
            ["Crédit fournisseur non imputé", `${fmt(note.total - note.amount_allocated)} XOF`]]}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Avoirs fournisseurs (d'une facture, ou de la société) ; clic → vue imprimable. */
export function APCreditNotesList({ invoiceId, title = "Avoirs fournisseurs" }: { invoiceId?: string; title?: string }) {
  const { data: notes = [], isLoading } = useAPCreditNotes(invoiceId);
  const [view, setView] = useState<APCreditNote | null>(null);
  const viewTrigger = useRef<HTMLButtonElement | null>(null);
  const columns: MobileTableColumn[] = [
    { label: "N° avoir", kind: "primary" }, { label: "Date" },
    ...(!invoiceId ? [{ label: "Facture" }, { label: "Fournisseur", wide: true }] : []),
    { label: "Réf. fournisseur" }, { label: "Motif", wide: true }, { label: "TTC" }, { label: "Non imputé" },
  ];
  if (invoiceId && (isLoading || notes.length === 0)) return null;
  return (
    <section aria-label={title} className="space-y-2">
      <h3 className="text-xs font-semibold text-foreground">{title}</h3>
      {notes.length === 0 ? (
        <p className="text-xs text-muted-foreground">{isLoading ? "Chargement…" : "Aucun avoir fournisseur."}</p>
      ) : (
        <Table className="text-xs" mobileColumns={columns} aria-label={title}>
          <TableHeader><TableRow>
            <TableHead>N° avoir</TableHead><TableHead>Date</TableHead>
            {!invoiceId && <TableHead>Facture</TableHead>}
            {!invoiceId && <TableHead>Fournisseur</TableHead>}
            <TableHead>Réf. fournisseur</TableHead><TableHead>Motif</TableHead><TableHead className="text-right">TTC</TableHead><TableHead className="text-right">Non imputé</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {notes.map((n) => (
              <TableRow key={n.id} data-testid="ap-credit-note-row" className="cursor-pointer" onClick={event => { viewTrigger.current = event.currentTarget.querySelector<HTMLButtonElement>("button"); setView(n); }}>
                <TableCell className="px-3 py-2 font-mono"><Button type="button" variant="link" className="h-auto min-h-11 max-w-full whitespace-normal break-words p-0 text-left font-mono md:min-h-0 md:whitespace-nowrap" onClick={event => { event.stopPropagation(); viewTrigger.current = event.currentTarget; setView(n); }}>{n.credit_note_number}</Button></TableCell>
                <TableCell className="px-3 py-2 md:whitespace-nowrap">{n.credit_date}</TableCell>
                {!invoiceId && <TableCell className="px-3 py-2 font-mono md:whitespace-nowrap">{n.invoice_number}</TableCell>}
                {!invoiceId && <TableCell className="px-3 py-2"><span className="block md:max-w-64 md:truncate" title={n.supplier_name}>{n.supplier_name}</span></TableCell>}
                <TableCell className="px-3 py-2 md:whitespace-nowrap">{n.supplier_reference ?? "—"}</TableCell>
                <TableCell className="px-3 py-2"><span className="block md:max-w-64 md:truncate" title={n.reason}>{n.reason}</span></TableCell>
                <TableCell className="px-3 py-2 text-right tabular-nums md:whitespace-nowrap">{fmt(n.total)}</TableCell>
                <TableCell className="px-3 py-2 text-right tabular-nums md:whitespace-nowrap">{fmt(n.total - n.amount_allocated)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <APCreditNoteView note={view} onClose={() => setView(null)} returnFocusRef={viewTrigger} />
    </section>
  );
}
