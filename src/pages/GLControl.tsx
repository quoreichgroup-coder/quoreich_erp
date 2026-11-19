import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { ExportButtons } from "@/components/ExportButtons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, Calculator, CheckCircle, Clock, Eye, Loader2, Plus, Scale, Settings2, ShieldCheck, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGLPeriods } from "@/hooks/use-gl-data";
import { useGlAccountOptions } from "@/hooks/use-accounting-setup";
import { useMyAccess } from "@/hooks/use-my-access";
import { isApiEnabled } from "@/api/client";
import {
  CHECK_LABELS, useGlAuditTrail, useGlFindings, useGlIntegrity, useGlReconciliation, useReviewFinding, type GlFinding,
} from "@/hooks/use-gl-controls";

/*
 * Grand livre → Contrôle (V106) : anomalies par écriture (seuils et contrôles paramétrés par la société),
 * concordance des livres auxiliaires avec leurs comptes collectifs, intégrité de la comptabilité,
 * piste d'audit, périodes et simulateur d'écriture. Plus aucune donnée de démonstration.
 */
const fmt = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);
const yearStart = () => `${new Date().getFullYear()}-01-01`;
const SEVERITY: Record<string, [string, string]> = { critical: ["error", "Critique"], warning: ["warning", "À examiner"], info: ["info", "Information"] };

const tabs = [
  { id: "anomalies", label: "Anomalies", icon: AlertTriangle },
  { id: "reconciliation", label: "Concordance des livres", icon: Scale },
  { id: "integrity", label: "Intégrité", icon: ShieldCheck },
  { id: "audit", label: "Piste d'audit", icon: Eye },
  { id: "periods", label: "Périodes", icon: Clock },
  { id: "simulation", label: "Simulateur d'écriture", icon: Calculator },
] as const;

function Periode({ from, to, onFrom, onTo }: { from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <label className="text-muted-foreground" htmlFor="ctl-from">Du</label>
      <Input id="ctl-from" type="date" className="h-8 w-36 text-xs" value={from} onChange={(e) => onFrom(e.target.value)} />
      <label className="text-muted-foreground" htmlFor="ctl-to">au</label>
      <Input id="ctl-to" type="date" className="h-8 w-36 text-xs" value={to} onChange={(e) => onTo(e.target.value)} />
    </div>
  );
}

function ReviewDialog({ finding, onClose }: { finding: GlFinding; onClose: () => void }) {
  const review = useReviewFinding();
  const [comment, setComment] = useState("");
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="text-sm">Examiner : {CHECK_LABELS[finding.check_code] ?? finding.check_code} — {finding.piece_number}</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">{finding.detail}</p>
        <label htmlFor="review-comment" className="text-xs font-medium">Justification (obligatoire)</label>
        <Textarea id="review-comment" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} />
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Annuler</Button>
          <Button size="sm" disabled={!comment.trim() || review.isPending}
            onClick={() => review.mutate({ check: finding.check_code, entryId: finding.entry_id, comment: comment.trim() }, { onSuccess: onClose })}>Enregistrer l'examen</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Anomalies({ canReview }: { canReview: boolean }) {
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(today());
  const [showReviewed, setShowReviewed] = useState(false);
  const [open, setOpen] = useState<GlFinding | null>(null);
  const q = useGlFindings(from, to);
  const rows = (q.data ?? []).filter((f) => showReviewed || !f.reviewed);
  return (
    <section className="bg-card border border-border rounded-lg" aria-label="Anomalies">
      <div className="p-3 border-b border-border flex flex-wrap items-center gap-3">
        <Periode from={from} to={to} onFrom={setFrom} onTo={setTo} />
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={showReviewed} onChange={(e) => setShowReviewed(e.target.checked)} /> Afficher les anomalies examinées</label>
        <div className="ml-auto">
          <ExportButtons label="Exporter les anomalies" rows={rows.map((f) => ({ controle: CHECK_LABELS[f.check_code] ?? f.check_code, gravite: SEVERITY[f.severity]?.[1] ?? f.severity,
            piece: f.piece_number ?? "", date: f.entry_date, montant: f.amount, detail: f.detail, examen: f.reviewed ? f.review_comment ?? "examinée" : "" }))}
            columns={[{ key: "controle", header: "Contrôle" }, { key: "gravite", header: "Gravité" }, { key: "piece", header: "Pièce" }, { key: "date", header: "Date" },
              { key: "montant", header: "Montant" }, { key: "detail", header: "Détail" }, { key: "examen", header: "Examen" }]} filename={`anomalies-grand-livre-${to}`} />
        </div>
      </div>
      {q.isLoading ? <div className="p-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div>
        : q.isError ? <div className="p-4 text-xs text-destructive" role="alert">{(q.error as Error).message} <Button size="sm" variant="outline" className="h-6 ml-2 text-xs" onClick={() => q.refetch()}>Réessayer</Button></div>
        : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs" data-testid="gl-findings">
              <thead><tr className="border-b border-border bg-muted/30 text-muted-foreground">
                <th className="px-3 py-2 text-left">Contrôle</th><th className="text-left">Gravité</th><th className="text-left">Pièce</th><th className="text-left">Date</th>
                <th className="text-right">Montant</th><th className="text-left pl-3">Détail</th><th className="text-left">Examen</th>
              </tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Aucune anomalie sur la période.</td></tr>}
                {rows.map((f) => (
                  <tr key={`${f.check_code}-${f.entry_id}`} data-testid="gl-finding" className="border-b border-border/50">
                    <td className="px-3 py-2">{CHECK_LABELS[f.check_code] ?? f.check_code}</td>
                    <td><StatusBadge status={SEVERITY[f.severity]?.[0] ?? "info"} label={SEVERITY[f.severity]?.[1] ?? f.severity} /></td>
                    <td className="font-mono">{f.piece_number}</td><td className="tabular-nums">{f.entry_date}</td>
                    <td className="text-right tabular-nums">{fmt(f.amount)}</td><td className="pl-3 max-w-[28rem]">{f.detail}</td>
                    <td>{f.reviewed ? <span className="text-success" title={f.review_comment ?? ""}>Examinée</span>
                      : canReview ? <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => setOpen(f)}>Examiner</Button> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      {open && <ReviewDialog finding={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

function Concordance() {
  const [asOf, setAsOf] = useState(today());
  const q = useGlReconciliation(asOf);
  return (
    <section className="bg-card border border-border rounded-lg" aria-label="Concordance des livres">
      <div className="p-3 border-b border-border flex flex-wrap items-center gap-3">
        <label className="text-xs text-muted-foreground" htmlFor="recon-date">Arrêté au</label>
        <Input id="recon-date" type="date" className="h-8 w-40 text-xs" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        <p className="text-[11px] text-muted-foreground">Chaque livre auxiliaire doit égaler le solde de ses comptes collectifs (AUDCIF : concordance des livres). Tolérance et contrôles : paramètres du grand livre.</p>
      </div>
      {q.isLoading ? <div className="p-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div>
        : q.isError ? <div className="p-4 text-xs text-destructive" role="alert">{(q.error as Error).message}</div>
        : (
          <table className="w-full text-xs" data-testid="gl-reconciliation">
            <thead><tr className="border-b border-border bg-muted/30 text-muted-foreground">
              <th className="px-3 py-2 text-left">Livre</th><th className="text-right">Livre auxiliaire</th><th className="text-right">Grand livre</th>
              <th className="text-right">Écart</th><th className="text-left pl-3">État</th><th className="text-left">Explication</th>
            </tr></thead>
            <tbody>
              {(q.data ?? []).map((r, i) => (
                <tr key={`${r.area}-${i}`} data-testid="gl-recon-row" className="border-b border-border/50">
                  <td className="px-3 py-2">{r.label}</td>
                  <td className="text-right tabular-nums">{fmt(r.subledger)}</td><td className="text-right tabular-nums">{fmt(r.ledger)}</td>
                  <td className={cn("text-right tabular-nums", r.difference !== 0 && "text-destructive font-medium")}>{fmt(r.difference)}</td>
                  <td className="pl-3">{r.status === "pass" ? <StatusBadge status="success" label="Concordant" /> : <StatusBadge status="warning" label="Écart à justifier" />}</td>
                  <td className="text-muted-foreground max-w-[24rem]">{r.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </section>
  );
}

function Integrite() {
  const q = useGlIntegrity();
  return (
    <section className="bg-card border border-border rounded-lg" aria-label="Intégrité">
      <div className="p-3 border-b border-border flex items-center justify-between">
        <h3 className="text-sm font-semibold">Intégrité de la comptabilité (toute la société)</h3>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => q.refetch()} disabled={q.isFetching}>Relancer les contrôles</Button>
      </div>
      {q.isLoading ? <div className="p-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div>
        : q.isError ? <div className="p-4 text-xs text-destructive" role="alert">{(q.error as Error).message}</div>
        : (
          <ul className="divide-y divide-border" data-testid="gl-integrity">
            {(q.data ?? []).map((c) => (
              <li key={c.check_code} className="p-3 flex items-start gap-3 text-xs" data-testid="gl-integrity-check">
                <StatusBadge status={c.status === "pass" ? "success" : c.status === "fail" ? "error" : "warning"}
                  label={c.status === "pass" ? "Réussi" : c.status === "fail" ? `Échec (${c.issues})` : `À examiner (${c.issues})`} />
                <div><p className="font-medium">{c.label}</p><p className="text-muted-foreground">{c.detail}</p></div>
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}

function PisteAudit() {
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(today());
  const [search, setSearch] = useState("");
  const q = useGlAuditTrail(from, to);
  const rows = (q.data ?? []).filter((r) => `${r.action} ${r.user_name ?? ""} ${r.details ?? ""} ${r.piece_number ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  const ACTIONS: Record<string, string> = { Created: "Créée", Posted: "Comptabilisée", Reversed: "Contre-passée", Cancelled: "Annulée", Updated: "Modifiée", Approved: "Validée", Rejected: "Rejetée" };
  return (
    <section className="bg-card border border-border rounded-lg" aria-label="Piste d'audit">
      <div className="p-3 border-b border-border flex flex-wrap items-center gap-3">
        <Periode from={from} to={to} onFrom={setFrom} onTo={setTo} />
        <Input aria-label="Rechercher dans la piste d'audit" placeholder="Pièce, utilisateur, action…" className="h-8 w-56 text-xs" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="text-[11px] text-muted-foreground">Lecture seule : écrite par la base à chaque création, comptabilisation ou contre-passation.</span>
        <div className="ml-auto">
          <ExportButtons label="Exporter la piste d'audit" rows={rows.map((r) => ({ date: new Date(r.created_at).toLocaleString("fr-FR"), action: ACTIONS[r.action] ?? r.action,
            piece: r.piece_number ?? "", utilisateur: r.user_name ?? "", detail: r.details ?? "" }))}
            columns={[{ key: "date", header: "Date" }, { key: "action", header: "Action" }, { key: "piece", header: "Pièce" }, { key: "utilisateur", header: "Utilisateur" }, { key: "detail", header: "Détail" }]}
            filename={`piste-audit-${from}-${to}`} />
        </div>
      </div>
      {q.isLoading ? <div className="p-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div>
        : q.isError ? <div className="p-4 text-xs text-destructive" role="alert">{(q.error as Error).message}</div>
        : (
          <div className="overflow-x-auto max-h-[60vh]">
            <table className="w-full text-xs" data-testid="gl-audit-trail">
              <thead className="sticky top-0 bg-muted"><tr className="text-muted-foreground"><th className="px-3 py-2 text-left">Date</th><th className="text-left">Action</th><th className="text-left">Pièce</th><th className="text-left">Utilisateur</th><th className="text-left">Détail</th></tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Aucun événement sur la période.</td></tr>}
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-border/50"><td className="px-3 py-1.5 whitespace-nowrap">{new Date(r.created_at).toLocaleString("fr-FR")}</td>
                    <td>{ACTIONS[r.action] ?? r.action}</td><td className="font-mono">{r.piece_number ?? "—"}</td><td>{r.user_name ?? "—"}</td><td className="text-muted-foreground">{r.details}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </section>
  );
}

function Periodes() {
  const { data: periods = [], isLoading } = useGLPeriods();
  return (
    <section className="bg-card border border-border rounded-lg" aria-label="Périodes">
      <div className="p-3 border-b border-border flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Écritures par période</h3>
        <Button asChild size="sm" variant="outline" className="h-7 text-xs"><Link to="/settings?tab=fiscal">Clôturer ou rouvrir dans le calendrier fiscal</Link></Button>
      </div>
      {isLoading ? <div className="p-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div> : (
        <table className="w-full text-xs">
          <thead><tr className="border-b border-border bg-muted/30 text-muted-foreground">
            {["Période", "Statut", "Comptabilisées", "Brouillons", "Débit", "Crédit", "Équilibrée"].map((h) => <th key={h} className="px-3 py-2 text-left">{h}</th>)}
          </tr></thead>
          <tbody>
            {periods.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Aucune écriture comptable enregistrée.</td></tr>}
            {periods.map((p: any) => (
              <tr key={p.period} className="border-b border-border/50">
                <td className="px-3 py-2 font-mono">{p.period}</td>
                <td><StatusBadge status={p.status === "closed" ? "success" : "info"} label={p.status === "closed" ? "Clôturée" : "Ouverte"} /></td>
                <td className="tabular-nums">{p.posted_count}</td><td className={cn("tabular-nums", p.draft_count > 0 && "text-warning font-medium")}>{p.draft_count}</td>
                <td className="tabular-nums">{fmt(Number(p.total_debit))}</td><td className="tabular-nums">{fmt(Number(p.total_credit))}</td>
                <td>{Number(p.total_debit) === Number(p.total_credit) ? <span className="text-success">Oui</span> : <span className="text-destructive">Non</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

interface SimLine { account: string; debit: string; credit: string }
const num = (s: string) => Number(String(s).replace(/\s/g, "").replace(",", ".")) || 0;

function Simulateur() {
  const accounts = useGlAccountOptions();
  const options = (accounts.data ?? []).filter((a) => a.active);
  const [lines, setLines] = useState<SimLine[]>([{ account: "", debit: "", credit: "" }, { account: "", debit: "", credit: "" }]);
  const debit = lines.reduce((s, l) => s + num(l.debit), 0);
  const credit = lines.reduce((s, l) => s + num(l.credit), 0);
  const issues = useMemo(() => {
    const out: string[] = [];
    if (lines.some((l) => (num(l.debit) || num(l.credit)) && !l.account)) out.push("Une ligne chiffrée n'a pas de compte.");
    if (lines.some((l) => num(l.debit) && num(l.credit))) out.push("Une ligne ne porte pas à la fois un débit et un crédit.");
    if (debit !== credit) out.push(`Écart débit − crédit : ${fmt(debit - credit)}.`);
    if (debit === 0) out.push("Écriture sans montant.");
    return out;
  }, [lines, debit, credit]);
  const set = (i: number, k: keyof SimLine, v: string) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  return (
    <section className="bg-card border border-border rounded-lg p-4 space-y-3 max-w-3xl" aria-label="Simulateur d'écriture">
      <p className="text-xs text-muted-foreground">Tester une écriture avant de la saisir : comptes actifs du plan de la société, équilibre débit / crédit. Rien n'est enregistré.</p>
      <table className="w-full text-xs">
        <thead><tr className="text-muted-foreground"><th className="text-left">Compte</th><th className="text-right">Débit</th><th className="text-right">Crédit</th><th /></tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td className="py-1 pr-2"><select aria-label={`Compte ligne ${i + 1}`} className="h-8 w-full rounded border border-input bg-background px-1 text-xs" value={l.account} onChange={(e) => set(i, "account", e.target.value)}>
                <option value="">— compte —</option>{options.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}</select></td>
              <td className="pr-2"><Input aria-label={`Débit ligne ${i + 1}`} inputMode="decimal" className="h-8 text-xs text-right" value={l.debit} onChange={(e) => set(i, "debit", e.target.value)} /></td>
              <td className="pr-2"><Input aria-label={`Crédit ligne ${i + 1}`} inputMode="decimal" className="h-8 text-xs text-right" value={l.credit} onChange={(e) => set(i, "credit", e.target.value)} /></td>
              <td><Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Retirer la ligne ${i + 1}`} disabled={lines.length <= 2} onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="w-3.5 h-3.5" /></Button></td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr className="font-medium"><td className="pt-2">Total</td><td className="text-right tabular-nums pt-2">{fmt(debit)}</td><td className="text-right tabular-nums pt-2">{fmt(credit)}</td><td /></tr></tfoot>
      </table>
      <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setLines([...lines, { account: "", debit: "", credit: "" }])}><Plus className="w-3.5 h-3.5" /> Ajouter une ligne</Button>
      <div data-testid="simulation-result" className={cn("text-xs rounded-md p-2", issues.length ? "bg-warning/10 text-warning" : "bg-success/10 text-success")}>
        {issues.length ? issues.map((m) => <p key={m}>{m}</p>) : "Écriture équilibrée : elle peut être saisie dans Écritures (le contrôle analytique et la période ouverte sont vérifiés à la comptabilisation)."}
      </div>
    </section>
  );
}

export default function GLControl() {
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]["id"]>("anomalies");
  const { data: access } = useMyAccess();
  const canReview = (access?.permissions ?? []).includes("accounting.controls");
  const findings = useGlFindings(yearStart(), today());
  const integrity = useGlIntegrity();
  const recon = useGlReconciliation(today());
  const { data: periods = [] } = useGLPeriods();

  if (isApiEnabled()) {
    return (
      <PageShell>
        <Breadcrumb items={[{ label: "Comptabilité et finance" }, { label: "Grand livre", href: "/journal" }, { label: "Contrôle" }]} />
        <p className="text-sm text-muted-foreground mt-4">Sur site, les contrôles du grand livre arrivent avec la tranche comptable de l'API.</p>
      </PageShell>
    );
  }
  const open = (findings.data ?? []).filter((f) => !f.reviewed);
  const kpis = [
    { label: "Anomalies critiques", value: open.filter((f) => f.severity === "critical").length, icon: AlertTriangle, bad: true },
    { label: "Anomalies à examiner", value: open.filter((f) => f.severity !== "critical").length, icon: Eye, bad: false },
    { label: "Contrôles d'intégrité en défaut", value: (integrity.data ?? []).filter((c) => c.status !== "pass").length, icon: ShieldCheck, bad: true },
    { label: "Livres non concordants", value: (recon.data ?? []).filter((r) => r.status !== "pass").length, icon: Scale, bad: true },
    { label: "Périodes ouvertes", value: periods.filter((p: any) => p.status === "open").length, icon: Clock, bad: false },
  ];

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Comptabilité et finance" }, { label: "Grand livre", href: "/journal" }, { label: "Contrôle" }]} />
      <GuidanceBanner title="Contrôle du grand livre"
        description="Anomalies détectées sur les écritures, concordance des livres auxiliaires avec les comptes collectifs, intégrité, piste d'audit et périodes. Les seuils se règlent dans les paramètres du grand livre." />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-lg font-semibold">Grand livre — Contrôle</h1>
        <Button asChild size="sm" variant="outline" className="h-8 text-xs gap-1"><Link to="/journal/settings?tab=controls"><Settings2 className="w-3.5 h-3.5" /> Paramètres des contrôles</Link></Button>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3" data-testid="gl-control-kpis">
        {kpis.map((k) => (
          <div key={k.label} className="bg-card border border-border rounded-lg p-3 flex items-center gap-2.5">
            <k.icon className={cn("w-4 h-4", k.value > 0 && k.bad ? "text-destructive" : "text-primary")} />
            <div><div className="text-[10px] text-muted-foreground uppercase tracking-wider">{k.label}</div><div className="text-lg font-semibold">{k.value}</div></div>
          </div>
        ))}
      </div>
      <div className="flex gap-1 border-b border-border overflow-x-auto" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={activeTab === t.id} onClick={() => setActiveTab(t.id)}
            className={cn("flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 whitespace-nowrap",
              activeTab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
            <t.icon className="w-3.5 h-3.5" />{t.label}
          </button>
        ))}
      </div>
      {activeTab === "anomalies" && <Anomalies canReview={canReview} />}
      {activeTab === "reconciliation" && <Concordance />}
      {activeTab === "integrity" && <Integrite />}
      {activeTab === "audit" && <PisteAudit />}
      {activeTab === "periods" && <Periodes />}
      {activeTab === "simulation" && <Simulateur />}
      <p className="text-[11px] text-muted-foreground flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Contrôles calculés par la base sur les données de la société ; un écart se justifie, il ne se corrige pas en silence.</p>
    </PageShell>
  );
}
