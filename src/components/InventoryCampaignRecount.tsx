import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { inventoryCampaignControl, parseInventoryCount, saveInventoryCampaignCounts,
  type CampaignCountEntry, type InventoryCampaignRecount } from "@/lib/inventory-campaign";
import { InventoryCampaignSheet } from "@/components/InventoryCampaignSheet";

export function InventoryCampaignRecount({ tenantId, campaignId, reference }: {
  tenantId: string; campaignId: string; reference: string | null;
}) {
  const client = useQueryClient();
  const key = ["inventory-campaign-recount", tenantId, campaignId];
  const tasks = useQuery({
    queryKey: key, retry: false,
    queryFn: () => inventoryCampaignControl<InventoryCampaignRecount>("recount_tasks", campaignId),
  });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: (entries: CampaignCountEntry[]) => saveInventoryCampaignCounts<InventoryCampaignRecount>(campaignId, "recount", entries),
    onSuccess: (data, entries) => {
      client.setQueryData(key, data);
      void client.invalidateQueries({ queryKey: ["inventory-campaign-review-active", tenantId] });
      void client.invalidateQueries({ queryKey: ["inventory-campaign-catalog", tenantId] });
      setDraft((previous) => {
        const next = { ...previous };
        for (const entry of entries) delete next[entry.item_id];
        return next;
      });
    },
  });
  const entries = tasks.data?.lines.flatMap((line) => {
    const quantity = parseInventoryCount(draft[line.item_id] ?? "");
    return quantity === null ? [] : [{ item_id: line.item_id, quantity }];
  }) ?? [];

  return <section aria-labelledby="inventory-recount-title" className="space-y-2 border-t pt-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-medium" id="inventory-recount-title">Recomptage à l’aveugle</h3>
      <Button size="sm" variant="outline" disabled={tasks.isFetching || save.isPending}
        onClick={() => void tasks.refetch()}>Actualiser les recomptages</Button>
    </div>
    {tasks.isFetching && <p role="status">Recherche des recomptages…</p>}
    {tasks.isError && <p role="alert" className="text-destructive">{tasks.error.message}</p>}
    {save.isError && <p role="alert" className="text-destructive">{save.error.message}</p>}
    {save.isSuccess && <p role="status">Recomptage enregistré.</p>}
    {tasks.isSuccess && !tasks.data.lines.length && <p className="text-sm text-muted-foreground">Aucun article à recompter pour vous.</p>}
    {!!tasks.data?.lines.length && <InventoryCampaignSheet campaignId={campaignId} reference={reference} stage="recount" items={tasks.data.lines}
      disabled={tasks.isFetching || save.isPending} onImport={async (counts) => { await save.mutateAsync(counts); }} />}
    <ul className="divide-y">
      {tasks.data?.lines.map((line) => {
        const value = draft[line.item_id] ?? "";
        const quantity = parseInventoryCount(value);
        return <li className="flex flex-wrap items-center gap-2 py-2" key={line.item_id}>
          <Label htmlFor={`recount-${line.item_id}`}>{line.code} — {line.name} ({line.unit})</Label>
          <Input id={`recount-${line.item_id}`} className="w-28" inputMode="decimal" value={value}
            disabled={save.isPending} onChange={(event) => setDraft({ ...draft, [line.item_id]: event.target.value })} />
          <Button size="sm" variant="outline" disabled={tasks.isFetching || save.isPending || quantity === null}
            onClick={() => { if (quantity !== null) save.mutate([{ item_id: line.item_id, quantity }]); }}>
            Enregistrer le recomptage
          </Button>
        </li>;
      })}
    </ul>
    {entries.length > 1 && <Button size="sm" variant="outline" disabled={save.isPending || tasks.isFetching
      || entries.length !== Object.keys(draft).length || entries.length > 5000}
      onClick={() => save.mutate(entries)}>Enregistrer tous les recomptages</Button>}
  </section>;
}
