/** Returns the comparable date in another year, clamping leap days/month ends. */
export type StatementLine = { line_code: string; [key: string]: unknown };

export function shiftStatementDate(date: string, yearOffset: number): string {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return date;
  const comparableDay = Math.min(day, new Date(year + yearOffset, month, 0).getDate());
  return `${year + yearOffset}-${String(month).padStart(2, "0")}-${String(comparableDay).padStart(2, "0")}`;
}

export function fiscalYearStartDate(date: string, startMonth: number): string {
  const [year, month] = date.split("-").map(Number);
  if (!year || !month || !Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) return date;
  const startYear = month < startMonth ? year - 1 : year;
  return `${startYear}-${String(startMonth).padStart(2, "0")}-01`;
}

/** Preserve a missing comparison as null instead of turning absent history into zero. */
export function combineStatementComparison<T extends StatementLine>(
  current: T[],
  prior: Array<T & { amount: number }>,
  priorAvailable: boolean,
): Array<T & { amount_prior: number | null }> {
  const priorByCode = new Map(prior.map((line) => [line.line_code, Number(line.amount)]));
  return current.map((line) => ({ ...line, amount_prior: priorAvailable ? priorByCode.get(line.line_code) ?? 0 : null }));
}
