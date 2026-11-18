import { describe, expect, it } from "vitest";
import Papa from "papaparse";
import { buildCSV, csvValue } from "@/lib/csv-export";
import { buildXlsx, columnIndex, columnLetter, readXlsx } from "@/lib/xlsx";

const cols = [{ key: "code" as const, header: "Code" }, { key: "intitule" as const, header: "Intitulé" }, { key: "cle" as const, header: "Clé (%)" }];
const rows = [{ code: "411", intitule: "Clients ; divers", cle: 33.5 }, { code: "512", intitule: "Banque \"BOA\"", cle: 100 }];

describe("CSV lisible par Excel en français", () => {
  it("sépare par « ; », virgule décimale, BOM, fins de ligne Windows", () => {
    const csv = buildCSV(rows, cols);
    expect(csv.startsWith("\uFEFFCode;Intitulé;Clé (%)\r\n")).toBe(true);
    expect(csv).toContain('411;"Clients ; divers";33,5\r\n');
    expect(csv).toContain('512;"Banque ""BOA""";100\r\n');
    expect(csvValue(" a")).toBe('" a"');
  });

  it("se relit colonne par colonne (détection du séparateur)", () => {
    const res = Papa.parse<Record<string, string>>(buildCSV(rows, cols).replace(/^\uFEFF/, ""), { header: true, skipEmptyLines: true });
    expect(res.meta.fields).toEqual(["Code", "Intitulé", "Clé (%)"]);
    expect(res.data[0]).toEqual({ Code: "411", Intitulé: "Clients ; divers", "Clé (%)": "33,5" });
  });
});

describe("classeur Excel", () => {
  it("lettres de colonnes", () => {
    expect([0, 25, 26, 701].map(columnLetter)).toEqual(["A", "Z", "AA", "ZZ"]);
    expect(["A1", "Z9", "AA10", "ZZ3"].map(columnIndex)).toEqual([0, 25, 26, 701]);
  });

  it("écrit un vrai .xlsx (zip, en-tête figé et filtrable) et le relit à l'identique", async () => {
    const bytes = buildXlsx(rows, cols, "Plan comptable");
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK");
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('state="frozen"');
    expect(text).toContain('<autoFilter ref="A1:C3"/>');
    expect(text).toContain('<numFmt numFmtId="164" formatCode="#,##0.##"/>');
    expect(text).toContain('<c r="C2" s="2"><v>33.5</v></c>');
    expect(text).toContain("<v>33.5</v>");
    const back = await readXlsx(bytes.slice().buffer);
    expect(back.headers).toEqual(["Code", "Intitulé", "Clé (%)"]);
    expect(back.records).toEqual([
      { Code: "411", Intitulé: "Clients ; divers", "Clé (%)": "33.5" },
      { Code: "512", Intitulé: 'Banque "BOA"', "Clé (%)": "100" },
    ]);
  });
});

describe("classeur enregistré par Excel (entrées compressées)", () => {
  it("relit un .xlsx dont les entrées sont « deflate »", async () => {
    const { deflateRawSync, crc32 } = await import("node:zlib");
    const { unzip } = await import("@/lib/xlsx");
    const stored = await unzip(buildXlsx(rows, cols).slice().buffer);
    const parts: Uint8Array[] = []; const central: Uint8Array[] = []; let offset = 0;
    for (const [name, data] of stored) {
      const n = new TextEncoder().encode(name); const z = deflateRawSync(data); const crc = crc32(data);
      const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt16LE(8, 8);
      l.writeUInt32LE(crc, 14); l.writeUInt32LE(z.length, 18); l.writeUInt32LE(data.length, 22); l.writeUInt16LE(n.length, 26);
      parts.push(l, n, z);
      const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10);
      c.writeUInt32LE(crc, 16); c.writeUInt32LE(z.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
      central.push(c, n); offset += 30 + n.length + z.length;
    }
    const size = central.reduce((s, p) => s + p.length, 0);
    const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(stored.size, 8); e.writeUInt16LE(stored.size, 10); e.writeUInt32LE(size, 12); e.writeUInt32LE(offset, 16);
    const file = Buffer.concat([...parts, ...central, e]);
    const back = await readXlsx(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
    expect(back.records[1]).toEqual({ Code: "512", Intitulé: 'Banque "BOA"', "Clé (%)": "100" });
  });
});
