/**
 * Erreurs publiques traduisibles (D-I18N-004, C-01, C-04).
 *
 * Une seule source de vérité pour les clés : `services/api/src/main/resources/i18n/error-keys.json`,
 * lu par l'API Java (PublicErrorDetails) ET par ce module. Les deux chemins arrivent ici :
 * - API Java : `{ code, key, params, error }`, déjà filtré par le serveur, revalidé ici ;
 * - Supabase : PostgREST transmet `hint` (la clé) et `details` (paramètres JSON) tels que la base les
 *   écrit ; ils ne contiennent par construction que des paramètres publics, et sont validés ici de la
 *   même façon (clé enregistrée, paramètres déclarés, types et longueurs bornés).
 * Clé absente, inconnue ou paramètres invalides : le message français d'origine est affiché, comme avant.
 */
import registry from "../../services/api/src/main/resources/i18n/error-keys.json";
import { i18n } from "@/i18n";

export const ERROR_KEY = /^errors:[a-z0-9_]+(\.[a-z0-9_]+)+$/;
const REGISTRY = registry as Record<string, string[]>;
const MAX_STRING = 200;
const MAX_ITEMS = 20;
const MAX_ITEM = 64;
const MAX_DETAIL = 2000;

export type PublicParams = Record<string, string | number | boolean | string[]>;
export type PublicError = { code?: string; key?: string; params: PublicParams; message: string };

function publicValue(value: unknown): string | number | boolean | string[] | undefined {
  if (typeof value === "string") return value.length <= MAX_STRING ? value : undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value) && value.length <= MAX_ITEMS
    && value.every((v) => typeof v === "string" && v.length <= MAX_ITEM)) return value as string[];
  return undefined;
}

/** Clé et paramètres validés, ou `null` (repli sur le message d'origine). */
export function validateKeyed(key: unknown, params: unknown): { key: string; params: PublicParams } | null {
  if (typeof key !== "string" || key.length > 120 || !ERROR_KEY.test(key)) return null;
  const allowed = REGISTRY[key];
  if (!allowed) return null;
  let raw: unknown = params ?? {};
  if (typeof raw === "string") {
    if (raw.length > MAX_DETAIL) return null;
    try { raw = raw ? JSON.parse(raw) : {}; } catch { return null; }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: PublicParams = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowed.includes(name)) continue;
    const v = publicValue(value);
    if (v === undefined) return null;
    out[name] = v;
  }
  return { key, params: out };
}

/** Normalise une erreur des deux chemins (ApiHttpError, PostgrestError, Error) sans rien exposer de brut. */
export function publicError(error: unknown): PublicError {
  const e = (error ?? {}) as { message?: unknown; code?: unknown; key?: unknown; params?: unknown; hint?: unknown; details?: unknown };
  const message = typeof e.message === "string" && e.message.trim() ? e.message : String(error ?? "");
  const code = typeof e.code === "string" ? e.code : undefined;
  const keyed = validateKeyed(e.key ?? e.hint, e.key !== undefined ? e.params : e.details);
  return keyed ? { code, key: keyed.key, params: keyed.params, message } : { code, params: {}, message };
}

/** Un HINT qui est une clé de traduction ne doit jamais s'afficher comme un conseil. */
export function isTranslationKey(hint: unknown): boolean {
  return typeof hint === "string" && ERROR_KEY.test(hint);
}

/** Texte à montrer : traduction de la clé dans la langue courante si elle existe, sinon message d'origine. */
export function errorText(error: unknown): string {
  const p = publicError(error);
  if (!p.key) return p.message;
  const [ns, path] = p.key.split(":") as [string, string];
  if (!i18n.isInitialized || !i18n.exists(path, { ns })) return p.message;
  const params: Record<string, unknown> = { ...p.params };
  for (const [name, value] of Object.entries(params)) {
    if (Array.isArray(value)) params[name] = value.map((v) => i18n.t(`common:posting_role.${v}`, { defaultValue: v })).join(", ");
  }
  return i18n.t(path, { ns, ...params, defaultValue: p.message }) as string;
}
