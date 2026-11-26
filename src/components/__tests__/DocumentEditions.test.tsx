import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { DocumentEditions, PurchaseOrderEditions } from "@/components/DocumentEditions";
import { DocumentTemplatesPanel } from "@/components/DocumentTemplatesPanel";

const api = vi.hoisted(() => ({
  get: vi.fn(), post: vi.fn(), download: vi.fn(),
  permissions: ["reports.templates"],
}));
vi.mock("@/api/client", () => ({
  isApiEnabled: () => true,
  apiGet: api.get,
  apiPost: api.post,
  apiDownloadFile: api.download,
}));
vi.mock("@/hooks/use-tenant", () => ({ useTenantId: () => ({ data: "tenant-a" }) }));
vi.mock("@/hooks/use-my-access", () => ({ useMyAccess: () => ({ data: { permissions: api.permissions } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const layout = { title: "Facture", intro: "", footer: "Merci", accent_color: "#245270", font_size: 10 };
const version = {
  id: "version-a", tenant_id: "tenant-a", template_id: "template-a", version_no: 1, layout,
  content_html: "<p>Merci</p>", sha256: "a".repeat(64), created_at: "2026-11-20T10:00:00Z",
  created_by: "user-a", reason: "Version initiale", published_at: null, published_by: null,
};
const template = {
  id: "template-a", tenant_id: "tenant-a", doc_type: "ar_invoice", name: "Facture standard",
  current_version_id: null, created_at: "2026-11-20T10:00:00Z", created_by: "user-a",
};
const failed = {
  id: "edition-b", tenant_id: "tenant-a", ar_invoice_id: "invoice-a", template_version_id: "version-a",
  context: {}, context_sha256: "d".repeat(64), reference: "FAC-1-002", status: "failed",
  storage_path: null, pdf_sha256: null, renderer: null, renderer_version: null, created_by: "user-a",
  created_at: "2026-11-20T11:00:00Z", started_at: "2026-11-20T11:00:01Z", finished_at: "2026-11-20T11:00:03Z",
  error: "Convertisseur indisponible", replaces_id: "edition-a", replacement_reason: "Nouveau pied de page",
};
const ready = {
  ...failed, id: "edition-a", reference: "FAC-1-001", status: "ready",
  storage_path: "tenant-a/issued/edition-a.pdf", pdf_sha256: "b".repeat(64), renderer: "gotenberg",
  renderer_version: "9.2", error: null, replaces_id: null, replacement_reason: null,
};

function renderWithQuery(component: ReactNode) {
  const client = new QueryClient();
  return render(<QueryClientProvider client={client}>{component}</QueryClientProvider>);
}

beforeEach(() => {
  vi.resetAllMocks();
  api.permissions = ["reports.templates"];
  api.get.mockImplementation((path: string) => {
    if (path === "/api/v1/document-templates") return Promise.resolve([{ ...template, versions: [version] }]);
    if (path === "/api/v1/document-editions?invoiceId=invoice-a") return Promise.resolve([failed, ready]);
    throw new Error(`GET inattendu ${path}`);
  });
});

it("requires reports.templates to open the template editor and publish a draft", () => {
  api.permissions = ["ar.invoice"];
  renderWithQuery(<DocumentTemplatesPanel />);
  expect(screen.queryByRole("button", { name: "Nouveau modèle" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Publier" })).not.toBeInTheDocument();
  expect(api.get).not.toHaveBeenCalled();
});

it("saves structured fields with a reason then publishes the saved version with a reason", async () => {
  api.post.mockImplementation((path: string) => {
    if (path === "/api/v1/document-templates") return Promise.resolve({ template, version });
    if (path === "/api/v1/document-templates/version-a/publish") {
      return Promise.resolve({ ...version, published_at: "2026-11-20T12:00:00Z", published_by: "user-a" });
    }
    throw new Error(`POST inattendu ${path}`);
  });
  renderWithQuery(<DocumentTemplatesPanel />);

  const openEditor = await screen.findByRole("button", { name: "Nouveau modèle" });
  fireEvent.click(openEditor);
  const editor = within(screen.getByRole("dialog", { name: "Nouveau modèle" }));
  fireEvent.change(editor.getByLabelText("Nom du modèle"), { target: { value: " Facture standard " } });
  fireEvent.change(editor.getByLabelText("Pied de page"), { target: { value: "Merci" } });
  fireEvent.change(editor.getByLabelText("Champ de la facture"), { target: { value: "customer.name" } });
  fireEvent.click(editor.getByRole("button", { name: "Insérer" }));
  expect(editor.getByLabelText("Introduction")).toHaveValue("{{customer.name}}");
  fireEvent.change(editor.getByLabelText("Couleur d’accent"), { target: { value: "#245270" } });
  const save = editor.getByRole("button", { name: "Enregistrer la version" });
  expect(save).toBeDisabled();
  fireEvent.change(editor.getByLabelText("Motif"), { target: { value: " Version initiale " } });
  fireEvent.click(save);
  await waitFor(() => expect(api.post).toHaveBeenCalledWith("/api/v1/document-templates", {
    name: "Facture standard", layout: { ...layout, intro: "{{customer.name}}" }, reason: "Version initiale",
  }));
  await waitFor(() => expect(openEditor).toHaveFocus());

  fireEvent.click(await screen.findByRole("button", { name: "Aperçu" }));
  const preview = screen.getByTitle("Aperçu de la version 1");
  expect(preview).toHaveAttribute("sandbox", "");
  expect(preview).toHaveAttribute("srcdoc", "<p>Merci</p>");
  fireEvent.click(screen.getByRole("button", { name: "Fermer la fenêtre" }));

  const openPublish = screen.getByRole("button", { name: "Publier" });
  fireEvent.click(openPublish);
  const publication = within(screen.getByRole("dialog", { name: "Publier la version 1" }));
  const publish = publication.getByRole("button", { name: "Publier la version" });
  expect(publish).toBeDisabled();
  fireEvent.change(publication.getByLabelText("Motif"), { target: { value: " Mise en service " } });
  fireEvent.click(publish);
  await waitFor(() => expect(api.post).toHaveBeenCalledWith("/api/v1/document-templates/version-a/publish", {
    reason: "Mise en service",
  }));
});

it("downloads the archived PDF and retries a failed edition only on explicit request", async () => {
  api.post.mockResolvedValue(ready);
  api.download.mockResolvedValue(undefined);
  renderWithQuery(<DocumentEditions invoiceId="invoice-a" canIssue />);
  expect(await screen.findByText("FAC-1-001")).toBeInTheDocument();
  expect(screen.getByText("Convertisseur indisponible")).toBeInTheDocument();
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Télécharger le PDF archivé" }));
  await waitFor(() => expect(api.download).toHaveBeenCalledWith("/api/v1/document-editions/edition-a/download", "FAC-1-001.pdf"));
  fireEvent.click(screen.getByRole("button", { name: "Relancer" }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith("/api/v1/document-editions/edition-b/retry", {}));
});

it("lets readers download but reserves requests and retries for the invoice permission", async () => {
  renderWithQuery(<DocumentEditions invoiceId="invoice-a" canIssue={false} />);
  expect(await screen.findByRole("button", { name: "Télécharger le PDF archivé" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Relancer" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Créer une édition" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Remplacer" })).not.toBeInTheDocument();
});

it("requires a reason and sends the archived edition id for an explicit replacement", async () => {
  api.get.mockImplementation((path: string) => {
    if (path.endsWith("?invoiceId=invoice-a")) return Promise.resolve([ready]);
    return Promise.resolve([{ ...template, current_version_id: version.id, versions: [version] }]);
  });
  api.post.mockResolvedValue(failed);
  renderWithQuery(<DocumentEditions invoiceId="invoice-a" canIssue />);
  fireEvent.click(await screen.findByRole("button", { name: "Remplacer" }));
  const replacement = within(screen.getByRole("dialog", { name: "Remplacer l’édition archivée" }));
  const replace = replacement.getByRole("button", { name: "Créer le remplacement" });
  expect(replace).toBeDisabled();
  fireEvent.change(replacement.getByLabelText("Motif du remplacement"), { target: { value: " Mise à jour " } });
  fireEvent.click(replace);
  await waitFor(() => expect(api.post).toHaveBeenCalledWith("/api/v1/document-editions", {
    invoice_id: "invoice-a", replace_id: "edition-a", reason: "Mise à jour",
  }));
});

it("explains when no model is published and prevents an edition request", async () => {
  api.get.mockResolvedValue([]);
  renderWithQuery(<DocumentEditions invoiceId="invoice-a" canIssue />);
  fireEvent.click(await screen.findByRole("button", { name: "Créer une édition" }));
  expect(await screen.findByText("Un modèle de facture client doit être publié dans les paramètres.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Générer le PDF archivé" })).toBeDisabled();
  expect(api.post).not.toHaveBeenCalled();
});

const poLayout = { ...layout, title: "Bon de commande", doc_type: "purchase_order", preset: "standard" };
const poTemplate = { ...template, id: "po-model", doc_type: "purchase_order", name: "PO standard", current_version_id: "po-version", versions: [{ ...version, id: "po-version", template_id: "po-model", layout: poLayout, published_at: "2026-11-20T12:00:00Z" }] };

it("switches model types, explicitly installs both PO defaults and previews their saved HTML safely", async () => {
  let installed = false;
  api.get.mockImplementation((path: string) => Promise.resolve(path.includes("purchase_order") ? installed ? [poTemplate] : [] : [{ ...template, versions: [version] }]));
  api.post.mockImplementation(() => { installed = true; return Promise.resolve([poTemplate]); });
  renderWithQuery(<DocumentTemplatesPanel />);
  fireEvent.click(screen.getByRole("radio", { name: "Bon de commande" }));
  const install = await screen.findByRole("button", { name: "Installer les modèles PO" });
  await waitFor(() => expect(api.get).toHaveBeenCalledWith("/api/v1/document-templates?docType=purchase_order"));
  expect(screen.queryByText("Facture standard")).not.toBeInTheDocument();
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(install);
  expect(await screen.findByText("PO standard")).toBeInTheDocument();
  expect(api.post).toHaveBeenCalledWith("/api/v1/document-templates/purchase-orders/defaults", {});
  const previewButton = screen.getByRole("button", { name: "Aperçu" });
  fireEvent.click(previewButton);
  expect(screen.getByTitle("Aperçu de la version 1")).toHaveAttribute("sandbox", "");
  fireEvent.click(screen.getByRole("button", { name: "Fermer la fenêtre" }));
  await waitFor(() => expect(previewButton).toHaveFocus());
});

it("saves the selected PO preset and supplier fields without sending invoice-only tokens", async () => {
  api.get.mockResolvedValue([]);
  api.post.mockResolvedValue({ template: poTemplate, version: poTemplate.versions[0] });
  renderWithQuery(<DocumentTemplatesPanel />);
  fireEvent.click(screen.getByRole("radio", { name: "Bon de commande" }));
  fireEvent.click(screen.getByRole("button", { name: "Nouveau modèle" }));
  const editor = within(screen.getByRole("dialog", { name: "Nouveau modèle" }));
  fireEvent.change(editor.getByLabelText("Nom du modèle"), { target: { value: "PO paysage" } });
  fireEvent.click(editor.getByRole("radio", { name: "Paysage · PO0004821" }));
  const fields = editor.getByLabelText("Champ du bon de commande");
  expect(within(fields).queryByRole("option", { name: "Date de facturation" })).not.toBeInTheDocument();
  expect(within(fields).queryByRole("option", { name: "Total TTC" })).not.toBeInTheDocument();
  expect(within(fields).getByRole("option", { name: "Total commande" })).toBeInTheDocument();
  fireEvent.change(fields, { target: { value: "supplier.name" } });
  fireEvent.click(editor.getByRole("button", { name: "Insérer" }));
  expect(editor.getByLabelText("Introduction")).toHaveValue("{{supplier.name}}");
  fireEvent.change(editor.getByLabelText("Motif"), { target: { value: "Présentation paysage" } });
  fireEvent.click(editor.getByRole("button", { name: "Enregistrer la version" }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith("/api/v1/document-templates", {
    name: "PO paysage", reason: "Présentation paysage",
    layout: { title: "Bon de commande", intro: "{{supplier.name}}", footer: "", accent_color: "#17324d", font_size: 10, doc_type: "purchase_order", preset: "reference-PO0004821" },
  }));
});

it("creates a PO edition using its published model and keeps PO language in the dialog", async () => {
  api.get.mockImplementation((path: string) => Promise.resolve(path.includes("document-templates") ? [poTemplate] : []));
  api.post.mockResolvedValue({ ...ready, po_id: "po-a", ar_invoice_id: null });
  renderWithQuery(<DocumentEditions poId="po-a" canIssue />);
  const create = await screen.findByRole("button", { name: "Créer une édition" });
  expect(screen.getByText("Aucun PDF archivé pour ce bon de commande.")).toBeInTheDocument();
  fireEvent.click(create);
  const dialog = within(screen.getByRole("dialog", { name: "Créer une édition archivée" }));
  expect(dialog.getByText("Le PDF sera conservé avec la version du modèle et les données du bon de commande.")).toBeInTheDocument();
  await dialog.findByRole("option", { name: "PO standard" });
  fireEvent.change(dialog.getByLabelText("Modèle de document"), { target: { value: "po-model" } });
  fireEvent.click(dialog.getByRole("button", { name: "Générer le PDF archivé" }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith("/api/v1/document-editions", { po_id: "po-a", template_id: "po-model" }));
  expect(api.get).toHaveBeenCalledWith("/api/v1/document-editions?poId=po-a");
  expect(api.get).toHaveBeenCalledWith("/api/v1/document-templates?docType=purchase_order");
  await waitFor(() => expect(create).toHaveFocus());
});

it.each(["draft", "rejected", "cancelled", "submitted", "pending_approval"])("does not load PO archives for a %s order", (status) => {
  renderWithQuery(<PurchaseOrderEditions poId="po-a" status={status} canIssue />);
  expect(screen.queryByText("Éditions archivées")).not.toBeInTheDocument();
  expect(api.get).not.toHaveBeenCalled();
});

it.each(["approved", "ordered", "partially_received", "received", "closed"])("loads PO archives for an authorized %s order", async (status) => {
  api.get.mockResolvedValue([]);
  renderWithQuery(<PurchaseOrderEditions poId="po-a" status={status} canIssue />);
  expect(await screen.findByRole("button", { name: "Créer une édition" })).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith("/api/v1/document-editions?poId=po-a");
});

it("does not read PO archives without procurement.order", () => {
  renderWithQuery(<PurchaseOrderEditions poId="po-a" status="approved" canIssue={false} />);
  expect(screen.queryByText("Éditions archivées")).not.toBeInTheDocument();
  expect(api.get).not.toHaveBeenCalled();
});
