import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useHrEmployeeNumberSettings, useSaveHrEmployeeNumberSettings } from "@/hooks/use-hr-data";
import { hrErrorMessage } from "@/lib/hr-error-message";

export function HrEmployeeNumberSettingsCard({ canManage }: { canManage: boolean }) {
  const query = useHrEmployeeNumberSettings();
  const save = useSaveHrEmployeeNumberSettings();
  const [prefix, setPrefix] = useState("EMP");
  const [includeYear, setIncludeYear] = useState(false);
  const [separator, setSeparator] = useState("-");
  const [width, setWidth] = useState("5");
  const [nextNumber, setNextNumber] = useState("1");
  const [defaultStatus, setDefaultStatus] = useState("active");

  useEffect(() => {
    const settings = query.data;
    if (!settings) return;
    setPrefix(settings.prefix);
    setIncludeYear(settings.include_year);
    setSeparator(settings.separator);
    setWidth(String(settings.number_width));
    setNextNumber(String(settings.next_number));
    setDefaultStatus(settings.default_status);
  }, [query.data]);

  const sample = `${prefix || "EMP"}${includeYear ? `${separator}${new Date().getUTCFullYear()}` : ""}${separator}${String(Number(nextNumber) || 1).padStart(Math.min(12, Math.max(1, Number(width) || 1)), "0")}`;
  return <section className="rounded-lg border border-border bg-card p-4 space-y-4">
    <div><h2 className="text-sm font-semibold">Numérotation des matricules</h2><p className="mt-1 text-xs text-muted-foreground">La séquence est attribuée de façon atomique par société. Un matricule vide à la création ou à l’import déclenche la génération.</p></div>
    {query.isError && <p role="alert" className="text-xs text-destructive">Impossible de charger les réglages de numérotation{hrErrorMessage(query.error) ? ` : ${hrErrorMessage(query.error)}` : "."}</p>}
    {query.isLoading ? <p className="text-xs text-muted-foreground">Chargement…</p> : <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1"><Label>Préfixe</Label><Input value={prefix} maxLength={24} disabled={!canManage} onChange={(e) => setPrefix(e.target.value)} /></div>
        <div className="space-y-1"><Label>Séparateur</Label><Input value={separator} maxLength={5} disabled={!canManage} onChange={(e) => setSeparator(e.target.value)} /></div>
        <div className="space-y-1"><Label>Chiffres minimum</Label><Input type="number" min="1" max="12" value={width} disabled={!canManage} onChange={(e) => setWidth(e.target.value)} /></div>
        <div className="space-y-1"><Label>Prochain numéro</Label><Input type="number" min="1" value={nextNumber} disabled={!canManage} onChange={(e) => setNextNumber(e.target.value)} /></div>
        <div className="space-y-1"><Label>Statut par défaut</Label><Input value={defaultStatus} maxLength={80} disabled={!canManage} onChange={(e) => setDefaultStatus(e.target.value)} /></div>
        <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" checked={includeYear} disabled={!canManage} onChange={(e) => setIncludeYear(e.target.checked)} />Inclure l’année courante</label>
      </div>
      <p className="text-xs text-muted-foreground">Aperçu du prochain matricule : <strong className="font-mono text-foreground">{sample}</strong></p>
      {!canManage && <p className="text-xs text-muted-foreground">La modification exige le droit central de configuration des matricules RH.</p>}
      {canManage && <Button size="sm" disabled={save.isPending || !prefix.trim() || !defaultStatus.trim() || Number(width) < 1 || Number(width) > 12 || Number(nextNumber) < 1} onClick={() => save.mutate({ prefix: prefix.trim(), include_year: includeYear, separator, number_width: Number(width), next_number: Number(nextNumber), default_status: defaultStatus.trim() })}>{save.isPending ? "Enregistrement…" : "Enregistrer la numérotation"}</Button>}
    </>}
  </section>;
}
