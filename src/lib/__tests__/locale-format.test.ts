import { afterEach, describe, expect, it } from "vitest";
import {
  SUPPORTED_LOCALES, currencyDigits, formatDate, formatDateTime, formatMoney, formatNumber, getFormatLocale,
  parseDecimalInput, setFormatPreferences, userCsvSeparator, validTimeZone,
} from "@/lib/locale-format";

const NBSP = String.fromCharCode(0xa0);
const NNBSP = String.fromCharCode(0x202f);
const spaces = (s: string) => s.split(NBSP).join(" ").split(NNBSP).join(" ");

afterEach(() => setFormatPreferences("fr-FR"));

describe("formats régionaux (C-02, AC04)", () => {
  it("même montant XOF dans les quatre locales : la devise vient de la donnée, jamais de la locale", () => {
    const shown = Object.fromEntries(SUPPORTED_LOCALES.map((l) => [l, spaces(formatMoney(1250300, "XOF", l))]));
    expect(shown).toEqual({
      "fr-BF": "1 250 300 XOF", "fr-FR": "1 250 300 XOF", "en-GB": "XOF 1,250,300", "en-US": "XOF 1,250,300",
    });
    // Le nombre relu est identique partout : seule la présentation change.
    for (const l of SUPPORTED_LOCALES) expect(parseDecimalInput(formatNumber(1250300, {}, l), l)).toBe(1250300);
  });

  it("décimales de la devise (ISO 4217) : XOF 0, EUR 2 ; aucun arrondi ne touche la valeur stockée", () => {
    expect(currencyDigits("XOF")).toBe(0);
    expect(currencyDigits("EUR")).toBe(2);
    expect(spaces(formatMoney(1234.5, "EUR", "fr-FR"))).toBe("1 234,50 EUR");
    expect(spaces(formatMoney(1234.5, "EUR", "en-US"))).toBe("EUR 1,234.50");
    const stored = 1250300.4;
    formatMoney(stored, "XOF", "en-GB");
    expect(stored).toBe(1250300.4);
  });

  it("une date comptable ne change jamais de jour, quel que soit le fuseau du navigateur ou de la société", () => {
    const original = process.env.TZ;
    try {
      for (const tz of ["Pacific/Kiritimati", "Pacific/Pago_Pago", "Africa/Ouagadougou", "America/New_York"]) {
        process.env.TZ = tz;
        expect(formatDate("2026-01-01", "fr-BF")).toBe("01/01/2026");
        expect(formatDate("2026-12-31", "en-US")).toBe("12/31/2026");
        expect(formatDate("2026-02-28", "en-GB")).toBe("28/02/2026");
      }
    } finally {
      process.env.TZ = original;
    }
  });

  it("un horodatage s'affiche dans le fuseau de la société ; un fuseau inconnu est ignoré", () => {
    expect(validTimeZone("Africa/Ouagadougou")).toBe("Africa/Ouagadougou");
    expect(validTimeZone("Mars/Olympus")).toBeUndefined();
    const instant = "2026-11-26T23:30:00Z";
    expect(formatDateTime(instant, "fr-FR", "Africa/Ouagadougou")).toContain("26/11/2026");
    expect(formatDateTime(instant, "fr-FR", "Asia/Tokyo")).toContain("27/11/2026");
    setFormatPreferences("en-GB", "Mars/Olympus");
    expect(getFormatLocale()).toBe("en-GB");
  });

  it("relecture des saisies selon la locale", () => {
    expect(parseDecimalInput("1 250 300,50", "fr-FR")).toBe(1250300.5);
    expect(parseDecimalInput(`1${NNBSP}250${NNBSP}300,5`, "fr-BF")).toBe(1250300.5);
    expect(parseDecimalInput("12.5", "fr-FR")).toBe(12.5); // pavé numérique
    expect(parseDecimalInput("1,250,300.50", "en-US")).toBe(1250300.5);
    expect(parseDecimalInput("1,250", "en-GB")).toBe(1250); // virgule = milliers en anglais
    expect(parseDecimalInput("abc", "fr-FR")).toBeNaN();
    expect(parseDecimalInput("", "en-US")).toBeNaN();
  });

  it("locale inconnue : repli sur la présentation historique fr-FR ; CSV utilisateur selon la décimale", () => {
    setFormatPreferences("de-DE");
    expect(getFormatLocale()).toBe("fr-FR");
    expect(userCsvSeparator("fr-BF")).toBe(";");
    expect(userCsvSeparator("en-US")).toBe(",");
  });
});
