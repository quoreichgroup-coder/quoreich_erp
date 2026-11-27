import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPut, isApiEnabled } from "@/api/client";
import { supabase } from "@/integrations/supabase/client";
import { useOptionalAuth } from "@/contexts/AuthContext";
import { useTenantId } from "@/hooks/use-tenant";

// V155 n'est pas encore dans le client Supabase généré (types régénérés au déploiement).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type LanguageRow = { code: string; label: string; direction: "ltr" | "rtl"; default_locale: string; is_source: boolean };
export type LocaleRow = { code: string; language: string; label: string };
export type LanguageContext = {
  language: string;
  locale: string;
  timezone: string | null;
  source_language: string;
  user_language: string | null;
  user_locale: string | null;
  tenant_language: string | null;
  tenant_locale: string | null;
  allowed_languages: string[];
  tenant_languages: string[];
  languages: LanguageRow[];
  locales: LocaleRow[];
};

/** Clé propre à l'utilisateur ET à la société : aucune réponse ne passe d'une session à l'autre. */
export const languageKey = (userId: string | undefined, tenantId: string | undefined) =>
  ["language-context", userId ?? "-", tenantId ?? "-", isApiEnabled() ? "api" : "supabase"] as const;

async function readOrThrow<T>(request: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await request;
  if (error) throw error; // garde code / hint / details pour errorText()
  return data;
}

export async function fetchLanguageContext(): Promise<LanguageContext> {
  if (isApiEnabled()) return normalizeLanguageContext(await apiGet<unknown>("/api/v1/me/language"));
  // Chaque lecture est une fonction asynchrone : une erreur levée en construisant une requête devient
  // un rejet géré par Promise.all, jamais une promesse orpheline (rejet non géré).
  const [context, languages, locales] = await Promise.all([
    (async () => readOrThrow<Omit<LanguageContext, "languages" | "locales">>(db.rpc("my_language_context")))(),
    (async () => readOrThrow<LanguageRow[]>(db.from("languages").select("code, label, direction, default_locale, is_source")
      .eq("is_active", true).order("sort_order")))(),
    (async () => readOrThrow<LocaleRow[]>(db.from("supported_locales").select("code, language, label").eq("is_active", true).order("sort_order")))(),
  ]);
  return normalizeLanguageContext({ ...context, languages, locales });
}

/**
 * Une réponse inattendue (base sans V155, réponse vide, valeur nulle) ne doit jamais faire planter
 * l'interface : elle devient une erreur de requête et l'écran reste dans la langue courante (repli).
 */
export function normalizeLanguageContext(raw: unknown): LanguageContext {
  const c = (raw ?? {}) as Partial<LanguageContext>;
  if (typeof c.language !== "string" || !c.language) throw new Error("Contexte de langue indisponible");
  const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    language: c.language, locale: typeof c.locale === "string" ? c.locale : "", timezone: c.timezone ?? null,
    source_language: c.source_language ?? "fr", user_language: c.user_language ?? null, user_locale: c.user_locale ?? null,
    tenant_language: c.tenant_language ?? null, tenant_locale: c.tenant_locale ?? null,
    allowed_languages: list<string>(c.allowed_languages), tenant_languages: list<string>(c.tenant_languages),
    languages: list<LanguageRow>(c.languages), locales: list<LocaleRow>(c.locales),
  };
}

export function useLanguageContext() {
  const user = useOptionalAuth()?.user;
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: languageKey(user?.id, tenantId ?? undefined),
    enabled: Boolean(user?.id && tenantId),
    queryFn: fetchLanguageContext,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useSetMyLanguage() {
  const client = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async (input: { language: string | null; locale: string | null }) => {
      if (isApiEnabled()) return apiPut<unknown>("/api/v1/me/language", input);
      return readOrThrow(db.rpc("set_my_language_preferences", { _language: input.language, _locale: input.locale }));
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["language-context"] }),
  });
}

export type CompanyLanguageInput = {
  default_language: string | null;
  default_locale: string | null;
  timezone: string | null;
  languages: string[];
};

export function useSetCompanyLanguages() {
  const client = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async (input: CompanyLanguageInput) => {
      if (isApiEnabled()) return apiPut<unknown>("/api/v1/languages/settings", input);
      return readOrThrow(db.rpc("set_company_language_settings", {
        _default_language: input.default_language, _default_locale: input.default_locale,
        _timezone: input.timezone, _languages: input.languages,
      }));
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["language-context"] }),
  });
}
