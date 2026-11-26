import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { i18n, switchLanguage } from "@/i18n";
import { LanguageProvider } from "@/i18n/LanguageProvider";
import { languageKey } from "@/hooks/use-language";
import { getFormatLocale, getTimeZone, setFormatPreferences } from "@/lib/locale-format";

const state = vi.hoisted(() => ({ user: null as null | { id: string }, context: undefined as unknown }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock("@/hooks/use-language", async (original) => ({
  ...(await original<typeof import("@/hooks/use-language")>()),
  useLanguageContext: () => ({ data: state.context }),
}));

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

afterEach(async () => {
  vi.restoreAllMocks();
  state.user = null; state.context = undefined; localStorage.clear();
  await act(async () => { await switchLanguage("fr"); });
  setFormatPreferences("fr-FR");
});

describe("préférences par session et par société (AC03, AC07)", () => {
  it("applique la langue, la locale et le fuseau résolus par le serveur, et les garde pour cet utilisateur seulement", async () => {
    state.user = { id: "user-a" };
    state.context = { language: "en", locale: "en-US", timezone: "Africa/Abidjan" };
    render(<LanguageProvider><p>x</p></LanguageProvider>);
    await flush();
    expect(i18n.language).toBe("en");
    expect(getFormatLocale()).toBe("en-US");
    expect(getTimeZone()).toBe("Africa/Abidjan");
    expect(localStorage.getItem("qerp-language:user-a")).toBe("en");
    expect(localStorage.getItem("qerp-language:user-b")).toBeNull();
  });

  it("déconnexion : retour à la langue du navigateur et aux formats historiques, sans reprendre la langue du compte précédent", async () => {
    localStorage.setItem("qerp-language:user-a", "en");
    state.user = { id: "user-a" };
    state.context = { language: "en", locale: "en-GB", timezone: null };
    const view = render(<LanguageProvider><p>x</p></LanguageProvider>);
    await flush();
    expect(i18n.language).toBe("en");
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["fr-BF", "en"]);
    state.user = null; state.context = undefined;
    view.rerender(<LanguageProvider><p>x</p></LanguageProvider>);
    await flush();
    expect(i18n.language).toBe("fr"); // langue du navigateur (fr-BF), pas celle du compte précédent
    expect(getFormatLocale()).toBe("fr-FR");
  });

  it("un autre utilisateur ne relit pas le cache du précédent", async () => {
    localStorage.setItem("qerp-language:user-a", "en");
    state.user = { id: "user-b" };
    render(<LanguageProvider><p>x</p></LanguageProvider>);
    await flush();
    expect(i18n.language).toBe("fr");
  });

  it("la clé de cache des préférences porte l'utilisateur et la société", () => {
    expect(languageKey("user-a", "tenant-1")).not.toEqual(languageKey("user-a", "tenant-2"));
    expect(languageKey("user-a", "tenant-1")).not.toEqual(languageKey("user-b", "tenant-1"));
  });
});

describe("réponse inattendue du serveur (régression trouvée par la suite Playwright)", () => {
  it("un contexte nul, vide ou incomplet devient une erreur de requête, jamais un plantage", async () => {
    const { normalizeLanguageContext } = await vi.importActual<typeof import("@/hooks/use-language")>("@/hooks/use-language");
    expect(() => normalizeLanguageContext(null)).toThrow();
    expect(() => normalizeLanguageContext({})).toThrow();
    const partial = normalizeLanguageContext({ language: "en" });
    expect(partial.allowed_languages).toEqual([]);
    expect(partial.languages).toEqual([]);
  });
});
