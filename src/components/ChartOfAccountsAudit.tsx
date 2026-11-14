import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/StatusBadge";
import { supabase } from "@/integrations/supabase/client";
import { useMyAccess } from "@/hooks/use-my-access";
import { exportToCSV } from "@/lib/csv-export";
import { effectiveFramework, useCodePattern, useFrameworks, useOperationalChart } from "@/hooks/use-chart-frameworks";

/*
 * Contrôle du plan comptable (V60, générique depuis V64) : anomalies calculées par la base contre le
 * référentiel du plan opérationnel, selon les règles de qualité activées pour la société (code hors plan,
 * classe / type, intitulé, doublon, parent, imputation automatique) et corrections non destructives :
 * remplacer par le compte du référentiel (l'ancien reste, désactivé, relié ; imputations redirigées),
 * reclasser le solde par une écriture OD nouvelle, créer les regroupements, rattacher les sous-comptes.
 */
type Issue = {
  account_id: string; code: string; name: string; severity: "error" | "warning" | "info"; issue: string; detail: string;
  suggested_code: string | null; suggested_name: string | null; suggested_type: string | null; lines: number;
};
const SEV: Record<string, [string, string]> = { error: ["error", "Erreur"], warning: ["warning", "À revoir"], info: ["neutral", "Information"] };
const TYPES: [string, string][] = [["asset", "Actif"], ["liability", "Passif"], ["equity", "Capitaux propres"], ["revenue", "Produits"], ["expense", "Charges"]];
const KEYS = ["chart-issues", "gl-accounts-full", "gl-accounts", "accounting-setup", "journal-entries"];

export function ChartOfAccountsAudit() {
  const qc = useQueryClient();
  const { data: access } = useMyAccess();
  const canFix = (access?.permissions ?? []).includes("accounting.chart");
  const { data: chart } = useOperationalChart();
  const { data: fw } = useFrameworks();
  const framework = fw?.frameworks.find((f) => f.code === effectiveFramework(chart));
  const label = framework?.short_label ?? framework?.name ?? "du référentiel";
  const codePattern = useCodePattern();
  const codeOk = (c: string) => c.length > 0 && (!codePattern || codePattern.test(c));
  const { data: issues = [], isLoading } = useQuery({
    queryKey: ["chart-issues"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("chart_of_accounts_issues");
      if (error) throw error;
      return (data ?? []) as Issue[];
    },
  });
  const run = useMutation({
    mutationFn: async ({ fn, args }: { fn: string; args?: Record<string, unknown>; ok: string }) => {
      const { data, error } = await (supabase as any).rpc(fn, args ?? {});
      if (error) throw error;
      return data;
    },
    onSuccess: (data, v) => { for (const k of KEYS) qc.invalidateQueries({ queryKey: [k] }); toast.success(typeof data === "number" ? `${v.ok} : ${data}` : v.ok); },
    onError: (e: Error) => toast.error(e.message),
  });
  const [replace, setReplace] = useState<Issue | null>(null);
  const [form, setForm] = useState({ code: "", name: "", type: "asset" });
  const [reclass, setReclass] = useState<Issue | null>(null);
  const [reason, setReason] = useState("");
  const open = (i: Issue) => { setReplace(i); setForm({ code: i.suggested_code ?? "", name: i.suggested_name ?? i.name, type: i.suggested_type ?? "asset" }); };
  const count = (s: string) => issues.filter((i) => i.severity === s).length;

  return (
    <section aria-label="Contrôle du plan comptable" className="card-elevated p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold">Contrôle {label} du plan comptable</h2>
          <p className="text-xs text-muted-foreground" data-testid="chart-issues-summary">
            {isLoading ? "Analyse…" : issues.length === 0 ? "Aucune anomalie : plan conforme au référentiel."
              : `${count("error")} erreur(s), ${count("warning")} point(s) à revoir, ${count("info")} information(s)`}
          </p>
          <p className="text-[11px] text-muted-foreground">Référentiel {framework ? `${framework.name}${chart?.framework_version ? ` (version ${chart.framework_version})` : ""}` : "…"}{framework && !framework.is_validated ? ", à valider par l'expert-comptable" : ""}. Règles : Grand livre → Plans et référentiels. Aucun compte n'est supprimé ; aucune écriture passée n'est modifiée.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {canFix && <Button size="sm" variant="outline" className="h-8 text-xs" disabled={run.isPending}
            onClick={() => run.mutate({ fn: "create_syscohada_headings", ok: "Comptes de regroupement créés" })}>Créer les comptes de regroupement</Button>}
          {canFix && <Button size="sm" variant="outline" className="h-8 text-xs" disabled={run.isPending}
            onClick={() => run.mutate({ fn: "link_gl_account_parents", ok: "Sous-comptes rattachés" })}>Rattacher les sous-comptes</Button>}
          <Button size="sm" variant="outline" className="h-8 text-xs" disabled={issues.length === 0} onClick={() => exportToCSV(issues.map((i) => ({
            code: i.code, intitule: i.name, gravite: SEV[i.severity]?.[1] ?? i.severity, anomalie: i.issue, detail: i.detail,
            proposition: i.suggested_code ? `${i.suggested_code} ${i.suggested_name ?? ""}` : "", lignes: i.lines,
          })), [{ key: "code", header: "Compte" }, { key: "intitule", header: "Intitulé" }, { key: "gravite", header: "Gravité" },
            { key: "anomalie", header: "Anomalie" }, { key: "detail", header: "Détail" }, { key: "proposition", header: "Correction proposée" },
            { key: "lignes", header: "Lignes d'écriture" }], "controle-plan-comptable")}>Exporter</Button>
        </div>
      </div>
      {issues.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border max-h-96 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-card"><tr className="text-muted-foreground border-b border-border">
              <th className="text-left p-2">Compte</th><th className="text-left">Gravité</th><th className="text-left">Anomalie</th>
              <th className="text-left">Correction proposée</th><th className="text-right">Lignes</th><th />
            </tr></thead>
            <tbody>
              {issues.map((i, n) => (
                <tr key={`${i.account_id}-${i.issue}-${n}`} data-testid="chart-issue-row" className="border-b border-border/50 align-top">
                  <td className="p-2"><span className="font-mono">{i.code}</span> {i.name}</td>
                  <td><StatusBadge status={SEV[i.severity]?.[0] ?? "neutral"} label={SEV[i.severity]?.[1] ?? i.severity} /></td>
                  <td><p className="font-medium">{i.issue}</p><p className="text-muted-foreground">{i.detail}</p></td>
                  <td>{i.suggested_code ? <><span className="font-mono">{i.suggested_code}</span> {i.suggested_name}</> : "—"}</td>
                  <td className="text-right tabular-nums">{i.lines}</td>
                  <td className="whitespace-nowrap pl-2">{canFix && i.suggested_code && (
                    <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => open(i)}>Remplacer</Button>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {replace && (
        <Dialog open onOpenChange={(o) => { if (!o) setReplace(null); }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-sm">Remplacer le compte {replace.code} « {replace.name} »</DialogTitle>
              <DialogDescription className="text-xs">
                Le compte du référentiel est créé (ou repris s'il existe), les imputations automatiques y sont redirigées, et l'ancien compte est
                conservé, désactivé et relié à son remplaçant. {replace.lines > 0 ? `Il porte ${replace.lines} ligne(s) d'écriture : leur solde pourra être reclassé ensuite par une écriture OD.` : "Il n'a aucune écriture."}
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5"><Label className="text-xs" htmlFor="repl-code">Code {label}</Label>
                <Input id="repl-code" className="h-8 text-xs font-mono" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.trim() })} /></div>
              <div className="col-span-2 space-y-1.5"><Label className="text-xs" htmlFor="repl-name">Intitulé</Label>
                <Input id="repl-name" className="h-8 text-xs" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div className="col-span-3 space-y-1.5"><Label className="text-xs" htmlFor="repl-type">Type</Label>
                <select id="repl-type" className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select></div>
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setReplace(null)}>Annuler</Button>
              <Button size="sm" disabled={!codeOk(form.code) || run.isPending}
                onClick={() => run.mutate({ fn: "replace_gl_account", args: { _account_id: replace.account_id, _new_code: form.code, _new_name: form.name, _new_type: form.type },
                  ok: `Compte ${replace.code} remplacé par ${form.code}` }, { onSuccess: () => { const i = replace; setReplace(null); if (i.lines > 0) { setReclass(i); setReason(`Mise en conformité ${label}`); } } })}>
                Remplacer
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {reclass && (
        <Dialog open onOpenChange={(o) => { if (!o) setReclass(null); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-sm">Reclasser le solde du compte {reclass.code}</DialogTitle>
              <DialogDescription className="text-xs">Écriture OD nouvelle, datée du jour, qui solde l'ancien compte vers son remplaçant. Les écritures passées restent inchangées.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5"><Label className="text-xs" htmlFor="recl-reason">Motif (obligatoire)</Label>
              <Input id="recl-reason" className="h-8 text-xs" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setReclass(null)}>Plus tard</Button>
              <Button size="sm" disabled={!reason.trim() || run.isPending}
                onClick={() => run.mutate({ fn: "reclassify_gl_account_balance", args: { _account_id: reclass.account_id, _entry_date: new Date().toISOString().slice(0, 10), _reason: reason.trim() },
                  ok: "Solde reclassé (écriture OD)" }, { onSuccess: () => setReclass(null) })}>Reclasser</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
