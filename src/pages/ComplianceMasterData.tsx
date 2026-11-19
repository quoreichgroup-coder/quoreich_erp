import { useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { useControls, useFrameworks, useGrcPerms, useSaveControl, useSaveFramework, type Control } from "@/hooks/use-grc";
import { CONTROL_STATUS, FREQUENCY, SEVERITY, type RiskLevel } from "@/lib/grc";

/* Conformité → Données de base : référentiels (contrôle interne, AUDCIF, fiscalité, procédures…) et leurs contrôles ; aucun n'est pré-rempli. */
const sel = "h-8 rounded-md border border-input bg-background px-2 text-xs";

function ControlDialog({ control, frameworkId, onClose }: { control: Control | null; frameworkId: string; onClose: () => void }) {
  const save = useSaveControl();
  const [f, setF] = useState({ control_code: control?.control_code ?? "", title: control?.title ?? "", description: control?.description ?? "", category: control?.category ?? "",
    owner: control?.owner ?? "", risk_level: (control?.risk_level ?? "medium") as RiskLevel, frequency: control?.frequency ?? "", test_procedure: control?.test_procedure ?? "",
    next_review_at: control?.next_review_at ?? "", is_active: control?.is_active ?? true });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle className="text-sm">{control ? `Contrôle ${control.control_code}` : "Nouveau contrôle"}</DialogTitle>
          <DialogDescription className="text-xs">L'état du contrôle vient de ses tests ; la fréquence fixe l'échéance du test suivant.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><label htmlFor="c-code" className="text-xs font-medium">Code *</label>
            <Input id="c-code" className="h-8 text-xs" disabled={Boolean(control)} value={f.control_code} onChange={(e) => setF({ ...f, control_code: e.target.value.toUpperCase() })} /></div>
          <div className="space-y-1"><label htmlFor="c-cat" className="text-xs font-medium">Processus / catégorie</label>
            <Input id="c-cat" className="h-8 text-xs" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></div>
          <div className="space-y-1 col-span-2"><label htmlFor="c-title" className="text-xs font-medium">Intitulé *</label>
            <Input id="c-title" className="h-8 text-xs" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
          <div className="space-y-1 col-span-2"><label htmlFor="c-proc" className="text-xs font-medium">Procédure de test</label>
            <Input id="c-proc" className="h-8 text-xs" value={f.test_procedure} onChange={(e) => setF({ ...f, test_procedure: e.target.value })} /></div>
          <div className="space-y-1"><label htmlFor="c-owner" className="text-xs font-medium">Responsable</label>
            <Input id="c-owner" className="h-8 text-xs" value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} /></div>
          <div className="space-y-1"><label htmlFor="c-level" className="text-xs font-medium">Niveau de risque couvert</label>
            <select id="c-level" className={`${sel} w-full`} value={f.risk_level} onChange={(e) => setF({ ...f, risk_level: e.target.value as RiskLevel })}>
              {(["low", "medium", "high", "critical"] as RiskLevel[]).map((s) => <option key={s} value={s}>{SEVERITY[s][1]}</option>)}</select></div>
          <div className="space-y-1"><label htmlFor="c-freq" className="text-xs font-medium">Fréquence de test</label>
            <select id="c-freq" className={`${sel} w-full`} value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })}>
              <option value="">Ponctuelle</option>{Object.entries(FREQUENCY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div className="space-y-1"><label htmlFor="c-next" className="text-xs font-medium">Premier test prévu le</label>
            <Input id="c-next" type="date" className="h-8 text-xs" value={f.next_review_at} onChange={(e) => setF({ ...f, next_review_at: e.target.value })} /></div>
          {control && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} /> Actif</label>}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Annuler</Button>
          <Button size="sm" disabled={!f.control_code.trim() || !f.title.trim() || save.isPending}
            onClick={() => save.mutate({ ...control, ...f, framework_id: frameworkId }, { onSuccess: onClose })}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ComplianceMasterData() {
  const perms = useGrcPerms();
  const { data: frameworks = [] } = useFrameworks();
  const { data: controls = [] } = useControls();
  const saveFw = useSaveFramework();
  const [fw, setFw] = useState({ name: "", version: "" });
  const [current, setCurrent] = useState<string>("");
  const [editing, setEditing] = useState<Control | "new" | null>(null);
  const selected = current || frameworks[0]?.id || "";
  const mine = controls.filter((c) => c.framework_id === selected);
  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Gouvernance" }, { label: "Conformité", href: "/compliance" }, { label: "Données de base" }]} />
      <GuidanceBanner title="Référentiels et contrôles" description="Chaque société définit ses référentiels et ses contrôles (aucun modèle imposé)." />
      <h1 className="text-lg font-semibold">Conformité — Données de base</h1>
      <section className="bg-card border border-border rounded-lg p-4 space-y-3" data-testid="compliance-frameworks">
        <h2 className="text-sm font-semibold">Référentiels</h2>
        <div className="flex flex-wrap gap-2">
          {frameworks.length === 0 && <p className="text-xs text-muted-foreground">Aucun référentiel.</p>}
          {frameworks.map((f) => (
            <button key={f.id} data-testid="framework-tab" className={`px-3 py-1.5 rounded-md border text-xs ${f.id === selected ? "border-primary bg-primary/10" : "border-border"}`} onClick={() => setCurrent(f.id)}>
              {f.name}{f.version ? ` (${f.version})` : ""} · {f.compliant_controls}/{f.total_controls}{f.status === "archived" ? " · archivé" : ""}</button>
          ))}
        </div>
        {perms.complianceManage && (
          <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
            <div className="space-y-1"><label htmlFor="fw-name" className="text-[11px] text-muted-foreground">Nom du référentiel</label>
              <Input id="fw-name" className="h-8 w-64 text-xs" value={fw.name} onChange={(e) => setFw({ ...fw, name: e.target.value })} /></div>
            <div className="space-y-1"><label htmlFor="fw-version" className="text-[11px] text-muted-foreground">Version</label>
              <Input id="fw-version" className="h-8 w-24 text-xs" value={fw.version} onChange={(e) => setFw({ ...fw, version: e.target.value })} /></div>
            <Button size="sm" className="h-8 text-xs gap-1" disabled={!fw.name.trim() || saveFw.isPending} onClick={() => saveFw.mutate(fw, { onSuccess: () => setFw({ name: "", version: "" }) })}>
              <Plus className="w-3.5 h-3.5" /> Ajouter le référentiel</Button>
            {selected && (() => { const f = frameworks.find((x) => x.id === selected)!; return (
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => saveFw.mutate({ ...f, status: f.status === "active" ? "archived" : "active" })}>
                {f.status === "active" ? "Archiver le référentiel" : "Réactiver le référentiel"}</Button>); })()}
          </div>
        )}
      </section>
      {selected && (
        <section className="card-elevated overflow-x-auto" data-testid="compliance-controls">
          <div className="flex items-center justify-between p-2">
            <h2 className="text-xs font-semibold">Contrôles du référentiel</h2>
            {perms.complianceManage && <Button size="sm" className="h-7 text-xs gap-1" onClick={() => setEditing("new")}><Plus className="w-3.5 h-3.5" /> Nouveau contrôle</Button>}
          </div>
          <table className="w-full text-xs">
            <thead><tr className="bg-muted/30 text-muted-foreground"><th className="text-left p-2">Code</th><th className="text-left">Contrôle</th><th className="text-left">Processus</th><th className="text-left">Responsable</th>
              <th className="text-left">Fréquence</th><th className="text-left">Niveau</th><th className="text-left">État</th></tr></thead>
            <tbody>
              {mine.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Aucun contrôle.</td></tr>}
              {mine.map((c) => (
                <tr key={c.id} className={`border-t border-border/50 ${perms.complianceManage ? "hover:bg-muted/30 cursor-pointer" : ""} ${c.is_active ? "" : "opacity-60"}`} data-testid="master-control-row"
                  onClick={() => perms.complianceManage && setEditing(c)}>
                  <td className="p-2 font-mono">{c.control_code}</td><td>{c.title}</td><td>{c.category ?? "—"}</td><td>{c.owner ?? "—"}</td><td>{c.frequency ? FREQUENCY[c.frequency] : "Ponctuelle"}</td>
                  <td>{c.risk_level ? SEVERITY[c.risk_level][1] : "—"}</td>
                  <td><StatusBadge status={CONTROL_STATUS[c.status][0]} label={c.is_active ? CONTROL_STATUS[c.status][1] : "Inactif"} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {editing && selected && <ControlDialog control={editing === "new" ? null : editing} frameworkId={selected} onClose={() => setEditing(null)} />}
    </PageShell>
  );
}
