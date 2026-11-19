/*
 * Jeux de comptes (V105) : logique pure, testée sans base.
 *
 * Résolution identique à la base (`posting_account_for`) : la ligne du jeu de la fiche, sinon le compte
 * par défaut de la société. Un jeu inactif ne compte pas ; une ligne dont le compte est inactif rend le
 * compte manquant (pas de repli silencieux).
 */
export type AccountSetKind = "customer" | "supplier" | "item";

export const KIND_LABELS: Record<AccountSetKind, { one: string; many: string }> = {
  customer: { one: "client", many: "Jeux de comptes clients" },
  supplier: { one: "fournisseur", many: "Jeux de comptes fournisseurs" },
  item: { one: "article", many: "Jeux de comptes articles" },
};

/** Code saisi → code accepté par la base (^[A-Z0-9][A-Z0-9_-]{0,19}$), ou null s'il reste invalide. */
export function normalizeSetCode(raw: string): string | null {
  const c = raw.trim().toUpperCase().replace(/\s+/g, "_");
  return /^[A-Z0-9][A-Z0-9_-]{0,19}$/.test(c) ? c : null;
}

export interface ResolvableSet { is_active: boolean; lines: { role_code: string; gl_account_id: string }[] }

export type Resolution =
  | { source: "set"; accountId: string | null }
  | { source: "default"; accountId: string | null };

export function resolveAccount(role: string, set: ResolvableSet | null | undefined, defaults: Map<string, string>,
  activeAccounts: Set<string>): Resolution {
  const line = set && set.is_active ? set.lines.find((l) => l.role_code === role) : undefined;
  if (line) return { source: "set", accountId: activeAccounts.has(line.gl_account_id) ? line.gl_account_id : null };
  const d = defaults.get(role);
  return { source: "default", accountId: d && activeAccounts.has(d) ? d : null };
}
