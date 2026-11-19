import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { StatusBadge } from "@/components/StatusBadge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantId } from "@/hooks/use-tenant";
import { useMyAccess } from "@/hooks/use-my-access";
import { useChartMappings } from "@/hooks/use-chart-mappings";
import { useImportSettings, useSaveImportSettings } from "@/hooks/use-chart-import";
import { ExportButtons } from "@/components/ExportButtons";
import { cn } from "@/lib/utils";
import { apiGet, apiPost, isApiEnabled } from "@/api/client";

/*
 * Migration du plan opérationnel (V67, lot PC-6) : à partir d'une correspondance validée, simulation
 * obligatoire (rien n'est écrit), puis application par une autre personne : comptes créés, une OD de
 * reclassement datée, rôles redirigés, anciens comptes conservés et reliés, référentiel mis à jour.
 */
type PlanRow = {
  source_code?: string; source_name?: string; target_code?: string; target_name?: string; ratio?: number; action?: "same" | "create" | "reuse";
  balance?: number; moved?: number; roles?: string | null; problem?: string | null;
};
type Migration = {
  id: string; mapping_id: string; migration_date: string; reason: string; status: "simulated" | "applied" | "cancelled"; plan: PlanRow[]; blocking: number;
  entry_id: string | null; simulated_by: string; simulated_at: string; applied_by: string | null; applied_at: string | null;
};
const ACTION: Record<string, string> = { same: "Inchangé (même code)", create: "Compte créé", reuse: "Compte existant" };
const STATUS: Record<string, [string, string]> = { simulated: ["warning", "Simulée"], applied: ["success", "Appliquée"], cancelled: ["neutral", "Annulée"] };
const fmt = (n: number | undefined) => Number(n || 0).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const db = supabase as any;
const KEYS = ["chart-migrations", "gl-accounts", "gl-accounts-full", "chart-issues", "journal-entries", "accounting-setup", "operational-chart"];

function useMigrations() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["chart-migrations", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      if (isApiEnabled()) return apiGet<Migration[]>("/api/v1/gl/charts/migrations");
      const { data, error } = await db.from("chart_migrations").select("*").eq("tenant_id", tenantId).order("simulated_at", { ascending: false }).limit(30);
      if (error) throw error;
      return (data ?? []) as Migration[];
    },
  });
}
function useRpc<V>(name: string, args: (v: V) => Record<string, unknown>, ok: (d: any) => string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: V) => {
      if (isApiEnabled()) return apiPost<any>(`/api/v1/gl/charts/actions/${name}`, args(v));
      const { data, error } = await db.rpc(name, args(v)); if (error) throw error; return data;
    },
    onSuccess: (d) => { for (const k of KEYS) qc.invalidateQueries({ queryKey: [k] }); toast.success(ok(d)); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function ChartMigration() {
  const { user } = useAuth();
  const { data: access } = useMyAccess();
  const perms = access?.permissions ?? [];
  const canMigrate = perms.includes("accounting.reclassify");
  const canAdmin = perms.includes("accounting.chart_admin");
  const { data: mappings = [] } = useChartMappings();
  const validated = mappings.filter((m) => m.status === "validated");
  const { data: migrations = [] } = useMigrations();
  const { data: settings } = useImportSettings();
  const saveSettings = useSaveImportSettings();
  const [f, setF] = useState({ mapping: "", date: new Date().toISOString().slice(0, 10), reason: "" });
  const [selected, setSelected] = useState<string | null>(null);
  const simulate = useRpc("simulate_chart_migration", (v: typeof f) => ({ _mapping: v.mapping, _date: v.date, _reason: v.reason }), () => "Simulation enregistrée : rien n'a été modifié");
  const apply = useRpc("apply_chart_migration", (id: string) => ({ _migration: id }), (d) => `Migration appliquée : ${d?.comptes_remplaces ?? 0} compte(s) remplacé(s), ${d?.roles_rediriges ?? 0} rôle(s) redirigé(s)`);
  const cancel = useRpc("cancel_chart_migration", (id: string) => ({ _migration: id }), () => "Simulation annulée");
  const current = migrations.find((m) => m.id === selected) ?? migrations.find((m) => m.status === "simulated") ?? null;
  const strict = settings?.migration_second_person ?? true;

  if (!canMigrate) return <p className="text-xs text-muted-foreground">Accès réservé : droit « Migrer le plan comptable et reclasser les soldes ».</p>;
  return (
    <div className="space-y-3">
      {settings && (
        <section aria-label="Paramètres de migration" className="bg-card border border-border rounded-lg p-3 text-xs">
          <label className="flex items-center gap-2"><Switch aria-label="Migration appliquée par une autre personne" checked={strict} disabled={!canAdmin || saveSettings.isPending}
            onCheckedChange={(v) => saveSettings.mutate({ ...settings, migration_second_person: v })} />La migration est appliquée par une autre personne que celle qui l'a simulée</label>
        </section>
      )}
      <section aria-label="Nouvelle simulation" className="card-elevated p-4 space-y-2">
        <h2 className="text-sm font-semibold">Simuler une migration</h2>
        <p className="text-[11px] text-muted-foreground">À partir d'une correspondance validée. La simulation calcule les comptes à créer, les soldes à reclasser à la date et les rôles d'imputation à rediriger, sans rien modifier. Aucune écriture passée n'est jamais modifiée.</p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><Label className="text-xs" htmlFor="mig-mapping">Correspondance validée</Label>
            <select id="mig-mapping" className="h-8 rounded-md border border-input bg-background px-2 text-xs w-64" value={f.mapping} onChange={(e) => setF({ ...f, mapping: e.target.value })}>
              <option value="">— choisir —</option>
              {validated.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select></div>
          <div className="space-y-1"><Label className="text-xs" htmlFor="mig-date">Date de migration</Label>
            <Input id="mig-date" type="date" className="h-8 text-xs w-40" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs" htmlFor="mig-reason">Motif</Label>
            <Input id="mig-reason" className="h-8 text-xs w-64" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></div>
          <Button size="sm" className="h-8 text-xs" disabled={!f.mapping || !f.date || !f.reason.trim() || simulate.isPending}
            onClick={() => simulate.mutate(f, { onSuccess: (id) => setSelected(String(id)) })}>Simuler la migration</Button>
        </div>
        {validated.length === 0 && <p className="text-[11px] text-muted-foreground">Aucune correspondance validée : onglet « Correspondances ».</p>}
      </section>

      {current && (
        <section aria-label="Simulation" className="card-elevated p-4 space-y-2">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <h2 className="text-sm font-semibold">{mappings.find((m) => m.id === current.mapping_id)?.name ?? "Migration"} — au {new Date(current.migration_date).toLocaleDateString("fr-FR")}</h2>
              <p className="text-xs text-muted-foreground" data-testid="migration-summary">
                <StatusBadge status={STATUS[current.status][0]} label={STATUS[current.status][1]} /> {current.reason} · {current.plan.filter((p) => p.action === "create").length} compte(s) à créer ·
                {" "}{new Set(current.plan.filter((p) => p.action !== "same" && p.source_code).map((p) => p.source_code)).size} compte(s) remplacé(s) · {current.blocking} anomalie(s) bloquante(s)
              </p>
              {current.status === "simulated" && strict && current.simulated_by === user?.id && <p className="text-[11px] text-muted-foreground">Vous avez simulé cette migration : une autre personne doit l'appliquer.</p>}
            </div>
            <div className="flex gap-2 flex-wrap">
              <ExportButtons label="Exporter la simulation" filename="simulation-migration-plan" sheetName="Simulation"
                rows={current.plan.map((p) => ({ source: p.source_code ?? "", sourceName: p.source_name ?? "", cible: p.target_code ?? "", cibleName: p.target_name ?? "",
                  action: p.action ? ACTION[p.action] : "", cle: p.ratio != null ? Number(p.ratio) : "", solde: p.balance != null ? Number(p.balance) : "",
                  reclasse: p.moved != null ? Number(p.moved) : "", roles: p.roles ?? "", probleme: p.problem ?? "" }))}
                columns={[{ key: "source", header: "Compte source", width: 14 }, { key: "sourceName", header: "Intitulé source", width: 36 }, { key: "cible", header: "Compte cible", width: 14 },
                  { key: "cibleName", header: "Intitulé cible", width: 36 }, { key: "action", header: "Action", width: 22 }, { key: "cle", header: "Clé (%)", width: 10 },
                  { key: "solde", header: "Solde à la date", width: 16 }, { key: "reclasse", header: "Montant reclassé", width: 16 }, { key: "roles", header: "Rôles redirigés", width: 24 },
                  { key: "probleme", header: "Anomalie", width: 40 }]} />
              {current.status === "simulated" && <Button size="sm" variant="outline" className="h-8 text-xs" disabled={cancel.isPending} onClick={() => cancel.mutate(current.id)}>Annuler la simulation</Button>}
              {current.status === "simulated" && <Button size="sm" className="h-8 text-xs" disabled={current.blocking > 0 || (strict && current.simulated_by === user?.id) || apply.isPending}
                onClick={() => apply.mutate(current.id)}>Appliquer la migration</Button>}
            </div>
          </div>
          <div className="overflow-x-auto max-h-[28rem] overflow-y-auto rounded-md border border-border">
            <table className="w-full text-xs" data-testid="migration-plan">
              <thead className="sticky top-0 bg-card"><tr className="text-muted-foreground border-b border-border">
                <th className="text-left p-2">Compte source</th><th className="text-left">Compte cible</th><th className="text-left">Action</th><th className="text-right">Clé</th>
                <th className="text-right">Solde</th><th className="text-right">Reclassé</th><th className="text-left pl-2">Rôles</th><th className="text-left">Anomalie</th>
              </tr></thead>
              <tbody>{current.plan.map((p, i) => (
                <tr key={i} data-testid="migration-plan-row" className="border-b border-border/50">
                  <td className="p-2"><span className="font-mono">{p.source_code}</span> {p.source_name}</td><td><span className="font-mono">{p.target_code}</span> {p.target_name}</td>
                  <td>{p.action ? ACTION[p.action] : ""}</td><td className="text-right tabular-nums">{p.ratio != null ? `${fmt(p.ratio)} %` : ""}</td>
                  <td className="text-right tabular-nums">{p.balance != null ? fmt(p.balance) : ""}</td><td className="text-right tabular-nums">{p.moved != null ? fmt(p.moved) : ""}</td>
                  <td className="pl-2">{p.roles ?? ""}</td><td className={cn(p.problem && "text-destructive")}>{p.problem ?? ""}</td>
                </tr>))}</tbody>
            </table>
          </div>
        </section>
      )}

      {migrations.length > 0 && (
        <section aria-label="Historique des migrations" className="card-elevated overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="bg-muted/30 text-muted-foreground"><th className="text-left p-2">Simulée le</th><th className="text-left">Date de migration</th><th className="text-left">Motif</th><th className="text-left">État</th></tr></thead>
            <tbody>{migrations.map((m) => (
              <tr key={m.id} data-testid="migration-row" onClick={() => setSelected(m.id)} className={cn("border-t border-border/50 cursor-pointer hover:bg-muted/30", current?.id === m.id && "bg-primary/5")}>
                <td className="p-2">{new Date(m.simulated_at).toLocaleString("fr-FR")}</td><td>{new Date(m.migration_date).toLocaleDateString("fr-FR")}</td><td>{m.reason}</td>
                <td><StatusBadge status={STATUS[m.status][0]} label={STATUS[m.status][1]} /></td>
              </tr>))}</tbody>
          </table>
        </section>
      )}
    </div>
  );
}
