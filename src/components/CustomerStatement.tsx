import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DocumentDetail, documentFileName } from "@/components/DocumentDetail";
import { supabase } from "@/integrations/supabase/client";
import { apiGet, isApiEnabled } from "@/api/client";
import type { ApiSchemas } from "@/api";
import { useARInvoices, useCustomers } from "@/hooks/use-ar-data";
import { customerStatement, type StatementMovement } from "@/lib/customer-statement";

/*
 * Relevé de compte client (livre auxiliaire clients) : factures émises au débit, encaissements et
 * avoirs au crédit, annulations d'encaissement au débit, solde progressif. C'est le compte du client
 * dans le livre auxiliaire ; la somme des soldes des clients est le solde du compte collectif 411.
 */
const fmt = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const firstOfYear = () => `${new Date().getFullYear()}-01-01`;
const today = () => new Date().toISOString().split("T")[0];

function useMovements(customerId: string) {
  const { data: invoices = [] } = useARInvoices();
  const mine = invoices.filter((i) => i.customer_id === customerId && i.status !== "draft");
  const key = mine.map((i) => i.id).join(",");
  return useQuery({
    queryKey: ["customer-statement", customerId, key, isApiEnabled() ? "api" : "supabase"],
    enabled: !!customerId,
    queryFn: async (): Promise<StatementMovement[]> => {
      const out: StatementMovement[] = mine.map((i) => ({
        date: i.invoice_date, piece: i.invoice_number, label: "Facture", debit: Number(i.total), credit: 0,
      }));
      const byId = new Map(mine.map((i) => [i.id, i.invoice_number]));
      if (isApiEnabled()) {
        const pays = await Promise.all(mine.map((i) =>
          apiGet<ApiSchemas["ArPaymentView"][]>(`/api/v1/ar/invoices/${i.id}/payments`).then((rows) => rows.map((r) => ({ ...r, invoiceId: i.id })))));
        for (const p of pays.flat()) {
          if (p.paymentType !== "ar_receipt") continue;
          const amount = Number(p.amount);
          out.push({ date: p.paymentDate, piece: p.reference || "—", label: amount < 0 ? `Annulation d'encaissement (${byId.get(p.invoiceId)})` : `Encaissement (${byId.get(p.invoiceId)})`,
            debit: amount < 0 ? -amount : 0, credit: amount > 0 ? amount : 0 });
        }
        const notes = await apiGet<ApiSchemas["ArCreditNoteView"][]>("/api/v1/ar/invoices/credit-notes");
        for (const n of notes.filter((n) => n.customerId === customerId)) {
          out.push({ date: n.creditDate, piece: n.creditNoteNumber, label: `Avoir sur ${n.invoiceNumber} — ${n.reason}`, debit: 0, credit: Number(n.total) });
        }
        return out;
      }
      if (mine.length > 0) {
        const { data: pays, error } = await supabase.from("payments").select("ar_invoice_id, amount, payment_date, reference")
          .eq("payment_type", "ar_receipt").in("ar_invoice_id", mine.map((i) => i.id));
        if (error) throw error;
        for (const p of pays ?? []) {
          const amount = Number(p.amount);
          out.push({ date: p.payment_date, piece: p.reference || "—", label: amount < 0 ? `Annulation d'encaissement (${byId.get(p.ar_invoice_id!)})` : `Encaissement (${byId.get(p.ar_invoice_id!)})`,
            debit: amount < 0 ? -amount : 0, credit: amount > 0 ? amount : 0 });
        }
      }
      const { data: notes, error: ne } = await (supabase as any).from("ar_credit_notes")
        .select("credit_note_number, credit_date, total, reason, invoice:ar_invoices(invoice_number)").eq("customer_id", customerId);
      if (ne) throw ne;
      for (const n of notes ?? []) {
        out.push({ date: n.credit_date, piece: n.credit_note_number, label: `Avoir sur ${n.invoice?.invoice_number ?? ""} — ${n.reason}`, debit: 0, credit: Number(n.total) });
      }
      return out;
    },
  });
}

export function CustomerStatementDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: customers = [] } = useCustomers();
  const [customerId, setCustomerId] = useState("");
  const [from, setFrom] = useState(firstOfYear());
  const [to, setTo] = useState(today());
  const { data: movements = [], isLoading } = useMovements(customerId);
  const st = useMemo(() => customerStatement(movements, from, to), [movements, from, to]);
  const client = customers.find((c) => c.id === customerId);
  const title = `Relevé de compte ${client?.name ?? ""}`.trim();
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-4xl">
        <DialogHeader><DialogTitle className="text-sm">Relevé de compte client</DialogTitle></DialogHeader>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="statement-customer">Client</Label>
            <select id="statement-customer" className="w-full h-8 px-2 rounded-md border border-input bg-background text-xs" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">— Sélectionner —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="statement-from">Du</Label>
            <Input id="statement-from" type="date" className="h-8 text-xs" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="statement-to">Au</Label>
            <Input id="statement-to" type="date" className="h-8 text-xs" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        {!customerId ? (
          <p className="text-xs text-muted-foreground py-4">Choisissez un client pour afficher son compte.</p>
        ) : (
          <DocumentDetail
            title={title} fileName={documentFileName(`releve-${client?.name ?? "client"}-${from}-${to}`)}
            header={[["Client", client?.name], ["Période", `du ${from} au ${to}`], ["Solde d'ouverture", `${fmt(st.opening)} XOF`],
              ["Conditions de paiement", client ? `${client.payment_terms ?? 30} jours` : "—"]]}
            columns={[{ label: "Date" }, { label: "Pièce" }, { label: "Libellé" }, { label: "Débit", align: "right" }, { label: "Crédit", align: "right" }, { label: "Solde", align: "right" }]}
            rows={st.rows.map((r) => [r.date, r.piece, r.label, r.debit ? fmt(r.debit) : "", r.credit ? fmt(r.credit) : "", fmt(r.balance)])}
            emptyLines={isLoading ? "Chargement des mouvements…" : "Aucun mouvement sur la période."}
            footer={[["Solde d'ouverture", `${fmt(st.opening)} XOF`], ["Total débit", `${fmt(st.debit)} XOF`], ["Total crédit", `${fmt(st.credit)} XOF`],
              [st.closing >= 0 ? "Solde dû par le client" : "Solde en faveur du client", `${fmt(Math.abs(st.closing))} XOF`, true]]}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
