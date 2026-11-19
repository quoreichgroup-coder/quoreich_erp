import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Lock, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { StatusBadge } from "@/components/StatusBadge";
import { PostingAccountsPanel } from "@/components/PostingAccountsPanel";
import { useAccountingSetup, useGlAccountOptions } from "@/hooks/use-accounting-setup";
import {
  useAccountSets, useCreateAccountSet, useDeleteAccountSet, usePostingLock, useRoleKinds,
  useSetAccountSetLine, useSetPostingLock, useUpdateAccountSet, type AccountSet,
} from "@/hooks/use-account-sets";
import { useMyAccess } from "@/hooks/use-my-access";
import { isApiEnabled } from "@/api/client";
import { KIND_LABELS, normalizeSetCode, type AccountSetKind } from "@/lib/account-sets";

/*
 * Comptabilisation paramétrable par module (V105), structurée comme SAP (détermination des comptes
 * par opération puis par groupe) et Sage 300 / X3 (jeu de comptes ou code comptable sur la fiche) :
 *   1. compte par défaut de chaque rôle (PostingAccountsPanel) ;
 *   2. jeux de comptes par type de fiche, qui remplacent le défaut pour leurs fiches ;
 *   3. le jeu se choisit sur la fiche client, fournisseur ou article (AccountSetSelect).
 */

function useCanManage() {
  const { data } = useMyAccess();
  return (data?.permissions ?? []).includes("accounting.account_sets");
}

/** Jeux d'un type : création, compte par rôle (vide = défaut de la société), activation, suppression. */
export function AccountSetsPanel({ kind }: { kind: AccountSetKind }) {
  const sets = useAccountSets(kind);
  const kinds = useRoleKinds();
  const setup = useAccountingSetup();
  const accounts = useGlAccountOptions();
  const create = useCreateAccountSet();
  const update = useUpdateAccountSet();
  const remove = useDeleteAccountSet();
  const setLine = useSetAccountSetLine();
  const canManage = useCanManage();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const codeId = useId();
  const nameId = useId();

  if (isApiEnabled()) {
    return <p className="text-xs text-muted-foreground" data-testid={`account-sets-${kind}`}>Les jeux de comptes se paramètrent depuis le nuage pour l'instant ; sur site, le compte par défaut de chaque rôle s'applique.</p>;
  }
  const roles = (kinds.data ?? []).filter((k) => k.kind === kind);
  const labelOf = new Map((setup.data?.roles ?? []).map((r) => [r.roleCode, r]));
  const options = (accounts.data ?? []).filter((a) => a.active);
  const normalized = normalizeSetCode(code);

  return (
    <section className="bg-card border border-border rounded-lg p-5 space-y-4" data-testid={`account-sets-${kind}`} aria-label={KIND_LABELS[kind].many}>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">{KIND_LABELS[kind].many}</h3>
        <p className="text-xs text-muted-foreground max-w-2xl">
          Un jeu regroupe des fiches {KIND_LABELS[kind].one} qui se comptabilisent sur d'autres comptes que ceux par défaut
          (ex. clients du groupe en 4111, fournisseurs étrangers en 4012, matières premières en 321). Un rôle laissé vide reprend
          le compte par défaut de la société. Le jeu se choisit sur la fiche {KIND_LABELS[kind].one}.
        </p>
      </div>

      {canManage && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label htmlFor={codeId} className="text-[11px] text-muted-foreground">Code du jeu</label>
            <Input id={codeId} className="h-8 w-36 text-xs" value={code} onChange={(e) => setCode(e.target.value)} placeholder="GROUPE" />
          </div>
          <div className="space-y-1">
            <label htmlFor={nameId} className="text-[11px] text-muted-foreground">Libellé du jeu</label>
            <Input id={nameId} className="h-8 w-64 text-xs" value={name} onChange={(e) => setName(e.target.value)} placeholder="Clients du groupe" />
          </div>
          <Button size="sm" className="h-8 text-xs gap-1" disabled={!normalized || !name.trim() || create.isPending}
            onClick={() => create.mutate({ kind, code: normalized!, name: name.trim() }, { onSuccess: () => { setCode(""); setName(""); } })}>
            <Plus className="w-3.5 h-3.5" /> Créer le jeu
          </Button>
          {code && !normalized && <span className="text-[11px] text-destructive">Code : lettres, chiffres, « _ » ou « - », 20 caractères au plus.</span>}
        </div>
      )}

      {sets.isLoading ? <p className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Chargement…</p>
        : sets.isError ? <p className="text-xs text-destructive" role="alert">{(sets.error as Error).message}</p>
        : (sets.data ?? []).length === 0 ? <p className="text-xs text-muted-foreground">Aucun jeu : toutes les fiches utilisent les comptes par défaut.</p>
        : (sets.data ?? []).map((s: AccountSet) => (
          <div key={s.id} className="border border-border rounded-md p-3 space-y-2" data-testid="account-set">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-semibold">{s.code}</span>
              <span className="text-xs">{s.name}</span>
              <StatusBadge status={s.is_active ? "success" : "neutral"} label={s.is_active ? "Actif" : "Inactif"} />
              <span className="text-[11px] text-muted-foreground">{s.members} fiche(s)</span>
              {canManage && (
                <span className="ml-auto flex gap-1">
                  <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={update.isPending}
                    onClick={() => update.mutate({ id: s.id, is_active: !s.is_active })}>{s.is_active ? "Désactiver" : "Activer"}</Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" disabled={remove.isPending || s.members > 0}
                    title={s.members > 0 ? "Jeu utilisé par des fiches" : undefined}
                    onClick={() => { if (window.confirm(`Supprimer le jeu ${s.code} ?`)) remove.mutate(s.id); }}>Supprimer</Button>
                </span>
              )}
            </div>
            <table className="w-full text-xs">
              <thead><tr className="text-muted-foreground"><th className="text-left py-1">Rôle</th><th className="text-left">Compte du jeu</th><th className="text-left">Par défaut</th></tr></thead>
              <tbody>
                {roles.map((r) => {
                  const line = s.lines.find((l) => l.role_code === r.role_code);
                  const def = labelOf.get(r.role_code);
                  return (
                    <tr key={r.role_code} className="border-t border-border/50">
                      <td className="py-1.5 pr-2">{def?.label ?? r.role_code}{r.control && <Lock className="inline w-3 h-3 ml-1 text-muted-foreground" aria-label="compte de bilan verrouillé si postes ouverts" />}</td>
                      <td className="pr-2">
                        <select aria-label={`Compte « ${def?.label ?? r.role_code} » du jeu ${s.code}`} className="h-7 rounded border border-input bg-background px-1 text-xs max-w-[18rem]"
                          disabled={!canManage || setLine.isPending} value={line?.gl_account_id ?? ""}
                          onChange={(e) => setLine.mutate({ set: s, role: r.role_code, glAccountId: e.target.value || null })}>
                          <option value="">— compte par défaut —</option>
                          {options.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                        </select>
                      </td>
                      <td className="text-muted-foreground">{def?.accountCode ? `${def.accountCode} — ${def.accountName ?? ""}` : "non paramétré"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
    </section>
  );
}

/** Champ « Jeu de comptes » d'une fiche ; vide = comptes par défaut. */
export function AccountSetSelect({ kind, value, onChange, disabled, id }: {
  kind: AccountSetKind; value: string | null | undefined; onChange: (v: string | null) => void; disabled?: boolean; id?: string;
}) {
  const sets = useAccountSets(kind);
  const own = useId();
  if (isApiEnabled()) return null;
  const actifs = (sets.data ?? []).filter((s) => s.is_active || s.id === value);
  return (
    <div className="space-y-1">
      <label htmlFor={id ?? own} className="text-xs font-medium">Jeu de comptes</label>
      <select id={id ?? own} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" disabled={disabled}
        value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Comptes par défaut de la société</option>
        {actifs.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}{s.is_active ? "" : " (inactif)"}</option>)}
      </select>
    </div>
  );
}

/** Verrouillage des comptes de bilan (créances, dettes, acomptes, factures non parvenues, stock). */
export function PostingLockSetting() {
  const lock = usePostingLock();
  const save = useSetPostingLock();
  const canManage = useCanManage();
  const id = useId();
  if (isApiEnabled()) return null;
  return (
    <div className="bg-card border border-border rounded-lg p-4 flex items-start gap-3" data-testid="posting-lock-setting">
      <Switch id={id} checked={lock.data ?? true} disabled={!canManage || lock.isLoading || save.isPending} onCheckedChange={(v) => save.mutate(v)} />
      <div className="space-y-1">
        <label htmlFor={id} className="text-sm font-medium">Verrouiller les comptes de bilan tant que des postes sont ouverts</label>
        <p className="text-xs text-muted-foreground max-w-2xl">
          Recommandé (règle SAP / Sage) : on ne change ni le jeu d'une fiche qui a des factures, acomptes ou avoirs ouverts (ou du stock),
          ni le compte clients, fournisseurs, acomptes, factures non parvenues ou stock qu'elle utilise — sinon l'encaissement ou le
          lettrage partirait sur un autre compte que la facture. Pour reclasser un solde, utiliser le remplacement de compte du plan comptable.
        </p>
      </div>
    </div>
  );
}

/**
 * Onglet « Comptabilisation » d'un module : comptes par défaut de ses rôles, puis ses jeux de comptes.
 * `extra` : paramétrage propre au module (ex. catégories d'immobilisations).
 */
export function ModulePostingSettings({ modules, kinds = [], extra, lock = false }: {
  modules?: string[]; kinds?: AccountSetKind[]; extra?: React.ReactNode; lock?: boolean;
}) {
  return (
    <div className="max-w-5xl space-y-4" data-testid="module-posting-settings">
      <PostingAccountsPanel modules={modules} />
      {extra}
      {kinds.map((k) => <AccountSetsPanel key={k} kind={k} />)}
      {lock && <PostingLockSetting />}
      <p className="text-[11px] text-muted-foreground">
        Comptes des taxes : <Link className="text-primary underline" to="/settings?tab=tax">codes TVA</Link> · comptes de trésorerie :{" "}
        <Link className="text-primary underline" to="/treasury/master-data">comptes de trésorerie</Link> · vue d'ensemble :{" "}
        <Link className="text-primary underline" to="/settings?tab=posting">paramétrage comptable central</Link>.
      </p>
    </div>
  );
}

/** Module pas encore construit : aucune comptabilisation n'existe, donc rien à paramétrer — dit en clair. */
export function PostingPendingNotice({ module }: { module: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4 text-xs text-muted-foreground max-w-3xl" data-testid="posting-pending-notice">
      La comptabilisation des {module} n'existe pas encore : aucun compte n'est utilisé aujourd'hui. Elle sera paramétrable ici, par rôle et par
      jeu de comptes comme les autres modules, quand le module sera construit. Les comptes par défaut de la société se règlent dans le{" "}
      <Link className="text-primary underline" to="/settings?tab=posting">paramétrage comptable central</Link>.
    </div>
  );
}
