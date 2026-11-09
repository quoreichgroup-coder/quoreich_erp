// Pure helpers mirroring the server-side `close_treasury_period` RPC.
// Used to unit-test the contract (period validation, permission gate,
// idempotence, unreconciled blocking, audit trail) without a live DB.

export const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export type TreasuryCloseStatus =
  | "ok"
  | "idempotent"
  | "forbidden"
  | "invalid_period"
  | "out_of_range"
  | "no_tenant"
  | "already_locked"
  | "unreconciled";

export type TreasuryCloseResult = {
  status: TreasuryCloseStatus;
  message: string;
  period: string;
  created: boolean;
  audited: boolean;
  /** Number of open reconciliations blocking the close (status=unreconciled). */
  openDrafts?: number;
};

export function isValidTreasuryPeriod(period: string): boolean {
  return PERIOD_RE.test(period);
}

export function currentPeriod(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Allowed range guardrail: by default a period can be closed if it sits between
 * 24 months in the past and 1 month in the future (relative to `now`). Tunable
 * via options to support fiscal exceptions.
 */
export type PeriodRangeOptions = { maxPastMonths?: number; maxFutureMonths?: number };

export const DEFAULT_PERIOD_RANGE: Required<PeriodRangeOptions> = {
  maxPastMonths: 24,
  maxFutureMonths: 1,
};

export function periodDiffMonths(period: string, now: Date = new Date()): number {
  const [y, m] = period.split("-").map(Number);
  const cur = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const target = y * 12 + (m - 1);
  return target - cur;
}

export function isPeriodInAllowedRange(
  period: string,
  now: Date = new Date(),
  opts: PeriodRangeOptions = {},
): boolean {
  if (!isValidTreasuryPeriod(period)) return false;
  const { maxPastMonths, maxFutureMonths } = { ...DEFAULT_PERIOD_RANGE, ...opts };
  const diff = periodDiffMonths(period, now);
  return diff >= -maxPastMonths && diff <= maxFutureMonths;
}

export function treasuryCloseMessage(status: TreasuryCloseStatus, period: string, openDrafts = 0): string {
  switch (status) {
    case "ok":             return `Période ${period} clôturée et verrouillée.`;
    case "idempotent":     return `Période ${period} déjà clôturée — aucune nouvelle écriture.`;
    case "forbidden":      return "Action refusée — rôle Contrôleur/Responsable Trésorerie requis.";
    case "invalid_period": return `Format de période invalide « ${period} » — attendu AAAA-MM.`;
    case "out_of_range":   return `Période ${period} hors plage autorisée (24 mois passés à 1 mois futur).`;
    case "no_tenant":      return "Aucun tenant actif détecté pour l'utilisateur courant.";
    case "already_locked": return `Période ${period} déjà verrouillée par un autre module.`;
    case "unreconciled":   return `Impossible de clôturer : ${openDrafts} rapprochement(s) bancaire(s) en brouillon dans la période.`;
  }
}

// ---------------------------------------------------------------------------
// In-memory engine — replays DB semantics for integration tests.
// ---------------------------------------------------------------------------

export type TreasuryCloseRow = {
  tenant_id: string;
  period: string;
  status: "completed";
  closed_by: string;
  closed_at: string;
};

export type TreasuryLockRow = {
  tenant_id: string;
  period: string;
  module: "treasury" | string;
  closed_by: string;
};

export type TreasuryReconRow = {
  tenant_id: string;
  period_end: string; // YYYY-MM-DD
  status: "draft" | "validated";
};

export type TreasuryAuditAction =
  | "period_close_started"
  | "period_close_completed"
  | "period_close_failed"
  | "period_close_idempotent";

export type TreasuryAuditRow = {
  tenant_id: string;
  actor_id: string;
  action: TreasuryAuditAction;
  comment: string;
  period: string;
  period_start: string;
  period_end: string;
};

export type TreasuryCloseStore = {
  closes: TreasuryCloseRow[];
  locks: TreasuryLockRow[];
  recons: TreasuryReconRow[];
  audit: TreasuryAuditRow[];
};

export function createTreasuryCloseStore(seed: Partial<TreasuryCloseStore> = {}): TreasuryCloseStore {
  return { closes: [], locks: [], recons: [], audit: [], ...seed };
}

export type TreasuryCloseContext = {
  tenantId: string | null;
  userId: string;
  hasClosePerm: boolean;
  /** Optional range guardrail; when set, also rejects periods outside the window. */
  rangeOptions?: PeriodRangeOptions;
  /** Override "now" — useful for deterministic tests. */
  now?: Date;
};

export function periodBounds(period: string): { start: string; end: string } {
  const [y, m] = period.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0)); // last day of month
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}

function audit(
  store: TreasuryCloseStore,
  ctx: TreasuryCloseContext,
  period: string,
  action: TreasuryAuditAction,
  comment: string,
): void {
  // Audit rows ALWAYS carry actor_id, period_start, period_end — even on failure paths —
  // so downstream forensics can reconstruct the targeted window without rejoining.
  const bounds = isValidTreasuryPeriod(period)
    ? periodBounds(period)
    : { start: "", end: "" };
  store.audit.push({
    tenant_id: ctx.tenantId ?? "",
    actor_id: ctx.userId,
    action,
    comment,
    period,
    period_start: bounds.start,
    period_end: bounds.end,
  });
}

export function closeTreasuryPeriod(
  store: TreasuryCloseStore,
  ctx: TreasuryCloseContext,
  period: string,
): TreasuryCloseResult {
  if (!ctx.tenantId)
    return { status: "no_tenant", message: treasuryCloseMessage("no_tenant", period), period, created: false, audited: false };
  if (!ctx.hasClosePerm)
    return { status: "forbidden", message: treasuryCloseMessage("forbidden", period), period, created: false, audited: false };
  if (!isValidTreasuryPeriod(period))
    return { status: "invalid_period", message: treasuryCloseMessage("invalid_period", period), period, created: false, audited: false };
  if (!isPeriodInAllowedRange(period, ctx.now, ctx.rangeOptions)) {
    audit(store, ctx, period, "period_close_failed", `${period} | out_of_range`);
    return { status: "out_of_range", message: treasuryCloseMessage("out_of_range", period), period, created: false, audited: true };
  }

  const existing = store.closes.find((c) => c.tenant_id === ctx.tenantId && c.period === period);
  if (existing) {
    audit(store, ctx, period, "period_close_idempotent", period);
    return { status: "idempotent", message: treasuryCloseMessage("idempotent", period), period, created: false, audited: true };
  }

  const locked = store.locks.find(
    (l) => l.tenant_id === ctx.tenantId && l.period === period && l.module === "treasury",
  );
  if (locked) {
    audit(store, ctx, period, "period_close_failed", `${period} | already_locked`);
    return { status: "already_locked", message: treasuryCloseMessage("already_locked", period), period, created: false, audited: true };
  }

  const { start, end } = periodBounds(period);
  const openDrafts = store.recons.filter(
    (r) => r.tenant_id === ctx.tenantId && r.status === "draft" && r.period_end >= start && r.period_end <= end,
  ).length;
  if (openDrafts > 0) {
    audit(store, ctx, period, "period_close_failed", `${period} | unreconciled:${openDrafts}`);
    return { status: "unreconciled", message: treasuryCloseMessage("unreconciled", period, openDrafts), period, created: false, audited: true, openDrafts };
  }

  audit(store, ctx, period, "period_close_started", period);
  store.closes.push({ tenant_id: ctx.tenantId, period, status: "completed", closed_by: ctx.userId, closed_at: new Date().toISOString() });
  store.locks.push({ tenant_id: ctx.tenantId, period, module: "treasury", closed_by: ctx.userId });
  audit(store, ctx, period, "period_close_completed", period);
  return { status: "ok", message: treasuryCloseMessage("ok", period), period, created: true, audited: true };
}
