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
}));
vi.mock("sonner", () => ({ toast: { error: mocks.error, success: vi.fn() } }));
vi.mock("jspdf", () => ({
  default: vi.fn().mockImplementation(function FakePdf() {
    return { setFontSize: vi.fn(), setTextColor: vi.fn(), text: vi.fn(), save: mocks.save };
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
});

describe("exportToPDF", () => {
  it("enregistre le fichier et renvoie true", async () => {
    await expect(exportToPDF(opts)).resolves.toBe(true);
    expect(mocks.save).toHaveBeenCalledWith("rapport.pdf");
    expect(mocks.error).not.toHaveBeenCalled();
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
