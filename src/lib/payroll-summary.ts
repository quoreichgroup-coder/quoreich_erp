type PayrollPeriodTotal = {
  period: string; status: string; gross_total: number | string; net_total?: number | string; payroll_currency_code?: string | null;
};

export function sumReportAmounts(rows: Array<{ currency: string | null; amount: number }>): number | null {
  if (rows.some((row) => !row.currency?.trim())) return null;
  const currencies = new Set(rows.map((row) => row.currency!.trim().toUpperCase()));
  if (currencies.size > 1) return null;
  return rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
}

export function fiscalYearStartPeriod(currentPeriod: string, fiscalStartMonth: number): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(currentPeriod)) return currentPeriod;
  const [year, month] = currentPeriod.split("-").map(Number);
  const startMonth = Number.isInteger(fiscalStartMonth) && fiscalStartMonth >= 1 && fiscalStartMonth <= 12
    ? fiscalStartMonth
    : 1;
  const startYear = month < startMonth ? year - 1 : year;
  return `${startYear}-${String(startMonth).padStart(2, "0")}`;
}

export function postedPayrollToDateTotals(
  runs: PayrollPeriodTotal[], targetPeriod: string, fiscalStartMonth: number,
) {
  const posted = runs.filter((run) => run.status === "posted" && run.period <= targetPeriod);
  const month = posted.filter((run) => run.period === targetPeriod);
  const yearStart = fiscalYearStartPeriod(targetPeriod, fiscalStartMonth);
  const fiscal = posted.filter((run) => run.period >= yearStart);
  const total = (rows: PayrollPeriodTotal[], key: "gross_total" | "net_total") =>
    sumReportAmounts(rows.map((run) => ({ currency: run.payroll_currency_code ?? null, amount: Number(run[key] || 0) })));
  return {
    yearStart,
    mtdGross: total(month, "gross_total"),
    mtdNet: total(month, "net_total"),
    ytdGross: total(fiscal, "gross_total"),
    ytdNet: total(fiscal, "net_total"),
  };
}

export function sumPostedPayrollGrossForFiscalYear(
  runs: PayrollPeriodTotal[],
  currentPeriod: string,
  fiscalStartMonth: number,
  currencyCode?: string | null,
): number | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(currentPeriod)) return 0;
  const startPeriod = fiscalYearStartPeriod(currentPeriod, fiscalStartMonth);
  const fiscalRuns = runs.filter((run) => run.status === "posted" && run.period >= startPeriod && run.period <= currentPeriod);
  const normalizedCurrency = currencyCode?.trim().toUpperCase();
  if (normalizedCurrency && fiscalRuns.some((run) => run.payroll_currency_code?.trim().toUpperCase() !== normalizedCurrency)) return null;
  return fiscalRuns.reduce((total, run) => total + Number(run.gross_total || 0), 0);
}
