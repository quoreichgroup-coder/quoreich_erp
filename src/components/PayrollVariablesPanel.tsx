import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useEmployees, useHrPayrollComponents, usePayrollRunVariables, useCreatePayrollRunVariable, useDecidePayrollRunVariable } from "@/hooks/use-hr-data";
import { useMyHrRoles } from "@/hooks/use-hr-data";

export function PayrollVariablesPanel({ runId, status }: { runId: string; status: string }) {
  const perms = useMyHrRoles();
  const editable = status === "draft";
  const variablesQuery = usePayrollRunVariables(runId);
  const employeesQuery = useEmployees();
  const componentsQuery = useHrPayrollComponents(false);
  const create = useCreatePayrollRunVariable();
  const decide = useDecidePayrollRunVariable();
  const [employeeId, setEmployeeId] = useState("");
  const [componentId, setComponentId] = useState("");
  const [amount, setAmount] = useState("");
  const [sourceKey, setSourceKey] = useState("");
  const [reason, setReason] = useState("");
  const names = new Map((employeesQuery.data ?? []).map((employee) => [employee.id, `${employee.first_name} ${employee.last_name} · ${employee.matricule}`]));
  const rows = variablesQuery.data ?? [];

  const submit = () => {
    if (!employeeId || !componentId || Number(amount) <= 0 || !sourceKey.trim() || !reason.trim()) return;
    create.mutate({ runId, employee_id: employeeId, component_id: componentId, amount: Number(amount), source_key: sourceKey.trim(), reason: reason.trim() }, {
      onSuccess: () => { setAmount(""); setSourceKey(""); setReason(""); },
    });
  };

  return <div className="mt-3 space-y-3">
    {editable && perms.canCreatePayrollRun && <div className="grid gap-2 rounded border p-3 sm:grid-cols-2 lg:grid-cols-5">
      <div className="space-y-1"><Label className="text-xs">Salarié</Label><select aria-label="Salarié de la variable" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="h-8 w-full rounded border bg-background px-2 text-xs"><option value="">Choisir…</option>{(employeesQuery.data ?? []).filter((e) => e.status === "active").map((e) => <option key={e.id} value={e.id}>{e.first_name} {e.last_name} · {e.matricule}</option>)}</select></div>
      <div className="space-y-1"><Label className="text-xs">Rubrique</Label><select aria-label="Rubrique variable" value={componentId} onChange={(e) => setComponentId(e.target.value)} className="h-8 w-full rounded border bg-background px-2 text-xs"><option value="">Choisir…</option>{(componentsQuery.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.label}</option>)}</select></div>
      <Field label="Montant" value={amount} type="number" onChange={setAmount} />
      <Field label="Référence source unique" value={sourceKey} onChange={setSourceKey} />
      <Field label="Motif" value={reason} onChange={setReason} />
      <div className="sm:col-span-2 lg:col-span-5"><Button size="sm" disabled={!employeeId || !componentId || Number(amount) <= 0 || !sourceKey.trim() || !reason.trim() || create.isPending || variablesQuery.isError || employeesQuery.isError || componentsQuery.isError} onClick={submit}>{create.isPending ? "Soumission…" : "Soumettre la variable"}</Button></div>
    </div>}
    {(variablesQuery.isError || employeesQuery.isError || componentsQuery.isError) && <p role="alert" className="text-xs text-destructive">Les variables ou les référentiels ne sont pas disponibles; la saisie et le calcul restent bloqués.</p>}
    {variablesQuery.isLoading ? <p className="py-4 text-center text-xs text-muted-foreground">Chargement des variables…</p> : <div className="overflow-auto rounded border">
      <table className="w-full text-left text-xs"><thead><tr className="border-b text-muted-foreground"><th className="p-2">Salarié</th><th className="p-2">Référence</th><th className="p-2">Motif</th><th className="p-2 text-right">Montant</th><th className="p-2">État</th>{perms.canApprovePayrollRun && <th className="p-2">Décision</th>}</tr></thead><tbody>
        {rows.map((row) => <tr key={row.id} className="border-b"><td className="p-2">{names.get(row.employee_id) ?? row.employee_id.slice(0, 8)}</td><td className="p-2">{row.source_key}</td><td className="p-2">{row.reason}</td><td className="p-2 text-right tabular-nums">{row.amount.toLocaleString("fr-FR")}</td><td className="p-2"><Badge variant={row.status === "approved" ? "default" : "outline"}>{row.status === "pending" ? "À approuver" : row.status === "approved" ? "Approuvée" : "Rejetée"}</Badge>{row.decision_reason ? <div className="mt-1 text-muted-foreground">{row.decision_reason}</div> : null}</td>{perms.canApprovePayrollRun && <td className="space-x-1 p-2">{editable && row.status === "pending" && <><Button size="sm" onClick={() => decide.mutate({ runId, variableId: row.id, decision: "approve" })}>Approuver</Button><Button size="sm" variant="outline" onClick={() => { const why = window.prompt("Motif obligatoire du rejet"); if (why?.trim()) decide.mutate({ runId, variableId: row.id, decision: "reject", reason: why.trim() }); }}>Rejeter</Button></>}</td>}</tr>)}
        {!rows.length && <tr><td colSpan={perms.canApprovePayrollRun ? 6 : 5} className="p-4 text-center text-muted-foreground">Aucune variable saisie pour ce cycle.</td></tr>}
      </tbody></table>
    </div>}
    {rows.some((row) => row.status === "pending") && <p className="text-xs text-amber-700">Le calcul du cycle reste bloqué tant qu’une variable n’a pas été approuvée ou rejetée.</p>}
  </div>;
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return <div className="space-y-1"><Label className="text-xs">{label}</Label><Input aria-label={label} type={type} min={type === "number" ? "0" : undefined} step={type === "number" ? "0.01" : undefined} value={value} onChange={(e) => onChange(e.target.value)} className="h-8 text-xs" /></div>;
}
