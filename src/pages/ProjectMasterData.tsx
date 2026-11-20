import { useState } from "react";
import { Attachments } from "@/components/Attachments";
import { Link } from "react-router-dom";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { ExportButtons } from "@/components/ExportButtons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Plus } from "lucide-react";
import { useMyAccess } from "@/hooks/use-my-access";
import { useCustomers } from "@/hooks/use-ar-data";
import { useProjectSettings, useProjects, useSaveProject, type Project } from "@/hooks/use-projects";
import { PROJECT_STATUS } from "@/lib/projects";
import { normalizeSetCode } from "@/lib/account-sets";

/* Projets → Données de base : fiches projet (code figé, client, responsable, dates). La section analytique naît avec le projet. */
export function ProjectDialog({ project, onClose }: { project: Project | null; onClose: () => void }) {
  const { data: customers = [] } = useCustomers();
  const save = useSaveProject();
  const [f, setF] = useState({
    project_code: project?.project_code ?? "", name: project?.name ?? "", description: project?.description ?? "", customer_id: project?.customer_id ?? "",
    project_manager: project?.project_manager ?? "", department: project?.department ?? "", start_date: project?.start_date ?? "", end_date: project?.end_date ?? "",
    completion_pct: project?.completion_pct == null ? "" : String(project.completion_pct), status: "active",
  });
  const code = normalizeSetCode(f.project_code);
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-sm">{project ? `Projet ${project.project_code}` : "Nouveau projet"}</DialogTitle>
          <DialogDescription className="text-xs">Le code devient la section analytique du projet et ne change plus.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><label htmlFor="pj-code" className="text-xs font-medium">Code *</label>
            <Input id="pj-code" className="h-8 text-xs" disabled={!!project} value={f.project_code} onChange={(e) => set("project_code", e.target.value)} placeholder="CHANTIER-01" /></div>
          <div className="space-y-1"><label htmlFor="pj-name" className="text-xs font-medium">Intitulé *</label>
            <Input id="pj-name" className="h-8 text-xs" value={f.name} onChange={(e) => set("name", e.target.value)} /></div>
          <div className="space-y-1 col-span-2"><label htmlFor="pj-customer" className="text-xs font-medium">Client</label>
            <select id="pj-customer" className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs" value={f.customer_id} onChange={(e) => set("customer_id", e.target.value)}>
              <option value="">— projet interne —</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div className="space-y-1"><label htmlFor="pj-manager" className="text-xs font-medium">Responsable</label>
            <Input id="pj-manager" className="h-8 text-xs" value={f.project_manager} onChange={(e) => set("project_manager", e.target.value)} /></div>
          <div className="space-y-1"><label htmlFor="pj-dept" className="text-xs font-medium">Département</label>
            <Input id="pj-dept" className="h-8 text-xs" value={f.department} onChange={(e) => set("department", e.target.value)} /></div>
          <div className="space-y-1"><label htmlFor="pj-start" className="text-xs font-medium">Début</label>
            <Input id="pj-start" type="date" className="h-8 text-xs" value={f.start_date} onChange={(e) => set("start_date", e.target.value)} /></div>
          <div className="space-y-1"><label htmlFor="pj-end" className="text-xs font-medium">Fin prévue</label>
            <Input id="pj-end" type="date" className="h-8 text-xs" value={f.end_date} onChange={(e) => set("end_date", e.target.value)} /></div>
          <div className="space-y-1"><label htmlFor="pj-pct" className="text-xs font-medium">Avancement (%)</label>
            <Input id="pj-pct" type="number" min={0} max={100} className="h-8 text-xs" value={f.completion_pct} onChange={(e) => set("completion_pct", e.target.value)} /></div>
          {!project && <div className="space-y-1"><label htmlFor="pj-status" className="text-xs font-medium">Statut initial</label>
            <select id="pj-status" className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs" value={f.status} onChange={(e) => set("status", e.target.value)}>
              <option value="active">Actif (imputable)</option><option value="planned">Prévu</option></select></div>}
          <div className="space-y-1 col-span-2"><label htmlFor="pj-desc" className="text-xs font-medium">Description</label>
            <Input id="pj-desc" className="h-8 text-xs" value={f.description} onChange={(e) => set("description", e.target.value)} /></div>
        </div>
        {f.project_code && !code && <p className="text-xs text-destructive">Code : lettres, chiffres, « _ » ou « - », 20 caractères au plus.</p>}
        {project && <Attachments docType="project" docId={project.id} compact />}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Annuler</Button>
          <Button size="sm" disabled={!code || !f.name.trim() || save.isPending}
            onClick={() => save.mutate({ id: project?.id, project_code: code!, name: f.name, description: f.description || null, customer_id: f.customer_id || null,
              project_manager: f.project_manager || null, department: f.department || null, start_date: f.start_date || null, end_date: f.end_date || null,
              completion_pct: f.completion_pct === "" ? null : Number(f.completion_pct), status: f.status as Project["status"] }, { onSuccess: onClose })}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ProjectMasterData() {
  const { data: projects = [], isLoading, error } = useProjects();
  const settings = useProjectSettings();
  const { data: access } = useMyAccess();
  const can = (access?.permissions ?? []).includes("projects.manage");
  const [open, setOpen] = useState<Project | null | "new">(null);
  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Comptabilité et finance" }, { label: "Projets", href: "/projects" }, { label: "Données de base" }]} />
      <GuidanceBanner title="Projets" description="Fiches projet : client, responsable, dates, avancement. Le budget, le réalisé et l'engagé se suivent dans Transactions." />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-lg font-semibold">Projets — Données de base</h1>
        <div className="flex gap-2">
          <ExportButtons label="Exporter les projets" rows={projects.map((p) => ({ code: p.project_code, intitule: p.name, client: p.customer?.name ?? "", responsable: p.project_manager ?? "",
            debut: p.start_date ?? "", fin: p.end_date ?? "", statut: PROJECT_STATUS[p.status][1], avancement: p.completion_pct ?? "" }))}
            columns={[{ key: "code", header: "Code" }, { key: "intitule", header: "Intitulé" }, { key: "client", header: "Client" }, { key: "responsable", header: "Responsable" },
              { key: "debut", header: "Début" }, { key: "fin", header: "Fin" }, { key: "statut", header: "Statut" }, { key: "avancement", header: "Avancement (%)" }]} filename="projets" />
          {can && <Button size="sm" className="gap-1.5" disabled={!settings.data} title={settings.data ? undefined : "Choisir d'abord l'axe des projets"} onClick={() => setOpen("new")}>
            <Plus className="w-3.5 h-3.5" /> Nouveau projet</Button>}
        </div>
      </div>
      {!settings.isLoading && !settings.data && <p className="text-xs text-warning">Choisir d'abord l'axe analytique des projets : <Link className="text-primary underline" to="/projects/settings">Projets → Paramètres</Link>.</p>}
      {error && <p className="text-xs text-destructive" role="alert">{(error as Error).message}</p>}
      <div className="card-elevated overflow-x-auto">
        {isLoading ? <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin" /></div> : (
          <table className="w-full text-xs" data-testid="projects">
            <thead><tr className="bg-muted/30 text-muted-foreground"><th className="text-left p-2">Code</th><th className="text-left">Intitulé</th><th className="text-left">Client</th>
              <th className="text-left">Responsable</th><th className="text-left">Dates</th><th className="text-left pl-3">Statut</th></tr></thead>
            <tbody>
              {projects.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Aucun projet.</td></tr>}
              {projects.map((p) => (
                <tr key={p.id} data-testid="project-row" className={`border-t border-border/50 ${can ? "cursor-pointer hover:bg-muted/30" : ""}`}
                  onClick={() => can && !["closed", "cancelled"].includes(p.status) && setOpen(p)}>
                  <td className="p-2 font-mono">{p.project_code}</td><td>{p.name}</td><td>{p.customer?.name ?? "—"}</td><td>{p.project_manager ?? "—"}</td>
                  <td className="tabular-nums">{p.start_date ?? "—"} → {p.end_date ?? "—"}</td>
                  <td className="pl-3"><StatusBadge status={PROJECT_STATUS[p.status][0]} label={PROJECT_STATUS[p.status][1]} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {open && <ProjectDialog project={open === "new" ? null : open} onClose={() => setOpen(null)} />}
    </PageShell>
  );
}
