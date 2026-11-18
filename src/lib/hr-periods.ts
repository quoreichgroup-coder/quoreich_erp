function validMonth(value: string): boolean {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

function validDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function validatePayrollRunInput(period: string, payDate: string): string | null {
  if (!validMonth(period)) return "Période invalide (AAAA-MM).";
  if (!validDate(payDate)) return "Date de paie invalide.";
  return null;
}

export function validatePayrollReportRange(from: string, to: string): string | null {
  if (!validMonth(from) || !validMonth(to)) return "Périodes invalides (AAAA-MM).";
  if (from > to) return "La période de début doit précéder ou égaler la période de fin.";
  return null;
}
