import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ExportButtons } from "@/components/ExportButtons";
import { useGLAccounts } from "@/hooks/use-gl-data";
import { useAnalyticsSetup } from "@/hooks/use-analytics-setup";
import { DEFAULT_BUDGET_SETTINGS, useBudgetControlSettings, type BudgetStatusRow } from "@/hooks/use-budget-control";
import {
  useBudgetForecastLines, useBudgetForecasts, useCreateBudgetForecast, useDeleteBudgetForecast, useDeleteBudgetForecastLine,
  useImportBudgetForecast, usePublishBudgetForecast, useSaveBudgetForecastLine, type BudgetForecastLine,
} from "@/hooks/use-budget-forecasts";
import type { ForecastRow } from "@/lib/budget-forecast";
import { budgetImportRows } from "@/lib/budget-import";
import { exportToXLSX } from "@/lib/xlsx";
import { readTableFile, TABLE_FILE_ACCEPT } from "@/lib/table-file";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

/*
 * Prévisions saisies (V78) : versions par exercice, établies à partir de l'atterrissage calculé, du budget de
 * contrôle, d'une version précédente ou d'un fichier ; montants modifiables tant que la version est en brouillon,
 * figée une fois publiée. Comparées au budget et à l'atterrissage calculé.
 */
const fmt = (n: number) => Number(n || 0).toLocaleString("fr-FR", { maximumFractionDigits: 0 });
const keyOf = (account: string, section: string | null) => `${account}|${section ?? ""}`;
type Init = "calculated" | "budget" | "empty" | string;

export function BudgetForecastVersions({ year, status, forecast, canForecast, canExport, ready = true }: {
  year: string; status: BudgetStatusRow[]; forecast: ForecastRow[]; canForecast: boolean; canExport: boolean;
  /** Chiffres de l'exercice chargés : sans eux, une version « atterrissage » ou « budget » naîtrait vide. */
  ready?: boolean;
}) {
  const { data: versions = [] } = useBudgetForecasts(year);
  const [picked, setPicked] = useState<string | null>(null);
  const current = versions.find((v) => v.id === picked) ?? versions[0] ?? null;
  const { data: lines = [] } = useBudgetForecastLines(current?.id ?? null);
  const glQuery = useGLAccounts();
  const gl = glQuery.data ?? [];
  const { data: setup } = useAnalyticsSetup();
  const accById = useMemo(() => new Map((gl as any[]).map((g) => [g.id, g])), [gl]);
  const accByCode = useMemo(() => new Map((gl as any[]).map((g) => [g.code, g])), [gl]);
  const values = useMemo(() => (setup?.axes ?? []).flatMap((a) => a.values.map((v) => ({ ...v, axisCode: a.code }))), [setup]);
  const sectionCode = useMemo(() => {
    const n = new Map<string, number>();
    for (const v of values) n.set(v.code.toUpperCase(), (n.get(v.code.toUpperCase()) ?? 0) + 1);
    return new Map(values.map((v) => [v.id, (n.get(v.code.toUpperCase()) ?? 0) > 1 ? `${v.axisCode}/${v.code}` : v.code]));
  }, [values]);
  const sectionName = useMemo(() => new Map(values.map((v) => [v.id, `${v.code} ${v.name}`])), [values]);
  const planned = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of status) m.set(keyOf(r.account_id, r.analytic_value_id), (m.get(keyOf(r.account_id, r.analytic_value_id)) ?? 0) + r.planned);
    return m;
  }, [status]);
  const landing = useMemo(() => new Map(forecast.map((f) => [f.key, f.landing])), [forecast]);
  const landingOf = (l: BudgetForecastLine) => landing.get(`${accById.get(l.gl_account_id)?.code ?? ""}|${l.analytic_value_id ?? ""}`);

  const { data: settings } = useBudgetControlSettings();
  const budgetableTypes = settings?.budgetable_types ?? DEFAULT_BUDGET_SETTINGS.budgetable_types;
  const create = useCreateBudgetForecast(), save = useSaveBudgetForecastLine(), del = useDeleteBudgetForecastLine();
  const publish = usePublishBudgetForecast(), remove = useDeleteBudgetForecast(), importer = useImportBudgetForecast();
  const [creating, setCreating] = useState(false);
  const [adding, setAdding] = useState({ account: "", section: "", amount: "" });
  const draft = current?.status === "draft" && canForecast;
  const total = lines.reduce((s, l) => s + l.amount, 0);

  const modele = () => {
    const rows = lines.length
      ? lines.map((l) => ({ compte: accById.get(l.gl_account_id)?.code ?? "", intitule: accById.get(l.gl_account_id)?.name ?? "",
          section: l.analytic_value_id ? sectionCode.get(l.analytic_value_id) ?? "" : "", montant: l.amount as number | string, commentaire: l.comment ?? "" }))
      : forecast.map((f) => ({ compte: f.account_code, intitule: f.account_name, section: f.section?.split(" ")[0] ?? "", montant: f.landing as number | string, commentaire: "" }));
    exportToXLSX(rows, [{ key: "compte", header: "Compte", width: 12 }, { key: "intitule", header: "Intitulé", width: 40 }, { key: "section", header: "Section", width: 16 },
      { key: "montant", header: "Montant", width: 16 }, { key: "commentaire", header: "Commentaire", width: 30 }], `modele-prevision-${year}`, "Prévision");
  };
  const importFile = async (file: File | undefined) => {
    if (!file || !current) return;
    try {
      const t = await readTableFile(file);
      const r = budgetImportRows(t.records, t.headers, year, false);
      if (r.missing.length) { toast.error(`Colonne(s) introuvable(s) : ${r.missing.join(", ")}. Partir du modèle de prévision.`); return; }
      if (!r.rows.length) { toast.error("Aucune ligne avec un montant dans le fichier"); return; }
      if (lines.length && !window.confirm(`Les ${lines.length} ligne(s) de la version seront remplacées par les ${r.rows.length} ligne(s) du fichier. Continuer ?`)) return;
      importer.mutate({ forecast: current.id, rows: r.rows });
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <Card className="border-border mt-4" data-testid="budget-forecast-versions">
      <CardHeader className="p-4 pb-2 flex flex-row flex-wrap items-end justify-between gap-2">
        <div>
          <CardTitle className="text-sm">Prévisions saisies</CardTitle>
          <p className="text-[11px] text-muted-foreground">Versions établies par le contrôle de gestion ; publiée, une version est figée (en créer une nouvelle pour réviser).</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {versions.length > 0 && <div className="space-y-1"><Label className="text-xs" htmlFor="fv-version">Version</Label>
            <select id="fv-version" className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={current?.id ?? ""} onChange={(e) => setPicked(e.target.value)}>
              {versions.map((v) => <option key={v.id} value={v.id}>{v.name} — {v.status === "published" ? "publiée" : "brouillon"}</option>)}
            </select></div>}
          {/* L'initialisation lit le plan comptable : sans lui chargé, la version naîtrait vide sans le dire. */}
          {canForecast && <Button size="sm" variant="outline" className="h-8 text-xs" disabled={!glQuery.isSuccess} title={glQuery.isSuccess ? undefined : "Chargement du plan comptable…"}
            onClick={() => setCreating(true)}>Nouvelle version</Button>}
          {canExport && current && <ExportButtons label="Exporter la version" filename={`prevision-${year}-${current.name}`} sheetName="Prévision"
            rows={lines.map((l) => ({ compte: accById.get(l.gl_account_id)?.code ?? "", intitule: accById.get(l.gl_account_id)?.name ?? "",
              section: l.analytic_value_id ? sectionCode.get(l.analytic_value_id) ?? "" : "", montant: l.amount,
              budget: planned.get(keyOf(l.gl_account_id, l.analytic_value_id)) ?? "", calcule: landingOf(l) ?? "", commentaire: l.comment ?? "" }))}
            columns={[{ key: "compte", header: "Compte", width: 12 }, { key: "intitule", header: "Intitulé", width: 36 }, { key: "section", header: "Section", width: 16 },
              { key: "montant", header: "Montant", width: 15 }, { key: "budget", header: "Budget", width: 15 }, { key: "calcule", header: "Atterrissage calculé", width: 18 },
              { key: "commentaire", header: "Commentaire", width: 30 }]} />}
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0 space-y-3">
        {!current ? (
          <p className="text-xs text-muted-foreground" data-testid="forecast-versions-empty">Aucune version de prévision pour {year}.{canForecast ? " Créez-en une, à partir de l'atterrissage calculé, du budget ou d'un fichier." : ""}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span data-testid="forecast-version-status">{current.name} · {current.status === "published" ? `publiée le ${new Date(current.published_at!).toLocaleDateString("fr-FR")}` : "brouillon"} · total {fmt(total)}</span>
              {draft && <>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={modele}>Modèle de prévision (Excel)</Button>
                <label className="inline-flex items-center h-7 px-3 rounded-md border border-input bg-background text-xs cursor-pointer hover:bg-muted/50">
                  {importer.isPending ? "Import…" : "Importer la prévision"}
                  <input type="file" className="sr-only" accept={TABLE_FILE_ACCEPT} aria-label="Importer la prévision (Excel ou CSV)"
                    onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ""; }} />
                </label>
                <Button size="sm" className="h-7 text-xs" disabled={publish.isPending || save.isPending || lines.length === 0} onClick={() => publish.mutate(current.id)}>Publier</Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => { if (window.confirm("Supprimer cette version ?")) remove.mutate(current.id, { onSuccess: () => setPicked(null) }); }}>Supprimer</Button>
              </>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs" data-testid="forecast-version-lines">
                <thead><tr className="bg-muted/30 text-muted-foreground"><th className="text-left p-2">Compte</th><th className="text-left">Section</th><th className="text-right">Prévision</th>
                  <th className="text-right">Budget</th><th className="text-right">Écart</th><th className="text-right">Atterrissage calculé</th><th className="text-left pl-3">Commentaire</th><th /></tr></thead>
                <tbody>
                  {lines.length === 0 && <tr><td colSpan={8} className="p-3 text-center text-muted-foreground">Aucune ligne.</td></tr>}
                  {[...lines].sort((a, b) => (accById.get(a.gl_account_id)?.code ?? "").localeCompare(accById.get(b.gl_account_id)?.code ?? "")).map((l) => {
                    const b = planned.get(keyOf(l.gl_account_id, l.analytic_value_id));
                    return (
                      <tr key={l.id} data-testid="forecast-version-line" className="border-t border-border/50">
                        <td className="p-2"><span className="font-mono">{accById.get(l.gl_account_id)?.code}</span> {accById.get(l.gl_account_id)?.name}</td>
                        <td>{l.analytic_value_id ? sectionName.get(l.analytic_value_id) ?? "—" : "Toutes"}</td>
                        <td className="text-right">{draft
                          ? <Input aria-label={`Prévision ${accById.get(l.gl_account_id)?.code ?? ""}${l.analytic_value_id ? " " + (sectionCode.get(l.analytic_value_id) ?? "") : ""}`}
                              className="h-7 w-28 text-xs text-right ml-auto" defaultValue={String(l.amount)} inputMode="decimal"
                              onBlur={(e) => { const n = Number(e.target.value.replace(/\s/g, "").replace(",", ".")); if (Number.isFinite(n) && n >= 0 && n !== l.amount) save.mutate({ ...l, amount: n }); }} />
                          : <span className="tabular-nums">{fmt(l.amount)}</span>}</td>
                        <td className="text-right tabular-nums">{b == null ? "—" : fmt(b)}</td>
                        <td className={cn("text-right tabular-nums", b != null && l.amount > b && "text-destructive")}>{b == null ? "—" : fmt(b - l.amount)}</td>
                        <td className="text-right tabular-nums">{landingOf(l) == null ? "—" : fmt(landingOf(l)!)}</td>
                        <td className="pl-3">{l.comment ?? ""}</td>
                        <td className="pr-2 text-right">{draft && <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => del.mutate(l.id)}>Retirer</Button>}</td>
                      </tr>);
                  })}
                </tbody>
              </table>
            </div>
            {draft && (
              <div className="flex flex-wrap items-end gap-2 border-t border-border pt-2" data-testid="forecast-add-line">
                <div className="space-y-1"><Label className="text-xs" htmlFor="fv-account">Compte</Label>
                  <select id="fv-account" className="h-8 w-56 rounded-md border border-input bg-background px-2 text-xs" value={adding.account} onChange={(e) => setAdding({ ...adding, account: e.target.value })}>
                    <option value="">— choisir —</option>
                    {(gl as any[]).filter((g) => g.is_active && budgetableTypes.includes(g.account_type)).sort((a, b) => a.code.localeCompare(b.code))
                      .map((g) => <option key={g.id} value={g.id}>{g.code} — {g.name}</option>)}
                  </select></div>
                {values.length > 0 && <div className="space-y-1"><Label className="text-xs" htmlFor="fv-section">Section</Label>
                  <select id="fv-section" className="h-8 w-44 rounded-md border border-input bg-background px-2 text-xs" value={adding.section} onChange={(e) => setAdding({ ...adding, section: e.target.value })}>
                    <option value="">Toutes</option>{values.filter((v) => v.active).map((v) => <option key={v.id} value={v.id}>{v.code} — {v.name}</option>)}
                  </select></div>}
                <div className="space-y-1"><Label className="text-xs" htmlFor="fv-amount">Montant</Label>
                  <Input id="fv-amount" className="h-8 w-28 text-xs text-right" inputMode="decimal" value={adding.amount} onChange={(e) => setAdding({ ...adding, amount: e.target.value })} /></div>
                <Button size="sm" className="h-8 text-xs" disabled={!adding.account || adding.amount === "" || save.isPending}
                  onClick={() => save.mutate({ forecast_id: current.id, gl_account_id: adding.account, analytic_value_id: adding.section || null,
                    amount: Number(adding.amount.replace(/\s/g, "").replace(",", ".")) }, { onSuccess: () => setAdding({ account: "", section: "", amount: "" }) })}>Ajouter la ligne</Button>
              </div>
            )}
          </>
        )}
      </CardContent>
      {creating && <NewVersionDialog year={year} versions={versions.map((v) => ({ id: v.id, name: v.name }))} pending={create.isPending} ready={ready} onClose={() => setCreating(false)}
        onCreate={async (name, init) => {
          let seed: { gl_account_id: string; analytic_value_id: string | null; amount: number }[] = [];
          if (init === "calculated" && forecast.length > 0 && accByCode.size === 0) { toast.error("Plan comptable non chargé : réessayez dans un instant."); return; }
          if (init === "calculated") seed = forecast.flatMap((f) => {
            const acc = accByCode.get(f.account_code); if (!acc) return [];
            return [{ gl_account_id: acc.id, analytic_value_id: f.key.split("|")[1] || null, amount: f.landing }];
          });
          else if (init === "budget") {
            const m = new Map<string, { gl_account_id: string; analytic_value_id: string | null; amount: number }>();
            for (const r of status) { const k = keyOf(r.account_id, r.analytic_value_id); const e = m.get(k); m.set(k, { gl_account_id: r.account_id, analytic_value_id: r.analytic_value_id, amount: (e?.amount ?? 0) + r.planned }); }
            seed = [...m.values()];
          } else if (init !== "empty") {
            const { data, error } = await (supabase as any).from("budget_forecast_lines").select("gl_account_id, analytic_value_id, amount").eq("forecast_id", init);
            if (error) { toast.error(error.message); return; }
            seed = ((data ?? []) as any[]).map((l) => ({ gl_account_id: l.gl_account_id, analytic_value_id: l.analytic_value_id, amount: Number(l.amount) }));
          }
          create.mutate({ year, name, lines: seed }, { onSuccess: (id) => { setPicked(id); setCreating(false); } });
        }} />}
    </Card>
  );
}

function NewVersionDialog({ year, versions, pending, ready, onClose, onCreate }: {
  year: string; versions: { id: string; name: string }[]; pending: boolean; ready: boolean; onClose: () => void; onCreate: (name: string, init: Init) => void;
}) {
  const [name, setName] = useState("");
  const [init, setInit] = useState<Init>("calculated");
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="text-sm">Nouvelle version de prévision — {year}</DialogTitle>
          <DialogDescription className="text-xs">Point de départ de la saisie ; les montants restent modifiables (ou importables) jusqu'à la publication.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="nv-name">Nom de la version</Label>
            <Input id="nv-name" className="h-8 text-xs" placeholder="Révision T1" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="nv-init">Initialiser avec</Label>
            <select id="nv-init" className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs" value={init} onChange={(e) => setInit(e.target.value)}>
              <option value="calculated">L'atterrissage calculé</option><option value="budget">Le budget de contrôle</option><option value="empty">Rien (saisie ou import)</option>
              {versions.map((v) => <option key={v.id} value={v.id}>Copie de « {v.name} »</option>)}
            </select></div>
        </div>
        <DialogFooter><Button variant="outline" size="sm" onClick={onClose}>Annuler</Button>
          <Button size="sm" disabled={!name.trim() || pending || (!ready && (init === "calculated" || init === "budget"))} onClick={() => onCreate(name.trim(), init)}>
            {!ready && (init === "calculated" || init === "budget") ? "Chargement des chiffres…" : "Créer la version"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
