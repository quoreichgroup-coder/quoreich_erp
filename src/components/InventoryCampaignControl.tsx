import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useWarehouses } from "@/hooks/use-inventory-data";
import { campaignTabTarget, inventoryCampaignControl, type InventoryCampaignReview } from "@/lib/inventory-campaign";
import { exportToXLSX } from "@/lib/xlsx";

type ControlAction = "review" | "request_recount" | "validate";
const display = (number: number | null) => number === null ? "—" : number.toLocaleString("fr-FR", { maximumFractionDigits: 4 });

export function InventoryCampaignControl({
  tenantId, campaignId, defaultWarehouseId, canExport,
}: { tenantId: string; campaignId?: string; defaultWarehouseId?: string; canExport: boolean }) {
  const { data: warehouses = [] } = useWarehouses();
  const [params] = useSearchParams();
  const [chosenWarehouse, setWarehouse] = useState<string>();
  const warehouse = chosenWarehouse ?? defaultWarehouseId ?? "";
  const [review, setReview] = useState<InventoryCampaignReview | null>(null);
  const client = useQueryClient();
  const selected = useQuery({
    queryKey: ["inventory-campaign-review-active", tenantId, warehouse],
    enabled: !campaignId && Boolean(warehouse),
    queryFn: () => inventoryCampaignControl<{ id: string } | null>("active_review", warehouse),
    retry: false,
  });
  const selectedId = campaignId ?? selected.data?.id;
  const operation = useMutation({
    mutationFn: ({ action, id }: { action: ControlAction; id: string }) =>
      inventoryCampaignControl<InventoryCampaignReview>(action, id),
    onSuccess: (data, { action }) => {
      setReview(data);
      if (action !== "review") {
        void client.invalidateQueries({ queryKey: ["inventory-campaign-recount", tenantId, data.id] });
        void client.invalidateQueries({ queryKey: ["inventory-campaign-catalog", tenantId] });
      }
      if (action === "validate") {
        void client.invalidateQueries({ queryKey: ["inventory-campaign", tenantId] });
        void client.invalidateQueries({ queryKey: ["inventory-campaign-review-active", tenantId] });
        void client.invalidateQueries({ queryKey: ["inventory-cycle-plan", tenantId] });
        for (const key of ["stock-movements", "items", "stock-valuation", "inventory-kpis",
          "inventory-kpis-view", "item-locations", "journal-entries", "gl-batches", "low-stock", "inventory-cycle-analysis"]) {
          void client.invalidateQueries({ queryKey: [key] });
        }
      }
    },
  });
  const required = review?.lines.filter((line) => line.requires_recount) ?? [];
  const awaiting = required.filter((line) => line.second_count === null);
  const canRequest = awaiting.some((line) => !line.recount_requested);
  const download = () => {
    if (!review) return;
    const rows = review.lines.map((line) => ({
      campaign: review.reference ?? review.id, code: line.code, article: line.name, unit: line.unit,
      expected: line.expected, first: line.first_count, second: line.second_count,
      counted: line.effective_count, difference: line.variance, movement: line.movement_id,
      postedCost: line.posted_unit_cost, postedValue: line.posted_value, piece: line.journal_piece_number,
    }));
    exportToXLSX(rows, [
      { key: "campaign", header: "Référence campagne" }, { key: "code", header: "Code article" },
      { key: "article", header: "Article" }, { key: "unit", header: "Unité" },
      { key: "expected", header: "Stock figé" }, { key: "first", header: "Premier comptage" },
      { key: "second", header: "Recomptage" }, { key: "counted", header: "Quantité retenue" },
      { key: "difference", header: "Écart" },
      { key: "movement", header: "Mouvement stock" }, { key: "postedCost", header: "Coût unitaire comptabilisé" },
      { key: "postedValue", header: "Valeur du mouvement" }, { key: "piece", header: "Pièce comptable" },
    ], `ecarts-inventaire-${review.reference ?? review.id}`, "Écarts d’inventaire");
  };

  return <Card>
    <CardHeader><CardTitle className="text-base">Contrôle des inventaires</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      {campaignId
        ? <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm">Référence de campagne : <span className="font-mono">{review?.reference ?? campaignId}</span></p>
          <Button asChild size="sm" variant="outline"><Link to={campaignTabTarget(params, "campaign-catalog")}>Retour au catalogue</Link></Button>
        </div>
        : <div className="space-y-1">
          <Label htmlFor="inventory-review-depot">Dépôt à contrôler</Label>
          <select id="inventory-review-depot" className="block h-9 rounded-md border border-input bg-background px-2"
            value={warehouse} disabled={operation.isPending}
            onChange={(event) => { setWarehouse(event.target.value); setReview(null); operation.reset(); }}>
            <option value="">Choisir un dépôt</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
          </select>
        </div>}
      {selected.isFetching && <p role="status">Recherche d’une campagne soumise…</p>}
      {selected.isError && <div role="alert">{selected.error.message}{" "}
        <Button size="sm" variant="outline" onClick={() => void selected.refetch()}>Réessayer</Button></div>}
      {!campaignId && !review && selected.isSuccess && !selectedId && <p>Aucune campagne soumise pour ce dépôt.</p>}
      {!review && selectedId && <Button disabled={operation.isPending}
        onClick={() => operation.mutate({ action: "review", id: selectedId })}>Consulter les écarts</Button>}
      {operation.isError && <div role="alert" className="text-destructive">
        {operation.error.message}{" "}
        <Link className="underline" to="/inventory/settings?tab=inventaires">Paramètres des inventaires</Link>
      </div>}
      {review && <>
        <p role="status" className="text-sm">{review.state === "validated" ? "Campagne validée · dépôt libéré" : "Campagne soumise · dépôt gelé"}</p>
        {!campaignId && <p className="text-sm">Référence : <span className="font-mono">{review.reference ?? review.id}</span></p>}
        <p className="text-sm text-muted-foreground">
          Seuils de la campagne : {review.percent === null ? "pourcentage non utilisé" : `${display(review.percent)} %`}
          {" · "}{review.value === null ? "valeur non utilisée" : `${display(review.value)} en devise comptable`}.
        </p>
        <Table>
          <TableHeader><TableRow>{["Article", "Stock figé", "Compté", "Recompté", "Écart retenu", "Contrôle",
            ...(review.state === "validated" ? ["Pièce comptable"] : [])].map((label) =>
            <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader>
          <TableBody>{review.lines.map((line) => <TableRow key={line.item_id}>
            <TableCell>{line.code} — {line.name} ({line.unit})</TableCell>
            <TableCell>{display(line.expected)}</TableCell><TableCell>{display(line.first_count)}</TableCell>
            <TableCell>{display(line.second_count)}</TableCell><TableCell>{display(line.variance)}</TableCell>
            <TableCell>{!line.requires_recount ? "Dans la tolérance" : line.second_count !== null ? "Recompté"
              : line.recount_requested ? "Recomptage en attente" : "Recomptage requis"}</TableCell>
            {review.state === "validated" && <TableCell className="font-mono">{line.journal_piece_number ?? "—"}</TableCell>}
          </TableRow>)}</TableBody>
        </Table>
        <div className="flex flex-wrap gap-2">
          {review.state === "submitted" && <>
            <Button size="sm" variant="outline" disabled={operation.isPending}
              onClick={() => operation.mutate({ action: "review", id: review.id })}>Actualiser les écarts</Button>
            {canRequest && <Button size="sm" variant="outline" disabled={operation.isPending}
              onClick={() => operation.mutate({ action: "request_recount", id: review.id })}>Demander le recomptage</Button>}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" disabled={operation.isPending || awaiting.length > 0}>Valider et ajuster le stock</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader><AlertDialogTitle>Valider la campagne ?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Les écarts retenus seront enregistrés dans les mouvements du dépôt. Le gel sera levé si la validation réussit.
                  </AlertDialogDescription></AlertDialogHeader>
                <AlertDialogFooter><AlertDialogCancel>Revenir au contrôle</AlertDialogCancel>
                  <AlertDialogAction onClick={() => operation.mutate({ action: "validate", id: review.id })}>
                    Confirmer la validation
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>}
          {review.state === "validated" && canExport && <Button size="sm" variant="outline" onClick={download}>Exporter les écarts (Excel)</Button>}
        </div>
      </>}
    </CardContent>
  </Card>;
}
