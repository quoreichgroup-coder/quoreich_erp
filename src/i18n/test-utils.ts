/**
 * Initialisation synchrone pour Vitest : tous les catalogues embarqués, langue française par défaut.
 * Les tests existants voient donc exactement les textes français d'origine (D-I18N-009).
 */
import { initReactI18next } from "react-i18next";
import { i18n, NAMESPACES, SOURCE_LANGUAGE } from "@/i18n";

const catalogs = import.meta.glob<{ default: Record<string, unknown> }>("./locales/*/*.json", { eager: true });

export function allResources() {
  const resources: Record<string, Record<string, Record<string, unknown>>> = {};
  for (const [path, module] of Object.entries(catalogs)) {
    const [, language, namespace] = /\.\/locales\/([^/]+)\/([^/]+)\.json$/.exec(path) ?? [];
    if (!language || !namespace) continue;
    (resources[language] ??= {})[namespace] = module.default;
  }
  return resources;
}

export function initI18nForTests(language = SOURCE_LANGUAGE) {
  if (i18n.isInitialized) {
    if (i18n.language !== language) void i18n.changeLanguage(language);
    return i18n;
  }
  i18n.use(initReactI18next).init({
    lng: language,
    fallbackLng: SOURCE_LANGUAGE,
    ns: [...NAMESPACES],
    defaultNS: "common",
    resources: allResources(),
    interpolation: { escapeValue: false },
    initAsync: false,
    react: { useSuspense: false },
  });
  return i18n;
}
