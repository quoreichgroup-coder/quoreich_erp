package com.quoreich.qerp.modules.payable;

import static com.quoreich.qerp.platform.Sql.args;

import com.quoreich.qerp.platform.Sql;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.Map;
import java.util.UUID;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

/** Retours fournisseurs et avoirs fournisseurs (V52) : lectures sous RLS, écritures par les fonctions de la base. */
@RestController
@RequestMapping("/api/v1")
@Tag(name = "Retours et avoirs fournisseurs", description = "Retours sur réception, avoirs fournisseurs imputés sur les factures")
public class SupplierReturnsController {

  private final Sql sql;

  public SupplierReturnsController(Sql sql) {
    this.sql = sql;
  }

  @GetMapping("/procurement/supplier-returns")
  @Operation(operationId = "listSupplierReturns", summary = "Retours fournisseurs, avec fournisseur, réception, commande, avoir et lignes")
  public JsonNode returns() {
    return sql.list("SELECT r.*,"
        + " (SELECT to_jsonb(x) FROM (SELECT name FROM public.suppliers WHERE id = r.supplier_id) x) AS supplier,"
        + " (SELECT to_jsonb(x) FROM (SELECT gr_number FROM public.goods_receipts WHERE id = r.gr_id) x) AS gr,"
        + " (SELECT to_jsonb(x) FROM (SELECT po_number FROM public.purchase_orders WHERE id = r.po_id) x) AS po,"
        + " (SELECT to_jsonb(x) FROM (SELECT credit_note_number FROM public.ap_credit_notes WHERE id = r.credit_note_id) x) AS credit_note,"
        + " coalesce((SELECT jsonb_agg(to_jsonb(l)) FROM public.supplier_return_lines l WHERE l.return_id = r.id), '[]'::jsonb) AS lines"
        + " FROM public.supplier_returns r ORDER BY r.return_date DESC, r.created_at DESC");
  }

  @PostMapping("/procurement/supplier-returns")
  @Operation(operationId = "createSupplierReturn", summary = "Retour sur une réception (droit procurement.return)")
  public JsonNode createReturn(@RequestBody Map<String, Object> b) {
    return sql.call("create_supplier_return", args("_gr_id", b.get("gr_id"), "_reason", b.get("reason"), "_return_date", b.get("return_date"),
        "_lines", b.get("lines"), "_replacement_expected", b.get("replacement_expected"), "_ap_invoice_id", b.get("ap_invoice_id"),
        "_supplier_reference", b.get("supplier_reference")));
  }

  @PostMapping("/procurement/supplier-returns/{id}/credit")
  @Operation(operationId = "creditSupplierReturn", summary = "Établir l'avoir d'un retour sur une facture de la commande")
  public JsonNode credit(@PathVariable UUID id, @RequestBody Map<String, Object> b) {
    return sql.call("credit_supplier_return", args("_return_id", id, "_invoice_id", b.get("invoice_id"), "_supplier_reference", b.get("supplier_reference"),
        "_credit_date", b.get("credit_date")));
  }

  @GetMapping("/ap/credit-notes")
  @Operation(operationId = "listApCreditNotes", summary = "Avoirs fournisseurs (filtre facultatif par facture)")
  public JsonNode creditNotes(@RequestParam(required = false) UUID invoiceId) {
    return sql.list("SELECT c.*,"
        + " (SELECT to_jsonb(x) FROM (SELECT invoice_number FROM public.ap_invoices WHERE id = c.invoice_id) x) AS invoice,"
        + " (SELECT to_jsonb(x) FROM (SELECT name FROM public.suppliers WHERE id = c.supplier_id) x) AS supplier,"
        + " (SELECT to_jsonb(x) FROM (SELECT return_number FROM public.supplier_returns WHERE id = c.supplier_return_id) x) AS supplier_return"
        + " FROM public.ap_credit_notes c WHERE (?::uuid IS NULL OR c.invoice_id = ?::uuid) ORDER BY c.credit_date DESC, c.created_at DESC",
        invoiceId == null ? null : invoiceId.toString(), invoiceId == null ? null : invoiceId.toString());
  }

  @PostMapping("/ap/invoices/{id}/credit-notes")
  @Operation(operationId = "createApCreditNote", summary = "Avoir fournisseur sur une facture approuvée (droit ap.credit_note)")
  public JsonNode createCreditNote(@PathVariable UUID id, @RequestBody Map<String, Object> b) {
    return sql.call("create_ap_credit_note", args("_invoice_id", id, "_reason", b.get("reason"), "_credit_date", b.get("credit_date"),
        "_subtotal", b.get("subtotal"), "_tax_amount", b.get("tax_amount"), "_supplier_reference", b.get("supplier_reference")));
  }
}
