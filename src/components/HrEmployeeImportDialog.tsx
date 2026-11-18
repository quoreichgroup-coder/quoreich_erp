import { useMemo, useState } from "react";
import Papa from "papaparse";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useEmployees, useImportHrEmployees } from "@/hooks/use-hr-data";
import { markDuplicateHrEmployeeIdentifiers, normalizeHrEmployeeRow } from "@/lib/hr-employee-import";

export function HrEmployeeImportDialog({ open, onOpenChange, canCreate }: { open: boolean; onOpenChange: (open: boolean) => void; canCreate: boolean }) {
  const [rows, setRows] = useState<ReturnType<typeof normalizeHrEmployeeRow>[]>([]);
  const [error, setError] = useState("");
  const [filename, setFilename] = useState("");
  const employees = useEmployees();
  const importing = useImportHrEmployees();
  const valid = useMemo(() => rows.filter((row) => row.errors.length === 0), [rows]);
  const invalid = useMemo(() => rows.filter((row) => row.errors.length > 0), [rows]);
  const reset = () => { setRows([]); setError(""); setFilename(""); };
  const parse = (file: File) => {
    setFilename(file.name); setError("");
    Papa.parse<Record<string, string>>(file, { header: true, skipEmptyLines: true, complete: (result) => {
      if (result.errors.length) setError(result.errors.map((item) => item.message).join(" · "));
      if (!result.meta.fields?.length) { setError("Le fichier CSV doit contenir une ligne d’en-têtes."); setRows([]); return; }
      const parsed = result.data.map((row, index) => normalizeHrEmployeeRow(row, index + 2));
      setRows(markDuplicateHrEmployeeIdentifiers(parsed, employees.data ?? []));
    } });
  };
  const download = (onlyInvalid = false) => {
    const selected = onlyInvalid ? invalid : rows;
    const output = selected.map((item) => ({ ...item.row, ligne: item.line, erreurs: item.errors.join("; ") }));
    const csv = output.length ? Papa.unparse(output) : Papa.unparse({
      fields: ["matricule", "first_name", "last_name", "contract_type", "email", "phone", "job_title", "department", "hire_date"],
      data: [],
    });
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = onlyInvalid ? "erreurs-import-rh.csv" : "modele-import-rh.csv"; anchor.click(); URL.revokeObjectURL(url);
  };
  return <Dialog open={open} onOpenChange={(value) => { if (!value) reset(); onOpenChange(value); }}><DialogContent className="max-w-4xl max-h-[90dvh] overflow-y-auto">
    <DialogHeader><DialogTitle>Importer des salariés (CSV)</DialogTitle></DialogHeader>
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">Champs acceptés : matricule (facultatif), prénom, nom, type de contrat, courriel, téléphone, poste, service et date d’embauche. Le salaire et le compte bancaire ne sont jamais importés.</p>
      <div className="flex gap-2"><Button type="button" variant="outline" size="sm" onClick={() => download(false)}>Télécharger le modèle CSV</Button><label className="inline-flex h-8 cursor-pointer items-center rounded-md border px-3 text-xs hover:bg-muted">Choisir un CSV<input className="hidden" type="file" accept=".csv,text/csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) parse(file); event.currentTarget.value = ""; }} /></label></div>
      {error && <p role="alert" className="text-destructive">{error}</p>}{filename && <p className="text-xs text-muted-foreground">{filename} · {valid.length} lignes importables · {invalid.length} à corriger</p>}
      {invalid.length > 0 && <Button type="button" size="sm" variant="outline" onClick={() => download(true)}>Exporter les lignes en erreur</Button>}
      {rows.length > 0 && <div className="max-h-72 overflow-auto rounded border"><table className="w-full text-xs"><thead><tr className="bg-muted text-left"><th className="p-2">Ligne</th><th className="p-2">Matricule</th><th className="p-2">Nom</th><th className="p-2">Résultat</th></tr></thead><tbody>{rows.map((row) => <tr key={row.line} className="border-t"><td className="p-2">{row.line}</td><td className="p-2 font-mono">{row.row.matricule || "(généré)"}</td><td className="p-2">{row.row.first_name} {row.row.last_name}</td><td className="p-2">{row.errors.length ? row.errors.join(" · ") : "Prêt"}</td></tr>)}</tbody></table></div>}
    </div>
    <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Fermer</Button><Button disabled={!canCreate || employees.isLoading || valid.length === 0 || importing.isPending} onClick={() => importing.mutate(valid.map((row) => row.row), { onSuccess: () => { reset(); onOpenChange(false); } })}>{importing.isPending ? "Import…" : `Importer ${valid.length} salarié(s)`}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
