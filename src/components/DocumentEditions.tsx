import { useId, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "react-i18next";
import { errorText } from "@/i18n/errors";
import { useLanguageContext } from "@/hooks/use-language";
import {
  canRetryDocumentEdition, downloadDocumentEdition, useDocumentEditions, useDocumentTemplates, useRequestDocumentEdition,
  type IssuedDocument,
} from "@/hooks/use-document-editions";

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
  const [language, setLanguage] = useState("");
  const { t } = useTranslation(["documents", "common"]);
  const languageContext = useLanguageContext();
  const headingId = useId();
  const languageId = useId();
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
  // Une langue explicite ne propose que les modèles de cette langue (les bons de commande restent en français).
  const publishedTemplates = templates.data?.filter((template) => template.current_version_id
    && (!language || (template.language ?? "fr") === language));
  const defaultTemplate = publishedTemplates?.find((template) => template.is_default);
  const noPublishedTemplate = publishedTemplates?.length === 0;

  function open(event: MouseEvent<HTMLButtonElement>, next: EditionDialog) {
    initiator.current = event.currentTarget;
    request.reset();
    setTemplateId("");
    setReason("");
    setLanguage("");
    setDialog(next);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canIssue || !dialog || request.isPending || noPublishedTemplate || (dialog.kind === "replace" && !reason.trim())) return;
    request.mutate({
      ...(poId !== undefined ? { po_id: poId } : { invoice_id: invoiceId }),
      ...(templateId && { template_id: templateId }),
      ...(dialog.kind === "replace" && { replace_id: dialog.edition.id, reason: reason.trim() }),
      ...(language && { language }),
    }, { onSuccess: () => setDialog(null) });
  }

  return (
    <section className="space-y-3 rounded-md border bg-card p-3" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} ref={heading} tabIndex={-1} className="text-sm font-semibold">{t("editions.title")}</h3>
        {canIssue && editions.data?.length === 0 && (
          <Button size="sm" variant="outline" disabled={request.isPending}
            onClick={(event) => open(event, { kind: "create" })}>{t("editions.create")}</Button>
        )}
      </div>
      {editions.isPending && <p className="text-xs text-muted-foreground">{t("editions.loading")}</p>}
      {editions.isError && (
        <div className="space-y-2">
          <p role="alert" className="text-xs text-destructive">{errorText(editions.error)}</p>
          <Button size="sm" variant="outline" disabled={editions.isFetching} onClick={() => void editions.refetch()}>{t("common:actions.retry")}</Button>
        </div>
      )}
      {editions.data?.length === 0 && <p className="text-xs text-muted-foreground">{poId !== undefined
        ? t("editions.empty_po") : t("editions.empty_invoice")}</p>}
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
                    {mayRetry && edition.status !== "failed" ? t("editions.late") : t(`editions.status.${edition.status}`)}
                  </span>
                </div>
                {poId === undefined && <p className="text-muted-foreground" data-testid="edition-language">{edition.language
                  ? t("editions.language_value", { language: t(`common:language.${edition.language}`), locale: edition.locale })
                  : t("editions.language_legacy")}</p>}
                {edition.replacement_reason && <p className="text-muted-foreground">{t("editions.replacement_reason", { reason: edition.replacement_reason })}</p>}
                {edition.error && <p className="text-destructive">{edition.error}</p>}
                <div className="flex flex-wrap gap-2">
                  {edition.status === "ready" && (
                    <Button size="sm" variant="outline" disabled={download.isPending} onClick={() => download.mutate(edition)}>
                      {t("editions.download")}
                    </Button>
                  )}
                  {canIssue && edition.status === "ready" && (
                    <Button size="sm" variant="outline" aria-disabled={!canReplace || request.isPending} className="aria-disabled:opacity-50"
                      onClick={(event) => { if (canReplace && !request.isPending) open(event, { kind: "replace", edition }); }}>
                      {canReplace ? t("editions.replace") : t("editions.replaced")}
                    </Button>
                  )}
                  {canIssue && mayRetry && (
                    <Button size="sm" variant="outline" disabled={request.isPending} onClick={() => request.mutate({ id: edition.id })}>{t("editions.retry")}</Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {!dialog && request.error && <p role="alert" className="text-xs text-destructive">{errorText(request.error)}</p>}
      {download.error && <p role="alert" className="text-xs text-destructive">{errorText(download.error)}</p>}
      <Dialog open={canIssue && dialog !== null} onOpenChange={(opened) => { if (!opened && !request.isPending) setDialog(null); }}>
        <DialogContent onCloseAutoFocus={(event) => {
          event.preventDefault();
          (initiator.current?.isConnected ? initiator.current : heading.current)?.focus();
        }}>
          {dialog && (
            <>
              <DialogHeader>
                <DialogTitle>{dialog.kind === "replace" ? t("editions.dialog_replace") : t("editions.dialog_create")}</DialogTitle>
                <DialogDescription>{dialog.kind === "replace"
                  ? t("editions.dialog_replace_hint", { reference: dialog.edition.reference })
                  : poId !== undefined ? t("editions.dialog_create_po_hint")
                    : t("editions.dialog_create_invoice_hint")}</DialogDescription>
              </DialogHeader>
              <form onSubmit={submit} className="space-y-4">
                {poId === undefined && (
                  <div className="grid gap-1.5">
                    <Label htmlFor={languageId}>{t("editions.language")}</Label>
                    <select id={languageId} value={language} disabled={request.isPending} data-testid="edition-language-select"
                      onChange={(event) => { setLanguage(event.target.value); setTemplateId(""); }}
                      className="h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <option value="">{dialog.kind === "replace" ? t("editions.language_kept") : t("editions.language_customer")}</option>
                      {(languageContext.data?.languages ?? []).filter((l) => languageContext.data?.allowed_languages.includes(l.code)).map((l) => (
                        <option key={l.code} value={l.code} lang={l.code}>{l.label}</option>
                      ))}
                    </select>
                    <p className="text-xs text-muted-foreground">{t("editions.language_frozen_hint")}</p>
                  </div>
                )}
                <Label className="grid gap-1.5">{t("editions.template")}
                  <select value={templateId} disabled={request.isPending || noPublishedTemplate} onChange={(event) => setTemplateId(event.target.value)}
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <option value="">{t("editions.template_default", { name: defaultTemplate?.name ?? t("editions.template_latest") })}</option>
                    {publishedTemplates?.map((template) => (
                      <option key={template.id} value={template.id}>{template.name}</option>
                    ))}
                  </select>
                </Label>
                <p className="text-xs text-muted-foreground">{t("editions.template_hint")}</p>
                {noPublishedTemplate && <p className="text-sm text-muted-foreground">{poId !== undefined
                  ? t("editions.no_template_po")
                  : language ? t("editions.no_template_language") : t("editions.no_template_invoice")}</p>}
                {templates.isError && (
                  <div className="space-y-2">
                    <p role="alert" className="text-sm text-destructive">{errorText(templates.error)}</p>
                    <Button type="button" size="sm" variant="outline" disabled={templates.isFetching} onClick={() => void templates.refetch()}>
                      {t("editions.reload_templates")}
                    </Button>
                  </div>
                )}
                {dialog.kind === "replace" && (
                  <Label className="grid gap-1.5">{t("editions.reason")}
                    <Textarea required value={reason} disabled={request.isPending} onChange={(event) => setReason(event.target.value)} />
                  </Label>
                )}
                {request.error && <p role="alert" className="text-sm text-destructive">{errorText(request.error)}</p>}
                <DialogFooter>
                  <Button type="button" variant="outline" disabled={request.isPending} onClick={() => setDialog(null)}>{t("editions.cancel")}</Button>
                  <Button type="submit" disabled={request.isPending || noPublishedTemplate || (dialog.kind === "replace" && !reason.trim())}>
                    {dialog.kind === "replace" ? t("editions.submit_replace") : t("editions.submit_create")}
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
