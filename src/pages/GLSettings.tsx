import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BookOpen, Calendar, FileText, Globe, Landmark, Loader2, ShieldCheck } from "lucide-react";
import { ModulePostingSettings } from "@/components/AccountSets";
import { FiscalCalendarPanel } from "@/components/FiscalCalendarPanel";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/use-tenant";
import { useMyAccess } from "@/hooks/use-my-access";
import { DISABLEABLE_CHECKS, useGlControlSettings, useSaveGlControlSettings, type GlControlSettings } from "@/hooks/use-gl-controls";
import { cn } from "@/lib/utils";

/*
 * Paramètres du grand livre : comptabilisation (rôles et jeux de comptes), contrôles (V106), journaux et
 * numérotation des pièces (V38, lecture : la base numérote sans trou par journal et par année),
 * calendrier fiscal (V33) et devise fonctionnelle de la société. Aucune valeur de démonstration.
 */
const tabs = [
  { id: "posting", label: "Comptabilisation", icon: Landmark },
  { id: "controls", label: "Contrôles", icon: ShieldCheck },
  { id: "journals", label: "Journaux et numérotation", icon: BookOpen },
  { id: "fiscal", label: "Calendrier fiscal", icon: Calendar },
  { id: "currency", label: "Devise", icon: Globe },
] as const;
type Tab = (typeof tabs)[number]["id"];
const db = supabase as any;

function ControlsSettings() {
  const q = useGlControlSettings();
  const save = useSaveGlControlSettings();
  const { data: access } = useMyAccess();
  const can = (access?.permissions ?? []).includes("accounting.controls");
  const [f, setF] = useState<GlControlSettings | null>(null);
  useEffect(() => { if (q.data && !f) setF(q.data); }, [q.data, f]);
  if (q.isLoading || !f) return <div className="p-6"><Loader2 className="w-4 h-4 animate-spin" /></div>;
  const n = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));
  const toggle = (code: string) => setF({ ...f, disabled_checks: f.disabled_checks.includes(code) ? f.disabled_checks.filter((c) => c !== code) : [...f.disabled_checks, code] });
  return (
    <section className="bg-card border border-border rounded-lg p-5 space-y-4 max-w-3xl" data-testid="gl-control-settings">
      <h3 className="text-sm font-semibold">Contrôles du grand livre</h3>
      <p className="text-xs text-muted-foreground">Aucun seuil n'est imposé : un champ vide désactive le contrôle correspondant. Les écritures déséquilibrées ou sans ligne sont toujours signalées.</p>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-1"><label htmlFor="ctl-large" className="text-xs font-medium">Signaler les écritures à partir de (montant)</label>
          <Input id="ctl-large" inputMode="decimal" className="h-8 text-xs" disabled={!can} value={f.large_entry_threshold ?? ""} placeholder="vide = désactivé"
            onChange={(e) => setF({ ...f, large_entry_threshold: n(e.target.value) })} /></div>
        <div className="space-y-1"><label htmlFor="ctl-dup" className="text-xs font-medium">Fenêtre de recherche des doublons (jours)</label>
          <Input id="ctl-dup" type="number" min={0} max={60} className="h-8 text-xs" disabled={!can} value={f.duplicate_window_days}
            onChange={(e) => setF({ ...f, duplicate_window_days: Number(e.target.value || 0) })} /></div>
        <div className="space-y-1"><label htmlFor="ctl-back" className="text-xs font-medium">Écart maximal date de pièce → comptabilisation (jours)</label>
          <Input id="ctl-back" type="number" min={1} max={366} className="h-8 text-xs" disabled={!can} value={f.backdating_days ?? ""} placeholder="vide = désactivé"
            onChange={(e) => setF({ ...f, backdating_days: n(e.target.value) })} /></div>
        <div className="space-y-1"><label htmlFor="ctl-tol" className="text-xs font-medium">Tolérance de concordance des livres (montant)</label>
          <Input id="ctl-tol" inputMode="decimal" className="h-8 text-xs" disabled={!can} value={f.subledger_tolerance}
            onChange={(e) => setF({ ...f, subledger_tolerance: n(e.target.value) ?? 0 })} /></div>
      </div>
      <fieldset className="space-y-1">
        <legend className="text-xs font-medium mb-1">Contrôles actifs</legend>
        <div className="grid sm:grid-cols-2 gap-1">
          {DISABLEABLE_CHECKS.map(([code, label]) => (
            <label key={code} className="flex items-center gap-2 text-xs"><input type="checkbox" disabled={!can} checked={!f.disabled_checks.includes(code)} onChange={() => toggle(code)} /> {label}</label>
          ))}
        </div>
      </fieldset>
      {can ? <Button size="sm" className="text-xs" disabled={save.isPending} onClick={() => save.mutate(f)}>Enregistrer</Button>
        : <p className="text-[11px] text-muted-foreground">Modification réservée au droit « accounting.controls ».</p>}
    </section>
  );
}

function JournalsAndNumbering() {
  const { data: tenantId } = useTenantId();
  const q = useQuery({
    queryKey: ["gl-journals-numbering", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async () => {
      const [j, c] = await Promise.all([
        db.from("accounting_journals").select("code, label, sort_order").order("sort_order"),
        db.from("journal_piece_counters").select("journal_code, year, last_value").eq("tenant_id", tenantId).order("year", { ascending: false }),
      ]);
      if (j.error) throw j.error;
      if (c.error) throw c.error;
      return { journals: (j.data ?? []) as { code: string; label: string }[], counters: (c.data ?? []) as { journal_code: string; year: number; last_value: number }[] };
    },
  });
  if (q.isLoading) return <div className="p-6"><Loader2 className="w-4 h-4 animate-spin" /></div>;
  if (q.isError) return <p className="text-xs text-destructive" role="alert">{(q.error as Error).message}</p>;
  const year = new Date().getFullYear();
  return (
    <section className="bg-card border border-border rounded-lg max-w-3xl" data-testid="gl-journals">
      <div className="p-3 border-b border-border">
        <h3 className="text-sm font-semibold">Journaux et numérotation des pièces</h3>
        <p className="text-xs text-muted-foreground">Journaux auxiliaires SYSCOHADA. Chaque écriture reçoit son journal d'après son origine et un numéro de pièce continu par journal et par année (format JOURNAL-AAAA-NNNNNN), attribué par la base : il ne se saisit pas.</p>
      </div>
      <table className="w-full text-xs">
        <thead><tr className="bg-muted/30 text-muted-foreground"><th className="px-3 py-2 text-left">Code</th><th className="text-left">Journal</th><th className="text-right">Dernière pièce {year}</th><th className="text-left pl-3">Prochaine pièce</th></tr></thead>
        <tbody>
          {q.data!.journals.map((j) => {
            const c = q.data!.counters.find((x) => x.journal_code === j.code && x.year === year);
            const next = (c?.last_value ?? 0) + 1;
            return (
              <tr key={j.code} className="border-t border-border/50"><td className="px-3 py-2 font-mono">{j.code}</td><td>{j.label}</td>
                <td className="text-right tabular-nums">{c ? `${j.code}-${year}-${String(c.last_value).padStart(6, "0")}` : "—"}</td>
                <td className="pl-3 font-mono">{`${j.code}-${year}-${String(next).padStart(6, "0")}`}</td></tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function Currency() {
  const { data: tenantId } = useTenantId();
  const q = useQuery({
    queryKey: ["tenant-currency", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async () => {
      const { data, error } = await db.from("tenants").select("currency").eq("id", tenantId).single();
      if (error) throw error;
      return (data?.currency as string) ?? null;
    },
  });
  return (
    <section className="bg-card border border-border rounded-lg p-5 space-y-2 max-w-2xl" data-testid="gl-currency">
      <h3 className="text-sm font-semibold">Devise fonctionnelle</h3>
      <p className="text-sm"><span className="font-mono font-semibold">{q.data ?? "—"}</span> : devise de tenue de la comptabilité de la société.</p>
      <p className="text-xs text-muted-foreground">Les pièces en devise étrangère et les cours (BCEAO) arrivent avec le lot des achats internationaux ; aucun cours n'est fixé aujourd'hui.</p>
    </section>
  );
}

export default function GLSettings() {
  const [params, setParams] = useSearchParams();
  const asked = params.get("tab") as Tab | null;
  const activeTab: Tab = asked && tabs.some((t) => t.id === asked) ? asked : "posting";
  const setTab = (t: Tab) => setParams((p) => { p.set("tab", t); return p; }, { replace: true });

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Comptabilité et finance" }, { label: "Grand livre", href: "/journal" }, { label: "Paramètres" }]} />
      <GuidanceBanner title="Paramètres du grand livre" description="Comptabilisation par rôle et par jeu de comptes, contrôles, journaux et numérotation, calendrier fiscal et devise de la société." />
      <div className="flex gap-1 border-b border-border overflow-x-auto" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={activeTab === t.id} onClick={() => setTab(t.id)}
            className={cn("flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 whitespace-nowrap",
              activeTab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
            <t.icon className="w-3.5 h-3.5" />{t.label}
          </button>
        ))}
      </div>
      {activeTab === "posting" && <ModulePostingSettings kinds={["customer", "supplier", "item"]} lock />}
      {activeTab === "controls" && <ControlsSettings />}
      {activeTab === "journals" && <JournalsAndNumbering />}
      {activeTab === "fiscal" && <div className="max-w-5xl"><FiscalCalendarPanel /></div>}
      {activeTab === "currency" && <Currency />}
      <p className="text-[11px] text-muted-foreground flex items-center gap-1"><FileText className="w-3 h-3" /> Ces réglages valent pour toute la société.</p>
    </PageShell>
  );
}
