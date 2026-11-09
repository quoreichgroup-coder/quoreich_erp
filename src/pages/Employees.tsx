import { useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Lock, Users, Download } from "lucide-react";
import { useEmployees, useUpsertEmployee, useMyHrRoles, type Employee } from "@/hooks/use-hr-data";
import { canDo, actionTooltip, maskAmount } from "@/lib/hr-roles";
import { exportToCSV } from "@/lib/csv-export";

export default function Employees() {
  const perms = useMyHrRoles();
  const canCreate = canDo(perms, "create_employee");
  const canEdit = canDo(perms, "edit_employee");
  const canExport = canDo(perms, "export");
  const createTip = actionTooltip(perms, "create_employee", "Créer un employé");
  const editTip = actionTooltip(perms, "edit_employee", "Modifier");
  const exportTip = actionTooltip(perms, "export", "Exporter CSV");

  const { data: employees = [], isLoading } = useEmployees();
  const upsert = useUpsertEmployee();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Employee> | null>(null);
  const [q, setQ] = useState("");

  const filtered = employees.filter((e) => {
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return (
      e.matricule.toLowerCase().includes(s) ||
      e.first_name.toLowerCase().includes(s) ||
      e.last_name.toLowerCase().includes(s) ||
      (e.department ?? "").toLowerCase().includes(s)
    );
  });

  const startCreate = () => {
    if (!canCreate) return;
    setEditing({
      matricule: "", first_name: "", last_name: "", email: "", phone: "",
      job_title: "", department: "", contract_type: "CDI",
      hire_date: new Date().toISOString().slice(0, 10),
      base_salary: 0, currency: "XOF", status: "active",
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
    if (!editing.matricule || !editing.first_name || !editing.last_name) {
      return;
    }
    await upsert.mutateAsync(editing as never);
    setOpen(false);
    setEditing(null);
  };

  const handleExport = () => {
    if (!canExport) return;
    exportToCSV(
      filtered.map((e) => ({
        matricule: e.matricule,
        nom: `${e.first_name} ${e.last_name}`,
        email: e.email ?? "",
        poste: e.job_title ?? "",
        departement: e.department ?? "",
        contrat: e.contract_type,
        embauche: e.hire_date,
        salaire: canDo(perms, "view_sensitive") ? e.base_salary : 0,
        statut: e.status,
      })),
      [
        { key: "matricule", header: "Matricule" }, { key: "nom", header: "Nom" },
        { key: "email", header: "Email" }, { key: "poste", header: "Poste" },
        { key: "departement", header: "Département" }, { key: "contrat", header: "Contrat" },
        { key: "embauche", header: "Embauche" }, { key: "salaire", header: "Salaire base" },
        { key: "statut", header: "Statut" },
      ],
      `employees-${new Date().toISOString().slice(0, 10)}`,
    );
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
          <Button
            size="sm" variant="outline" className="h-8 text-xs gap-1"
            disabled={!canExport || filtered.length === 0}
            aria-label={exportTip} title={exportTip} onClick={handleExport}
          >
            {canExport ? <Download className="w-3 h-3" /> : <Lock className="w-3 h-3" />} CSV
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button
                size="sm" className="h-8 text-xs gap-1"
                disabled={!canCreate}
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
                  <Field label="Matricule *" value={editing.matricule} onChange={(v) => setEditing({ ...editing, matricule: v })} />
                  <Field label="Contrat" value={editing.contract_type} onChange={(v) => setEditing({ ...editing, contract_type: v })} />
                  <Field label="Prénom *" value={editing.first_name} onChange={(v) => setEditing({ ...editing, first_name: v })} />
                  <Field label="Nom *" value={editing.last_name} onChange={(v) => setEditing({ ...editing, last_name: v })} />
                  <Field label="Email" value={editing.email ?? ""} onChange={(v) => setEditing({ ...editing, email: v })} />
                  <Field label="Téléphone" value={editing.phone ?? ""} onChange={(v) => setEditing({ ...editing, phone: v })} />
                  <Field label="Poste" value={editing.job_title ?? ""} onChange={(v) => setEditing({ ...editing, job_title: v })} />
                  <Field label="Département" value={editing.department ?? ""} onChange={(v) => setEditing({ ...editing, department: v })} />
                  <Field label="Date d'embauche" type="date" value={editing.hire_date ?? ""} onChange={(v) => setEditing({ ...editing, hire_date: v })} />
                  <Field label="Statut" value={editing.status ?? "active"} onChange={(v) => setEditing({ ...editing, status: v })} />
                  <Field
                    label="Salaire de base (XOF)" type="number"
                    value={String(editing.base_salary ?? 0)}
                    onChange={(v) => setEditing({ ...editing, base_salary: Number(v) || 0 })}
                  />
                  <Field
                    label="Compte bancaire" value={editing.bank_account ?? ""}
                    onChange={(v) => setEditing({ ...editing, bank_account: v })}
                  />
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Annuler</Button>
                <Button size="sm" onClick={save} disabled={upsert.isPending}>
                  {upsert.isPending ? "Enregistrement…" : "Enregistrer"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="bg-card rounded-lg border border-border overflow-hidden">
        <div className="overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <Th>Matricule</Th><Th>Nom</Th><Th>Poste</Th><Th>Département</Th>
                <Th>Contrat</Th><Th>Embauche</Th>
                <Th className="text-right">Salaire base</Th>
                <Th>Banque</Th><Th>Statut</Th><Th></Th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">Chargement…</td></tr>}
              {!isLoading && filtered.length === 0 && (
                <tr><td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">Aucun employé</td></tr>
              )}
              {filtered.map((e) => (
                <tr key={e.id} className="border-b border-border/50 hover:bg-muted/20">
                  <td className="px-3 py-2 font-mono text-primary">{e.matricule}</td>
                  <td className="px-3 py-2 font-medium">{e.first_name} {e.last_name}</td>
                  <td className="px-3 py-2">{e.job_title ?? "—"}</td>
                  <td className="px-3 py-2">{e.department ?? "—"}</td>
                  <td className="px-3 py-2"><Badge variant="outline" className="text-[10px]">{e.contract_type}</Badge></td>
                  <td className="px-3 py-2 font-mono text-[11px]">{e.hire_date}</td>
                  <td className="px-3 py-2 text-right font-mono">{maskAmount(perms, Number(e.base_salary))}</td>
                  <td className="px-3 py-2 font-mono text-[11px]">{maskAmount(perms, e.bank_account ?? "—")}</td>
                  <td className="px-3 py-2">
                    <Badge className={`text-[10px] ${e.status === "active" ? "bg-success/15 text-success border-success/20" : "bg-muted text-muted-foreground"}`} variant="outline">
                      {e.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right">
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
    </PageShell>
  );
}

function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <th className={`text-left px-3 py-2 font-medium text-muted-foreground uppercase tracking-wider ${className}`}>{children}</th>;
}

function Field({
  label, value, onChange, type = "text",
}: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase text-muted-foreground">{label}</Label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="h-8 text-xs" />
    </div>
  );
}
