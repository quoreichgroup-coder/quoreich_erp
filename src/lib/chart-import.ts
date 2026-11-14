/*
 * Import guidé du plan comptable (V65, lot PC-4) : correspondance entre les colonnes d'un fichier et
 * les champs QUOREICH, selon un profil (en-têtes acceptés). Les contrôles métier sont faits par la
 * base (prepare_chart_import) ; ici, seulement la lecture du fichier.
 */
export const IMPORT_FIELDS = [
  { key: "code", label: "Code", required: true },
  { key: "name", label: "Intitulé", required: true },
  { key: "type", label: "Type", required: false },
  { key: "parent", label: "Parent", required: false },
  { key: "header", label: "Regroupement", required: false },
  { key: "normal_balance", label: "Sens normal", required: false },
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number]["key"];
export type ColumnMap = Partial<Record<ImportField, string[]>>;
export type Mapping = Partial<Record<ImportField, string>>;
export type ImportRow = Partial<Record<ImportField, string>>;

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9/]+/g, " ").trim();

/** Colonne du fichier retenue pour chaque champ : premier en-tête accepté par le profil. */
export function detectMapping(headers: string[], columnMap: ColumnMap): Mapping {
  const byNorm = new Map(headers.map((h) => [norm(h), h]));
  const out: Mapping = {};
  for (const f of IMPORT_FIELDS) {
    for (const candidate of columnMap[f.key] ?? []) {
      const h = byNorm.get(norm(candidate));
      if (h !== undefined) { out[f.key] = h; break; }
    }
  }
  return out;
}

export const missingRequired = (m: Mapping) => IMPORT_FIELDS.filter((f) => f.required && !m[f.key]).map((f) => f.label);

/** Lignes envoyées à la base ; les lignes entièrement vides sont écartées. */
export function mapRows(records: Record<string, string>[], m: Mapping): ImportRow[] {
  const rows: ImportRow[] = [];
  for (const r of records) {
    const row: ImportRow = {};
    for (const f of IMPORT_FIELDS) {
      const col = m[f.key];
      const v = col ? String(r[col] ?? "").trim() : "";
      if (v) row[f.key] = v;
    }
    if (Object.keys(row).length > 0) rows.push(row);
  }
  return rows;
}

const TYPE_LABEL: Record<string, string> = { asset: "Actif", liability: "Passif", equity: "Capitaux propres", revenue: "Produits", expense: "Charges" };

/** Export du plan au format du profil QUOREICH (réimportable tel quel). */
export function chartExportRows(accounts: { code: string; name: string; account_type: string; parent_id: string | null; id: string; is_header?: boolean; normal_balance?: string; is_active?: boolean }[]) {
  const byId = new Map(accounts.map((a) => [a.id, a.code]));
  return [...accounts].sort((a, b) => a.code.localeCompare(b.code)).map((a) => ({
    code: a.code, intitule: a.name, type: TYPE_LABEL[a.account_type] ?? a.account_type, parent: a.parent_id ? byId.get(a.parent_id) ?? "" : "",
    regroupement: a.is_header ? "oui" : "non", sens: a.normal_balance === "credit" ? "Crédit" : a.normal_balance === "debit" ? "Débit" : "",
    actif: a.is_active === false ? "non" : "oui",
  }));
}
export const CHART_EXPORT_COLUMNS: { key: keyof ReturnType<typeof chartExportRows>[number]; header: string }[] = [
  { key: "code", header: "Code" }, { key: "intitule", header: "Intitulé" }, { key: "type", header: "Type" }, { key: "parent", header: "Parent" },
  { key: "regroupement", header: "Regroupement" }, { key: "sens", header: "Sens" }, { key: "actif", header: "Actif" },
];
