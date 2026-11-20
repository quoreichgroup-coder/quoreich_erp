/*
 * Pièces jointes (V138) : logique pure partagée par le nuage et le site — chemin de stockage (même forme que celui que
 * register_attachment exige : <société>/<type>/<pièce>/<id>-<nom>), empreinte SHA-256, libellés, tailles.
 */
export type AttachmentDocType =
  | "purchase_requisition" | "purchase_order" | "goods_receipt" | "ap_invoice" | "ap_credit_note" | "supplier_return" | "import_file"
  | "supplier" | "customer" | "quotation" | "sales_order" | "delivery_note" | "ar_invoice" | "ar_credit_note" | "customer_return"
  | "payment" | "bank_statement" | "journal_entry" | "asset" | "project";

export const DOC_TYPE_LABELS: Record<AttachmentDocType, string> = {
  purchase_requisition: "Demande d'achat", purchase_order: "Commande fournisseur", goods_receipt: "Réception", ap_invoice: "Facture fournisseur",
  ap_credit_note: "Avoir fournisseur", supplier_return: "Retour fournisseur", import_file: "Dossier d'importation", supplier: "Fournisseur",
  customer: "Client", quotation: "Devis", sales_order: "Commande client", delivery_note: "Bon de livraison", ar_invoice: "Facture client",
  ar_credit_note: "Avoir client", customer_return: "Retour client", payment: "Règlement", bank_statement: "Relevé bancaire",
  journal_entry: "Écriture comptable", asset: "Immobilisation", project: "Projet",
};

/** Pièces dont la soumission (ou le dédouanement) peut exiger une pièce jointe. */
export const REQUIRABLE: AttachmentDocType[] = ["ap_invoice", "purchase_requisition", "purchase_order", "import_file"];

export function safeFileName(name: string): string {
  const s = (name || "fichier").replace(/[^A-Za-z0-9._-]+/g, "_");
  return s.slice(Math.max(0, s.length - 80));
}

export function attachmentPath(tenant: string, docType: AttachmentDocType, docId: string, fileName: string, unique: string): string {
  return `${tenant}/${docType}/${docId}/${unique}-${safeFileName(fileName)}`;
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} Ko`;
  return `${(bytes / 1024 / 1024).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;
}

/** Catégories applicables à un type de pièce (NULL = toutes), actives. */
export function categoriesFor<T extends { doc_types: string[] | null; is_active: boolean }>(cats: T[], docType: AttachmentDocType): T[] {
  return cats.filter((c) => c.is_active && (!c.doc_types || c.doc_types.includes(docType)));
}
