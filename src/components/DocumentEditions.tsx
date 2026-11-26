import { useId, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  canRetryDocumentEdition, downloadDocumentEdition, useDocumentEditions, useDocumentTemplates, useRequestDocumentEdition,
  type IssuedDocument,
} from "@/hooks/use-document-editions";

const statusLabels: Record<IssuedDocument["status"], string> = {
  queued: "En file d’attente",
  rendering: "Rendu en cours",
  ready: "PDF archivé",
  failed: "Échec du rendu",
};

type EditionDialog = { kind: "create" } | { kind: "replace"; edition: IssuedDocument };

type DocumentEditionsProps = ({ invoiceId: string; poId?: never } | { poId: string; invoiceId?: never }) & { canIssue: boolean };

export function PurchaseOrderEditions({ poId, status, canIssue }: { poId: string; status: string; canIssue: boolean }) {
  if (!canIssue || !["approved", "ordered", "partially_received", "received", "closed"].includes(status)) return null;
  return <DocumentEditions key={poId} poId={poId} canIssue={canIssue} />;
}

export function DocumentEditions({ invoiceId, poId, canIssue }: DocumentEditionsProps) {
  const docType = poId !== undefined ? "purchase_order" : "ar_invoice";
  const sourceId = poId ?? invoiceId;
  const [dialog, setDialog] = useState<EditionDialog | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [reason, setReason] = useState("");
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const initiator = useRef<HTMLButtonElement>(null);
  const request = useRequestDocumentEdition(sourceId, docType);
  const editions = useDocumentEditions(sourceId, request.submittedAt, docType);
  const templates = useDocumentTemplates(canIssue && dialog !== null, docType);
  const download = useMutation({ mutationFn: downloadDocumentEdition, retry: false });
  const replacedIds = new Set(editions.data?.map((edition) => edition.replaces_id));
  const latest = editions.data?.find((edition) => !replacedIds.has(edition.id));
  const retriedId = request.isSuccess && request.variables && "id" in request.variables ? request.variables.id : null;
  const now = Math.max(Date.now(), editions.dataUpdatedAt);
  const publishedTemplates = templates.data?.filter((template) => template.current_version_id);
  const defaultTemplate = publishedTemplates?.find((template) => template.is_default);
  const noPublishedTemplate = publishedTemplates?.length === 0;

  function open(event: MouseEvent<HTMLButtonElement>, next: EditionDialog) {
    initiator.current = event.currentTarget;
    request.reset();
    setTemplateId("");
    setReason("");
    setDialog(next);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canIssue || !dialog || request.isPending || noPublishedTemplate || (dialog.kind === "replace" && !reason.trim())) return;
    request.mutate({
      ...(poId !== undefined ? { po_id: poId } : { invoice_id: invoiceId }),
      ...(templateId && { template_id: templateId }),
      ...(dialog.kind === "replace" && { replace_id: dialog.edition.id, reason: reason.trim() }),
    }, { onSuccess: () => setDialog(null) });
  }

  return (
    <section className="space-y-3 rounded-md border bg-card p-3" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} ref={heading} tabIndex={-1} className="text-sm font-semibold">Éditions archivées</h3>
        {canIssue && editions.data?.length === 0 && (
          <Button size="sm" variant="outline" disabled={request.isPending}
            onClick={(event) => open(event, { kind: "create" })}>Créer une édition</Button>
        )}
      </div>
      {editions.isPending && <p className="text-xs text-muted-foreground">Chargement des éditions…</p>}
      {editions.isError && (
        <div className="space-y-2">
          <p role="alert" className="text-xs text-destructive">{editions.error.message}</p>
          <Button size="sm" variant="outline" disabled={editions.isFetching} onClick={() => void editions.refetch()}>Réessayer</Button>
        </div>
      )}
      {editions.data?.length === 0 && <p className="text-xs text-muted-foreground">{poId !== undefined
        ? "Aucun PDF archivé pour ce bon de commande." : "Aucun PDF archivé pour cette facture."}</p>}
      {editions.data?.length > 0 && (
        <ul className="divide-y">
          {editions.data.map((edition) => {
            const canReplace = latest?.id === edition.id;
            const mayRetry = canRetryDocumentEdition(edition, now, retriedId === edition.id ? request.submittedAt : 0);
            return (
              <li key={edition.id} className="space-y-2 py-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <span className="font-medium">{edition.reference}</span>
                  <span role="status" className={edition.status === "failed" ? "text-destructive" : "text-muted-foreground"}>
                    {mayRetry && edition.status !== "failed" ? "Délai de rendu dépassé" : statusLabels[edition.status]}
                  </span>
                </div>
                {edition.replacement_reason && <p className="text-muted-foreground">Motif du remplacement · {edition.replacement_reason}</p>}
                {edition.error && <p className="text-destructive">{edition.error}</p>}
                <div className="flex flex-wrap gap-2">
                  {edition.status === "ready" && (
                    <Button size="sm" variant="outline" disabled={download.isPending} onClick={() => download.mutate(edition)}>
                      Télécharger le PDF archivé
                    </Button>
                  )}
                  {canIssue && edition.status === "ready" && (
                    <Button size="sm" variant="outline" aria-disabled={!canReplace || request.isPending} className="aria-disabled:opacity-50"
                      onClick={(event) => { if (canReplace && !request.isPending) open(event, { kind: "replace", edition }); }}>
                      {canReplace ? "Remplacer" : "Remplacée"}
                    </Button>
                  )}
                  {canIssue && mayRetry && (
                    <Button size="sm" variant="outline" disabled={request.isPending} onClick={() => request.mutate({ id: edition.id })}>Relancer</Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {!dialog && request.error && <p role="alert" className="text-xs text-destructive">{request.error.message}</p>}
      {download.error && <p role="alert" className="text-xs text-destructive">{download.error.message}</p>}
      <Dialog open={canIssue && dialog !== null} onOpenChange={(opened) => { if (!opened && !request.isPending) setDialog(null); }}>
        <DialogContent onCloseAutoFocus={(event) => {
          event.preventDefault();
          (initiator.current?.isConnected ? initiator.current : heading.current)?.focus();
        }}>
          {dialog && (
            <>
              <DialogHeader>
                <DialogTitle>{dialog.kind === "replace" ? "Remplacer l’édition archivée" : "Créer une édition archivée"}</DialogTitle>
                <DialogDescription>{dialog.kind === "replace"
                  ? `Le PDF ${dialog.edition.reference} restera disponible dans les archives.`
                  : poId !== undefined ? "Le PDF sera conservé avec la version du modèle et les données du bon de commande."
                    : "Le PDF sera conservé avec la version du modèle et les données de la facture."}</DialogDescription>
              </DialogHeader>
              <form onSubmit={submit} className="space-y-4">
                <Label className="grid gap-1.5">Modèle de document
                  <select value={templateId} disabled={request.isPending || noPublishedTemplate} onChange={(event) => setTemplateId(event.target.value)}
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <option value="">Par défaut : {defaultTemplate?.name ?? "dernier modèle publié"}</option>
                    {publishedTemplates?.map((template) => (
                      <option key={template.id} value={template.id}>{template.name}</option>
                    ))}
                  </select>
                </Label>
                <p className="text-xs text-muted-foreground">Le modèle par défaut s’applique aux prochaines pièces de ce type pour la société. Un autre choix ici ne concerne que cette édition.</p>
                {noPublishedTemplate && <p className="text-sm text-muted-foreground">{poId !== undefined
                  ? "Un modèle de bon de commande doit être publié dans les paramètres."
                  : "Un modèle de facture client doit être publié dans les paramètres."}</p>}
                {templates.isError && (
                  <div className="space-y-2">
                    <p role="alert" className="text-sm text-destructive">{templates.error.message}</p>
                    <Button type="button" size="sm" variant="outline" disabled={templates.isFetching} onClick={() => void templates.refetch()}>
                      Recharger les modèles
                    </Button>
                  </div>
                )}
                {dialog.kind === "replace" && (
                  <Label className="grid gap-1.5">Motif du remplacement
                    <Textarea required value={reason} disabled={request.isPending} onChange={(event) => setReason(event.target.value)} />
                  </Label>
                )}
                {request.error && <p role="alert" className="text-sm text-destructive">{request.error.message}</p>}
                <DialogFooter>
                  <Button type="button" variant="outline" disabled={request.isPending} onClick={() => setDialog(null)}>Annuler</Button>
                  <Button type="submit" disabled={request.isPending || noPublishedTemplate || (dialog.kind === "replace" && !reason.trim())}>
                    {dialog.kind === "replace" ? "Créer le remplacement" : "Générer le PDF archivé"}
                  </Button>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
