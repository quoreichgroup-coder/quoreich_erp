/**
 * Calendrier fiscal central (V33) : exercices, périodes et statut par module. Logique pure,
 * testée sans réseau ; les règles elles-mêmes sont tenues par la base (ordre de clôture, motif
 * de réouverture, exercice ouvert) — l'écran ne fait que les annoncer.
 */
export type FiscalYearStatus = "not_open" | "open" | "closed";

export interface FiscalYear {
  id: string; code: string; start_date: string; end_date: string; status: FiscalYearStatus;
}
export interface FiscalPeriod {
  id: string; fiscal_year_id: string; period_no: number; code: string; start_date: string; end_date: string;
}
export interface FiscalModule { code: string; label: string; sort_order: number; is_ledger: boolean }
export interface PeriodLock { period: string; module: string; status: "open" | "closed"; closed_at: string | null; reason: string | null }

export const FISCAL_YEAR_STATUS_LABELS: Record<FiscalYearStatus, string> = {
  not_open: "Non ouvert",
  open: "Ouvert",
  closed: "Clôturé",
};

const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/** « 2026-03 » → « mars 2026 ». */
export function periodLabel(code: string): string {
  const [y, m] = code.split("-").map(Number);
  return `${MOIS[m - 1] ?? code} ${y}`;
}

/** Date ISO (AAAA-MM-JJ) sans décalage de fuseau. */
const iso = (y: number, m: number, d: number) =>
  `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * Exercice proposé à la création : à la suite du dernier (12 mois), ou, s'il n'y en a aucun,
 * l'année civile en cours (SYSCOHADA, AUDCIF art. 7).
 */
export function suggestNextFiscalYear(years: FiscalYear[], today: Date = new Date()): { start: string; end: string } {
  const last = [...years].sort((a, b) => a.end_date.localeCompare(b.end_date)).at(-1);
  if (!last) {
    const y = today.getFullYear();
    return { start: iso(y, 1, 1), end: iso(y, 12, 31) };
  }
  const [y, m] = last.end_date.split("-").map(Number);
  // Lendemain de la fin (toujours le 1er du mois suivant : la fin est un dernier jour de mois).
  const sy = m === 12 ? y + 1 : y;
  const sm = m === 12 ? 1 : m + 1;
  const ey = sm === 1 ? sy : sy + 1;
  const em = sm === 1 ? 12 : sm - 1;
  return { start: iso(sy, sm, 1), end: iso(ey, em, lastDay(ey, em)) };
}

/** Dernier jour du mois qui précède `start` + `months` mois. */
export function endAfterMonths(start: string, months: number): string {
  const [y, m] = start.split("-").map(Number);
  const total = (m - 1) + months - 1;
  const ey = y + Math.floor(total / 12);
  const em = (total % 12) + 1;
  return iso(ey, em, lastDay(ey, em));
}

export type CellStatus = "open" | "closed";

/** Statut d'une case (période × module) : sans ligne dans le registre, la période est ouverte. */
export function cellStatus(locks: PeriodLock[], period: string, module: string): CellStatus {
  return locks.find((l) => l.period === period && l.module === module)?.status === "closed" ? "closed" : "open";
}

/**
 * Ce que la base refusera, dit à l'avance : le Grand livre ne se clôture qu'après les autres
 * modules ; un module ne se rouvre que si le Grand livre est ouvert. `null` = action permise.
 */
export function blockedReason(
  locks: PeriodLock[], modules: FiscalModule[], period: string, module: string, target: CellStatus,
): string | null {
  const ledger = modules.find((m) => m.is_ledger)?.code ?? "GL";
  if (target === "closed" && module === ledger) {
    const pending = modules.filter((m) => !m.is_ledger && cellStatus(locks, period, m.code) !== "closed");
    if (pending.length > 0) return `Clôturez d'abord : ${pending.map((m) => m.label).join(", ")}`;
  }
  if (target === "open" && module !== ledger && cellStatus(locks, period, ledger) === "closed") {
    return "Rouvrez d'abord le Grand livre";
  }
  return null;
}

/** Modules restant à clôturer pour une période, dans l'ordre (opérationnels, puis Grand livre). */
export function closingSequence(locks: PeriodLock[], modules: FiscalModule[], period: string): FiscalModule[] {
  return [...modules]
    .sort((a, b) => Number(a.is_ledger) - Number(b.is_ledger) || a.sort_order - b.sort_order)
    .filter((m) => cellStatus(locks, period, m.code) !== "closed");
}

/** Nombre de cases closes d'un exercice, sur le total (périodes × modules). */
export function yearProgress(periods: FiscalPeriod[], locks: PeriodLock[], modules: FiscalModule[]): { closed: number; total: number } {
  const total = periods.length * modules.length;
  const closed = periods.reduce(
    (n, p) => n + modules.filter((m) => cellStatus(locks, p.code, m.code) === "closed").length, 0);
  return { closed, total };
}
