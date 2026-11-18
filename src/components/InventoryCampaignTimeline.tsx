import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { fetchCampaignTimeline, type CampaignEvent } from "@/lib/inventory-campaign";
import { formatCatalogDate } from "@/lib/inventory-campaign-workbook";

const labels: Record<CampaignEvent["event"], string> = {
  opened: "Campagne ouverte", submitted: "Comptage soumis", validated: "Campagne validée", cancelled: "Campagne annulée",
};

export function InventoryCampaignTimeline({ tenantId, campaignId, reference }: {
  tenantId: string; campaignId: string; reference: string;
}) {
  const [open, setOpen] = useState(false);
  const history = useQuery({
    queryKey: ["inventory-campaign-timeline", tenantId, campaignId],
    enabled: open, retry: false, queryFn: () => fetchCampaignTimeline(tenantId, campaignId),
  });
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button size="sm" variant="ghost" aria-label={`Historique de ${reference}`}>Historique</Button></DialogTrigger>
    <DialogContent>
      <DialogHeader><DialogTitle>Historique de la campagne</DialogTitle>
        <DialogDescription className="font-mono">{reference}</DialogDescription>
      </DialogHeader>
      {history.isPending && <p role="status">Chargement des décisions…</p>}
      {history.isError && <div role="alert">{history.error.message}{" "}
        <Button size="sm" variant="outline" onClick={() => void history.refetch()}>Réessayer</Button></div>}
      {history.isSuccess && !history.data.length && <p>Aucune décision enregistrée.</p>}
      {history.isSuccess && !!history.data.length && <ol className="space-y-3">
        {history.data.map((entry) => <li key={entry.event} className="border-l-2 pl-3">
          <p className="font-medium">{labels[entry.event]}</p>
          <p className="text-sm text-muted-foreground">{formatCatalogDate(entry.date)} · {entry.actor}</p>
          {entry.reason && <p className="text-sm">Motif : {entry.reason}</p>}
        </li>)}
      </ol>}
    </DialogContent>
  </Dialog>;
}
