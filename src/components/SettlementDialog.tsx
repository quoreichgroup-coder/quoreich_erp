import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRecordSettlement } from "@/hooks/use-settlements";
import { autoAllocate, checkAllocations, openItems, type OpenItemSource, type SettlementKind } from "@/lib/settlement";

const fmt = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);
const METHODS = [
  ["bank_transfer", "Virement"], ["check", "Chèque"], ["cash", "Espèces"], ["mobile_money", "Mobile money"],
] as const;

/**
 * Règlement par tiers — en-tête (tiers, date, mode, référence, montant), lignes (SES pièces
 * ouvertes, montant imputé), pied (total imputé, reste à imputer). Le tiers vient d'abord : la
 * liste des factures en dépend, et la base refuse toute facture d'un autre tiers (V36).
 */
export function SettlementDialog({ kind, open, onClose, parties, invoices, initialPartyId, initialInvoiceId }: {
  kind: SettlementKind;
  open: boolean;
  onClose: () => void;
  parties: { id: string; name: string }[];
  invoices: OpenItemSource[];
  initialPartyId?: string;
  initialInvoiceId?: string;
}) {
  const record = useRecordSettlement(kind);
  const tiers = kind === "ar" ? "Client" : "Fournisseur";
  const [partyId, setPartyId] = useState("");
  const [date, setDate] = useState(today());
  const [method, setMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState("");
  const [entered, setEntered] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const items = useMemo(() => openItems(kind, invoices, partyId), [kind, invoices, partyId]);

  // Ouverture : tiers (et facture) présélectionnés depuis la ligne ou le panneau d'une facture.
  useEffect(() => {
    if (!open) return;
    setPartyId(initialPartyId ?? "");
    setDate(today()); setMethod("bank_transfer"); setReference(""); setError(null);
    const pre = initialPartyId && initialInvoiceId
      ? openItems(kind, invoices, initialPartyId).find((i) => i.id === initialInvoiceId) : undefined;
    setAmount(pre ? String(pre.outstanding) : "");
    setEntered(pre ? { [pre.id]: String(pre.outstanding) } : {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialPartyId, initialInvoiceId]);

  const choosePartie = (id: string) => { setPartyId(id); setEntered({}); setAmount(""); setError(null); };
  const numbers = Object.fromEntries(Object.entries(entered).map(([k, v]) => [k, v === "" ? 0 : Number(v.replace(",", "."))]));
  const amountN = amount === "" ? 0 : Number(amount.replace(",", "."));
  const allocated = Object.values(numbers).reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);
  const totalOpen = items.reduce((s, i) => s + i.outstanding, 0);

  const repartir = () => {
    const a = autoAllocate(amountN, items);
    setEntered(Object.fromEntries(Object.entries(a).map(([k, v]) => [k, String(v)])));
    setError(null);
  };

  const submit = () => {
    if (!partyId) { setError(`Choisissez d'abord le ${tiers.toLowerCase()}.`); return; }
    const check = checkAllocations(items, numbers, amountN);
    if (check.error) { setError(check.error); return; }
    record.mutate(
      { partyId, paymentDate: date, paymentMethod: method, reference, allocations: check.allocations },
      { onSuccess: onClose },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-sm">{kind === "ar" ? "Encaissement client" : "Règlement fournisseur"}</DialogTitle>
          <DialogDescription className="text-xs">
            Choisissez le {tiers.toLowerCase()} : seules ses factures {kind === "ap" ? "approuvées " : ""}non soldées sont proposées.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label className="text-xs" htmlFor="st-party">{tiers} *</Label>
            <select id="st-party" className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
              value={partyId} onChange={(e) => choosePartie(e.target.value)}>
              <option value="">— Sélectionner —</option>
              {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="st-date">Date</Label>
            <Input id="st-date" type="date" className="h-8 text-xs" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="st-method">Mode de règlement</Label>
            <select id="st-method" className="w-full h-8 px-2 rounded-md border border-input bg-background text-xs"
              value={method} onChange={(e) => setMethod(e.target.value)}>
              {METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="st-ref">Référence</Label>
            <Input id="st-ref" className="h-8 text-xs" value={reference} onChange={(e) => setReference(e.target.value)}
              placeholder={kind === "ar" ? "ex : VIR-BQ-20261114" : "ex : VIR-OUT-20261114"} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="st-amount">Montant du règlement (XOF)</Label>
            <div className="flex gap-2">
              <Input id="st-amount" inputMode="decimal" className="h-8 text-xs text-right tabular-nums" value={amount}
                onChange={(e) => setAmount(e.target.value)} disabled={!partyId} />
              <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={repartir}
                disabled={!partyId || amountN <= 0}>Répartir</Button>
            </div>
          </div>
        </div>

        {partyId && (
          <div className="border border-border rounded-md overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/30 text-muted-foreground">
                <tr>
                  <th className="text-left p-2">Facture</th><th className="text-left p-2">Échéance</th>
                  <th className="text-right p-2">Total</th><th className="text-right p-2">Restant dû</th>
                  <th className="text-right p-2">Imputé</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">Aucune facture ouverte pour ce {tiers.toLowerCase()}.</td></tr>
                ) : items.map((i) => (
                  <tr key={i.id} className="border-t border-border">
                    <td className="p-2 font-medium tabular-nums">{i.invoice_number}</td>
                    <td className="p-2 tabular-nums text-muted-foreground">{i.due_date}</td>
                    <td className="p-2 text-right tabular-nums">{fmt(i.total)}</td>
                    <td className="p-2 text-right tabular-nums">{fmt(i.outstanding)}</td>
                    <td className="p-2 text-right">
                      <Input aria-label={`Montant imputé ${i.invoice_number}`} inputMode="decimal"
                        className="h-7 w-28 ml-auto text-right text-xs tabular-nums" value={entered[i.id] ?? ""}
                        onChange={(e) => setEntered((x) => ({ ...x, [i.id]: e.target.value }))} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-muted/20 font-medium">
                <tr className="border-t border-border">
                  <td className="p-2" colSpan={3}>Total ouvert du {tiers.toLowerCase()}</td>
                  <td className="p-2 text-right tabular-nums">{fmt(totalOpen)}</td>
                  <td className="p-2 text-right tabular-nums" data-testid="settlement-allocated">{fmt(allocated)}</td>
                </tr>
                <tr>
                  <td className="p-2" colSpan={4}>Reste à imputer</td>
                  <td className={`p-2 text-right tabular-nums ${Math.abs(amountN - allocated) < 0.005 ? "text-success" : "text-destructive"}`}
                    data-testid="settlement-remaining">{fmt(amountN - allocated)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" size="sm" className="text-xs" onClick={onClose}>Annuler</Button>
          <Button size="sm" className="text-xs" onClick={submit} disabled={record.isPending || !partyId}>
            {record.isPending && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}Enregistrer le règlement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
