package com.quoreich.qerp.modules.pilotage;

import com.quoreich.qerp.platform.ApiRefusal;
import com.quoreich.qerp.platform.Sql;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.Map;
import java.util.Set;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * Pilotage : jeux de données des tableaux de bord (société courante, sous RLS), cockpit CFO, consolidation
 * multi-sociétés (fonctions V*: intersection avec get_accessible_tenants dans la base), créances / dettes échues.
 */
@RestController
@RequestMapping("/api/v1/pilotage")
@Tag(name = "Pilotage", description = "Tableaux de bord, cockpit CFO, consolidation et échéanciers")
public class PilotageController {

  static final Set<String> ACTIONS = Set.of("get_accessible_tenants", "get_consolidated_cfo_kpis", "get_consolidated_cfo_trends");
  private static final ObjectMapper JSON = new ObjectMapper();

  private final Sql sql;

  public PilotageController(Sql sql) {
    this.sql = sql;
  }

  @PostMapping("/actions/{function}")
  @Operation(operationId = "runPilotageAction", summary = "Consolidation CFO (fonction de la liste autorisée, arguments nommés)")
  public JsonNode action(@PathVariable String function, @RequestBody(required = false) Map<String, Object> a) {
    if (!ACTIONS.contains(function)) throw new ApiRefusal(404, "Opération inconnue : " + function);
    return sql.call(function, a == null ? Map.of() : a);
  }

  private ObjectNode node() {
    return JSON.createObjectNode();
  }

  @GetMapping("/dashboard")
  @Operation(operationId = "getDashboardData", summary = "Données du tableau de bord : factures, nombre de tiers, règlements")
  public JsonNode dashboard() {
    ObjectNode o = node();
    o.set("ar", sql.list("SELECT total, amount_paid, status, invoice_date FROM public.ar_invoices"));
    o.set("ap", sql.list("SELECT total, amount_paid, status, invoice_date FROM public.ap_invoices"));
    o.put("customers", sql.value(Long.class, "SELECT count(*) FROM public.customers"));
    o.put("suppliers", sql.value(Long.class, "SELECT count(*) FROM public.suppliers"));
    o.set("arPayments", sql.list("SELECT amount, payment_date FROM public.payments WHERE payment_type = 'ar_receipt'"));
    o.set("apPayments", sql.list("SELECT amount, payment_date FROM public.payments WHERE payment_type = 'ap_payment'"));
    return o;
  }

  @GetMapping("/recent")
  @Operation(operationId = "getRecentTransactions", summary = "Cinq dernières factures clients et fournisseurs")
  public JsonNode recent() {
    ObjectNode o = node();
    o.set("ar", sql.list("SELECT i.id, i.invoice_number, i.total, i.status, i.invoice_date,"
        + " (SELECT to_jsonb(x) FROM (SELECT name FROM public.customers WHERE id = i.customer_id) x) AS customer FROM public.ar_invoices i ORDER BY i.created_at DESC LIMIT 5"));
    o.set("ap", sql.list("SELECT i.id, i.invoice_number, i.total, i.status, i.invoice_date,"
        + " (SELECT to_jsonb(x) FROM (SELECT name FROM public.suppliers WHERE id = i.supplier_id) x) AS supplier FROM public.ap_invoices i ORDER BY i.created_at DESC LIMIT 5"));
    return o;
  }

  @GetMapping("/payments")
  @Operation(operationId = "listPaymentsTrend", summary = "Règlements (montant, date, type) par date")
  public JsonNode payments() {
    return sql.list("SELECT amount, payment_date, payment_type FROM public.payments ORDER BY payment_date");
  }

  @GetMapping("/upcoming-payables")
  @Operation(operationId = "listUpcomingPayables", summary = "Cinq prochaines échéances fournisseurs")
  public JsonNode upcoming() {
    return sql.list("SELECT i.id, i.invoice_number, i.due_date, i.total, i.amount_paid,"
        + " (SELECT to_jsonb(x) FROM (SELECT name FROM public.suppliers WHERE id = i.supplier_id) x) AS supplier"
        + " FROM public.ap_invoices i WHERE i.status <> 'paid' AND i.due_date >= CURRENT_DATE ORDER BY i.due_date LIMIT 5");
  }

  @GetMapping("/cfo")
  @Operation(operationId = "getCfoCockpitData", summary = "Données du cockpit CFO de la société courante")
  public JsonNode cfo() {
    ObjectNode o = node();
    o.set("ar", sql.list("SELECT total, amount_paid, status, due_date FROM public.ar_invoices"));
    o.set("ap", sql.list("SELECT total, amount_paid, status, due_date FROM public.ap_invoices"));
    o.set("banks", sql.list("SELECT balance FROM public.bank_accounts WHERE is_active"));
    o.set("arPayments", sql.list("SELECT amount, payment_date FROM public.payments WHERE payment_type = 'ar_receipt'"));
    o.set("apPayments", sql.list("SELECT amount, payment_date FROM public.payments WHERE payment_type = 'ap_payment'"));
    o.put("activeProjects", sql.value(Long.class, "SELECT count(*) FROM public.projects WHERE status = 'active'"));
    o.set("risks", sql.list("SELECT likelihood, impact, residual_likelihood, residual_impact, status FROM public.risk_register WHERE status <> 'closed'"));
    o.set("riskSettings", sql.one("SELECT * FROM public.risk_settings WHERE tenant_id = public.get_user_tenant_id(auth.uid())"));
    o.set("payroll", sql.list("SELECT net_total, status, pay_date FROM public.payroll_runs WHERE status = 'posted'"));
    o.set("inventoryClose", sql.list("SELECT period FROM public.inventory_period_closes ORDER BY period DESC LIMIT 1"));
    o.set("treasuryClose", sql.list("SELECT period FROM public.treasury_period_closes ORDER BY period DESC LIMIT 1"));
    o.put("draftReconciliations", sql.value(Long.class, "SELECT count(*) FROM public.bank_reconciliations WHERE status = 'draft'"));
    return o;
  }

  @GetMapping("/overdue/{kind}")
  @Operation(operationId = "listOverdueInvoices", summary = "Créances (ar) ou dettes (ap) échues, filtres de dates, tri par échéance")
  public JsonNode overdue(@PathVariable String kind, @RequestParam(required = false) String from, @RequestParam(required = false) String to,
      @RequestParam(defaultValue = "true") boolean ascending) {
    String table = switch (kind) {
      case "ar" -> "ar_invoices";
      case "ap" -> "ap_invoices";
      default -> throw new ApiRefusal(404, "Type inconnu : " + kind);
    };
    return sql.list("SELECT id, invoice_number, invoice_date, due_date, total, amount_paid, status FROM public." + table
        + " WHERE status <> 'paid' AND due_date < CURRENT_DATE AND (?::date IS NULL OR due_date >= ?::date) AND (?::date IS NULL OR due_date <= ?::date)"
        + " ORDER BY due_date " + (ascending ? "ASC" : "DESC"), from, from, to, to);
  }
}
