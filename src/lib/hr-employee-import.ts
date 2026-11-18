export type ParsedHrEmployeeRow = {
  line: number;
  raw: Record<string, string>;
  row: {
    matricule: string;
    first_name: string;
    last_name: string;
    contract_type: string;
    email: string | null;
    phone: string | null;
    job_title: string | null;
    department: string | null;
    hire_date: string | null;
  };
  errors: string[];
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function keyOf(value: string) {
  return value.replace(/^\uFEFF/, "").trim().toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function dateIso(value: string): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) ?? /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return null;
  const [, a, b, c] = match;
  const [year, month, day] = value.includes("/") ? [Number(c), Number(b), Number(a)] : [Number(a), Number(b), Number(c)];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function normalizeHrEmployeeRow(raw: Record<string, string>, line: number): ParsedHrEmployeeRow {
  const normalized = Object.fromEntries(Object.entries(raw).map(([key, value]) => [keyOf(key), String(value ?? "").trim()]));
  const get = (...keys: string[]) => keys.map(keyOf).map((key) => normalized[key]).find(Boolean) ?? "";
  const first_name = get("first_name", "prenom", "given_name");
  const last_name = get("last_name", "nom", "surname");
  const contract_type = get("contract_type", "contrat", "type_contrat");
  const matricule = get("matricule", "employee_number", "employee_id");
  const emailInput = get("email", "courriel").toLocaleLowerCase();
  const phone = get("phone", "telephone", "tel");
  const job_title = get("job_title", "poste", "fonction");
  const department = get("department", "departement", "service");
  const hireDateInput = get("hire_date", "date_embauche", "date d'embauche", "embauche");
  const hire_date = dateIso(hireDateInput);
  const errors: string[] = [];

  if (!first_name) errors.push("Prénom manquant");
  if (!last_name) errors.push("Nom manquant");
  if (!contract_type) errors.push("Type de contrat manquant");
  if (emailInput && !EMAIL_RE.test(emailInput)) errors.push("Email invalide");
  if (hireDateInput && !hire_date) errors.push("Date d'embauche invalide");
  if (matricule.length > 80) errors.push("Matricule supérieur à 80 caractères");
  if (first_name.length > 120) errors.push("Prénom supérieur à 120 caractères");
  if (last_name.length > 120) errors.push("Nom supérieur à 120 caractères");
  if (contract_type.length > 80) errors.push("Type de contrat supérieur à 80 caractères");

  return {
    line,
    raw,
    errors,
    row: {
      matricule, first_name, last_name, contract_type,
      email: emailInput || null, phone: phone || null, job_title: job_title || null,
      department: department || null, hire_date,
    },
  };
}

export function markDuplicateHrEmployeeIdentifiers(
  rows: ParsedHrEmployeeRow[],
  existing: Array<{ matricule: string; email?: string | null }> = [],
): ParsedHrEmployeeRow[] {
  const count = (pick: (row: ParsedHrEmployeeRow["row"]) => string) => {
    const counts = new Map<string, number>();
    for (const { row } of rows) {
      const value = pick(row).trim().toLocaleLowerCase();
      if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return counts;
  };
  const matricules = count((row) => row.matricule);
  const emails = count((row) => row.email ?? "");
  const existingMatricules = new Set(existing.map((row) => row.matricule.trim().toLocaleLowerCase()).filter(Boolean));
  const existingEmails = new Set(existing.map((row) => row.email?.trim().toLocaleLowerCase() ?? "").filter(Boolean));
  return rows.map((parsed) => {
    const errors = [...parsed.errors];
    const matricule = parsed.row.matricule.trim().toLocaleLowerCase();
    const email = parsed.row.email?.trim().toLocaleLowerCase() ?? "";
    if (matricule && (matricules.get(matricule) ?? 0) > 1) errors.push("Matricule présent plusieurs fois dans le fichier");
    if (email && (emails.get(email) ?? 0) > 1) errors.push("Courriel présent plusieurs fois dans le fichier");
    if (matricule && existingMatricules.has(matricule)) errors.push("Matricule déjà utilisé dans cette société");
    if (email && existingEmails.has(email)) errors.push("Courriel déjà utilisé dans cette société");
    return { ...parsed, errors };
  });
}

export function summarizeHrEmployeeRows(rows: ParsedHrEmployeeRow[]) {
  const valid = rows.filter((row) => row.errors.length === 0);
  const invalid = rows.filter((row) => row.errors.length > 0);
  return { total: rows.length, valid, invalid, validCount: valid.length, invalidCount: invalid.length, canImport: valid.length > 0 };
}
