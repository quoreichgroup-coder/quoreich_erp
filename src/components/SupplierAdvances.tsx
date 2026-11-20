import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TreasuryAccountSelect } from "@/components/TreasuryAccountSelect";
import { supabase } from "@/integrations/supabase/client";
import { apiGet, apiPost, isApiEnabled } from "@/api/client";
import { useTenantId } from "@/hooks/use-tenant";
import { currencyChoices, useBaseCurrency, useExchangeRates } from "@/hooks/use-exchange-rates";

/*
 * Avances et acomptes versés aux fournisseurs (V127) : versement (débit 4091 / crédit trésorerie, droit ap.pay, mêmes
 * contrôles de coordonnées bancaires que les paiements), imputation sur une facture approuvée du même fournisseur
 * (débit 401 / crédit 4091), registre versé / imputé / disponible.
 */
const db = supabase as any;
const fmt = (n: number) => Number(n || 0).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);
const METHODS = [["bank_transfer", "Virement"], ["check", "Chèque"], ["cash", "Espèces"], ["mobile_money", "Mobile money"]] as const;

export interface SupplierAdvance {
  id: string; advance_number: string; supplier_id: string; supplier_name?: string; paid_date: string; amount: number;
  amount_applied: number; available: number; currency: string | null; fx_amount: number | null; reference: string | null;
}

export function useSupplierAdvances() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["supplier-advances", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async (): Promise<SupplierAdvance[]> => {
      if (isApiEnabled()) return apiGet<SupplierAdvance[]>("/api/v1/ap/supplier-advances");
      const { data, error } = await db.from("ap_supplier_advances").select("*, supplier:suppliers(name)").order("paid_date", { ascending: false }).limit(1000);
      if (error) throw error;
      return (data ?? []).map((a: any) => ({ ...a, supplier_name: a.supplier?.name, available: Number(a.amount) - Number(a.amount_applied) }));
    },
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  for (const k of ["supplier-advances", "ap-invoices", "ap-payments", "journal-entries", "bank-transactions", "treasury-accounts"]) qc.invalidateQueries({ queryKey: [k] });
}

export function useRecordSupplierAdvance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: { supplier_id: string; paid_date: string; payment_method: string; reference: string; amount: number | null;
      bank_account_id: string | null; currency: string | null; fx_amount: number | null; exchange_rate: number | null }) => {
      if (isApiEnabled()) { await apiPost("/api/v1/ap/supplier-advances", a); return; }
      const { error } = await db.rpc("record_supplier_advance", {
        _supplier_id: a.supplier_id, _paid_date: a.paid_date, _payment_method: a.payment_method, _reference: a.reference, _amount: a.amount,
        _bank_account_id: a.bank_account_id, _currency: a.currency, _fx_amount: a.fx_amount, _exchange_rate: a.exchange_rate,
      });
      if (error) throw error;
    },
    onSuccess: () => { invalidate(qc); toast.success("Avance fournisseur enregistrée"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useApplySupplierAdvance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: { advance_id: string; invoice_id: string; amount: number }) => {
      if (isApiEnabled()) { await apiPost(`/api/v1/ap/supplier-advances/${a.advance_id}/applications`, { invoice_id: a.invoice_id, amount: a.amount, apply_date: today() }); return; }
      const { error } = await db.rpc("apply_supplier_advance", { _invoice_id: a.invoice_id, _advance_id: a.advance_id, _amount: a.amount, _apply_date: today() });
      if (error) throw error;
    },
    onSuccess: () => { invalidate(qc); toast.success("Avance imputée sur la facture"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Versement d'une avance : fournisseur, date, mode, compte de trésorerie, montant (en devise si choisie). */
export function SupplierAdvanceDialog({ open, onClose, suppliers }: { open: boolean; onClose: () => void; suppliers: { id: string; name: string; currency?: string | null }[] }) {
  const record = useRecordSupplierAdvance();
  const base = useBaseCurrency();
  const { data: rates = [] } = useExchangeRates();
  const [f, setF] = useState({ supplier: "", date: today(), method: "bank_transfer", bank: "", reference: "", amount: "", currency: "", rate: "" });
  useEffect(() => { if (open) setF({ supplier: "", date: today(), method: "bank_transfer", bank: "", reference: "", amount: "", currency: "", rate: "" }); }, [open]);
  const foreign = Boolean(f.currency) && f.currency !== base;
  const n = (v: string) => (v === "" ? null : Number(v.replace(",", ".")));
  const amount = n(f.amount);
  const valid = Boolean(f.supplier) && amount != null && amount > 0;
  const submit = () => record.mutate({
    supplier_id: f.supplier, paid_date: f.date, payment_method: f.method, reference: f.reference, bank_account_id: f.bank || null,
    amount: foreign ? null : amount, currency: foreign ? f.currency : null, fx_amount: foreign ? amount : null, exchange_rate: foreign ? n(f.rate) : null,
  }, { onSuccess: onClose });
  const supplierCurrency = suppliers.find((s) => s.id === f.supplier)?.currency ?? null;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">Avance fournisseur</DialogTitle>
          <DialogDescription className="text-xs">Acompte versé avant la facture (compte 4091) ; il s'impute ensuite sur une facture approuvée du fournisseur.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5"><Label className="text-xs" htmlFor="adv-supplier">Fournisseur *</Label>
            <select id="adv-supplier" className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm" value={f.supplier}
              onChange={(e) => { const c = suppliers.find((s) => s.id === e.target.value)?.currency ?? ""; setF((x) => ({ ...x, supplier: e.target.value, currency: c && c !== base ? c : "" })); }}>
              <option value="">— Sélectionner —</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="adv-date">Date</Label>
            <Input id="adv-date" type="date" className="h-8 text-xs" value={f.date} onChange={(e) => setF((x) => ({ ...x, date: e.target.value }))} /></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="adv-method">Mode de règlement</Label>
            <select id="adv-method" className="w-full h-8 px-2 rounded-md border border-input bg-background text-xs" value={f.method} onChange={(e) => setF((x) => ({ ...x, method: e.target.value }))}>
              {METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select></div>
          <TreasuryAccountSelect id="adv-treasury" method={f.method} value={f.bank} onChange={(v) => setF((x) => ({ ...x, bank: v }))} />
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="adv-ref">Référence</Label>
            <Input id="adv-ref" className="h-8 text-xs" value={f.reference} onChange={(e) => setF((x) => ({ ...x, reference: e.target.value }))} /></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="adv-currency">Devise</Label>
            <select id="adv-currency" className="w-full h-8 px-2 rounded-md border border-input bg-background text-xs" value={f.currency || base}
              onChange={(e) => setF((x) => ({ ...x, currency: e.target.value === base ? "" : e.target.value }))}>
              {currencyChoices(base, rates, supplierCurrency).map((c) => <option key={c} value={c}>{c === base ? `${c} (devise de la société)` : c}</option>)}
            </select></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="adv-amount">Montant ({foreign ? f.currency : base}) *</Label>
            <Input id="adv-amount" inputMode="decimal" className="h-8 text-xs text-right" value={f.amount} onChange={(e) => setF((x) => ({ ...x, amount: e.target.value }))} /></div>
          {foreign && <div className="space-y-1.5"><Label className="text-xs" htmlFor="adv-rate">Cours (1 {f.currency} en {base})</Label>
            <Input id="adv-rate" inputMode="decimal" className="h-8 text-xs text-right" placeholder="vide = cours du jour" value={f.rate} onChange={(e) => setF((x) => ({ ...x, rate: e.target.value }))} /></div>}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" className="text-xs" onClick={onClose}>Annuler</Button>
          <Button size="sm" className="text-xs" disabled={!valid || record.isPending} onClick={submit} data-testid="supplier-advance-save">
            {record.isPending && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}Enregistrer l'avance</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Registre des avances : versé, imputé, disponible. */
export function SupplierAdvancesList() {
  const { data = [], isLoading } = useSupplierAdvances();
  if (isLoading) return <Loader2 className="w-4 h-4 animate-spin" />;
  return (
    <div className="rounded-md border border-border bg-card overflow-x-auto" data-testid="supplier-advances">
      <table className="w-full text-xs">
        <thead className="bg-muted/30 text-muted-foreground"><tr>
          <th className="text-left p-2">N°</th><th className="text-left">Fournisseur</th><th className="text-left">Date</th>
          <th className="text-right">Versé</th><th className="text-right">Imputé</th><th className="text-right pr-2">Disponible</th></tr></thead>
        <tbody>
          {data.length === 0 && <tr><td colSpan={6} className="p-3 text-muted-foreground">Aucune avance fournisseur.</td></tr>}
          {data.map((a) => (
            <tr key={a.id} className="border-t border-border/50" data-testid="supplier-advance-row">
              <td className="p-2 font-mono">{a.advance_number}</td><td>{a.supplier_name}</td><td>{a.paid_date}</td>
              <td className="text-right tabular-nums">{fmt(a.amount)} XOF{a.currency ? ` (${fmt(Number(a.fx_amount))} ${a.currency})` : ""}</td>
              <td className="text-right tabular-nums">{fmt(a.amount_applied)}</td>
              <td className="text-right pr-2 tabular-nums font-medium">{fmt(a.available)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Dans le panneau d'une facture approuvée : avances disponibles du fournisseur, imputation. */
export function InvoiceSupplierAdvances({ invoice, canApply }: { invoice: { id: string; supplier_id: string; total: number; amount_paid: number; approval_status: string; status: string }; canApply: boolean }) {
  const { data = [] } = useSupplierAdvances();
  const apply = useApplySupplierAdvance();
  const outstanding = Math.round((Number(invoice.total) - Number(invoice.amount_paid)) * 100) / 100;
  const open = data.filter((a) => a.supplier_id === invoice.supplier_id && Number(a.available) > 0);
  if (open.length === 0 || invoice.approval_status !== "approved" || invoice.status === "paid") return null;
  return (
    <div className="rounded-md border border-border p-3 space-y-2" data-testid="invoice-supplier-advances">
      <p className="text-xs font-medium">Avances disponibles du fournisseur</p>
      {open.map((a) => {
        const proposed = Math.min(Number(a.available), outstanding);
        return (
          <div key={a.id} className="flex items-center justify-between gap-2 text-xs">
            <span>{a.advance_number} · {a.paid_date} · disponible {fmt(a.available)} XOF</span>
            {canApply && <Button size="sm" variant="outline" className="h-7 text-xs" disabled={apply.isPending || proposed <= 0}
              onClick={() => apply.mutate({ advance_id: a.id, invoice_id: invoice.id, amount: proposed })}>Imputer {fmt(proposed)} XOF</Button>}
          </div>
        );
      })}
    </div>
  );
}
