import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import {
  formatDate, formatDateTime, formatMoney, formatMonth, formatNumber, formatPreferencesVersion,
  getFormatLocale, getTimeZone, subscribeFormatPreferences,
} from "@/lib/locale-format";

/**
 * Formateurs liés à la locale courante. Le composant se redessine quand la locale ou le fuseau changent
 * (même sans changement de langue) et quand la langue change.
 */
export function useLocaleFormat() {
  useSyncExternalStore(subscribeFormatPreferences, formatPreferencesVersion, formatPreferencesVersion);
  useTranslation(); // abonne aussi au changement de langue
  const locale = getFormatLocale();
  const timeZone = getTimeZone();
  return {
    locale,
    timeZone,
    number: (value: number, options?: Intl.NumberFormatOptions) => formatNumber(value, options, locale),
    money: (amount: number, currency: string) => formatMoney(amount, currency, locale),
    date: (value: string | null | undefined) => formatDate(value, locale),
    dateTime: (value: string | Date | null | undefined) => formatDateTime(value, locale, timeZone),
    month: (yearMonth: string) => formatMonth(yearMonth, locale),
  };
}
