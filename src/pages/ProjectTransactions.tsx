import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { ExportButtons } from "@/components/ExportButtons";
import { DocumentPrintButtons } from "@/components/DocumentDetail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Trash2 } from "lucide-react";
import { useMyAccess } from "@/hooks/use-my-access";
import { useGLAccounts } from "@/hooks/use-gl-data";
import { useProjectBudget, useProjectLedger, useProjects, useSaveProjectBudgetLine, useSetProjectStatus, type Project } from "@/hooks/use-projects";
import { PROJECT_STATUS, projectIndicators } from "@/lib/projects";

/*
 * Projets → Transactions : pour un projet, ses chiffres (budget, réalisé, engagé, disponible, marge),
 * son budget par compte, son grand livre (écritures comptabilisées portant sa section) et son cycle
 * (démarrer, suspendre, clôturer, rouvrir). Les coûts ne se saisissent pas ici : ils viennent des pièces.
 */
const fmt = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const SOURCES: Record<string, string> = { manual: "Écriture manuelle", ap_invoice: "Facture fournisseur", ar_invoice: "Facture client", expense_report: "Note de frais",
  goods_receipt: "Réception", ap_credit_note: "Avoir fournisseur", ar_credit_note: "Avoir client", reversal: "Contre-passation" };

function StatusActions({ p }: { p: Project }) {
  const set = useSetProjectStatus();
  const { data: access } = useMyAccess();
  const perms = new Set(access?.permissions ?? []);
  const ask = (status: Project["status"], label: string, needReason: boolean) => {
    const reason = needReason ? window.prompt(`Motif — ${label}`) : null;
    if (needReason && !(reason && reason.trim())) return;
    set.mutate({ id: p.id, status, reason: reason?.trim() });
  };
  return (
    <div className="flex flex-wrap gap-1" data-testid="project-status-actions">
      {p.status === "planned" && perms.has("projects.manage") && <Button size="sm" disabled={set.isPending} onClick={() => ask("active", "Démarrer", false)}>Démarrer</Button>}
      {perms.has("projects.close") && p.status === "active" && <Button size="sm" variant="outline" disabled={set.isPending} onClick={() => ask("on_hold", "Suspendre", true)}>Suspendre</Button>}
      {perms.has("projects.close") && ["active", "on_hold"].includes(p.status) && <Button size="sm" variant="outline" disabled={set.isPending} onClick={() => ask("closed", "Clôturer", true)}>Clôturer</Button>}
      {perms.has("projects.close") && ["on_hold", "closed"].includes(p.status) && <Button size="sm" variant="outline" disabled={set.isPending} onClick={() => ask("active", "Rouvrir", false)}>{p.status === "closed" ? "Rouvrir" : "Reprendre"}</Button>}
      {perms.has("projects.close") && p.status === "planned" && <Button size="sm" variant="ghost" className="text-destructive" disabled={set.isPending} onClick={() => ask("cancelled", "Annuler le projet", true)}>Annuler</Button>}
    </div>
  );
}

function Budget({ p }: { p: Project }) {
  const { data: lines = [] } = useProjectBudget(p.id);
  const { data: gl = [] } = useGLAccounts();
  const save = useSaveProjectBudgetLine();
  const { data: access } = useMyAccess();
  const can = (access?.permissions ?? []).includes("projects.budget") && !["closed", "cancelled"].includes(p.status);
  const [n, setN] = useState({ account: "", amount: "" });
  const acc = new Map((gl as any[]).map((g) => [g.id, g]));
  const choices = (gl as any[]).filter((g) => g.is_active && ["expense", "revenue"].includes(g.account_type));
  return (
    <section className="bg-card border border-border rounded-lg p-4 space-y-2" aria-label="Budget du projet" data-testid="project-budget">
      <h3 className="text-sm font-semibold">Budget par compte <span className="text-xs font-normal text-muted-foreground">(un compte couvre ses sous-comptes ; charges et produits)</span></h3>
      <table className="w-full text-xs">
        <thead><tr className="text-muted-foreground"><th className="text-left">Compte</th><th className="text-left">Nature</th><th className="text-right">Montant</th><th /></tr></thead>
        <tbody>
          {lines.length === 0 && <tr><td colSpan={4} className="py-2 text-muted-foreground">Aucune ligne de budget.</td></tr>}
          {lines.map((l) => {
            const g = acc.get(l.gl_account_id);
            return (
              <tr key={l.id} className="border-t border-border/50" data-testid="project-budget-line">
                <td className="py-1">{g ? `${g.code} — ${g.name}` : "—"}</td><td>{g?.account_type === "revenue" ? "Produit" : "Charge"}</td>
                <td className="text-right">{can ? <Input aria-label={`Montant ${g?.code ?? ""}`} defaultValue={String(l.amount)} inputMode="decimal" className="h-7 w-32 text-xs text-right ml-auto"
                  onBlur={(e) => { const v = Number(e.target.value.replace(/\s/g, "").replace(",", ".")); if (v !== l.amount && v >= 0) save.mutate({ id: l.id, project_id: p.id, gl_account_id: l.gl_account_id, amount: v }); }} />
                  : <span className="tabular-nums">{fmt(l.amount)}</span>}</td>
                <td className="text-right">{can && <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Retirer ${g?.code ?? ""}`} onClick={() => save.mutate({ id: l.id, project_id: p.id, gl_account_id: l.gl_account_id, amount: 0, remove: true })}><Trash2 className="w-3.5 h-3.5" /></Button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {can && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><label htmlFor="pjb-account" className="text-[11px] text-muted-foreground">Compte</label>
            <select id="pjb-account" className="h-8 rounded-md border border-input bg-background px-2 text-xs w-72" value={n.account} onChange={(e) => setN({ ...n, account: e.target.value })}>
              <option value="">— choisir —</option>{choices.filter((g) => !lines.some((l) => l.gl_account_id === g.id)).map((g) => <option key={g.id} value={g.id}>{g.code} — {g.name}</option>)}</select></div>
          <div className="space-y-1"><label htmlFor="pjb-amount" className="text-[11px] text-muted-foreground">Montant</label>
            <Input id="pjb-amount" inputMode="decimal" className="h-8 w-32 text-xs text-right" value={n.amount} onChange={(e) => setN({ ...n, amount: e.target.value })} /></div>
          <Button size="sm" className="h-8 text-xs" disabled={!n.account || !n.amount || save.isPending}
            onClick={() => save.mutate({ project_id: p.id, gl_account_id: n.account, amount: Number(n.amount.replace(/\s/g, "").replace(",", ".")) }, { onSuccess: () => setN({ account: "", amount: "" }) })}>Ajouter au budget</Button>
        </div>
      )}
    </section>
  );
}

export default function ProjectTransactions() {
  const [params, setParams] = useSearchParams();
  const { data: projects = [], isLoading } = useProjects();
  const pickedId = params.get("project") ?? projects.find((p) => p.status === "active")?.id ?? projects[0]?.id ?? null;
  const p = projects.find((x) => x.id === pickedId) ?? null;
  const ledger = useProjectLedger(p?.id ?? null);
  const { data: access } = useMyAccess();
  const canExport = (access?.permissions ?? []).includes("projects.export");
  const i = p ? projectIndicators(p) : null;
  const rows = useMemo(() => (ledger.data ?? []).map((r) => ({ piece: r.piece_number, date: r.entry_date, journal: r.journal_code, origine: SOURCES[r.source] ?? r.source,
    compte: r.account_code, intitule: r.account_name, libelle: r.description, charge: r.account_type === "expense" ? r.debit - r.credit : 0,
    produit: r.account_type === "revenue" ? r.credit - r.debit : 0 })), [ledger.data]);
  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Comptabilité et finance" }, { label: "Projets", href: "/projects" }, { label: "Transactions" }]} />
      <GuidanceBanner title="Suivi d'un projet" description="Budget, réalisé (écritures portant la section du projet), engagé (commandes en cours), disponible et marge. Pour imputer un coût au projet, choisir sa section sur la pièce (demande, commande, facture, note de frais, écriture)." />
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="space-y-1"><label htmlFor="pj-pick" className="text-xs text-muted-foreground">Projet</label>
          <select id="pj-pick" className="h-9 rounded-md border border-input bg-background px-2 text-sm w-80" value={pickedId ?? ""} onChange={(e) => setParams((x) => { x.set("project", e.target.value); return x; }, { replace: true })}>
            {projects.map((x) => <option key={x.id} value={x.id}>{x.project_code} — {x.name}</option>)}</select></div>
        {p && <StatusActions p={p} />}
      </div>
      {isLoading ? <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin" /></div> : !p ? <p className="text-sm text-muted-foreground">Aucun projet : en créer un dans Données de base.</p> : (
        <>
          <div className="flex items-center gap-2 text-xs"><StatusBadge status={PROJECT_STATUS[p.status][0]} label={PROJECT_STATUS[p.status][1]} />
            {p.status_reason && <span className="text-muted-foreground">{p.status_reason}</span>}{p.completion_pct != null && <span>Avancement {p.completion_pct} %</span>}</div>
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3" data-testid="project-figures">
            {[["Budget de charges", p.budget_costs], ["Réalisé", p.actual_costs], ["Engagé", p.committed], ["Disponible", i!.available], ["Produits réalisés", p.actual_revenue], ["Marge réalisée", i!.margin]].map(([l, v]) => (
              <div key={l as string} className="bg-card border border-border rounded-lg p-3"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">{l}</div>
                <div className={`text-lg font-semibold ${(l === "Disponible" || l === "Marge réalisée") && (v as number) < 0 ? "text-destructive" : ""}`}>{fmt(v as number)}</div></div>
            ))}
          </div>
          <Budget p={p} />
          <section className="bg-card border border-border rounded-lg" aria-label="Grand livre du projet">
            <div className="p-3 border-b border-border flex flex-wrap items-center gap-2 justify-between">
              <h3 className="text-sm font-semibold">Écritures du projet</h3>
              {canExport && <div className="flex gap-2">
                <DocumentPrintButtons testId="project-statement-print" build={() => ({
                  title: `Situation du projet ${p.project_code}`, fileName: `situation-projet-${p.project_code}`, amountInWords: false, orientation: "landscape",
                  header: [["Projet", `${p.project_code} — ${p.name}`], ["Client", p.customer?.name ?? "—"], ["Statut", PROJECT_STATUS[p.status][1]], ["Période", `${p.start_date ?? "—"} → ${p.end_date ?? "—"}`]],
                  columns: [{ label: "Pièce" }, { label: "Date" }, { label: "Origine" }, { label: "Compte" }, { label: "Libellé" }, { label: "Charge", align: "right" }, { label: "Produit", align: "right" }],
                  rows: rows.map((r) => [r.piece, r.date, r.origine, `${r.compte} ${r.intitule}`, r.libelle ?? "", r.charge ? fmt(r.charge) : "", r.produit ? fmt(r.produit) : ""]),
                  footer: [["Budget de charges", fmt(p.budget_costs)], ["Réalisé", fmt(p.actual_costs)], ["Engagé", fmt(p.committed)], ["Disponible", fmt(i!.available), true],
                    ["Produits réalisés", fmt(p.actual_revenue)], ["Marge réalisée", fmt(i!.margin), true]],
                  signatures: ["Chef de projet", "Contrôleur de gestion"],
                })} />
                <ExportButtons label="Exporter les écritures" rows={rows} columns={[{ key: "piece", header: "Pièce" }, { key: "date", header: "Date" }, { key: "journal", header: "Journal" },
                  { key: "origine", header: "Origine" }, { key: "compte", header: "Compte" }, { key: "intitule", header: "Intitulé" }, { key: "libelle", header: "Libellé" },
                  { key: "charge", header: "Charge" }, { key: "produit", header: "Produit" }]} filename={`ecritures-projet-${p.project_code}`} />
              </div>}
            </div>
            {ledger.isLoading ? <div className="flex justify-center py-8"><Loader2 className="w-4 h-4 animate-spin" /></div> : (
              <table className="w-full text-xs" data-testid="project-ledger">
                <thead><tr className="bg-muted/30 text-muted-foreground"><th className="text-left p-2">Pièce</th><th className="text-left">Date</th><th className="text-left">Origine</th><th className="text-left">Compte</th>
                  <th className="text-left">Libellé</th><th className="text-right">Charge</th><th className="text-right pr-3">Produit</th></tr></thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Aucune écriture comptabilisée sur la section du projet.</td></tr>}
                  {rows.map((r, k) => <tr key={k} className="border-t border-border/50" data-testid="project-ledger-row"><td className="p-2 font-mono">{r.piece}</td><td>{r.date}</td><td>{r.origine}</td>
                    <td>{r.compte} {r.intitule}</td><td>{r.libelle}</td><td className="text-right tabular-nums">{r.charge ? fmt(r.charge) : ""}</td><td className="text-right tabular-nums pr-3">{r.produit ? fmt(r.produit) : ""}</td></tr>)}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </PageShell>
  );
}
