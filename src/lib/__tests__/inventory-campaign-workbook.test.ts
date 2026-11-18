import { describe, expect, it, vi } from "vitest";
import { buildXlsx } from "@/lib/xlsx";
import { countSheetColumns, countSheetRows, parseCampaignCountWorkbook, readCampaignCatalogAll } from "@/lib/inventory-campaign-workbook";
import { parseInventoryCount, type CampaignCatalogRow } from "@/lib/inventory-campaign";

const items = [
  { item_id: "a", code: "AB", name: "Article A", unit: "pièce" },
  { item_id: "b", code: "AC", name: "Article B", unit: "pièce" },
];
const workbook = (rows: ReturnType<typeof countSheetRows>) => buildXlsx(rows, countSheetColumns).slice().buffer;

describe("workbook des campagnes d’inventaire", () => {
  it("garde le zéro saisi et ignore une cellule vide, sans exposer le théorique", async () => {
    const rows = countSheetRows("campagne", "INV-001", "first", items);
    expect(countSheetColumns.map((column) => column.header).join(" ")).not.toMatch(/théorique|stock figé|coût/i);
    rows[0].quantity = 0;
    expect(await parseCampaignCountWorkbook(workbook(rows), "campagne", "first", items)).toEqual([{ item_id: "a", quantity: 0 }]);
  });

  it("refuse la mauvaise étape et les articles en double avant d’enregistrer", async () => {
    const rows = countSheetRows("campagne", null, "recount", items);
    rows[0].quantity = 3;
    await expect(parseCampaignCountWorkbook(workbook(rows), "campagne", "first", items)).rejects.toThrow(/étape/i);
    await expect(parseCampaignCountWorkbook(workbook([rows[0], rows[0]]), "campagne", "recount", items)).rejects.toThrow(/double/i);
  });

  it("ne transforme pas une quantité qu’Excel ne peut pas représenter exactement", () => {
    expect(parseInventoryCount("0007,50")).toBe(7.5);
    expect(parseInventoryCount("100000000000000,01")).toBeNull();
  });

  it("refuse une quantité collée à côté d’un code différent", async () => {
    const rows = countSheetRows("campagne", null, "first", items);
    rows[0].code = items[1].code;
    rows[0].quantity = 4;
    await expect(parseCampaignCountWorkbook(workbook(rows), "campagne", "first", items)).rejects.toThrow(/code ou l’unité/i);
  });

  it("réimporte un classeur de plus de mille articles sans conserver une seule page", async () => {
    const all = Array.from({ length: 1205 }, (_, index) => ({
      item_id: `item-${index}`, code: `CODE-${index}`, name: `Article ${index}`, unit: "pièce",
    }));
    const rows = countSheetRows("campagne", null, "first", all).map((row) => ({ ...row, quantity: 0 }));
    const entries = await parseCampaignCountWorkbook(workbook(rows), "campagne", "first", all);
    expect(entries).toHaveLength(1205);
    expect(entries.at(-1)).toEqual({ item_id: "item-1204", quantity: 0 });
  });

  it("épuise toutes les pages du catalogue avec exactement les filtres affichés", async () => {
    const filters = { warehouse: "depot", state: "validated" as const, search: "INV-" };
    const row = { id: "premier" } as CampaignCatalogRow;
    const cursor = { id: "premier", opened_at: "2026-11-15T00:00:00Z" };
    const fetch = vi.fn().mockResolvedValueOnce({ campaigns: [row], next: cursor })
      .mockResolvedValueOnce({ campaigns: [{ ...row, id: "second" }], next: null });
    expect((await readCampaignCatalogAll(filters, fetch)).map((item) => item.id)).toEqual(["premier", "second"]);
    expect(fetch.mock.calls).toEqual([[filters, null, true], [filters, cursor, true]]);
  });
});
