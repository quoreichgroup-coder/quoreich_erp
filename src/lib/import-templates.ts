export type ImportEntity =
  | "customers"
  | "suppliers"
  | "gl_accounts"
  | "items"
  | "ar_invoices"
  | "ap_invoices";

export interface EntityTemplate {
  key: ImportEntity;
  label: string;
  description: string;
  required: string[];
  optional: string[];
  sample: Record<string, string>;
}

export const IMPORT_TEMPLATES: Record<ImportEntity, EntityTemplate> = {
  customers: {
    key: "customers",
    label: "Clients",
    description: "Importer la liste de vos clients",
    required: ["name"],
    optional: ["email", "phone", "address", "tax_id", "payment_terms", "credit_limit", "status"],
    sample: {
      name: "ACME SARL",
      email: "contact@acme.com",
      phone: "+225 01 02 03 04 05",
      address: "Abidjan, Côte d'Ivoire",
      tax_id: "CI-12345",
      payment_terms: "30",
      credit_limit: "5000000",
      status: "active",
    },
  },
  suppliers: {
    key: "suppliers",
    label: "Fournisseurs",
    description: "Importer la liste de vos fournisseurs",
    required: ["name"],
    optional: ["email", "phone", "address", "tax_id", "payment_terms", "status"],
    sample: {
      name: "Office Supplies Co.",
      email: "sales@office.com",
      phone: "+225 05 06 07 08 09",
      address: "Plateau, Abidjan",
      tax_id: "CI-98765",
      payment_terms: "45",
      status: "active",
    },
  },
  gl_accounts: {
    key: "gl_accounts",
    label: "Plan comptable",
    description: "Importer votre plan de comptes (chart of accounts)",
    required: ["code", "name", "account_type"],
    optional: ["is_active"],
    sample: {
      code: "6010",
      name: "Achats de marchandises",
      account_type: "expense",
      is_active: "true",
    },
  },
  items: {
    key: "items",
    label: "Articles / Stock",
    description: "Importer le catalogue d'articles et stock initial",
    required: ["code", "name"],
    optional: ["category", "unit", "unit_cost", "selling_price", "quantity_on_hand", "reorder_level", "status"],
    sample: {
      code: "ART-001",
      name: "Carton A4",
      category: "Fournitures",
      unit: "carton",
      unit_cost: "12500",
      selling_price: "15000",
      quantity_on_hand: "100",
      reorder_level: "20",
      status: "active",
    },
  },
  ar_invoices: {
    key: "ar_invoices",
    label: "Factures clients (AR)",
    description: "Importer les factures clients en cours",
    required: ["invoice_number", "customer_id", "due_date", "total"],
    optional: ["invoice_date", "subtotal", "tax_amount", "amount_paid", "status"],
    sample: {
      invoice_number: "INV-2026-001",
      customer_id: "<uuid-client>",
      invoice_date: "2026-01-15",
      due_date: "2026-02-15",
      subtotal: "100000",
      tax_amount: "18000",
      total: "118000",
      amount_paid: "0",
      status: "sent",
    },
  },
  ap_invoices: {
    key: "ap_invoices",
    label: "Factures fournisseurs (AP)",
    description: "Importer les factures fournisseurs en cours",
    required: ["invoice_number", "supplier_id", "due_date", "total"],
    optional: ["invoice_date", "subtotal", "tax_amount", "amount_paid", "status", "approval_status"],
    sample: {
      invoice_number: "AP-2026-001",
      supplier_id: "<uuid-fournisseur>",
      invoice_date: "2026-01-10",
      due_date: "2026-02-10",
      subtotal: "50000",
      tax_amount: "9000",
      total: "59000",
      amount_paid: "0",
      status: "draft",
      approval_status: "pending",
    },
  },
};

export function buildCsvTemplate(entity: ImportEntity): string {
  const t = IMPORT_TEMPLATES[entity];
  const headers = [...t.required, ...t.optional];
  const sampleRow = headers.map((h) => t.sample[h] ?? "").join(",");
  return headers.join(",") + "\n" + sampleRow + "\n";
}
