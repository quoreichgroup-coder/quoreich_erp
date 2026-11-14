import { useMemo, useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Search, Plus, Trash2, Download, FileDown, Upload, X } from "lucide-react";
import { useCrmContacts, useUpsertContact, useDeleteContact, useBulkUpdateContacts, useBulkDeleteContacts, useMyCrmRoles, type CrmContact } from "@/hooks/use-crm-data";
import { actionTooltip } from "@/lib/crm-roles";
import { exportToCSV } from "@/lib/csv-export";
import { exportToPDF } from "@/lib/pdf-export";
import CrmContactsImportDialog from "@/components/CrmContactsImportDialog";

const PAGE_SIZE = 15;

export default function CrmContacts() {
  const perms = useMyCrmRoles();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<CrmContact> | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: contacts = [], isLoading } = useCrmContacts(search);
  const upsert = useUpsertContact();
  const del = useDeleteContact();
  const bulkUpdate = useBulkUpdateContacts();
  const bulkDelete = useBulkDeleteContacts();

  const filtered = useMemo(
    () => contacts.filter((c) => statusFilter === "all" ? true : c.status === statusFilter),
    [contacts, statusFilter],
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const allPageSelected = pageRows.length > 0 && pageRows.every((contact) => selected.has(contact.id));

  function selectPage(checked: boolean) {
    setSelected((previous) => {
      const next = new Set(previous);
      pageRows.forEach(({ id }) => checked ? next.add(id) : next.delete(id));
      return next;
    });
  }

  function handleSave() {
    if (!editing?.full_name?.trim()) return;
    upsert.mutate(editing as CrmContact, {
      onSuccess: () => { setOpen(false); setEditing(null); },
    });
  }

  function handleExportCsv() {
    if (!perms.canExport) return;
    exportToCSV(
      filtered.map((c) => ({
        name: c.full_name, company: c.company ?? "", email: c.email ?? "",
        phone: c.phone ?? "", status: c.status, source: c.source ?? "",
      })),
      [
        { key: "name", header: "Nom" }, { key: "company", header: "Société" },
        { key: "email", header: "Email" }, { key: "phone", header: "Téléphone" },
        { key: "status", header: "Statut" }, { key: "source", header: "Source" },
      ],
      `crm-contacts-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  }

  function handleExportPdf() {
    if (!perms.canExport) return;
    exportToPDF({
      filename: `crm-contacts-${new Date().toISOString().slice(0, 10)}.pdf`,
      title: "Contacts CRM",
      subtitle: `${filtered.length} contact(s) · filtre: ${statusFilter}${search ? ` · recherche: ${search}` : ""}`,
      columns: [
        { key: "full_name", header: "Nom" }, { key: "company", header: "Société" },
        { key: "email", header: "Email" }, { key: "phone", header: "Téléphone" },
        { key: "status", header: "Statut" },
      ],
      rows: filtered as unknown as Record<string, unknown>[],
    });
  }

  return (
    <PageShell>
      <div className="space-y-3">
        <Breadcrumb items={[{ label: "CRM", href: "/crm" }, { label: "Contacts" }]} />
        <GuidanceBanner
          title="Contacts CRM"
          description="Recherchez, filtrez et gérez votre base de contacts. Actions soumises à la matrice RBAC CRM."
        />

        <Card>
          <CardContent className="p-3 space-y-3">
            <div className="flex flex-col md:flex-row gap-2 md:items-center">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  placeholder="Rechercher nom, email, société, téléphone…"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); setSelected(new Set()); }}
                  className="pl-7 h-8 text-xs"
                />
              </div>
              <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); setSelected(new Set()); }}>
                <SelectTrigger className="w-40 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les statuts</SelectItem>
                  <SelectItem value="active">Actifs</SelectItem>
                  <SelectItem value="inactive">Inactifs</SelectItem>
                  <SelectItem value="archived">Archivés</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="sm" variant="outline" className="h-8 text-xs"
                disabled={!perms.canExport}
                title={actionTooltip(perms, "export", "Exporter CSV")}
                onClick={handleExportCsv}
              >
                <Download className="w-3.5 h-3.5 mr-1" /> CSV
              </Button>
              <Button
                size="sm" variant="outline" className="h-8 text-xs"
                disabled={!perms.canExport}
                title={actionTooltip(perms, "export", "Exporter PDF")}
                onClick={handleExportPdf}
              >
                <FileDown className="w-3.5 h-3.5 mr-1" /> PDF
              </Button>
              <Button
                size="sm" variant="outline" className="h-8 text-xs"
                disabled={!perms.canCreate}
                title={actionTooltip(perms, "create", "Importer CSV")}
                onClick={() => setImportOpen(true)}
              >
                <Upload className="w-3.5 h-3.5 mr-1" /> Importer
              </Button>
              <Button
                size="sm" className="h-8 text-xs"
                disabled={!perms.canCreate}
                title={actionTooltip(perms, "create", "Nouveau contact")}
                onClick={() => { setEditing({ status: "active", tags: [] }); setOpen(true); }}
              >
                <Plus className="w-3.5 h-3.5 mr-1" /> Nouveau
              </Button>
            </div>

            <div className="overflow-x-auto rounded border">
              <Table className="min-w-[640px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-9">
                      <Checkbox checked={allPageSelected} onCheckedChange={(checked) => selectPage(checked === true)} aria-label="Sélectionner la page" />
                    </TableHead>
                    <TableHead className="text-[11px]">Nom</TableHead>
                    <TableHead className="text-[11px]">Société</TableHead>
                    <TableHead className="text-[11px]">Email</TableHead>
                    <TableHead className="text-[11px]">Téléphone</TableHead>
                    <TableHead className="text-[11px]">Statut</TableHead>
                    <TableHead className="text-[11px] w-24"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-xs py-6 text-muted-foreground">Chargement…</TableCell></TableRow>
                  ) : pageRows.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-xs py-6 text-muted-foreground">Aucun contact.</TableCell></TableRow>
                  ) : pageRows.map((c) => (
                    <TableRow key={c.id} className="text-xs cursor-pointer" onClick={() => { if (perms.canEdit) { setEditing(c); setOpen(true); } }}>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={selected.has(c.id)} onCheckedChange={(checked) => setSelected((previous) => { const next = new Set(previous); if (checked) next.add(c.id); else next.delete(c.id); return next; })} aria-label={`Sélectionner ${c.full_name}`} />
                      </TableCell>
                      <TableCell className="font-medium">{c.full_name}{c.position ? <span className="text-muted-foreground"> · {c.position}</span> : null}</TableCell>
                      <TableCell>{c.company ?? "—"}</TableCell>
                      <TableCell>{c.email ?? "—"}</TableCell>
                      <TableCell>{c.phone ?? "—"}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{c.status}</Badge></TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Button
                          size="icon" variant="ghost" className="h-7 w-7"
                          disabled={!perms.canDelete}
                          title={actionTooltip(perms, "delete", "Supprimer")}
                          onClick={() => { if (confirm("Supprimer ce contact ?")) del.mutate(c.id); }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {selected.size > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded border border-primary p-2 text-xs">
                <Badge variant="default" className="text-[11px]">{selected.size} sélectionné(s)</Badge>
                <Select onValueChange={(status) => bulkUpdate.mutate({ ids: [...selected], patch: { status } }, { onSuccess: () => setSelected(new Set()) })}>
                  <SelectTrigger className="h-7 w-44 text-[11px]" disabled={!perms.canEdit || bulkUpdate.isPending} title={actionTooltip(perms, "edit", "Changer le statut")}><SelectValue placeholder="Changer le statut…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Actif</SelectItem><SelectItem value="inactive">Inactif</SelectItem><SelectItem value="archived">Archivé</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={!perms.canDelete || bulkDelete.isPending} title={actionTooltip(perms, "delete", "Supprimer la sélection")} onClick={() => { if (confirm(`Supprimer ${selected.size} contact(s) ?`)) bulkDelete.mutate([...selected], { onSuccess: () => setSelected(new Set()) }); }}>
                  <Trash2 className="mr-1 h-3 w-3" /> Supprimer
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setSelected(new Set())}><X className="mr-1 h-3 w-3" /> Effacer
                </Button>
              </div>
            )}

            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{filtered.length} contact(s) · page {page} / {totalPages}</span>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={page <= 1} onClick={() => { setPage((p) => p - 1); setSelected(new Set()); }}>Préc.</Button>
                <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={page >= totalPages} onClick={() => { setPage((p) => p + 1); setSelected(new Set()); }}>Suiv.</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-lg max-h-[90dvh] overflow-y-auto p-4 sm:p-6">
          <DialogHeader><DialogTitle className="text-sm">{editing?.id ? "Modifier le contact" : "Nouveau contact"}</DialogTitle></DialogHeader>
          <div className="space-y-2 text-xs">
            <Field label="Nom complet *"><Input value={editing?.full_name ?? ""} onChange={(e) => setEditing((p) => ({ ...p, full_name: e.target.value }))} className="h-8 text-xs" /></Field>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Field label="Email"><Input value={editing?.email ?? ""} onChange={(e) => setEditing((p) => ({ ...p, email: e.target.value }))} className="h-8 text-xs" /></Field>
              <Field label="Téléphone"><Input value={editing?.phone ?? ""} onChange={(e) => setEditing((p) => ({ ...p, phone: e.target.value }))} className="h-8 text-xs" /></Field>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Field label="Société"><Input value={editing?.company ?? ""} onChange={(e) => setEditing((p) => ({ ...p, company: e.target.value }))} className="h-8 text-xs" /></Field>
              <Field label="Fonction"><Input value={editing?.position ?? ""} onChange={(e) => setEditing((p) => ({ ...p, position: e.target.value }))} className="h-8 text-xs" /></Field>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Field label="Statut">
                <Select value={editing?.status ?? "active"} onValueChange={(v) => setEditing((p) => ({ ...p, status: v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Actif</SelectItem>
                    <SelectItem value="inactive">Inactif</SelectItem>
                    <SelectItem value="archived">Archivé</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Source"><Input value={editing?.source ?? ""} onChange={(e) => setEditing((p) => ({ ...p, source: e.target.value }))} className="h-8 text-xs" /></Field>
            </div>
            <Field label="Notes"><Textarea value={editing?.notes ?? ""} onChange={(e) => setEditing((p) => ({ ...p, notes: e.target.value }))} className="text-xs" rows={3} /></Field>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Annuler</Button>
            <Button size="sm" onClick={handleSave} disabled={upsert.isPending || !editing?.full_name?.trim() || (editing.id ? !perms.canEdit : !perms.canCreate)}>Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CrmContactsImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        canCreate={perms.canCreate}
      />
    </PageShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px]">{label}</Label>
      {children}
    </div>
  );
}
