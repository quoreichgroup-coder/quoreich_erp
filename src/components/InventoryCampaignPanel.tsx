import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWarehouses } from "@/hooks/use-inventory-data";
import { supabase } from "@/integrations/supabase/client";
import { CAMPAIGN_SCOPE_LABEL, parseInventoryCount, previewCampaignScope, saveInventoryCampaignCounts,
  type CampaignCountEntry, type CampaignItemScope, type InventoryCampaignItem } from "@/lib/inventory-campaign";
import { InventoryCampaignRecount } from "@/components/InventoryCampaignRecount";
import { InventoryCampaignSheet } from "@/components/InventoryCampaignSheet";

type Campaign = {
  id: string;
  reference: string | null;
  item_scope: CampaignItemScope;
  state: "counting" | "submitted" | "cancelled";
  can_cancel: boolean;
  lines: (InventoryCampaignItem & { counted: number | null; is_counted: boolean; can_edit: boolean })[];
};
type Action = "active" | "open" | "count" | "submit" | "cancel";

async function campaignAction(action: Action, id: string, item?: string, quantity?: number, reason?: string) {
  const { data, error } = await supabase.rpc("inventory_campaign" as never, {
    _action: action, _id: id, ...(item ? { _item: item, _quantity: quantity } : {}), ...(reason ? { _reason: reason } : {}),
  } as never);
  if (action === "open" && error?.code === "23505" && error.message.includes("inventory_campaign_active_depot")) {
    throw new Error("Une campagne est déjà ouverte pour ce dépôt. Rechargez la campagne pour continuer.");
  }
  if (action === "open" && error?.code === "23505" && error.message.includes("inventory_campaign_document_reference")) {
    throw new Error("La prochaine référence existe déjà. Vérifiez la série dans Stocks → Paramètres → Documents.");
  }
  if (error) throw new Error(error.message);
  return data as Campaign | null;
}

export function InventoryCampaignPanel({ tenantId, defaultWarehouseId, initialWarehouseId, expectedCampaignId, catalogueHref }: {
  tenantId: string; defaultWarehouseId?: string; initialWarehouseId?: string; expectedCampaignId?: string; catalogueHref?: string;
}) {
  const warehouses = useWarehouses();
  const [chosenWarehouse, setWarehouse] = useState<string>();
  const warehouse = chosenWarehouse ?? initialWarehouseId ?? defaultWarehouseId ?? "";
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [search, setSearch] = useState("");
  const [unrecorded, setUnrecorded] = useState(false);
  const [page, setPage] = useState(1);
  const client = useQueryClient();
  const key = ["inventory-campaign", tenantId, warehouse];
  const active = useQuery({
    queryKey: key, enabled: Boolean(warehouse), retry: false,
    queryFn: () => campaignAction("active", warehouse),
  });
  const preview = useQuery({
    queryKey: ["inventory-campaign-preview", tenantId, warehouse],
    enabled: Boolean(warehouse) && active.isSuccess && !active.data, retry: false, staleTime: 30_000,
    queryFn: () => previewCampaignScope(tenantId, warehouse),
  });
  const action = useMutation({
    mutationFn: (input: { action: Action; id: string; item?: string; quantity?: number; reason?: string }) =>
      campaignAction(input.action, input.id, input.item, input.quantity, input.reason),
    onError: (_error, input) => {
      if (input.action === "open") void client.invalidateQueries({ queryKey: key });
    },
    onSuccess: (result, input) => {
      client.setQueryData(key, result?.state === "cancelled" ? null : result);
      void client.invalidateQueries({ queryKey: ["inventory-campaign-catalog", tenantId] });
      if (input.action === "submit" || input.action === "cancel") {
        void client.invalidateQueries({ queryKey: ["inventory-campaign-review-active", tenantId] });
      }
      if (input.action === "open" || input.action === "cancel") {
        void client.invalidateQueries({ queryKey: ["inventory-cycle-plan", tenantId] });
      }
      if (input.item) setDraft((values) => {
        const next = { ...values };
        delete next[input.item!];
        return next;
      });
      setConfirmCancel(false);
      setCancelReason("");
    },
  });
  const bulk = useMutation({
    mutationFn: ({ id, entries }: { id: string; entries: CampaignCountEntry[] }) =>
      saveInventoryCampaignCounts<Campaign>(id, "first", entries),
    onSuccess: (result, { entries }) => {
      client.setQueryData(key, result);
      void client.invalidateQueries({ queryKey: ["inventory-campaign-catalog", tenantId] });
      setDraft((previous) => {
        const next = { ...previous };
        for (const entry of entries) delete next[entry.item_id];
        return next;
      });
    },
  });
  const isDifferentCampaign = Boolean(expectedCampaignId && chosenWarehouse === undefined && active.isSuccess
    && active.data?.id !== expectedCampaignId);
  const campaign = isDifferentCampaign ? null : active.data;
  const locked = action.isPending || active.isFetching || bulk.isPending;
  const visibleLines = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("fr-FR");
    return (campaign?.lines ?? []).filter((line) => (!unrecorded || !line.is_counted)
      && (!term || `${line.code} ${line.name}`.toLocaleLowerCase("fr-FR").includes(term)));
  }, [campaign, search, unrecorded]);
  const pages = Math.max(1, Math.ceil(visibleLines.length / 50));
  const shownPage = Math.min(page, pages);
  const manualEntries = campaign?.lines.flatMap((line) => {
    const quantity = parseInventoryCount(draft[line.item_id] ?? "");
    return quantity === null || !line.can_edit ? [] : [{ item_id: line.item_id, quantity }];
  }) ?? [];
  const draftSize = Object.keys(draft).length;
  const labels = { counting: "Comptage en cours", submitted: "Comptage soumis · dépôt gelé", cancelled: "Annulée" };

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Inventaire physique</CardTitle>
        {catalogueHref && <Button asChild size="sm" variant="outline"><Link to={catalogueHref}>Retour au catalogue</Link></Button>}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="campaign-warehouse">Dépôt à inventorier</Label>
          <select id="campaign-warehouse" className="block h-9 rounded-md border border-input bg-background px-2"
            value={warehouse} disabled={action.isPending || bulk.isPending}
            onChange={(e) => {
              setWarehouse(e.target.value); setDraft({}); setConfirmCancel(false); setCancelReason("");
              setSearch(""); setUnrecorded(false); setPage(1); action.reset(); bulk.reset();
            }}>
            <option value="">Choisir un dépôt</option>
            {(warehouses.data ?? []).map((w) => <option value={w.id} key={w.id}>{w.code} — {w.name}</option>)}
          </select>
        </div>
        {warehouses.isError && <p role="alert">Les dépôts n’ont pas pu être chargés.</p>}
        {active.isFetching && <p role="status">Recherche de la campagne…</p>}
        {active.isError && <div role="alert">{active.error.message}{" "}
          <Button size="sm" variant="outline" onClick={() => void active.refetch()}>Réessayer</Button></div>}
        {action.isError && <p role="alert" className="text-destructive">{action.error.message}</p>}
        {bulk.isError && <p role="alert" className="text-destructive">{bulk.error.message}</p>}
        {isDifferentCampaign && <div role="status" className="space-y-2">
          <p>La campagne sélectionnée n’est plus active dans ce dépôt.</p>
          <Button size="sm" variant="outline" onClick={() => setWarehouse(warehouse)}>Afficher la situation actuelle du dépôt</Button>
        </div>}
        {warehouse && active.isSuccess && !campaign && !isDifferentCampaign && <>
          <p className="text-sm text-muted-foreground">L’ouverture bloque les mouvements de ce dépôt jusqu’à l’annulation ou à la validation.</p>
          {preview.isFetching && <p role="status">Préparation du périmètre…</p>}
          {preview.isError && <div role="alert">{preview.error.message}{" "}
            <Button size="sm" variant="outline" onClick={() => void preview.refetch()}>Recharger le périmètre</Button></div>}
          {preview.data && <p className="text-sm">{CAMPAIGN_SCOPE_LABEL[preview.data.item_scope]} : {preview.data.articles} article(s).</p>}
          <Button disabled={locked || !preview.isSuccess || !preview.data.articles}
            onClick={() => action.mutate({ action: "open", id: warehouse })}>Ouvrir et geler le dépôt</Button>
        </>}
        {campaign && <>
          <p role="status">{labels[campaign.state]}</p>
          {campaign.reference && <p className="text-sm">Référence : <span className="font-mono">{campaign.reference}</span></p>}
          {campaign.item_scope && <p className="text-sm text-muted-foreground">{CAMPAIGN_SCOPE_LABEL[campaign.item_scope]}</p>}
          {campaign.state === "counting" && <InventoryCampaignSheet key={campaign.id} campaignId={campaign.id}
            reference={campaign.reference ?? null} stage="first" items={campaign.lines.filter((line) => line.can_edit)} disabled={locked}
            onImport={async (entries) => { await bulk.mutateAsync({ id: campaign.id, entries }); }} />}
          {campaign.state === "counting" && <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="campaign-item-search">Rechercher un article</Label>
              <Input id="campaign-item-search" type="search" placeholder="Code ou désignation" value={search}
                onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
            </div>
            <Label className="flex h-9 items-center gap-2">
              <input type="checkbox" checked={unrecorded} onChange={(event) => { setUnrecorded(event.target.checked); setPage(1); }} />
              Non comptés uniquement
            </Label>
          </div>}
          <ul className="divide-y">
            {visibleLines.slice((shownPage - 1) * 50, shownPage * 50).map((line) => {
              const value = draft[line.item_id] ?? String(line.counted ?? "");
              const quantity = parseInventoryCount(value);
              return <li className="flex flex-wrap items-center gap-2 py-2" key={line.item_id}>
                <Label className="min-w-28" htmlFor={`count-${line.item_id}`}>
                  {line.code} — {line.name} ({line.unit})
                </Label>
                <Input id={`count-${line.item_id}`} className="w-28" inputMode="decimal" value={value}
                  placeholder={line.is_counted && line.counted === null ? "Déjà compté" : undefined}
                  disabled={locked || !line.can_edit}
                  onChange={(e) => setDraft({ ...draft, [line.item_id]: e.target.value })} />
                {line.can_edit && <Button size="sm" variant="outline"
                  disabled={locked || quantity === null || draft[line.item_id] === undefined}
                  onClick={() => { if (quantity !== null) action.mutate({ action: "count", id: campaign.id, item: line.item_id, quantity }); }}>Enregistrer</Button>}
              </li>;
            })}
          </ul>
          {!visibleLines.length && <p className="text-sm text-muted-foreground">Aucun article ne correspond à la recherche.</p>}
          {pages > 1 && <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={shownPage === 1} onClick={() => setPage(shownPage - 1)}>Précédent</Button>
            <span className="text-sm">Page {shownPage} / {pages}</span>
            <Button size="sm" variant="outline" disabled={shownPage === pages} onClick={() => setPage(shownPage + 1)}>Suivant</Button>
          </div>}
          {campaign.state === "counting" && draftSize > 0 && <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={locked || draftSize !== manualEntries.length || draftSize > 5000}
              onClick={() => bulk.mutate({ id: campaign.id, entries: manualEntries })}>Enregistrer toutes les saisies</Button>
            <Button size="sm" variant="ghost" disabled={locked} onClick={() => setDraft({})}>Effacer les modifications non enregistrées</Button>
          </div>}
          {confirmCancel && <div className="space-y-1">
            <Label htmlFor="campaign-cancel-reason">Motif d’annulation</Label>
            <Input id="campaign-cancel-reason" value={cancelReason} maxLength={1000} disabled={locked}
              onChange={(e) => setCancelReason(e.target.value)} />
          </div>}
          <div className="flex flex-wrap items-center gap-2">
            {campaign.state === "counting" && <Button
              disabled={locked || draftSize > 0 || campaign.lines.some((line) => !line.is_counted)}
              onClick={() => action.mutate({ action: "submit", id: campaign.id })}>Soumettre le comptage</Button>}
            {campaign.can_cancel && <Button variant={confirmCancel ? "destructive" : "outline"}
              disabled={locked || (confirmCancel && !cancelReason.trim())}
              onClick={() => confirmCancel
                ? action.mutate({ action: "cancel", id: campaign.id, reason: cancelReason.trim() })
                : setConfirmCancel(true)}>
              {confirmCancel ? "Confirmer l’annulation et lever le gel" : "Annuler la campagne"}
            </Button>}
          </div>
          {campaign.state === "submitted" && <InventoryCampaignRecount key={campaign.id} tenantId={tenantId} campaignId={campaign.id}
            reference={campaign.reference ?? null} />}
        </>}
      </CardContent>
    </Card>
  );
}
