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

describe("modèle de correspondance", () => {
  it("un compte par ligne, colonnes séparées, comptes non couverts laissés à compléter", async () => {
    const { mappingTemplateRows, MAPPING_TEMPLATE_COLUMNS } = await import("@/lib/chart-import");
    const t = mappingTemplateRows([
      { source_code: "521", source_name: "Banques", source_type: "asset", target_code: "512", target_name: "Banques", ratio: 100, status: "validated" },
      { source_code: "701", source_name: "Ventes", source_type: "revenue", target_code: null, target_name: null, ratio: null, status: null },
    ]);
    expect(MAPPING_TEMPLATE_COLUMNS.map((c) => c.header)).toEqual(["Compte source", "Intitulé source", "Type source", "Compte cible", "Intitulé cible", "Clé (%)", "État", "Commentaire"]);
    expect(t[0]).toMatchObject({ source: "521", sourceType: "Actif", target: "512", ratio: 100, status: "Validée" });
    expect(t[1]).toMatchObject({ source: "701", target: "", ratio: "" });
  });

  it("relit le modèle rempli (en-têtes reconnus, numéro de ligne du fichier)", async () => {
    const { mappingImportRows } = await import("@/lib/chart-import");
    const r = mappingImportRows([{ "Compte source": "521", "Compte cible": "512", "Clé (%)": "60" }, { "Compte source": "", "Compte cible": "" },
      { "Compte source": "521", "Compte cible": "530", "Clé (%)": "40" }], ["Compte source", "Intitulé source", "Compte cible", "Clé (%)"]);
    expect(r.missing).toEqual([]);
    expect(r.rows).toEqual([{ line: 2, source: "521", target: "512", ratio: "60", comment: "" }, { line: 4, source: "521", target: "530", ratio: "40", comment: "" }]);
    expect(mappingImportRows([], ["Code"]).missing).toEqual(["Compte source", "Compte cible"]);
  });
});
