package com.quoreich.qerp.modules.sales;

import com.quoreich.qerp.platform.ApiRefusal;
import com.quoreich.qerp.platform.Sql;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * Ventes (lot 4) : devis, commandes, livraisons, retours clients, indicateurs, paramètres et numérotation.
 * Les pièces ne s'écrivent que par les fonctions de la base (V40–V50) ; la route d'action n'accepte que la liste.
 */
@RestController
@RequestMapping("/api/v1/sales")
@Tag(name = "Ventes", description = "Devis, commandes, livraisons, retours clients, indicateurs et paramètres")
public class SalesController {

  static final Set<String> ACTIONS = Set.of("create_sales_quotation", "create_sales_order", "create_sales_order_from_quote", "update_sales_quotation",
      "delete_sales_quotation", "update_sales_order", "delete_sales_order", "confirm_so", "confirm_quote_to_so", "post_delivery", "invoice_from_delivery",
      "create_customer_return", "credit_customer_return", "assign_sales_role");
  static final Set<String> SETTINGS = Set.of("auto_invoice_on_delivery", "reserve_stock_on_confirm", "sla_quote_hours", "sla_quote_to_so_hours",
      "sla_so_to_dn_days", "sla_dn_to_invoice_days", "sla_warning_pct", "sla_critical_pct", "color_ok", "color_warning", "color_critical", "updated_at",
      "credit_control_mode", "block_expired_quotations");
  private static final String LINES = "(SELECT to_jsonb(x) FROM (SELECT code FROM public.tax_codes WHERE id = l.tax_code_id) x) AS tax_code";
  private static final ObjectMapper JSON = new ObjectMapper();

  private final Sql sql;

  public SalesController(Sql sql) {
    this.sql = sql;
  }

  @PostMapping("/actions/{function}")
  @Operation(operationId = "runSalesAction", summary = "Opération sur les pièces de vente (fonction de la liste autorisée, arguments nommés)")
  public JsonNode action(@PathVariable String function, @RequestBody(required = false) Map<String, Object> a) {
    if (!ACTIONS.contains(function)) throw new ApiRefusal(404, "Opération inconnue : " + function);
    return sql.call(function, a == null ? Map.of() : a);
  }

  @GetMapping("/quotations")
  @Operation(operationId = "listQuotations", summary = "Devis avec le client")
  public JsonNode quotations() {
    return sql.list("SELECT q.*, (SELECT to_jsonb(x) FROM (SELECT name FROM public.customers WHERE id = q.customer_id) x) AS customer"
        + " FROM public.quotations q ORDER BY q.created_at DESC");
  }

  @GetMapping("/orders")
  @Operation(operationId = "listSalesOrders", summary = "Commandes clients avec le client et le devis d'origine")
  public JsonNode orders() {
    return sql.list("SELECT o.*, (SELECT to_jsonb(x) FROM (SELECT name FROM public.customers WHERE id = o.customer_id) x) AS customer,"
        + " (SELECT to_jsonb(x) FROM (SELECT quote_number FROM public.quotations WHERE id = o.quotation_id) x) AS quotation"
        + " FROM public.sales_orders o ORDER BY o.created_at DESC");
  }

  @GetMapping("/deliveries")
  @Operation(operationId = "listDeliveryNotes", summary = "Bons de livraison avec le client et la commande")
  public JsonNode deliveries() {
    return sql.list("SELECT d.*, (SELECT to_jsonb(x) FROM (SELECT name FROM public.customers WHERE id = d.customer_id) x) AS customer,"
        + " (SELECT to_jsonb(x) FROM (SELECT so_number FROM public.sales_orders WHERE id = d.so_id) x) AS sales_order"
        + " FROM public.delivery_notes d ORDER BY d.created_at DESC");
  }

  @GetMapping("/{kind}/{id}/lines")
  @Operation(operationId = "listSalesDocumentLines", summary = "Lignes d'un devis (quotations), d'une commande (orders) ou d'une livraison (deliveries)")
  public JsonNode lines(@PathVariable String kind, @PathVariable UUID id) {
    String[] t = switch (kind) {
      case "quotations" -> new String[] {"quote_lines", "quotation_id"};
      case "orders" -> new String[] {"so_lines", "so_id"};
      case "deliveries" -> new String[] {"dn_lines", "dn_id"};
      default -> throw new ApiRefusal(404, "Pièce inconnue : " + kind);
    };
    return sql.list("SELECT l.*, " + LINES + " FROM public." + t[0] + " l WHERE l." + t[1] + " = ?::uuid ORDER BY l.created_at", id.toString());
  }

  @GetMapping("/customers/{id}/exposure")
  @Operation(operationId = "getCustomerOpenInvoices", summary = "Factures émises non soldées d'un client (encours, retard)")
  public JsonNode exposure(@PathVariable UUID id) {
    return sql.list("SELECT total, amount_paid, status, due_date FROM public.ar_invoices WHERE customer_id = ?::uuid AND status NOT IN ('draft', 'paid', 'cancelled')", id.toString());
  }

  @GetMapping("/returns")
  @Operation(operationId = "listCustomerReturns", summary = "Retours clients avec client, livraison, avoir et lignes")
  public JsonNode returns() {
    return sql.list("SELECT r.*, (SELECT to_jsonb(x) FROM (SELECT name FROM public.customers WHERE id = r.customer_id) x) AS customer,"
        + " (SELECT to_jsonb(x) FROM (SELECT dn_number, ar_invoice_id FROM public.delivery_notes WHERE id = r.dn_id) x) AS delivery,"
        + " (SELECT to_jsonb(x) FROM (SELECT credit_note_number FROM public.ar_credit_notes WHERE id = r.credit_note_id) x) AS credit_note,"
        + " coalesce((SELECT jsonb_agg(jsonb_build_object('description', l.description, 'quantity', l.quantity, 'unit_price', l.unit_price, 'unit_cost', l.unit_cost))"
        + " FROM public.customer_return_lines l WHERE l.return_id = r.id), '[]'::jsonb) AS lines FROM public.customer_returns r ORDER BY r.created_at DESC");
  }

  @GetMapping("/views/{view}")
  @Operation(operationId = "readSalesView", summary = "Vues des ventes : pipeline, délais, indicateurs, piste d'audit")
  public JsonNode view(@PathVariable String view) {
    return switch (view) {
      case "pipeline" -> sql.list("SELECT * FROM public.sales_pipeline_view");
      case "sla" -> sql.list("SELECT * FROM public.sales_sla_view");
      case "kpis" -> sql.one("SELECT * FROM public.sales_kpis_view");
      case "audit" -> sql.list("SELECT * FROM public.sales_audit_view ORDER BY created_at DESC LIMIT 200");
      default -> throw new ApiRefusal(404, "Vue inconnue : " + view);
    };
  }

  @GetMapping("/reporting")
  @Operation(operationId = "getSalesReportingData", summary = "Factures (chiffre d'affaires encaissé) et mouvements de coût des ventes")
  public JsonNode reporting() {
    ObjectNode out = JSON.createObjectNode();
    out.set("invoices", sql.list("SELECT i.customer_id, i.total, i.amount_paid, i.status, i.invoice_date,"
        + " (SELECT to_jsonb(x) FROM (SELECT name FROM public.customers WHERE id = i.customer_id) x) AS customer FROM public.ar_invoices i ORDER BY i.invoice_date DESC"));
    out.set("cogs", sql.list("SELECT movement_date, total_value, movement_type, reference_type FROM public.stock_movements"
        + " WHERE movement_type IN ('delivery', 'sale', 'issue') OR reference_type = 'delivery_note'"));
    return out;
  }

  @GetMapping("/sellable-items")
  @Operation(operationId = "listSellableItems", summary = "Articles actifs vendables")
  public JsonNode sellable() {
    return sql.list("SELECT id, code, name, category, selling_price, unit, status FROM public.items WHERE status = 'active' ORDER BY name");
  }

  @GetMapping("/settings")
  @Operation(operationId = "getSalesSettings", summary = "Paramètres des ventes")
  public JsonNode settings() {
    return sql.one("SELECT * FROM public.sales_settings WHERE tenant_id = public.get_user_tenant_id(auth.uid())");
  }

  @PutMapping("/settings")
  @Operation(operationId = "saveSalesSettings", summary = "Modifier les paramètres des ventes (droit sales.settings)")
  public JsonNode saveSettings(@RequestBody Map<String, Object> body) {
    Map<String, Object> b = new LinkedHashMap<>(body);
    b.put("updated_at", java.time.OffsetDateTime.now().toString());
    return sql.updateWhere("sales_settings", b, SETTINGS, "tenant_id = public.get_user_tenant_id(auth.uid())");
  }

  @GetMapping("/numbering")
  @Operation(operationId = "listSalesNumberingSeries", summary = "Séries de numérotation des ventes")
  public JsonNode numbering() {
    return sql.list("SELECT tenant_id, doc_type, prefix, format, next_number, reset_frequency FROM public.sales_numbering_series ORDER BY doc_type");
  }

  @PutMapping("/numbering/{docType}")
  @Operation(operationId = "updateSalesNumberingSeries", summary = "Modifier une série de numérotation")
  public JsonNode updateNumbering(@PathVariable String docType, @RequestBody Map<String, Object> body) {
    Map<String, Object> b = new LinkedHashMap<>(body);
    b.put("updated_at", java.time.OffsetDateTime.now().toString());
    return sql.updateWhere("sales_numbering_series", b, Set.of("prefix", "format", "reset_frequency", "updated_at"),
        "tenant_id = public.get_user_tenant_id(auth.uid()) AND doc_type = ?", docType);
  }

  @GetMapping("/role-audit")
  @Operation(operationId = "listSalesRoleAudit", summary = "Journal des rôles des ventes")
  public JsonNode roleAudit() {
    return sql.list("SELECT * FROM public.sales_role_audit ORDER BY created_at DESC LIMIT 500");
  }

  @GetMapping("/ar-invoices-summary")
  @Operation(operationId = "listArInvoicesSummary", summary = "Factures clients (montants, statut, client) pour les tableaux de bord des ventes")
  public JsonNode arSummary(@RequestParam(defaultValue = "false") boolean excludeCancelled) {
    return sql.list("SELECT i.customer_id, i.total, i.amount_paid, i.status, i.invoice_date, (SELECT to_jsonb(x) FROM (SELECT name FROM public.customers WHERE id = i.customer_id) x) AS customer"
        + " FROM public.ar_invoices i WHERE NOT ? OR i.status <> 'cancelled' ORDER BY i.invoice_date DESC", excludeCancelled);
  }
}
