import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { inventoryCampaignNumbering, type CampaignNumbering } from "@/lib/inventory-campaign";

export function InventoryCampaignNumberingCard({ tenantId }: { tenantId: string }) {
  const client = useQueryClient();
  const key = ["inventory-campaign-numbering", tenantId];
  const current = useQuery({ queryKey: key, queryFn: () => inventoryCampaignNumbering(tenantId), retry: false });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const prefixInput = draft.prefix ?? current.data?.prefix ?? "";
  const widthInput = draft.width ?? String(current.data?.width ?? "");
  const nextInput = draft.next ?? String(current.data?.next ?? "");
  const prefix = prefixInput.trim().toUpperCase();
  const width = Number(widthInput);
  const next = Number(nextInput);
  const valid = /^[A-Z0-9][A-Z0-9_-]{0,14}$/.test(prefix) && /^\d+$/.test(widthInput) &&
    width >= 1 && width <= 10 && /^\d+$/.test(nextInput) && next > 0 && next < 2_147_483_647 &&
    next >= (current.data?.next ?? 1);
  const save = useMutation({
    mutationFn: (series: CampaignNumbering) => inventoryCampaignNumbering(tenantId, series),
    onSuccess: (series) => { client.setQueryData(key, series); setDraft({}); },
  });

  return <Card>
    <CardHeader><CardTitle className="text-sm">Références des campagnes d’inventaire</CardTitle></CardHeader>
    <CardContent className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Choisissez la série utilisée pour les prochaines campagnes. Les références déjà attribuées sont conservées.
      </p>
      {current.isPending && <p role="status">Chargement de la série…</p>}
      {current.isError && <div role="alert">{current.error.message}{" "}
        <Button size="sm" variant="outline" onClick={() => void current.refetch()}>Réessayer</Button></div>}
      {current.isSuccess && <>
        {!current.data.prefix && <p className="text-sm">Sans série configurée, la campagne utilise sa référence système.</p>}
        <div className="grid gap-3 sm:grid-cols-3">
          {([
            ["prefix", "Préfixe", prefixInput, 15, "text"],
            ["width", "Nombre minimal de chiffres", widthInput, 2, "numeric"],
            ["next", "Prochain numéro", nextInput, 10, "numeric"],
          ] as const).map(([field, label, value, maxLength, mode]) => <div key={field} className="space-y-1">
            <Label htmlFor={`inventory-number-${field}`}>{label}</Label>
            <Input id={`inventory-number-${field}`} inputMode={mode} value={value} maxLength={maxLength} disabled={save.isPending}
              onChange={(event) => { save.reset(); setDraft({ ...draft, [field]: event.target.value }); }} />
          </div>)}
        </div>
        {valid && <p className="text-sm">Prochaine référence : <span className="font-mono">{prefix + String(next).padStart(width, "0")}</span></p>}
        {Object.keys(draft).length > 0 && !valid && <p className="text-sm text-muted-foreground">
          Saisissez un préfixe alphanumérique, une longueur de 1 à 10 chiffres et un prochain numéro qui ne recule pas.
        </p>}
        {save.isError && <p role="alert" className="text-destructive">{save.error.message}</p>}
        {save.isSuccess && <p role="status">Série enregistrée pour cette société.</p>}
        <Button size="sm" disabled={save.isPending || !valid || !Object.keys(draft).length}
          onClick={() => save.mutate({ prefix, width, next })}>Enregistrer la série</Button>
      </>}
    </CardContent>
  </Card>;
}
