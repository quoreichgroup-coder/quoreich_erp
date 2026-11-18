import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * exportToPDF est appelé sans await par la plupart des écrans. Un échec de génération y devenait
 * un rejet non géré : aucun message pour l'utilisateur. Il est désormais signalé par un toast et
 * la promesse se résout à false ; `throwOnError` rend l'échec à l'appelant qui le gère lui-même.
 */
const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  autoTable: vi.fn(),
  error: vi.fn(),
  setPage: vi.fn(),
  text: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: mocks.error, success: vi.fn() } }));
vi.mock("jspdf", () => ({
  default: vi.fn().mockImplementation(function FakePdf() {
    return {
      setFontSize: vi.fn(),
      setTextColor: vi.fn(),
      text: mocks.text,
      setPage: mocks.setPage,
      getNumberOfPages: () => 2,
      internal: { pageSize: { getWidth: () => 842, getHeight: () => 595 } },
      save: mocks.save,
    };
  }),
}));
vi.mock("jspdf-autotable", () => ({ default: mocks.autoTable }));

import { exportToPDF } from "../pdf-export";

const opts = {
  filename: "rapport",
  title: "Rapport",
  columns: [{ key: "a", header: "A" }],
  rows: [{ a: 1 }],
};

beforeEach(() => {
  mocks.save.mockReset();
  mocks.autoTable.mockReset();
  mocks.error.mockReset();
  mocks.setPage.mockReset();
  mocks.text.mockReset();
});

describe("exportToPDF", () => {
  it("enregistre le fichier et renvoie true", async () => {
    await expect(exportToPDF(opts)).resolves.toBe(true);
    expect(mocks.save).toHaveBeenCalledWith("rapport.pdf");
    expect(mocks.autoTable).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ showHead: "everyPage", rowPageBreak: "avoid" }));
    expect(mocks.setPage.mock.calls).toEqual([[1], [2]]);
    expect(mocks.text).toHaveBeenCalledWith("1 / 2", 810, 579, { align: "right" });
    expect(mocks.text).toHaveBeenCalledWith("2 / 2", 810, 579, { align: "right" });
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("formate les valeurs numériques avec les séparateurs français, en espaces imprimables par la police du PDF", async () => {
    await exportToPDF({ ...opts, rows: [{ a: 1234.5 }] });
    const tableOptions = mocks.autoTable.mock.calls[0][1];
    expect(tableOptions.body).toEqual([["1 234,5"]]); // l'espace fine insécable du format fr-FR s'imprimait « / »
  });

  it("échec : un toast d'erreur, la promesse se résout à false (pas de rejet non géré)", async () => {
    mocks.save.mockImplementation(() => { throw new Error("synthetic Blob failure"); });
    await expect(exportToPDF(opts)).resolves.toBe(false);
    expect(mocks.error).toHaveBeenCalledWith("Impossible de générer le PDF", { description: "synthetic Blob failure" });
  });

  it("throwOnError : l'échec revient à l'appelant, sans toast générique", async () => {
    mocks.autoTable.mockImplementation(() => { throw new Error("table boom"); });
    await expect(exportToPDF(opts, { throwOnError: true })).rejects.toThrow("table boom");
    expect(mocks.error).not.toHaveBeenCalled();
  });
});
