import { useId, useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Lock, Users, FileText, History, Coins, Upload, Layers } from "lucide-react";
import { useEmployees, useUpsertEmployee, useMyHrRoles, useHrPayrollSettings, useHrEmployeeNumberSettings, useTenantHrCurrency, useHrMovementReferences, type Employee, type HrMovementReference } from "@/hooks/use-hr-data";
import { useMyAccess } from "@/hooks/use-my-access";
import { canDo, actionTooltip, maskAmount } from "@/lib/hr-roles";
import { ExportButtons } from "@/components/ExportButtons";
import { exportToPDF } from "@/lib/pdf-export";
import { EmployeeMovementDialog } from "@/components/EmployeeMovementDialog";
import { EmployeePayrollComponentsDialog } from "@/components/EmployeePayrollComponentsDialog";
import { HrEmployeeImportDialog } from "@/components/HrEmployeeImportDialog";
import { HrEmployeeBulkMovementDialog } from "@/components/HrEmployeeBulkMovementDialog";

export default function Employees() {
  const perms = useMyHrRoles();
  const canCreate = canDo(perms, "create_employee");
  const canEdit = canDo(perms, "edit_employee");
  const canExport = canDo(perms, "export");
  const { data: access } = useMyAccess();
  const canManagePayrollComponents = (access?.permissions ?? []).includes("hr.manage_payroll_components");
  const createTip = actionTooltip(perms, "create_employee", "Créer un employé");
  const editTip = actionTooltip(perms, "edit_employee", "Modifier");
  const exportTip = actionTooltip(perms, "export", "Exporter l’annuaire");

  const { data: employees = [], isLoading, isError, error, refetch } = useEmployees();
  const { data: numberSettings } = useHrEmployeeNumberSettings();
  const { data: payrollSettings } = useHrPayrollSettings();
  const { data: tenantCurrency, isLoading: currencyLoading } = useTenantHrCurrency();
  const payrollCurrency = payrollSettings?.currency_code?.trim().toUpperCase() || tenantCurrency || "";
  const upsert = useUpsertEmployee();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Employee> | null>(null);
  const [movementEmployee, setMovementEmployee] = useState<Employee | null>(null);
  const [payrollComponentsEmployee, setPayrollComponentsEmployee] = useState<Employee | null>(null);
  const [q, setQ] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const filtered = employees.filter((e) => {
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return (
      e.matricule.toLowerCase().includes(s) ||
      e.first_name.toLowerCase().includes(s) ||
      e.last_name.toLowerCase().includes(s) ||
      (labelOf("department", e.department) ?? "").toLowerCase().includes(s)
    );
  });

  // Référentiels RH (Paramètres RH → Référentiels) : listes de la fiche et libellés affichés à la place des codes.
  const hrRefs = useHrMovementReferences(true);
  const refsOf = (kind: HrMovementReference["kind"]) => (hrRefs.data ?? []).filter((r) => r.kind === kind);
  const labelOf = (kind: HrMovementReference["kind"], code: string | null | undefined) =>
    code ? (hrRefs.data ?? []).find((r) => r.kind === kind && r.code === code)?.label ?? code : null;
  const startCreate = () => {
    if (!canCreate) return;
    setEditing({
      matricule: "", first_name: "", last_name: "", email: "", phone: "",
      job_title: "", department: "", contract_type: "",
      hire_date: new Date().toISOString().slice(0, 10),
      base_salary: 0, currency: payrollCurrency, status: numberSettings?.default_status ?? "",
    });
    setOpen(true);
  };

  const startEdit = (e: Employee) => {
    if (!canEdit) return;
    setEditing({ ...e });
    setOpen(true);
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.first_name?.trim() || !editing.last_name?.trim() || !editing.contract_type?.trim()) {
      return;
    }
    await upsert.mutateAsync(editing as never);
    setOpen(false);
    setEditing(null);
  };

  const exportRows = filtered.map((e) => ({
    matricule: e.matricule,
    nom: `${e.first_name} ${e.last_name}`,
    email: e.email ?? "",
    poste: labelOf("job_title", e.job_title) ?? "",
    departement: labelOf("department", e.department) ?? "",
    contrat: labelOf("contract_type", e.contract_type) ?? "",
    embauche: e.hire_date,
    devise: e.currency ?? "Non enregistrée",
    salaire: canDo(perms, "view_sensitive") ? Number(e.base_salary) : "Masqué",
    statut: e.status,
  }));
  const exportColumns = [
    { key: "matricule", header: "Matricule", width: 16 },
    { key: "nom", header: "Nom complet", width: 28 },
    { key: "email", header: "Courriel", width: 30 },
    { key: "poste", header: "Poste", width: 24 },
    { key: "departement", header: "Département", width: 22 },
    { key: "contrat", header: "Contrat", width: 16 },
    { key: "embauche", header: "Date d’embauche", width: 18 },
    { key: "devise", header: "Devise", width: 12 },
    { key: "salaire", header: "Salaire de base", width: 20 },
    { key: "statut", header: "Statut", width: 14 },
  ] as const;
  const handleExportPdf = () => {
    if (!canExport) return;
    void exportToPDF({
      filename: `annuaire-salaries-${new Date().toISOString().slice(0, 10)}`,
      title: "Annuaire des salariés",
      subtitle: `${filtered.length} salarié(s) · ${new Date().toLocaleDateString("fr-FR")}`,
      columns: exportColumns.map((column) => ({ key: column.key, header: column.header })),
      rows: exportRows,
      orientation: "landscape",
    });
  };

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "RH" }, { label: "Employés" }]} />
      <GuidanceBanner
        title="Annuaire des employés"
        description="Liste, création et modification des employés. Salaire et coordonnées bancaires masqués sans rôle hr_*."
      />

      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" /> Employés
        </h1>
        <div className="flex gap-2">
          <Input
            placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)}
            className="h-8 text-xs w-[220px]"
          />
        <ExportButtons pdf={false} label="Salariés" rows={exportRows} columns={[...exportColumns]} filename={`annuaire-salaries-${new Date().toISOString().slice(0, 10)}`} sheetName="Annuaire RH" disabled={!canExport || isError} />
          {canCreate && <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => setImportOpen(true)}><Upload className="w-3 h-3" />Importer CSV</Button>}
          {perms.canCreateEmployeeMovement && selectedIds.length > 0 && <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => setBulkOpen(true)}><Layers className="w-3 h-3" />Mouvement ({selectedIds.length})</Button>}
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1" disabled={!canExport || filtered.length === 0 || isError} aria-label={exportTip} title={exportTip} onClick={handleExportPdf}>
            {canExport ? <FileText className="w-3 h-3" /> : <Lock className="w-3 h-3" />} PDF
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button
                size="sm" className="h-8 text-xs gap-1"
                disabled={!canCreate || currencyLoading || !payrollCurrency}
                aria-label={createTip} title={createTip}
                onClick={startCreate}
              >
                {canCreate ? <Plus className="w-3 h-3" /> : <Lock className="w-3 h-3" />} Nouvel employé
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>{editing?.id ? "Modifier l'employé" : "Nouvel employé"}</DialogTitle>
              </DialogHeader>
              {editing && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1"><Label className="text-[10px] uppercase text-muted-foreground">Matricule</Label><Input value={editing.id ? editing.matricule ?? "" : "Généré à l’enregistrement"} disabled className="h-8 text-xs"/><span className="text-[10px] text-muted-foreground">Format configurable dans Paramètres RH · Matricules</span></div>
                  <RefField label="Contrat *" kind="contract_type" options={refsOf("contract_type")} value={editing.contract_type} disabled={!!editing.id} onChange={(v) => setEditing({ ...editing, contract_type: v })} />
                  <Field label="Prénom *" value={editing.first_name} onChange={(v) => setEditing({ ...editing, first_name: v })} />
                  <Field label="Nom *" value={editing.last_name} onChange={(v) => setEditing({ ...editing, last_name: v })} />
                  <Field label="Email" value={editing.email ?? ""} onChange={(v) => setEditing({ ...editing, email: v })} />
                  <Field label="Téléphone" value={editing.phone ?? ""} onChange={(v) => setEditing({ ...editing, phone: v })} />
                  <RefField label="Poste" kind="job_title" options={refsOf("job_title")} value={editing.job_title ?? ""} disabled={!!editing.id} onChange={(v) => setEditing({ ...editing, job_title: v })} />
                  <RefField label="Service" kind="department" options={refsOf("department")} value={editing.department ?? ""} disabled={!!editing.id} onChange={(v) => setEditing({ ...editing, department: v })} />
                  <Field label="Date d'embauche" type="date" value={editing.hire_date ?? ""} disabled={!!editing.id} onChange={(v) => setEditing({ ...editing, hire_date: v })} />
                  <div className="space-y-1"><Label htmlFor="emp-status" className="text-[10px] uppercase text-muted-foreground">Statut</Label>
                    <Input id="emp-status" value={editing.id ? STATUS_LABELS[editing.status ?? ""] ?? editing.status ?? "" : "Selon Paramètres RH · Matricules"} disabled className="h-8 text-xs" />
                    <span className="text-[10px] text-muted-foreground">Évolue ensuite par mouvement RH (suspension, sortie, réintégration).</span></div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Devise du salaire</Label>
                    <Input value={editing.currency ?? ""} disabled className="h-8 text-xs" aria-label="Devise du salaire" />
                  </div>
                  <Field
                    label={`Salaire de base (${editing.currency || "devise non configurée"})`} type="number"
                    value={String(editing.base_salary ?? 0)}
                    visible={perms.canViewSensitive || perms.canManageCompensation}
                    disabled={!!editing.id || !perms.canManageCompensation}
                    onChange={(v) => setEditing({ ...editing, base_salary: Number(v) || 0 })}
                  />
                  <Field
                    label="Compte bancaire" value={editing.bank_account ?? ""}
                    visible={perms.canViewSensitive || perms.canManageBankDetails}
                    disabled={!perms.canManageBankDetails}
                    onChange={(v) => setEditing({ ...editing, bank_account: v })}
                  />
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Annuler</Button>
                <Button size="sm" onClick={save} disabled={upsert.isPending || !editing || !editing.currency || !editing.contract_type?.trim() || !editing.first_name?.trim() || !editing.last_name?.trim()}>
                  {upsert.isPending ? "Enregistrement…" : "Enregistrer"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {isError && <div role="alert" className="mb-3 flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs">
        <span className="text-destructive">L’annuaire n’a pas pu être chargé{error instanceof Error ? ` : ${error.message}` : "."}</span>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void refetch()}>Réessayer</Button>
      </div>}

      <div className="bg-card rounded-lg border border-border overflow-hidden">
        <div className="overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <Th><input aria-label="Sélectionner tous les salariés filtrés" type="checkbox" checked={filtered.length > 0 && filtered.every((e) => selectedIds.includes(e.id))} onChange={(event) => setSelectedIds(event.target.checked ? Array.from(new Set([...selectedIds, ...filtered.map((e) => e.id)])) : selectedIds.filter((id) => !filtered.some((e) => e.id === id)))} /></Th><Th>Matricule</Th><Th>Nom</Th><Th>Poste</Th><Th>Département</Th>
                <Th>Contrat</Th><Th>Embauche</Th>
                <Th className="text-right">Salaire base</Th>
                <Th>Devise</Th>
                <Th>Banque</Th><Th>Statut</Th><Th></Th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={12} className="px-3 py-6 text-center text-muted-foreground">Chargement…</td></tr>}
              {!isLoading && isError && <tr><td colSpan={12} className="px-3 py-6 text-center text-destructive">Données indisponibles.</td></tr>}
              {!isLoading && !isError && filtered.length === 0 && (
                <tr><td colSpan={12} className="px-3 py-6 text-center text-muted-foreground">Aucun employé</td></tr>
              )}
              {filtered.map((e) => (
                <tr key={e.id} className="border-b border-border/50 hover:bg-muted/20">
                  <td className="px-3 py-2"><input type="checkbox" aria-label={`Sélectionner ${e.first_name} ${e.last_name}`} checked={selectedIds.includes(e.id)} onChange={(event) => setSelectedIds(event.target.checked ? [...selectedIds, e.id] : selectedIds.filter((id) => id !== e.id))} /></td>
                  <td className="px-3 py-2 font-mono text-primary">{e.matricule}</td>
                  <td className="px-3 py-2 font-medium">{e.first_name} {e.last_name}</td>
                  <td className="px-3 py-2">{labelOf("job_title", e.job_title) ?? "—"}</td>
                  <td className="px-3 py-2">{labelOf("department", e.department) ?? "—"}</td>
                  <td className="px-3 py-2"><Badge variant="outline" className="text-[10px]">{labelOf("contract_type", e.contract_type)}</Badge></td>
                  <td className="px-3 py-2 font-mono text-[11px]">{e.hire_date}</td>
                  <td className="px-3 py-2 text-right font-mono">{maskAmount(perms, Number(e.base_salary))}</td>
                  <td className="px-3 py-2">{e.currency ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-[11px]">{maskAmount(perms, e.bank_account ?? "—")}</td>
                  <td className="px-3 py-2">
                    <Badge className={`text-[10px] ${e.status === "active" ? "bg-success/15 text-success border-success/20" : "bg-muted text-muted-foreground"}`} variant="outline">
                      {e.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canManagePayrollComponents && <Button
                      variant="ghost" size="sm" className="h-7 text-xs"
                      aria-label={`Rubriques de paie de ${e.first_name} ${e.last_name}`}
                      onClick={() => setPayrollComponentsEmployee(e)}
                    ><Coins className="mr-1 h-3 w-3" />Rubriques</Button>}
                    {(perms.canViewEmployeeHistory || perms.canCreateEmployeeMovement) && <Button
                      variant="ghost" size="sm" className="h-7 text-xs"
                      aria-label={`Mouvements RH de ${e.first_name} ${e.last_name}`}
                      onClick={() => setMovementEmployee(e)}
                    ><History className="mr-1 h-3 w-3" />Mouvements</Button>}
                    <Button
                      variant="ghost" size="sm" className="h-7 text-xs"
                      disabled={!canEdit} aria-label={editTip} title={editTip}
                      onClick={() => startEdit(e)}
                    >
                      {canEdit ? "Modifier" : <Lock className="w-3 h-3" />}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <EmployeeMovementDialog
        employee={movementEmployee}
        open={!!movementEmployee}
        onOpenChange={(next) => { if (!next) setMovementEmployee(null); }}
        canCreate={perms.canCreateEmployeeMovement}
        canApprove={perms.canApproveEmployeeMovement}
        canViewHistory={perms.canViewEmployeeHistory}
      />
      <EmployeePayrollComponentsDialog
        employee={payrollComponentsEmployee}
        open={!!payrollComponentsEmployee}
        onOpenChange={(next) => { if (!next) setPayrollComponentsEmployee(null); }}
        canManage={canManagePayrollComponents}
      />
      <HrEmployeeImportDialog open={importOpen} onOpenChange={setImportOpen} canCreate={canCreate} />
      <HrEmployeeBulkMovementDialog open={bulkOpen} onOpenChange={(next) => { setBulkOpen(next); if (!next) setSelectedIds([]); }} employeeIds={selectedIds} />
    </PageShell>
  );
}

function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <th className={`text-left px-3 py-2 font-medium text-muted-foreground uppercase tracking-wider ${className}`}>{children}</th>;
}

const STATUS_LABELS: Record<string, string> = { active: "Actif", inactive: "Inactif", suspended: "Suspendu", terminated: "Sorti" };

/** Liste issue d'un référentiel RH ; valeur actuelle conservée même si elle a été désactivée depuis. */
function RefField({ label, kind, options, value, onChange, disabled = false }: {
  label: string; kind: string; options: HrMovementReference[]; value: string; onChange: (v: string) => void; disabled?: boolean;
}) {
  const id = `emp-${kind}`;
  const active = options.filter((o) => o.active || o.code === value);
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-[10px] uppercase text-muted-foreground">{label}</Label>
      <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}
        className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs disabled:opacity-70">
        <option value="">{active.length ? "— Choisir —" : "Aucune valeur : Paramètres RH → Référentiels"}</option>
        {active.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
      </select>
    </div>
  );
}

function Field({
  label, value, onChange, type = "text", disabled = false, visible = true,
}: { label: string; value: string; onChange: (v: string) => void; type?: string; disabled?: boolean; visible?: boolean }) {
  const id = useId();
  if (!visible) return null;
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-[10px] uppercase text-muted-foreground">{label}</Label>
      <Input id={id} type={type} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="h-8 text-xs" />
    </div>
  );
}
