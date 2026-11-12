/**
 * Analytique (V19) : axes de la société, leurs sections et les règles qui rendent un axe
 * obligatoire ou interdit selon le compte.
 *
 * Module pur : il reconstitue, depuis les lectures Supabase, la vue que sert l'API Java
 * (`GET /api/v1/analytics`), et porte les deux calculs dont l'écran a besoin :
 *   - l'ordre en arbre des sections (parent puis enfants, avec leur profondeur) ;
 *   - l'aperçu « que demande l'analytique sur tel compte », par la même règle que la base
 *     (enforce_analytics) : la règle au préfixe le plus long l'emporte, sans règle l'axe est
 *     facultatif.
 */
import type { ApiSchemas } from "@/api";

export type AnalyticsSetup = ApiSchemas["AnalyticsSetupView"];
export type AnalyticAxis = ApiSchemas["AnalyticAxisView"];
export type AnalyticValue = ApiSchemas["AnalyticValueView"];
export type AnalyticRule = ApiSchemas["AnalyticRuleView"];
export type Requirement = "required" | "forbidden" | "optional";

export interface RawAxis { id: string; code: string; name: string; sort_order: number; is_active: boolean }
export interface RawValue {
  id: string; axis_id: string; code: string; name: string; parent_id: string | null;
  valid_from: string | null; valid_to: string | null; is_active: boolean;
}
export interface RawRule { axis_id: string; account_prefix: string; requirement: "required" | "forbidden" }

export function buildAnalyticsSetup(input: {
  canManageAxes: boolean; canManageValues: boolean; axes: RawAxis[]; values: RawValue[]; rules: RawRule[];
}): AnalyticsSetup {
  const axes = [...input.axes].sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code));
  return {
    canManageAxes: input.canManageAxes,
    canManageValues: input.canManageValues,
    axes: axes.map((a) => ({
      id: a.id, code: a.code, name: a.name, sortOrder: a.sort_order, active: a.is_active,
      values: input.values
        .filter((v) => v.axis_id === a.id)
        .sort((x, y) => x.code.localeCompare(y.code))
        .map((v) => ({
          id: v.id, code: v.code, name: v.name, parentId: v.parent_id ?? undefined,
          validFrom: v.valid_from ?? undefined, validTo: v.valid_to ?? undefined, active: v.is_active,
        })),
      rules: input.rules
        .filter((r) => r.axis_id === a.id)
        .sort((x, y) => x.account_prefix.localeCompare(y.account_prefix))
        .map((r) => ({ accountPrefix: r.account_prefix, requirement: r.requirement })),
    })),
  };
}

/** Sections dans l'ordre de l'arbre, chacune avec sa profondeur (0 = racine). */
export function valueTree(values: AnalyticValue[]): { value: AnalyticValue; depth: number }[] {
  const children = new Map<string | undefined, AnalyticValue[]>();
  const ids = new Set(values.map((v) => v.id));
  for (const v of values) {
    // Un parent invisible (autre axe, supprimé) remonte la section à la racine plutôt que de la perdre.
    const key = v.parentId && ids.has(v.parentId) ? v.parentId : undefined;
    children.set(key, [...(children.get(key) ?? []), v]);
  }
  const out: { value: AnalyticValue; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | undefined, depth: number) => {
    for (const v of (children.get(parent) ?? []).sort((a, b) => a.code.localeCompare(b.code))) {
      if (seen.has(v.id)) continue; // garde-fou : la base interdit déjà les boucles (V20)
      seen.add(v.id);
      out.push({ value: v, depth });
      walk(v.id, depth + 1);
    }
  };
  walk(undefined, 0);
  return out;
}

/** Ce que l'analytique exige sur un compte, axe par axe, et la règle qui en décide. */
export function requirementsFor(
  setup: AnalyticsSetup,
  accountCode: string,
): { axis: AnalyticAxis; requirement: Requirement; rule?: AnalyticRule }[] {
  const code = accountCode.trim();
  return setup.axes
    .filter((a) => a.active)
    .map((axis) => {
      const rule = [...axis.rules]
        .filter((r) => code.length > 0 && code.startsWith(r.accountPrefix))
        .sort((x, y) => y.accountPrefix.length - x.accountPrefix.length)[0];
      return { axis, requirement: (rule?.requirement ?? "optional") as Requirement, rule };
    });
}

/**
 * Sections imputables à une date : actives et dans leur période de validité — la même condition
 * que enforce_analytics(). Proposer une section que la base refuserait serait un piège.
 */
export function usableValues(axis: AnalyticAxis, date: string): AnalyticValue[] {
  return axis.values.filter(
    (v) => v.active && (!v.validFrom || v.validFrom <= date) && (!v.validTo || date <= v.validTo),
  );
}

/** Axes obligatoires sur un compte (ex. le compte de ventes de la société), dans l'ordre. */
export function requiredAxisIds(setup: AnalyticsSetup | undefined, accountCode: string | undefined): Set<string> {
  if (!setup || !accountCode) return new Set();
  return new Set(requirementsFor(setup, accountCode).filter((r) => r.requirement === "required").map((r) => r.axis.id));
}

/** Code d'axe : comme la base, majuscules, chiffres et _ , commençant par une lettre. */
export const AXIS_CODE = /^[A-Z][A-Z0-9_]*$/;
export const ACCOUNT_PREFIX = /^[0-9]+$/;

export const REQUIREMENT_LABELS: Record<Requirement, string> = {
  required: "Obligatoire",
  forbidden: "Interdit",
  optional: "Facultatif",
};
