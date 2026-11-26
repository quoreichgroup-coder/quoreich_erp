import { useRef, useState, type FormEvent, type MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  useDocumentTemplates, useInstallPurchaseOrderTemplates, usePublishDocumentTemplate, useSaveDocumentTemplate, useSetDefaultDocumentTemplate,
  type DocumentLayout, type DocumentTemplateVersion, type DocumentType, type PurchaseOrderPreset,
} from "@/hooks/use-document-editions";
import { useMyAccess } from "@/hooks/use-my-access";

const defaultLayout: DocumentLayout = { title: "Facture", intro: "", footer: "", accent_color: "#17324d", font_size: 10 };
const invoiceFieldGroups = [
  { label: "Société", fields: [
    ["company.name", "Nom"], ["company.legal_name", "Raison sociale"], ["company.address", "Adresse"],
    ["company.phone", "Téléphone"], ["company.email", "Courriel"], ["company.rccm", "RCCM"],
    ["company.tax_id", "Identifiant fiscal"], ["company.tax_regime", "Régime fiscal"],
    ["company.tax_office", "Centre des impôts"], ["company.bank_details", "Coordonnées bancaires"],
  ] },
  { label: "Client", fields: [
    ["customer.name", "Nom"], ["customer.address", "Adresse"], ["customer.phone", "Téléphone"],
    ["customer.email", "Courriel"], ["customer.tax_id", "Identifiant fiscal"],
  ] },
  { label: "Facture", fields: [
    ["document.number", "Numéro de facture"], ["document.invoice_date", "Date de facturation"],
    ["document.due_date", "Échéance"], ["document.currency", "Devise"], ["document.subtotal", "Total HT"],
    ["document.tax_amount", "Total des taxes"], ["document.total", "Total TTC"], ["document.reference", "Référence de l’édition"],
  ] },
];
const purchaseOrderFieldGroups = [
  invoiceFieldGroups[0],
  { label: "Fournisseur", fields: [
    ["supplier.name", "Nom"], ["supplier.code", "Code fournisseur"], ["supplier.address", "Adresse"],
    ["supplier.phone", "Téléphone"], ["supplier.email", "Courriel"], ["supplier.tax_id", "Identifiant fiscal"],
    ["supplier.contact", "Contact fournisseur"],
  ] },
  { label: "Bon de commande", fields: [
    ["document.number", "Numéro de commande"], ["document.order_date", "Date de commande"],
    ["document.expected_date", "Livraison prévue"], ["document.currency", "Devise"], ["document.subtotal", "Sous-total"],
    ["document.tax_amount", "Taxes"], ["document.total", "Total commande"], ["document.reference", "Référence de l’édition"],
    ["document.incoterm", "Incoterm"], ["document.payment_terms", "Conditions de paiement"],
    ["document.description", "Description"], ["document.shipping_method", "Mode d’expédition"],
    ["document.delivery_address", "Adresse de livraison"], ["document.buyer_name", "Acheteur"],
    ["document.buyer_phone", "Téléphone de l’acheteur"], ["document.buyer_email", "Courriel de l’acheteur"],
    ["document.invoice_email", "Courriel de facturation"], ["document.notes", "Notes de la commande"],
    ["document.footer", "Pied de la commande"],
  ] },
];
type TextField = "title" | "intro" | "footer";
const selectClass = "h-10 min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type PanelDialog =
  | { kind: "edit"; id?: string; name: string; layout: DocumentLayout }
  | { kind: "preview"; version: DocumentTemplateVersion }
  | { kind: "publish"; version: DocumentTemplateVersion };

export function DocumentTemplatesPanel() {
  const { data: access } = useMyAccess();
  const allowed = access?.permissions.includes("reports.templates") ?? false;
  const [docType, setDocType] = useState<DocumentType>("ar_invoice");
  const templates = useDocumentTemplates(allowed, docType);
  const save = useSaveDocumentTemplate();
  const publish = usePublishDocumentTemplate();
  const setDefault = useSetDefaultDocumentTemplate();
  const install = useInstallPurchaseOrderTemplates();
  const [dialog, setDialog] = useState<PanelDialog | null>(null);
  const [reason, setReason] = useState("");
  const [token, setToken] = useState("");
  const [targetField, setTargetField] = useState<TextField>("intro");
  const initiator = useRef<HTMLButtonElement>(null);
  const newButton = useRef<HTMLButtonElement>(null);
  if (!allowed) return null;

  const isPurchaseOrder = docType === "purchase_order";
  const fieldGroups = isPurchaseOrder ? purchaseOrderFieldGroups : invoiceFieldGroups;
  const newLayout: DocumentLayout = isPurchaseOrder
    ? { ...defaultLayout, title: "Bon de commande", doc_type: "purchase_order", preset: "standard" } : defaultLayout;
  const pending = save.isPending || publish.isPending || setDefault.isPending;
  const error = dialog?.kind === "edit" ? save.error : publish.error;
  const validLayout = dialog?.kind === "edit" && Boolean(dialog.name.trim())
    && Number.isInteger(dialog.layout.font_size) && dialog.layout.font_size >= 8 && dialog.layout.font_size <= 14;

  function open(event: MouseEvent<HTMLButtonElement>, next: PanelDialog) {
    initiator.current = event.currentTarget;
    save.reset();
    publish.reset();
    setReason("");
    setToken("");
    setTargetField("intro");
    setDialog(next);
  }

  function setLayout<K extends keyof DocumentLayout>(field: K, value: DocumentLayout[K]) {
    setDialog((current) => current?.kind === "edit"
      ? { ...current, layout: { ...current.layout, [field]: value } } : current);
  }

  function insertField() {
    if (dialog?.kind !== "edit" || !token) return;
    const previous = dialog.layout[targetField];
    setLayout(targetField, `${previous}${previous && !/\s$/.test(previous) ? " " : ""}{{${token}}}`);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog || pending || !reason.trim()) return;
    const onSuccess = () => setDialog(null);
    if (dialog.kind === "edit" && validLayout) {
      save.mutate({ ...(dialog.id && { id: dialog.id }), name: dialog.name.trim(), layout: dialog.layout, reason: reason.trim() }, { onSuccess });
    } else if (dialog.kind === "publish") {
      publish.mutate({ versionId: dialog.version.id, reason: reason.trim() }, { onSuccess });
    }
  }

  return (
    <section className="flex max-w-5xl flex-col gap-4" aria-label="Modèles de documents">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Modèles de documents</h2>
        <Button ref={newButton} size="sm" onClick={(event) => open(event, { kind: "edit", name: "", layout: newLayout })}>
          Nouveau modèle
        </Button>
      </div>
      <ToggleGroup type="single" value={docType} variant="outline" aria-label="Type de document" className="justify-start"
        disabled={install.isPending} onValueChange={(value) => { if (value) { setDocType(value as DocumentType); install.reset(); } }}>
        <ToggleGroupItem value="ar_invoice">Facture client</ToggleGroupItem>
        <ToggleGroupItem value="purchase_order">Bon de commande</ToggleGroupItem>
      </ToggleGroup>
      {isPurchaseOrder && (
        <div className="flex flex-col items-start gap-2">
          <Button size="sm" variant="outline" disabled={install.isPending} onClick={() => install.mutate()}>
            {install.isPending ? "Installation des modèles PO…" : "Installer les modèles PO"}
          </Button>
          <p className="text-xs text-muted-foreground">Ajoute les modèles standard portrait et paysage PO0004821 à cette société. Les modèles déjà installés sont conservés.</p>
          {install.isSuccess && <p role="status" className="text-sm text-muted-foreground">Les modèles PO sont disponibles.</p>}
          {install.error && <p role="alert" className="text-sm text-destructive">{install.error.message}</p>}
        </div>
      )}
      {templates.isPending && <p className="text-sm text-muted-foreground">Chargement des modèles…</p>}
      {templates.isError && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-destructive">{templates.error.message}</p>
          <Button size="sm" variant="outline" disabled={templates.isFetching} onClick={() => void templates.refetch()}>Réessayer</Button>
        </div>
      )}
      {templates.data?.length === 0 && <p className="text-sm text-muted-foreground">{isPurchaseOrder ? "Aucun modèle de bon de commande." : "Aucun modèle de facture client."}</p>}
      {templates.data?.map((template) => {
        const versions = [...template.versions].sort((a, b) => b.version_no - a.version_no);
        return (
          <article key={template.id} className="rounded-md border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">{template.name}</h3>
              <div className="flex flex-wrap items-center gap-2">
                {template.is_default
                  ? <span className="text-xs font-medium text-primary">Modèle par défaut</span>
                  : template.current_version_id && <Button size="sm" variant="outline" disabled={setDefault.isPending}
                    onClick={() => setDefault.mutate({ templateId: template.id })}>Définir par défaut</Button>}
                <Button size="sm" variant="outline" onClick={(event) => open(event, {
                  kind: "edit", id: template.id, name: template.name, layout: versions[0]?.layout ?? newLayout,
                })}>Nouvelle version</Button>
              </div>
            </div>
            <ul className="mt-2 divide-y">
              {versions.map((version) => (
                <li key={version.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <div>
                    <p className="font-medium">Version {version.version_no}{version.id === template.current_version_id && " · En service"}</p>
                    <p className="text-xs text-muted-foreground">{version.reason}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={(event) => open(event, { kind: "preview", version })}>Aperçu</Button>
                    <Button size="sm" variant="outline" aria-disabled={Boolean(version.published_at)}
                      className="aria-disabled:opacity-50"
                      onClick={(event) => { if (!version.published_at) open(event, { kind: "publish", version }); }}>
                      {version.published_at ? "Publiée" : "Publier"}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </article>
        );
      })}
      {setDefault.error && <p role="alert" className="text-sm text-destructive">{setDefault.error.message}</p>}
      {setDefault.isSuccess && <p role="status" className="text-sm text-muted-foreground">Le modèle par défaut s’appliquera aux prochaines {isPurchaseOrder ? "commandes d’achat" : "factures client"} de cette société.</p>}
      <Dialog open={dialog !== null} onOpenChange={(opened) => { if (!opened && !pending) setDialog(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl" onCloseAutoFocus={(event) => {
          event.preventDefault();
          (initiator.current?.isConnected ? initiator.current : newButton.current)?.focus();
        }}>
          {dialog?.kind === "preview" ? (
            <>
              <DialogHeader>
                <DialogTitle>Aperçu enregistré</DialogTitle>
                <DialogDescription>Présentation de la version {dialog.version.version_no}.</DialogDescription>
              </DialogHeader>
              <iframe title={`Aperçu de la version ${dialog.version.version_no}`} sandbox="" referrerPolicy="no-referrer" srcDoc={dialog.version.content_html}
                className="h-[60vh] w-full rounded-md border bg-white" />
            </>
          ) : dialog && (
            <>
              <DialogHeader>
                <DialogTitle>{dialog.kind === "publish" ? `Publier la version ${dialog.version.version_no}`
                  : dialog.id ? "Nouvelle version" : "Nouveau modèle"}</DialogTitle>
                <DialogDescription>{dialog.kind === "publish"
                  ? "Cette version sera utilisée pour les prochaines éditions qui sélectionnent ce modèle."
                  : isPurchaseOrder ? "Chaque enregistrement crée une version de la présentation du bon de commande."
                    : "Chaque enregistrement crée une version de la présentation de facture client."}</DialogDescription>
              </DialogHeader>
              <form onSubmit={submit} className="flex flex-col gap-4">
                {dialog.kind === "edit" && (
                  <fieldset disabled={pending} className="grid gap-3 sm:grid-cols-2">
                    {isPurchaseOrder && (
                      <div className="flex flex-col gap-1.5 sm:col-span-2">
                        <Label>Présentation du bon de commande</Label>
                        <ToggleGroup type="single" variant="outline" value={dialog.layout.preset ?? "standard"} aria-label="Présentation du bon de commande"
                          className="justify-start" disabled={pending} onValueChange={(value) => { if (value) setLayout("preset", value as PurchaseOrderPreset); }}>
                          <ToggleGroupItem value="standard">Standard · Portrait</ToggleGroupItem>
                          <ToggleGroupItem value="reference-PO0004821">Paysage · PO0004821</ToggleGroupItem>
                        </ToggleGroup>
                      </div>
                    )}
                    <Label className="grid gap-1.5">Nom du modèle
                      <Input required value={dialog.name} onChange={(event) => setDialog({ ...dialog, name: event.target.value })} />
                    </Label>
                    <Label className="grid gap-1.5">Titre
                      <Input value={dialog.layout.title} onChange={(event) => setLayout("title", event.target.value)} />
                    </Label>
                    <Label className="grid gap-1.5">Introduction
                      <Textarea value={dialog.layout.intro} onChange={(event) => setLayout("intro", event.target.value)} />
                    </Label>
                    <Label className="grid gap-1.5">Pied de page
                      <Textarea value={dialog.layout.footer} onChange={(event) => setLayout("footer", event.target.value)} />
                    </Label>
                    <Label className="grid gap-1.5">Couleur d’accent
                      <Input type="color" value={dialog.layout.accent_color} onChange={(event) => setLayout("accent_color", event.target.value)} />
                    </Label>
                    <Label className="grid gap-1.5">Taille du texte en points
                      <Input type="number" min={8} max={14} step={1} required value={dialog.layout.font_size || ""}
                        onChange={(event) => setLayout("font_size", Number(event.target.value))} />
                    </Label>
                    <div className="grid items-end gap-2 sm:col-span-2 sm:grid-cols-[1fr_1fr_auto]">
                      <Label className="grid gap-1.5">{isPurchaseOrder ? "Champ du bon de commande" : "Champ de la facture"}
                        <select value={token} onChange={(event) => setToken(event.target.value)} className={selectClass}>
                          <option value="">Choisir un champ</option>
                          {fieldGroups.map((group) => (
                            <optgroup key={group.label} label={group.label}>
                              {group.fields.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                            </optgroup>
                          ))}
                        </select>
                      </Label>
                      <Label className="grid gap-1.5">Insérer dans
                        <select value={targetField} onChange={(event) => setTargetField(event.target.value as TextField)} className={selectClass}>
                          <option value="title">Titre</option>
                          <option value="intro">Introduction</option>
                          <option value="footer">Pied de page</option>
                        </select>
                      </Label>
                      <Button type="button" variant="outline" disabled={!token} onClick={insertField}>Insérer</Button>
                    </div>
                  </fieldset>
                )}
                <Label className="grid gap-1.5">Motif
                  <Textarea required value={reason} disabled={pending} onChange={(event) => setReason(event.target.value)} />
                </Label>
                {error && <p role="alert" className="text-sm text-destructive">{error.message}</p>}
                <DialogFooter>
                  <Button type="button" variant="outline" disabled={pending} onClick={() => setDialog(null)}>Annuler</Button>
                  <Button type="submit" disabled={pending || !reason.trim() || (dialog.kind === "edit" && !validLayout)}>
                    {dialog.kind === "publish" ? "Publier la version" : "Enregistrer la version"}
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
