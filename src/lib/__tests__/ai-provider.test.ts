import { describe, expect, it, vi } from "vitest";
import { aiErrorMessage, chatCompletion, readAiConfig, toolArguments } from "../../../supabase/functions/_shared/ai-provider";

/*
 * Fournisseur d'IA indépendant (fonctions Edge) : la même configuration sert au nuage (Gemini,
 * OpenRouter) et au sur-site (LiteLLM devant Ollama). Aucun appel réseau : fetch est simulé.
 */
const env = (vars: Record<string, string>) => (name: string) => vars[name];
const reply = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const config = { baseUrl: "https://ia.example/v1", apiKey: "k", models: ["modele-a", "modele-b"] };

describe("configuration du fournisseur d'IA", () => {
  it("lit l'adresse, la clé et la liste de modèles (repli dans l'ordre)", () => {
    expect(readAiConfig(env({ AI_BASE_URL: "https://ia.example/v1/", AI_API_KEY: "k", AI_MODEL: "a, b ,," })))
      .toEqual({ baseUrl: "https://ia.example/v1", apiKey: "k", models: ["a", "b"] });
  });

  it("une clé sans adresse ni modèle est une configuration incomplète, pas un appel à l'aveugle", () => {
    expect(readAiConfig(env({ AI_API_KEY: "k" }))).toHaveProperty("error");
  });

  it("sans clé : passerelle Lovable si sa clé existe (compatibilité), sinon IA non configurée", () => {
    expect(readAiConfig(env({ LOVABLE_API_KEY: "l" }))).toMatchObject({ apiKey: "l", models: ["google/gemini-2.5-flash"] });
    expect(readAiConfig(env({}))).toEqual({ error: expect.stringContaining("non configurée") });
  });
});

describe("appel du modèle", () => {
  it("ajoute le modèle au corps et rend la réponse du premier modèle disponible", async () => {
    const fetchMock = vi.fn(async () => reply(200, { choices: [] }));
    const r = await chatCompletion(config, { messages: [] }, fetchMock as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, json: { choices: [] }, model: "modele-a" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://ia.example/v1/chat/completions");
    expect(JSON.parse(init.body as string)).toEqual({ messages: [], model: "modele-a" });
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
  });

  it("modèle saturé (503), limité (429) ou retiré (404) : essaie le suivant", async () => {
    for (const status of [503, 429, 404]) {
      const fetchMock = vi.fn().mockResolvedValueOnce(reply(status)).mockResolvedValueOnce(reply(200, { ok: 1 }));
      const r = await chatCompletion(config, {}, fetchMock as unknown as typeof fetch);
      expect(r).toMatchObject({ ok: true, model: "modele-b" });
    }
  });

  it("clé refusée (401) : on s'arrête, inutile d'essayer les autres modèles", async () => {
    const fetchMock = vi.fn(async () => reply(401));
    const r = await chatCompletion(config, {}, fetchMock as unknown as typeof fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ ok: false, status: 401, message: expect.stringContaining("Clé du fournisseur IA refusée") });
  });

  it("tous saturés, ou réseau coupé : refus lisible, jamais d'exception", async () => {
    const saturated = vi.fn(async () => reply(503));
    expect(await chatCompletion(config, {}, saturated as unknown as typeof fetch)).toMatchObject({ ok: false, status: 503 });
    const offline = vi.fn(async () => { throw new TypeError("fetch failed"); });
    expect(await chatCompletion(config, {}, offline as unknown as typeof fetch)).toMatchObject({ ok: false, status: 503 });
    expect(aiErrorMessage(429)).toContain("Limite du fournisseur IA atteinte");
  });

  it("lit les arguments de l'appel d'outil, chaîne JSON ou objet ; absent ou illisible → null", () => {
    const call = (args: unknown) => ({ choices: [{ message: { tool_calls: [{ function: { arguments: args } }] } }] });
    expect(toolArguments(call('{"a":1}'))).toEqual({ a: 1 });
    expect(toolArguments(call({ a: 2 }))).toEqual({ a: 2 });
    expect(toolArguments(call("pas du json"))).toBeNull();
    expect(toolArguments({ choices: [] })).toBeNull();
  });
});
