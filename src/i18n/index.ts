/**
 * Langue de l'interface (D-I18N-001, D-I18N-002) : i18next + react-i18next, français source.
 *
 * - Catalogues JSON par langue et par namespace (`locales/<langue>/<namespace>.json`), chargés à la
 *   demande par `import()` : le premier écran n'embarque que `common`, `nav`, `auth` et `errors`.
 * - Une langue n'est appliquée qu'APRÈS le chargement de tous les namespaces déjà utilisés : la bascule
 *   ne suspend jamais l'arbre React, donc aucun formulaire n'est démonté (saisie conservée).
 * - Repli explicite : langue demandée → français → clé (jamais d'opération bloquée par une traduction).
 */
import i18next, { type BackendModule, type i18n as I18n } from "i18next";
import { initReactI18next } from "react-i18next";

export const SOURCE_LANGUAGE = "fr";
export const SUPPORTED_LANGUAGES = ["fr", "en"] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];
export const BOOT_NAMESPACES = ["common", "nav", "auth", "errors"] as const;
export const NAMESPACES = [...BOOT_NAMESPACES, "settings", "sales", "documents"] as const;
const RTL = new Set(["ar", "he", "fa", "ur"]);

const loaders = import.meta.glob<{ default: Record<string, unknown> }>("./locales/*/*.json");

const lazyCatalogs: BackendModule = {
  type: "backend",
  init() {},
  read(language, namespace, callback) {
    const load = loaders[`./locales/${language}/${namespace}.json`];
    if (!load) return callback(null, {});
    load().then((module) => callback(null, module.default)).catch((error) => callback(error, null));
  },
};

export function isSupportedLanguage(value: unknown): value is Language {
  return typeof value === "string" && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/** Avant connexion : première langue du navigateur prise en charge, sinon la langue source. */
export function detectBrowserLanguage(languages: readonly string[] = globalThis.navigator?.languages ?? []): Language {
  for (const tag of languages) {
    const base = tag.toLowerCase().split("-")[0];
    if (isSupportedLanguage(base)) return base;
  }
  return SOURCE_LANGUAGE;
}

function applyDocumentLanguage(language: string) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = language;
  document.documentElement.dir = RTL.has(language) ? "rtl" : "ltr";
}

export const i18n: I18n = i18next.createInstance();
// <html lang> et dir suivent toujours la langue appliquée, quel que soit le chemin d'initialisation.
i18n.on("languageChanged", applyDocumentLanguage);
let ready: Promise<unknown> | null = null;

export function initI18n(language: Language = detectBrowserLanguage()): Promise<unknown> {
  if (ready) return ready;
  if (i18n.isInitialized) return (ready = Promise.resolve()); // déjà initialisé (tests)
  i18n.use(lazyCatalogs).use(initReactI18next);
  ready = i18n.init({
    lng: language,
    fallbackLng: SOURCE_LANGUAGE,
    supportedLngs: [...SUPPORTED_LANGUAGES],
    ns: [...BOOT_NAMESPACES],
    defaultNS: "common",
    interpolation: { escapeValue: false }, // React échappe déjà le texte rendu.
    react: { useSuspense: true, bindI18n: "languageChanged loaded" },
  }).then(() => applyDocumentLanguage(i18n.language));
  return ready;
}

/**
 * Change la langue sans suspendre l'interface : charge d'abord tous les namespaces déjà ouverts
 * dans la nouvelle langue (et la source pour le repli), puis bascule.
 */
export async function switchLanguage(language: string): Promise<Language> {
  const target = isSupportedLanguage(language) ? language : SOURCE_LANGUAGE;
  await initI18n(target);
  if (i18n.language === target) return target;
  const namespaces = [...new Set([...BOOT_NAMESPACES, ...((i18n.options.ns as string[] | undefined) ?? [])])];
  await i18n.loadLanguages([target, SOURCE_LANGUAGE]);
  await i18n.loadNamespaces(namespaces);
  await i18n.changeLanguage(target);
  return target;
}

/** Traduction hors composant (toasts émis par les hooks) : toujours dans la langue courante. */
export function tr(key: string, options?: Record<string, unknown>): string {
  return String(i18n.t(key, options as never));
}
