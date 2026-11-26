import { Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useLanguageContext, useSetMyLanguage } from "@/hooks/use-language";
import { SUPPORTED_LANGUAGES, isSupportedLanguage, switchLanguage } from "@/i18n";
import { errorText } from "@/i18n/errors";
import { cn } from "@/lib/utils";

type SwitchProps = { className?: string; allowed: readonly string[]; busy?: boolean; onChoose: (language: string) => void };

function LanguageButtons({ className, allowed, busy, onChoose }: SwitchProps) {
  const { t, i18n } = useTranslation();
  const current = i18n.resolvedLanguage ?? i18n.language;
  if (allowed.length < 2) return null;
  return (
    <div role="group" aria-label={t("language.label")} className={cn("inline-flex items-center gap-1 rounded-md border border-border p-0.5", className)}>
      <Languages aria-hidden="true" className="ml-1 size-3.5 text-muted-foreground" />
      {allowed.map((language) => (
        <button key={language} type="button" lang={language} aria-pressed={current === language}
          aria-label={t(`language.${language}`)} title={t("language.switch_to", { language: t(`language.${language}`) })}
          disabled={busy} data-testid={`language-${language}`}
          onClick={() => { if (language !== current) onChoose(language); }}
          className={cn("min-h-8 min-w-9 rounded px-2 text-xs font-medium uppercase focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            current === language ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>
          {language}
        </button>
      ))}
    </div>
  );
}

/**
 * Avant connexion (écran d'accueil) : la langue change pour cette session de navigation seulement,
 * il n'y a pas de compte à qui l'enregistrer. Aucune requête au serveur.
 */
export function LanguageQuickSwitch({ className }: { className?: string }) {
  return <LanguageButtons className={className} allowed={SUPPORTED_LANGUAGES} onChoose={(language) => void switchLanguage(language)} />;
}

/**
 * Connecté : la préférence est enregistrée par le serveur (validée contre les langues de la société),
 * puis appliquée sans rechargement — les formulaires ouverts gardent leur saisie.
 */
export function AccountLanguageSwitch({ className }: { className?: string }) {
  const context = useLanguageContext();
  const save = useSetMyLanguage();
  const allowed = context.data ? context.data.allowed_languages.filter(isSupportedLanguage) : [];
  async function choose(language: string) {
    try {
      await save.mutateAsync({ language, locale: context.data?.user_locale ?? null });
      await switchLanguage(language);
    } catch (error) {
      toast.error(errorText(error));
    }
  }
  return <LanguageButtons className={className} allowed={allowed} busy={save.isPending} onChoose={(language) => void choose(language)} />;
}
