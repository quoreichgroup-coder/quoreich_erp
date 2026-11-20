import { describe, expect, it } from "vitest";
import { groupAnnexLines, type AnnexNoteLine } from "@/hooks/use-annex-notes";

const line = (group_code: string, group_order: number, account_code: string, opening: number, increase: number, decrease: number): AnnexNoteLine => ({
  group_code, group_label: `Rubrique ${group_code}`, group_order, account_code, account_name: `Compte ${account_code}`,
  opening, increase, decrease, closing: opening + increase - decrease,
});

describe("groupAnnexLines", () => {
  it("additionne les comptes par rubrique, dans l'ordre du référentiel, et totalise la note", () => {
    const { groups, total } = groupAnnexLines([
      line("24", 40, "2441", 100, 50, 20),
      line("21", 10, "2131", 0, 30, 0),
      line("24", 40, "2442", 10, 0, 5),
    ]);
    expect(groups.map((g) => g.code)).toEqual(["21", "24"]);
    expect(groups[1]).toMatchObject({ opening: 110, increase: 50, decrease: 25, closing: 135 });
    expect(groups[1].accounts.map((a) => a.account_code)).toEqual(["2441", "2442"]);
    expect(total).toEqual({ opening: 110, increase: 80, decrease: 25, closing: 165 });
  });

  it("rend une note vide sans rubrique ni total", () => {
    expect(groupAnnexLines([])).toEqual({ groups: [], total: { opening: 0, increase: 0, decrease: 0, closing: 0 } });
  });
});
