import { describe, expect, it } from "vitest";
import { montantEnLettres } from "@/lib/document-pdf";

describe("montant arrêté en lettres", () => {
  it.each([
    [0, "zéro"],
    [1, "un"],
    [21, "vingt-et-un"],
    [71, "soixante-et-onze"],
    [80, "quatre-vingts"],
    [81, "quatre-vingt-un"],
    [99, "quatre-vingt-dix-neuf"],
    [100, "cent"],
    [200, "deux cents"],
    [250, "deux cent cinquante"],
    [1000, "mille"],
    [200000, "deux cent mille"],
    [168000, "cent soixante-huit mille"],
    [1250300, "un million deux cent cinquante mille trois cents"],
    [2000000, "deux millions"],
  ])("%d → %s", (n, attendu) => {
    expect(montantEnLettres(n)).toBe(attendu);
  });
});
