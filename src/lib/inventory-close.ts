// Pure helpers that mirror the server-side `close_inventory_period` RPC.
// Kept in lockstep with the SQL function so we can unit-test the contract
// (period validation, permission gate, idempotence, audit trail) without a
// live database round-trip.

export const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export type CloseStatus = "ok" | "idempotent" | "forbidden" | "invalid_period" | "no_tenant";

export type CloseResult = {
  status: CloseStatus;
  message: string;
  /** YYYY-MM the call targeted. */
  period: string;
  /** True only on the first successful close — drives "Période clôturée" toast. */
  created: boolean;
  /** True when an audit row was written (always for ok/idempotent). */
  audited: boolean;
};

export function isValidPeriod(period: string): boolean {
  return PERIOD_RE.test(period);
}

export function currentPeriod(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** Localised, action-oriented message for the close UI. */
export function closeMessage(status: CloseStatus, period: string): string {
  switch (status) {
    case "ok":             return `Période ${period} clôturée et verrouillée.`;
    case "idempotent":     return `Période ${period} déjà clôturée — aucune nouvelle écriture.`;
    case "forbidden":      return "Action refusée — rôle Contrôleur Stock requis.";
    case "invalid_period": return `Format de période invalide « ${period} » — attendu AAAA-MM.`;
    case "no_tenant":      return "Aucun tenant actif détecté pour l'utilisateur courant.";
  }
}

// ---------------------------------------------------------------------------
// Lightweight in-memory engine that replays the DB function semantics. Used
// by the integration tests to validate idempotence + permission gating + audit
// without booting Supabase.
// ---------------------------------------------------------------------------

export type InventoryCloseRow = {
  tenant_id: string;
  period: string;
  closed_by: string;
  closed_at: string;
};

export type PeriodLockRow = {
  tenant_id: string;
  period: string;
  module: "inventory";
  locked_by: string;
};

export type AuditRow = {
  tenant_id: string;
  performed_by: string;
  action: "period_close" | "period_close_idempotent";
  comment: string;
};

export type CloseStore = {
  closes: InventoryCloseRow[];
  locks: PeriodLockRow[];
  audit: AuditRow[];
};

export function createCloseStore(): CloseStore {
  return { closes: [], locks: [], audit: [] };
}

export type CloseContext = {
  tenantId: string | null;
  userId: string;
  hasClosePerm: boolean;
};

export function closeInventoryPeriod(
  store: CloseStore,
  ctx: CloseContext,
  period: string,
): CloseResult {
  if (!ctx.tenantId) return { status: "no_tenant", message: closeMessage("no_tenant", period), period, created: false, audited: false };
  if (!ctx.hasClosePerm) return { status: "forbidden", message: closeMessage("forbidden", period), period, created: false, audited: false };
  if (!isValidPeriod(period)) return { status: "invalid_period", message: closeMessage("invalid_period", period), period, created: false, audited: false };

  const existing = store.closes.find((c) => c.tenant_id === ctx.tenantId && c.period === period);
  if (existing) {
    store.audit.push({ tenant_id: ctx.tenantId, performed_by: ctx.userId, action: "period_close_idempotent", comment: period });
    return { status: "idempotent", message: closeMessage("idempotent", period), period, created: false, audited: true };
  }

  store.closes.push({ tenant_id: ctx.tenantId, period, closed_by: ctx.userId, closed_at: new Date().toISOString() });
  if (!store.locks.find((l) => l.tenant_id === ctx.tenantId && l.period === period && l.module === "inventory")) {
    store.locks.push({ tenant_id: ctx.tenantId, period, module: "inventory", locked_by: ctx.userId });
  }
  store.audit.push({ tenant_id: ctx.tenantId, performed_by: ctx.userId, action: "period_close", comment: period });
  return { status: "ok", message: closeMessage("ok", period), period, created: true, audited: true };
}
