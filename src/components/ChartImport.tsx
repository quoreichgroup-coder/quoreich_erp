import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/StatusBadge";
import { useAuth } from "@/contexts/AuthContext";
import { useMyAccess } from "@/hooks/use-my-access";
import { ExportButtons } from "@/components/ExportButtons";
import { readTableFile, TABLE_FILE_ACCEPT } from "@/lib/table-file";
import { cn } from "@/lib/utils";
import { IMPORT_FIELDS, STANDARD_COLUMNS, detectMapping, mapRows, missingRequired, type Mapping } from "@/lib/chart-import";
import {
  useCancelImport, useImportProfiles, useImportRows, useImportRuns, useImportSettings, usePrepareImport, useSaveImportSettings,
  useUpdateImportRow, useValidateImport, type ImportRun, type ImportRunRow,
} from "@/hooks/use-chart-import";

/*
 * Import guidé du plan comptable (V65, simplifié V68) : fichier (format standard, colonnes reconnues) → préparation
 * (contrôle ligne à ligne par la base) → corrections → validation par une personne habilitée (une
 * autre que l'auteur si la société l'exige), tout ou rien.
 */
const STATUS: Record<string, [string, string]> = { ok: ["success", "Conforme"], warning: ["warning", "À vérifier"], error: ["error", "Erreur"] };
const ACTION: Record<string, string> = { create: "Créer", update: "Mettre à jour", skip: "Ignorer" };
const RUN_STATUS: Record<string, [string, string]> = { prepared: ["warning", "Préparé"], validated: ["success", "Validé"], cancelled: ["neutral", "Annulé"] };
const TYPES: [string, string][] = [["asset", "Actif"], ["liability", "Passif"], ["equity", "Capitaux propres"], ["revenue", "Produits"], ["expense", "Charges"]];
const typeLabel = (t: string | null) => TYPES.find(([v]) => v === t)?.[1] ?? "—";

export function ChartImport() {
  const { data: access } = useMyAccess();
  const perms = access?.permissions ?? [];
  const canImport = perms.includes("accounting.import");
  const canValidate = perms.includes("accounting.import_validate");
  const canAdmin = perms.includes("accounting.chart_admin");
  const { data: runs = [], isLoading } = useImportRuns();
  const [selected, setSelected] = useState<string | null>(null);
  const run = runs.find((r) => r.id === selected) ?? null;

  if (!canImport && !canValidate) {
    return <p className="text-xs text-muted-foreground">Accès réservé : droit « Préparer un import de plan comptable » ou « Valider un import de plan comptable préparé ».</p>;
  }
  return (
    <div className="space-y-3">
      <ImportSettingsCard canEdit={canAdmin} />
      {canImport && <NewImport onPrepared={(id) => setSelected(id)} />}
      <section aria-label="Imports du plan comptable" className="card-elevated overflow-x-auto">
        <table className="w-full text-xs" data-testid="import-runs">
          <thead><tr className="bg-muted/30 text-muted-foreground">
            <th className="text-left p-2">Date</th><th className="text-left">Fichier</th><th className="text-left">État</th><th className="text-left">Bilan</th>
          </tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={4} className="p-4 text-center"><Loader2 className="w-4 h-4 animate-spin inline" /></td></tr>}
            {!isLoading && runs.length === 0 && <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">Aucun import</td></tr>}
            {runs.map((r) => (
              <tr key={r.id} data-testid="import-run-row" onClick={() => setSelected(r.id)}
                className={cn("border-t border-border/50 cursor-pointer hover:bg-muted/30", r.id === selected && "bg-primary/5")}>
                <td className="p-2">{new Date(r.created_at).toLocaleString("fr-FR")}</td><td>{r.file_name}</td>
                <td><StatusBadge status={RUN_STATUS[r.status][0]} label={RUN_STATUS[r.status][1]} /></td>
                <td>{summaryText(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {run && <RunDetail run={run} canImport={canImport} canValidate={canValidate} />}
    </div>
  );
}

const summaryText = (r: ImportRun) => {
  const s = r.summary ?? {};
  if (r.status === "validated") return `${s.crees ?? 0} créé(s), ${s.mis_a_jour ?? 0} mis à jour, ${s.rattaches ?? 0} rattaché(s)`;
  return `${s.lignes ?? 0} ligne(s) · ${s.erreurs ?? 0} erreur(s) · ${s.avertissements ?? 0} à vérifier`;
};

function ImportSettingsCard({ canEdit }: { canEdit: boolean }) {
  const { data } = useImportSettings();
  const save = useSaveImportSettings();
  if (!data) return null;
  return (
    <section aria-label="Paramètres d'import" className="bg-card border border-border rounded-lg p-3 flex flex-wrap gap-6 text-xs">
      <label className="flex items-center gap-2"><Switch aria-label="Validation par une autre personne" checked={data.require_second_person} disabled={!canEdit || save.isPending}
        onCheckedChange={(v) => save.mutate({ ...data, require_second_person: v })} />Validation par une autre personne que l'auteur</label>
      <label className="flex items-center gap-2"><Switch aria-label="Mettre à jour les intitulés existants" checked={data.allow_label_updates} disabled={!canEdit || save.isPending}
        onCheckedChange={(v) => save.mutate({ ...data, allow_label_updates: v })} />Mettre à jour l'intitulé des comptes existants</label>
    </section>
  );
}

function NewImport({ onPrepared }: { onPrepared: (id: string) => void }) {
  const { data: profiles = [] } = useImportProfiles();
  // Format standard unique (V68) : colonnes reconnues automatiquement, aucun profil à choisir.
  const standard = profiles.find((p) => !p.tenant_id && p.code === "QUOREICH");
  // Colonnes reconnues dès la lecture (en-têtes intégrés), complétées quand le format standard est chargé.
  const columnMap = standard?.column_map ?? STANDARD_COLUMNS;
  const [file, setFile] = useState<{ name: string; headers: string[]; records: Record<string, string>[] } | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [showColumns, setShowColumns] = useState(false);
  const prepare = usePrepareImport();
  const missing = missingRequired(mapping);
  const rows = useMemo(() => (file ? mapRows(file.records, mapping) : []), [file, mapping]);
  const recognised = IMPORT_FIELDS.filter((f) => mapping[f.key]).map((f) => `${f.label} = « ${mapping[f.key]} »`);

  useEffect(() => {
    if (!file) return;
    const m = detectMapping(file.headers, columnMap);
    setMapping(m);
    setShowColumns(missingRequired(m).length > 0);
  }, [file, columnMap]);
  const read = async (f: File) => {
    try {
      const t = await readTableFile(f);
      setFile(t);
    } catch (e) { toast.error((e as Error).message); }
  };
  const templateRows = [
    { code: "6056", intitule: "Achats de petit matériel", type: "Charges", parent: "", regroupement: "oui", sens: "Débit" },
    { code: "605610", intitule: "Petit matériel informatique", type: "", parent: "6056", regroupement: "non", sens: "" },
  ];
  const templateColumns: { key: keyof (typeof templateRows)[number]; header: string; width: number }[] = [
    { key: "code", header: "Code", width: 14 }, { key: "intitule", header: "Intitulé", width: 45 }, { key: "type", header: "Type", width: 18 },
    { key: "parent", header: "Parent", width: 12 }, { key: "regroupement", header: "Regroupement", width: 14 }, { key: "sens", header: "Sens", width: 10 }];

  return (
    <section aria-label="Nouvel import" className="card-elevated p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-semibold">Nouvel import</h2>
        <ExportButtons label="Télécharger le modèle" rows={templateRows} columns={templateColumns} filename="modele-import-plan-comptable" sheetName="Plan comptable" />
      </div>
      <p className="text-[11px] text-muted-foreground">Un fichier Excel (.xlsx) ou CSV avec au moins les colonnes Code et Intitulé (Type, Parent, Regroupement et Sens sont facultatifs ; le type se déduit de la classe du compte). Le fichier « Exporter le plan » se réimporte tel quel ; les en-têtes usuels (Sage, SAP, anglais) sont reconnus.</p>
      <div className="space-y-1"><Label className="text-xs" htmlFor="imp-file">Fichier Excel ou CSV</Label>
        <Input id="imp-file" type="file" accept={TABLE_FILE_ACCEPT} className="h-8 text-xs w-72" onChange={(e) => { const f = e.target.files?.[0]; if (f) read(f); }} /></div>
      {file && (
        <>
          <p className="text-xs text-muted-foreground" data-testid="import-file-summary">{file.name} · {rows.length} ligne(s) lue(s) · colonnes reconnues : {recognised.join(", ") || "aucune"}
            {missing.length > 0 && <span className="text-destructive"> · à indiquer : {missing.join(", ")}</span>}
            {" "}<button type="button" className="underline" onClick={() => setShowColumns(!showColumns)}>{showColumns ? "Masquer les colonnes" : "Modifier les colonnes"}</button></p>
          {showColumns && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {IMPORT_FIELDS.map((f) => (
                <div key={f.key} className="space-y-1"><Label className="text-xs" htmlFor={`imp-col-${f.key}`}>Colonne « {f.label} »{f.required ? " *" : ""}</Label>
                  <select id={`imp-col-${f.key}`} className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs" value={mapping[f.key] ?? ""}
                    onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value || undefined })}>
                    <option value="">— aucune —</option>
                    {file.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select></div>
              ))}
            </div>
          )}
          <Button size="sm" className="h-8 text-xs" disabled={missing.length > 0 || rows.length === 0 || prepare.isPending}
            onClick={() => prepare.mutate({ profileId: null, fileName: file.name, rows }, { onSuccess: (id) => { setFile(null); onPrepared(String(id)); } })}>
            Préparer l'import
          </Button>
        </>
      )}
    </section>
  );
}

function RunDetail({ run, canImport, canValidate }: { run: ImportRun; canImport: boolean; canValidate: boolean }) {
  const { user } = useAuth();
  const { data: rows = [], isLoading } = useImportRows(run.id);
  const { data: settings } = useImportSettings();
  const validate = useValidateImport();
  const cancel = useCancelImport();
  const [filter, setFilter] = useState<"all" | "error" | "warning">("all");
  const [edit, setEdit] = useState<ImportRunRow | null>(null);
  const shown = rows.filter((r) => filter === "all" || r.status === filter);
  const errors = rows.filter((r) => r.status === "error").length;
  const own = run.created_by === user?.id;
  const open = run.status === "prepared";
  const blockedByOwner = own && (settings?.require_second_person ?? true);

  return (
    <section aria-label="Détail de l'import" className="card-elevated p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold">{run.file_name}</h2>
          <p className="text-xs text-muted-foreground" data-testid="import-run-summary">{summaryText(run)} · {run.summary.a_creer ?? 0} à créer, {run.summary.a_mettre_a_jour ?? 0} à mettre à jour, {run.summary.ignorees ?? 0} ignorée(s)</p>
          {open && blockedByOwner && canValidate && <p className="text-[11px] text-muted-foreground">Vous avez préparé cet import : une autre personne doit le valider.</p>}
        </div>
        <div className="flex gap-2 flex-wrap">
          <ExportButtons label="Rapport d'import" sheetName="Rapport" filename={`rapport-import-${run.file_name.replace(/\.[^.]+$/, "")}`}
            rows={rows.map((r) => ({ ligne: r.line_no, code: r.code ?? "", intitule: r.name ?? "", type: typeLabel(r.account_type), parent: r.parent_code ?? "",
              action: ACTION[r.action], etat: STATUS[r.status][1], messages: r.messages.join(" ; ") }))}
            columns={[{ key: "ligne", header: "Ligne", width: 8 }, { key: "code", header: "Code", width: 14 }, { key: "intitule", header: "Intitulé", width: 40 }, { key: "type", header: "Type", width: 16 },
              { key: "parent", header: "Parent", width: 12 }, { key: "action", header: "Action", width: 16 }, { key: "etat", header: "État", width: 12 }, { key: "messages", header: "Messages", width: 60 }]} />
          {open && (canImport || canValidate) && <Button size="sm" variant="outline" className="h-8 text-xs" disabled={cancel.isPending}
            onClick={() => cancel.mutate({ runId: run.id, reason: "Annulé depuis l'écran" })}>Annuler l'import</Button>}
          {open && canValidate && <Button size="sm" className="h-8 text-xs" disabled={errors > 0 || blockedByOwner || validate.isPending}
            onClick={() => validate.mutate(run.id)}>Valider l'import</Button>}
        </div>
      </div>
      <div className="flex gap-1 text-xs" role="group" aria-label="Filtrer les lignes">
        {([["all", "Toutes"], ["error", "Erreurs"], ["warning", "À vérifier"]] as const).map(([v, l]) => (
          <Button key={v} size="sm" variant={filter === v ? "default" : "outline"} className="h-7 text-[11px]" onClick={() => setFilter(v)}>{l}</Button>))}
      </div>
      {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
        <div className="overflow-x-auto max-h-[28rem] overflow-y-auto rounded-md border border-border">
          <table className="w-full text-xs" data-testid="import-rows">
            <thead className="sticky top-0 bg-card"><tr className="text-muted-foreground border-b border-border">
              <th className="text-left p-2">Ligne</th><th className="text-left">Code</th><th className="text-left">Intitulé</th><th className="text-left">Type</th>
              <th className="text-left">Parent</th><th className="text-left">Action</th><th className="text-left">État</th><th className="text-left">Messages</th><th />
            </tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} data-testid="import-row" className="border-b border-border/50 align-top">
                  <td className="p-2 tabular-nums">{r.line_no}</td><td className="font-mono">{r.code ?? "—"}</td><td>{r.name ?? "—"}{r.is_header ? " (regroupement)" : ""}</td>
                  <td>{typeLabel(r.account_type)}</td><td className="font-mono">{r.parent_code ?? ""}</td><td>{ACTION[r.action]}</td>
                  <td><StatusBadge status={STATUS[r.status][0]} label={STATUS[r.status][1]} /></td>
                  <td className="text-muted-foreground">{r.messages.join(" ; ")}</td>
                  <td className="pl-2 whitespace-nowrap">{open && canImport && <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setEdit(r)}>Corriger</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && <EditRowDialog row={edit} onClose={() => setEdit(null)} />}
    </section>
  );
}

function EditRowDialog({ row, onClose }: { row: ImportRunRow; onClose: () => void }) {
  const update = useUpdateImportRow();
  const [f, setF] = useState({ code: row.code ?? "", name: row.name ?? "", type: row.account_type ?? "", parent: row.parent_code ?? "", header: row.is_header });
  const submit = (skip: boolean) => update.mutate({ id: row.id, code: f.code, name: f.name, type: f.type || null, parent: f.parent || null, header: f.header, skip }, { onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">Corriger la ligne {row.line_no}</DialogTitle>
          <DialogDescription className="text-xs">{row.messages.join(" ; ") || "Ligne conforme."}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="imp-edit-code">Code</Label>
            <Input id="imp-edit-code" className="h-8 text-xs font-mono" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></div>
          <div className="col-span-2 space-y-1.5"><Label className="text-xs" htmlFor="imp-edit-name">Intitulé</Label>
            <Input id="imp-edit-name" className="h-8 text-xs" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="imp-edit-type">Type</Label>
            <select id="imp-edit-type" className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              <option value="">Déduit du référentiel</option>
              {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="imp-edit-parent">Parent</Label>
            <Input id="imp-edit-parent" className="h-8 text-xs font-mono" value={f.parent} onChange={(e) => setF({ ...f, parent: e.target.value })} /></div>
          <label className="flex items-end gap-2 text-xs pb-1.5"><Switch aria-label="Compte de regroupement" checked={f.header} onCheckedChange={(v) => setF({ ...f, header: v })} />Regroupement</label>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" disabled={update.isPending} onClick={() => submit(true)}>Ignorer la ligne</Button>
          <Button size="sm" disabled={update.isPending} onClick={() => submit(false)}>Enregistrer et recontrôler</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
