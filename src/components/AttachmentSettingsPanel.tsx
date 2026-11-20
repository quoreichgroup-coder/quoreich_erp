import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMyAccess } from "@/hooks/use-my-access";
import { useAttachmentCategories, useAttachmentSettings, useSaveAttachmentCategory, useSaveAttachmentSettings } from "@/hooks/use-attachments";
import { DOC_TYPE_LABELS, REQUIRABLE, type AttachmentDocType } from "@/lib/attachments";

/*
 * Paramètres des pièces jointes (V138) : taille, types admis, archivage après validation, catégorie obligatoire ;
 * catégories (pièces concernées, pièce jointe exigée avant soumission). Écriture : droit documents.settings.
 */
const TYPES: [string, string][] = [
  ["application/pdf", "PDF"], ["image/jpeg", "JPEG"], ["image/png", "PNG"], ["image/webp", "WebP"], ["image/heic", "HEIC (photo de téléphone)"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Excel (.xlsx)"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Word (.docx)"], ["text/csv", "CSV"], ["application/xml", "XML"], ["text/xml", "XML (texte)"],
];
const DEFAULT_TYPES = TYPES.map(([t]) => t);
const ALL_DOC_TYPES = Object.keys(DOC_TYPE_LABELS) as AttachmentDocType[];

export function AttachmentSettingsPanel() {
  const access = useMyAccess();
  const canEdit = access.data?.permissions.includes("documents.settings") ?? false;
  const settings = useAttachmentSettings();
  const cats = useAttachmentCategories();
  const saveSettings = useSaveAttachmentSettings();
  const saveCat = useSaveAttachmentCategory();
  const s = settings.data;
  const current = {
    max_size_mb: s ? Number(s.max_size_mb) : 10,
    allowed_mime_types: (s?.allowed_mime_types as string[] | undefined) ?? DEFAULT_TYPES,
    lock_after_validation: s ? Boolean(s.lock_after_validation) : true,
    require_category: s ? Boolean(s.require_category) : false,
  };
  const save = (patch: Partial<typeof current>) => saveSettings.mutate({ ...current, ...patch });
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");

  return (
    <div className="space-y-4 text-xs" data-testid="attachment-settings">
      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-semibold">Réglages</h3>
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1"><Label className="text-xs" htmlFor="att-max">Taille maximale d'un fichier (Mo)</Label>
            <Input id="att-max" type="number" min={1} max={50} className="h-8 text-xs w-24" defaultValue={current.max_size_mb} key={current.max_size_mb} disabled={!canEdit}
              onBlur={(e) => { const n = Number(e.target.value); if (n >= 1 && n <= 50 && n !== current.max_size_mb) save({ max_size_mb: n }); }} /></div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={current.lock_after_validation} disabled={!canEdit}
            onChange={(e) => save({ lock_after_validation: e.target.checked })} />Archiver les pièces jointes d'une pièce validée (suppression réservée au droit dédié)</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={current.require_category} disabled={!canEdit}
            onChange={(e) => save({ require_category: e.target.checked })} />Catégorie obligatoire</label>
        </div>
        <fieldset className="space-y-1"><legend className="font-medium">Types de fichiers admis</legend>
          <div className="flex flex-wrap gap-3">{TYPES.map(([t, l]) => (
            <label key={t} className="flex items-center gap-1"><input type="checkbox" checked={current.allowed_mime_types.includes(t)} disabled={!canEdit}
              onChange={(e) => save({ allowed_mime_types: e.target.checked ? [...current.allowed_mime_types, t] : current.allowed_mime_types.filter((x) => x !== t) })} />{l}</label>))}
          </div></fieldset>
      </div>

      <div className="bg-card border border-border rounded-lg p-4 space-y-2">
        <h3 className="text-sm font-semibold">Catégories</h3>
        <p className="text-muted-foreground">« Exigée avant » : la pièce ne peut être soumise (ou le dossier dédouané) sans une pièce jointe de cette catégorie. Rien n'est exigé par défaut.</p>
        <table className="w-full">
          <thead className="text-muted-foreground"><tr><th className="text-left">Catégorie</th><th className="text-left">Pièces concernées</th><th className="text-left">Exigée avant la soumission de</th><th className="text-left">Active</th></tr></thead>
          <tbody>{(cats.data ?? []).map((c: any) => (
            <tr key={c.id} className="border-t border-border/50 align-top" data-testid="attachment-category-row">
              <td className="py-1 pr-2"><span className="font-medium">{c.label}</span> <span className="text-muted-foreground font-mono">{c.code}</span></td>
              <td className="pr-2">
                <select multiple aria-label={`Pièces concernées par ${c.label}`} className="h-20 w-56 rounded-md border border-input bg-background text-xs" disabled={!canEdit}
                  value={c.doc_types ?? []} onChange={(e) => { const v = Array.from(e.target.selectedOptions).map((o) => o.value); saveCat.mutate({ id: c.id, doc_types: v.length ? v : null }); }}>
                  {ALL_DOC_TYPES.map((t) => <option key={t} value={t}>{DOC_TYPE_LABELS[t]}</option>)}</select>
                <p className="text-muted-foreground">{c.doc_types ? "" : "Toutes les pièces"}</p></td>
              <td className="pr-2">{REQUIRABLE.map((t) => (
                <label key={t} className="flex items-center gap-1"><input type="checkbox" checked={(c.required_for ?? []).includes(t)} disabled={!canEdit}
                  aria-label={`${c.label} exigée pour ${DOC_TYPE_LABELS[t]}`}
                  onChange={(e) => saveCat.mutate({ id: c.id, required_for: e.target.checked ? [...(c.required_for ?? []), t] : (c.required_for ?? []).filter((x: string) => x !== t) })} />
                  {t === "import_file" ? "Dossier d'importation (dédouanement)" : DOC_TYPE_LABELS[t]}</label>))}</td>
              <td><input type="checkbox" aria-label={`${c.label} active`} checked={Boolean(c.is_active)} disabled={!canEdit} onChange={(e) => saveCat.mutate({ id: c.id, is_active: e.target.checked })} /></td>
            </tr>))}</tbody>
        </table>
        {canEdit && (
          <div className="flex flex-wrap items-end gap-2 pt-2">
            <div className="space-y-1"><Label className="text-xs" htmlFor="att-cat-code">Code</Label>
              <Input id="att-cat-code" className="h-8 text-xs w-32 font-mono" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))} /></div>
            <div className="space-y-1"><Label className="text-xs" htmlFor="att-cat-label">Libellé</Label>
              <Input id="att-cat-label" className="h-8 text-xs w-56" value={label} onChange={(e) => setLabel(e.target.value)} /></div>
            <Button size="sm" className="h-8 text-xs" disabled={!code || !label.trim() || saveCat.isPending}
              onClick={() => saveCat.mutate({ code, label: label.trim() }, { onSuccess: () => { setCode(""); setLabel(""); } })}>Ajouter la catégorie</Button>
          </div>
        )}
      </div>
    </div>
  );
}
