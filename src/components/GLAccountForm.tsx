import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useTaxCodes } from "@/hooks/use-tax-codes";
import { useMyAccess } from "@/hooks/use-my-access";
import { useTenantId } from "@/hooks/use-tenant";
import { useCodePattern } from "@/hooks/use-chart-frameworks";
import { ACCOUNT_TYPES, POSTING_MODES, ANALYTIC_POLICIES, defaultNormalBalance, validateCustomAttributes, type AttributeDefinition } from "@/lib/gl-account";

/*
 * Fiche compte du plan comptable (V62, lot PC-1) : tous les attributs sont paramétrables ; la base
 * contrôle (code et type figés si le compte est mouvementé, parent par préfixe, attributs
 * personnalisés obligatoires et listes) et journalise chaque modification.
 */
const sel = "w-full h-8 px-2 rounded-md border border-input bg-background text-xs";

export function useAttributeDefinitions() {
  return useQuery({
    queryKey: ["gl-attribute-definitions"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("gl_account_attribute_definitions").select("*").order("sort_order").order("label");
      if (error) throw error;
      return (data ?? []) as AttributeDefinition[];
    },
  });
}

function AccountHistory({ accountId }: { accountId: string }) {
  const { data: rows = [] } = useQuery({
    queryKey: ["gl-account-history", accountId],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("gl_account_history").select("*").eq("account_id", accountId).order("id", { ascending: false }).limit(30);
      if (error) throw error;
      return (data ?? []) as { id: number; action: string; changes: Record<string, unknown>; changed_at: string }[];
    },
  });
  if (rows.length === 0) return null;
  return (
    <section aria-label="Historique du compte" className="border-t border-border pt-3 space-y-1">
      <h3 className="text-xs font-semibold">Historique</h3>
      <ul className="text-[11px] text-muted-foreground max-h-32 overflow-auto space-y-0.5">
        {rows.map((r) => (
          <li key={r.id}>{new Date(r.changed_at).toLocaleString("fr-FR")} — {r.action === "insert" ? "création" : r.action === "update"
            ? Object.entries(r.changes).filter(([k]) => k !== "updated_at").map(([k, v]) => `${k} : ${JSON.stringify((v as unknown[])[0])} → ${JSON.stringify((v as unknown[])[1])}`).join(" ; ")
            : "suppression"}</li>
        ))}
      </ul>
    </section>
  );
}

export function GLAccountFormDialog({ open, onClose, account, accounts, mode, onCreate, onUpdate }: {
  open: boolean; onClose: () => void; account: any | null; accounts: any[]; mode: "create" | "edit"; onCreate: any; onUpdate: any;
}) {
  const { data: taxCodes = [] } = useTaxCodes();
  const { data: defs = [] } = useAttributeDefinitions();
  const codePattern = useCodePattern();
  const active = defs.filter((d) => d.is_active);
  const [f, setF] = useState<any>(() => account ? { ...account, custom_attributes: account.custom_attributes ?? {} } : {
    code: "", name: "", account_type: "asset", parent_id: null, is_active: true, is_header: false, normal_balance: "debit",
    posting_mode: "manual", reconcilable: false, analytic_policy: null, default_tax_code_id: null, currency_mode: "local", custom_attributes: {},
  });
  const set = (k: string, v: unknown) => setF((p: any) => ({ ...p, [k]: v }));
  const used = mode === "edit" && (Number(account?.debit_total ?? 0) > 0 || Number(account?.credit_total ?? 0) > 0);
  const attrError = validateCustomAttributes(active, f.custom_attributes ?? {}, f.is_header);
  const error = !f.code?.trim() || !f.name?.trim() ? "Code et intitulé requis." : codePattern && !codePattern.test(f.code.trim()) ? "Code : format du référentiel non respecté (règle « Format du code de compte »)." : attrError;

  const save = () => {
    if (error) return;
    const row = {
      name: f.name.trim(), account_type: f.account_type, parent_id: f.parent_id || null, is_header: !!f.is_header, normal_balance: f.normal_balance,
      posting_mode: f.posting_mode, reconcilable: !!f.reconcilable, analytic_policy: f.analytic_policy || null,
      default_tax_code_id: f.default_tax_code_id || null, currency_mode: f.currency_mode, custom_attributes: f.custom_attributes ?? {},
    };
    if (mode === "create") onCreate.mutate({ code: f.code.trim(), ...row }, { onSuccess: onClose });
    else onUpdate.mutate({ id: account.id, ...row, is_active: f.is_active, ...(used ? {} : { account_type: f.account_type }) }, { onSuccess: onClose });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">{mode === "create" ? "Nouveau compte" : `Compte ${account?.code}`}</DialogTitle>
          <DialogDescription className="text-xs">{used ? "Compte mouvementé : son code et son type sont figés (l'historique en dépend)." : "Tous les attributs sont paramétrables."}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="acc-code">Code *</Label>
            <Input id="acc-code" className="h-8 text-xs font-mono" value={f.code} disabled={mode === "edit"} onChange={(e) => set("code", e.target.value)} placeholder="ex. 5211" /></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="acc-name">Intitulé *</Label>
            <Input id="acc-name" className="h-8 text-xs" value={f.name} onChange={(e) => set("name", e.target.value)} /></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="acc-type">Type</Label>
            <select id="acc-type" className={sel} value={f.account_type} disabled={used}
              onChange={(e) => setF((p: any) => ({ ...p, account_type: e.target.value, normal_balance: defaultNormalBalance(e.target.value) }))}>
              {ACCOUNT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="acc-balance">Sens normal</Label>
            <select id="acc-balance" className={sel} value={f.normal_balance} onChange={(e) => set("normal_balance", e.target.value)}>
              <option value="debit">Débit</option><option value="credit">Crédit</option>
            </select></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="acc-parent">Compte parent</Label>
            <select id="acc-parent" className={sel} value={f.parent_id || ""} onChange={(e) => set("parent_id", e.target.value || null)}>
              <option value="">— (premier niveau)</option>
              {accounts.filter((a) => a.id !== account?.id && f.code?.startsWith(a.code) && a.code.length < f.code.length)
                .map((a) => <option key={a.id} value={a.id}>{a.code} – {a.name}</option>)}
            </select></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="acc-posting">Mode d'imputation</Label>
            <select id="acc-posting" className={sel} value={f.posting_mode} onChange={(e) => set("posting_mode", e.target.value)}>
              {POSTING_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="acc-analytic">Analytique</Label>
            <select id="acc-analytic" className={sel} value={f.analytic_policy ?? ""} onChange={(e) => set("analytic_policy", e.target.value || null)}>
              {ANALYTIC_POLICIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="acc-tax">Code TVA par défaut</Label>
            <select id="acc-tax" className={sel} value={f.default_tax_code_id ?? ""} onChange={(e) => set("default_tax_code_id", e.target.value || null)}>
              <option value="">—</option>{(taxCodes as any[]).map((t) => <option key={t.id} value={t.id}>{t.code} — {t.name}</option>)}
            </select></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="acc-currency">Devises</Label>
            <select id="acc-currency" className={sel} value={f.currency_mode} onChange={(e) => set("currency_mode", e.target.value)}>
              <option value="local">Devise de la société seulement</option><option value="any">Toutes devises</option>
            </select></div>
          <div className="flex items-center gap-4 col-span-2 flex-wrap">
            <label className="flex items-center gap-2 text-xs"><Switch checked={!!f.reconcilable} onCheckedChange={(v) => set("reconcilable", v)} aria-label="Lettrable" />Lettrable</label>
            <label className="flex items-center gap-2 text-xs"><Switch checked={!!f.is_header} disabled={used} onCheckedChange={(v) => set("is_header", v)} aria-label="Compte de regroupement" />Compte de regroupement (non imputable)</label>
            {mode === "edit" && <label className="flex items-center gap-2 text-xs"><Switch checked={!!f.is_active} onCheckedChange={(v) => set("is_active", v)} aria-label="Actif" />Actif</label>}
          </div>
          {active.length > 0 && (
            <fieldset className="col-span-2 grid grid-cols-2 gap-3 border border-border rounded p-3">
              <legend className="text-xs font-medium px-1">Attributs personnalisés</legend>
              {active.map((d) => {
                const v = (f.custom_attributes ?? {})[d.key];
                const put = (x: unknown) => set("custom_attributes", { ...(f.custom_attributes ?? {}), [d.key]: x });
                const id = `attr-${d.key}`;
                return (
                  <div key={d.id} className="space-y-1.5">
                    <Label className="text-xs" htmlFor={id}>{d.label}{d.required ? " *" : ""}</Label>
                    {d.data_type === "list" ? (
                      <select id={id} className={sel} value={v ?? ""} onChange={(e) => put(e.target.value || null)}>
                        <option value="">—</option>{(d.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : d.data_type === "boolean" ? (
                      <div><Switch id={id} checked={v === true} onCheckedChange={(x) => put(x)} /></div>
                    ) : (
                      <Input id={id} className="h-8 text-xs" type={d.data_type === "number" ? "number" : d.data_type === "date" ? "date" : "text"} value={v ?? ""}
                        onChange={(e) => put(d.data_type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value)} />
                    )}
                  </div>
                );
              })}
            </fieldset>
          )}
        </div>
        {error && (f.code || f.name) && <p className="text-xs text-destructive" role="alert">{error}</p>}
        {mode === "edit" && account?.id && <AccountHistory accountId={account.id} />}
        <DialogFooter>
          <Button variant="outline" size="sm" className="text-xs" onClick={onClose}>Annuler</Button>
          <Button size="sm" className="text-xs" disabled={!!error} onClick={save}>{mode === "create" ? "Créer" : "Enregistrer"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Définition des attributs personnalisés de la société (droit accounting.chart_admin). */
export function AttributeDefinitionsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: defs = [] } = useAttributeDefinitions();
  const { data: access } = useMyAccess();
  const canAdmin = (access?.permissions ?? []).includes("accounting.chart_admin");
  const { data: tenantId } = useTenantId();
  const [n, setN] = useState({ key: "", label: "", data_type: "text", options: "", required: false });
  const save = useMutation({
    mutationFn: async (row: Record<string, unknown>) => {
      const { data, error } = await (supabase as any).from("gl_account_attribute_definitions").upsert(row, { onConflict: "tenant_id,key" }).select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("Refusé : droit « Administrer les plans comptables et les attributs de compte » requis.");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["gl-attribute-definitions"] }); toast.success("Attribut enregistré"); setN({ key: "", label: "", data_type: "text", options: "", required: false }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const keyOk = /^[a-z][a-z0-9_]{0,39}$/.test(n.key);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-sm">Attributs personnalisés des comptes</DialogTitle>
          <DialogDescription className="text-xs">Champs propres à la société (texte, nombre, date, oui/non, liste), obligatoires ou non ; contrôlés par la base à chaque saisie.</DialogDescription>
        </DialogHeader>
        <table className="w-full text-xs">
          <thead><tr className="text-muted-foreground border-b border-border"><th className="text-left py-1">Clé</th><th className="text-left">Libellé</th><th className="text-left">Type</th><th className="text-left">Obligatoire</th><th className="text-left">Actif</th></tr></thead>
          <tbody>
            {defs.map((d) => (
              <tr key={d.id} className="border-b border-border/50">
                <td className="py-1 font-mono">{d.key}</td><td>{d.label}</td><td>{d.data_type}{d.options?.length ? ` (${d.options.join(", ")})` : ""}</td>
                <td>{d.required ? "Oui" : "Non"}</td>
                <td>{canAdmin ? <Switch checked={d.is_active} onCheckedChange={(v) => save.mutate({ ...d, is_active: v })} aria-label={`Actif ${d.key}`} /> : d.is_active ? "Oui" : "Non"}</td>
              </tr>
            ))}
            {defs.length === 0 && <tr><td colSpan={5} className="py-3 text-center text-muted-foreground">Aucun attribut.</td></tr>}
          </tbody>
        </table>
        {canAdmin && (
          <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
            <div className="space-y-1.5"><Label className="text-xs" htmlFor="def-key">Clé (minuscules)</Label><Input id="def-key" className="h-8 text-xs font-mono" value={n.key} onChange={(e) => setN({ ...n, key: e.target.value })} /></div>
            <div className="space-y-1.5"><Label className="text-xs" htmlFor="def-label">Libellé</Label><Input id="def-label" className="h-8 text-xs" value={n.label} onChange={(e) => setN({ ...n, label: e.target.value })} /></div>
            <div className="space-y-1.5"><Label className="text-xs" htmlFor="def-type">Type</Label>
              <select id="def-type" className={sel} value={n.data_type} onChange={(e) => setN({ ...n, data_type: e.target.value })}>
                {[["text", "Texte"], ["number", "Nombre"], ["date", "Date"], ["boolean", "Oui / non"], ["list", "Liste"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select></div>
            <div className="space-y-1.5"><Label className="text-xs" htmlFor="def-options">Valeurs (liste, séparées par des virgules)</Label>
              <Input id="def-options" className="h-8 text-xs" disabled={n.data_type !== "list"} value={n.options} onChange={(e) => setN({ ...n, options: e.target.value })} /></div>
            <label className="flex items-center gap-2 text-xs col-span-2"><Switch checked={n.required} onCheckedChange={(v) => setN({ ...n, required: v })} aria-label="Obligatoire" />Obligatoire</label>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Fermer</Button>
          {canAdmin && <Button size="sm" disabled={!keyOk || !n.label.trim() || (n.data_type === "list" && !n.options.trim()) || save.isPending}
            onClick={() => {
              save.mutate({ tenant_id: tenantId, key: n.key, label: n.label.trim(), data_type: n.data_type, required: n.required,
                options: n.data_type === "list" ? n.options.split(",").map((o) => o.trim()).filter(Boolean) : null });
            }}>Ajouter l'attribut</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
