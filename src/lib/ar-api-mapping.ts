/**
 * Adaptation des vues de l'API Java AR vers la forme `ARInvoice` que les écrans consomment déjà.
 * Logique pure : aucun accès réseau, testable seule.
 */
import type { ApiSchemas } from "@/api";

type ArInvoiceView = ApiSchemas["ArInvoiceView"];
type CustomerView = ApiSchemas["CustomerView"];

export interface MappedARInvoice {
  id: string;
  tenant_id: string;
  invoice_number: string;
  customer_id: string;
  invoice_date: string;
  due_date: string;
  subtotal: number;
  tax_amount: number;
  total: number;
  amount_paid: number;
  status: string;
  created_by: string;
  created_at: string;
  customer?: { id: string; name: string; credit_limit: number; payment_terms: number };
}

/**
 * `tenant_id`, `created_by` et `created_at` ne sont pas exposés par l'API (la société est
 * implicite, jamais un paramètre) : ils restent vides plutôt qu'inventés. Les écrans AR ne les
 * lisent pas ; `credit_limit` et `payment_terms` du client ne sont pas dans `CustomerView`.
 */
export function toARInvoice(view: ArInvoiceView, customers: ReadonlyMap<string, CustomerView>): MappedARInvoice {
  const customer = customers.get(view.customerId);
  return {
    id: view.id,
    tenant_id: "",
    invoice_number: view.invoiceNumber,
    customer_id: view.customerId,
    invoice_date: view.invoiceDate,
    due_date: view.dueDate,
    subtotal: view.subtotal,
    tax_amount: view.taxAmount,
    total: view.total,
    amount_paid: view.amountPaid,
    status: view.status,
    created_by: "",
    created_at: "",
    customer: customer
      ? { id: customer.id, name: customer.name, credit_limit: 0, payment_terms: 0 }
      : undefined,
  };
}
