import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Plus } from "lucide-react";
import { Score } from "@/components/GrcWidgets";
import {
  useAssessRisk, useControls, useGrcPerms, useLinkRiskControl, useRiskActions, useRiskAssessments, useRiskCategories, useRiskControlLinks, useRisks,
  useRiskSettings, useSaveRisk, useSaveRiskAction, useSetRiskStatus, type Risk,
} from "@/hooks/use-grc";
import { useProjects } from "@/hooks/use-projects";
import { CONTROL_STATUS, isOverdue, RISK_STATUS, TREATMENT, type RiskSettings, type Treatment } from "@/lib/grc";

/* Risques → Transactions : registre (création, évaluation datée, traitement, actions, contrôles qui le couvrent), actions, historique des évaluations. */
const today = () => new Date().toISOString().slice(0, 10);
const sel = "h-8 rounded-md border border-input bg-background px-2 text-xs";

function nextCode(risks: Risk[]) {
  const n = risks.map((r) => Number(/^R-(\d+)$/.exec(r.risk_code)?.[1] ?? 0)).reduce((a, b) => Math.max(a, b), 0);
  return `R-${String(n + 1).padStart(3, "0")}`;
}

function RiskDialog({ risk, risks, onClose }: { risk: Risk | null; risks: Risk[]; onClose: () => void }) {
  const { data: categories = [] } = useRiskCategories();
  const { data: projects = [] } = useProjects();
  const save = useSaveRisk();
  const [f, setF] = useState({ risk_code: risk?.risk_code ?? nextCode(risks), title: risk?.title ?? "", description: risk?.description ?? "", category_id: risk?.category_id ?? "",
    owner: risk?.owner ?? "", mitigation_plan: risk?.mitigation_plan ?? "", review_date: risk?.review_date ?? "", project_id: risk?.project_id ?? "" });
  // Code proposé : recalculé quand la liste des risques arrive (ouverte avant le chargement, la boîte proposait
  // « R-001 », déjà pris), tant que l'utilisateur ne l'a pas saisi lui-même.
  const [codeTouched, setCodeTouched] = useState(false);
  useEffect(() => {
    if (!risk && !codeTouched) setF((prev) => ({ ...prev, risk_code: nextCode(risks) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [risks]);
  const cat = categories.find((c) => c.id === f.category_id);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle className="text-sm">{risk ? `Risque ${risk.risk_code}` : "Nouveau risque"}</DialogTitle>
          <DialogDescription className="text-xs">La cotation se fait ensuite par « Évaluer » (historique daté) sur l'échelle de la société.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><label htmlFor="risk-code" className="text-xs font-medium">Code *</label>
            <Input id="risk-code" className="h-8 text-xs" disabled={Boolean(risk)} value={f.risk_code} onChange={(e) => { setCodeTouched(true); setF({ ...f, risk_code: e.target.value.toUpperCase() }); }} /></div>
          <div className="space-y-1"><label htmlFor="risk-cat" className="text-xs font-medium">Catégorie</label>
            <select id="risk-cat" className={`${sel} w-full`} value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}>
              <option value="">—</option>{categories.filter((c) => c.is_active || c.id === f.category_id).map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}</select></div>
          <div className="space-y-1 col-span-2"><label htmlFor="risk-title" className="text-xs font-medium">Intitulé *</label>
            <Input id="risk-title" className="h-8 text-xs" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
          <div className="space-y-1 col-span-2"><label htmlFor="risk-desc" className="text-xs font-medium">Description (cause, événement, conséquence)</label>
            <Input id="risk-desc" className="h-8 text-xs" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
          <div className="space-y-1"><label htmlFor="risk-owner" className="text-xs font-medium">Responsable</label>
            <Input id="risk-owner" className="h-8 text-xs" value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} /></div>
          <div className="space-y-1"><label htmlFor="risk-review" className="text-xs font-medium">Prochaine revue</label>
            <Input id="risk-review" type="date" className="h-8 text-xs" value={f.review_date} onChange={(e) => setF({ ...f, review_date: e.target.value })} /></div>
          <div className="space-y-1 col-span-2"><label htmlFor="risk-plan" className="text-xs font-medium">Plan de traitement</label>
            <Input id="risk-plan" className="h-8 text-xs" value={f.mitigation_plan} onChange={(e) => setF({ ...f, mitigation_plan: e.target.value })} /></div>
          <div className="space-y-1 col-span-2"><label htmlFor="risk-project" className="text-xs font-medium">Projet concerné</label>
            <select id="risk-project" className={`${sel} w-full`} value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value })}>
              <option value="">—</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.project_code} — {p.name}</option>)}</select></div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Annuler</Button>
          <Button size="sm" disabled={!f.risk_code.trim() || !f.title.trim() || save.isPending}
            onClick={() => save.mutate({ ...risk, ...f, category: cat?.name ?? risk?.category ?? "—" }, { onSuccess: onClose })}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Scale({ id, label, value, onChange, max }: { id: string; label: string; value: string; onChange: (v: string) => void; max: number }) {
  return (
    <div className="space-y-1"><label htmlFor={id} className="text-[11px] text-muted-foreground">{label}</label>
      <select id={id} className={`${sel} w-full`} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>{Array.from({ length: max }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></div>
  );
}

function RiskView({ risk, settings, onClose, onEdit }: { risk: Risk; settings: RiskSettings; onClose: () => void; onEdit: () => void }) {
  const perms = useGrcPerms();
  const { data: history = [] } = useRiskAssessments(risk.id);
  const { data: actions = [] } = useRiskActions();
  const { data: links = [] } = useRiskControlLinks();
  const { data: controls = [] } = useControls();
  const assess = useAssessRisk(), setStatus = useSetRiskStatus(), saveAction = useSaveRiskAction(), link = useLinkRiskControl();
  const [a, setA] = useState({ l: String(risk.likelihood), i: String(risk.impact), rl: risk.residual_likelihood ? String(risk.residual_likelihood) : "",
    ri: risk.residual_impact ? String(risk.residual_impact) : "", notes: "" });
  const [st, setSt] = useState({ status: "treating", treatment: (risk.treatment ?? "reduce") as Treatment, reason: "" });
  const [act, setAct] = useState({ title: "", owner: "", due: "" });
  const [ctl, setCtl] = useState("");
  const mine = actions.filter((x) => x.risk_id === risk.id);
  const linked = links.filter((l) => l.risk_id === risk.id).map((l) => controls.find((c) => c.id === l.control_id)).filter(Boolean);
  const closed = risk.status === "closed";
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="text-sm">{risk.risk_code} — {risk.title}</DialogTitle>
          <DialogDescription className="text-xs">{risk.category} · {RISK_STATUS[risk.status][1]}{risk.treatment ? ` · traitement : ${TREATMENT[risk.treatment]}` : ""}
            {risk.status_reason ? ` · motif : ${risk.status_reason}` : ""}</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs" data-testid="risk-scores">
          <div className="bg-muted/30 rounded p-2">Inhérent : <Score score={risk.last_assessed_at ? risk.risk_score : null} settings={settings} /></div>
          <div className="bg-muted/30 rounded p-2">Résiduel : <Score score={risk.residual_score} settings={settings} /></div>
          <div className="bg-muted/30 rounded p-2">Responsable : {risk.owner ?? "—"}</div>
          <div className="bg-muted/30 rounded p-2">Revue : {risk.review_date ?? "—"}</div>
        </div>
        {perms.risksAssess && !closed && (
          <section aria-label="Évaluer" className="border border-border rounded-md p-2 grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
            <Scale id="as-l" label="Probabilité *" value={a.l} onChange={(v) => setA({ ...a, l: v })} max={settings.scale_max} />
            <Scale id="as-i" label="Impact *" value={a.i} onChange={(v) => setA({ ...a, i: v })} max={settings.scale_max} />
            <Scale id="as-rl" label="Probabilité résiduelle" value={a.rl} onChange={(v) => setA({ ...a, rl: v })} max={settings.scale_max} />
            <Scale id="as-ri" label="Impact résiduel" value={a.ri} onChange={(v) => setA({ ...a, ri: v })} max={settings.scale_max} />
            <div className="space-y-1"><label htmlFor="as-notes" className="text-[11px] text-muted-foreground">Commentaire</label>
              <Input id="as-notes" className="h-8 text-xs" value={a.notes} onChange={(e) => setA({ ...a, notes: e.target.value })} /></div>
            <Button size="sm" disabled={!a.l || !a.i || assess.isPending} onClick={() => assess.mutate({ risk: risk.id, likelihood: Number(a.l), impact: Number(a.i),
              residual_likelihood: a.rl ? Number(a.rl) : null, residual_impact: a.ri ? Number(a.ri) : null, notes: a.notes })}>Évaluer</Button>
          </section>
        )}
        {perms.risksManage && (
          <section aria-label="Statut" className="flex flex-wrap items-end gap-2 border border-border rounded-md p-2">
            {closed ? <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ risk: risk.id, status: "assessed" })}>Rouvrir</Button> : <>
              <div className="space-y-1"><label htmlFor="st-status" className="text-[11px] text-muted-foreground">Décision</label>
                <select id="st-status" className={sel} value={st.status} onChange={(e) => setSt({ ...st, status: e.target.value })}>
                  <option value="treating">Traiter</option><option value="accepted">Accepter le risque</option><option value="closed">Clôturer</option></select></div>
              {st.status === "treating" && <div className="space-y-1"><label htmlFor="st-treat" className="text-[11px] text-muted-foreground">Traitement</label>
                <select id="st-treat" className={sel} value={st.treatment} onChange={(e) => setSt({ ...st, treatment: e.target.value as Treatment })}>
                  {(["reduce", "avoid", "transfer"] as Treatment[]).map((t) => <option key={t} value={t}>{TREATMENT[t]}</option>)}</select></div>}
              <div className="space-y-1 flex-1 min-w-48"><label htmlFor="st-reason" className="text-[11px] text-muted-foreground">Motif{st.status !== "treating" ? " *" : ""}</label>
                <Input id="st-reason" className="h-8 text-xs" value={st.reason} onChange={(e) => setSt({ ...st, reason: e.target.value })} /></div>
              <Button size="sm" disabled={setStatus.isPending || (st.status !== "treating" && !st.reason.trim())}
                onClick={() => setStatus.mutate({ risk: risk.id, status: st.status as Risk["status"], treatment: st.status === "treating" ? st.treatment : null, reason: st.reason })}>Appliquer</Button>
            </>}
            <Button size="sm" variant="ghost" onClick={onEdit}>Modifier la fiche</Button>
          </section>
        )}
        <section aria-label="Actions" className="text-xs space-y-1">
          <h4 className="font-medium">Actions de traitement</h4>
          {mine.length === 0 && <p className="text-muted-foreground">Aucune action.</p>}
          {mine.map((x) => (
            <div key={x.id} className="flex items-center gap-2" data-testid="risk-action-row">
              <span className="flex-1">{x.title}{x.owner ? ` — ${x.owner}` : ""}</span>
              <span className={x.status === "open" && isOverdue(x.due_date, today()) ? "text-destructive" : "text-muted-foreground"}>{x.due_date ?? "sans échéance"}</span>
              <StatusBadge status={x.status === "done" ? "success" : x.status === "open" ? "warning" : "neutral"} label={x.status === "done" ? "Réalisée" : x.status === "open" ? "Ouverte" : "Abandonnée"} />
              {perms.risksManage && x.status === "open" && <>
                <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => saveAction.mutate({ id: x.id, risk_id: risk.id, status: "done" })}>Réalisée</Button>
                <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => saveAction.mutate({ id: x.id, risk_id: risk.id, status: "cancelled" })}>Abandonner</Button></>}
            </div>
          ))}
          {perms.risksManage && !closed && (
            <div className="flex flex-wrap items-end gap-2 pt-1">
              <Input aria-label="Nouvelle action" placeholder="Nouvelle action" className="h-8 text-xs w-64" value={act.title} onChange={(e) => setAct({ ...act, title: e.target.value })} />
              <Input aria-label="Responsable de l'action" placeholder="Responsable" className="h-8 text-xs w-40" value={act.owner} onChange={(e) => setAct({ ...act, owner: e.target.value })} />
              <Input aria-label="Échéance de l'action" type="date" className="h-8 text-xs w-36" value={act.due} onChange={(e) => setAct({ ...act, due: e.target.value })} />
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1" disabled={!act.title.trim() || saveAction.isPending}
                onClick={() => saveAction.mutate({ risk_id: risk.id, title: act.title.trim(), owner: act.owner, due_date: act.due }, { onSuccess: () => setAct({ title: "", owner: "", due: "" }) })}>
                <Plus className="w-3.5 h-3.5" /> Ajouter l'action</Button>
            </div>
          )}
        </section>
        <section aria-label="Contrôles" className="text-xs space-y-1">
          <h4 className="font-medium">Contrôles qui couvrent le risque</h4>
          {linked.length === 0 && <p className="text-muted-foreground">Aucun contrôle rattaché.</p>}
          {linked.map((c) => c && (
            <div key={c.id} className="flex items-center gap-2"><span className="font-mono">{c.control_code}</span><span className="flex-1">{c.title}</span>
              <StatusBadge status={CONTROL_STATUS[c.status][0]} label={CONTROL_STATUS[c.status][1]} />
              {perms.risksManage && <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => link.mutate({ risk_id: risk.id, control_id: c.id, remove: true })}>Retirer</Button>}</div>
          ))}
          {perms.risksManage && controls.length > 0 && (
            <div className="flex items-end gap-2 pt-1">
              <select aria-label="Contrôle à rattacher" className={`${sel} w-80`} value={ctl} onChange={(e) => setCtl(e.target.value)}>
                <option value="">— contrôle —</option>{controls.filter((c) => c.is_active && !linked.some((l) => l?.id === c.id)).map((c) => <option key={c.id} value={c.id}>{c.control_code} — {c.title}</option>)}</select>
              <Button size="sm" variant="outline" className="h-8 text-xs" disabled={!ctl} onClick={() => link.mutate({ risk_id: risk.id, control_id: ctl }, { onSuccess: () => setCtl("") })}>Rattacher</Button>
            </div>
          )}
        </section>
        <section aria-label="Historique" className="text-xs">
          <h4 className="font-medium mb-1">Historique des évaluations</h4>
          <table className="w-full"><thead><tr className="text-muted-foreground"><th className="text-left">Date</th><th className="text-left">Évaluateur</th><th className="text-right">Inhérent</th>
            <th className="text-right">Résiduel</th><th className="text-left pl-3">Commentaire</th></tr></thead>
            <tbody>{history.map((h) => (
              <tr key={h.id} className="border-t border-border/50" data-testid="risk-assessment-row"><td>{h.assessment_date}</td><td>{h.assessor || "—"}</td>
                <td className="text-right">{h.likelihood} × {h.impact} = <Score score={h.likelihood * h.impact} settings={settings} /></td>
                <td className="text-right">{h.residual_likelihood && h.residual_impact ? <>{h.residual_likelihood} × {h.residual_impact} = <Score score={h.residual_likelihood * h.residual_impact} settings={settings} /></> : "—"}</td>
                <td className="pl-3">{h.notes ?? ""}</td></tr>))}
              {history.length === 0 && <tr><td colSpan={5} className="text-muted-foreground py-1">Pas encore évalué.</td></tr>}</tbody></table>
        </section>
      </DialogContent>
    </Dialog>
  );
}

export default function RiskTransactions() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") ?? "register") as "register" | "actions";
  const perms = useGrcPerms();
  const { data: risks = [], isLoading } = useRisks();
  const { data: actions = [] } = useRiskActions();
  const { data: settings } = useRiskSettings();
  const [q, setQ] = useState("");
  const [viewId, setViewId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Risk | "new" | null>(null);
  const view = risks.find((r) => r.id === viewId) ?? null;
  const shown = risks.filter((r) => !q || `${r.risk_code} ${r.title} ${r.category} ${r.owner ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const byId = new Map(risks.map((r) => [r.id, r]));
  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Gouvernance" }, { label: "Risques", href: "/risk" }, { label: "Transactions" }]} />
      <GuidanceBanner title="Registre des risques" description="Identifier, évaluer (inhérent puis résiduel), décider du traitement et suivre les actions ; chaque évaluation est historisée." />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-lg font-semibold">Risques — Transactions</h1>
        {perms.risksManage && <Button size="sm" className="gap-1" onClick={() => setEditing("new")}><Plus className="w-4 h-4" /> Nouveau risque</Button>}
      </div>
      <div className="flex gap-1 border-b border-border" role="tablist">
        {([["register", `Registre (${risks.length})`], ["actions", `Actions (${actions.filter((a) => a.status === "open").length} ouvertes)`]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`px-3 py-1.5 text-xs border-b-2 ${tab === k ? "border-primary font-medium" : "border-transparent text-muted-foreground"}`}
            onClick={() => setParams({ tab: k })}>{l}</button>
        ))}
      </div>
      {isLoading || !settings ? <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin" /></div> : tab === "register" ? (
        <>
          <Input aria-label="Rechercher un risque" placeholder="Rechercher un risque" className="h-8 text-xs w-64" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="card-elevated overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="bg-muted/30 text-muted-foreground"><th className="text-left p-2">Code</th><th className="text-left">Risque</th><th className="text-left">Catégorie</th><th className="text-left">Responsable</th>
                <th className="text-right">Inhérent</th><th className="text-right">Résiduel</th><th className="text-left pl-3">Statut</th><th className="text-left">Revue</th></tr></thead>
              <tbody>
                {shown.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">Aucun risque.</td></tr>}
                {shown.map((r) => (
                  <tr key={r.id} className="border-t border-border/50 hover:bg-muted/30 cursor-pointer" data-testid="risk-row" onClick={() => setViewId(r.id)}>
                    <td className="p-2 font-mono">{r.risk_code}</td><td>{r.title}</td><td>{r.category}</td><td>{r.owner ?? "—"}</td>
                    <td className="text-right"><Score score={r.last_assessed_at ? r.risk_score : null} settings={settings} /></td>
                    <td className="text-right"><Score score={r.residual_score} settings={settings} /></td>
                    <td className="pl-3"><StatusBadge status={RISK_STATUS[r.status][0]} label={RISK_STATUS[r.status][1]} /></td>
                    <td className={isOverdue(r.review_date, today()) && r.status !== "closed" ? "text-destructive" : ""}>{r.review_date ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="card-elevated overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="bg-muted/30 text-muted-foreground"><th className="text-left p-2">Risque</th><th className="text-left">Action</th><th className="text-left">Responsable</th><th className="text-left">Échéance</th><th className="text-left">État</th></tr></thead>
            <tbody>
              {actions.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Aucune action.</td></tr>}
              {actions.map((a) => (
                <tr key={a.id} className="border-t border-border/50 hover:bg-muted/30 cursor-pointer" onClick={() => setViewId(a.risk_id)}>
                  <td className="p-2 font-mono">{byId.get(a.risk_id)?.risk_code}</td><td>{a.title}</td><td>{a.owner ?? "—"}</td>
                  <td className={a.status === "open" && isOverdue(a.due_date, today()) ? "text-destructive" : ""}>{a.due_date ?? "—"}</td>
                  <td>{a.status === "done" ? "Réalisée" : a.status === "open" ? "Ouverte" : "Abandonnée"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view && settings && <RiskView risk={view} settings={settings} onClose={() => setViewId(null)} onEdit={() => { setEditing(view); setViewId(null); }} />}
      {editing && <RiskDialog risk={editing === "new" ? null : editing} risks={risks} onClose={() => setEditing(null)} />}
    </PageShell>
  );
}
