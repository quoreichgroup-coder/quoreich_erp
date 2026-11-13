import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { NAV_SECTIONS, isLinkActive, visibleModules } from "../navigation";

/*
 * La navigation est rangée par processus métier ; ces tests vérifient qu'aucune page n'y mène
 * vers une route inexistante, et qu'aucune entrée de l'ancienne barre latérale ne s'est perdue.
 */
const appSource = readFileSync(resolve(import.meta.dirname, "../../App.tsx"), "utf8");
const routes = new Set([...appSource.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]));
const allUrls = NAV_SECTIONS.flatMap((s) => [
  ...(s.links ?? []).map((l) => l.url),
  ...(s.modules ?? []).flatMap((m) => m.items.map((i) => i.url)),
]);

describe("navigation principale", () => {
  it("sections dans l'ordre des processus, administration en dernier", () => {
    expect(NAV_SECTIONS.map((s) => s.label)).toEqual([
      "Pilotage", "Ventes et clients", "Achats et fournisseurs", "Stocks", "Comptabilité et finance",
      "Ressources humaines", "Gouvernance", "Administration",
    ]);
  });

  it("chaque lien mène à une route déclarée dans App.tsx", () => {
    const missing = allUrls.map((u) => u.split("?")[0]).filter((path) => !routes.has(path));
    expect(missing).toEqual([]);
  });

  it("aucune page de l'ancienne barre latérale n'a disparu", () => {
    const anciennes = [
      "/", "/cockpit", "/receivables/aging", "/customers", "/payables/payment-planning", "/suppliers",
      "/journal/settings", "/assets", "/treasury/control", "/budget", "/projects", "/procurement", "/inventory",
      "/sales", "/expenses", "/compliance", "/risk", "/hr/payroll", "/hr/employees", "/audit/hr", "/crm/reminders",
      "/reports", "/admin/modules", "/admin/import", "/audit/projects", "/settings?tab=audit", "/settings",
      "/settings?tab=roles", "/docs",
    ];
    expect(anciennes.filter((u) => !allUrls.includes(u))).toEqual([]);
  });

  it("aucun lien en double", () => {
    expect(allUrls.length).toBe(new Set(allUrls).size);
  });

  it("modules visibles : tous sans configuration ; sinon les modules activés, plus ceux sans clé", () => {
    const finance = NAV_SECTIONS.find((s) => s.id === "finance")!.modules;
    expect(visibleModules(finance, undefined)).toHaveLength(5);
    expect(visibleModules(finance, ["Treasury"]).map((m) => m.title)).toEqual(["Trésorerie"]);
    const rh = NAV_SECTIONS.find((s) => s.id === "rh")!.modules;
    expect(visibleModules(rh, ["Treasury"])).toHaveLength(1);
  });

  it("lien actif : un onglet de /settings n'allume que son lien", () => {
    expect(isLinkActive("/settings?tab=fiscal", "/settings", "?tab=fiscal")).toBe(true);
    expect(isLinkActive("/settings", "/settings", "?tab=fiscal")).toBe(false);
    expect(isLinkActive("/settings", "/settings", "?tab=tax")).toBe(true);
    expect(isLinkActive("/settings", "/settings", "")).toBe(true);
    expect(isLinkActive("/settings?tab=roles", "/settings", "")).toBe(false);
    expect(isLinkActive("/alerts", "/alerts", "")).toBe(true);
  });
});
