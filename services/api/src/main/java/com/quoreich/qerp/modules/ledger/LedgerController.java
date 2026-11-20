package com.quoreich.qerp.modules.ledger;

import static com.quoreich.qerp.platform.Sql.args;

import com.quoreich.qerp.platform.Sql;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
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
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * Grand livre (lot 3) : plan de comptes, écritures, balance, grand livre détaillé, périodes, lots, piste
 * d'audit, contrôles (V106), journaux et compteurs de pièces, attributs de comptes (V62), états (V63).
 */
@RestController
@RequestMapping("/api/v1/gl")
@Tag(name = "Grand livre", description = "Plan de comptes, écritures, balance, périodes, contrôles et états")
public class LedgerController {

  static final Set<String> ACCOUNT = Set.of("code", "name", "account_type", "parent_id", "is_active", "is_header", "normal_balance", "posting_mode",
      "reconcilable", "analytic_policy", "default_tax_code_id", "currency_mode", "custom_attributes", "chart_id");
  static final Set<String> CONTROL_SETTINGS = Set.of("large_entry_threshold", "duplicate_window_days", "backdating_days", "subledger_tolerance",
      "disabled_checks", "updated_at");
  static final Set<String> ATTRIBUTE = Set.of("key", "label", "data_type", "options", "required", "is_active", "sort_order");
  private static final ObjectMapper JSON = new ObjectMapper();

  private final Sql sql;
  private final JournalEntries entries;

  public LedgerController(Sql sql, JournalEntries entries) {
    this.sql = sql;
    this.entries = entries;
  }

  // ─── Plan de comptes ───

  @GetMapping("/accounts")
  @Operation(operationId = "listGlAccounts", summary = "Plan de comptes (activeOnly pour les comptes imputables)")
  public JsonNode accounts(@RequestParam(defaultValue = "false") boolean activeOnly) {
    return activeOnly ? sql.list("SELECT id, code, name, account_type, is_active FROM public.gl_accounts WHERE is_active ORDER BY code")
        : sql.list("SELECT * FROM public.gl_accounts ORDER BY code");
  }

  @PostMapping("/accounts")
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(operationId = "createGlAccount", summary = "Créer un compte (droit accounting.chart ; contrôles du référentiel)")
  public JsonNode createAccount(@RequestBody Map<String, Object> body) {
    return sql.insert("gl_accounts", body, ACCOUNT);
  }

  @PatchMapping("/accounts/{id}")
  @Operation(operationId = "updateGlAccount", summary = "Modifier un compte (code et type figés une fois utilisé)")
  public JsonNode updateAccount(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
    return sql.update("gl_accounts", id, body, ACCOUNT);
  }

  @GetMapping("/accounts/{id}/history")
  @Operation(operationId = "listGlAccountHistory", summary = "Historique des modifications d'un compte")
  public JsonNode accountHistory(@PathVariable UUID id) {
    return sql.list("SELECT * FROM public.gl_account_history WHERE account_id = ?::uuid ORDER BY id DESC LIMIT 30", id.toString());
  }

  @GetMapping("/account-balances")
  @Operation(operationId = "listGlAccountBalances", summary = "Totaux débit / crédit par compte (écritures comptabilisées)")
  public JsonNode balances() {
    return sql.list("SELECT l.account_id, sum(l.debit) AS debit, sum(l.credit) AS credit FROM public.journal_lines l"
        + " JOIN public.journal_entries e ON e.id = l.entry_id WHERE e.status = 'posted' GROUP BY l.account_id");
  }

  @GetMapping("/attribute-definitions")
  @Operation(operationId = "listGlAttributeDefinitions", summary = "Attributs personnalisés des comptes")
  public JsonNode attributes() {
    return sql.list("SELECT * FROM public.gl_account_attribute_definitions ORDER BY sort_order, label");
  }

  @PutMapping("/attribute-definitions")
  @Operation(operationId = "saveGlAttributeDefinition", summary = "Créer ou modifier un attribut (par clé ; droit accounting.chart_admin)")
  public JsonNode saveAttribute(@RequestBody Map<String, Object> body) {
    return sql.upsert("gl_account_attribute_definitions", body, ATTRIBUTE, List.of("tenant_id", "key"));
  }

  // ─── Écritures ───

  @GetMapping("/journal-entries")
  @Operation(operationId = "listJournalEntries", summary = "Écritures avec leurs lignes et comptes")
  public JsonNode journalEntries() {
    return sql.list("SELECT e.*, coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT l.*, (SELECT to_jsonb(a) FROM (SELECT id, code, name FROM public.gl_accounts"
        + " WHERE id = l.account_id) a) AS account FROM public.journal_lines l WHERE l.entry_id = e.id) x), '[]'::jsonb) AS lines"
        + " FROM public.journal_entries e ORDER BY e.entry_date DESC");
  }

  @PostMapping("/journal-entries")
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(operationId = "createJournalEntry", summary = "Écriture manuelle : brouillon, lignes, sections, comptabilisation, en une transaction")
  public JsonNode createEntry(@RequestBody Map<String, Object> body) {
    return entries.create(body);
  }

  @GetMapping("/journal-entries/{id}")
  @Operation(operationId = "getJournalEntry", summary = "Une écriture avec ses lignes (aperçu depuis une pièce)")
  public JsonNode entry(@PathVariable UUID id) {
    return sql.one("SELECT e.entry_number, e.entry_date, e.status, e.piece_number, e.journal_code, coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT l.debit, l.credit, l.description,"
        + " (SELECT to_jsonb(a) FROM (SELECT code, name FROM public.gl_accounts WHERE id = l.account_id) a) AS account FROM public.journal_lines l WHERE l.entry_id = e.id) x), '[]'::jsonb) AS lines"
        + " FROM public.journal_entries e WHERE e.id = ?::uuid", id.toString());
  }

  @GetMapping("/transactions")
  @Operation(operationId = "listGlTransactions", summary = "Écritures du grand livre avec lot, journal, pièce et lignes (toutes)")
  public JsonNode transactions() {
    return sql.list("SELECT e.id, e.entry_number, e.piece_number, e.journal_code, e.entry_date, e.description, e.source, e.status,"
        + " (SELECT to_jsonb(b) FROM (SELECT batch_number FROM public.journal_batches WHERE id = e.batch_id) b) AS batch,"
        + " coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT l.debit, l.credit, l.description, (SELECT to_jsonb(a) FROM (SELECT code, name FROM public.gl_accounts"
        + " WHERE id = l.account_id) a) AS account FROM public.journal_lines l WHERE l.entry_id = e.id) x), '[]'::jsonb) AS lines"
        + " FROM public.journal_entries e ORDER BY e.entry_date DESC, e.piece_number DESC");
  }

  @PostMapping("/journal-entries/{id}/reverse")
  @Operation(operationId = "reverseJournalEntry", summary = "Contre-passer une écriture comptabilisée (motif)")
  public JsonNode reverse(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
    return sql.call("reverse_journal_entry", args("_entry_id", id, "_reverse_date", body.getOrDefault("reverse_date", java.time.LocalDate.now().toString()),
        "_reason", body.getOrDefault("reason", "Contre-passation")));
  }

  @GetMapping("/journal-entries/count")
  @Operation(operationId = "countPostedJournalEntries", summary = "Nombre d'écritures comptabilisées ou contre-passées dans une plage (historique disponible)")
  public long count(@RequestParam(required = false) String from, @RequestParam String to) {
    return sql.value(Long.class, "SELECT count(*) FROM public.journal_entries WHERE status IN ('posted', 'reversed') AND (?::date IS NULL OR entry_date >= ?::date)"
        + " AND entry_date <= ?::date", from, from, to);
  }

  // ─── Balance, grand livre, périodes, états ───

  @GetMapping("/trial-balance")
  @Operation(operationId = "listTrialBalance", summary = "Balance générale")
  public JsonNode trialBalance() {
    return sql.list("SELECT * FROM public.gl_trial_balance ORDER BY code");
  }

  @GetMapping("/ledger")
  @Operation(operationId = "listLedgerDetail", summary = "Grand livre détaillé (filtre facultatif par compte)")
  public JsonNode ledger(@RequestParam(required = false) UUID accountId) {
    String a = accountId == null ? null : accountId.toString();
    return sql.list("SELECT * FROM public.gl_ledger_detail WHERE (?::uuid IS NULL OR account_id = ?::uuid) ORDER BY entry_date, entry_number", a, a);
  }

  @GetMapping("/periods")
  @Operation(operationId = "listGlPeriods", summary = "Périodes du grand livre et leurs totaux")
  public JsonNode periods() {
    return sql.list("SELECT * FROM public.gl_periods_view ORDER BY period DESC");
  }

  @PostMapping("/periods/{period}/close")
  @Operation(operationId = "closeGlPeriod", summary = "Clôturer une période du grand livre (sous-livres d'abord)")
  public JsonNode closePeriod(@PathVariable String period) {
    return sql.call("close_gl_period", args("_period", period));
  }

  @PostMapping("/periods/{period}/reopen")
  @Operation(operationId = "reopenGlPeriod", summary = "Rouvrir une période (motif ; calendrier fiscal central)")
  public JsonNode reopenPeriod(@PathVariable String period, @RequestBody Map<String, Object> body) {
    return sql.call("set_period_status", args("_period", period, "_module", "GL", "_status", "open", "_reason", body.get("reason")));
  }

  @GetMapping("/sig")
  @Operation(operationId = "listGlSig", summary = "Soldes intermédiaires de gestion par période")
  public JsonNode sig(@RequestParam(required = false) String from, @RequestParam(required = false) String to) {
    return sql.list("SELECT * FROM public.gl_sig_view WHERE (?::text IS NULL OR period >= ?::text) AND (?::text IS NULL OR period <= ?::text) ORDER BY period",
        from, from, to, to);
  }

  @GetMapping("/financial-statement")
  @Operation(operationId = "getFinancialStatement", summary = "État par rubriques (CR / bilan SYSCOHADA) sur une plage")
  public JsonNode statement(@RequestParam String layout, @RequestParam(required = false) String from, @RequestParam String to) {
    return sql.call("financial_statement", args("_layout", layout, "_from", from, "_to", to));
  }

  @GetMapping("/cash-flow-details")
  @Operation(operationId = "listCashFlowDetails", summary = "Détail du tableau des flux : mouvements sans effet de trésorerie ou non classés, par compte et par sens (V122)")
  public JsonNode cashFlowDetails(@RequestParam String layout, @RequestParam String from, @RequestParam String to) {
    return sql.list("SELECT * FROM public.cash_flow_details(?, ?::date, ?::date) WHERE line_code IN ('ZN', 'ZU')", layout, from, to);
  }

  @GetMapping("/company")
  @Operation(operationId = "getGlCompany", summary = "Devise et début d'exercice de la société")
  public JsonNode company() {
    return sql.one("SELECT currency, fiscal_year_start FROM public.tenants WHERE id = public.get_user_tenant_id(auth.uid())");
  }

  // ─── Lots, journaux, audit ───

  @GetMapping("/batches")
  @Operation(operationId = "listGlBatches", summary = "Lots du grand livre (filtre facultatif par journaux)")
  public JsonNode batches(@RequestParam(required = false) String journals) {
    String j = journals == null || journals.isBlank() ? null : "{" + String.join(",", Arrays.stream(journals.split(",")).map(String::trim).toList()) + "}";
    return sql.list("SELECT * FROM public.journal_batch_summary WHERE (?::text[] IS NULL OR journal_code = ANY (?::text[])) ORDER BY period DESC", j, j);
  }

  @GetMapping("/journals")
  @Operation(operationId = "listAccountingJournals", summary = "Journaux et compteurs de pièces de la société")
  public JsonNode journals() {
    ObjectNode out = JSON.createObjectNode();
    out.set("journals", sql.list("SELECT code, label, sort_order FROM public.accounting_journals ORDER BY sort_order"));
    out.set("counters", sql.list("SELECT journal_code, year, last_value FROM public.journal_piece_counters ORDER BY year DESC"));
    return out;
  }

  @GetMapping("/audit-logs")
  @Operation(operationId = "listGlAuditLogs", summary = "Piste d'audit (200 dernières ; filtre lot, ou plage de dates)")
  public JsonNode auditLogs(@RequestParam(required = false) String batch, @RequestParam(required = false) String from, @RequestParam(required = false) String to) {
    if (from != null && to != null) {
      return sql.list("SELECT g.id, g.created_at, g.action, g.user_name, g.details, g.entry_id,"
          + " (SELECT to_jsonb(x) FROM (SELECT piece_number FROM public.journal_entries WHERE id = g.entry_id) x) AS entry"
          + " FROM public.gl_audit_logs g WHERE g.created_at >= ?::date AND g.created_at < ?::date + 1 ORDER BY g.created_at DESC", from, to);
    }
    return sql.list("SELECT id, batch_id, entry_id, action, user_name, details, hash, prev_hash, created_at FROM public.gl_audit_logs"
        + " WHERE (?::text IS NULL OR batch_id = ?::text) ORDER BY created_at DESC LIMIT 200", batch, batch);
  }

  // ─── Contrôles (V106) ───

  @GetMapping("/controls/findings")
  @Operation(operationId = "listGlControlFindings", summary = "Anomalies d'écritures sur une plage")
  public JsonNode findings(@RequestParam String from, @RequestParam String to) {
    return sql.call("gl_control_findings", args("_from", from, "_to", to));
  }

  @GetMapping("/controls/integrity")
  @Operation(operationId = "listGlIntegrityChecks", summary = "Contrôles d'intégrité du grand livre")
  public JsonNode integrity() {
    return sql.call("gl_integrity_checks");
  }

  @GetMapping("/controls/reconciliation")
  @Operation(operationId = "listGlSubledgerReconciliation", summary = "Rapprochement grand livre / auxiliaires à une date")
  public JsonNode reconciliation(@RequestParam String asOf) {
    return sql.call("gl_subledger_reconciliation", args("_as_of", asOf));
  }

  @GetMapping("/controls/settings")
  @Operation(operationId = "getGlControlSettings", summary = "Paramètres des contrôles du grand livre")
  public JsonNode controlSettings() {
    return sql.one("SELECT * FROM public.gl_control_settings WHERE tenant_id = public.get_user_tenant_id(auth.uid())");
  }

  @PutMapping("/controls/settings")
  @Operation(operationId = "saveGlControlSettings", summary = "Enregistrer les paramètres des contrôles (droit accounting.controls)")
  public JsonNode saveControlSettings(@RequestBody Map<String, Object> body) {
    Map<String, Object> b = new LinkedHashMap<>(body);
    b.put("updated_at", java.time.OffsetDateTime.now().toString());
    return sql.upsertWith("gl_control_settings", b, CONTROL_SETTINGS, List.of("tenant_id"), Map.of("updated_by", "auth.uid()"));
  }

  @PostMapping("/controls/reviews")
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(operationId = "createGlControlReview", summary = "Revue d'une anomalie (tracée)")
  public JsonNode review(@RequestBody Map<String, Object> body) {
    return sql.insert("gl_control_reviews", body, Set.of("check_code", "entry_id", "comment"), Map.of("reviewed_by", "auth.uid()"));
  }
}
