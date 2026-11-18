import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { inventoryCampaignPolicy, parseInventoryDecimal, type InventoryCampaignPolicy } from "@/lib/inventory-campaign";

export function InventoryCampaignPolicyCard({ tenantId }: { tenantId: string }) {
  const client = useQueryClient();
  const key = ["inventory-campaign-policy", tenantId];
  const current = useQuery({ queryKey: key, queryFn: () => inventoryCampaignPolicy(tenantId), retry: false });
  const [draft, setDraft] = useState<{ percent?: string; value?: string }>({});
  const percentInput = draft.percent ?? String(current.data?.percent ?? "");
  const valueInput = draft.value ?? String(current.data?.value ?? "");
  const percent = parseInventoryDecimal(percentInput);
  const value = parseInventoryDecimal(valueInput);
  const invalid = Number.isNaN(percent) || Number.isNaN(value);
  const save = useMutation({
    mutationFn: (policy: InventoryCampaignPolicy) => inventoryCampaignPolicy(tenantId, policy),
    onSuccess: (policy) => { client.setQueryData(key, policy); setDraft({}); },
  });

  return <Card>
    <CardHeader><CardTitle className="text-sm">Seuils des inventaires physiques</CardTitle></CardHeader>
    <CardContent className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Un écart exige un recomptage s’il dépasse l’un des seuils renseignés. Laissez un seuil vide pour l’ignorer.
        Un seuil de zéro déclenche un recomptage dès le premier écart mesurable.
        Les valeurs sont figées au premier contrôle de chaque campagne.
      </p>
      {current.isPending && <p role="status">Chargement des seuils…</p>}
      {current.isError && <div role="alert">{current.error.message}{" "}
        <Button size="sm" variant="outline" onClick={() => void current.refetch()}>Réessayer</Button>
      </div>}
      {current.isSuccess && <>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="inventory-campaign-percent">Seuil en pourcentage (%)</Label>
            <Input id="inventory-campaign-percent" inputMode="decimal" value={percentInput} disabled={save.isPending}
              onChange={(event) => { save.reset(); setDraft({ ...draft, percent: event.target.value }); }} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="inventory-campaign-value">Seuil en valeur (devise comptable)</Label>
            <Input id="inventory-campaign-value" inputMode="decimal" value={valueInput} disabled={save.isPending}
              onChange={(event) => { save.reset(); setDraft({ ...draft, value: event.target.value }); }} />
          </div>
        </div>
        {invalid && <p role="alert">Entrez un nombre positif ou nul, avec une virgule ou un point décimal.</p>}
        {save.isError && <p role="alert" className="text-destructive">{save.error.message}</p>}
        {save.isSuccess && <p role="status">Seuils enregistrés pour cette société.</p>}
        <Button size="sm" disabled={save.isPending || invalid || (percent === null && value === null) || !Object.keys(draft).length}
          onClick={() => save.mutate({ percent, value })}>Enregistrer les seuils</Button>
      </>}
    </CardContent>
  </Card>;
}
