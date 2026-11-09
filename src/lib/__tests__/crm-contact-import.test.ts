import { describe, it, expect } from "vitest";
import Papa from "papaparse";
import {
  normalizeContactRow,
  summarizeContactRows,
  ALLOWED_CONTACT_STATUS,
} from "@/lib/crm-contact-import";

const CSV_OK = [
  "full_name,email,phone,company,position,status",
  "Awa Diop,awa@example.com,+221770000000,QuoreichSA,Manager,active",
  "Moussa Ndiaye,moussa@example.com,,QuoreichSA,Dev,inactive",
].join("\n");

const CSV_MIXED = [
  "full_name,email,status",
  "Fatou Sarr,fatou@example.com,active",
  ",missing-name@example.com,active", // erreur: nom manquant
  "Bad Email,not-an-email,active", // erreur: email invalide
  "Status Reset,ok@example.com,not-a-status", // status corrigé en 'active'
].join("\n");

function parseCsv(csv: string) {
  const res = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
  return res.data.map((r, i) => normalizeContactRow(r, i + 2));
}

describe("crm-contact-import — validation des champs", () => {
  it("normalise les en-têtes français (nom, societe, telephone, fonction)", () => {
    const csv = "nom,societe,telephone,fonction\nAida Ba,Acme,+221700000000,CTO";
    const [row] = parseCsv(csv);
    expect(row.errors).toEqual([]);
    expect(row.row.full_name).toBe("Aida Ba");
    expect(row.row.company).toBe("Acme");
    expect(row.row.phone).toBe("+221700000000");
    expect(row.row.position).toBe("CTO");
    expect(row.row.status).toBe("active"); // défaut
  });

  it("accepte chaque statut autorisé tel quel et retombe sur 'active' sinon", () => {
    for (const s of ALLOWED_CONTACT_STATUS) {
      const [row] = parseCsv(`full_name,status\nX,${s}`);
      expect(row.row.status).toBe(s);
    }
    const [bad] = parseCsv(`full_name,status\nX,bogus`);
    expect(bad.row.status).toBe("active");
  });

  it("détaille toutes les erreurs ligne par ligne", () => {
    const rows = parseCsv(CSV_MIXED);
    expect(rows).toHaveLength(4);
    expect(rows[0].errors).toEqual([]);
    expect(rows[1].errors).toContain("Nom complet manquant");
    expect(rows[2].errors).toContain("Email invalide");
    expect(rows[3].errors).toEqual([]); // status corrigé silencieusement
  });

  it("signale un nom > 200 caractères", () => {
    const long = "A".repeat(250);
    const [row] = parseCsv(`full_name\n${long}`);
    expect(row.errors).toContain("Nom > 200 caractères");
  });
});

describe("crm-contact-import — récapitulatif avant import", () => {
  it("compte correctement les lignes valides/en erreur", () => {
    const rows = parseCsv(CSV_MIXED);
    const sum = summarizeContactRows(rows);
    expect(sum.total).toBe(4);
    expect(sum.validCount).toBe(2); // Fatou + Status Reset
    expect(sum.invalidCount).toBe(2);
    expect(sum.canImport).toBe(true);
  });

  it("bloque l'import quand aucune ligne valide", () => {
    const rows = parseCsv("full_name\n\n");
    // après skipEmptyLines, plus rien => total 0
    const sum = summarizeContactRows(rows);
    expect(sum.total).toBe(0);
    expect(sum.canImport).toBe(false);
  });

  it("ne livre à l'insertion QUE les lignes valides", () => {
    const rows = parseCsv(CSV_MIXED);
    const sum = summarizeContactRows(rows);
    const payload = sum.valid.map((r) => r.row);
    expect(payload.every((p) => !!p.full_name)).toBe(true);
    expect(payload.every((p) => !p.email || /@/.test(p.email))).toBe(true);
  });

  it("scénario heureux : 2 lignes valides, 0 erreur, prêt à insérer", () => {
    const rows = parseCsv(CSV_OK);
    const sum = summarizeContactRows(rows);
    expect(sum.invalidCount).toBe(0);
    expect(sum.validCount).toBe(2);
    expect(sum.valid[0].row.full_name).toBe("Awa Diop");
  });
});
