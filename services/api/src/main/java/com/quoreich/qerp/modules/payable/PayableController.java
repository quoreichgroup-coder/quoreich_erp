package com.quoreich.qerp.modules.payable;

import static com.quoreich.qerp.platform.Sql.args;

import com.quoreich.qerp.platform.Sql;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
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
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

/**
 * Fournisseurs et factures fournisseurs (lot 3) : mêmes lectures et mêmes écritures que le chemin
 * Supabase, sous la RLS de la société courante ; cycle de vie par les fonctions de la base (V41, V56).
 */
@RestController
@RequestMapping("/api/v1/ap")
@Tag(name = "Comptes fournisseurs", description = "Fournisseurs, factures fournisseurs, paiements et paramètres AP")
public class PayableController {

  static final Set<String> SUPPLIER = Set.of("name", "email", "phone", "address", "tax_id", "payment_terms", "status", "legal_name", "rccm",
      "tax_regime", "category", "contact_name", "city", "country", "currency", "default_incoterm", "lead_time_days", "bank_name", "bank_account",
      "bank_swift", "notes", "account_set_id", "withholding_rate_id");
  static final Set<String> INVOICE = Set.of("invoice_number", "supplier_id", "invoice_date", "due_date", "subtotal", "tax_amount", "total", "po_id",
      "control_total", "currency", "exchange_rate", "fx_subtotal", "fx_tax_amount", "withholding_rate_id");
  static final Set<String> PAYMENT = Set.of("ap_invoice_id", "amount", "payment_date", "payment_method", "reference", "bank_account_id");
  static final Set<String> GENERAL = Set.of("default_currency", "default_payment_method", "po_required", "three_way_match",
      "early_payment_discount_pct", "discount_window_days");
  static final Set<String> SERIES = Set.of("prefix", "format", "next_number", "reset_frequency");
  static final Set<String> METHOD = Set.of("code", "label", "is_default", "is_active");
  static final Set<String> WITHHOLDING = Set.of("category", "rate_pct", "gl_account", "is_active", "base");

  private final Sql sql;
  private final PayableInvoices invoices;

  public PayableController(Sql sql, PayableInvoices invoices) {
    this.sql = sql;
    this.invoices = invoices;
  }

  // ─── Fournisseurs ───

  @GetMapping("/suppliers")
  @Operation(operationId = "listSuppliers", summary = "Fournisseurs de la société courante")
  public JsonNode suppliers() {
    return sql.list("SELECT * FROM public.suppliers ORDER BY name");
  }

  @PostMapping("/suppliers")
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(operationId = "createSupplier", summary = "Créer un fournisseur (droit suppliers.manage)")
  public JsonNode createSupplier(@RequestBody Map<String, Object> body) {
    return sql.insert("suppliers", body, SUPPLIER);
  }

  @PatchMapping("/suppliers/{id}")
  @Operation(operationId = "updateSupplier", summary = "Modifier un fournisseur ; un changement bancaire repasse en « à valider »")
  public JsonNode updateSupplier(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
    return sql.update("suppliers", id, body, SUPPLIER);
  }

  @DeleteMapping("/suppliers/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  @Operation(operationId = "deleteSupplier", summary = "Supprimer un fournisseur non cité (droit suppliers.delete)")
  public void deleteSupplier(@PathVariable UUID id) {
    sql.delete("suppliers", id);
  }

  @PostMapping("/suppliers/{id}/verify-bank")
  @Operation(operationId = "verifySupplierBank", summary = "Valider les coordonnées bancaires (une autre personne que leur auteur)")
  public JsonNode verifyBank(@PathVariable UUID id) {
    return sql.call("verify_supplier_bank_details", args("_supplier_id", id));
  }

  @GetMapping("/suppliers/{id}/change-log")
  @Operation(operationId = "listSupplierChangeLog", summary = "Journal des changements sensibles d'une fiche fournisseur")
  public JsonNode changeLog(@PathVariable UUID id) {
    return sql.list("SELECT * FROM public.supplier_change_log WHERE supplier_id = ?::uuid ORDER BY id DESC LIMIT 50", id.toString());
  }

  // ─── Factures ───

  @GetMapping("/invoices")
  @Operation(operationId = "listApInvoices", summary = "Factures fournisseurs, avec le fournisseur")
  public JsonNode invoices() {
    return sql.list("SELECT i.*, (SELECT to_jsonb(s) FROM (SELECT id, name, payment_terms, legal_name, address, city, country, tax_id, rccm"
        + " FROM public.suppliers WHERE id = i.supplier_id) s) AS supplier FROM public.ap_invoices i ORDER BY i.created_at DESC");
  }

  @PostMapping("/invoices")
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(operationId = "createApInvoice", summary = "Créer une facture fournisseur en brouillon")
  public JsonNode createInvoice(@RequestBody Map<String, Object> body) {
    return sql.insert("ap_invoices", body, INVOICE, Map.of("created_by", "auth.uid()", "status", "'draft'", "approval_status", "'draft'",
        "amount_paid", "0"));
  }

  @PatchMapping("/invoices/{id}")
  @Operation(operationId = "updateApInvoice", summary = "Modifier une facture en brouillon ou rejetée")
  public JsonNode updateInvoice(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
    return sql.update("ap_invoices", id, body, INVOICE);
  }

  @DeleteMapping("/invoices/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  @Operation(operationId = "deleteApInvoice", summary = "Supprimer une facture en brouillon ou rejetée")
  public void deleteInvoice(@PathVariable UUID id) {
    sql.delete("ap_invoices", id);
  }

  @PostMapping("/invoices/{id}/submit")
  @Operation(operationId = "submitApInvoice", summary = "Soumettre une facture (contrôles des paramètres, file d'approbation)")
  public JsonNode submit(@PathVariable UUID id) {
    return sql.call("ap_invoice_submit", args("_id", id));
  }

  @GetMapping("/invoice-approvals")
  @Operation(operationId = "listApInvoiceApprovals", summary = "Files d'approbation des factures fournisseurs")
  public JsonNode approvals() {
    return sql.list("SELECT * FROM public.ap_invoice_approvals ORDER BY level_order");
  }

  @PostMapping("/invoice-approvals/{id}/decision")
  @Operation(operationId = "decideApInvoice", summary = "Approuver ou rejeter un niveau (jamais l'auteur, motif pour rejeter)")
  public JsonNode decide(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
    return sql.call("ap_invoice_decide", args("_approval_id", id, "_approve", body.get("approve"), "_comment", body.get("comment")));
  }

  @PostMapping("/invoices/with-lines")
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(operationId = "createApInvoiceWithLines", summary = "Créer une facture à lignes (en-tête, lignes, sections) en une transaction")
  public JsonNode createWithLines(@RequestBody Map<String, Object> body) {
    return sql.one("SELECT id FROM public.ap_invoices WHERE id = ?::uuid", invoices.save(null, body).toString());
  }

  @PutMapping("/invoices/{id}/with-lines")
  @Operation(operationId = "updateApInvoiceWithLines", summary = "Remplacer l'en-tête et les lignes d'une facture modifiable")
  public JsonNode updateWithLines(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
    return sql.one("SELECT id FROM public.ap_invoices WHERE id = ?::uuid", invoices.save(id, body).toString());
  }

  @GetMapping("/invoices/{id}/lines")
  @Operation(operationId = "listApInvoiceLines", summary = "Lignes d'une facture fournisseur")
  public JsonNode lines(@PathVariable UUID id) {
    return sql.list("SELECT * FROM public.ap_invoice_lines WHERE invoice_id = ?::uuid ORDER BY line_no", id.toString());
  }

  @GetMapping("/purchase-orders/{po}/lines-to-invoice")
  @Operation(operationId = "listApPoLinesToInvoice", summary = "Lignes reçues non facturées d'une commande")
  public JsonNode poLinesToInvoice(@PathVariable UUID po, @RequestParam(required = false) UUID except) {
    return sql.call("ap_po_lines_to_invoice", args("_po", po, "_except", except));
  }

  @GetMapping("/supplier-advances")
  @Operation(operationId = "listSupplierAdvances", summary = "Avances versées aux fournisseurs : versé, imputé, disponible (V127)")
  public JsonNode supplierAdvances() {
    return sql.list("SELECT a.*, s.name AS supplier_name, a.amount - a.amount_applied AS available FROM public.ap_supplier_advances a"
        + " JOIN public.suppliers s ON s.id = a.supplier_id ORDER BY a.paid_date DESC, a.advance_number DESC");
  }

  @PostMapping("/supplier-advances")
  @Operation(operationId = "recordSupplierAdvance", summary = "Verser une avance à un fournisseur (droit ap.pay)")
  public JsonNode recordSupplierAdvance(@RequestBody Map<String, Object> b) {
    return sql.call("record_supplier_advance", args("_supplier_id", b.get("supplier_id"), "_paid_date", b.get("paid_date"),
        "_payment_method", b.get("payment_method"), "_reference", b.get("reference"), "_amount", b.get("amount"), "_po_id", b.get("po_id"),
        "_bank_account_id", b.get("bank_account_id"), "_currency", b.get("currency"), "_fx_amount", b.get("fx_amount"),
        "_exchange_rate", b.get("exchange_rate")));
  }

  @PostMapping("/supplier-advances/{id}/applications")
  @Operation(operationId = "applySupplierAdvance", summary = "Imputer une avance sur une facture du même fournisseur (droit ap.pay)")
  public JsonNode applySupplierAdvance(@PathVariable UUID id, @RequestBody Map<String, Object> b) {
    return sql.call("apply_supplier_advance", args("_invoice_id", b.get("invoice_id"), "_advance_id", id, "_amount", b.get("amount"),
        "_apply_date", b.getOrDefault("apply_date", java.time.LocalDate.now().toString())));
  }

  @GetMapping("/payments")
  @Operation(operationId = "listApPayments", summary = "Paiements fournisseurs (avec la facture et le fournisseur)")
  public JsonNode payments() {
    return sql.list("SELECT p.id, p.payment_date, p.amount, p.payment_method, p.reference, p.reversal_of, p.reversal_reason, p.ap_invoice_id, p.created_at,"
        + " (SELECT to_jsonb(x) FROM (SELECT i.invoice_number, (SELECT to_jsonb(s) FROM (SELECT name FROM public.suppliers WHERE id = i.supplier_id) s) AS supplier"
        + " FROM public.ap_invoices i WHERE i.id = p.ap_invoice_id) x) AS invoice"
        + " FROM public.payments p WHERE p.payment_type = 'ap_payment' ORDER BY p.payment_date DESC, p.created_at DESC LIMIT 1000");
  }

  @PostMapping("/payments/{id}/reversal")
  @Operation(operationId = "reverseApPayment", summary = "Annuler un paiement par contre-passation motivée (droit ap.reverse_payment)")
  public JsonNode reverse(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
    return sql.call("reverse_settlement", args("_payment_id", id, "_reason", body.get("reason"), "_reversal_date",
        body.getOrDefault("reversal_date", java.time.LocalDate.now().toString())));
  }

  @PostMapping("/settlements")
  @Operation(operationId = "recordApSettlement", summary = "Règlement d'un fournisseur réparti sur ses factures (une transaction)")
  public JsonNode settle(@RequestBody Map<String, Object> body) {
    java.util.Map<String, Object> a = args("_kind", "ap", "_party_id", body.get("party_id"), "_payment_date", body.get("payment_date"),
        "_payment_method", body.get("payment_method"), "_reference", body.get("reference"), "_allocations", body.get("allocations"));
    if (body.get("bank_account_id") != null) a.put("_bank_account_id", body.get("bank_account_id"));
    if (body.get("exchange_rate") != null) a.put("_exchange_rate", body.get("exchange_rate"));
    return sql.call("record_settlement", a);
  }

  @GetMapping("/pending-approvals")
  @Operation(operationId = "listApPendingApprovals", summary = "Niveaux d'approbation en attente, avec la facture et le délai cible")
  public JsonNode pendingApprovals() {
    return sql.list("SELECT a.id, a.invoice_id, a.level_order, a.level_label, a.approver_label, a.amount, a.created_at, a.status,"
        + " (SELECT to_jsonb(x) FROM (SELECT i.invoice_number, i.approval_status, (SELECT to_jsonb(s) FROM (SELECT name FROM public.suppliers WHERE id = i.supplier_id) s) AS supplier"
        + " FROM public.ap_invoices i WHERE i.id = a.invoice_id) x) AS invoice,"
        + " (SELECT t.sla_hours FROM public.ap_approval_thresholds t WHERE t.level = a.level_label LIMIT 1) AS sla_hours"
        + " FROM public.ap_invoice_approvals a WHERE a.status = 'pending' ORDER BY a.level_order");
  }

  @PostMapping("/payments")
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(operationId = "recordApPayment", summary = "Enregistrer un paiement fournisseur (droit ap.pay ; comptabilisé par la base)")
  public JsonNode pay(@RequestBody Map<String, Object> body) {
    return sql.insert("payments", body, PAYMENT, Map.of("payment_type", "'ap_payment'", "created_by", "auth.uid()"));
  }

  @GetMapping("/aging")
  @Operation(operationId = "listApAging", summary = "Balance âgée fournisseurs")
  public JsonNode aging() {
    return sql.list("SELECT * FROM public.ap_aging_view ORDER BY days_overdue DESC");
  }

  @GetMapping("/audit-trail")
  @Operation(operationId = "listApAuditTrail", summary = "Piste d'audit des lots AP")
  public JsonNode auditTrail(@RequestParam(defaultValue = "100") int limit) {
    return sql.list("SELECT * FROM public.gl_audit_logs WHERE batch_id ILIKE 'AP%' ORDER BY created_at DESC LIMIT ?", Math.min(Math.max(limit, 1), 1000));
  }

  // ─── Paramètres ───

  private void seed() {
    sql.call("seed_ap_defaults", args("_tenant_id", sql.value(String.class, "SELECT public.get_user_tenant_id(auth.uid())::text")));
  }

  @GetMapping("/settings/general")
  @Operation(operationId = "getApGeneralSettings", summary = "Paramètres généraux AP (créés par défaut si absents)")
  public JsonNode general() {
    seed();
    return sql.one("SELECT * FROM public.ap_general_settings WHERE tenant_id = public.get_user_tenant_id(auth.uid())");
  }

  @PutMapping("/settings/general")
  @Operation(operationId = "saveApGeneralSettings", summary = "Modifier les paramètres généraux AP (droit ap.settings)")
  public JsonNode saveGeneral(@RequestBody Map<String, Object> body) {
    Map<String, Object> b = new java.util.LinkedHashMap<>(body);
    b.put("updated_at", java.time.OffsetDateTime.now().toString());
    return sql.updateWhere("ap_general_settings", b, union(GENERAL, "updated_at"), "tenant_id = public.get_user_tenant_id(auth.uid())");
  }

  @GetMapping("/settings/numbering")
  @Operation(operationId = "listApNumberingSeries", summary = "Séries de numérotation AP")
  public JsonNode numbering() {
    seed();
    return sql.list("SELECT * FROM public.ap_numbering_series ORDER BY doc_type");
  }

  @PatchMapping("/settings/numbering/{id}")
  @Operation(operationId = "updateApNumberingSeries", summary = "Modifier une série de numérotation AP")
  public JsonNode updateNumbering(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
    return sql.update("ap_numbering_series", id, body, SERIES);
  }

  @GetMapping("/settings/payment-methods")
  @Operation(operationId = "listApPaymentMethods", summary = "Modes de paiement AP")
  public JsonNode methods() {
    seed();
    return sql.list("SELECT * FROM public.ap_payment_methods ORDER BY code");
  }

  @PutMapping("/settings/payment-methods")
  @Operation(operationId = "saveApPaymentMethod", summary = "Créer ou modifier un mode de paiement (par code)")
  public JsonNode saveMethod(@RequestBody Map<String, Object> body) {
    return sql.upsert("ap_payment_methods", body, METHOD, List.of("tenant_id", "code"));
  }

  @GetMapping("/withholding-statement")
  @Operation(operationId = "withholdingStatement", summary = "État des retenues à la source prélevées sur une période (déclaration)")
  public JsonNode withholdingStatement(@RequestParam String from, @RequestParam String to) {
    return sql.list("SELECT * FROM public.withholding_statement(?::date, ?::date)", from, to);
  }

  @GetMapping("/settings/withholding-rates")
  @Operation(operationId = "listApWithholdingRates", summary = "Taux de retenue à la source")
  public JsonNode withholding() {
    seed();
    return sql.list("SELECT * FROM public.ap_withholding_rates ORDER BY category");
  }

  @PostMapping("/settings/withholding-rates")
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(operationId = "createApWithholdingRate", summary = "Créer un taux de retenue")
  public JsonNode createWithholding(@RequestBody Map<String, Object> body) {
    return sql.insert("ap_withholding_rates", body, WITHHOLDING);
  }

  @PatchMapping("/settings/withholding-rates/{id}")
  @Operation(operationId = "updateApWithholdingRate", summary = "Modifier un taux de retenue")
  public JsonNode updateWithholding(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
    return sql.update("ap_withholding_rates", id, body, WITHHOLDING);
  }

  @GetMapping("/settings/notification-rules")
  @Operation(operationId = "listApNotificationRules", summary = "Règles de notification AP")
  public JsonNode notificationRules() {
    seed();
    return sql.list("SELECT * FROM public.ap_notification_rules ORDER BY created_at");
  }

  @GetMapping("/settings/approval-thresholds")
  @Operation(operationId = "listApApprovalThresholds", summary = "Seuils d'approbation AP")
  public JsonNode thresholds() {
    seed();
    return sql.list("SELECT * FROM public.ap_approval_thresholds ORDER BY sla_hours");
  }

  static Set<String> union(Set<String> a, String... more) {
    java.util.HashSet<String> s = new java.util.HashSet<>(a);
    s.addAll(List.of(more));
    return s;
  }
}
