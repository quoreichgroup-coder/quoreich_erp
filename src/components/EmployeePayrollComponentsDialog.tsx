import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useHrEmployeePayrollComponents, useHrPayrollComponents, useSaveHrEmployeePayrollComponent } from "@/hooks/use-hr-data";

export function EmployeePayrollComponentsDialog({ employee, open, onOpenChange, canManage }: {
  employee: { id: string; first_name: string; last_name: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
}) {
  const [componentId, setComponentId] = useState("");
  const [amountOverride, setAmountOverride] = useState("");
  const [quantity, setQuantity] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [effectiveTo, setEffectiveTo] = useState("");
  const [active, setActive] = useState(true);
  const [editingAssignment, setEditingAssignment] = useState<string | null>(null);
  const { data: assignments = [], isLoading, isError, error, refetch } = useHrEmployeePayrollComponents(employee?.id ?? null, open);
  const { data: components = [] } = useHrPayrollComponents(false);
  const save = useSaveHrEmployeePayrollComponent();
  const selected = components.find((c) => c.id === componentId);
  const usesQuantity = selected?.calculation_method === "quantity_rate" || selected?.calculation_method === "formula";

  useEffect(() => {
    if (!open) {
      setComponentId(""); setAmountOverride(""); setEffectiveFrom(new Date().toISOString().slice(0, 10));
      setEffectiveTo(""); setActive(true); setEditingAssignment(null);
    }
  }, [open]);

  const submit = () => {
    if (!employee || !componentId || !effectiveFrom || (effectiveTo && effectiveTo < effectiveFrom)) return;
    save.mutate({
      employeeId: employee.id,
      input: { component_id: componentId, amount_override: amountOverride ? Number(amountOverride) : null,
        quantity: usesQuantity && quantity ? Number(quantity) : null,
        effective_from: effectiveFrom, effective_to: effectiveTo || null, active },
    }, { onSuccess: () => { setComponentId(""); setAmountOverride(""); setQuantity(""); setEffectiveTo(""); setActive(true); setEditingAssignment(null); } });
  };
  const editAssignment = (row: (typeof assignments)[number]) => {
    setEditingAssignment(row.id); setComponentId(row.component_id); setAmountOverride(row.amount_override == null ? "" : String(row.amount_override));
    setQuantity(row.quantity == null ? "" : String(row.quantity));
    setEffectiveFrom(row.effective_from); setEffectiveTo(row.effective_to ?? ""); setActive(row.active);
  };

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-3xl">
      <DialogHeader><DialogTitle>Rubriques de paie · {employee?.first_name} {employee?.last_name}</DialogTitle>
        <DialogDescription>Chaque affectation précise sa période, son montant éventuel de remplacement et son statut.</DialogDescription></DialogHeader>
      {isError && <div role="alert" className="flex items-center justify-between gap-3 rounded border border-destructive/30 p-3 text-xs text-destructive"><span>Chargement impossible{error instanceof Error ? ` : ${error.message}` : "."}</span><Button size="sm" variant="outline" onClick={() => void refetch()}>Réessayer</Button></div>}
      {canManage && <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
        <div className="space-y-1"><Label className="text-xs">Rubrique active</Label><select aria-label="Rubrique active" value={componentId} onChange={(e) => setComponentId(e.target.value)} className="h-8 w-full rounded-md border bg-background px-2 text-xs"><option value="">Choisir…</option>{components.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.label}</option>)}</select></div>
        <div className="space-y-1"><Label htmlFor="hr-payroll-override" className="text-xs">Montant de remplacement (facultatif)</Label><Input id="hr-payroll-override" type="number" min="0" step="0.01" value={amountOverride} onChange={(e) => setAmountOverride(e.target.value)} className="h-8 text-xs" /></div>
        {usesQuantity && <div className="space-y-1"><Label htmlFor="hr-payroll-quantity" className="text-xs">Quantité mensuelle (heures, jours, unités)</Label><Input id="hr-payroll-quantity" type="number" min="0" step="0.01" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="h-8 text-xs" /></div>}
        <div className="space-y-1"><Label htmlFor="hr-payroll-assignment-from" className="text-xs">Date d’effet</Label><Input id="hr-payroll-assignment-from" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="h-8 text-xs" /></div>
        <div className="space-y-1"><Label htmlFor="hr-payroll-assignment-to" className="text-xs">Fin d’effet (facultatif)</Label><Input id="hr-payroll-assignment-to" type="date" value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)} className="h-8 text-xs" /></div>
        <div className="flex items-center gap-2 text-xs"><input id="hr-payroll-assignment-active" type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /><Label htmlFor="hr-payroll-assignment-active">Affectation active</Label></div>
        <DialogFooter className="sm:col-span-2"><Button disabled={!componentId || !effectiveFrom || !!(effectiveTo && effectiveTo < effectiveFrom) || (!!amountOverride && Number(amountOverride) < 0) || save.isPending || isError} onClick={submit}>{save.isPending ? "Enregistrement…" : editingAssignment ? "Enregistrer l’affectation" : "Affecter la rubrique"}</Button>{editingAssignment && <Button type="button" variant="outline" disabled={save.isPending} onClick={() => { setEditingAssignment(null); setComponentId(""); setAmountOverride(""); setEffectiveTo(""); setActive(true); }}>Annuler</Button>}</DialogFooter>
      </div>}
      <div className="max-h-64 overflow-auto rounded-md border">
        {isLoading ? <p className="p-4 text-xs text-muted-foreground">Chargement…</p> : <table className="w-full text-left text-xs"><thead><tr className="border-b text-muted-foreground"><th className="p-2">Rubrique</th><th className="p-2">Montant appliqué</th><th className="p-2">Période</th><th className="p-2">Statut</th>{canManage && <th className="p-2">Action</th>}</tr></thead><tbody>
          {assignments.map((a) => <tr key={a.id} className="border-b"><td className="p-2">{a.code} · {a.label}</td><td className="p-2">{a.amount.toLocaleString("fr-FR")}{a.calculation_method === "percent_base" ? "%" : ""}</td><td className="p-2">{a.effective_from}{a.effective_to ? ` → ${a.effective_to}` : " → sans fin"}</td><td className="p-2"><Badge variant={a.active ? "default" : "outline"}>{a.active ? "Active" : "Inactive"}</Badge></td>{canManage && <td className="p-2"><Button type="button" size="sm" variant="outline" onClick={() => editAssignment(a)}>Modifier</Button></td>}</tr>)}
          {!assignments.length && <tr><td colSpan={canManage ? 5 : 4} className="p-4 text-center text-muted-foreground">Aucune rubrique affectée à ce salarié.</td></tr>}
        </tbody></table>}
      </div>
      {!canManage && <p className="text-xs text-muted-foreground">Lecture seule : le droit « Configurer les rubriques de paie » est requis.</p>}
    </DialogContent>
  </Dialog>;
}
