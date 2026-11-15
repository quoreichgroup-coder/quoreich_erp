/*
 * Budget : calculs des écrans Contrôle, Prévisions et Rapports (V77, V79), à partir de la situation du budget de
 * contrôle (budget_status) et du réalisé mensuel (budget_monthly_actual, budget_prior_year_monthly). Rien n'est
 * inventé : le réalisé et les engagements viennent de la base ; la projection est une extrapolation déclarée,
 * selon la méthode et la répartition choisies dans les paramètres du budget.
 * Nature (V79) : « expense » = budget de charges (plafond à ne pas dépasser) ; « revenue » = objectif de produits
 * (à atteindre). Le sens favorable s'inverse.
 */
export type BudgetNature = "expense" | "revenue";
export type BudgetRowLike = {
  line_id: string; account_code: string; account_name?: string; period: string;
  analytic_value_id: string | null; analytic_code?: string | null; analytic_name?: string | null;
  nature?: BudgetNature;
  planned: number; precommitted: number; committed: number; actual: number; available: number;
};
export type ForecastMethod = "prudent" | "run_rate" | "commitments";
export type AnnualSpread = "even" | "prior_year";
export type MonthlyActual = { line_id: string; month: number; actual: number };

export const MONTH_LABELS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
export const FORECAST_METHOD_LABELS: Record<ForecastMethod, string> = {
  prudent: "Prudente : le plus défavorable des engagements connus et du rythme du réalisé",
  run_rate: "Rythme du réalisé : réalisé moyen par mois × 12",
  commitments: "Engagements connus : réalisé + engagé + pré-engagé",
};
export const ANNUAL_SPREAD_LABELS: Record<AnnualSpread, string> = {
  even: "Par douzièmes",
  prior_year: "Au profil du réalisé de l'exercice précédent (douzièmes à défaut)",
};

/** Nature dite par la base (sens normal du compte, V79) ; une ligne sans nature est traitée en charges. */
export const natureOf = (r: BudgetRowLike): BudgetNature => r.nature ?? "expense";

/** Consommé = pré-engagé (demandes) + engagé (commandes) + réalisé (écritures). */
export const consumed = (r: BudgetRowLike) => r.precommitted + r.committed + r.actual;

/** Taux de consommation (charges) ou de réalisation (produits) en % ; null sans budget. */
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

/** Totaux sans double compte ; une nature à la fois (charges et produits ne s'additionnent pas). */
export function totals(rows: BudgetRowLike[], nature: BudgetNature = "expense") {
  return rootLines(rows.filter((r) => natureOf(r) === nature)).reduce((s, r) => ({ planned: s.planned + r.planned, precommitted: s.precommitted + r.precommitted,
    committed: s.committed + r.committed, actual: s.actual + r.actual, available: s.available + r.available }),
  { planned: 0, precommitted: 0, committed: 0, actual: 0, available: 0 });
}

export type BudgetAlert<T> = { row: T; pct: number | null; level: "over" | "threshold" };

/** Lignes de charges en dépassement (disponible négatif) ou au seuil d'alerte paramétré, les plus consommées d'abord. */
export function budgetAlerts<T extends BudgetRowLike>(rows: T[], thresholdPct: number): BudgetAlert<T>[] {
  return rows.filter((r) => natureOf(r) === "expense").flatMap((row): BudgetAlert<T>[] => {
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
  key: string; account_code: string; account_name: string; section: string | null; nature: BudgetNature;
  planned: number; actual: number; committed: number; precommitted: number;
  /** Réalisé + engagé + pré-engagé : ce qui est déjà acquis ou réservé. */
  known: number;
  /** Réalisé extrapolé au rythme mensuel moyen (null tant qu'aucun mois n'est écoulé). */
  runRate: number | null;
  /** Atterrissage selon la méthode paramétrée. */
  landing: number;
  /** Budget − atterrissage (charges : positif = marge ; produits : négatif = objectif dépassé). */
  variance: number;
  /** over = défavorable (charges au-delà du budget, produits sous le seuil de l'objectif). */
  status: "over" | "risk" | "ok";
};

export function landingOf(known: number, runRate: number | null, method: ForecastMethod, nature: BudgetNature): number {
  if (method === "commitments" || runRate == null) return known;
  if (method === "run_rate") return runRate;
  // Prudente : le plus défavorable — le plus élevé pour une charge, le plus bas pour un produit.
  return nature === "expense" ? Math.max(known, runRate) : Math.min(known, runRate);
}

/** Atterrissage de fin d'exercice par compte × section, sur les lignes racines. */
export function forecastRows(rows: BudgetRowLike[], year: string, today: Date, thresholdPct = 90, method: ForecastMethod = "prudent"): ForecastRow[] {
  const m = elapsedMonths(year, today);
  const groups = new Map<string, BudgetRowLike[]>();
  for (const r of rootLines(rows)) {
    const key = `${r.account_code}|${r.analytic_value_id ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.entries()].map(([key, g]) => {
    const sum = (f: (r: BudgetRowLike) => number) => g.reduce((s, r) => s + f(r), 0);
    const planned = sum((r) => r.planned), actual = sum((r) => r.actual), committed = sum((r) => r.committed), precommitted = sum((r) => r.precommitted);
    const f = g[0];
    const nature = natureOf(f);
    const known = actual + committed + precommitted;
    const runRate = m > 0 ? Math.round((actual / m) * 12 * 100) / 100 : null;
    const landing = landingOf(known, runRate, method, nature);
    const variance = Math.round((planned - landing) * 100) / 100;
    const pct = planned > 0 ? (landing / planned) * 100 : null;
    const status: ForecastRow["status"] = nature === "expense"
      ? (landing > planned ? "over" : pct != null && pct >= thresholdPct ? "risk" : "ok")
      : (landing >= planned ? "ok" : pct != null && pct >= thresholdPct ? "risk" : "over");
    return { key, account_code: f.account_code, account_name: f.account_name ?? "", section: f.analytic_code ? `${f.analytic_code} ${f.analytic_name ?? ""}`.trim() : null,
      nature, planned, actual, committed, precommitted, known, runRate, landing, variance, status };
  }).sort((a, b) => a.account_code.localeCompare(b.account_code) || (a.section ?? "").localeCompare(b.section ?? ""));
}

/** Budget mensuel d'une ligne annuelle : par douzièmes, ou au profil du réalisé de l'exercice précédent (s'il est positif). */
export function spreadAnnual(planned: number, spread: AnnualSpread, prior: number[] | undefined): number[] {
  const total = (prior ?? []).reduce((s, x) => s + Math.max(0, x), 0);
  if (spread === "prior_year" && prior && total > 0) return prior.map((x) => (planned * Math.max(0, x)) / total);
  return Array(12).fill(planned / 12);
}

export type MonthPoint = { month: string; planned: number; actual: number | null; cumulPlanned: number; cumulActual: number | null; cumulForecast: number };

/**
 * Série mensuelle des lignes racines d'une nature : budget du mois (ligne annuelle répartie selon le paramètre),
 * réalisé des mois écoulés, cumuls ; la prévision cumulée prolonge le réalisé jusqu'à l'atterrissage, réparti
 * également sur les mois restants.
 */
export function monthlySeries(rows: BudgetRowLike[], monthly: MonthlyActual[], year: string, today: Date,
  opts: { nature?: BudgetNature; spread?: AnnualSpread; prior?: MonthlyActual[]; method?: ForecastMethod } = {}): MonthPoint[] {
  const nature = opts.nature ?? "expense";
  const ofNature = rows.filter((r) => natureOf(r) === nature);
  const roots = rootLines(ofNature);
  const ids = new Set(roots.map((r) => r.line_id));
  const priorByLine = new Map<string, number[]>();
  for (const p of opts.prior ?? []) {
    const arr = priorByLine.get(p.line_id) ?? Array(12).fill(0);
    if (p.month >= 1 && p.month <= 12) arr[p.month - 1] += p.actual;
    priorByLine.set(p.line_id, arr);
  }
  const planned = Array(12).fill(0) as number[];
  for (const r of roots) {
    if (r.period.length === 4) spreadAnnual(r.planned, opts.spread ?? "even", priorByLine.get(r.line_id)).forEach((x, i) => { planned[i] += x; });
    else planned[Number(r.period.slice(5, 7)) - 1] += r.planned;
  }
  const actual = Array(12).fill(0) as number[];
  for (const a of monthly) if (ids.has(a.line_id) && a.month >= 1 && a.month <= 12) actual[a.month - 1] += a.actual;
  const m = elapsedMonths(year, today);
  const landing = forecastRows(ofNature, year, today, 90, opts.method ?? "prudent").reduce((s, f) => s + f.landing, 0);
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

/** Regroupement par section analytique (rapport) : lignes racines d'une nature, une ligne par section. */
export function bySection(rows: BudgetRowLike[], nature: BudgetNature) {
  const m = new Map<string, { section: string; planned: number; precommitted: number; committed: number; actual: number; available: number }>();
  for (const r of rootLines(rows.filter((x) => natureOf(x) === nature && x.analytic_value_id != null))) {
    const k = r.analytic_value_id!;
    const e = m.get(k) ?? { section: `${r.analytic_code ?? ""} ${r.analytic_name ?? ""}`.trim(), planned: 0, precommitted: 0, committed: 0, actual: 0, available: 0 };
    e.planned += r.planned; e.precommitted += r.precommitted; e.committed += r.committed; e.actual += r.actual; e.available += r.available;
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => a.section.localeCompare(b.section));
}

export type CompareLine = { key: string; account: string; section: string; a: number; b: number; diff: number; pct: number | null };

/** Comparaison de deux jeux de montants (budgets, versions de prévision) par compte × section. */
export function compareAmounts(a: { account: string; section: string; amount: number }[], b: { account: string; section: string; amount: number }[]): CompareLine[] {
  const m = new Map<string, CompareLine>();
  const add = (x: { account: string; section: string; amount: number }, side: "a" | "b") => {
    const key = `${x.account}|${x.section}`;
    const e = m.get(key) ?? { key, account: x.account, section: x.section, a: 0, b: 0, diff: 0, pct: null };
    e[side] += x.amount;
    m.set(key, e);
  };
  a.forEach((x) => add(x, "a"));
  b.forEach((x) => add(x, "b"));
  return [...m.values()].map((e) => ({ ...e, diff: Math.round((e.b - e.a) * 100) / 100, pct: e.a !== 0 ? Math.round(((e.b - e.a) / e.a) * 1000) / 10 : null }))
    .sort((x, y) => x.account.localeCompare(y.account) || x.section.localeCompare(y.section));
}
