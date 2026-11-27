/**
 * Formats régionaux (D-I18N-003, C-02) : un seul endroit pour afficher et relire nombres, montants et dates.
 *
 * - La LOCALE (fr-BF, fr-FR, en-GB, en-US) ne décide que de la présentation : séparateurs, ordre jour/mois.
 * - La DEVISE vient toujours de la donnée (pièce, société), jamais de la locale ; ses décimales suivent
 *   ISO 4217 via Intl (XOF : 0).
 * - Une date comptable (AAAA-MM-JJ, sans heure) s'affiche toujours au même jour, quel que soit le fuseau
 *   du navigateur ou de la société : elle n'est jamais convertie en instant.
 * - Rien n'est arrondi ni modifié ici : ces fonctions ne servent qu'à l'affichage et à la relecture.
 */

export const SUPPORTED_LOCALES = ["fr-BF", "fr-FR", "en-GB", "en-US"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const LEGACY_LOCALE: SupportedLocale = "fr-FR"; // présentation historique de QERP

let currentLocale: SupportedLocale = LEGACY_LOCALE;
let currentTimeZone: string | undefined;

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** Fuseau IANA reconnu par le navigateur, sinon `undefined` (fuseau du navigateur). */
export function validTimeZone(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return value;
  } catch {
    return undefined;
  }
}

const listeners = new Set<() => void>();
let version = 0;

export function setFormatPreferences(locale: unknown, timeZone?: unknown) {
  const nextLocale = isSupportedLocale(locale) ? locale : LEGACY_LOCALE;
  const nextZone = validTimeZone(timeZone);
  if (nextLocale === currentLocale && nextZone === currentTimeZone) return;
  currentLocale = nextLocale;
  currentTimeZone = nextZone;
  version += 1;
  listeners.forEach((notify) => notify());
}

/** Abonnement pour `useSyncExternalStore` : les écrans se redessinent quand la locale change seule. */
export function subscribeFormatPreferences(notify: () => void) {
  listeners.add(notify);
  return () => { listeners.delete(notify); };
}
export const formatPreferencesVersion = () => version;
export const getFormatLocale = () => currentLocale;
export const getTimeZone = () => currentTimeZone;

/** Intl écrit l'espace fine insécable (U+202F) et l'insécable (U+00A0) : on les garde à l'écran. */
export function formatNumber(value: number, options: Intl.NumberFormatOptions = {}, locale: string = currentLocale): string {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2, ...options }).format(value);
}

export function currencyDigits(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/**
 * Montant dans la devise de la donnée. `currency` est obligatoire : aucune devise implicite.
 * `display: "code"` (par défaut) écrit « XOF » plutôt qu'un symbole ambigu (« F CFA » vaut XOF et XAF).
 */
export function formatMoney(amount: number, currency: string, locale: string = currentLocale,
  display: "code" | "symbol" = "code"): string {
  if (!Number.isFinite(amount)) return "—";
  const digits = currencyDigits(currency);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency", currency, currencyDisplay: display, minimumFractionDigits: digits, maximumFractionDigits: digits,
    }).format(amount);
  } catch {
    return `${formatNumber(amount, { maximumFractionDigits: digits }, locale)} ${currency}`;
  }
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Date comptable AAAA-MM-JJ : affichée au même jour partout (calcul en UTC, jamais d'instant local). */
export function formatDate(value: string | null | undefined, locale: string = currentLocale,
  options: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric" }): string {
  if (!value) return "—";
  const m = DATE_ONLY.exec(value.slice(0, 10));
  if (!m) return value;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(date);
}

/** Horodatage (instant) : affiché dans le fuseau de la société, sinon celui du navigateur. */
export function formatDateTime(value: string | Date | null | undefined, locale: string = currentLocale,
  timeZone: string | undefined = currentTimeZone): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short", timeZone: validTimeZone(timeZone) }).format(date);
}

/** Mois abrégé d'un graphique (AAAA-MM) : même règle que les dates comptables. */
export function formatMonth(yearMonth: string, locale: string = currentLocale): string {
  return formatDate(`${yearMonth.slice(0, 7)}-01`, locale, { month: "short" });
}

/** Séparateurs de la locale, lus dans Intl (pas de table codée en dur). */
export function separators(locale: string = currentLocale) {
  const parts = new Intl.NumberFormat(locale).formatToParts(1234567.5);
  return {
    group: parts.find((p) => p.type === "group")?.value ?? " ",
    decimal: parts.find((p) => p.type === "decimal")?.value ?? ",",
  };
}

/**
 * Relit un nombre saisi selon la locale. Espaces (y compris insécables) ignorés ; le séparateur de
 * milliers de la locale est retiré ; son séparateur décimal vaut « . ». En locale française, le point
 * est aussi accepté comme décimale (pavé numérique), car il n'y sert pas de séparateur de milliers.
 * En anglais, la virgule reste un séparateur de milliers : « 1,250 » vaut 1250. `NaN` si illisible.
 */
export function parseDecimalInput(text: string, locale: string = currentLocale): number {
  const raw = text.trim().replace(/\s/g, "");
  if (!raw) return Number.NaN;
  const { group, decimal } = separators(locale);
  const groupChar = /^\s$/.test(group) ? "" : group;
  let s = raw;
  if (groupChar && groupChar !== decimal) s = s.split(groupChar).join("");
  if (decimal !== ".") s = s.split(decimal).join(".");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return Number.NaN;
  return Number(s);
}

/**
 * Séparateur d'un CSV destiné à être ouvert par l'utilisateur dans son tableur (Excel suit la locale).
 * Les échanges machine (imports, API) gardent leur format stable et ne passent pas par ici.
 */
export function userCsvSeparator(locale: string = currentLocale): ";" | "," {
  return separators(locale).decimal === "," ? ";" : ",";
}
