import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useHrMovementReferences, useSaveHrMovementReference, type HrMovementReference } from "@/hooks/use-hr-data";
import { formatBulkActionOptions, parseBulkActionOptions } from "@/lib/hr-bulk-actions";
import { hrErrorMessage } from "@/lib/hr-error-message";

type Kind = HrMovementReference["kind"];
/* Référentiels RH de la société (V83, V102) : la fiche salarié et les mouvements n'acceptent que ces valeurs. */
const KIND_LABELS: [Kind, string][] = [["movement_type", "Type de mouvement"], ["reason_code", "Code motif"], ["contract_type", "Type de contrat"], ["department", "Service"], ["job_title", "Poste"]];
const KIND_TITLES: Record<Kind, string> = { movement_type: "Types de mouvement", reason_code: "Motifs", contract_type: "Types de contrat", department: "Services", job_title: "Postes" };
const fields = [
  ["department", "Service"], ["job_title", "Poste"], ["contract_type", "Type de contrat"], ["status", "Statut"], ["end_date", "Date de fin"],
] as const;

export function HrMovementSettingsCard({ canManage }: { canManage: boolean }) {
  const refs = useHrMovementReferences(true);
  const save = useSaveHrMovementReference();
  const [kind, setKind] = useState<Kind>("movement_type");
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingActive, setEditingActive] = useState(true);
  const [actionField, setActionField] = useState("");
  const [actionOptions, setActionOptions] = useState("");
  const parsed = parseBulkActionOptions(actionOptions);

  const submit = async () => {
    if (!code.trim() || !label.trim()) return;
    await save.mutateAsync({ kind, code: code.trim().toLowerCase(), label: label.trim(), active: editingActive,
      sort_order: Number(sortOrder) || 0, bulk_action_field: kind === "movement_type" ? actionField || null : null,
      bulk_action_options: kind === "movement_type" && actionField ? parsed.options : [] });
    setCode(""); setLabel(""); setSortOrder("0"); setEditingId(null); setActionField(""); setActionOptions("");
  };
  const update = (reference: HrMovementReference, active: boolean) => save.mutate({
    kind: reference.kind, code: reference.code, label: reference.label, active, sort_order: reference.sort_order,
    bulk_action_field: reference.bulk_action_field, bulk_action_options: reference.bulk_action_options ?? [],
  });

  return <section className="rounded-lg border border-border bg-card p-4 space-y-4">
    <div><h2 className="text-sm font-semibold">Types de mouvements et actions en masse</h2><p className="mt-1 text-xs text-muted-foreground">Configurez les types, les motifs et les valeurs proposées. Les mouvements groupés suivent le même circuit d’approbation que les mouvements individuels.</p></div>
    {canManage && <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <div className="space-y-1"><Label htmlFor="hr-reference-kind">Référentiel</Label><select id="hr-reference-kind" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={kind} onChange={(e) => { setKind(e.target.value as Kind); if (e.target.value !== "movement_type") { setActionField(""); setActionOptions(""); } }}>{KIND_LABELS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></div>
      <div className="space-y-1"><Label htmlFor="hr-reference-code">Code</Label><Input id="hr-reference-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={80} placeholder="promotion" /></div>
      <div className="space-y-1"><Label htmlFor="hr-reference-label">Libellé</Label><Input id="hr-reference-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} placeholder="Promotion" /></div>
      <div className="space-y-1"><Label htmlFor="hr-reference-order">Ordre</Label><Input id="hr-reference-order" type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} /></div>
      {kind === "movement_type" && <>
        <div className="space-y-1"><Label htmlFor="hr-action-field">Champ modifiable en masse</Label><select id="hr-action-field" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={actionField} onChange={(e) => setActionField(e.target.value)}><option value="">Aucune action en masse</option>{fields.map(([value, text]) => <option value={value} key={value}>{text}</option>)}</select></div>
        {actionField && <div className="space-y-1 sm:col-span-2 lg:col-span-2"><Label htmlFor="hr-action-options">Valeurs autorisées (une par ligne : valeur | libellé)</Label><Textarea id="hr-action-options" rows={3} value={actionOptions} onChange={(e) => setActionOptions(e.target.value)} placeholder={'finance | Finance\noperations | Opérations'} />{parsed.errors.length > 0 && <p className="text-xs text-destructive">{parsed.errors[0]}</p>}</div>}
      </>}
      <div className="flex items-end"><Button size="sm" disabled={save.isPending || !code.trim() || !label.trim() || (!!actionField && (parsed.errors.length > 0 || parsed.options.length === 0))} onClick={() => void submit()}>{editingId ? "Mettre à jour" : "Enregistrer"}</Button></div>
    </div>}
    {refs.isError && <p role="alert" className="text-xs text-destructive">Impossible de charger les référentiels RH{hrErrorMessage(refs.error) ? ` : ${hrErrorMessage(refs.error)}` : ". Vérifiez les droits et la connexion."}</p>}
    {refs.isLoading ? <p className="text-xs text-muted-foreground">Chargement…</p> : <div className="grid gap-4 md:grid-cols-2">{KIND_LABELS.map(([group]) => <div key={group} className="space-y-2"><h3 className="text-xs font-medium">{KIND_TITLES[group]}</h3>{(refs.data ?? []).filter((item) => item.kind === group).map((item) => <div key={item.id} className="flex items-center justify-between gap-3 rounded border px-3 py-2 text-xs"><span><strong>{item.label}</strong> <span className="text-muted-foreground">({item.code}) · ordre {item.sort_order}</span>{item.bulk_action_field && <span className="block text-muted-foreground">{fields.find(([value]) => value === item.bulk_action_field)?.[1]} · {(item.bulk_action_options ?? []).length} valeurs autorisées</span>}</span>{canManage ? <div className="flex gap-1"><Button size="sm" variant="ghost" disabled={save.isPending} onClick={() => { setEditingId(item.id); setEditingActive(item.active); setKind(item.kind); setCode(item.code); setLabel(item.label); setSortOrder(String(item.sort_order)); setActionField(item.bulk_action_field ?? ""); setActionOptions(formatBulkActionOptions(item.bulk_action_options ?? [])); }}>Modifier</Button><Button size="sm" variant="outline" disabled={save.isPending} onClick={() => update(item, !item.active)}>{item.active ? "Désactiver" : "Réactiver"}</Button></div> : <span>{item.active ? "Actif" : "Inactif"}</span>}</div>)}{!(refs.data ?? []).some((item) => item.kind === group) && <p className="text-xs text-muted-foreground">Aucune valeur configurée.</p>}</div>)}</div>}
    {!canManage && <p className="text-xs text-muted-foreground">La modification exige le droit central hr.manage_movement_settings.</p>}
  </section>;
}
