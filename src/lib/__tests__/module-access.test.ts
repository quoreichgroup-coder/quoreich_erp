import { describe, expect, it } from "vitest";
import { canAccessPage } from "../module-access";
import { NAV_SECTIONS } from "../navigation";

describe("politique d'accès aux modules", () => {
  it("les rôles sur mesure utilisent leurs permissions, avec des frontières de nom exactes", () => {
    const custom = { roles: [], permissions: ["inventory.export"] };
    expect(canAccessPage("/inventory/transactions", custom)).toBe(true);
    expect(canAccessPage("/hr/employees", custom)).toBe(false);
    expect(canAccessPage("/inventory-other", custom)).toBe(false);
    expect(canAccessPage("/inventory", { roles: [], permissions: ["inventory_other.export"] })).toBe(false);
    expect(canAccessPage("/inventory", undefined)).toBe(false);
    expect(canAccessPage("/customers", { roles: [], permissions: ["customers.manage"] })).toBe(true);
    expect(canAccessPage("/receivables", { roles: [], permissions: ["customers.manage"] })).toBe(false);
  });

  it("un rôle sans permission n'ouvre aucun module métier", () => {
    for (const section of NAV_SECTIONS) {
      for (const module of section.modules ?? []) {
        expect(canAccessPage(module.basePath, { roles: ["viewer"], permissions: [] })).toBe(false);
      }
    }
    expect(canAccessPage("/docs", { roles: [], permissions: [] })).toBe(true);
  });

  it("tous les liens administrateur existants ont une politique, y compris les onglets Transactions", () => {
    const admin = { roles: ["admin"], permissions: [] };
    const urls = NAV_SECTIONS.flatMap((s) => [
      ...(s.links ?? []).map((l) => l.url),
      ...(s.modules ?? []).flatMap((m) => m.items.flatMap((i) => [i.url, ...(i.also ?? [])])),
    ]);
    expect(urls.filter((url) => !canAccessPage(url, admin))).toEqual([]);
  });

  it("le comptable peut configurer sa comptabilité sans ouvrir l'administration des comptes", () => {
    const accountant = { roles: ["accountant"], permissions: ["accounting.chart", "ar.settings"] };
    expect(canAccessPage("/settings", accountant)).toBe(true);
    expect(canAccessPage("/settings?tab=tax", accountant)).toBe(true);
    expect(canAccessPage("/settings?tab=payment", accountant)).toBe(true);
    expect(canAccessPage("/settings?tab=roles", accountant)).toBe(false);
    expect(canAccessPage("/settings?tab=inconnu", accountant)).toBe(false);
    expect(canAccessPage("/settings", { roles: [], permissions: ["reports.templates"] })).toBe(true);
    expect(canAccessPage("/settings?tab=fiscal", { roles: [], permissions: ["reports.templates"] })).toBe(false);
    expect(canAccessPage("/cockpit", accountant)).toBe(false);
  });
});
