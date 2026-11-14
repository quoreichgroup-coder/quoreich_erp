import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { ExportButtons } from "@/components/ExportButtons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useGLAccounts } from "@/hooks/use-gl-data";
import { useMyAccess } from "@/hooks/use-my-access";
import { useSaveTreasuryAccount, useSetDefaultTreasuryAccount, useTreasuryAccounts, type TreasuryAccountInput } from "@/hooks/use-treasury-accounts";
import { KIND_HINT, KIND_LABEL, validateTreasuryAccount, type TreasuryAccount, type TreasuryKind } from "@/lib/treasury-accounts";

/*
 * Trésorerie → Données de base (V70) : comptes de trésorerie réels — banque, caisse, mobile money —,
 * chacun relié à son compte général de classe 5, solde d'ouverture daté, compte par défaut par type.
 * Le solde affiché est calculé (ouverture + mouvements) ; il ne se saisit pas.
 */
const fmt = (n: number, c = "XOF") => `${Number(n || 0).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} ${c}`;
const KINDS: TreasuryKind[] = ["bank", "cash", "mobile_money"];

export default function TreasuryMasterData() {
  const { data: accounts = [], isPending: isLoading, error } = useTreasuryAccounts();
  const { data: gl = [] } = useGLAccounts();
  const { data: access } = useMyAccess();
  const canManage = (access?.permissions ?? []).includes("treasury.manage_accounts");
  const setDefault = useSetDefaultTreasuryAccount();
  const [edit, setEdit] = useState<TreasuryAccount | "new" | null>(null);
  const glCode = (id: string | null) => gl.find((g: any) => g.id === id);

  const rows = accounts.map((a) => ({
    nom: a.name, type: KIND_LABEL[a.account_type], banque: a.bank_name ?? "", numero: a.account_number ?? "", devise: a.currency,
    compte: glCode(a.gl_account_id)?.code ?? "", ouverture: a.opening_balance, solde: a.balance, defaut: a.is_default ? "oui" : "non", actif: a.is_active ? "oui" : "non",
  }));

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Comptabilité et finance" }, { label: "Trésorerie", href: "/treasury" }, { label: "Données de base" }]} />
      <GuidanceBanner title="Comptes de trésorerie" description="Banques, caisses et comptes mobile money de la société. Chaque compte a son compte comptable (classe 5) : les règlements, acomptes et virements y sont comptabilisés et y créent leur mouvement, rapprochable avec le relevé." />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold">Comptes de trésorerie</h1>
          <p className="text-xs text-muted-foreground">{accounts.filter((a) => a.is_active).length} compte(s) actif(s) · le compte par défaut d'un type est proposé pour les règlements de ce mode</p>
        </div>
        <div className="flex gap-2">
          <ExportButtons label="Exporter les comptes" rows={rows} filename="comptes-de-tresorerie" sheetName="Comptes de trésorerie"
            columns={[{ key: "nom", header: "Nom", width: 28 }, { key: "type", header: "Type", width: 14 }, { key: "banque", header: "Banque / opérateur", width: 22 },
              { key: "numero", header: "Numéro / IBAN", width: 30 }, { key: "devise", header: "Devise", width: 8 }, { key: "compte", header: "Compte comptable", width: 16 },
              { key: "ouverture", header: "Solde d'ouverture", width: 18 }, { key: "solde", header: "Solde", width: 18 }, { key: "defaut", header: "Par défaut", width: 11 },
              { key: "actif", header: "Actif", width: 8 }]} />
          {canManage && <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setEdit("new")}><Plus className="w-3.5 h-3.5" /> Ajouter un compte de trésorerie</Button>}
        </div>
      </div>
      {error && <p className="text-xs text-destructive" role="alert">{(error as Error).message}</p>}
      {isLoading ? <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div> : (
        <div className="card-elevated overflow-x-auto">
          <table className="w-full text-xs" data-testid="treasury-accounts">
            <thead><tr className="bg-muted/30 text-muted-foreground">
              <th className="text-left p-2">Compte</th><th className="text-left">Type</th><th className="text-left">Banque / opérateur</th><th className="text-left">Compte comptable</th>
              <th className="text-right">Solde d'ouverture</th><th className="text-right">Solde</th><th className="text-left pl-3">État</th><th />
            </tr></thead>
            <tbody>
              {accounts.length === 0 && <tr><td colSpan={8} className="p-4 text-center text-muted-foreground">Aucun compte de trésorerie : les règlements passent sur le compte du rôle « Banque » (ou Caisse / Monnaie électronique) du paramétrage comptable.</td></tr>}
              {accounts.map((a) => (
                <tr key={a.id} data-testid="treasury-account-row" className="border-t border-border/50">
                  <td className="p-2"><p className="font-medium">{a.name}</p><p className="text-muted-foreground font-mono text-[10px]">{a.account_number ?? ""}</p></td>
                  <td>{KIND_LABEL[a.account_type]}</td><td>{a.bank_name ?? "—"}</td>
                  <td>{glCode(a.gl_account_id) ? <><span className="font-mono">{glCode(a.gl_account_id)!.code}</span> {glCode(a.gl_account_id)!.name}</> : <span className="text-destructive">à renseigner</span>}</td>
                  <td className="text-right tabular-nums">{fmt(a.opening_balance, a.currency)}</td>
                  <td className="text-right tabular-nums font-medium" data-testid="treasury-account-balance">{fmt(a.balance, a.currency)}</td>
                  <td className="pl-3 space-x-1">{a.is_active ? <StatusBadge status="success" label="Actif" /> : <StatusBadge status="neutral" label="Inactif" />}
                    {a.is_default && <StatusBadge status="info" label="Par défaut" />}</td>
                  <td className="pr-2 text-right whitespace-nowrap">
                    {canManage && a.is_active && !a.is_default && <Button size="sm" variant="ghost" className="h-6 text-[10px]" disabled={setDefault.isPending} onClick={() => setDefault.mutate(a.id)}>Par défaut</Button>}
                    {canManage && <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setEdit(a)}>Modifier</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!canManage && <p className="text-[11px] text-muted-foreground">Lecture seule : le droit « Gérer les comptes de trésorerie » est requis pour créer ou modifier un compte.</p>}
      {edit && <AccountDialog account={edit === "new" ? null : edit} gl={gl as any[]} onClose={() => setEdit(null)} />}
    </PageShell>
  );
}

function AccountDialog({ account, gl, onClose }: { account: TreasuryAccount | null; gl: any[]; onClose: () => void }) {
  const save = useSaveTreasuryAccount();
  const [f, setF] = useState<TreasuryAccountInput>(() => account ? {
    id: account.id, name: account.name, bank_name: account.bank_name ?? "", account_number: account.account_number ?? "", currency: account.currency,
    account_type: account.account_type, gl_account_id: account.gl_account_id ?? "", opening_balance: account.opening_balance, opening_date: account.opening_date, is_active: account.is_active,
  } : { name: "", bank_name: "", account_number: "", currency: "XOF", account_type: "bank", gl_account_id: "", opening_balance: 0, opening_date: new Date().toISOString().slice(0, 10), is_active: true });
  const set = <K extends keyof TreasuryAccountInput>(k: K, v: TreasuryAccountInput[K]) => setF((p) => ({ ...p, [k]: v }));
  const prefix = f.account_type === "cash" ? "57" : f.account_type === "mobile_money" ? "55" : "5";
  const choices = gl.filter((g) => g.is_active && !g.is_header && g.code.startsWith(prefix) && (f.account_type !== "bank" || /^5[237]/.test(g.code)));
  const error = validateTreasuryAccount({ name: f.name, account_type: f.account_type, currency: f.currency, gl_code: gl.find((g) => g.id === f.gl_account_id)?.code });
  const used = !!account && Number(account.balance) !== Number(account.opening_balance);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">{account ? `Modifier ${account.name}` : "Nouveau compte de trésorerie"}</DialogTitle>
          <DialogDescription className="text-xs">Le compte comptable reçoit les écritures des règlements de ce compte. Une fois le compte mouvementé, compte comptable, devise et solde d'ouverture sont figés.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5"><Label className="text-xs" htmlFor="ta-name">Nom du compte *</Label>
            <Input id="ta-name" className="h-8 text-xs" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="BOA compte courant, Caisse siège, Orange Money…" /></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="ta-type">Type *</Label>
            <select id="ta-type" className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs" value={f.account_type} disabled={!!account}
              onChange={(e) => { set("account_type", e.target.value as TreasuryKind); set("gl_account_id", ""); }}>
              {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="ta-gl">Compte comptable * ({KIND_HINT[f.account_type]})</Label>
            <select id="ta-gl" className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs" value={f.gl_account_id} disabled={used} onChange={(e) => set("gl_account_id", e.target.value)}>
              <option value="">— choisir —</option>
              {choices.map((g) => <option key={g.id} value={g.id}>{g.code} — {g.name}</option>)}
            </select></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="ta-bank">{f.account_type === "mobile_money" ? "Opérateur" : f.account_type === "cash" ? "Lieu" : "Banque"}</Label>
            <Input id="ta-bank" className="h-8 text-xs" value={f.bank_name} onChange={(e) => set("bank_name", e.target.value)} /></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="ta-number">{f.account_type === "mobile_money" ? "Numéro de téléphone" : "Numéro / IBAN"}</Label>
            <Input id="ta-number" className="h-8 text-xs font-mono" value={f.account_number} onChange={(e) => set("account_number", e.target.value)} /></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="ta-currency">Devise</Label>
            <Input id="ta-currency" className="h-8 text-xs w-24" maxLength={3} value={f.currency} disabled={used} onChange={(e) => set("currency", e.target.value.toUpperCase())} /></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="ta-opening">Solde d'ouverture</Label>
            <Input id="ta-opening" type="number" step="0.01" className="h-8 text-xs" value={f.opening_balance} disabled={used} onChange={(e) => set("opening_balance", Number(e.target.value))} /></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="ta-opening-date">Au</Label>
            <Input id="ta-opening-date" type="date" className="h-8 text-xs" value={f.opening_date ?? ""} disabled={used} onChange={(e) => set("opening_date", e.target.value || null)} /></div>
          <label className="flex items-end gap-2 text-xs pb-1.5"><Switch aria-label="Compte actif" checked={f.is_active} onCheckedChange={(v) => set("is_active", v)} />Actif</label>
        </div>
        {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Annuler</Button>
          <Button size="sm" disabled={!!error || save.isPending} onClick={() => save.mutate({ ...f, bank_name: f.bank_name.trim(), name: f.name.trim() }, { onSuccess: onClose })}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
