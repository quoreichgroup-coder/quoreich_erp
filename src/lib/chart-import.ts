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

/** En-têtes reconnus par défaut (identiques au format standard de V68), avant chargement du format. */
export const STANDARD_COLUMNS: ColumnMap = {
  code: ["Code", "Compte", "Numéro de compte", "N° compte", "N° de compte", "Numéro", "No compte", "Account", "Account No.", "Account Number", "Account Code", "G/L Account", "Compte général"],
  name: ["Intitulé", "Libellé", "Nom", "Désignation", "Intitulé du compte", "Libellé du compte", "Description", "Account Name", "Name", "Long Text"],
  type: ["Type", "Nature", "Type de compte", "Account Type"],
  parent: ["Parent", "Compte parent", "Compte de regroupement", "Parent Account"],
  header: ["Regroupement", "Titre", "Compte de totalisation", "Header"],
  normal_balance: ["Sens", "Sens normal", "Normal Balance"],
};

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9/]+/g, " ").trim();

/** Colonne du fichier retenue pour chaque champ : premier en-tête accepté par le profil. */
export function detectMapping(headers: string[], columnMap: ColumnMap | Record<string, string[]>): Mapping {
  const byNorm = new Map(headers.map((h) => [norm(h), h]));
  const out: Mapping = {};
  for (const key of Object.keys(columnMap)) {
    for (const candidate of (columnMap as Record<string, string[]>)[key] ?? []) {
      const h = byNorm.get(norm(candidate));
      if (h !== undefined) { (out as Record<string, string>)[key] = h; break; }
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
export const CHART_EXPORT_COLUMNS: { key: keyof ReturnType<typeof chartExportRows>[number]; header: string; width?: number }[] = [
  { key: "code", header: "Code", width: 14 }, { key: "intitule", header: "Intitulé", width: 45 }, { key: "type", header: "Type", width: 18 }, { key: "parent", header: "Parent", width: 12 },
  { key: "regroupement", header: "Regroupement", width: 14 }, { key: "sens", header: "Sens" }, { key: "actif", header: "Actif" },
];

/* Modèle de correspondance (V69) : un compte source par ligne (une ligne par cible), colonnes séparées. */
export const MAPPING_COLUMN_MAP: Record<"source" | "target" | "ratio" | "comment", string[]> = {
  source: ["Compte source", "Source", "Compte", "Code source", "Source account"],
  target: ["Compte cible", "Cible", "Compte de destination", "Target", "Target account"],
  ratio: ["Clé (%)", "Clé", "Ratio", "%", "Pourcentage", "Répartition (%)"],
  comment: ["Commentaire", "Remarque", "Comment"],
};
export type MappingTemplateRow = { source: string; sourceName: string; sourceType: string; target: string; targetName: string; ratio: number | ""; status: string; comment: string };
export const MAPPING_TEMPLATE_COLUMNS: { key: keyof MappingTemplateRow; header: string; width?: number }[] = [
  { key: "source", header: "Compte source", width: 14 }, { key: "sourceName", header: "Intitulé source", width: 40 }, { key: "sourceType", header: "Type source", width: 16 },
  { key: "target", header: "Compte cible", width: 14 }, { key: "targetName", header: "Intitulé cible", width: 40 }, { key: "ratio", header: "Clé (%)", width: 10 },
  { key: "status", header: "État", width: 12 }, { key: "comment", header: "Commentaire", width: 30 },
];
const MAPPING_STATUS: Record<string, string> = { proposed: "Proposée", validated: "Validée", rejected: "Refusée" };

/** Tous les comptes actifs : les cibles connues, ou une ligne vide à compléter. */
export function mappingTemplateRows(rows: { source_code: string; source_name: string; source_type: string; target_code: string | null; target_name: string | null; ratio: number | null; status: string | null }[]): MappingTemplateRow[] {
  return rows.map((r) => ({
    source: r.source_code, sourceName: r.source_name, sourceType: TYPE_LABEL[r.source_type] ?? r.source_type,
    target: r.target_code ?? "", targetName: r.target_name ?? "", ratio: r.ratio != null ? Number(r.ratio) : "", status: r.status ? MAPPING_STATUS[r.status] ?? r.status : "", comment: "",
  }));
}

/** Lignes du modèle rempli, prêtes pour import_chart_mapping_lines (numéro de ligne du fichier = ligne + 2). */
export function mappingImportRows(records: Record<string, string>[], headers: string[]) {
  const m = detectMapping(headers, MAPPING_COLUMN_MAP as ColumnMap) as Partial<Record<keyof typeof MAPPING_COLUMN_MAP, string>>;
  const get = (r: Record<string, string>, k: keyof typeof MAPPING_COLUMN_MAP) => (m[k] ? String(r[m[k]!] ?? "").trim() : "");
  return {
    missing: (["source", "target"] as const).filter((k) => !m[k]).map((k) => (k === "source" ? "Compte source" : "Compte cible")),
    rows: records.map((r, i) => ({ line: i + 2, source: get(r, "source"), target: get(r, "target"), ratio: get(r, "ratio"), comment: get(r, "comment") }))
      .filter((r) => r.source || r.target),
  };
}
