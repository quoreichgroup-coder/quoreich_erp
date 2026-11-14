import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Download, FileDown, X, Archive, UserCog, MoveRight } from "lucide-react";
import {
  useCrmOpportunities, useUpsertOpportunity, useUpdateOpportunityStage,
  useMyCrmRoles, useCrmContacts, useBulkUpdateOpportunities,
  type CrmOpportunity,
} from "@/hooks/use-crm-data";
import {
  CRM_STAGES, STAGE_LABELS, STAGE_DEFAULT_PROBABILITY,
  actionTooltip, maskAmount, type CrmStage,
} from "@/lib/crm-roles";
import { exportToCSV } from "@/lib/csv-export";
import { exportToPDF } from "@/lib/pdf-export";
import { assertBulkAllowed, type CrmBulkAction } from "@/lib/crm-bulk-actions";
import { toast } from "sonner";
import OpportunityDetailDialog from "@/components/OpportunityDetailDialog";
import { useTenantId } from "@/hooks/use-tenant";

export default function CrmOpportunities() {
  const { data: tenantId } = useTenantId();
  const perms = useMyCrmRoles();
  const { data: opps = [], isLoading } = useCrmOpportunities();
  const { data: contacts = [] } = useCrmContacts();
  const upsert = useUpsertOpportunity();
  const updateStage = useUpdateOpportunityStage();
  const bulk = useBulkUpdateOpportunities();

  const [detailId, setDetailId] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAssignTo, setBulkAssignTo] = useState("");
  const [filterConv, setFilterConv] = useState<"all" | "quote" | "so" | "none">("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState({
    name: "", contactId: "none", stage: "lead" as CrmStage, amount: "0", currency: "XOF",
    probability: STAGE_DEFAULT_PROBABILITY.lead, expectedCloseDate: "", notes: "",
  });

  function toggleSelect(id: string) {
    setSelected((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function clearSelection() { setSelected(new Set()); }
  function runBulk(action: CrmBulkAction, patch: Parameters<typeof bulk.mutate>[0]["patch"], onSuccess: () => void) {
    const check = assertBulkAllowed(perms, action, [...selected]);
    if ("message" in check) { toast.error(check.message); return; }
    bulk.mutate({ ids: [...selected], patch }, { onSuccess });
  }

  const quoteIds = useMemo(
    () => opps.map((o) => o.converted_quotation_id).filter((x): x is string => !!x),
    [opps],
  );
  const { data: soSet } = useQuery({
    queryKey: ["crm-opp-so-ids", tenantId, quoteIds.sort().join(",")],
    enabled: Boolean(tenantId && quoteIds.length > 0),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_orders")
        .select("quotation_id")
        .eq("tenant_id", tenantId!)
        .in("quotation_id", quoteIds);
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.quotation_id as string));
    },
  });

  const visibleOpps = useMemo(() => opps.filter((o) => {
      const hasQuote = !!o.converted_quotation_id;
      const hasSo = hasQuote && (soSet?.has(o.converted_quotation_id!) ?? false);
      switch (filterConv) {
        case "quote": return hasQuote;
        case "so":    return hasSo;
        case "none":  return !hasQuote;
        default:      return true;
      }
    }), [opps, soSet, filterConv]);

  const grouped = useMemo(() => {
    const map = new Map<CrmStage, CrmOpportunity[]>();
    CRM_STAGES.forEach((s) => map.set(s, []));
    visibleOpps.forEach((o) => map.get(o.stage as CrmStage)?.push(o));
    return map;
  }, [visibleOpps]);

  function handleDrop(stage: CrmStage) {
    if (!draggedId || !perms.canEdit) { setDraggedId(null); return; }
    const opp = opps.find((o) => o.id === draggedId);
    if (opp && opp.stage !== stage) {
      updateStage.mutate({ id: draggedId, stage, probability: STAGE_DEFAULT_PROBABILITY[stage] });
    }
    setDraggedId(null);
  }

  function handleCreate() {
    if (!perms.canCreate) return;
    setCreateDraft({ name: "", contactId: "none", stage: "lead", amount: "0", currency: "XOF", probability: STAGE_DEFAULT_PROBABILITY.lead, expectedCloseDate: "", notes: "" });
    setCreateOpen(true);
  }

  function handleCreateSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(createDraft.amount);
    const currency = createDraft.currency.trim().toUpperCase();
    if (!perms.canCreate || !createDraft.name.trim()) return;
    if (perms.canViewSensitive && (!Number.isFinite(amount) || amount < 0)) {
      toast.error("Le montant doit être un nombre positif ou nul.");
      return;
    }
    if (!Number.isInteger(createDraft.probability) || createDraft.probability < 0 || createDraft.probability > 100) {
      toast.error("La probabilité doit être un nombre entier entre 0 et 100.");
      return;
    }
    if (!/^[A-Z]{3}$/.test(currency)) {
      toast.error("Saisissez un code devise ISO à 3 lettres, par exemple XOF.");
      return;
    }
    upsert.mutate({
      name: createDraft.name.trim(),
      contact_id: createDraft.contactId === "none" ? null : createDraft.contactId,
      stage: createDraft.stage,
      amount: perms.canViewSensitive ? amount : 0,
      currency,
      probability: createDraft.probability,
      expected_close_date: createDraft.expectedCloseDate || null,
      notes: createDraft.notes.trim() || null,
    }, { onSuccess: () => setCreateOpen(false) });
  }

  function handleExportCsv() {
    if (!perms.canExport) return;
    exportToCSV(
      visibleOpps.map((o) => ({
        name: o.name,
        stage: STAGE_LABELS[o.stage as CrmStage] ?? o.stage,
        amount: perms.canViewSensitive ? o.amount : "•••",
        currency: o.currency, probability: o.probability,
        expected_close_date: o.expected_close_date ?? "",
        status: o.status,
      })),
      [
        { key: "name", header: "Nom" }, { key: "stage", header: "Étape" },
        { key: "amount", header: "Montant" }, { key: "currency", header: "Devise" },
        { key: "probability", header: "Probabilité %" },
        { key: "expected_close_date", header: "Clôture prévue" }, { key: "status", header: "Statut" },
      ],
      `crm-opportunities-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  }

  function handleExportPdf() {
    if (!perms.canExport) return;
    exportToPDF({
      filename: `crm-opportunities-${new Date().toISOString().slice(0, 10)}.pdf`,
      title: "Pipeline CRM",
      subtitle: `${visibleOpps.length} opportunité(s)`,
      columns: [
        { key: "name", header: "Nom" },
        { key: "stage", header: "Étape", format: (r) => STAGE_LABELS[(r as CrmOpportunity).stage as CrmStage] ?? (r as CrmOpportunity).stage },
        { key: "amount", header: "Montant", format: (r) => maskAmount(perms, Number((r as CrmOpportunity).amount)) },
        { key: "currency", header: "Dev." },
        { key: "probability", header: "%" },
        { key: "expected_close_date", header: "Clôture" },
      ],
      rows: visibleOpps as unknown as Record<string, unknown>[],
    });
  }

  return (
    <PageShell>
      <div className="space-y-3">
        <Breadcrumb items={[{ label: "CRM", href: "/crm" }, { label: "Opportunités" }]} />
        <GuidanceBanner
          title="Pipeline des opportunités"
          description="Glissez-déposez une carte pour changer son étape (action soumise au RBAC). Cliquez pour voir le détail."
        />

        <div className="flex flex-wrap justify-end items-center gap-2">
          <Select value={filterConv} onValueChange={(v) => setFilterConv(v as typeof filterConv)}>
          <SelectTrigger className="h-8 w-full text-xs sm:w-56">
              <SelectValue placeholder="Filtrer par conversion…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">Toutes les opportunités</SelectItem>
              <SelectItem value="quote" className="text-xs">Avec devis créé</SelectItem>
              <SelectItem value="so" className="text-xs">Avec bon de commande</SelectItem>
              <SelectItem value="none" className="text-xs">Sans conversion</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" className="h-8 text-xs" disabled={!perms.canExport} title={actionTooltip(perms, "export", "Exporter CSV")} onClick={handleExportCsv}>
            <Download className="w-3.5 h-3.5 mr-1" /> CSV
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-xs" disabled={!perms.canExport} title={actionTooltip(perms, "export", "Exporter PDF")} onClick={handleExportPdf}>
            <FileDown className="w-3.5 h-3.5 mr-1" /> PDF
          </Button>
          <Button size="sm" className="h-8 text-xs" disabled={!perms.canCreate} title={actionTooltip(perms, "create", "Nouvelle opportunité")} onClick={handleCreate}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Nouvelle
          </Button>
        </div>


        {selected.size > 0 && (
          <Card className="border-primary">
            <CardContent className="p-2 flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="default" className="text-[11px]">{selected.size} sélectionnée(s)</Badge>
              <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={clearSelection}>
                <X className="w-3 h-3 mr-1" /> Effacer
              </Button>

              <div className="flex w-full flex-wrap items-center gap-1 sm:ml-2 sm:w-auto">
                <MoveRight className="w-3.5 h-3.5 text-muted-foreground" />
                <Select
                  onValueChange={(v) => {
                    if (!perms.canEdit) return;
                    const stage = v as CrmStage;
                    runBulk("change_stage", { stage, probability: STAGE_DEFAULT_PROBABILITY[stage] }, clearSelection);
                  }}
                >
                <SelectTrigger className="h-7 w-full text-[11px] sm:w-40" disabled={!perms.canEdit || bulk.isPending} title={actionTooltip(perms, "edit", "Changer l'étape")}>
                    <SelectValue placeholder="Changer d'étape…" />
                  </SelectTrigger>
                  <SelectContent>
                    {CRM_STAGES.map((s) => (
                      <SelectItem key={s} value={s} className="text-xs">{STAGE_LABELS[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex w-full flex-wrap items-center gap-1 sm:ml-2 sm:w-auto">
                <UserCog className="w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  placeholder="UUID utilisateur"
                  value={bulkAssignTo}
                  onChange={(e) => setBulkAssignTo(e.target.value)}
                  className="h-7 w-full text-[11px] sm:w-56"
                />
                <Button
                  size="sm" variant="outline" className="h-7 text-[11px]"
                  disabled={!perms.canEdit || !bulkAssignTo.trim() || bulk.isPending}
                  title={actionTooltip(perms, "edit", "Assigner")}
                  onClick={() => {
                    runBulk("assign", { owner_id: bulkAssignTo.trim() }, () => { clearSelection(); setBulkAssignTo(""); });
                  }}
                >
                  Assigner
                </Button>
              </div>

              <Button
                size="sm" variant="outline" className="h-7 text-[11px] sm:ml-auto"
                disabled={!perms.canEdit || bulk.isPending}
                title={actionTooltip(perms, "delete", "Archiver")}
                onClick={() => {
                  if (!confirm(`Archiver ${selected.size} opportunité(s) ?`)) return;
                  runBulk("archive", { status: "archived" }, clearSelection);
                }}
              >
                <Archive className="w-3 h-3 mr-1" /> Archiver
              </Button>
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="text-xs text-muted-foreground">Chargement du pipeline…</div>
        ) : (
          <div className="w-full min-w-0 overflow-x-auto pb-2">
          <div className="grid w-max grid-flow-col auto-cols-[240px] gap-2 md:w-full md:grid-flow-row md:grid-cols-3 md:auto-cols-auto lg:grid-cols-6">
            {CRM_STAGES.map((stage) => {
              const list = grouped.get(stage) ?? [];
              const total = list.reduce((s, o) => s + Number(o.amount || 0), 0);
              return (
                <div
                  key={stage}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleDrop(stage)}
                  className="bg-muted/40 rounded p-2 min-h-[300px]"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wide">{STAGE_LABELS[stage]}</span>
                    <Badge variant="outline" className="text-[10px]">{list.length}</Badge>
                  </div>
                  <div className="text-[10px] text-muted-foreground mb-2">{maskAmount(perms, total)} XOF</div>
                  <div className="space-y-1.5">
                    {list.map((o) => {
                      const contact = contacts.find((c) => c.id === o.contact_id);
                      const isSel = selected.has(o.id);
                      return (
                        <Card
                          key={o.id}
                          draggable={perms.canEdit}
                          onDragStart={() => setDraggedId(o.id)}
                          onClick={() => setDetailId(o.id)}
                          className={`cursor-pointer hover:border-primary transition ${isSel ? "border-primary ring-1 ring-primary" : ""}`}
                        >
                          <CardContent className="p-2 space-y-1">
                            <div className="flex items-start gap-1.5">
                              <Checkbox
                                checked={isSel}
                                onClick={(e) => e.stopPropagation()}
                                onCheckedChange={() => toggleSelect(o.id)}
                                className="mt-0.5"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="text-[11px] font-medium leading-tight">{o.name}</div>
                                {contact && <div className="text-[10px] text-muted-foreground">{contact.company ?? contact.full_name}</div>}
                              </div>
                            </div>
                            <div className="flex items-center justify-between text-[10px]">
                              <span className="font-mono">{maskAmount(perms, Number(o.amount))}</span>
                              <Badge variant="secondary" className="text-[9px]">{o.probability}%</Badge>
                            </div>
                            {o.expected_close_date && <div className="text-[10px] text-muted-foreground">→ {o.expected_close_date}</div>}
                            <div className="flex flex-wrap gap-1">
                              {o.status === "archived" && <Badge variant="outline" className="text-[9px]">Archivée</Badge>}
                              {o.converted_quotation_id && <Badge variant="default" className="text-[9px] bg-success">Devis ✓</Badge>}
                              {o.converted_quotation_id && soSet?.has(o.converted_quotation_id) && (
                                <Badge variant="default" className="text-[9px] bg-blue-600">BC ✓</Badge>
                              )}

                            </div>

                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          </div>
        )}
      </div>

      <OpportunityDetailDialog
        opportunityId={detailId}
        open={!!detailId}
        onClose={() => setDetailId(null)}
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-xl max-h-[90dvh] overflow-y-auto p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>Nouvelle opportunité</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateSave} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="crm-opportunity-name">Nom de l’opportunité *</Label>
              <Input id="crm-opportunity-name" autoFocus value={createDraft.name} onChange={(e) => setCreateDraft((d) => ({ ...d, name: e.target.value }))} maxLength={200} required placeholder="Ex. Renouvellement contrat client" />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="crm-opportunity-contact">Contact associé</Label>
                <Select value={createDraft.contactId} onValueChange={(contactId) => setCreateDraft((d) => ({ ...d, contactId }))}>
                  <SelectTrigger id="crm-opportunity-contact"><SelectValue placeholder="Choisir un contact" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Aucun contact</SelectItem>
                    {contacts.filter((contact) => contact.status === "active").map((contact) => (
                      <SelectItem key={contact.id} value={contact.id}>{contact.full_name}{contact.company ? ` · ${contact.company}` : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="crm-opportunity-stage">Étape</Label>
                <Select value={createDraft.stage} onValueChange={(value) => { const stage = value as CrmStage; setCreateDraft((d) => ({ ...d, stage, probability: STAGE_DEFAULT_PROBABILITY[stage] })); }}>
                  <SelectTrigger id="crm-opportunity-stage"><SelectValue /></SelectTrigger>
                  <SelectContent>{CRM_STAGES.map((stage) => <SelectItem key={stage} value={stage}>{STAGE_LABELS[stage]}</SelectItem>)}</SelectContent>
                </Select>
              </div>

              {perms.canViewSensitive && <div className="space-y-1.5">
                <Label htmlFor="crm-opportunity-amount">Montant estimé</Label>
                <div className="flex gap-2">
                  <Input id="crm-opportunity-amount" type="number" min="0" step="0.01" value={createDraft.amount} onChange={(e) => setCreateDraft((d) => ({ ...d, amount: e.target.value }))} className="min-w-0 flex-1" />
                  <Input aria-label="Devise" value={createDraft.currency} onChange={(e) => setCreateDraft((d) => ({ ...d, currency: e.target.value.toUpperCase().slice(0, 3) }))} maxLength={3} className="w-20" />
                </div>
              </div>}
              <div className="space-y-1.5">
                <Label htmlFor="crm-opportunity-probability">Probabilité (%)</Label>
                <Input id="crm-opportunity-probability" type="number" min="0" max="100" value={createDraft.probability} onChange={(e) => setCreateDraft((d) => ({ ...d, probability: Number(e.target.value) }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="crm-opportunity-close-date">Date de clôture prévue</Label>
                <Input id="crm-opportunity-close-date" type="date" value={createDraft.expectedCloseDate} onChange={(e) => setCreateDraft((d) => ({ ...d, expectedCloseDate: e.target.value }))} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="crm-opportunity-notes">Notes</Label>
              <Textarea id="crm-opportunity-notes" value={createDraft.notes} onChange={(e) => setCreateDraft((d) => ({ ...d, notes: e.target.value }))} rows={3} />
            </div>

            <DialogFooter className="gap-2 pt-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Annuler</Button>
              <Button type="submit" disabled={!createDraft.name.trim() || upsert.isPending}>
                {upsert.isPending ? "Création…" : "Créer l’opportunité"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
