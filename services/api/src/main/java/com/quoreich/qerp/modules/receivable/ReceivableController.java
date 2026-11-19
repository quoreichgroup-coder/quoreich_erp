package com.quoreich.qerp.modules.receivable;

import com.quoreich.qerp.platform.ApiRefusal;
import com.quoreich.qerp.platform.Sql;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * Comptes clients, complément du lot 2 : paramètres AR (V48, V58), brouillons (émission, suppression, codes
 * TVA des lignes), encaissements, balance âgée, encours, acomptes et crédits (V49), lettrage, relevé client,
 * statut et suppression des fiches, identité de la société (V47), modèles de rapports, verrous de période.
 */
@RestController
@Tag(name = "Comptes clients (complément)", description = "Paramètres AR, brouillons, acomptes et crédits, lettrage, relevé, identité de la société")
public class ReceivableController {

  static final Set<String> ACTIONS = Set.of("record_customer_advance", "apply_customer_credit", "refund_customer_credit", "set_period_status");
  static final Set<String> TERM = Set.of("code", "label", "days", "discount_percent", "is_active");
  static final Set<String> DUNNING = Set.of("level", "days_overdue", "action", "fee_amount", "template", "is_active");
  static final Set<String> NOTIFICATION = Set.of("trigger_condition", "channel", "recipients", "is_active");
  static final Set<String> GENERAL = Set.of("default_payment_term_code", "default_currency", "default_credit_limit", "auto_numbering",
      "late_payment_interest_pct", "grace_period_days", "auto_lettering", "updated_at");
  static final Set<String> TEMPLATE = Set.of("module", "name", "data_source", "columns", "filters", "group_by", "status", "permission");
  private static final Map<String, String> SETTING_TABLES = Map.of("payment-terms", "ar_payment_terms", "dunning-rules", "ar_dunning_rules",
      "notification-rules", "ar_notification_rules");
  private static final ObjectMapper JSON = new ObjectMapper();

  private final Sql sql;

  public ReceivableController(Sql sql) {
    this.sql = sql;
  }

  @PostMapping("/api/v1/ar/actions/{function}")
  @Operation(operationId = "runArAction", summary = "Opération AR (acompte, imputation, remboursement, statut de période ; liste autorisée)")
  public JsonNode action(@PathVariable String function, @RequestBody(required = false) Map<String, Object> a) {
    if (!ACTIONS.contains(function)) throw new ApiRefusal(404, "Opération inconnue : " + function);
    return sql.call(function, a == null ? Map.of() : a);
  }

  // ─── Paramètres AR ───

  private static String settingTable(String kind) {
    String t = SETTING_TABLES.get(kind);
    if (t == null) throw new ApiRefusal(404, "Paramètre inconnu : " + kind);
    return t;
  }

  private static Set<String> settingColumns(String kind) {
    return switch (kind) {
      case "payment-terms" -> TERM;
      case "dunning-rules" -> DUNNING;
      default -> NOTIFICATION;
    };
  }

  @GetMapping("/api/v1/ar/settings/{kind}")
  @Operation(operationId = "listArSettings", summary = "Termes de paiement, niveaux de relance ou règles de notification")
  public JsonNode settings(@PathVariable String kind) {
    String order = switch (kind) {
      case "payment-terms" -> "days";
      case "dunning-rules" -> "level";
      default -> "created_at DESC";
    };
    return sql.list("SELECT * FROM public." + settingTable(kind) + " ORDER BY " + order);
  }

  @PutMapping("/api/v1/ar/settings/{kind}")
  @Operation(operationId = "saveArSetting", summary = "Créer ou modifier un paramètre AR (droit ar.settings)")
  public JsonNode saveSetting(@PathVariable String kind, @RequestBody Map<String, Object> body) {
    String t = settingTable(kind);
    Object id = body.get("id");
    if (id != null) return sql.update(t, UUID.fromString(String.valueOf(id)), body, settingColumns(kind));
    if (kind.equals("notification-rules")) return sql.insert(t, body, NOTIFICATION);
    return sql.upsert(t, body, settingColumns(kind), List.of("tenant_id", kind.equals("payment-terms") ? "code" : "level"));
  }

  @DeleteMapping("/api/v1/ar/settings/{kind}/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  @Operation(operationId = "deleteArSetting", summary = "Supprimer un paramètre AR")
  public void deleteSetting(@PathVariable String kind, @PathVariable UUID id) {
    sql.delete(settingTable(kind), id);
  }

  @GetMapping("/api/v1/ar/numbering")
  @Operation(operationId = "listArNumberingSeries", summary = "Séries de numérotation AR")
  public JsonNode numbering() {
    return sql.list("SELECT * FROM public.ar_numbering_series ORDER BY doc_type");
  }

  @PatchMapping("/api/v1/ar/numbering/{id}")
  @Operation(operationId = "updateArNumberingSeries", summary = "Modifier une série de numérotation AR")
  public JsonNode updateNumbering(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
    return sql.update("ar_numbering_series", id, body, Set.of("prefix", "format", "next_number", "reset_frequency"));
  }

  @GetMapping("/api/v1/ar/notification-log")
  @Operation(operationId = "listArNotificationLog", summary = "Journal des notifications AR")
  public JsonNode notificationLog(@RequestParam(defaultValue = "50") int limit) {
    return sql.list("SELECT * FROM public.ar_notification_log ORDER BY sent_at DESC LIMIT ?", Math.min(Math.max(limit, 1), 500));
  }

  @GetMapping("/api/v1/ar/general-settings")
  @Operation(operationId = "getArGeneralSettings", summary = "Paramètres généraux AR")
  public JsonNode general() {
    return sql.one("SELECT * FROM public.ar_general_settings WHERE tenant_id = public.get_user_tenant_id(auth.uid())");
  }

  @PutMapping("/api/v1/ar/general-settings")
  @Operation(operationId = "saveArGeneralSettings", summary = "Enregistrer les paramètres généraux AR (droit ar.settings)")
  public JsonNode saveGeneral(@RequestBody Map<String, Object> body) {
    Map<String, Object> b = new LinkedHashMap<>(body);
    b.put("updated_at", java.time.OffsetDateTime.now().toString());
    return sql.upsert("ar_general_settings", b, GENERAL, List.of("tenant_id"));
  }

  @GetMapping("/api/v1/period-locks")
  @Operation(operationId = "listPeriodLocks", summary = "Statuts des périodes par module (lecture)")
  public JsonNode periodLocks(@RequestParam(required = false) String module) {
    return sql.list("SELECT * FROM public.period_locks WHERE (?::text IS NULL OR module = ?::text) ORDER BY period DESC", module, module);
  }

  // ─── Brouillons, encaissements, balances ───

  @PostMapping("/api/v1/ar/drafts/{id}/emit")
  @Operation(operationId = "emitArDraft", summary = "Émettre une facture en brouillon (numéro définitif, comptabilisation)")
  public JsonNode emit(@PathVariable UUID id) {
    return sql.updateWhere("ar_invoices", Map.of("status", "sent"), Set.of("status"), "id = ?::uuid AND status = 'draft'", id.toString());
  }

  @DeleteMapping("/api/v1/ar/drafts/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  @Operation(operationId = "deleteArDraft", summary = "Supprimer une facture en brouillon")
  public void deleteDraft(@PathVariable UUID id) {
    sql.deleteWhere("ar_invoices", "id = ?::uuid AND status = 'draft'", id.toString());
  }

  @PatchMapping("/api/v1/ar/draft-lines/{id}/tax")
  @Operation(operationId = "setArDraftLineTax", summary = "Code TVA d'une ligne de facture en brouillon")
  public JsonNode lineTax(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
    return sql.update("ar_invoice_lines", id, Sql.args("tax_code_id", body.get("tax_code_id")), Set.of("tax_code_id"));
  }

  @GetMapping("/api/v1/ar/payments")
  @Operation(operationId = "listArPayments", summary = "Encaissements clients (filtre facultatif par facture)")
  public JsonNode payments(@RequestParam(required = false) UUID invoiceId) {
    String i = invoiceId == null ? null : invoiceId.toString();
    return sql.list("SELECT * FROM public.payments WHERE payment_type = 'ar_receipt' AND (?::uuid IS NULL OR ar_invoice_id = ?::uuid) ORDER BY payment_date DESC", i, i);
  }

  @GetMapping("/api/v1/ar/receipts")
  @Operation(operationId = "listArReceipts", summary = "Encaissements clients (1 000 derniers), avec la facture et le client")
  public JsonNode receipts() {
    return sql.list("SELECT p.id, p.payment_date, p.amount, p.payment_method, p.reference, p.reversal_of, p.reversal_reason, p.ar_invoice_id, p.created_at,"
        + " (SELECT to_jsonb(x) FROM (SELECT i.invoice_number, (SELECT to_jsonb(c) FROM (SELECT name FROM public.customers WHERE id = i.customer_id) c) AS customer"
        + " FROM public.ar_invoices i WHERE i.id = p.ar_invoice_id) x) AS invoice"
        + " FROM public.payments p WHERE p.payment_type = 'ar_receipt' ORDER BY p.payment_date DESC, p.created_at DESC LIMIT 1000");
  }

  @GetMapping("/api/v1/ar/aging")
  @Operation(operationId = "listArAging", summary = "Balance âgée clients")
  public JsonNode aging() {
    return sql.list("SELECT * FROM public.ar_aging_view ORDER BY days_overdue DESC");
  }

  @GetMapping("/api/v1/ar/credit-exposure")
  @Operation(operationId = "listArCreditExposure", summary = "Encours et limites de crédit par client")
  public JsonNode exposure() {
    return sql.list("SELECT * FROM public.ar_credit_exposure_view ORDER BY outstanding DESC");
  }

  // ─── Acomptes, crédits, lettrage, relevé ───

  @GetMapping("/api/v1/ar/customer-credits")
  @Operation(operationId = "listCustomerCredits", summary = "Acomptes et avoirs (avec le client), filtre facultatif par client")
  public JsonNode credits(@RequestParam(required = false) UUID customerId) {
    String c = customerId == null ? null : customerId.toString();
    ObjectNode out = JSON.createObjectNode();
    out.set("advances", sql.list("SELECT a.id, a.advance_number, a.customer_id, a.received_date, a.amount, a.amount_applied, a.amount_refunded, a.reference,"
        + " (SELECT to_jsonb(x) FROM (SELECT name FROM public.customers WHERE id = a.customer_id) x) AS customer FROM public.ar_customer_advances a"
        + " WHERE (?::uuid IS NULL OR a.customer_id = ?::uuid) ORDER BY a.received_date", c, c));
    out.set("creditNotes", sql.list("SELECT n.id, n.credit_note_number, n.customer_id, n.credit_date, n.total, n.amount_allocated, n.amount_refunded, n.reason,"
        + " (SELECT to_jsonb(x) FROM (SELECT name FROM public.customers WHERE id = n.customer_id) x) AS customer FROM public.ar_credit_notes n"
        + " WHERE (?::uuid IS NULL OR n.customer_id = ?::uuid) ORDER BY n.credit_date", c, c));
    return out;
  }

  @GetMapping("/api/v1/ar/letterings")
  @Operation(operationId = "listArLetterings", summary = "Codes de lettrage des factures soldées")
  public JsonNode letterings() {
    return sql.list("SELECT invoice_id, code, gl_lettered FROM public.ar_letterings");
  }

  @GetMapping("/api/v1/ar/customers/{id}/statement-sources")
  @Operation(operationId = "getCustomerStatementSources", summary = "Avoirs, acomptes et remboursements d'un client (relevé de compte)")
  public JsonNode statement(@PathVariable UUID id) {
    String c = id.toString();
    ObjectNode out = JSON.createObjectNode();
    out.set("creditNotes", sql.list("SELECT n.credit_note_number, n.credit_date, n.total, n.reason,"
        + " (SELECT to_jsonb(x) FROM (SELECT invoice_number FROM public.ar_invoices WHERE id = n.invoice_id) x) AS invoice FROM public.ar_credit_notes n WHERE n.customer_id = ?::uuid", c));
    out.set("advances", sql.list("SELECT advance_number, received_date, amount, reference FROM public.ar_customer_advances WHERE customer_id = ?::uuid", c));
    out.set("refunds", sql.list("SELECT refund_date, amount, reference, source_type FROM public.ar_customer_refunds WHERE customer_id = ?::uuid", c));
    return out;
  }

  // ─── Fiches clients : statut, suppression ───

  @PostMapping("/api/v1/customers/status")
  @Operation(operationId = "setCustomersStatus", summary = "Désactiver ou réactiver des fiches clients")
  @SuppressWarnings("unchecked")
  public JsonNode customersStatus(@RequestBody Map<String, Object> body) {
    List<String> ids = new ArrayList<>();
    for (Object o : (List<Object>) body.getOrDefault("ids", List.of())) ids.add(UUID.fromString(String.valueOf(o)).toString());
    if (ids.isEmpty()) throw new ApiRefusal(422, "Aucune fiche sélectionnée");
    return sql.updateWhere("customers", Sql.args("status", body.get("status")), Set.of("status"), "id = ANY (?::uuid[])", "{" + String.join(",", ids) + "}");
  }

  @GetMapping("/api/v1/customers/account-sets")
  @Operation(operationId = "listCustomerAccountSets", summary = "Jeu de comptes de chaque fiche client")
  public JsonNode customerSets() {
    return sql.list("SELECT id, account_set_id FROM public.customers");
  }

  @PatchMapping("/api/v1/customers/{id}/account-set")
  @Operation(operationId = "setCustomerAccountSet", summary = "Jeu de comptes d'une fiche client (vide = comptes par défaut ; refusé avec des pièces ouvertes)")
  public JsonNode customerSet(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
    return sql.update("customers", id, Sql.args("account_set_id", body.get("account_set_id")), Set.of("account_set_id"));
  }

  @DeleteMapping("/api/v1/customers/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  @Operation(operationId = "deleteCustomer", summary = "Supprimer une fiche client non citée (sinon la désactiver)")
  public void deleteCustomer(@PathVariable UUID id) {
    sql.delete("customers", id);
  }

  // ─── Identité de la société, modèles de rapports ───

  @GetMapping("/api/v1/company/identity")
  @Operation(operationId = "getCompanyIdentity", summary = "Identité légale de la société (en-tête des documents)")
  public JsonNode identity() {
    return sql.one("SELECT name, legal_name, address, phone, email, rccm, tax_id, tax_regime, tax_office, bank_details FROM public.tenants"
        + " WHERE id = public.get_user_tenant_id(auth.uid())");
  }

  @PutMapping("/api/v1/company/identity")
  @Operation(operationId = "saveCompanyIdentity", summary = "Enregistrer l'identité de la société (administrateur)")
  public JsonNode saveIdentity(@RequestBody Map<String, Object> body) {
    return sql.call("set_company_identity", Sql.args("_identity", body));
  }

  @GetMapping("/api/v1/report-templates")
  @Operation(operationId = "listReportTemplates", summary = "Modèles de rapports d'un module")
  public JsonNode templates(@RequestParam String module) {
    return sql.list("SELECT * FROM public.report_templates WHERE module = ? ORDER BY created_at DESC", module);
  }

  @PostMapping("/api/v1/report-templates")
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(operationId = "createReportTemplate", summary = "Enregistrer un modèle de rapport")
  public JsonNode createTemplate(@RequestBody Map<String, Object> body) {
    return sql.insert("report_templates", body, TEMPLATE, Map.of("created_by", "auth.uid()"));
  }

  @DeleteMapping("/api/v1/report-templates/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  @Operation(operationId = "deleteReportTemplate", summary = "Supprimer un modèle de rapport")
  public void deleteTemplate(@PathVariable UUID id) {
    sql.delete("report_templates", id);
  }

  // ─── Membres des rôles ───

  @GetMapping("/api/v1/role-members")
  @Operation(operationId = "listRoleMembers", summary = "Membres de la société détenant des rôles donnés (codes séparés par des virgules)")
  public JsonNode roleMembers(@RequestParam String codes) {
    return sql.list("SELECT a.user_id, r.code FROM public.user_role_assignments a JOIN public.erp_roles r ON r.id = a.role_id"
        + " WHERE a.tenant_id = public.get_user_tenant_id(auth.uid()) AND r.code = ANY (?::text[]) ORDER BY a.user_id", "{" + codes + "}");
  }
}
