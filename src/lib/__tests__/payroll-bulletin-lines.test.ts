import { describe, expect, it } from "vitest";
import { bulletinLines } from "../payroll-bulletin-lines";

describe("ordre conservé du bulletin", () => {
  const line = (code: string, order?: number, printable = true) => ({
    code, source_type: code === "BASE" ? "base_salary" : "employee_assignment",
    definition_snapshot: { printable, sort_order: order ?? (code === "BASE" ? 0 : undefined) },
  });
  it("place la base puis les rubriques selon leur ordre au calcul", () => {
    const input = [line("PRIME", 20), line("BASE"), line("INDEMNITE", -5), line("INTERNE", 0, false)];
    expect(bulletinLines(input).map(x => x.code)).toEqual(["BASE", "INDEMNITE", "PRIME"]);
    expect(input.map(x => x.code)).toEqual(["PRIME", "BASE", "INDEMNITE", "INTERNE"]);
  });
  it("conserve l'ordre reçu pour un ancien cycle sans ordre photographié", () => {
    const input = [line("PRIME"), line("BASE"), line("INDEMNITE")];
    expect(bulletinLines(input).map(x => x.code)).toEqual(["PRIME", "BASE", "INDEMNITE"]);
  });
  it("garde un ordre stable entre rubriques ayant le même rang", () => {
    expect(bulletinLines([line("B", 1), line("A", 1)]).map(x => x.code)).toEqual(["B", "A"]);
  });
});
