import { useEffect, type ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguageContext } from "@/hooks/use-language";
import { detectBrowserLanguage, isSupportedLanguage, switchLanguage } from "@/i18n";
import { LEGACY_LOCALE, setFormatPreferences } from "@/lib/locale-format";

/** Cache local par utilisateur : jamais relu pour un autre compte, jamais avant connexion. */
const cacheKey = (userId: string) => `qerp-language:${userId}`;

function readCache(userId: string): string | null {
  try { return globalThis.localStorage?.getItem(cacheKey(userId)) ?? null; } catch { return null; }
}
function writeCache(userId: string, language: string) {
  try { globalThis.localStorage?.setItem(cacheKey(userId), language); } catch { /* stockage indisponible */ }
}

/**
 * Applique la langue résolue par le serveur (préférence autorisée > société > plateforme > source).
 * Avant connexion : langue du navigateur prise en charge, sinon français ; formats historiques fr-FR.
 * Une langue qui manque ou un échec de lecture laissent l'interface utilisable en français.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const context = useLanguageContext();
  const userId = user?.id;

  useEffect(() => {
    if (!userId) {
      setFormatPreferences(LEGACY_LOCALE);
      void switchLanguage(detectBrowserLanguage());
      return;
    }
    const cached = readCache(userId);
    if (cached && isSupportedLanguage(cached)) void switchLanguage(cached);
  }, [userId]);

  useEffect(() => {
    if (!userId || !context.data) return;
    setFormatPreferences(context.data.locale, context.data.timezone);
    void switchLanguage(context.data.language).then((applied) => writeCache(userId, applied));
  }, [userId, context.data]);

  return <>{children}</>;
}
