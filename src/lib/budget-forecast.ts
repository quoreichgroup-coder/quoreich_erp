/*
 * Budget : calculs des écrans Contrôle et Prévisions (V77), à partir de la situation du budget de contrôle
 * (budget_status) et du réalisé mensuel (budget_monthly_actual). Rien n'est inventé : le réalisé et les
 * engagements viennent de la base ; la projection est une extrapolation déclarée comme telle.
 */
export type BudgetRowLike = {
  line_id: string; account_code: string; account_name?: string; period: string;
  analytic_value_id: string | null; analytic_code?: string | null; analytic_name?: string | null;
  planned: number; precommitted: number; committed: number; actual: number; available: number;
};

export const MONTH_LABELS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/** Consommé = pré-engagé (demandes) + engagé (commandes) + réalisé (écritures). */
export const consumed = (r: BudgetRowLike) => r.precommitted + r.committed + r.actual;

/** Taux de consommation en % (null sans budget). */
export function consumptionPct(r: BudgetRowLike): number | null {
  if (!(r.planned > 0)) return null;
  return Math.round((consumed(r) / r.planned) * 1000) / 10;
}

const periodCovers = (outer: string, inner: string) => outer === inner || (outer.length === 4 && inner.startsWith(outer + "-"));
const strictlyBroader = (m: BudgetRowLike, l: BudgetRowLike) =>
  m.account_code.length < l.account_code.length || (m.analytic_value_id == null && l.analytic_value_id != null) || (m.period.length === 4 && l.period.length > 4);

/** M couvre L : compte parent (ou égal), même section ou budget général, même période ou année englobante, et plus large sur un axe. */
export function covers(m: BudgetRowLike, l: BudgetRowLike): boolean {
  if (m.line_id === l.line_id || !l.account_code.startsWith(m.account_code)) return false;
  if (m.analytic_value_id != null && m.analytic_value_id !== l.analytic_value_id) return false;
  return periodCovers(m.period, l.period) && strictlyBroader(m, l);
}

/** Lignes couvertes par aucune autre : les totaux s'en tiennent à elles (« 60 » et « 601 » ne s'additionnent pas). */
export function rootLines<T extends BudgetRowLike>(rows: T[]): T[] {
  return rows.filter((l) => !rows.some((m) => covers(m, l)));
}

export function totals(rows: BudgetRowLike[]) {
  return rootLines(rows).reduce((s, r) => ({ planned: s.planned + r.planned, precommitted: s.precommitted + r.precommitted, committed: s.committed + r.committed,
    actual: s.actual + r.actual, available: s.available + r.available }), { planned: 0, precommitted: 0, committed: 0, actual: 0, available: 0 });
}

export type BudgetAlert<T> = { row: T; pct: number | null; level: "over" | "threshold" };

/** Lignes en dépassement (disponible négatif) ou au seuil d'alerte paramétré, les plus consommées d'abord. */
export function budgetAlerts<T extends BudgetRowLike>(rows: T[], thresholdPct: number): BudgetAlert<T>[] {
  return rows.flatMap((row): BudgetAlert<T>[] => {
    const pct = consumptionPct(row);
    if (row.available < 0) return [{ row, pct, level: "over" }];
    if (pct != null && pct >= thresholdPct) return [{ row, pct, level: "threshold" }];
    return [];
  }).sort((a, b) => (a.level === b.level ? (b.pct ?? Infinity) - (a.pct ?? Infinity) : a.level === "over" ? -1 : 1));
}

/** Mois écoulés de l'exercice à la date donnée (0 avant, 12 après). */
export function elapsedMonths(year: string, today: Date): number {
  const y = Number(year);
  if (today.getFullYear() < y) return 0;
  if (today.getFullYear() > y) return 12;
  return today.getMonth() + 1;
}

export type ForecastRow = {
  key: string; account_code: string; account_name: string; section: string | null;
  planned: number; actual: number; committed: number; precommitted: number;
  /** Réalisé + engagé + pré-engagé : ce qui est déjà acquis ou réservé. */
  known: number;
  /** Réalisé extrapolé au rythme mensuel moyen (null tant qu'aucun mois n'est écoulé). */
  runRate: number | null;
  /** Atterrissage retenu : le plus élevé des deux (prudence). */
  landing: number;
  variance: number;
  status: "over" | "risk" | "ok";
};

/** Atterrissage de fin d'exercice par compte × section, sur les lignes racines. */
export function forecastRows(rows: BudgetRowLike[], year: string, today: Date, thresholdPct = 90): ForecastRow[] {
  const m = elapsedMonths(year, today);
  const groups = new Map<string, BudgetRowLike[]>();
  for (const r of rootLines(rows)) {
    const key = `${r.account_code}|${r.analytic_value_id ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.entries()].map(([key, g]) => {
    const sum = (f: (r: BudgetRowLike) => number) => g.reduce((s, r) => s + f(r), 0);
    const planned = sum((r) => r.planned), actual = sum((r) => r.actual), committed = sum((r) => r.committed), precommitted = sum((r) => r.precommitted);
    const known = actual + committed + precommitted;
    const runRate = m > 0 ? Math.round((actual / m) * 12 * 100) / 100 : null;
    const landing = Math.max(known, runRate ?? known);
    const variance = Math.round((planned - landing) * 100) / 100;
    const f = g[0];
    const status: ForecastRow["status"] = landing > planned ? "over" : planned > 0 && (landing / planned) * 100 >= thresholdPct ? "risk" : "ok";
    return { key, account_code: f.account_code, account_name: f.account_name ?? "", section: f.analytic_code ? `${f.analytic_code} ${f.analytic_name ?? ""}`.trim() : null,
      planned, actual, committed, precommitted, known, runRate, landing, variance, status };
  }).sort((a, b) => a.account_code.localeCompare(b.account_code) || (a.section ?? "").localeCompare(b.section ?? ""));
}

export type MonthPoint = { month: string; planned: number; actual: number | null; cumulPlanned: number; cumulActual: number | null; cumulForecast: number };

/**
 * Série mensuelle des lignes racines : budget du mois (une ligne annuelle est répartie par douzièmes), réalisé
 * des mois écoulés, cumuls ; la prévision cumulée prolonge le réalisé jusqu'à l'atterrissage, réparti également
 * sur les mois restants.
 */
export function monthlySeries(rows: BudgetRowLike[], monthly: { line_id: string; month: number; actual: number }[], year: string, today: Date): MonthPoint[] {
  const roots = rootLines(rows);
  const ids = new Set(roots.map((r) => r.line_id));
  const planned = Array(12).fill(0) as number[];
  for (const r of roots) {
    if (r.period.length === 4) for (let i = 0; i < 12; i++) planned[i] += r.planned / 12;
    else planned[Number(r.period.slice(5, 7)) - 1] += r.planned;
  }
  const actual = Array(12).fill(0) as number[];
  for (const a of monthly) if (ids.has(a.line_id) && a.month >= 1 && a.month <= 12) actual[a.month - 1] += a.actual;
  const m = elapsedMonths(year, today);
  const landing = forecastRows(rows, year, today).reduce((s, f) => s + f.landing, 0);
  const actualToDate = actual.slice(0, m).reduce((s, x) => s + x, 0);
  const perMonth = m < 12 ? Math.max(0, landing - actualToDate) / (12 - m) : 0;
  let cp = 0, ca = 0, cf = 0;
  return planned.map((p, i) => {
    cp += p;
    const past = i < m;
    if (past) { ca += actual[i]; cf += actual[i]; } else cf += perMonth;
    const r2 = (x: number) => Math.round(x * 100) / 100;
    return { month: MONTH_LABELS[i], planned: r2(p), actual: past ? r2(actual[i]) : null, cumulPlanned: r2(cp), cumulActual: past ? r2(ca) : null, cumulForecast: r2(cf) };
  });
}
