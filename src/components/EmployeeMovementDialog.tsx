import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateEmployeeMovement, useDecideEmployeeMovement, useEmployeeMovements, useHrMovementReferences, type Employee, type EmployeeMovement } from "@/hooks/use-hr-data";

type Props = {
  employee: Employee | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canCreate: boolean;
  canApprove: boolean;
  canViewHistory: boolean;
};

export function EmployeeMovementDialog({ employee, open, onOpenChange, canCreate, canApprove, canViewHistory }: Props) {
  const employeeId = employee?.id ?? null;
  const history = useEmployeeMovements(employeeId, canViewHistory || canApprove);
  const references = useHrMovementReferences(false);
  const create = useCreateEmployeeMovement();
  const decide = useDecideEmployeeMovement();
  const [movementType, setMovementType] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [reasonCode, setReasonCode] = useState("");
  const [reason, setReason] = useState("");
  const [salary, setSalary] = useState("");
  const [department, setDepartment] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [contractType, setContractType] = useState("");
  const [status, setStatus] = useState("");
  const [payrollCategory, setPayrollCategory] = useState("");
  const [dependents, setDependents] = useState("");
  const [decisionReason, setDecisionReason] = useState("");
  const hasValues = !!(salary.trim() || department.trim() || jobTitle.trim() || contractType.trim() || status.trim()
    || payrollCategory || dependents.trim());

  const pending = useMemo(() => (history.data ?? []).filter((movement) => movement.status === "pending"), [history.data]);
  const submit = async () => {
    if (!employeeId) return;
    const afterValues: Record<string, unknown> = {};
    if (salary.trim()) afterValues.base_salary = Number(salary);
    if (department.trim()) afterValues.department = department.trim();
    if (jobTitle.trim()) afterValues.job_title = jobTitle.trim();
    if (contractType.trim()) afterValues.contract_type = contractType.trim();
    if (status.trim()) afterValues.status = status.trim();
    if (payrollCategory) afterValues.payroll_category = payrollCategory;
    if (dependents.trim()) afterValues.tax_dependents = Number(dependents);
    if (!Object.keys(afterValues).length) return;
    await create.mutateAsync({
      employeeId,
      movement_type: movementType.trim(),
      effective_date: effectiveDate,
      reason_code: reasonCode.trim(),
      reason: reason.trim(),
      after_values: afterValues,
    });
    setMovementType(""); setReasonCode(""); setReason(""); setSalary("");
    setDepartment(""); setJobTitle(""); setContractType(""); setStatus(""); setPayrollCategory(""); setDependents("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Mouvements RH — {employee ? `${employee.first_name} ${employee.last_name}` : "salarié"}</DialogTitle>
          <DialogDescription>Un changement d’emploi, de rémunération ou de statut est daté, motivé et approuvé par une autre personne.</DialogDescription>
        </DialogHeader>

        {canCreate && employee && (
          <section className="rounded-md border p-3 space-y-3">
            <h3 className="text-sm font-medium">Soumettre un mouvement</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label className="text-xs">Type de mouvement *</Label><select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={movementType} onChange={(event) => setMovementType(event.target.value)}><option value="">Choisir un type configuré</option>{(references.data ?? []).filter((ref) => ref.kind === "movement_type").map((ref) => <option key={ref.id} value={ref.code}>{ref.label}</option>)}</select></div>
              <Field label="Date d’effet *" value={effectiveDate} onChange={setEffectiveDate} type="date" />
              <div className="space-y-1"><Label className="text-xs">Motif configuré *</Label><select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}><option value="">Choisir un motif configuré</option>{(references.data ?? []).filter((ref) => ref.kind === "reason_code").map((ref) => <option key={ref.id} value={ref.code}>{ref.label}</option>)}</select></div>
              <Field label="Motif détaillé *" value={reason} onChange={setReason} placeholder="Justification" />
              <Field label={`Nouveau salaire (${employee.currency})`} value={salary} onChange={setSalary} type="number" />
              <Field label="Nouveau poste" value={jobTitle} onChange={setJobTitle} />
              <Field label="Nouveau département" value={department} onChange={setDepartment} />
              <Field label="Nouveau contrat" value={contractType} onChange={setContractType} />
              <Field label="Nouveau statut (facultatif)" value={status} onChange={setStatus} placeholder="actif, suspendu…" />
              <div className="space-y-1"><Label htmlFor="movement-payroll-category" className="text-xs">Nouvelle catégorie de paie</Label><select id="movement-payroll-category" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={payrollCategory} onChange={(event) => setPayrollCategory(event.target.value)}><option value="">Inchangée</option>{(references.data ?? []).filter((ref) => ref.kind === "payroll_category").map((ref) => <option key={ref.id} value={ref.code}>{ref.label}</option>)}</select></div>
              <Field label="Charges de famille (nombre, pour l’impôt)" value={dependents} onChange={setDependents} type="number" placeholder={employee.tax_dependents == null ? "" : `Actuel : ${employee.tax_dependents}`} />
            </div>
            <div className="flex justify-end">
              <Button size="sm" disabled={create.isPending || !movementType.trim() || !effectiveDate || !reasonCode.trim() || reason.trim().length < 3 || !hasValues}
                onClick={() => void submit()}>
                {create.isPending ? "Soumission…" : "Soumettre pour approbation"}
              </Button>
            </div>
            {references.isError && <p role="alert" className="text-xs text-destructive">Les types et motifs RH configurés ne sont pas disponibles.</p>}
            {!references.isLoading && !(references.data ?? []).some((ref) => ref.kind === "movement_type" && ref.active) && <p className="text-xs text-destructive">Aucun type de mouvement actif. Demandez à l’administrateur RH de le configurer dans Paramètres.</p>}
          </section>
        )}

        {canApprove && pending.length > 0 && (
          <section className="rounded-md border p-3 space-y-2">
            <h3 className="text-sm font-medium">À approuver</h3>
            {pending.map((movement) => <MovementRow key={movement.id} movement={movement} canApprove
              decisionReason={decisionReason} onReasonChange={setDecisionReason}
              onDecide={(decision) => void decide.mutateAsync({ movementId: movement.id, employeeId: movement.employee_id, decision, reason: decisionReason })} />)}
          </section>
        )}

        {canViewHistory && (
          <section className="space-y-2">
            <h3 className="text-sm font-medium">Historique</h3>
            {history.isLoading && <p className="text-xs text-muted-foreground">Chargement de l’historique…</p>}
            {history.isError && <p role="alert" className="text-xs text-destructive">Impossible de charger l’historique RH.</p>}
            {(history.data ?? []).map((movement) => <MovementRow key={movement.id} movement={movement} />)}
            {!history.isLoading && !history.isError && !history.data?.length && <p className="text-xs text-muted-foreground">Aucun mouvement enregistré.</p>}
          </section>
        )}

        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Fermer</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MovementRow({ movement, canApprove = false, decisionReason, onReasonChange, onDecide }: {
  movement: EmployeeMovement; canApprove?: boolean; decisionReason?: string;
  onReasonChange?: (value: string) => void; onDecide?: (decision: "approve" | "reject") => void;
}) {
  return (
    <article className="rounded border p-3 text-xs space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong>{movement.movement_type} · {movement.effective_date}</strong>
        <span className="capitalize">{movement.status}</span>
      </div>
      <p>{movement.reason_code}: {movement.reason}</p>
      <pre className="whitespace-pre-wrap break-words font-mono text-[10px]">{JSON.stringify(movement.after_values, null, 2)}</pre>
      {movement.decision_reason && <p>Décision : {movement.decision_reason}</p>}
      {canApprove && onDecide && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[200px] flex-1"><Field label="Motif de décision (requis pour un rejet)" value={decisionReason ?? ""} onChange={onReasonChange ?? (() => {})} /></div>
          <Button size="sm" disabled={!onDecide} onClick={() => onDecide("approve")}>Approuver</Button>
          <Button size="sm" variant="destructive" disabled={!decisionReason?.trim()} onClick={() => onDecide("reject")}>Rejeter</Button>
        </div>
      )}
    </article>
  );
}

function Field({ label, value, onChange, type = "text", placeholder }: {
  label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string;
}) {
  return <div className="space-y-1"><Label className="text-xs">{label}</Label><Input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></div>;
}
