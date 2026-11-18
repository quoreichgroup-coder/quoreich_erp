import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseInventoryDecimal } from "@/lib/inventory-campaign";
import { CYCLE_BASIS_LABEL, inventoryCyclePolicy, type CycleBasis, type CyclePolicy } from "@/lib/inventory-cycle-count";

const fields = [
  ["a_percent", "Fin de la classe A (% cumulé)", "decimal"],
  ["b_percent", "Fin de la classe B (% cumulé)", "decimal"],
  ["a_days", "Classe A : tous les (jours)", "numeric"],
  ["b_days", "Classe B : tous les (jours)", "numeric"],
  ["c_days", "Classe C : tous les (jours)", "numeric"],
  ["unvalued_days", "Sans valeur : tous les (jours, facultatif)", "numeric"],
  ["batch_size", "Articles maximum par campagne", "numeric"],
] as const;

export function InventoryCyclePolicyCard({ tenantId }: { tenantId: string }) {
  const client = useQueryClient();
  const key = ["inventory-cycle-policy", tenantId];
  const query = useQuery({ queryKey: key, retry: false, queryFn: () => inventoryCyclePolicy(tenantId) });
  const current = query.data?.configured ? query.data : undefined;
  const [draft, setDraft] = useState<Partial<Record<keyof CyclePolicy, string>>>({});
  const value = (field: keyof CyclePolicy) => draft[field] ?? String(current?.[field] ?? "");
  const integer = (field: keyof CyclePolicy) => /^\d+$/.test(value(field).trim()) ? Number(value(field)) : NaN;
  const basis = value("basis") as CycleBasis;
  const rule: CyclePolicy = {
    basis, lookback_months: basis === "outflow_value" ? integer("lookback_months") : null,
    a_percent: parseInventoryDecimal(value("a_percent")), b_percent: parseInventoryDecimal(value("b_percent")),
    a_days: integer("a_days"), b_days: integer("b_days"), c_days: integer("c_days"),
    unvalued_days: value("unvalued_days").trim() ? integer("unvalued_days") : null, batch_size: integer("batch_size"),
  };
  const daysOK = (number: number) => Number.isInteger(number) && number >= 1 && number <= 36500;
  const valid = (basis === "stock_value" || (basis === "outflow_value" && rule.lookback_months >= 1 && rule.lookback_months <= 120))
    && rule.a_percent > 0 && rule.a_percent < rule.b_percent && rule.b_percent < 100
    && [rule.a_days, rule.b_days, rule.c_days].every(daysOK) && (rule.unvalued_days === null || daysOK(rule.unvalued_days))
    && rule.batch_size >= 1 && rule.batch_size <= 5000;
  const save = useMutation({
    mutationFn: (policy: CyclePolicy) => inventoryCyclePolicy(tenantId, policy),
    onSuccess: (policy) => {
      client.setQueryData(key, policy);
      void client.invalidateQueries({ queryKey: ["inventory-cycle-plan", tenantId] });
      void client.invalidateQueries({ queryKey: ["inventory-cycle-analysis", tenantId] });
      setDraft({});
    },
  });
  const change = (field: keyof CyclePolicy, next: string) => { save.reset(); setDraft({ ...draft, [field]: next }); };

  return <Card className="lg:col-span-2">
    <CardHeader><CardTitle className="text-sm">Inventaire tournant ABC</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">
        QERP classe les articles suivis dans chaque dépôt sur la base retenue et propose ceux qui sont arrivés à échéance
        depuis leur dernier inventaire validé. La proposition n’ouvre pas de campagne.
      </p>
      {query.isPending && <p role="status">Chargement des règles du tournant…</p>}
      {query.isError && <div role="alert">{query.error.message}{" "}
        <Button size="sm" variant="outline" onClick={() => void query.refetch()}>Réessayer</Button></div>}
      {query.isSuccess && <>
        {!current && <p className="text-sm font-medium">Aucune fréquence n’est définie pour cette société.</p>}
        <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" disabled={save.isPending}>
          <div className="space-y-1">
            <Label htmlFor="cycle-basis">Base du classement</Label>
            <select id="cycle-basis" value={basis} className="block h-9 w-full rounded-md border border-input bg-background px-2"
              onChange={(event) => change("basis", event.target.value)}>
              <option value="">Choisir la base</option>
              {Object.entries(CYCLE_BASIS_LABEL).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
            </select>
          </div>
          {basis === "outflow_value" && <div className="space-y-1">
            <Label htmlFor="cycle-lookback">Historique des sorties (mois)</Label>
            <Input id="cycle-lookback" inputMode="numeric" value={value("lookback_months")}
              onChange={(event) => change("lookback_months", event.target.value)} />
          </div>}
          {fields.map(([key, label, mode]) => <div className="space-y-1" key={key}>
            <Label htmlFor={`cycle-${key}`}>{label}</Label>
            <Input id={`cycle-${key}`} inputMode={mode} value={value(key)} onChange={(event) => change(key, event.target.value)} />
          </div>)}
        </fieldset>
        <p className="text-sm text-muted-foreground">
          Le seuil cumulé A doit être inférieur à B et tous deux à 100 %. Laissez la fréquence « Sans valeur » vide pour exclure ces articles.
          Les transferts et ajustements sont exclus de l’analyse des sorties.
        </p>
        {save.isError && <p role="alert" className="text-destructive">{save.error.message}</p>}
        {save.isSuccess && <p role="status">Règle du tournant enregistrée.</p>}
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" disabled={!valid || !Object.keys(draft).length || save.isPending}
            onClick={() => save.mutate(rule)}>Enregistrer la règle ABC</Button>
          <Link to="/inventory/transactions?tab=inventory-cycle" className="text-sm text-primary underline">Préparer un tournant</Link>
        </div>
      </>}
    </CardContent>
  </Card>;
}
