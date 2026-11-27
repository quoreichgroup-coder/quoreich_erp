import { afterEach, describe, expect, it } from "vitest";
import { ApiHttpError } from "@/api/client";
import { i18n } from "@/i18n";
import { errorText, isTranslationKey, publicError, validateKeyed } from "@/i18n/errors";
import { hrErrorMessage } from "@/lib/hr-error-message";

afterEach(async () => { await i18n.changeLanguage("fr"); });

const supabaseRefusal = {
  code: "QG001",
  message: "Paramétrage comptable incomplet : Clients ; la facture FV-1 ne peut pas être émise",
  hint: "errors:posting.account_missing",
  details: JSON.stringify({ roles: ["AR_RECEIVABLE", "SALES_REVENUE"], document: "FV-1" }),
};

describe("erreurs traduisibles (C-01, C-04, AC05)", () => {
  it("chemin Supabase : clé et paramètres lus dans hint / details, traduits dans la langue courante", async () => {
    await i18n.changeLanguage("en");
    expect(errorText(supabaseRefusal)).toBe("Incomplete accounting setup: Receivables, Sales. Link an active account to each role in the accounting setup.");
    await i18n.changeLanguage("fr");
    expect(errorText(supabaseRefusal)).toBe("Paramétrage comptable incomplet : Clients, Ventes. Associez un compte actif à chaque rôle dans le paramétrage comptable.");
  });

  it("chemin API Java : même rendu depuis { code, key, params, error }", async () => {
    await i18n.changeLanguage("en");
    const error = new ApiHttpError(422, "Langue non autorisée pour cette société : de", "QG039", "errors:i18n.language_not_allowed", { language: "de" });
    expect(errorText(error)).toBe("Language not allowed for this company: de.");
    expect(publicError(error)).toMatchObject({ code: "QG039", key: "errors:i18n.language_not_allowed", params: { language: "de" } });
  });

  it("refus ancien (hint en texte libre), clé inconnue ou détails illisibles : message français d'origine", async () => {
    await i18n.changeLanguage("en");
    const legacy = { code: "QG026", message: "Refus d'origine", hint: "Solder les postes ouverts." };
    expect(errorText(legacy)).toBe("Refus d'origine");
    expect(errorText({ ...supabaseRefusal, hint: "errors:unknown.key" })).toBe(supabaseRefusal.message);
    expect(errorText({ ...supabaseRefusal, details: "{pas du json" })).toBe(supabaseRefusal.message);
    expect(errorText({ ...supabaseRefusal, details: JSON.stringify({ roles: [{ secret: 1 }] }) })).toBe(supabaseRefusal.message);
    expect(errorText(new Error("Erreur réseau"))).toBe("Erreur réseau");
  });

  it("seuls les paramètres déclarés au registre partagé sortent, bornés en taille", () => {
    expect(validateKeyed("errors:i18n.language_not_allowed", { language: "de", tenant: "x" })?.params).toEqual({ language: "de" });
    expect(validateKeyed("errors:i18n.language_not_allowed", { language: "x".repeat(201) })).toBeNull();
    expect(validateKeyed("i18n:posting.account_missing", {})).toBeNull();
    expect(validateKeyed("errors:QG001.account_missing", {})).toBeNull();
  });

  it("une clé n'est jamais affichée comme conseil (écrans RH)", () => {
    expect(isTranslationKey("errors:posting.account_missing")).toBe(true);
    expect(isTranslationKey("Associer un compte actif.")).toBe(false);
    expect(hrErrorMessage({ message: "Paramétrage comptable incomplet : Salaires", code: "QG001", hint: "errors:posting.account_missing" }))
      .toBe("Paramétrage comptable incomplet : Salaires (QG001)");
  });
});
