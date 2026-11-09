import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarClock, MessageSquare, Plus, Trash2, FileText, CheckCircle2, Download, ArrowRight } from "lucide-react";
import {
  useCrmOpportunities, useCrmContacts, useCrmActivities,
  useUpsertOpportunity, useCreateActivity, useDeleteOpportunity,
  useMyCrmRoles, useConvertOpportunityToQuote, useConvertQuoteToSo, useQuoteForOpportunity, useLogCrmExport,
} from "@/hooks/use-crm-data";
import { toast } from "sonner";
import {
  CRM_STAGES, STAGE_LABELS, STAGE_DEFAULT_PROBABILITY,
  actionTooltip, maskAmount, type CrmStage,
} from "@/lib/crm-roles";
import { exportQuotePdf, exportQuoteCsv, type QuoteExportData } from "@/lib/crm-quote-export";



type Props = {
  opportunityId: string | null;
  open: boolean;
  onClose: () => void;
};

export default function OpportunityDetailDialog({ opportunityId, open, onClose }: Props) {
  const perms = useMyCrmRoles();
  const { data: opps = [] } = useCrmOpportunities();
  const { data: contacts = [] } = useCrmContacts();
  const { data: activities = [] } = useCrmActivities(opportunityId);

  const opp = useMemo(() => opps.find((o) => o.id === opportunityId) ?? null, [opps, opportunityId]);
  const contact = useMemo(() => contacts.find((c) => c.id === opp?.contact_id), [contacts, opp]);

  const upsert = useUpsertOpportunity();
  const del = useDeleteOpportunity();
  const createActivity = useCreateActivity();
  const convert = useConvertOpportunityToQuote();

  const { data: customers = [] } = useQuery({
    queryKey: ["crm-conversion-customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id,name")
        .order("name", { ascending: true })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
    enabled: open,
  });


  const [tab, setTab] = useState("details");
  const [draft, setDraft] = useState<Partial<typeof opp>>({});
  const [newActivity, setNewActivity] = useState<{ subject: string; type: string; notes: string }>({ subject: "", type: "task", notes: "" });
  const [conversionCustomer, setConversionCustomer] = useState<string>("");

  const convertSo = useConvertQuoteToSo();
  const logExport = useLogCrmExport();
  const { data: quoteBundle } = useQuoteForOpportunity(opp?.converted_quotation_id ? opp.id : null);

  const current = { ...opp, ...draft } as NonNullable<typeof opp>;



  function handleSave() {
    if (!opp || !perms.canEdit) return;
    upsert.mutate({ id: opp.id, ...draft, name: current.name } as never, {
      onSuccess: () => setDraft({}),
    });
  }

  function handleAddActivity() {
    if (!opp || !newActivity.subject.trim() || !perms.canCreate) return;
    createActivity.mutate({
      opportunity_id: opp.id,
      contact_id: opp.contact_id ?? null,
      type: newActivity.type,
      subject: newActivity.subject.trim(),
      notes: newActivity.notes || null,
    }, {
      onSuccess: () => setNewActivity({ subject: "", type: "task", notes: "" }),
    });
  }

  function handleDelete() {
    if (!opp || !perms.canDelete) return;
    if (!confirm("Supprimer définitivement cette opportunité ?")) return;
    del.mutate(opp.id, { onSuccess: onClose });
  }

  if (!opp) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            {opp.name}
            <Badge variant="outline" className="text-[10px]">{STAGE_LABELS[opp.stage as CrmStage] ?? opp.stage}</Badge>
            <Badge variant="secondary" className="text-[10px]">{maskAmount(perms, Number(opp.amount))} {opp.currency}</Badge>
            {opp.converted_quotation_id && <Badge className="text-[10px] bg-success">Devis ✓</Badge>}

          </DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="h-8">
            <TabsTrigger value="details" className="text-xs">Détails</TabsTrigger>
            <TabsTrigger value="activities" className="text-xs">Activités &amp; timeline</TabsTrigger>
            <TabsTrigger value="assign" className="text-xs">Assignation</TabsTrigger>
            <TabsTrigger value="conversion" className="text-xs">Conversion</TabsTrigger>
          </TabsList>


          <TabsContent value="details" className="space-y-2 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Nom"><Input value={current.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} className="h-8 text-xs" disabled={!perms.canEdit} /></Field>
              <Field label="Contact">
                <Select value={current.contact_id ?? ""} onValueChange={(v) => setDraft((d) => ({ ...d, contact_id: v || null }))} disabled={!perms.canEdit}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {contacts.map((c) => <SelectItem key={c.id} value={c.id}>{c.full_name}{c.company ? ` · ${c.company}` : ""}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Étape">
                <Select
                  value={current.stage}
                  onValueChange={(v) => setDraft((d) => ({ ...d, stage: v as CrmStage, probability: STAGE_DEFAULT_PROBABILITY[v as CrmStage] }))}
                  disabled={!perms.canEdit}
                >
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CRM_STAGES.map((s) => <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Montant">
                <Input
                  type="number"
                  value={Number(current.amount ?? 0)}
                  onChange={(e) => setDraft((d) => ({ ...d, amount: Number(e.target.value) }))}
                  className="h-8 text-xs"
                  disabled={!perms.canEdit || !perms.canViewSensitive}
                />
              </Field>
              <Field label="Probabilité %">
                <Input
                  type="number" min={0} max={100}
                  value={Number(current.probability ?? 0)}
                  onChange={(e) => setDraft((d) => ({ ...d, probability: Number(e.target.value) }))}
                  className="h-8 text-xs"
                  disabled={!perms.canEdit}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Clôture prévue">
                <Input
                  type="date"
                  value={current.expected_close_date ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, expected_close_date: e.target.value || null }))}
                  className="h-8 text-xs"
                  disabled={!perms.canEdit}
                />
              </Field>
              <Field label="Statut">
                <Select value={current.status} onValueChange={(v) => setDraft((d) => ({ ...d, status: v }))} disabled={!perms.canEdit}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Ouverte</SelectItem>
                    <SelectItem value="paused">En pause</SelectItem>
                    <SelectItem value="closed">Clôturée</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="Notes"><Textarea value={current.notes ?? ""} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} rows={3} className="text-xs" disabled={!perms.canEdit} /></Field>
          </TabsContent>

          <TabsContent value="activities" className="space-y-2 text-xs">
            <div className="border rounded p-2 space-y-1.5">
              <Label className="text-[11px]">Nouvelle activité</Label>
              <div className="flex gap-2">
                <Select value={newActivity.type} onValueChange={(v) => setNewActivity((a) => ({ ...a, type: v }))}>
                  <SelectTrigger className="h-8 text-xs w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="task">Tâche</SelectItem>
                    <SelectItem value="call">Appel</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="meeting">Réunion</SelectItem>
                    <SelectItem value="note">Note</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  placeholder="Sujet…"
                  value={newActivity.subject}
                  onChange={(e) => setNewActivity((a) => ({ ...a, subject: e.target.value }))}
                  className="h-8 text-xs"
                />
                <Button size="sm" className="h-8 text-xs" disabled={!perms.canCreate || !newActivity.subject.trim()} onClick={handleAddActivity}>
                  <Plus className="w-3.5 h-3.5 mr-1" /> Ajouter
                </Button>
              </div>
              <Textarea
                placeholder="Notes (optionnel)…"
                value={newActivity.notes}
                onChange={(e) => setNewActivity((a) => ({ ...a, notes: e.target.value }))}
                rows={2}
                className="text-xs"
              />
            </div>

            <div className="space-y-2 max-h-72 overflow-y-auto">
              {activities.length === 0 ? (
                <p className="text-[11px] text-muted-foreground text-center py-4">Aucune activité.</p>
              ) : activities.map((a) => (
                <div key={a.id} className="border-l-2 border-primary/40 pl-2 py-1">
                  <div className="flex items-center gap-2 text-[11px]">
                    {a.type === "stage_change" ? <CalendarClock className="w-3 h-3 text-amber-600" /> : <MessageSquare className="w-3 h-3 text-muted-foreground" />}
                    <span className="font-medium">{a.subject}</span>
                    <Badge variant="outline" className="text-[9px]">{a.type}</Badge>
                    <span className="ml-auto text-muted-foreground text-[10px]">{new Date(a.created_at).toLocaleString("fr-FR")}</span>
                  </div>
                  {a.notes && <p className="text-[11px] text-muted-foreground mt-1">{a.notes}</p>}
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="assign" className="space-y-2 text-xs">
            <Field label="Propriétaire (user ID)">
              <Input
                value={current.owner_id ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, owner_id: e.target.value || null }))}
                placeholder="UUID utilisateur…"
                className="h-8 text-xs"
                disabled={!perms.canEdit}
              />
            </Field>
            <p className="text-[11px] text-muted-foreground">
              {contact ? `Contact lié : ${contact.full_name} (${contact.email ?? "—"})` : "Aucun contact lié."}
            </p>
          </TabsContent>

          <TabsContent value="conversion" className="space-y-3 text-xs">
            {/* Étape 1 : opportunité → devis */}
            <section className="border rounded p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px]">Étape 1</Badge>
                <span className="font-medium">Opportunité → Devis</span>
                {opp.converted_quotation_id && <CheckCircle2 className="w-3.5 h-3.5 text-success" />}
              </div>
              {opp.converted_quotation_id ? (
                <p className="text-[11px] text-muted-foreground">
                  Devis créé {quoteBundle?.quote ? <strong>{quoteBundle.quote.quote_number}</strong> : null} — statut <strong>{quoteBundle?.quote?.status ?? "—"}</strong>.
                </p>
              ) : opp.stage !== "won" ? (
                <p className="text-[11px] text-muted-foreground">
                  Disponible au stade <strong>Gagnée</strong>. Actuel : {STAGE_LABELS[opp.stage as CrmStage]}.
                </p>
              ) : !perms.canConvert ? (
                <p className="text-[11px] text-amber-600">Permission CRM `convert` requise.</p>
              ) : (
                <>
                  <Field label="Client cible">
                    <Select value={conversionCustomer} onValueChange={setConversionCustomer}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Sélectionner un client…" /></SelectTrigger>
                      <SelectContent>
                        {customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Button
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => convert.mutate({ opportunityId: opp.id, customerId: conversionCustomer || null })}
                    disabled={!conversionCustomer || convert.isPending}
                  >
                    <FileText className="w-3.5 h-3.5 mr-1" />
                    {convert.isPending ? "Conversion…" : "Convertir en devis"}
                  </Button>
                </>
              )}
            </section>

            {/* Étape 2 : devis → bon de commande */}
            <section className="border rounded p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px]">Étape 2</Badge>
                <span className="font-medium">Devis → Bon de commande</span>
                {quoteBundle?.salesOrder && <CheckCircle2 className="w-3.5 h-3.5 text-success" />}
              </div>
              {!opp.converted_quotation_id ? (
                <p className="text-[11px] text-muted-foreground">Convertissez d'abord en devis.</p>
              ) : quoteBundle?.salesOrder ? (
                <p className="text-[11px] text-muted-foreground">
                  Bon de commande <strong>{quoteBundle.salesOrder.so_number}</strong> — statut {quoteBundle.salesOrder.status}.
                </p>
              ) : !perms.canConvert ? (
                <p className="text-[11px] text-amber-600">Permission CRM `convert` requise.</p>
              ) : (
                <Button
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => convertSo.mutate(opp.converted_quotation_id!)}
                  disabled={convertSo.isPending}
                >
                  <ArrowRight className="w-3.5 h-3.5 mr-1" />
                  {convertSo.isPending ? "Conversion…" : "Convertir en bon de commande"}
                </Button>
              )}
            </section>

            {/* Exports */}
            {opp.converted_quotation_id && quoteBundle?.quote && (
              <section className="border rounded p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">Exports</Badge>
                  <span className="font-medium">Devis {quoteBundle.quote.quote_number}</span>
                </div>
                {!perms.canExport ? (
                  <div className="rounded border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-2 text-[11px] text-amber-800 dark:text-amber-200">
                    🔒 Export bloqué — permission CRM <code>export</code> requise (rôles Manager / Auditeur / Admin).
                  </div>
                ) : (
                  <div className="flex gap-2">
                    {(["csv", "pdf"] as const).map((fmt) => (
                      <Button
                        key={fmt}
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs"
                        onClick={() => {
                          if (!perms.canExport) {
                            toast.error("Export bloqué : permission `export` requise.");
                            return;
                          }
                          const customer = customers.find((c) => c.id === quoteBundle.quote!.customer_id);
                          const payload: QuoteExportData = {
                            quote_number: quoteBundle.quote!.quote_number,
                            quote_date: quoteBundle.quote!.quote_date,
                            valid_until: quoteBundle.quote!.valid_until,
                            status: quoteBundle.quote!.status,
                            customer_name: customer?.name ?? "—",
                            currency: opp.currency,
                            total: Number(quoteBundle.quote!.total ?? 0),
                            lines: quoteBundle.lines,
                            opportunity_name: opp.name,
                            so_number: quoteBundle.salesOrder?.so_number ?? null,
                          };
                          const perm = { canExport: perms.canExport, canViewSensitive: perms.canViewSensitive };
                          try {
                            if (fmt === "csv") exportQuoteCsv(payload, perm); else exportQuotePdf(payload, perm);
                            logExport.mutate({
                              opportunityId: opp.id,
                              format: fmt,
                              kind: `quote:${quoteBundle.quote!.quote_number}`,
                              recordId: quoteBundle.quote!.id ?? null,
                            });
                            toast.success(
                              `Export ${fmt.toUpperCase()} généré${perms.canViewSensitive ? "" : " (montants masqués)"}.`,
                            );
                          } catch (err) {
                            toast.error(`Échec export ${fmt.toUpperCase()} : ${(err as Error).message}`);
                          }
                        }}
                      >
                        <Download className="w-3.5 h-3.5 mr-1" /> {fmt.toUpperCase()}
                      </Button>
                    ))}
                  </div>
                )}
                {perms.canExport && !perms.canViewSensitive && (
                  <div className="rounded border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-2 text-[10px] text-amber-800 dark:text-amber-200">
                    ⚠ Données sensibles masquées : permission <code>view_sensitive</code> requise pour afficher les montants en clair.
                  </div>
                )}
              </section>
            )}
          </TabsContent>



        </Tabs>

        <DialogFooter className="gap-2">
          <Button
            variant="ghost" size="sm" className="text-destructive mr-auto"
            onClick={handleDelete}
            disabled={!perms.canDelete}
            title={actionTooltip(perms, "delete", "Supprimer")}
          >
            <Trash2 className="w-3.5 h-3.5 mr-1" /> Supprimer
          </Button>
          <Button variant="outline" size="sm" onClick={onClose}>Fermer</Button>
          <Button size="sm" onClick={handleSave} disabled={!perms.canEdit || Object.keys(draft).length === 0 || upsert.isPending}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
