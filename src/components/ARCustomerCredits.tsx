import { TreasuryAccountSelect } from "@/components/TreasuryAccountSelect";
import { useRef, useState, type RefObject } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, type MobileTableColumn } from "@/components/ui/table";
import { useCustomers, type ARInvoice } from "@/hooks/use-ar-data";
import { useSalesOrders } from "@/hooks/use-sales-data";
import { useApplyCredit, useCustomerCredits, useRecordAdvance, useRefundCredit, type CustomerCredit } from "@/hooks/use-ar-credits";

/*
 * Acomptes et crédits clients (V49). L'acompte est encaissé en banque et logé au compte 4191
 * (avances reçues) ; il s'impute plus tard sur une facture du même client ou se rembourse. Le
 * surplus d'un avoir (facture déjà réglée) suit la même logique.
 */
const fmt = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const today = () => new Date().toISOString().split("T")[0];
const num = (s: string) => Number(String(s).replace(",", ".").replace(/\s/g, "")) || 0;
const METHODS = [["bank_transfer", "Virement"], ["cash", "Espèces"], ["check", "Chèque"], ["mobile_money", "Mobile money"]];

export function AdvanceDialog({ open, onClose, returnFocusRef }: { open: boolean; onClose: () => void; returnFocusRef?: RefObject<HTMLButtonElement | null> }) {
  const { data: customers = [] } = useCustomers();
  const { data: orders = [] } = useSalesOrders();
  const record = useRecordAdvance();
  const [f, setF] = useState({ customerId: "", date: today(), method: "bank_transfer", reference: "", amount: "", salesOrderId: "", bankAccountId: "" });
  const ordersOf = orders.filter((o) => o.customer_id === f.customerId && !["cancelled", "draft"].includes(o.status));
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent returnFocusRef={returnFocusRef} className="max-w-lg max-sm:[&_input]:min-h-11 max-sm:[&_input]:text-base max-sm:[&_select]:min-h-11 max-sm:[&_select]:text-base">
        <DialogHeader>
          <DialogTitle className="text-sm">Acompte client</DialogTitle>
          <DialogDescription className="text-xs">
            Somme reçue avant facturation : banque au débit, avances clients (4191) au crédit. Elle s'imputera sur une facture du client.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="col-span-1 space-y-1.5 sm:col-span-2">
            <Label className="text-xs" htmlFor="advance-customer">Client *</Label>
            <select id="advance-customer" className="w-full h-8 px-2 rounded-md border border-input bg-background text-xs" value={f.customerId}
              onChange={(e) => setF({ ...f, customerId: e.target.value, salesOrderId: "" })}>
              <option value="">— Sélectionner —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="advance-amount">Montant (XOF) *</Label>
            <Input id="advance-amount" inputMode="decimal" className="h-8 text-xs" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="advance-date">Date</Label>
            <Input id="advance-date" type="date" className="h-8 text-xs" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="advance-method">Mode</Label>
            <select id="advance-method" className="w-full h-8 px-2 rounded-md border border-input bg-background text-xs" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
              {METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <TreasuryAccountSelect id="advance-treasury" method={f.method} value={f.bankAccountId} onChange={(v) => setF((p) => ({ ...p, bankAccountId: v }))} />
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="advance-reference">Référence</Label>
            <Input id="advance-reference" className="h-8 text-xs" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
          </div>
          {f.customerId && (
            <div className="col-span-1 space-y-1.5 sm:col-span-2">
              <Label className="text-xs" htmlFor="advance-order">Commande concernée (facultatif)</Label>
              <select id="advance-order" className="w-full h-8 px-2 rounded-md border border-input bg-background text-xs" value={f.salesOrderId} onChange={(e) => setF({ ...f, salesOrderId: e.target.value })}>
                <option value="">— Aucune —</option>
                {ordersOf.map((o) => <option key={o.id} value={o.id}>{o.so_number}</option>)}
              </select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={onClose}>Annuler</Button>
          <Button size="sm" disabled={!f.customerId || num(f.amount) <= 0 || record.isPending}
            onClick={() => record.mutate({ ...f, amount: num(f.amount) }, { onSuccess: () => { setF({ ...f, amount: "", reference: "" }); onClose(); } })}>
            {record.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Enregistrer l'acompte"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Dans le panneau d'une facture : crédits disponibles DU client, à imputer. */
export function InvoiceCredits({ inv, canApply }: { inv: ARInvoice; canApply: boolean }) {
  const { data: credits = [] } = useCustomerCredits(inv.customer_id);
  const apply = useApplyCredit();
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const reste = inv.total - inv.amount_paid;
  if (credits.length === 0 || reste <= 0 || ["draft", "cancelled"].includes(inv.status)) return null;
  return (
    <section aria-label="Crédits du client" className="space-y-2 rounded border border-border p-3">
      <h3 className="text-xs font-semibold text-foreground">Crédits disponibles du client</h3>
      {credits.map((c) => {
        const def = Math.min(c.available, reste);
        return (
          <div key={c.id} className="flex min-w-0 flex-wrap items-center gap-2 text-xs" data-testid="invoice-credit-row">
            <span className="min-w-0 basis-full break-words sm:basis-auto sm:flex-1">{c.number} · {c.label} · disponible {fmt(c.available)}</span>
            {canApply && (
              <>
                <Input aria-label={`Montant à imputer ${c.number}`} inputMode="decimal" className="h-11 w-28 text-base text-right sm:h-7 sm:text-xs"
                  value={amounts[c.id] ?? String(def)} onChange={(e) => setAmounts({ ...amounts, [c.id]: e.target.value })} />
                <Button size="sm" variant="outline" className="text-xs" disabled={apply.isPending}
                  onClick={() => apply.mutate({ invoiceId: inv.id, kind: c.kind, sourceId: c.id, amount: num(amounts[c.id] ?? String(def)), date: today() })}>
                  Imputer
                </Button>
              </>
            )}
          </div>
        );
      })}
    </section>
  );
}

/** Liste des crédits clients disponibles de la société, avec remboursement. */
export function CustomerCreditsList({ canRefund }: { canRefund: boolean }) {
  const { data: credits = [], isLoading } = useCustomerCredits();
  const [target, setTarget] = useState<CustomerCredit | null>(null);
  const refundTrigger = useRef<HTMLElement | null>(null);
  const listHeading = useRef<HTMLHeadingElement | null>(null);
  const columns: MobileTableColumn[] = [
    { label: "Pièce", kind: "primary" }, { label: "Date" }, { label: "Client", wide: true }, { label: "Nature", wide: true },
    { label: "Montant" }, { label: "Disponible" }, ...(canRefund ? [{ label: "Actions", kind: "actions" as const }] : []),
  ];
  return (
    <section aria-label="Acomptes et crédits clients" className="space-y-2">
      <h3 ref={listHeading} tabIndex={-1} className="text-xs font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">Acomptes et crédits clients non imputés</h3>
      {credits.length === 0 ? (
        <p className="text-xs text-muted-foreground">{isLoading ? "Chargement…" : "Aucun crédit client en attente."}</p>
      ) : (
        <Table className="text-xs" mobileColumns={columns} aria-label="Acomptes et crédits clients">
          <TableHeader><TableRow>
            <TableHead>Pièce</TableHead><TableHead>Date</TableHead><TableHead>Client</TableHead><TableHead>Nature</TableHead>
            <TableHead className="text-right">Montant</TableHead><TableHead className="text-right">Disponible</TableHead>{canRefund && <TableHead><span className="sr-only">Actions</span></TableHead>}
          </TableRow></TableHeader>
          <TableBody>
            {credits.map((c) => (
              <TableRow key={c.id} data-testid="customer-credit-row">
                <TableCell className="px-3 py-2 font-mono md:whitespace-nowrap">{c.number}</TableCell><TableCell className="px-3 py-2 md:whitespace-nowrap">{c.date}</TableCell>
                <TableCell className="px-3 py-2"><span className="block md:max-w-64 md:truncate" title={c.customer_name}>{c.customer_name}</span></TableCell>
                <TableCell className="px-3 py-2"><span className="block md:max-w-64 md:truncate" title={c.label}>{c.label}</span></TableCell>
                <TableCell className="px-3 py-2 text-right tabular-nums md:whitespace-nowrap">{fmt(c.total)}</TableCell><TableCell className="px-3 py-2 text-right tabular-nums md:whitespace-nowrap">{fmt(c.available)}</TableCell>
                {canRefund && <TableCell className="px-3 py-2 text-right"><Button size="sm" variant="outline" className="text-xs" onClick={event => { refundTrigger.current = event.currentTarget; setTarget(c); }}>Rembourser</Button></TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <RefundDialog credit={target} onClose={() => setTarget(null)} returnFocusRef={refundTrigger} fallbackFocusRef={listHeading} />
    </section>
  );
}

function RefundDialog({ credit, onClose, returnFocusRef, fallbackFocusRef }: { credit: CustomerCredit | null; onClose: () => void; returnFocusRef?: RefObject<HTMLElement | null>; fallbackFocusRef?: RefObject<HTMLElement | null> }) {
  const refund = useRefundCredit();
  const [f, setF] = useState({ amount: "", date: today(), method: "bank_transfer", reference: "", bankAccountId: "" });
  if (!credit) return null;
  const amount = f.amount === "" ? credit.available : num(f.amount);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent returnFocusRef={returnFocusRef} className="max-w-md max-sm:[&_input]:min-h-11 max-sm:[&_input]:text-base max-sm:[&_select]:min-h-11 max-sm:[&_select]:text-base">
        <DialogHeader>
          <DialogTitle className="text-sm">Rembourser {credit.number}</DialogTitle>
          <DialogDescription className="text-xs">{credit.customer_name} · disponible {fmt(credit.available)} XOF. Écriture : {credit.kind === "advance" ? "avances clients (4191)" : "clients (411)"} au débit, banque au crédit.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="refund-amount">Montant</Label>
            <Input id="refund-amount" inputMode="decimal" className="h-8 text-xs" placeholder={String(credit.available)} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="refund-date">Date</Label>
            <Input id="refund-date" type="date" className="h-8 text-xs" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="refund-method">Mode</Label>
            <select id="refund-method" className="w-full h-8 px-2 rounded-md border border-input bg-background text-xs" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
              {METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select></div>
          <TreasuryAccountSelect id="refund-treasury" method={f.method} value={f.bankAccountId} onChange={(v) => setF((p) => ({ ...p, bankAccountId: v }))} />
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="refund-reference">Référence</Label>
            <Input id="refund-reference" className="h-8 text-xs" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={onClose}>Retour</Button>
          <Button size="sm" disabled={amount <= 0 || refund.isPending}
            onClick={() => refund.mutate({ kind: credit.kind, sourceId: credit.id, amount, date: f.date, method: f.method, reference: f.reference, bankAccountId: f.bankAccountId }, { onSuccess: () => {
              // Un remboursement total retire sa ligne : revenir au titre stable.
              if (amount >= credit.available && returnFocusRef && fallbackFocusRef?.current) returnFocusRef.current = fallbackFocusRef.current;
              onClose();
            } })}>
            Rembourser {fmt(amount)} XOF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
