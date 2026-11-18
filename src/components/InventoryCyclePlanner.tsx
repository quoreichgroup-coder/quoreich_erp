import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useWarehouses } from "@/hooks/use-inventory-data";
import { CYCLE_BASIS_LABEL, inventoryCycleOpen, inventoryCyclePreview } from "@/lib/inventory-cycle-count";
import { campaignTabTarget } from "@/lib/inventory-campaign";

const dateLabel = (date: string | null, fallback: string) => date
  ? new Date(`${date}T00:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "UTC" }) : fallback;
const pageSize = 30;

export function InventoryCyclePlanner({ tenantId, defaultWarehouseId }: { tenantId: string; defaultWarehouseId?: string }) {
  const warehouses = useWarehouses();
  const [page, setPage] = useState(1);
  const [params, setParams] = useSearchParams();
  const requestedDepot = params.get("depot") ?? defaultWarehouseId ?? "";
  const warehouse = warehouses.data?.some((w) => w.id === requestedDepot) ? requestedDepot : "";
  const client = useQueryClient();
  const plan = useQuery({
    queryKey: ["inventory-cycle-plan", tenantId, warehouse],
    enabled: Boolean(warehouse), queryFn: () => inventoryCyclePreview(tenantId, warehouse), retry: false,
  });
  const open = useMutation({
    mutationFn: ({ id, signature }: { id: string; signature: string }) => inventoryCycleOpen(tenantId, id, signature),
    onSuccess: (data, { id }) => {
      void client.invalidateQueries({ queryKey: ["inventory-cycle-plan", tenantId], refetchType: "none" });
      void client.invalidateQueries({ queryKey: ["inventory-campaign", tenantId] });
      void client.invalidateQueries({ queryKey: ["inventory-campaign-catalog", tenantId] });
      setParams((previous) => campaignTabTarget(previous, "campaigns", { warehouse: id, campaign: data.id }).slice(1));
    },
  });
  const rows = plan.data?.lines ?? [];
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const shownPage = Math.min(page, pages);

  return <Card>
    <CardHeader><CardTitle className="text-base">Préparer un inventaire tournant ABC</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Les articles arrivés à échéance sont proposés automatiquement. Le dépôt reste ouvert aux mouvements jusqu’à la confirmation.
      </p>
      <div className="space-y-1">
        <Label htmlFor="cycle-depot">Dépôt du tournant</Label>
        <select id="cycle-depot" className="block h-9 rounded-md border border-input bg-background px-2"
          value={warehouse} disabled={open.isPending} onChange={(event) => {
            const next = new URLSearchParams(params);
            next.set("depot", event.target.value);
            setParams(next, { replace: true });
            setPage(1);
            open.reset();
          }}>
          <option value="">Choisir un dépôt</option>
          {(warehouses.data ?? []).map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
        </select>
      </div>
      {warehouses.isError && <p role="alert">Les dépôts n’ont pas pu être chargés.</p>}
      {warehouses.isSuccess && requestedDepot && !warehouse &&
        <p role="alert">Ce dépôt n’est pas disponible dans la société active. Choisissez un dépôt.</p>}
      {plan.isFetching && <p role="status">Calcul du plan de comptage…</p>}
      {(plan.isError || open.isError) && <div role="alert" className="space-y-1 text-sm text-destructive">
        <p>{open.error?.message ?? plan.error?.message}</p>
        <Link className="underline" to="/inventory/settings?tab=inventaires">Paramètres des inventaires</Link>
      </div>}
      {warehouse && <Button size="sm" variant="outline" disabled={plan.isFetching || open.isPending}
        onClick={() => { open.reset(); void plan.refetch(); }}>Actualiser la proposition</Button>}
      {plan.data?.active_campaign && <div className="space-y-2">
        <p className="text-sm">Une campagne est déjà active pour ce dépôt.</p>
        <Button asChild size="sm" variant="outline"><Link to={campaignTabTarget(params, "campaigns", {
          warehouse, campaign: plan.data.active_campaign,
        })}>Reprendre la campagne active</Link></Button>
      </div>}
      {plan.isSuccess && !plan.data.active_campaign && <>
        <p className="text-sm">
          {plan.data.due_total} article(s) à échéance, {rows.length} dans la proposition.
          {plan.data.basis && <> Base : {CYCLE_BASIS_LABEL[plan.data.basis]}.</>}
        </p>
        {!rows.length && <p className="text-sm text-muted-foreground">Aucun article ne doit être compté pour cette règle aujourd’hui.</p>}
        {!!rows.length && <Table>
          <TableHeader><TableRow>{["Article", "Unité", "Classe", "Dernière validation", "Échéance"].map((label) =>
            <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader>
          <TableBody>{rows.slice((shownPage - 1) * pageSize, shownPage * pageSize).map((line) => <TableRow key={line.item_id}>
            <TableCell>{line.code} — {line.name}</TableCell><TableCell>{line.unit}</TableCell>
            <TableCell><Badge variant="secondary">{line.class === "N" ? "Sans valeur" : line.class}</Badge></TableCell>
            <TableCell>{dateLabel(line.last_validated, "Jamais validé")}</TableCell>
            <TableCell>{dateLabel(line.due_date, "À compter")}</TableCell>
          </TableRow>)}</TableBody>
        </Table>}
        {pages > 1 && <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={shownPage === 1} onClick={() => setPage(shownPage - 1)}>Précédent</Button>
          <span className="text-sm">Page {shownPage} / {pages}</span>
          <Button size="sm" variant="outline" disabled={shownPage === pages} onClick={() => setPage(shownPage + 1)}>Suivant</Button>
        </div>}
        {!!rows.length && plan.data.signature && <AlertDialog>
          <AlertDialogTrigger asChild><Button size="sm" disabled={open.isPending || plan.isFetching}>Ouvrir la campagne tournante</Button></AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>Geler le dépôt pour cette campagne ?</AlertDialogTitle>
              <AlertDialogDescription>La campagne reprendra les {rows.length} articles de la proposition. Le dépôt restera gelé jusqu’à validation ou annulation.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter><AlertDialogCancel>Revenir à la proposition</AlertDialogCancel>
              <AlertDialogAction onClick={() => open.mutate({ id: warehouse, signature: plan.data.signature! })}>Confirmer le gel du dépôt</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>}
      </>}
    </CardContent>
  </Card>;
}
