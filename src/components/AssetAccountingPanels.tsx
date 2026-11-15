import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMyAccess } from "@/hooks/use-my-access";
import { useGLAccounts } from "@/hooks/use-gl-data";
import {
  useAssetCategoriesV75, useAssetSettings, useDisposeAsset, useSaveAssetCategory, useSaveAssetSettings, type AssetCategory, type AssetSettings,
} from "@/hooks/use-asset-accounting";

/*
 * Immobilisations (V75) : catégories (comptes 2x / 28x / 68x), paramètres de l'amortissement dégressif
 * et du prorata, sortie d'une immobilisation (cession ou mise au rebut) comptabilisée selon SYSCOHADA.
 */
const today = () => new Date().toISOString().slice(0, 10);

export function AssetDisposalForm({ asset, onDone }: { asset: { id: string; asset_code: string; status: string }; onDone?: () => void }) {
  const { data: access } = useMyAccess();
  const can = (access?.permissions ?? []).includes("assets.dispose");
  const dispose = useDisposeAsset();
  const [f, setF] = useState({ date: today(), type: "sale" as "sale" | "scrap", price: "", proceeds: "receivable" as "receivable" | "bank", notes: "" });
  if (!can || asset.status === "disposed") return null;
  const price = f.type === "scrap" ? 0 : Number(f.price.replace(",", "."));
  return (
    <section aria-label="Sortie de l'immobilisation" className="border border-border rounded-md p-3 space-y-2 text-xs">
      <p className="font-medium">Sortie de l'immobilisation {asset.asset_code}</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1"><Label className="text-xs" htmlFor="dsp-type">Type</Label>
          <select id="dsp-type" className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as "sale" | "scrap" })}>
            <option value="sale">Cession (vente)</option><option value="scrap">Mise au rebut</option></select></div>
        <div className="space-y-1"><Label className="text-xs" htmlFor="dsp-date">Date de sortie</Label><Input id="dsp-date" type="date" className="h-8 text-xs" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
        {f.type === "sale" && <>
          <div className="space-y-1"><Label className="text-xs" htmlFor="dsp-price">Prix de cession</Label><Input id="dsp-price" inputMode="decimal" className="h-8 text-xs text-right" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs" htmlFor="dsp-proceeds">Prix</Label>
            <select id="dsp-proceeds" className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs" value={f.proceeds} onChange={(e) => setF({ ...f, proceeds: e.target.value as "receivable" | "bank" })}>
              <option value="receivable">À encaisser (créance 485)</option><option value="bank">Encaissé en banque</option></select></div>
        </>}
        <div className="col-span-2 space-y-1"><Label className="text-xs" htmlFor="dsp-notes">Observations</Label><Input id="dsp-notes" className="h-8 text-xs" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
      </div>
      <p className="text-[11px] text-muted-foreground">Comptabilise la dotation du mois jusqu'à la date, la sortie (amortissements, valeur nette en 81, coût) et le prix en 82. Les mois précédents doivent être amortis.</p>
      <Button size="sm" className="h-8 text-xs" disabled={dispose.isPending || !f.date || (f.type === "sale" && !(price > 0))}
        onClick={() => dispose.mutate({ asset: asset.id, date: f.date, type: f.type, price, proceeds: f.proceeds, notes: f.notes }, { onSuccess: onDone })}>
        {f.type === "sale" ? "Comptabiliser la cession" : "Comptabiliser la mise au rebut"}</Button>
    </section>
  );
}

export function AssetCategoriesPanel() {
  const { data: access } = useMyAccess();
  const canEdit = (access?.permissions ?? []).includes("assets.settings");
  const { data: categories = [] } = useAssetCategoriesV75();
  const { data: gl = [] } = useGLAccounts();
  const save = useSaveAssetCategory();
  const [edit, setEdit] = useState<(Omit<AssetCategory, "id"> & { id?: string }) | null>(null);
  const label = (id: string | null) => { const g = (gl as any[]).find((x) => x.id === id); return g ? `${g.code} — ${g.name}` : "—"; };
  const pick = (prefix: RegExp) => (gl as any[]).filter((g) => g.is_active && !g.is_header && prefix.test(g.code)).sort((a, b) => a.code.localeCompare(b.code));
  return (
    <Card className="border-border max-w-4xl">
      <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between"><CardTitle className="text-sm">Catégories et comptes</CardTitle>
        {canEdit && <Button size="sm" className="h-8 text-xs" onClick={() => setEdit({ name: "", depreciation_method: "straight_line", useful_life_years: 5, gl_asset_account_id: null, gl_depreciation_account_id: null, gl_expense_account_id: null })}>Nouvelle catégorie</Button>}</CardHeader>
      <CardContent className="p-4 pt-0 space-y-3 text-xs">
        <table className="w-full" data-testid="asset-categories">
          <thead><tr className="text-muted-foreground border-b border-border"><th className="text-left p-1">Catégorie</th><th className="text-left">Immobilisation</th><th className="text-left">Amortissements</th><th className="text-left">Dotation</th><th /></tr></thead>
          <tbody>{categories.map((c) => (
            <tr key={c.id} data-testid="asset-category-row" className="border-b border-border/50"><td className="p-1 font-medium">{c.name}</td>
              <td>{label(c.gl_asset_account_id)}</td><td>{label(c.gl_depreciation_account_id)}</td><td>{label(c.gl_expense_account_id)}</td>
              <td className="text-right">{canEdit && <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setEdit(c)}>Modifier</Button>}</td></tr>))}
            {categories.length === 0 && <tr><td colSpan={5} className="p-3 text-center text-muted-foreground">Aucune catégorie : créez-en une par famille d'immobilisations (matériel, mobilier, véhicules…).</td></tr>}</tbody>
        </table>
        {edit && (
          <div className="grid grid-cols-2 gap-2 border border-border rounded-md p-3">
            <div className="space-y-1"><Label className="text-xs" htmlFor="cat-name">Nom de la catégorie</Label><Input id="cat-name" className="h-8 text-xs" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs" htmlFor="cat-method">Méthode par défaut</Label>
              <select id="cat-method" className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs" value={edit.depreciation_method} onChange={(e) => setEdit({ ...edit, depreciation_method: e.target.value })}>
                <option value="straight_line">Linéaire</option><option value="declining_balance">Dégressif</option></select></div>
            {([["gl_asset_account_id", "Compte d'immobilisation (2x)", /^2[0-7]/], ["gl_depreciation_account_id", "Compte d'amortissements (28x)", /^28/], ["gl_expense_account_id", "Compte de dotation (68x)", /^68/]] as const).map(([k, l, re]) => (
              <div key={k} className="space-y-1"><Label className="text-xs" htmlFor={`cat-${k}`}>{l}</Label>
                <select id={`cat-${k}`} className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs" value={edit[k] ?? ""} onChange={(e) => setEdit({ ...edit, [k]: e.target.value || null })}>
                  <option value="">— choisir —</option>{pick(re).map((g) => <option key={g.id} value={g.id}>{g.code} — {g.name}</option>)}</select></div>))}
            <div className="col-span-2 flex gap-2"><Button size="sm" className="h-8 text-xs" disabled={!edit.name.trim() || !edit.gl_asset_account_id || !edit.gl_depreciation_account_id || !edit.gl_expense_account_id || save.isPending}
              onClick={() => save.mutate(edit, { onSuccess: () => setEdit(null) })}>Enregistrer la catégorie</Button>
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setEdit(null)}>Annuler</Button></div>
          </div>
        )}
        {!canEdit && <p className="text-[11px] text-muted-foreground">Lecture seule : le droit « Modifier les catégories et paramètres des immobilisations » est requis.</p>}
      </CardContent>
    </Card>
  );
}

export function AssetSettingsCard() {
  const { data: access } = useMyAccess();
  const canEdit = (access?.permissions ?? []).includes("assets.settings");
  const { data } = useAssetSettings();
  const save = useSaveAssetSettings();
  const [f, setF] = useState<AssetSettings | null>(null);
  const v = f ?? data;
  if (!v) return null;
  return (
    <Card className="border-border max-w-2xl">
      <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Amortissements</CardTitle></CardHeader>
      <CardContent className="p-4 pt-0 space-y-3 text-xs">
        <label className="flex items-center gap-2"><Switch aria-label="Prorata du premier mois" checked={v.first_month_prorata} disabled={!canEdit} onCheckedChange={(x) => setF({ ...v, first_month_prorata: x })} />
          Premier mois au prorata des jours (sinon : mois entier)</label>
        <p className="text-muted-foreground">Coefficients du dégressif selon la durée d'utilisation (pratique UEMOA courante 1,5 / 2 / 2,5 — à valider avec l'expert-comptable).</p>
        <div className="grid grid-cols-3 gap-2">
          {([["declining_coef_short", "Jusqu'à 4 ans"], ["declining_coef_mid", "5 à 6 ans"], ["declining_coef_long", "Plus de 6 ans"]] as const).map(([k, l]) => (
            <div key={k} className="space-y-1"><Label className="text-xs" htmlFor={`as-${k}`}>{l}</Label>
              <Input id={`as-${k}`} type="number" step="0.25" min="1" className="h-8 text-xs" value={v[k]} disabled={!canEdit} onChange={(e) => setF({ ...v, [k]: Number(e.target.value) })} /></div>))}
        </div>
        {canEdit && <Button size="sm" className="h-8 text-xs" disabled={!f || save.isPending} onClick={() => save.mutate(v, { onSuccess: () => setF(null) })}>Enregistrer</Button>}
      </CardContent>
    </Card>
  );
}
