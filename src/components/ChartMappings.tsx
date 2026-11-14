import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/StatusBadge";
import { useAuth } from "@/contexts/AuthContext";
import { useMyAccess } from "@/hooks/use-my-access";
import { useFrameworks } from "@/hooks/use-chart-frameworks";
import { useImportProfiles, useImportSettings, useSaveImportSettings } from "@/hooks/use-chart-import";
import { Switch } from "@/components/ui/switch";
import { exportToCSV } from "@/lib/csv-export";
import { cn } from "@/lib/utils";
import {
  useArchiveMapping, useChartMappings, useCompareMapping, useCreateMapping, useCreateSecondaryChart, useDecideMappingLines,
  useMappedTrialBalance, useMappingLineAuthors, useProposeMapping, useSecondaryCharts, useSetMappingLines, useValidateMapping,
  type ChartMapping, type CompareRow,
} from "@/hooks/use-chart-mappings";

/*
 * Correspondances entre plans (V66, lot PC-5) : plan opérationnel → référentiel ou plan secondaire.
 * Proposition automatique jamais validée d'office ; décision par une autre personne ; balance convertie
 * et export au format d'un profil (Sage, SAP…).
 */
const LINE_STATUS: Record<string, [string, string]> = { proposed: ["warning", "Proposée"], validated: ["success", "Validée"], rejected: ["error", "Refusée"] };
const MAP_STATUS: Record<string, [string, string]> = { draft: ["warning", "Brouillon"], validated: ["success", "Validée"], archived: ["neutral", "Archivée"] };
const METHOD: Record<string, string> = { same_code: "Même code", prefix: "Préfixe", label: "Intitulé", manual: "Manuelle" };
const fmt = (n: number) => Number(n || 0).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const year = new Date().getFullYear();

export function ChartMappings() {
  const { data: access } = useMyAccess();
  const perms = access?.permissions ?? [];
  const canAdmin = perms.includes("accounting.chart_admin");
  const canPropose = perms.includes("accounting.mapping");
  const canValidate = perms.includes("accounting.mapping_validate");
  const { data: mappings = [], isLoading } = useChartMappings();
  const { data: charts = [] } = useSecondaryCharts();
  const { data: fw } = useFrameworks();
  const [selected, setSelected] = useState<string | null>(null);
  const mapping = mappings.find((m) => m.id === selected) ?? null;
  const targetLabel = (m: ChartMapping) => m.target_framework
    ? fw?.frameworks.find((f) => f.code === m.target_framework)?.name ?? m.target_framework
    : charts.find((c) => c.id === m.target_chart_id)?.name ?? "Plan secondaire";

  return (
    <div className="space-y-3">
      <MappingSettings canEdit={canAdmin} />
      <SecondaryChartsCard canAdmin={canAdmin} />
      {canPropose && <NewMapping />}
      <section aria-label="Correspondances" className="card-elevated overflow-x-auto">
        <table className="w-full text-xs" data-testid="mappings">
          <thead><tr className="bg-muted/30 text-muted-foreground"><th className="text-left p-2">Correspondance</th><th className="text-left">Cible</th><th className="text-left">État</th><th className="text-left">Créée le</th></tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={4} className="p-4 text-center"><Loader2 className="w-4 h-4 animate-spin inline" /></td></tr>}
            {!isLoading && mappings.length === 0 && <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">Aucune correspondance</td></tr>}
            {mappings.map((m) => (
              <tr key={m.id} data-testid="mapping-row" onClick={() => setSelected(m.id)} className={cn("border-t border-border/50 cursor-pointer hover:bg-muted/30", m.id === selected && "bg-primary/5")}>
                <td className="p-2 font-medium">{m.name}</td><td>{targetLabel(m)}</td>
                <td><StatusBadge status={MAP_STATUS[m.status][0]} label={MAP_STATUS[m.status][1]} /></td>
                <td>{new Date(m.created_at).toLocaleDateString("fr-FR")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {mapping && <MappingDetail mapping={mapping} title={`${mapping.name} → ${targetLabel(mapping)}`} canPropose={canPropose} canValidate={canValidate} />}
    </div>
  );
}

function MappingSettings({ canEdit }: { canEdit: boolean }) {
  const { data } = useImportSettings();
  const save = useSaveImportSettings();
  if (!data) return null;
  return (
    <section aria-label="Paramètres des correspondances" className="bg-card border border-border rounded-lg p-3 text-xs">
      <label className="flex items-center gap-2"><Switch aria-label="Correspondances validées par une autre personne" checked={data.mapping_second_person} disabled={!canEdit || save.isPending}
        onCheckedChange={(v) => save.mutate({ ...data, mapping_second_person: v })} />Une correspondance est validée par une autre personne que son auteur</label>
    </section>
  );
}

function SecondaryChartsCard({ canAdmin }: { canAdmin: boolean }) {
  const { data: charts = [] } = useSecondaryCharts();
  const { data: fw } = useFrameworks();
  const create = useCreateSecondaryChart();
  const [f, setF] = useState({ code: "", name: "", framework: "" });
  return (
    <section aria-label="Plans secondaires" className="card-elevated p-4 space-y-2">
      <h2 className="text-sm font-semibold">Plans secondaires</h2>
      <p className="text-[11px] text-muted-foreground">Plan de groupe, plan d'un autre référentiel ou de reporting : on n'y passe aucune écriture ; les soldes y sont convertis par une correspondance validée.</p>
      {charts.length > 0 && <ul className="text-xs space-y-0.5" data-testid="secondary-charts">{charts.map((c) => <li key={c.id}><span className="font-mono">{c.code}</span> {c.name}{c.framework_code ? ` · ${c.framework_code} ${c.framework_version ?? ""}` : ""}</li>)}</ul>}
      {canAdmin && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><Label className="text-xs" htmlFor="sc-code">Code du plan</Label><Input id="sc-code" className="h-8 text-xs w-32" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></div>
          <div className="space-y-1"><Label className="text-xs" htmlFor="sc-name">Nom du plan</Label><Input id="sc-name" className="h-8 text-xs w-56" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs" htmlFor="sc-fw">Comptes repris de</Label>
            <select id="sc-fw" className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={f.framework} onChange={(e) => setF({ ...f, framework: e.target.value })}>
              <option value="">— plan vide —</option>
              {(fw?.frameworks ?? []).map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
            </select></div>
          <Button size="sm" className="h-8 text-xs" disabled={!/^[A-Z0-9_-]{1,30}$/.test(f.code) || !f.name.trim() || create.isPending}
            onClick={() => create.mutate({ code: f.code, name: f.name, framework: f.framework || null }, { onSuccess: () => setF({ code: "", name: "", framework: "" }) })}>Créer le plan secondaire</Button>
        </div>
      )}
    </section>
  );
}

function NewMapping() {
  const { data: charts = [] } = useSecondaryCharts();
  const { data: fw } = useFrameworks();
  const create = useCreateMapping();
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const submit = () => {
    const [kind, id] = target.split(":");
    create.mutate({ name, framework: kind === "fw" ? id : null, chart: kind === "chart" ? id : null }, { onSuccess: () => { setName(""); setTarget(""); } });
  };
  return (
    <section aria-label="Nouvelle correspondance" className="bg-card border border-border rounded-lg p-3 flex flex-wrap items-end gap-2">
      <div className="space-y-1"><Label className="text-xs" htmlFor="map-name">Nom de la correspondance</Label><Input id="map-name" className="h-8 text-xs w-64" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="space-y-1"><Label className="text-xs" htmlFor="map-target">Plan cible</Label>
        <select id="map-target" className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">— choisir —</option>
          <optgroup label="Référentiels">{(fw?.frameworks ?? []).map((x) => <option key={x.code} value={`fw:${x.code}`}>{x.name}</option>)}</optgroup>
          <optgroup label="Plans secondaires">{charts.map((c) => <option key={c.id} value={`chart:${c.id}`}>{c.name}</option>)}</optgroup>
        </select></div>
      <Button size="sm" className="h-8 text-xs" disabled={!name.trim() || !target || create.isPending} onClick={submit}>Créer la correspondance</Button>
    </section>
  );
}

function MappingDetail({ mapping, title, canPropose, canValidate }: { mapping: ChartMapping; title: string; canPropose: boolean; canValidate: boolean }) {
  const { user } = useAuth();
  const { data: rows = [], isLoading } = useCompareMapping(mapping.id);
  const { data: authors = [] } = useMappingLineAuthors(mapping.id);
  const { data: profiles = [] } = useImportProfiles();
  const propose = useProposeMapping();
  const decide = useDecideMappingLines();
  const validate = useValidateMapping();
  const archive = useArchiveMapping();
  const [filter, setFilter] = useState<"all" | "proposed" | "finding">("all");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<CompareRow | null>(null);
  const [reject, setReject] = useState(false);
  const [reason, setReason] = useState("");
  const [period, setPeriod] = useState({ from: `${year}-01-01`, to: new Date().toISOString().slice(0, 10), show: false });
  const { data: balance = [], isFetching } = useMappedTrialBalance(mapping.id, period.from, period.to, period.show);
  const draft = mapping.status === "draft";
  const { data: settings } = useImportSettings();
  const strict = settings?.mapping_second_person ?? true;
  const mine = useMemo(() => new Set(strict ? authors.filter((a) => a.proposed_by === user?.id).map((a) => a.id) : []), [authors, user?.id, strict]);
  const shown = rows.filter((r) => filter === "all" || (filter === "proposed" ? r.status === "proposed" : !!r.finding));
  const decidable = shown.filter((r) => r.line_id && r.status === "proposed" && !mine.has(r.line_id)).map((r) => r.line_id!);
  const selection = [...checked].filter((id) => decidable.includes(id));
  const count = (f: (r: CompareRow) => boolean) => rows.filter(f).length;
  const exportMapping = (profileCode: string) => {
    const p = profiles.find((x) => x.code === profileCode);
    const h = (k: "code" | "name", d: string) => (p?.column_map?.[k]?.[0] ?? d);
    exportToCSV(rows.filter((r) => r.status === "validated").map((r) => ({ src: r.source_code, srcName: r.source_name, tgt: r.target_code ?? "", tgtName: r.target_name ?? "", ratio: r.ratio ?? "" })),
      [{ key: "src", header: "Compte source" }, { key: "srcName", header: "Intitulé source" }, { key: "tgt", header: h("code", "Compte cible") },
        { key: "tgtName", header: h("name", "Intitulé cible") }, { key: "ratio", header: "Clé (%)" }], `correspondance-${profileCode.toLowerCase()}`);
  };

  return (
    <section aria-label="Détail de la correspondance" className="card-elevated p-4 space-y-3">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground" data-testid="mapping-summary">
            {count((r) => r.status === "validated")} validée(s) · {count((r) => r.status === "proposed")} proposée(s) · {count((r) => r.finding === "Compte non couvert")} compte(s) non couvert(s) · {count((r) => r.finding === "Type différent")} type(s) différent(s)
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {draft && canPropose && <Button size="sm" variant="outline" className="h-8 text-xs" disabled={propose.isPending} onClick={() => propose.mutate(mapping.id)}>Proposer automatiquement</Button>}
          {draft && canValidate && <Button size="sm" className="h-8 text-xs" disabled={validate.isPending} onClick={() => validate.mutate(mapping.id)}>Valider la correspondance</Button>}
          {mapping.status !== "archived" && canValidate && <Button size="sm" variant="ghost" className="h-8 text-xs" disabled={archive.isPending} onClick={() => archive.mutate(mapping.id)}>Archiver</Button>}
        </div>
      </div>
      <div className="flex gap-1 items-center flex-wrap" role="group" aria-label="Filtrer les correspondances">
        {([["all", "Toutes"], ["proposed", "À décider"], ["finding", "Écarts"]] as const).map(([v, l]) => (
          <Button key={v} size="sm" variant={filter === v ? "default" : "outline"} className="h-7 text-[11px]" onClick={() => setFilter(v)}>{l}</Button>))}
        {draft && canValidate && <>
          <Button size="sm" variant="outline" className="h-7 text-[11px] ml-auto" onClick={() => setChecked(new Set(decidable))}>Tout sélectionner ({decidable.length})</Button>
          <Button size="sm" className="h-7 text-[11px]" disabled={selection.length === 0 || decide.isPending}
            onClick={() => decide.mutate({ mapping: mapping.id, lines: selection, approve: true }, { onSuccess: () => setChecked(new Set()) })}>Valider la sélection ({selection.length})</Button>
          <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={selection.length === 0} onClick={() => { setReason(""); setReject(true); }}>Refuser la sélection</Button>
        </>}
      </div>
      {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
        <div className="overflow-x-auto max-h-[28rem] overflow-y-auto rounded-md border border-border">
          <table className="w-full text-xs" data-testid="mapping-lines">
            <thead className="sticky top-0 bg-card"><tr className="text-muted-foreground border-b border-border">
              <th className="p-2" /><th className="text-left">Compte source</th><th className="text-left">Compte cible</th><th className="text-right">Clé</th>
              <th className="text-left pl-2">Méthode</th><th className="text-left">État</th><th className="text-left">Écart</th><th />
            </tr></thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={`${r.source_account_id}-${r.line_id ?? i}`} data-testid="mapping-line" className="border-b border-border/50">
                  <td className="p-2">{r.line_id && decidable.includes(r.line_id) && <input type="checkbox" aria-label={`Sélectionner ${r.source_code} → ${r.target_code}`}
                    checked={checked.has(r.line_id)} onChange={(e) => { const n = new Set(checked); if (e.target.checked) n.add(r.line_id!); else n.delete(r.line_id!); setChecked(n); }} />}</td>
                  <td><span className="font-mono">{r.source_code}</span> {r.source_name}{r.lines > 0 ? <span className="text-muted-foreground"> · {r.lines} l.</span> : ""}</td>
                  <td>{r.target_code ? <><span className="font-mono">{r.target_code}</span> {r.target_name}</> : "—"}</td>
                  <td className="text-right tabular-nums">{r.ratio != null ? `${fmt(r.ratio)} %` : ""}</td>
                  <td className="pl-2">{r.method ? METHOD[r.method] : ""}</td>
                  <td>{r.status && <StatusBadge status={LINE_STATUS[r.status][0]} label={LINE_STATUS[r.status][1]} />}{r.line_id && mine.has(r.line_id) && r.status === "proposed" ? <span className="text-muted-foreground"> (vous)</span> : ""}</td>
                  <td className={cn(r.finding && "text-destructive")}>{r.finding ?? ""}</td>
                  <td className="pl-2">{draft && canPropose && <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setEdit(r)}>Modifier</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="border-t border-border pt-3 space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          <h3 className="text-xs font-semibold mr-2">Balance convertie (lignes validées)</h3>
          <div className="space-y-1"><Label className="text-xs" htmlFor="mtb-from">Du</Label><Input id="mtb-from" type="date" className="h-8 text-xs w-36" value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs" htmlFor="mtb-to">Au</Label><Input id="mtb-to" type="date" className="h-8 text-xs w-36" value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} /></div>
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setPeriod({ ...period, show: true })}>Calculer</Button>
          <Button size="sm" variant="outline" className="h-8 text-xs" disabled={balance.length === 0}
            onClick={() => exportToCSV(balance.map((b) => ({ code: b.target_code, name: b.target_name, debit: b.debit, credit: b.credit, balance: b.balance, sources: b.sources })),
              [{ key: "code", header: "Compte" }, { key: "name", header: "Intitulé" }, { key: "debit", header: "Débit" }, { key: "credit", header: "Crédit" },
                { key: "balance", header: "Solde" }, { key: "sources", header: "Comptes source" }], "balance-convertie")}>Exporter la balance</Button>
          <select aria-label="Exporter la correspondance au format" className="h-8 rounded-md border border-input bg-background px-2 text-xs ml-auto" value=""
            onChange={(e) => { if (e.target.value) exportMapping(e.target.value); }}>
            <option value="">Exporter la correspondance…</option>
            {profiles.filter((p) => !p.tenant_id).map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
          </select>
        </div>
        {period.show && (isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : (
          <table className="w-full text-xs" data-testid="mapped-balance">
            <thead><tr className="text-muted-foreground border-b border-border"><th className="text-left p-1">Compte</th><th className="text-right">Débit</th><th className="text-right">Crédit</th><th className="text-right pr-2">Solde</th></tr></thead>
            <tbody>{balance.map((b) => (
              <tr key={b.target_code} data-testid="mapped-balance-line" className="border-b border-border/50"><td className="p-1"><span className="font-mono">{b.target_code}</span> {b.target_name}</td>
                <td className="text-right tabular-nums">{fmt(b.debit)}</td><td className="text-right tabular-nums">{fmt(b.credit)}</td><td className="text-right tabular-nums pr-2">{fmt(b.balance)}</td></tr>))}</tbody>
          </table>))}
      </div>

      {edit && <EditMappingDialog mappingId={mapping.id} row={edit} rows={rows} onClose={() => setEdit(null)} />}
      {reject && (
        <Dialog open onOpenChange={(o) => { if (!o) setReject(false); }}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle className="text-sm">Refuser {selection.length} correspondance(s)</DialogTitle>
              <DialogDescription className="text-xs">Le motif est conservé sur chaque ligne refusée ; l'auteur pourra proposer une autre cible.</DialogDescription></DialogHeader>
            <div className="space-y-1.5"><Label className="text-xs" htmlFor="map-reject">Motif</Label><Input id="map-reject" className="h-8 text-xs" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
            <DialogFooter><Button variant="outline" size="sm" onClick={() => setReject(false)}>Annuler</Button>
              <Button size="sm" disabled={!reason.trim() || decide.isPending} onClick={() => decide.mutate({ mapping: mapping.id, lines: selection, approve: false, comment: reason },
                { onSuccess: () => { setReject(false); setChecked(new Set()); } })}>Refuser</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}

function EditMappingDialog({ mappingId, row, rows, onClose }: { mappingId: string; row: CompareRow; rows: CompareRow[]; onClose: () => void }) {
  const set = useSetMappingLines();
  const existing = rows.filter((r) => r.source_account_id === row.source_account_id && r.target_code);
  const [targets, setTargets] = useState(existing.length ? existing.map((r) => ({ code: r.target_code!, ratio: String(r.ratio ?? 100) })) : [{ code: "", ratio: "100" }]);
  const [comment, setComment] = useState("");
  const sum = targets.reduce((s, t) => s + Number(t.ratio || 0), 0);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="text-sm">Correspondance du compte {row.source_code} « {row.source_name} »</DialogTitle>
          <DialogDescription className="text-xs">Une ou plusieurs cibles ; la somme des clés vaut 100 %. La saisie redevient une proposition, à valider par une autre personne.</DialogDescription></DialogHeader>
        <div className="space-y-2">
          {targets.map((t, i) => (
            <div key={i} className="flex items-end gap-2">
              <div className="space-y-1"><Label className="text-xs" htmlFor={`map-tgt-${i}`}>Compte cible {i + 1}</Label>
                <Input id={`map-tgt-${i}`} className="h-8 text-xs font-mono w-32" value={t.code} onChange={(e) => setTargets(targets.map((x, j) => j === i ? { ...x, code: e.target.value.trim() } : x))} /></div>
              <div className="space-y-1"><Label className="text-xs" htmlFor={`map-ratio-${i}`}>Clé (%) {i + 1}</Label>
                <Input id={`map-ratio-${i}`} type="number" className="h-8 text-xs w-24" value={t.ratio} onChange={(e) => setTargets(targets.map((x, j) => j === i ? { ...x, ratio: e.target.value } : x))} /></div>
              {targets.length > 1 && <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setTargets(targets.filter((_, j) => j !== i))}>Retirer</Button>}
            </div>))}
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setTargets([...targets, { code: "", ratio: "0" }])}>Ajouter une cible</Button>
          <div className="space-y-1"><Label className="text-xs" htmlFor="map-comment">Commentaire</Label><Input id="map-comment" className="h-8 text-xs" value={comment} onChange={(e) => setComment(e.target.value)} /></div>
          <p className={cn("text-xs", sum !== 100 ? "text-destructive" : "text-muted-foreground")}>Total des clés : {fmt(sum)} %</p>
        </div>
        <DialogFooter><Button variant="outline" size="sm" onClick={onClose}>Annuler</Button>
          <Button size="sm" disabled={sum !== 100 || targets.some((t) => !t.code) || set.isPending}
            onClick={() => set.mutate({ mapping: mappingId, source: row.source_account_id, targets: targets.map((t) => ({ code: t.code, ratio: Number(t.ratio) })), comment }, { onSuccess: onClose })}>Enregistrer</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
