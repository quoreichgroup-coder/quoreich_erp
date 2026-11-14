/*
 * Comptes de trésorerie (V70, lot T1) : banque, caisse, monnaie électronique, chacun relié à son
 * compte général de classe 5. Règles pures partagées par les écrans ; la base les applique aussi.
 */
export type TreasuryKind = "bank" | "cash" | "mobile_money";
export type TreasuryAccount = {
  id: string; name: string; bank_name: string | null; account_number: string | null; currency: string; account_type: TreasuryKind;
  gl_account_id: string | null; opening_balance: number; opening_date: string | null; balance: number; is_default: boolean; is_active: boolean;
  last_reconciled_at: string | null;
};

export const KIND_LABEL: Record<TreasuryKind, string> = { bank: "Banque", cash: "Caisse", mobile_money: "Mobile money" };
/** Classe attendue par type (SYSCOHADA révisé : 52 banques, 57 caisse, 55 monnaie électronique). */
export const KIND_HINT: Record<TreasuryKind, string> = { bank: "52x (banques)", cash: "57x (caisse)", mobile_money: "55x (monnaie électronique)" };

/** Type de compte de trésorerie attendu pour un mode de paiement (même règle que la base). */
export function kindForMethod(method: string): TreasuryKind {
  return method === "cash" ? "cash" : method === "mobile_money" ? "mobile_money" : "bank";
}

/** Comptes proposés pour un mode de paiement : actifs, du bon type, le compte par défaut en premier. */
export function accountsForMethod(accounts: TreasuryAccount[], method: string): TreasuryAccount[] {
  const kind = kindForMethod(method);
  return accounts.filter((a) => a.is_active && a.account_type === kind).sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.name.localeCompare(b.name));
}

export function defaultAccountFor(accounts: TreasuryAccount[], method: string): string {
  return accountsForMethod(accounts, method).find((a) => a.is_default)?.id ?? "";
}

export const SOURCE_LABEL: Record<string, string> = {
  payment: "Règlement", advance: "Acompte", refund: "Remboursement", transfer: "Virement interne", manual: "Mouvement manuel", statement: "Relevé",
};

/** Contrôle de saisie d'un compte de trésorerie (messages en clair, comme la base). */
export function validateTreasuryAccount(f: { name: string; account_type: TreasuryKind; gl_code?: string | null; currency: string }): string | null {
  if (!f.name.trim()) return "Nom du compte requis.";
  if (!/^[A-Z]{3}$/.test(f.currency)) return "Devise : code ISO à 3 lettres (XOF, EUR…).";
  if (!f.gl_code) return "Compte comptable requis : chaque compte de trésorerie a son compte général.";
  const prefix = f.account_type === "cash" ? "57" : f.account_type === "mobile_money" ? "55" : "52";
  if (!f.gl_code.startsWith(prefix) && !(f.account_type === "bank" && /^5[37]/.test(f.gl_code)))
    return `Compte comptable ${f.gl_code} : un compte ${KIND_LABEL[f.account_type].toLowerCase()} attend un compte ${KIND_HINT[f.account_type]}.`;
  return null;
}
