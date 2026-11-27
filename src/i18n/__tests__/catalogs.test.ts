import { describe, expect, it } from "vitest";
import frNav from "@/i18n/locales/fr/nav.json";
import enNav from "@/i18n/locales/en/nav.json";
import { navCatalog } from "../../../scripts/i18n/generer-catalogue-menu";
import { detectBrowserLanguage } from "@/i18n";
import { isI18nReady } from "@/i18n/ready-routes";
import { navItemKey, navPathKey } from "@/i18n/nav-keys";

const flat = (catalog: Record<string, Record<string, string>>) =>
  Object.fromEntries(Object.entries(catalog).flatMap(([group, entries]) => Object.entries(entries).map(([k, v]) => [`${group}.${k}`, v])));

describe("catalogues (AC01)", () => {
  it("le menu français généré reste identique à navigation.ts (aucune entrée oubliée ou périmée)", () => {
    expect(flat(frNav)).toEqual(navCatalog());
  });

  it("chaque entrée du menu a sa traduction anglaise, sans clé brute ni texte français resté tel quel", () => {
    const fr = flat(frNav);
    const en = flat(enNav);
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort());
    for (const [key, value] of Object.entries(en)) {
      expect(value, key).not.toMatch(/^(item|module|section)\./);
      if (!["CRM", "Transactions", "Administration", "Documentation"].includes(value)) expect(value, key).not.toBe(fr[key]);
    }
  });

  it("clés de menu dérivées des adresses, stables et sans hiérarchie accidentelle", () => {
    expect(navPathKey("/")).toBe("home");
    expect(navItemKey("/sales/transactions")).toBe("item.sales__transactions");
    expect(navItemKey("/settings?tab=fiscal")).toBe("item.settings__tab_fiscal");
    expect(navItemKey("/payables/payment-planning")).toBe("item.payables__payment_planning");
  });

  it("avant connexion : première langue du navigateur prise en charge, sinon le français", () => {
    expect(detectBrowserLanguage(["en-GB", "fr"])).toBe("en");
    expect(detectBrowserLanguage(["pt-BR", "fr-BF"])).toBe("fr");
    expect(detectBrowserLanguage(["de-DE"])).toBe("fr");
    expect(detectBrowserLanguage([])).toBe("fr");
  });

  it("seuls les écrans du périmètre pilote sont déclarés traduits", () => {
    expect(isI18nReady("/sales")).toBe(true);
    expect(isI18nReady("/settings", "?tab=languages")).toBe(true);
    expect(isI18nReady("/settings", "?tab=fiscal")).toBe(false);
    expect(isI18nReady("/sales/transactions")).toBe(false);
  });
});
