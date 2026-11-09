// Pure CSV row normalization + validation for CRM contacts import.
// Extracted from CrmContactsImportDialog so it can be tested in isolation.

import type { CrmContact } from "@/hooks/use-crm-data";

export type ContactRow = Partial<CrmContact> & { full_name: string };
export type ParsedContactRow = {
  line: number;
  raw: Record<string, string>;
  row: ContactRow;
  errors: string[];
};

export const ALLOWED_CONTACT_STATUS = ["active", "inactive", "archived"] as const;
export const CONTACT_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeContactRow(raw: Record<string, string>, line: number): ParsedContactRow {
  const get = (k: string) => (raw[k] ?? raw[k.toLowerCase()] ?? "").trim();
  const full_name = get("full_name") || get("nom") || get("name");
  const email = get("email") || null;
  const phone = get("phone") || get("telephone") || null;
  const company = get("company") || get("societe") || null;
  const position = get("position") || get("fonction") || null;
  const source = get("source") || null;
  let status = (get("status") || "active").toLowerCase();
  if (!(ALLOWED_CONTACT_STATUS as readonly string[]).includes(status)) status = "active";

  const errors: string[] = [];
  if (!full_name) errors.push("Nom complet manquant");
  if (email && !CONTACT_EMAIL_RE.test(email)) errors.push("Email invalide");
  if (full_name && full_name.length > 200) errors.push("Nom > 200 caractères");

  return {
    line,
    raw,
    errors,
    row: {
      full_name,
      email: email || null,
      phone: phone || null,
      company: company || null,
      position: position || null,
      source: source || null,
      status,
      tags: [],
    },
  };
}

export function summarizeContactRows(rows: ParsedContactRow[]) {
  const valid = rows.filter((r) => r.errors.length === 0);
  const invalid = rows.filter((r) => r.errors.length > 0);
  return {
    total: rows.length,
    valid,
    invalid,
    validCount: valid.length,
    invalidCount: invalid.length,
    canImport: valid.length > 0,
  };
}
