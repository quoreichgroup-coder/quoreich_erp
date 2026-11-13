import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "jeton" } } }) } },
}));
vi.stubEnv("VITE_QERP_API_URL", "http://api.test");

import { apiGet } from "../client";

const respond = (status: number, body?: unknown) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  );

afterEach(() => vi.restoreAllMocks());

describe("client API — messages d'erreur", () => {
  it("affiche tel quel un refus rédigé par l'API", async () => {
    respond(422, { error: "Code TVA inconnu ou inactif dans la société (ligne 1)" });
    await expect(apiGet("/x")).rejects.toMatchObject({ status: 422, message: "Code TVA inconnu ou inactif dans la société (ligne 1)" });
  });

  it("route absente (404 au format Spring) : explique que l'API est d'une autre version, sans afficher « Not Found »", async () => {
    respond(404, { timestamp: "2026-11-13T08:00:00Z", status: 404, error: "Not Found", path: "/api/v1/accounting/tax-codes" });
    await expect(apiGet("/api/v1/accounting/tax-codes")).rejects.toMatchObject({
      message: "Service introuvable sur le serveur : l'API est plus ancienne que l'application, redémarrez-la",
    });
  });

  it("élément introuvable (404 sans corps) : message neutre", async () => {
    respond(404);
    await expect(apiGet("/x")).rejects.toMatchObject({ message: "Élément introuvable, ou non visible dans la société courante" });
  });

  it("erreur serveur au format Spring : pas de libellé anglais brut", async () => {
    respond(500, { status: 500, error: "Internal Server Error", path: "/x" });
    await expect(apiGet("/x")).rejects.toMatchObject({ message: "Le serveur a rencontré une erreur : réessayez, ou contactez l'administrateur" });
  });
});
