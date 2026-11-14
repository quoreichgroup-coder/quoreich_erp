/*
 * Classeurs Excel (.xlsx) sans dépendance : écriture (une feuille, en-tête en gras, figé et filtrable,
 * largeurs de colonnes, nombres en nombres) et lecture de la première feuille (chaînes partagées ou
 * en ligne, nombres, booléens). Le format est un zip d'XML (Office Open XML) : écrit sans compression,
 * relu avec ou sans (DecompressionStream « deflate-raw » du navigateur).
 */
export type XlsxColumn<T> = { key: keyof T; header: string; width?: number };

const enc = new TextEncoder();
const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
  // Caractères de contrôle interdits en XML 1.0.
  // eslint-disable-next-line no-control-regex -- on les retire précisément
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

export function columnLetter(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
export function columnIndex(ref: string): number {
  const letters = ref.replace(/[0-9]/g, "").toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// ─── Zip (méthode « stored ») ───
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
    local.setUint32(14, crc, true); local.setUint32(18, f.data.length, true); local.setUint32(22, f.data.length, true); local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, f.data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true);
    cd.setUint32(16, crc, true); cd.setUint32(20, f.data.length, true); cd.setUint32(24, f.data.length, true); cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

// ─── Écriture ───
export function buildXlsx<T extends Record<string, unknown>>(rows: T[], columns: XlsxColumn<T>[], sheetName = "Données"): Uint8Array {
  const cell = (ref: string, v: unknown, style = 0) => {
    const s = style ? ` s="${style}"` : "";
    if (v === null || v === undefined || v === "") return "";
    if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`;
    if (typeof v === "boolean") return `<c r="${ref}"${s} t="b"><v>${v ? 1 : 0}</v></c>`;
    return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(String(v))}</t></is></c>`;
  };
  const widths = columns.map((c) => c.width ?? Math.min(60, Math.max(10, c.header.length + 2,
    ...rows.slice(0, 500).map((r) => String(r[c.key] ?? "").length + 2))));
  const last = columnLetter(columns.length - 1);
  const header = `<row r="1">${columns.map((c, i) => cell(`${columnLetter(i)}1`, c.header, 1)).join("")}</row>`;
  const body = rows.map((r, n) => `<row r="${n + 2}">${columns.map((c, i) => cell(`${columnLetter(i)}${n + 2}`, r[c.key])).join("")}</row>`).join("");
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>
<sheetData>${header}${body}</sheetData>
<autoFilter ref="A1:${last}${rows.length + 1}"/>
</worksheet>`;
  const name = xmlEscape(sheetName.replace(/[\\/?*[\]:]/g, " ").slice(0, 31));
  const files = [
    { name: "[Content_Types].xml", xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: "_rels/.rels", xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${name.replace(/'/g, "''")}'!$A$1:$${last}$${rows.length + 1}</definedName></definedNames></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0062DB"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>` },
    { name: "xl/worksheets/sheet1.xml", xml: sheet },
  ];
  return zip(files.map((f) => ({ name: f.name, data: enc.encode(f.xml) })));
}

export function exportToXLSX<T extends Record<string, unknown>>(rows: T[], columns: XlsxColumn<T>[], filename: string, sheetName?: string) {
  const bytes = buildXlsx(rows, columns, sheetName);
  const blob = new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Lecture ───
async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(data); c.close(); } }).pipeThrough(ds as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function unzip(buf: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const v = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("Fichier Excel illisible (archive invalide)");
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    const method = v.getUint16(p + 10, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extra = v.getUint16(p + 30, true), comment = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + size);
    if (method === 0) out.set(name, raw);
    else if (method === 8) out.set(name, await inflateRaw(raw));
    p += 46 + nameLen + extra + comment;
  }
  return out;
}

/** Première feuille : en-têtes (ligne 1) et lignes sous forme d'objets indexés par en-tête. */
export async function readXlsx(buf: ArrayBuffer): Promise<{ headers: string[]; records: Record<string, string>[] }> {
  const files = await unzip(buf);
  const dec = new TextDecoder();
  const parse = (name: string) => { const f = files.get(name); return f ? new DOMParser().parseFromString(dec.decode(f), "application/xml") : null; };
  const textOf = (el: Element) => Array.from(el.getElementsByTagName("t")).map((t) => t.textContent ?? "").join("");
  const shared = Array.from(parse("xl/sharedStrings.xml")?.getElementsByTagName("si") ?? []).map(textOf);
  // Première feuille du classeur (ordre du classeur, via ses relations).
  let sheetPath = "xl/worksheets/sheet1.xml";
  const wb = parse("xl/workbook.xml"), rels = parse("xl/_rels/workbook.xml.rels");
  const first = wb?.getElementsByTagName("sheet")[0];
  const rid = first?.getAttribute("r:id") ?? first?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
  const target = rid ? Array.from(rels?.getElementsByTagName("Relationship") ?? []).find((r) => r.getAttribute("Id") === rid)?.getAttribute("Target") : null;
  if (target) sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  const sheet = parse(sheetPath);
  if (!sheet) throw new Error("Fichier Excel sans feuille lisible");
  const grid: string[][] = [];
  for (const row of Array.from(sheet.getElementsByTagName("row"))) {
    const r = Number(row.getAttribute("r")) - 1;
    const cells: string[] = [];
    let next = 0;
    for (const c of Array.from(row.getElementsByTagName("c"))) {
      const ref = c.getAttribute("r");
      const i = ref ? columnIndex(ref) : next;
      next = i + 1;
      const t = c.getAttribute("t");
      const val = c.getElementsByTagName("v")[0]?.textContent ?? "";
      cells[i] = t === "s" ? shared[Number(val)] ?? "" : t === "inlineStr" ? textOf(c) : t === "b" ? (val === "1" ? "oui" : "non") : val;
    }
    grid[Number.isFinite(r) && r >= 0 ? r : grid.length] = cells;
  }
  const headerRow = grid[0] ?? [];
  const headers = headerRow.map((h) => String(h ?? "").trim()).filter((h, i) => h !== "" || i < headerRow.length);
  const records = grid.slice(1).filter(Boolean).map((cells) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => { if (h) o[h] = String(cells[i] ?? "").trim(); });
    return o;
  }).filter((o) => Object.values(o).some((x) => x !== ""));
  return { headers: headers.filter((h) => h !== ""), records };
}
