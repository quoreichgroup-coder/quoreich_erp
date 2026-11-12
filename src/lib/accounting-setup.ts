/**
 * Paramétrage comptable (V18) : quel compte du plan porte chaque rôle comptable.
 *
 * Les comptabilisations automatiques ne citent aucun numéro de compte : elles demandent un rôle
 * (compte clients, ventes, TVA collectée, banque…). Un rôle sans compte actif fait refuser la
 * comptabilisation correspondante (erreur QG001).
 *
 * Ce module est pur : il reconstitue, à partir des lectures Supabase, exactement la vue que sert
 * l'API Java (`GET /api/v1/accounting/setup`), pour que l'écran soit le même quelle que soit la
 * source.
 */
import type { ApiSchemas } from "@/api";

export type AccountingSetup = ApiSchemas["AccountingSetupView"];
export type PostingAccount = ApiSchemas["PostingAccountView"];
export type AccountingFramework = ApiSchemas["AccountingFrameworkView"];
export type GlAccountOption = ApiSchemas["GlAccountOption"];

export interface RawPostingRole { code: string; label: string; module: string; description: string }
export interface RawFramework { code: string; name: string; scope: string; version: string; is_validated: boolean }
export interface RawMapping { role_code: string; gl_account_id: string }
export interface RawGlAccount { id: string; code: string; name: string; account_type: string; is_active: boolean }
export interface RawRoleDefault { role_code: string; account_code: string }

/** Ordre d'affichage des modules, puis des rôles : celui de l'API (module, code). */
const byModuleThenCode = (a: RawPostingRole, b: RawPostingRole) =>
  a.module.localeCompare(b.module) || a.code.localeCompare(b.code);

export function toFramework(f: RawFramework): AccountingFramework {
  return { code: f.code, name: f.name, scope: f.scope, version: f.version, validated: f.is_validated };
}

export function toGlAccountOption(a: RawGlAccount): GlAccountOption {
  return { id: a.id, code: a.code, name: a.name, accountType: a.account_type, active: a.is_active };
}

export function buildAccountingSetup(input: {
  framework: RawFramework | null;
  canEdit: boolean;
  roles: RawPostingRole[];
  mappings: RawMapping[];
  accounts: RawGlAccount[];
  defaults: RawRoleDefault[];
}): AccountingSetup {
  const accountById = new Map(input.accounts.map((a) => [a.id, a]));
  const mappingByRole = new Map(input.mappings.map((m) => [m.role_code, m.gl_account_id]));
  const defaultByRole = new Map(input.defaults.map((d) => [d.role_code, d.account_code]));

  const roles: PostingAccount[] = [...input.roles].sort(byModuleThenCode).map((r) => {
    const accountId = mappingByRole.get(r.code);
    const account = accountId ? accountById.get(accountId) : undefined;
    return {
      roleCode: r.code,
      label: r.label,
      module: r.module,
      description: r.description,
      glAccountId: accountId,
      accountCode: account?.code,
      accountName: account?.name,
      // Un compte inactif vaut un compte absent, comme côté base (posting_account()).
      ready: Boolean(accountId && account?.is_active),
      suggestedAccountCode: defaultByRole.get(r.code),
    };
  });

  return {
    framework: input.framework ? toFramework(input.framework) : undefined,
    canEdit: input.canEdit,
    complete: roles.every((r) => r.ready),
    roles,
  };
}

/** Rôles non utilisables, dans l'ordre d'affichage. */
export function missingRoles(setup: AccountingSetup): PostingAccount[] {
  return setup.roles.filter((r) => !r.ready);
}

export const MODULE_LABELS: Record<string, string> = {
  AR: "Clients",
  AP: "Fournisseurs",
  TRE: "Trésorerie",
};
