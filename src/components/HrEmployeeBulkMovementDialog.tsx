import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateEmployeeMovementsBulk, useHrMovementReferences } from "@/hooks/use-hr-data";
import { getConfiguredBulkActions } from "@/lib/hr-bulk-actions";

export function HrEmployeeBulkMovementDialog({ open, onOpenChange, employeeIds }: { open: boolean; onOpenChange: (open: boolean) => void; employeeIds: string[] }) {
  const refs = useHrMovementReferences();
  const create = useCreateEmployeeMovementsBulk();
  const actions = useMemo(() => getConfiguredBulkActions(refs.data ?? []), [refs.data]);
  const [actionId, setActionId] = useState("");
  const [actionValue, setActionValue] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const action = actions.find((item) => item.id === actionId);
  const reasonCodes = (refs.data ?? []).filter((item) => item.kind === "reason_code" && item.active);
  const submit = () => {
    if (!action || !actionValue || !reasonCode || reason.trim().length < 3 || employeeIds.length === 0) return;
    create.mutate({ employee_ids: employeeIds, movement_type: action.code, effective_date: effectiveDate, reason_code: reasonCode, reason: reason.trim(), action_value: actionValue }, { onSuccess: () => { onOpenChange(false); setReason(""); } });
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Soumettre un mouvement groupé</DialogTitle></DialogHeader>
    {refs.isError && <p role="alert" className="text-sm text-destructive">Impossible de charger les références RH.</p>}
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1 sm:col-span-2"><Label>Action paramétrée</Label><select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={actionId} onChange={(event) => { setActionId(event.target.value); setActionValue(""); }}><option value="">Choisir une action</option>{actions.map((item) => <option value={item.id} key={item.id}>{item.label} · {item.field}</option>)}</select></div>
      {action && <div className="space-y-1 sm:col-span-2"><Label>{action.label}</Label><select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={actionValue} onChange={(event) => setActionValue(event.target.value)}><option value="">Choisir une valeur</option>{action.options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></div>}
      <div className="space-y-1"><Label>Date d’effet</Label><Input type="date" value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} /></div>
      <div className="space-y-1"><Label>Motif paramétré</Label><select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}><option value="">Choisir un motif</option>{reasonCodes.map((item) => <option value={item.code} key={item.id}>{item.label}</option>)}</select></div>
      <div className="space-y-1 sm:col-span-2"><Label>Commentaire obligatoire</Label><Input value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} /></div>
    </div>
    <p className="text-xs text-muted-foreground">{employeeIds.length} salarié(s) sélectionné(s). Chaque mouvement restera en attente de validation RH.</p>
    <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button><Button disabled={!action || !actionValue || !reasonCode || reason.trim().length < 3 || !effectiveDate || create.isPending} onClick={submit}>{create.isPending ? "Soumission…" : "Soumettre les mouvements"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
