import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DocumentDetail, documentFileName } from "@/components/DocumentDetail";
import {
  useARCreditNotes, useARInvoiceLines, useCreateARCreditNote, type ARCreditNote, type ARInvoice,
} from "@/hooks/use-ar-data";

/*
 * Avoirs clients (V45) : seule façon de corriger une facture émise. L'avoir cite la facture, porte un
 * motif, crédite tout ou partie de ses lignes (jamais plus que le facturé non encore crédité) ; la
 * base le numérote, passe l'écriture miroir au journal des ventes et l'impute sur le reste dû.
 */
const fmt = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const today = () => new Date().toISOString().split("T")[0];

export function CreditNoteDialog({ inv, open, onClose }: { inv: ARInvoice; open: boolean; onClose: () => void }) {
  const lines = useARInvoiceLines(open ? inv.id : undefined);
  const create = useCreateARCreditNote();
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(today());
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const rows = lines.data ?? [];
  const headerOnly = !lines.isLoading && rows.length === 0;
  const rest = (l: (typeof rows)[number]) => Number(l.quantity) - Number(l.credited_quantity ?? 0);
  const num = (s: string | undefined) => Number(String(s ?? "").replace(",", ".")) || 0;
  const net = rows.reduce((s, l) => s + Math.round(num(qtys[l.id ?? ""]) * l.unit_price * (1 - l.discount_pct / 100) * 100) / 100, 0);
  const chosen = rows.filter((l) => l.id && num(qtys[l.id]) > 0).map((l) => ({ invoice_line_id: l.id!, quantity: num(qtys[l.id!]) }));

  const submit = () => create.mutate(
    { invoiceId: inv.id, reason: reason.trim(), date, lines: headerOnly ? null : chosen },
    { onSuccess: () => { setReason(""); setQtys({}); onClose(); } },
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-sm">Avoir sur la facture {inv.invoice_number}</DialogTitle>
          <DialogDescription className="text-xs">
            L'avoir reçoit un numéro légal, passe l'écriture inverse au journal des ventes et réduit le reste dû de la facture.
            Il ne se modifie plus une fois émis.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs" htmlFor="credit-reason">Motif (obligatoire)</Label>
              <Input id="credit-reason" className="h-8 text-xs" value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="Retour de marchandise, erreur de prix, geste commercial…" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="credit-date">Date de l'avoir</Label>
              <Input id="credit-date" type="date" className="h-8 text-xs" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          {lines.isLoading ? (
            <p className="text-xs text-muted-foreground">Chargement des lignes…</p>
          ) : headerOnly ? (
            <p className="text-xs" data-testid="credit-header-only">
              Facture saisie en en-tête seul : l'avoir annule la facture en totalité ({fmt(inv.total)} XOF TTC).
            </p>
          ) : (
            <div className="space-y-2" data-testid="credit-lines">
              <div className="flex justify-end">
                <Button type="button" size="sm" variant="outline" className="h-7 text-[10px]"
                  onClick={() => setQtys(Object.fromEntries(rows.filter((l) => l.id && rest(l) > 0).map((l) => [l.id!, String(rest(l))])))}>
                  Tout créditer
                </Button>
              </div>
              <table className="w-full text-xs">
                <thead><tr className="text-muted-foreground border-b border-border">
                  <th className="text-left py-1">Libellé</th><th className="text-right">P.U.</th><th className="text-right">Remise</th>
                  <th className="text-right">TVA</th><th className="text-right">Facturé</th><th className="text-right">Déjà crédité</th>
                  <th className="text-right w-24">À créditer</th>
                </tr></thead>
                <tbody>
                  {rows.map((l) => (
                    <tr key={l.id ?? l.line_no} className="border-b border-border/50">
                      <td className="py-1">{l.description}</td>
                      <td className="text-right tabular-nums">{fmt(l.unit_price)}</td>
                      <td className="text-right">{l.discount_pct ? `${fmt(l.discount_pct)} %` : ""}</td>
                      <td className="text-right">{l.tax_code ?? "—"}</td>
                      <td className="text-right tabular-nums">{fmt(l.quantity)}</td>
                      <td className="text-right tabular-nums">{fmt(Number(l.credited_quantity ?? 0))}</td>
                      <td className="text-right">
                        <Input aria-label={`Quantité à créditer ligne ${l.line_no}`} inputMode="decimal" className="h-7 text-xs text-right"
                          disabled={!l.id || rest(l) <= 0} placeholder="0" value={qtys[l.id ?? ""] ?? ""}
                          onChange={(e) => l.id && setQtys((q) => ({ ...q, [l.id!]: e.target.value }))} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-right" data-testid="credit-preview">Montant HT crédité : <strong>{fmt(net)} XOF</strong> (TVA calculée par la base)</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={onClose}>Retour</Button>
          <Button size="sm" disabled={!reason.trim() || create.isPending || (!headerOnly && chosen.length === 0)} onClick={submit}>
            {create.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Émettre l'avoir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CreditNoteView({ note, onClose }: { note: ARCreditNote | null; onClose: () => void }) {
  if (!note) return null;
  const title = `Avoir ${note.credit_note_number}`;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle className="text-sm">{title}</DialogTitle></DialogHeader>
        <DocumentDetail
          title={title} fileName={documentFileName(title)}
          header={[["Client", note.customer_name], ["Facture d'origine", note.invoice_number], ["Date", note.credit_date], ["Motif", note.reason]]}
          columns={[{ label: "Libellé" }, { label: "Qté", align: "right" }, { label: "P.U.", align: "right" }, { label: "Remise", align: "right" },
            { label: "TVA", align: "right" }, { label: "Montant HT", align: "right" }]}
          rows={note.lines.map((l) => [l.description, fmt(l.quantity), fmt(l.unit_price), l.discount_pct ? `${fmt(l.discount_pct)} %` : "",
            l.tax_code ?? "—", fmt(l.net_amount)])}
          footer={[["Total HT", `${fmt(note.subtotal)} XOF`], ["TVA", `${fmt(note.tax_amount)} XOF`], ["Total TTC", `${fmt(note.total)} XOF`, true],
            ["Imputé sur la facture", `${fmt(note.amount_allocated)} XOF`], ["Crédit client non imputé", `${fmt(note.total - note.amount_allocated)} XOF`]]}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Liste des avoirs (d'une facture, ou de la société) ; clic → vue détaillée imprimable. */
export function CreditNotesList({ invoiceId, title = "Avoirs" }: { invoiceId?: string; title?: string }) {
  const { data: notes = [], isLoading } = useARCreditNotes(invoiceId);
  const [view, setView] = useState<ARCreditNote | null>(null);
  if (invoiceId && (isLoading || notes.length === 0)) return null;
  return (
    <section aria-label={title} className="space-y-2">
      <h3 className="text-xs font-semibold text-foreground">{title}</h3>
      {notes.length === 0 ? (
        <p className="text-xs text-muted-foreground">{isLoading ? "Chargement…" : "Aucun avoir."}</p>
      ) : (
        <table className="w-full text-xs">
          <thead><tr className="text-muted-foreground border-b border-border">
            <th className="text-left py-1">N° avoir</th><th className="text-left">Date</th>
            {!invoiceId && <><th className="text-left">Facture</th><th className="text-left">Client</th></>}
            <th className="text-left">Motif</th><th className="text-right">TTC</th><th className="text-right">Non imputé</th>
          </tr></thead>
          <tbody>
            {notes.map((n) => (
              <tr key={n.id} data-testid="credit-note-row" className="border-b border-border/50 cursor-pointer hover:bg-muted/40" onClick={() => setView(n)}>
                <td className="py-1 font-mono">{n.credit_note_number}</td>
                <td>{n.credit_date}</td>
                {!invoiceId && <><td className="font-mono">{n.invoice_number}</td><td>{n.customer_name}</td></>}
                <td className="truncate max-w-[16rem]">{n.reason}</td>
                <td className="text-right tabular-nums">{fmt(n.total)}</td>
                <td className="text-right tabular-nums">{fmt(n.total - n.amount_allocated)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <CreditNoteView note={view} onClose={() => setView(null)} />
    </section>
  );
}
