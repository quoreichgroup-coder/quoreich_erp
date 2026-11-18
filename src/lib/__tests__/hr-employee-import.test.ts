import { describe, expect, it } from "vitest";
import {
  markDuplicateHrEmployeeIdentifiers,
  normalizeHrEmployeeRow,
  summarizeHrEmployeeRows,
} from "@/lib/hr-employee-import";

describe("employee CSV import", () => {
  it("normalizes French and English headers while leaving matricule optional", () => {
    const parsed = normalizeHrEmployeeRow({
      "Prénom": " Awa ", Nom: " Traoré ", Contrat: " CDI ", Courriel: "AWA@example.com",
      Poste: "Comptable", Département: "Finance", "Date d'embauche": "2026-02-03",
    }, 2);

    expect(parsed.errors).toEqual([]);
    expect(parsed.row).toMatchObject({
      matricule: "", first_name: "Awa", last_name: "Traoré", contract_type: "CDI",
      email: "awa@example.com", job_title: "Comptable", department: "Finance", hire_date: "2026-02-03",
    });
  });

  it("reports required fields, malformed email, and impossible calendar dates", () => {
    const parsed = normalizeHrEmployeeRow({
      first_name: "Awa", last_name: "Traoré", contract_type: "CDI", email: "wrong-address", hire_date: "2026-02-30",
    }, 7);

    expect(parsed.errors).toContain("Email invalide");
    expect(parsed.errors).toContain("Date d'embauche invalide");
    expect(parsed.row.matricule).toBe("");
  });

  it("marks duplicate supplied matricules and emails without rejecting blank matricules", () => {
    const rows = markDuplicateHrEmployeeIdentifiers([
      normalizeHrEmployeeRow({ matricule: "Q-01", first_name: "A", last_name: "One", contract_type: "CDI", email: "a@qerp.test" }, 2),
      normalizeHrEmployeeRow({ matricule: "q-01", first_name: "B", last_name: "Two", contract_type: "CDD", email: "A@qerp.test" }, 3),
      normalizeHrEmployeeRow({ first_name: "C", last_name: "Three", contract_type: "CDD" }, 4),
    ]);

    expect(rows[0].errors).toContain("Matricule présent plusieurs fois dans le fichier");
    expect(rows[0].errors).toContain("Courriel présent plusieurs fois dans le fichier");
    expect(rows[1].errors).toContain("Matricule présent plusieurs fois dans le fichier");
    expect(rows[2].errors).toEqual([]);
  });

  it("warns when a supplied matricule or email already belongs to an employee", () => {
    const row = normalizeHrEmployeeRow({
      matricule: "HR-1", first_name: "Awa", last_name: "One", contract_type: "CDI", email: "awa@example.test",
    }, 2);
    const [checked] = markDuplicateHrEmployeeIdentifiers([row], [
      { matricule: "hr-1", email: "AWA@example.test" },
    ]);

    expect(checked.errors).toContain("Matricule déjà utilisé dans cette société");
    expect(checked.errors).toContain("Courriel déjà utilisé dans cette société");
  });

  it("summarizes valid and invalid rows before import", () => {
    const summary = summarizeHrEmployeeRows([
      normalizeHrEmployeeRow({ first_name: "Awa", last_name: "One", contract_type: "CDI" }, 2),
      normalizeHrEmployeeRow({ first_name: "", last_name: "Two", contract_type: "CDI" }, 3),
    ]);

    expect(summary).toMatchObject({ total: 2, validCount: 1, invalidCount: 1, canImport: true });
  });
});
