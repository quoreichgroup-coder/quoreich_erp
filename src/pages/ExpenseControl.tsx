import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { ExportButtons } from "@/components/ExportButtons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { useExpenseReports } from "@/hooks/use-expenses";
import { EXPENSE_STATUS } from "@/lib/expenses";

/*
 * Notes de frais → Contrôle : approbations en retard sur leur délai cible, notes approuvées non encore
 * comptabilisées, comptabilisées non remboursées, rejets et annulations motivés, journal des décisions.
 */
const fmt = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 0 });
const hours = (d: string) => Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 3600000));
const days = (d: string | null) => (d ? Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 86400000)) : 0);

export default function ExpenseControl() {
  const { data: reports = [], isLoading } = useExpenseReports();
  const who = (r: (typeof reports)[number]) => (r.employee ? `${r.employee.first_name} ${r.employee.last_name}` : "—");
  const late = reports.filter((r) => r.status === "submitted").map((r) => ({ r, a: r.approvals.find((x) => x.status === "pending")! }))
    .filter(({ a }) => a && a.sla_hours != null && hours(a.created_at) > a.sla_hours);
  const notPosted = reports.filter((r) => r.status === "approved");
  const notPaid = reports.filter((r) => r.status === "posted");
  const decisions = reports.flatMap((r) => r.approvals.filter((a) => a.decided_at).map((a) => ({ r, a }))).sort((x, y) => (y.a.decided_at! > x.a.decided_at! ? 1 : -1));
  const motives = reports.filter((r) => r.rejection_reason || r.cancel_reason);
  const block = (title: string, testId: string, body: React.ReactNode) => (
    <Card className="border-border" data-testid={testId}><CardHeader className="p-4 pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader><CardContent className="p-0">{body}</CardContent></Card>
  );
  const simple = (list: typeof reports, since: (r: (typeof reports)[number]) => string | null, sinceLabel: string) => (
    <table className="w-full text-xs"><thead><tr className="bg-muted/30 text-muted-foreground"><th className="px-3 py-2 text-left">Note</th><th className="text-left">Salarié</th><th className="text-right">TTC</th><th className="text-right pr-3">{sinceLabel}</th></tr></thead>
      <tbody>{list.length === 0 ? <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">Rien à signaler.</td></tr>
        : list.map((r) => <tr key={r.id} className="border-t border-border/50"><td className="px-3 py-1.5 font-mono">{r.report_number}</td><td>{who(r)}</td><td className="text-right tabular-nums">{fmt(r.total)}</td><td className="text-right tabular-nums pr-3">{days(since(r))} j</td></tr>)}</tbody></table>
  );
  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Achats et fournisseurs" }, { label: "Notes de frais", href: "/expenses" }, { label: "Contrôle" }]} />
      <GuidanceBanner title="Contrôle des notes de frais" description="Retards d'approbation, notes en attente de comptabilisation ou de remboursement, motifs de rejet et d'annulation, journal des décisions." />
      <h1 className="text-lg font-semibold">Notes de frais — Contrôle</h1>
      {isLoading ? <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin" /></div> : (
        <div className="grid lg:grid-cols-2 gap-4">
          {block("Approbations au-delà du délai cible", "expense-late-approvals", (
            <table className="w-full text-xs"><thead><tr className="bg-muted/30 text-muted-foreground"><th className="px-3 py-2 text-left">Note</th><th className="text-left">Niveau</th><th className="text-right">Attente</th><th className="text-right pr-3">Délai cible</th></tr></thead>
              <tbody>{late.length === 0 ? <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">Aucun retard.</td></tr>
                : late.map(({ r, a }) => <tr key={r.id} className="border-t border-border/50"><td className="px-3 py-1.5 font-mono">{r.report_number}</td><td>{a.level_label}</td><td className="text-right tabular-nums text-destructive">{hours(a.created_at)} h</td><td className="text-right tabular-nums pr-3">{a.sla_hours} h</td></tr>)}</tbody></table>
          ))}
          {block("Approuvées, non comptabilisées", "expense-not-posted", simple(notPosted, (r) => r.approved_at, "Depuis"))}
          {block("Comptabilisées, non remboursées", "expense-not-paid", simple(notPaid, (r) => r.posted_at, "Depuis"))}
          {block("Rejets et annulations", "expense-motives", (
            <table className="w-full text-xs"><thead><tr className="bg-muted/30 text-muted-foreground"><th className="px-3 py-2 text-left">Note</th><th className="text-left">Statut</th><th className="text-left pr-3">Motif</th></tr></thead>
              <tbody>{motives.length === 0 ? <tr><td colSpan={3} className="p-4 text-center text-muted-foreground">Aucun.</td></tr>
                : motives.map((r) => <tr key={r.id} className="border-t border-border/50"><td className="px-3 py-1.5 font-mono">{r.report_number}</td>
                  <td><StatusBadge status={EXPENSE_STATUS[r.status][0]} label={EXPENSE_STATUS[r.status][1]} /></td><td className="pr-3">{r.cancel_reason ?? r.rejection_reason}</td></tr>)}</tbody></table>
          ))}
          <div className="lg:col-span-2">{block("Journal des décisions d'approbation", "expense-decisions", (
            <>
              <div className="p-2 flex justify-end"><ExportButtons label="Exporter le journal" rows={decisions.map(({ r, a }) => ({ date: new Date(a.decided_at!).toLocaleString("fr-FR"), note: r.report_number,
                niveau: a.level_label, decision: a.status === "approved" ? "Approuvé" : "Rejeté", commentaire: a.comment ?? "" }))}
                columns={[{ key: "date", header: "Date" }, { key: "note", header: "Note" }, { key: "niveau", header: "Niveau" }, { key: "decision", header: "Décision" }, { key: "commentaire", header: "Commentaire" }]}
                filename="decisions-notes-de-frais" /></div>
              <table className="w-full text-xs"><thead><tr className="bg-muted/30 text-muted-foreground"><th className="px-3 py-2 text-left">Date</th><th className="text-left">Note</th><th className="text-left">Niveau</th><th className="text-left">Décision</th><th className="text-left pr-3">Commentaire</th></tr></thead>
                <tbody>{decisions.length === 0 ? <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">Aucune décision.</td></tr>
                  : decisions.map(({ r, a }) => <tr key={a.id} className="border-t border-border/50"><td className="px-3 py-1.5">{new Date(a.decided_at!).toLocaleString("fr-FR")}</td><td className="font-mono">{r.report_number}</td>
                    <td>{a.level_label}</td><td>{a.status === "approved" ? "Approuvé" : "Rejeté"}</td><td className="pr-3">{a.comment}</td></tr>)}</tbody></table>
            </>
          ))}</div>
        </div>
      )}
    </PageShell>
  );
}
