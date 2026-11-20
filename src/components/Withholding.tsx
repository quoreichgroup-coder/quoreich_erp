import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ExportButtons } from "@/components/ExportButtons";
import { supabase } from "@/integrations/supabase/client";
import { apiGet, isApiEnabled } from "@/api/client";
import { useTenantId } from "@/hooks/use-tenant";
import { useAPWithholdingRates, useUpsertAPWithholdingRate } from "@/hooks/use-ap-data";

/*
 * Retenues à la source (V136, écart G-31) : catégories (taux, base HT ou TTC, compte 447x du plan de la société),
 * catégorie par fournisseur reprise sur ses factures, retenue prélevée au paiement (la banque ne décaisse que le net),
 * état des retenues pour la déclaration. Aucun taux n'est imposé : ils se saisissent selon la loi fiscale du pays.
 */
const fmt = (n: unknown) => Number(n ?? 0).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => today().slice(0, 8) + "01";

/** Choix de la catégorie de retenue (fiche fournisseur, facture). */
export function WithholdingSelect({ id, value, onChange, label = "Retenue à la source" }: {
  id: string; value: string | null | undefined; onChange: (v: string | null) => void; label?: string;
}) {
  const { data: rates = [] } = useAPWithholdingRates();
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <select id={id} className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Aucune</option>
        {(rates as any[]).filter((r) => r.is_active || r.id === value).map((r) => (
          <option key={r.id} value={r.id}>{r.category} — {r.rate_pct} % ({r.base === "gross" ? "TTC" : "HT"})</option>))}
      </select>
    </div>
  );
}

const blank = { category: "", rate_pct: "", base: "net", gl_account: "" };

/** Catégories de retenue : création, modification, activation. */
export function WithholdingRatesPanel() {
  const { data: rates = [] } = useAPWithholdingRates();
  const save = useUpsertAPWithholdingRate();
  const [form, setForm] = useState<Record<string, string>>(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const submit = () => {
    const row = { category: form.category.trim(), rate_pct: Number(String(form.rate_pct).replace(",", ".")), base: form.base, gl_account: form.gl_account.trim() || null };
    save.mutate(editing ? { id: editing, ...row } : { ...row, is_active: true }, { onSuccess: () => { setForm(blank); setEditing(null); } });
  };
  return (
    <div className="bg-card border border-border rounded-lg" data-testid="withholding-rates">
      <div className="p-3 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground">Taux de retenue à la source</h3>
        <p className="text-xs text-muted-foreground">Prélevée au paiement des factures des fournisseurs de la catégorie, créditée sur son compte, reversée à
          l'administration. Saisissez les taux de la loi fiscale de votre pays.</p>
      </div>
      <table className="w-full text-xs">
        <thead><tr className="border-b border-border bg-muted/30">
          {["Catégorie", "Taux (%)", "Base", "Compte", "Actif", "Actions"].map((h) => <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>)}
        </tr></thead>
        <tbody>
          {(rates as any[]).map((w) => (
            <tr key={w.id} className="border-b border-border hover:bg-muted/20">
              <td className="px-3 py-2 font-medium">{w.category}</td>
              <td className="px-3 py-2">{w.rate_pct} %</td>
              <td className="px-3 py-2">{w.base === "gross" ? "TTC" : "HT"}</td>
              <td className="px-3 py-2 font-mono">{w.gl_account}</td>
              <td className="px-3 py-2">{w.is_active ? "Oui" : "Non"}</td>
              <td className="px-3 py-2 space-x-1">
                <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => { setEditing(w.id); setForm({ category: w.category, rate_pct: String(w.rate_pct), base: w.base ?? "net", gl_account: w.gl_account ?? "" }); }}>Modifier</Button>
                <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => save.mutate({ id: w.id, is_active: !w.is_active })}>{w.is_active ? "Désactiver" : "Activer"}</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="p-3 flex flex-wrap items-end gap-2 border-t border-border">
        <div className="space-y-1"><Label className="text-xs" htmlFor="wh-category">Catégorie</Label>
          <Input id="wh-category" className="h-8 text-xs w-48" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></div>
        <div className="space-y-1"><Label className="text-xs" htmlFor="wh-rate">Taux (%)</Label>
          <Input id="wh-rate" className="h-8 text-xs w-20" inputMode="decimal" value={form.rate_pct} onChange={(e) => setForm({ ...form, rate_pct: e.target.value })} /></div>
        <div className="space-y-1"><Label className="text-xs" htmlFor="wh-base">Base</Label>
          <select id="wh-base" className="h-8 px-2 rounded-md border border-input bg-background text-xs" value={form.base} onChange={(e) => setForm({ ...form, base: e.target.value })}>
            <option value="net">Montant HT</option><option value="gross">Montant TTC</option></select></div>
        <div className="space-y-1"><Label className="text-xs" htmlFor="wh-account">Compte (plan de la société)</Label>
          <Input id="wh-account" className="h-8 text-xs w-24 font-mono" value={form.gl_account} onChange={(e) => setForm({ ...form, gl_account: e.target.value })} /></div>
        <Button size="sm" className="h-8 text-xs" disabled={save.isPending || !form.category.trim() || !(Number(String(form.rate_pct).replace(",", ".")) >= 0)} onClick={submit}
          data-testid="withholding-save">{editing ? "Enregistrer" : "Ajouter la catégorie"}</Button>
        {editing && <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { setEditing(null); setForm(blank); }}>Annuler</Button>}
      </div>
    </div>
  );
}

/** État des retenues prélevées sur une période (déclaration mensuelle). */
export function WithholdingStatement() {
  const { data: tenantId } = useTenantId();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const q = useQuery({
    queryKey: ["withholding-statement", tenantId, from, to],
    enabled: Boolean(tenantId) && Boolean(from) && Boolean(to),
    queryFn: async (): Promise<any[]> => {
      if (isApiEnabled()) return apiGet<any[]>(`/api/v1/ap/withholding-statement?from=${from}&to=${to}`);
      const { data, error } = await (supabase as any).rpc("withholding_statement", { _from: from, _to: to });
      if (error) throw error;
      return data ?? [];
    },
  });
  const rows = q.data ?? [];
  const total = rows.reduce((s, r) => s + Number(r.withheld ?? 0), 0);
  return (
    <div className="bg-card border border-border rounded-lg p-3 space-y-2" data-testid="withholding-statement">
      <div className="flex flex-wrap items-end gap-2 justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">État des retenues à la source</h3>
          <p className="text-xs text-muted-foreground">Retenues prélevées sur les paiements de la période, à déclarer et reverser.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><Label className="text-xs" htmlFor="wh-from">Du</Label><Input id="wh-from" type="date" className="h-8 text-xs" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs" htmlFor="wh-to">Au</Label><Input id="wh-to" type="date" className="h-8 text-xs" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <ExportButtons label="Exporter l'état" filename={`retenues-a-la-source-${from}-${to}`} sheetName="Retenues"
            rows={rows.map((r) => ({ date: r.payment_date, fournisseur: r.supplier_name, ifu: r.supplier_tax_id ?? "", facture: r.invoice_number, categorie: r.category ?? "",
              taux: Number(r.rate_pct ?? 0), base: Number(r.base_amount ?? 0), retenue: Number(r.withheld ?? 0), compte: r.gl_account ?? "", reference: r.reference ?? "" }))}
            columns={[{ key: "date", header: "Date" }, { key: "fournisseur", header: "Fournisseur" }, { key: "ifu", header: "IFU" }, { key: "facture", header: "Facture" },
              { key: "categorie", header: "Catégorie" }, { key: "taux", header: "Taux (%)" }, { key: "base", header: "Base" }, { key: "retenue", header: "Retenue" },
              { key: "compte", header: "Compte" }, { key: "reference", header: "Référence" }]} />
        </div>
      </div>
      {rows.length === 0 ? <p className="text-xs text-muted-foreground">Aucune retenue prélevée sur la période.</p> : (
        <table className="w-full text-xs">
          <thead className="text-muted-foreground"><tr><th className="text-left">Date</th><th className="text-left">Fournisseur</th><th className="text-left">IFU</th>
            <th className="text-left">Facture</th><th className="text-left">Catégorie</th><th className="text-right">Base</th><th className="text-right">Retenue</th><th className="text-left">Compte</th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i} className="border-t border-border/50"><td>{r.payment_date}</td><td>{r.supplier_name}</td><td>{r.supplier_tax_id}</td><td>{r.invoice_number}</td>
              <td>{r.category} ({r.rate_pct} %)</td><td className="text-right tabular-nums">{fmt(r.base_amount)}</td><td className="text-right tabular-nums">{fmt(r.withheld)}</td>
              <td className="font-mono">{r.gl_account}</td></tr>))}
            <tr className="border-t border-border font-medium"><td colSpan={6}>Total</td><td className="text-right tabular-nums">{fmt(total)}</td><td /></tr></tbody>
        </table>
      )}
    </div>
  );
}
