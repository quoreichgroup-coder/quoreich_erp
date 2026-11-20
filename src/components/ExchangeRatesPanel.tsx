import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMyAccess } from "@/hooks/use-my-access";
import { useBaseCurrency, useDeleteExchangeRate, useExchangeRates, useSaveExchangeRate } from "@/hooks/use-exchange-rates";

/*
 * Devises et cours (V124) : cours de référence (BCEAO / BEAC, non modifiables) et cours de la société. Le dernier cours
 * connu à la date d'une facture ou d'un paiement s'applique quand aucun n'est saisi sur la pièce.
 */
const fmtRate = (n: number) => Number(n).toLocaleString("fr-FR", { maximumFractionDigits: 6 });

export function ExchangeRatesPanel() {
  const base = useBaseCurrency();
  const rates = useExchangeRates();
  const save = useSaveExchangeRate();
  const remove = useDeleteExchangeRate();
  const access = useMyAccess();
  const canEdit = access.data?.permissions.includes("currency.rates") ?? false;
  const [form, setForm] = useState({ currency: "USD", rate_date: new Date().toISOString().slice(0, 10), rate: "", source: "BCEAO" });
  const rateN = Number(form.rate.replace(",", "."));
  const valid = /^[A-Za-z]{3}$/.test(form.currency) && form.currency.toUpperCase() !== base && Number.isFinite(rateN) && rateN > 0 && Boolean(form.rate_date);

  return (
    <div className="space-y-4" data-testid="exchange-rates-panel">
      <div className="bg-card border border-border rounded-lg p-4 space-y-2">
        <h3 className="text-sm font-semibold">Devises et cours de change</h3>
        <p className="text-xs text-muted-foreground">
          Devise de la société : <strong>{base}</strong>. Un cours indique la valeur en {base} d'une unité de devise. Les factures et paiements en devise
          prennent le dernier cours connu à leur date, sauf si un cours est saisi sur la pièce. Les cours de référence (parité fixe de l'euro) ne se
          modifient pas ; les cours de la société (cours BCEAO du jour, cours de la banque) priment à date égale.
        </p>
      </div>
      {canEdit && (
        <div className="bg-card border border-border rounded-lg p-4 flex flex-wrap items-end gap-3" data-testid="exchange-rate-form">
          <div className="space-y-1"><Label className="text-xs" htmlFor="fx-currency">Devise (code ISO)</Label>
            <Input id="fx-currency" className="h-8 text-xs w-24 uppercase" maxLength={3} value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))} /></div>
          <div className="space-y-1"><Label className="text-xs" htmlFor="fx-date">Date</Label>
            <Input id="fx-date" type="date" className="h-8 text-xs w-40" value={form.rate_date} onChange={(e) => setForm((f) => ({ ...f, rate_date: e.target.value }))} /></div>
          <div className="space-y-1"><Label className="text-xs" htmlFor="fx-rate">Cours (1 unité en {base})</Label>
            <Input id="fx-rate" inputMode="decimal" className="h-8 text-xs w-32 text-right" value={form.rate} onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))} /></div>
          <div className="space-y-1"><Label className="text-xs" htmlFor="fx-source">Source</Label>
            <Input id="fx-source" className="h-8 text-xs w-40" value={form.source} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))} /></div>
          <Button size="sm" className="h-8 text-xs" disabled={!valid || save.isPending} data-testid="exchange-rate-save"
            onClick={() => save.mutate({ currency: form.currency, rate_date: form.rate_date, rate: rateN, source: form.source }, { onSuccess: () => setForm((f) => ({ ...f, rate: "" })) })}>
            Enregistrer le cours</Button>
        </div>
      )}
      <div className="bg-card border border-border rounded-lg overflow-x-auto">
        {rates.isLoading ? <div className="p-4"><Loader2 className="w-4 h-4 animate-spin" /></div> : (
          <table className="w-full text-xs" data-testid="exchange-rates">
            <thead><tr className="bg-muted/30 text-muted-foreground"><th className="text-left p-2">Devise</th><th className="text-left">Date</th>
              <th className="text-right pr-3">Cours ({base})</th><th className="text-left">Source</th><th className="text-left">Origine</th><th /></tr></thead>
            <tbody>
              {(rates.data ?? []).length === 0 && <tr><td colSpan={6} className="p-3 text-muted-foreground">Aucun cours pour la devise {base}.</td></tr>}
              {(rates.data ?? []).map((r) => (
                <tr key={r.id} className="border-t border-border/50">
                  <td className="p-2 font-mono">{r.currency}</td>
                  <td>{new Date(r.rate_date).toLocaleDateString("fr-FR")}</td>
                  <td className="text-right pr-3 tabular-nums">{fmtRate(r.rate)}</td>
                  <td>{r.source}</td>
                  <td>{r.tenant_id ? "Société" : "Référence"}</td>
                  <td className="text-right pr-2">
                    {canEdit && r.tenant_id && (
                      <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Supprimer le cours ${r.currency} du ${r.rate_date}`}
                        disabled={remove.isPending} onClick={() => remove.mutate(r.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
