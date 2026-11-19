package com.quoreich.qerp.modules.treasury;

import static com.quoreich.qerp.platform.Sql.args;

import com.quoreich.qerp.platform.ApiRefusal;
import com.quoreich.qerp.platform.Sql;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
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

/**
 * Trésorerie (lot 4) : comptes (V70, solde calculé), mouvements, virements internes, relevés et rapprochement
 * (V71), prévisions, clôture, limites et piste d'audit (V107). Les écritures passent par les fonctions de la
 * base ; la route d'action n'accepte que la liste ci-dessous.
 */
@RestController
@RequestMapping("/api/v1/treasury")
@Tag(name = "Trésorerie", description = "Comptes, mouvements, relevés, rapprochements, prévisions, clôture")
public class TreasuryController {

  static final Set<String> ACTIONS = Set.of("set_default_treasury_account", "record_treasury_movement", "transfer_between_treasury_accounts",
      "import_bank_statement", "auto_match_statement", "cancel_bank_statement", "post_statement_line", "prepare_bank_reconciliation",
      "validate_bank_reconciliation", "suggest_bank_matches", "close_treasury_period", "assign_treasury_role");
  static final Set<String> ACCOUNT = Set.of("name", "bank_name", "account_number", "currency", "account_type", "gl_account_id", "opening_balance",
      "opening_date", "is_active", "min_balance", "max_balance", "overdraft_limit");
  static final Set<String> FORECAST = Set.of("week_start", "bank_account_id", "category", "direction", "amount_forecast", "amount_actual", "source", "notes", "updated_at");
  static final Set<String> SETTINGS = Set.of("require_treasury_account", "pivot_currency", "match_amount_tolerance", "match_date_window_days",
      "unreconciled_alert_days", "low_cash_threshold", "auto_je_on_reconciliation", "statement_continuity_check", "updated_at");

  private final Sql sql;

  public TreasuryController(Sql sql) {
    this.sql = sql;
  }

  @PostMapping("/actions/{function}")
  @Operation(operationId = "runTreasuryAction", summary = "Opération de trésorerie (fonction de la liste autorisée, arguments nommés)")
  public JsonNode action(@PathVariable String function, @RequestBody(required = false) Map<String, Object> a) {
    if (!ACTIONS.contains(function)) throw new ApiRefusal(404, "Opération inconnue : " + function);
    return sql.call(function, a == null ? Map.of() : a);
  }

  // ─── Comptes et mouvements ───

  @GetMapping("/accounts")
  @Operation(operationId = "listTreasuryAccounts", summary = "Comptes de trésorerie (banque, caisse, mobile money)")
  public JsonNode accounts() {
    return sql.list("SELECT * FROM public.bank_accounts ORDER BY account_type, name");
  }

  @PostMapping("/accounts")
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(operationId = "createTreasuryAccount", summary = "Créer un compte de trésorerie (droit treasury.manage_accounts)")
  public JsonNode createAccount(@RequestBody Map<String, Object> body) {
    return sql.insert("bank_accounts", body, ACCOUNT);
  }

  @PatchMapping("/accounts/{id}")
  @Operation(operationId = "updateTreasuryAccount", summary = "Modifier un compte (compte général, devise et solde d'ouverture figés une fois utilisé)")
  public JsonNode updateAccount(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
    return sql.update("bank_accounts", id, body, ACCOUNT);
  }

  @GetMapping("/transactions")
  @Operation(operationId = "listTreasuryTransactions", summary = "Mouvements de trésorerie (filtre facultatif par compte), avec compte et pièce")
  public JsonNode transactions(@RequestParam(required = false) UUID accountId) {
    String a = accountId == null ? null : accountId.toString();
    return sql.list("SELECT t.*, (SELECT to_jsonb(x) FROM (SELECT name FROM public.bank_accounts WHERE id = t.bank_account_id) x) AS bank_account,"
        + " (SELECT to_jsonb(x) FROM (SELECT piece_number FROM public.journal_entries WHERE id = t.journal_entry_id) x) AS journal_entry"
        + " FROM public.bank_transactions t WHERE (?::uuid IS NULL OR t.bank_account_id = ?::uuid) ORDER BY t.transaction_date DESC, t.created_at DESC, t.id DESC", a, a);
  }

  @GetMapping("/settings")
  @Operation(operationId = "getTreasurySettings", summary = "Paramètres de trésorerie")
  public JsonNode settings() {
    return sql.one("SELECT * FROM public.treasury_settings WHERE tenant_id = public.get_user_tenant_id(auth.uid())");
  }

  @PutMapping("/settings")
  @Operation(operationId = "saveTreasurySettings", summary = "Enregistrer les paramètres de trésorerie (droit treasury.settings)")
  public JsonNode saveSettings(@RequestBody Map<String, Object> body) {
    Map<String, Object> b = new LinkedHashMap<>(body);
    b.put("updated_at", java.time.OffsetDateTime.now().toString());
    return sql.upsert("treasury_settings", b, SETTINGS, List.of("tenant_id"));
  }

  // ─── Vues ───

  @GetMapping("/views/{view}")
  @Operation(operationId = "readTreasuryView", summary = "Vues de trésorerie : position, statut de rapprochement, prévision 13 semaines, limites, historique de clôture")
  public JsonNode view(@PathVariable String view) {
    String sqlText = switch (view) {
      case "cash-position" -> "SELECT * FROM public.treasury_cash_position_view";
      case "reconciliation-status" -> "SELECT * FROM public.treasury_reconciliation_status_view";
      case "forecast-13w" -> "SELECT * FROM public.treasury_13w_forecast_view ORDER BY week_index";
      case "limits" -> "SELECT * FROM public.treasury_limit_status ORDER BY name";
      case "close-history" -> "SELECT id, period, status, total_balance, accounts_count, reconciliations_count, error_message, closed_by, closed_at, closed_by_name"
          + " FROM public.treasury_close_history_view ORDER BY period DESC";
      default -> throw new ApiRefusal(404, "Vue inconnue : " + view);
    };
    return sql.list(sqlText);
  }

  @GetMapping("/audit-trail")
  @Operation(operationId = "listTreasuryAuditTrail", summary = "Piste d'audit de trésorerie, avec le nom de l'auteur")
  public JsonNode audit() {
    return sql.list("SELECT a.*, coalesce((SELECT full_name FROM public.profiles WHERE id = a.actor_id), CASE WHEN a.actor_id IS NULL THEN 'Système' ELSE '—' END) AS actor"
        + " FROM public.treasury_audit_trail a ORDER BY a.occurred_at DESC");
  }

  @GetMapping("/role-audit")
  @Operation(operationId = "listTreasuryRoleAudit", summary = "Journal des rôles de trésorerie (filtre facultatif par action)")
  public JsonNode roleAudit(@RequestParam(required = false) String action) {
    return sql.list("SELECT * FROM public.treasury_role_audit WHERE (?::text IS NULL OR action = ?::text) ORDER BY created_at DESC LIMIT 500", action, action);
  }

  // ─── Relevés et rapprochements ───

  @GetMapping("/statements")
  @Operation(operationId = "listBankStatements", summary = "Relevés (filtres facultatifs : compte, statut)")
  public JsonNode statements(@RequestParam(required = false) UUID accountId, @RequestParam(required = false) String status) {
    String a = accountId == null ? null : accountId.toString();
    return sql.list("SELECT * FROM public.bank_statements WHERE (?::uuid IS NULL OR bank_account_id = ?::uuid) AND (?::text IS NULL OR status = ?::text)"
        + " ORDER BY period_end DESC NULLS LAST, statement_date DESC NULLS LAST", a, a, status, status);
  }

  @GetMapping("/statements/{id}/lines")
  @Operation(operationId = "listBankStatementLines", summary = "Lignes d'un relevé")
  public JsonNode lines(@PathVariable UUID id) {
    return sql.list("SELECT * FROM public.bank_statement_lines WHERE statement_id = ?::uuid ORDER BY line_date, line_no", id.toString());
  }

  @PatchMapping("/statement-lines/{id}/match")
  @Operation(operationId = "matchStatementLine", summary = "Rapprocher une ligne de relevé d'un mouvement (null = défaire)")
  public JsonNode match(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
    return sql.update("bank_statement_lines", id, args("matched_transaction_id", body.get("transaction_id")), Set.of("matched_transaction_id"));
  }

  @GetMapping("/reconciliations")
  @Operation(operationId = "listBankReconciliations", summary = "Rapprochements (filtre facultatif par compte)")
  public JsonNode reconciliations(@RequestParam(required = false) UUID accountId) {
    String a = accountId == null ? null : accountId.toString();
    return sql.list("SELECT * FROM public.bank_reconciliations WHERE (?::uuid IS NULL OR bank_account_id = ?::uuid) ORDER BY period_end DESC", a, a);
  }

  // ─── Prévisions ───

  @GetMapping("/forecasts")
  @Operation(operationId = "listCashflowForecasts", summary = "Prévisions de trésorerie par semaine")
  public JsonNode forecasts() {
    return sql.list("SELECT * FROM public.cashflow_forecasts ORDER BY week_start");
  }

  @PostMapping("/forecasts")
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(operationId = "createCashflowForecast", summary = "Ajouter une prévision")
  public JsonNode createForecast(@RequestBody Map<String, Object> body) {
    return sql.insert("cashflow_forecasts", body, FORECAST, Map.of("created_by", "auth.uid()"));
  }

  @PatchMapping("/forecasts/{id}")
  @Operation(operationId = "updateCashflowForecast", summary = "Modifier une prévision")
  public JsonNode updateForecast(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
    return sql.update("cashflow_forecasts", id, body, FORECAST);
  }
}
