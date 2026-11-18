// Pure TypeScript mirror of the SQL payroll engine
// Kept in sync with public.compute_payroll_line / post_payroll_run.
// Used by the UI (JE preview) and unit tests.

export type PayrollComputation = {
  gross: number;
  deductions: number;
  taxes: number;
  net: number;
  employerCharges: number;
};

export type PayrollTaxBand = { upTo: number | null; rate: number };
export type PayrollRules = {
  employeeSocialRate: number;
  employerSocialRate: number;
  employeeSocialCap?: number | null;
  employerSocialCap?: number | null;
  taxBands: PayrollTaxBand[];
};

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Mirror of public.compute_payroll_line(employee). */
export function validatePayrollRules(rules: PayrollRules): boolean {
  const validRate = (rate: number) => Number.isFinite(rate) && rate >= 0 && rate <= 1;
  if (!validRate(rules.employeeSocialRate) || !validRate(rules.employerSocialRate) || rules.taxBands.length === 0) return false;
  if (rules.employeeSocialCap != null && (!Number.isFinite(rules.employeeSocialCap) || rules.employeeSocialCap <= 0)) return false;
  if (rules.employerSocialCap != null && (!Number.isFinite(rules.employerSocialCap) || rules.employerSocialCap <= 0)) return false;
  let previousLimit = 0;
  for (let i = 0; i < rules.taxBands.length; i++) {
    const band = rules.taxBands[i];
    if (!validRate(band.rate)) return false;
    if (band.upTo === null) return i === rules.taxBands.length - 1;
    if (!Number.isFinite(band.upTo) || band.upTo <= previousLimit) return false;
    previousLimit = band.upTo;
  }
  return false;
}

/** Applies rates supplied by the tenant's validated country payroll profile. */
export function computePayrollLine(baseSalary: number, rules: PayrollRules): PayrollComputation {
  const base = Number.isFinite(baseSalary) && baseSalary > 0 ? baseSalary : 0;
  const gross = round2(base);
  if (!validatePayrollRules(rules)) throw new Error("Barèmes de paie invalides");
  const employeeBase = Math.min(base, rules.employeeSocialCap ?? base);
  const employerBase = Math.min(base, rules.employerSocialCap ?? base);
  const deductions = round2(employeeBase * rules.employeeSocialRate);
  const taxes = computeProgressiveIncomeTax(Math.max(0, base - deductions), rules.taxBands);
  const net = round2(gross - deductions - taxes);
  return { gross, deductions, taxes, net, employerCharges: round2(employerBase * rules.employerSocialRate) };
}

/** Calculates tax marginally across ascending bands; rates are decimal fractions. */
export function computeProgressiveIncomeTax(taxableBase: number, bands: PayrollTaxBand[]): number {
  if (!Number.isFinite(taxableBase) || taxableBase <= 0) return 0;
  if (!validatePayrollRules({ employeeSocialRate: 0, employerSocialRate: 0, taxBands: bands })) {
    throw new Error("Tranches d'impôt invalides");
  }
  let lowerLimit = 0;
  let tax = 0;
  for (const band of bands) {
    const upperLimit = band.upTo ?? taxableBase;
    const taxableInBand = Math.max(0, Math.min(taxableBase, upperLimit) - lowerLimit);
    tax += taxableInBand * band.rate;
    if (band.upTo === null || taxableBase <= upperLimit) break;
    lowerLimit = upperLimit;
  }
  return round2(tax);
}

/** Aggregate totals + employer charges (mirror of post_payroll_run). */
export function aggregatePayroll(lines: PayrollComputation[]) {
  const gross = round2(lines.reduce((s, l) => s + l.gross, 0));
  const deductions = round2(lines.reduce((s, l) => s + l.deductions, 0));
  const taxes = round2(lines.reduce((s, l) => s + l.taxes, 0));
  const net = round2(lines.reduce((s, l) => s + l.net, 0));
  const employerCharges = round2(lines.reduce((s, l) => s + l.employerCharges, 0));
  return { gross, deductions, taxes, net, employerCharges };
}

export type JournalPreviewLine = {
  account: string;
  role: PayrollPostingRole;
  label: string;
  debit: number;
  credit: number;
};

export type PayrollPostingRole = "PAYROLL_SALARIES" | "PAYROLL_EMPLOYER_CHARGES" | "PAYROLL_NET_PAYABLE" | "PAYROLL_SOCIAL" | "PAYROLL_TAX";
export type PayrollPostingAccounts = Partial<Record<PayrollPostingRole, string>>;

/** Build the journal preview from the tenant's account mappings. */
export function buildJournalPreview(
  lines: PayrollComputation[],
  opts?: { accounts?: PayrollPostingAccounts },
): { lines: JournalPreviewLine[]; totalDebit: number; totalCredit: number; balanced: boolean; missingRoles: PayrollPostingRole[] } {
  const { gross, deductions, taxes, net, employerCharges } = aggregatePayroll(lines);
  const accounts = opts?.accounts ?? {};
  const out: JournalPreviewLine[] = [];
  const missingRoles: PayrollPostingRole[] = [];
  const add = (role: PayrollPostingRole, label: string, debit: number, credit: number) => {
    if (debit === 0 && credit === 0) return;
    const account = accounts[role];
    if (!account) missingRoles.push(role);
    out.push({ role, account: account ?? "—", label, debit: round2(debit), credit: round2(credit) });
  };

  add("PAYROLL_SALARIES", "Salaires bruts", gross, 0);
  if (employerCharges > 0) add("PAYROLL_EMPLOYER_CHARGES", "Charges patronales", employerCharges, 0);
  add("PAYROLL_NET_PAYABLE", "Personnel — rémunérations dues", 0, net);
  const cnpsTotal = round2(deductions + employerCharges);
  if (cnpsTotal > 0) add("PAYROLL_SOCIAL", "Organismes sociaux", 0, cnpsTotal);
  if (taxes > 0) add("PAYROLL_TAX", "État — impôt sur salaires", 0, taxes);

  const totalDebit = round2(out.reduce((s, l) => s + l.debit, 0));
  const totalCredit = round2(out.reduce((s, l) => s + l.credit, 0));
  return { lines: out, totalDebit, totalCredit, balanced: missingRoles.length === 0 && Math.abs(totalDebit - totalCredit) < 0.01, missingRoles };
}

/** Mirror of guard_payroll_run_lock(): posted runs are immutable. */
export function canMutatePayrollRun(currentStatus: string, nextStatus?: string): { ok: boolean; reason?: string } {
  if (currentStatus === "posted" && nextStatus && nextStatus !== "posted") {
    return { ok: false, reason: "Un cycle comptabilisé ne peut être modifié" };
  }
  return { ok: true };
}

export function canDeletePayrollRun(currentStatus: string): { ok: boolean; reason?: string } {
  if (currentStatus === "posted") return { ok: false, reason: "Un cycle comptabilisé ne peut être supprimé" };
  return { ok: true };
}
