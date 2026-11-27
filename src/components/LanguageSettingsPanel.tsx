import { useEffect, useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMyAccess } from "@/hooks/use-my-access";
import { useLanguageContext, useSetCompanyLanguages, useSetMyLanguage, type LanguageContext } from "@/hooks/use-language";
import { useTenantCurrency } from "@/hooks/use-tenant-currency";
import { switchLanguage } from "@/i18n";
import { errorText } from "@/i18n/errors";
import { formatDate, formatMoney, validTimeZone } from "@/lib/locale-format";

const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const PREVIEW_AMOUNT = 1250300;
const PREVIEW_DATE = "2026-11-26";

function Preview({ locale, currency }: { locale: string; currency: string }) {
  const { t } = useTranslation("settings");
  return (
    <dl className="grid grid-cols-2 gap-2 rounded-md bg-muted/40 p-3 text-xs" data-testid="locale-preview">
      <dt className="text-muted-foreground">{t("languages.preview_amount")}</dt>
      <dd className="tabular-nums" data-testid="preview-amount">{formatMoney(PREVIEW_AMOUNT, currency, locale)}</dd>
      <dt className="text-muted-foreground">{t("languages.preview_date")}</dt>
      <dd className="tabular-nums" data-testid="preview-date">{formatDate(PREVIEW_DATE, locale)}</dd>
    </dl>
  );
}

function MyPreferences({ context, currency }: { context: LanguageContext; currency: string }) {
  const { t } = useTranslation(["settings", "common"]);
  const save = useSetMyLanguage();
  const [language, setLanguage] = useState(context.user_language ?? "");
  const [locale, setLocale] = useState(context.user_locale ?? "");
  const languageId = useId();
  const localeId = useId();
  const fallback = Boolean(context.user_language && context.user_language !== context.language);

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await save.mutateAsync({ language: language || null, locale: locale || null });
      if (language) await switchLanguage(language);
      toast.success(t("languages.saved"));
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  return (
    <Card>
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-sm">{t("languages.mine_title")}</CardTitle>
        <CardDescription className="text-xs">{t("languages.mine_hint")}</CardDescription>
      </CardHeader>
      <CardContent className="p-4 pt-2">
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" data-testid="my-language-form">
          <div className="grid gap-1.5">
            <Label htmlFor={languageId}>{t("languages.language")}</Label>
            <select id={languageId} className={selectClass} value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="">{t("languages.inherit")}</option>
              {context.languages.filter((l) => context.allowed_languages.includes(l.code)).map((l) => (
                <option key={l.code} value={l.code} lang={l.code}>{l.label}</option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={localeId}>{t("languages.locale")}</Label>
            <select id={localeId} className={selectClass} value={locale} onChange={(e) => setLocale(e.target.value)}>
              <option value="">{t("languages.inherit")}</option>
              {context.locales.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2 grid gap-2">
            <p className="text-xs text-muted-foreground" role="status">
              {t("languages.resolved", { language: t(`common:language.${context.language}`), locale: context.locale })}
            </p>
            {fallback && <p className="text-xs text-muted-foreground">{t("languages.fallback_note")}</p>}
            <Preview locale={locale || context.locale} currency={currency} />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={save.isPending}>{t("languages.save_mine")}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function CompanySettings({ context, currency }: { context: LanguageContext; currency: string }) {
  const { t } = useTranslation("settings");
  const save = useSetCompanyLanguages();
  const [language, setLanguage] = useState(context.tenant_language ?? "");
  const [locale, setLocale] = useState(context.tenant_locale ?? "");
  const [timezone, setTimezone] = useState(context.timezone ?? "");
  const [allowed, setAllowed] = useState<string[]>(context.tenant_languages);
  const ids = { language: useId(), locale: useId(), timezone: useId(), timezoneHelp: useId() };
  const timezoneInvalid = timezone.trim() !== "" && !validTimeZone(timezone.trim());

  useEffect(() => { setAllowed(context.tenant_languages); }, [context.tenant_languages]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await save.mutateAsync({ default_language: language || null, default_locale: locale || null,
        timezone: timezone.trim() || null, languages: allowed });
      toast.success(t("languages.company_saved"));
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  return (
    <Card>
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-sm">{t("languages.company_title")}</CardTitle>
        <CardDescription className="text-xs">{t("languages.company_hint")}</CardDescription>
      </CardHeader>
      <CardContent className="p-4 pt-2">
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" data-testid="company-language-form">
          <div className="grid gap-1.5">
            <Label htmlFor={ids.language}>{t("languages.language")}</Label>
            <select id={ids.language} className={selectClass} value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="">{t("languages.platform_default")}</option>
              {context.languages.map((l) => <option key={l.code} value={l.code} lang={l.code}>{l.label}</option>)}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={ids.locale}>{t("languages.locale")}</Label>
            <select id={ids.locale} className={selectClass} value={locale} onChange={(e) => setLocale(e.target.value)}>
              <option value="">{t("languages.platform_default")}</option>
              {context.locales.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor={ids.timezone}>{t("languages.timezone")}</Label>
            <Input id={ids.timezone} value={timezone} placeholder={t("languages.timezone_placeholder")}
              aria-describedby={ids.timezoneHelp} aria-invalid={timezoneInvalid} onChange={(e) => setTimezone(e.target.value)} />
            <p id={ids.timezoneHelp} className="text-xs text-muted-foreground">{t("languages.timezone_help")}</p>
          </div>
          <fieldset className="sm:col-span-2 grid gap-2">
            <legend className="mb-1 text-sm font-medium">{t("languages.allowed")}</legend>
            <div className="flex flex-wrap gap-4">
              {context.languages.map((l) => (
                <label key={l.code} className="flex min-h-11 items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4" checked={allowed.includes(l.code)}
                    onChange={(e) => setAllowed((list) => e.target.checked ? [...list, l.code] : list.filter((x) => x !== l.code))} />
                  <span lang={l.code}>{l.label}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{t("languages.allowed_help")}</p>
          </fieldset>
          <div className="sm:col-span-2"><Preview locale={locale || context.locale} currency={currency} /></div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={save.isPending || timezoneInvalid}>{t("languages.save_company")}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function LanguageSettingsPanel() {
  const { t } = useTranslation("settings");
  const context = useLanguageContext();
  const { data: access } = useMyAccess();
  const currency = useTenantCurrency();
  const canManage = Boolean(access?.roles.includes("admin") || access?.permissions.includes("languages.settings"));

  if (context.isPending) return <p className="text-sm text-muted-foreground">{t("languages.loading")}</p>;
  if (context.isError) return <p role="alert" className="text-sm text-destructive">{errorText(context.error) || t("languages.load_error")}</p>;
  return (
    <div className="grid gap-4">
      <MyPreferences key={`${context.data.user_language}-${context.data.user_locale}`} context={context.data} currency={currency} />
      {canManage && <CompanySettings key={`${context.data.tenant_language}-${context.data.tenant_locale}-${context.data.timezone}`}
        context={context.data} currency={currency} />}
    </div>
  );
}
