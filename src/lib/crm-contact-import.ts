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
  const normalized = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key.replace(/^\uFEFF/, "").trim().toLowerCase(), value ?? ""]));
  const get = (...keys: string[]) => keys.map((key) => normalized[key]).find((value) => value?.trim())?.trim() ?? "";
  const full_name = get("full_name", "nom", "name");
  const email = get("email") || null;
  const phone = get("phone", "telephone") || null;
  const company = get("company", "societe", "société") || null;
  const position = get("position") || get("fonction") || null;
  const source = get("source") || null;
  const requestedStatus = (get("status") || "active").toLowerCase();
  const validStatus = (ALLOWED_CONTACT_STATUS as readonly string[]).includes(requestedStatus);
  const status = validStatus ? requestedStatus : "active";

  const errors: string[] = [];
  if (!full_name) errors.push("Nom complet manquant");
  if (email && !CONTACT_EMAIL_RE.test(email)) errors.push("Email invalide");
  if (full_name && full_name.length > 200) errors.push("Nom > 200 caractères");

  if (!validStatus) errors.push("Statut invalide (active, inactive ou archived)");

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

export function markDuplicateContactEmails(rows: ParsedContactRow[]): ParsedContactRow[] {
  const counts = new Map<string, number>();
  rows.forEach(({ row }) => {
    const email = row.email?.trim().toLocaleLowerCase();
    if (email) counts.set(email, (counts.get(email) ?? 0) + 1);
  });
  return rows.map((parsed) => {
    const email = parsed.row.email?.trim().toLocaleLowerCase();
    return email && (counts.get(email) ?? 0) > 1
      ? { ...parsed, errors: [...parsed.errors, "Email présent plusieurs fois dans le fichier"] }
      : parsed;
  });
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
