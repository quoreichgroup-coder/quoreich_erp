import { useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { ExportButtons } from "@/components/ExportButtons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Plus } from "lucide-react";
import { useMyAccess } from "@/hooks/use-my-access";
import { useGlAccountOptions } from "@/hooks/use-accounting-setup";
import { useTaxCodes } from "@/hooks/use-tax-codes";
import { useGLAccounts } from "@/hooks/use-gl-data";
import { useExpenseCategories, useSaveExpenseCategory, type ExpenseCategory } from "@/hooks/use-expenses";
import { normalizeSetCode } from "@/lib/account-sets";

/*
 * Notes de frais → Données de base : catégories de frais de la société (compte de charge, code TVA
 * par défaut, seuil du justificatif, plafond par dépense). Aucune catégorie n'est pré-remplie ; une
 * catégorie utilisée se désactive, elle ne se supprime pas.
 */
const fmt = (n: number | null) => (n == null ? "—" : n.toLocaleString("fr-FR"));
const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(/\s/g, "").replace(",", ".")));

function CategoryDialog({ category, onClose }: { category: ExpenseCategory | null; onClose: () => void }) {
  // Comptes imputables seulement : ni regroupement, ni bloqués (la base les refuse à la comptabilisation).
  const { data: gl = [] } = useGLAccounts();
  const { data: taxes = [] } = useTaxCodes();
  const save = useSaveExpenseCategory();
  const [f, setF] = useState({
    code: category?.code ?? "", name: category?.name ?? "", gl_account_id: category?.gl_account_id ?? "", default_tax_code_id: category?.default_tax_code_id ?? "",
    receipt: category?.receipt_required_above == null ? "" : String(category.receipt_required_above), max: category?.max_amount_per_line == null ? "" : String(category.max_amount_per_line),
    is_active: category?.is_active ?? true,
  });
  const code = normalizeSetCode(f.code);
  const charges = (gl as any[]).filter((a) => a.id === f.gl_account_id
    || (a.is_active && a.account_type === "expense" && !a.is_header && a.posting_mode !== "blocked"));
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">{category ? `Catégorie ${category.code}` : "Nouvelle catégorie de frais"}</DialogTitle>
          <DialogDescription className="text-xs">Le compte de charge reçoit le montant HT des dépenses de la catégorie à la comptabilisation.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><label htmlFor="cat-code" className="text-xs font-medium">Code *</label>
            <Input id="cat-code" className="h-8 text-xs" value={f.code} disabled={!!category} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="DEPL" /></div>
          <div className="space-y-1"><label htmlFor="cat-name" className="text-xs font-medium">Libellé *</label>
            <Input id="cat-name" className="h-8 text-xs" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Déplacements" /></div>
          <div className="space-y-1 col-span-2"><label htmlFor="cat-account" className="text-xs font-medium">Compte de charge *</label>
            <select id="cat-account" className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs" value={f.gl_account_id} onChange={(e) => setF({ ...f, gl_account_id: e.target.value })}>
              <option value="">— choisir —</option>{charges.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}</select></div>
          <div className="space-y-1 col-span-2"><label htmlFor="cat-tax" className="text-xs font-medium">Code TVA par défaut</label>
            <select id="cat-tax" className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs" value={f.default_tax_code_id} onChange={(e) => setF({ ...f, default_tax_code_id: e.target.value })}>
              <option value="">Sans TVA récupérable</option>{taxes.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.code} — {t.name} ({t.rate} %)</option>)}</select></div>
          <div className="space-y-1"><label htmlFor="cat-receipt" className="text-xs font-medium">Justificatif exigé à partir de</label>
            <Input id="cat-receipt" inputMode="decimal" className="h-8 text-xs" value={f.receipt} placeholder="vide = paramètre général" onChange={(e) => setF({ ...f, receipt: e.target.value })} /></div>
          <div className="space-y-1"><label htmlFor="cat-max" className="text-xs font-medium">Plafond par dépense</label>
            <Input id="cat-max" inputMode="decimal" className="h-8 text-xs" value={f.max} placeholder="vide = aucun" onChange={(e) => setF({ ...f, max: e.target.value })} /></div>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} /> Active</label>
        </div>
        {f.code && !code && <p className="text-xs text-destructive">Code : lettres, chiffres, « _ » ou « - », 20 caractères au plus.</p>}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Annuler</Button>
          <Button size="sm" disabled={!code || !f.name.trim() || !f.gl_account_id || save.isPending}
            onClick={() => save.mutate({ id: category?.id, code: code!, name: f.name.trim(), gl_account_id: f.gl_account_id, default_tax_code_id: f.default_tax_code_id || null,
              receipt_required_above: num(f.receipt), max_amount_per_line: num(f.max), is_active: f.is_active }, { onSuccess: onClose })}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ExpenseMasterData() {
  const { data: categories = [], isLoading } = useExpenseCategories();
  const accounts = useGlAccountOptions();
  const { data: taxes = [] } = useTaxCodes();
  const { data: access } = useMyAccess();
  const can = (access?.permissions ?? []).includes("expenses.settings");
  const [open, setOpen] = useState<ExpenseCategory | null | "new">(null);
  const acc = new Map((accounts.data ?? []).map((a) => [a.id, a]));
  const tax = new Map(taxes.map((t) => [t.id, t]));
  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Achats et fournisseurs" }, { label: "Notes de frais", href: "/expenses" }, { label: "Données de base" }]} />
      <GuidanceBanner title="Catégories de frais" description="Chaque catégorie porte son compte de charge, son code TVA par défaut, le seuil à partir duquel un justificatif est exigé et un plafond par dépense. Les salariés sont ceux du module RH." />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-lg font-semibold">Notes de frais — Données de base</h1>
        <div className="flex gap-2">
          <ExportButtons label="Exporter les catégories" rows={categories.map((c) => ({ code: c.code, libelle: c.name, compte: acc.get(c.gl_account_id)?.code ?? "", tva: c.default_tax_code_id ? tax.get(c.default_tax_code_id)?.code ?? "" : "",
            justificatif: c.receipt_required_above ?? "", plafond: c.max_amount_per_line ?? "", active: c.is_active ? "oui" : "non" }))}
            columns={[{ key: "code", header: "Code" }, { key: "libelle", header: "Libellé" }, { key: "compte", header: "Compte" }, { key: "tva", header: "Code TVA" },
              { key: "justificatif", header: "Justificatif à partir de" }, { key: "plafond", header: "Plafond par dépense" }, { key: "active", header: "Active" }]} filename="categories-de-frais" />
          {can && <Button size="sm" className="gap-1.5" onClick={() => setOpen("new")}><Plus className="w-3.5 h-3.5" /> Nouvelle catégorie</Button>}
        </div>
      </div>
      <div className="card-elevated overflow-x-auto">
        {isLoading ? <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin" /></div> : (
          <table className="w-full text-xs" data-testid="expense-categories">
            <thead><tr className="bg-muted/30 text-muted-foreground"><th className="text-left p-2">Code</th><th className="text-left">Libellé</th><th className="text-left">Compte de charge</th>
              <th className="text-left">Code TVA</th><th className="text-right">Justificatif dès</th><th className="text-right">Plafond</th><th className="text-left pl-3">État</th></tr></thead>
            <tbody>
              {categories.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Aucune catégorie : en créer une pour saisir des notes de frais.</td></tr>}
              {categories.map((c) => (
                <tr key={c.id} data-testid="expense-category-row" className={`border-t border-border/50 ${can ? "cursor-pointer hover:bg-muted/30" : ""}`} onClick={() => can && setOpen(c)}>
                  <td className="p-2 font-mono">{c.code}</td><td>{c.name}</td>
                  <td>{acc.get(c.gl_account_id) ? `${acc.get(c.gl_account_id)!.code} — ${acc.get(c.gl_account_id)!.name}` : "—"}</td>
                  <td>{c.default_tax_code_id ? tax.get(c.default_tax_code_id)?.code ?? "—" : "—"}</td>
                  <td className="text-right tabular-nums">{fmt(c.receipt_required_above)}</td><td className="text-right tabular-nums">{fmt(c.max_amount_per_line)}</td>
                  <td className="pl-3"><StatusBadge status={c.is_active ? "success" : "neutral"} label={c.is_active ? "Active" : "Inactive"} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {open && <CategoryDialog category={open === "new" ? null : open} onClose={() => setOpen(null)} />}
    </PageShell>
  );
}
