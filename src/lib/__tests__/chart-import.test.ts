import { describe, expect, it } from "vitest";
import { chartExportRows, detectMapping, mapRows, missingRequired } from "@/lib/chart-import";

describe("import guidé du plan comptable", () => {
  const profil = { code: ["Account No.", "Compte"], name: ["Description", "Intitulé"], type: ["Account Type"], normal_balance: ["Normal Balance"] };

  it("reconnaît les colonnes sans tenir compte des accents ni de la casse", () => {
    expect(detectMapping(["ACCOUNT NO.", "description", "Normal balance", "Autre"], profil))
      .toEqual({ code: "ACCOUNT NO.", name: "description", normal_balance: "Normal balance" });
    expect(detectMapping(["compte", "intitule"], profil)).toEqual({ code: "compte", name: "intitule" });
  });

  it("signale les champs obligatoires absents", () => {
    expect(missingRequired({ code: "Compte" })).toEqual(["Intitulé"]);
    expect(missingRequired({ code: "Compte", name: "Intitulé" })).toEqual([]);
  });

  it("lit les lignes et écarte les lignes vides", () => {
    const rows = mapRows([{ Compte: " 411 ", Intitulé: "Clients", X: "y" }, { Compte: "", Intitulé: " " }], { code: "Compte", name: "Intitulé" });
    expect(rows).toEqual([{ code: "411", name: "Clients" }]);
  });

  it("exporte au format réimportable, parents par code", () => {
    const out = chartExportRows([
      { id: "b", code: "411", name: "Clients", account_type: "asset", parent_id: "a", normal_balance: "debit" },
      { id: "a", code: "41", name: "Clients et comptes rattachés", account_type: "asset", parent_id: null, is_header: true },
    ]);
    expect(out.map((r) => `${r.code}|${r.parent}|${r.regroupement}|${r.type}|${r.sens}`)).toEqual(["41||oui|Actif|", "411|41|non|Actif|Débit"]);
  });
});
