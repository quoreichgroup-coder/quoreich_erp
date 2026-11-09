// Pure TypeScript mirror of the SQL payroll engine
// Kept in sync with public.compute_payroll_line / post_payroll_run.
// Used by the UI (JE preview) and unit tests.

export const CNPS_EMPLOYEE_RATE = 0.063;
export const IRPP_RATE = 0.1;
export const EMPLOYER_CHARGES_RATE = 0.164;

export type PayrollComputation = {
  gross: number;
  deductions: number;
  taxes: number;
  net: number;
};

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Mirror of public.compute_payroll_line(employee). */
export function computePayrollLine(baseSalary: number): PayrollComputation {
  const base = Number.isFinite(baseSalary) && baseSalary > 0 ? baseSalary : 0;
  const gross = round2(base);
  const deductions = round2(base * CNPS_EMPLOYEE_RATE);
  const taxes = round2((base - base * CNPS_EMPLOYEE_RATE) * IRPP_RATE);
  const net = round2(gross - deductions - taxes);
  return { gross, deductions, taxes, net };
}

/** Aggregate totals + employer charges (mirror of post_payroll_run). */
export function aggregatePayroll(lines: PayrollComputation[]) {
  const gross = round2(lines.reduce((s, l) => s + l.gross, 0));
  const deductions = round2(lines.reduce((s, l) => s + l.deductions, 0));
  const taxes = round2(lines.reduce((s, l) => s + l.taxes, 0));
  const net = round2(lines.reduce((s, l) => s + l.net, 0));
  const employerCharges = round2(gross * EMPLOYER_CHARGES_RATE);
  return { gross, deductions, taxes, net, employerCharges };
}

export type JournalPreviewLine = {
  account: string; // SYSCOHADA code
  label: string;
  debit: number;
  credit: number;
};

/** Build the JE preview (DR 661/663 — CR 421/431/447) without touching the DB. */
export function buildJournalPreview(
  lines: PayrollComputation[],
  opts?: { hasEmployerChargesAccount?: boolean; hasCnpsAccount?: boolean; hasTaxAccount?: boolean },
): { lines: JournalPreviewLine[]; totalDebit: number; totalCredit: number; balanced: boolean } {
  const { gross, deductions, taxes, net, employerCharges } = aggregatePayroll(lines);
  const hasCharges = opts?.hasEmployerChargesAccount ?? true;
  const hasCnps = opts?.hasCnpsAccount ?? true;
  const hasTax = opts?.hasTaxAccount ?? true;

  const out: JournalPreviewLine[] = [];

  // Debits
  out.push({
    account: "6610",
    label: "Salaires bruts",
    debit: round2(gross + (hasCharges ? 0 : employerCharges)),
    credit: 0,
  });
  if (hasCharges && employerCharges > 0) {
    out.push({ account: "6630", label: "Charges patronales", debit: employerCharges, credit: 0 });
  }

  // Credits
  let personnelCredit = net;
  const cnpsTotal = round2(deductions + employerCharges);
  if (hasCnps && cnpsTotal > 0) {
    out.push({ account: "4310", label: "CNPS — organismes sociaux", debit: 0, credit: cnpsTotal });
  } else {
    personnelCredit = round2(personnelCredit + cnpsTotal);
  }
  if (hasTax && taxes > 0) {
    out.push({ account: "4470", label: "État — impôt sur salaires", debit: 0, credit: taxes });
  } else {
    personnelCredit = round2(personnelCredit + taxes);
  }
  out.unshift({ account: "4210", label: "Personnel — rémunérations dues", debit: 0, credit: personnelCredit });

  const totalDebit = round2(out.reduce((s, l) => s + l.debit, 0));
  const totalCredit = round2(out.reduce((s, l) => s + l.credit, 0));
  return { lines: out, totalDebit, totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 0.01 };
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
