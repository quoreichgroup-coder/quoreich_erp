package com.quoreich.qerp.modules.budget;

import com.quoreich.qerp.platform.ApiRefusal;
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
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
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
 * Budget (V73–V79) : budgets et lignes, cycle d'approbation, révisions, contrôle (engagé, pré-engagé, réalisé),
 * scénarios, prévisions versionnées, paramètres. Les opérations de cycle passent par les fonctions de la base.
 */
@RestController
@RequestMapping("/api/v1/budget")
@Tag(name = "Budget", description = "Budgets, contrôle budgétaire, révisions, scénarios et prévisions")
public class BudgetController {

  static final Set<String> ACTIONS = Set.of("budget_submit", "budget_approve", "budget_reject", "budget_close", "budget_revise_line",
      "budget_revision_decide", "import_budget_lines", "budget_override_document", "import_budget_forecast_lines", "budget_forecast_publish",
      "assign_budget_role", "budget_status", "budget_prior_year_monthly", "budget_monthly_actual");
  static final Set<String> SETTINGS = Set.of("control_mode", "control_level", "precommit_requisitions", "control_requisitions", "analytic_control",
      "alert_threshold_pct", "revision_second_person", "revision_threshold_pct", "forecast_method", "annual_spread", "budgetable_types", "updated_at");
  static final Set<String> BUDGET = Set.of("name", "fiscal_year", "scenario");
  static final Set<String> LINE = Set.of("budget_id", "gl_account_id", "period", "planned_amount", "analytic_value_id");
  static final Set<String> SCENARIO = Set.of("code", "name", "description", "is_active", "sort_order");
  static final Set<String> FORECAST_LINE = Set.of("forecast_id", "gl_account_id", "analytic_value_id", "amount", "comment");

  private final Sql sql;
  private final Forecasts forecasts;

  public BudgetController(Sql sql, Forecasts forecasts) {
    this.sql = sql;
    this.forecasts = forecasts;
  }

  @PostMapping("/actions/{function}")
  @Operation(operationId = "runBudgetAction", summary = "Opération budgétaire (fonction de la liste autorisée, arguments nommés)")
  public JsonNode action(@PathVariable String function, @RequestBody(required = false) Map<String, Object> a) {
    if (!ACTIONS.contains(function)) throw new ApiRefusal(404, "Opération inconnue : " + function);
    return sql.call(function, a == null ? Map.of() : a);
  }

  // ─── Budgets et lignes ───

  @GetMapping("/budgets")
  @Operation(operationId = "listBudgets", summary = "Budgets de la société")
  public JsonNode budgets() {
    return sql.list("SELECT * FROM public.budgets ORDER BY fiscal_year DESC, created_at DESC");
  }

  @PostMapping("/budgets")
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(operationId = "createBudget", summary = "Créer un budget en brouillon (droit budget.manage)")
  public JsonNode createBudget(@RequestBody Map<String, Object> body) {
    Map<String, Object> b = new LinkedHashMap<>(body);
    if (b.get("scenario") == null || "".equals(b.get("scenario"))) b.remove("scenario");
    return sql.insert("budgets", b, BUDGET, Map.of("status", "'draft'", "total_amount", "0", "created_by", "auth.uid()"));
  }

  @GetMapping("/budgets/{id}/lines")
  @Operation(operationId = "listBudgetLines", summary = "Lignes d'un budget")
  public JsonNode lines(@PathVariable UUID id) {
    return sql.list("SELECT id, budget_id, gl_account_id, period, planned_amount, analytic_value_id FROM public.budget_lines WHERE budget_id = ?::uuid ORDER BY period", id.toString());
  }

  @GetMapping("/budgets/{id}/amounts")
  @Operation(operationId = "listBudgetAmounts", summary = "Montants d'un budget par code de compte et de section")
  public JsonNode amounts(@PathVariable UUID id) {
    return sql.list("SELECT l.planned_amount, (SELECT to_jsonb(x) FROM (SELECT code FROM public.gl_accounts WHERE id = l.gl_account_id) x) AS account,"
        + " (SELECT to_jsonb(x) FROM (SELECT code FROM public.analytic_values WHERE id = l.analytic_value_id) x) AS section FROM public.budget_lines l WHERE l.budget_id = ?::uuid",
        id.toString());
  }

  @PostMapping("/lines")
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(operationId = "createBudgetLine", summary = "Ajouter une ligne à un budget en brouillon")
  public JsonNode createLine(@RequestBody Map<String, Object> body) {
    return sql.insert("budget_lines", body, LINE, Map.of("actual_amount", "0"));
  }

  @PatchMapping("/lines/{id}")
  @Operation(operationId = "updateBudgetLine", summary = "Modifier une ligne de budget en brouillon")
  public JsonNode updateLine(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
    return sql.update("budget_lines", id, body, LINE);
  }

  @DeleteMapping("/lines/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  @Operation(operationId = "deleteBudgetLine", summary = "Supprimer une ligne de budget en brouillon")
  public void deleteLine(@PathVariable UUID id) {
    sql.delete("budget_lines", id);
  }

  @GetMapping("/budgets/{id}/pending-revisions")
  @Operation(operationId = "listPendingBudgetRevisions", summary = "Demandes de révision en attente sur un budget")
  public JsonNode pending(@PathVariable UUID id) {
    return sql.list("SELECT r.id, r.budget_line_id, r.old_amount, r.new_amount, r.reason, r.created_by, r.created_at FROM public.budget_revisions r"
        + " JOIN public.budget_lines l ON l.id = r.budget_line_id WHERE r.status = 'pending' AND l.budget_id = ?::uuid", id.toString());
  }

  @GetMapping("/revisions")
  @Operation(operationId = "listBudgetRevisionsOfYear", summary = "Révisions de l'exercice, avec compte, période et section")
  public JsonNode revisions(@RequestParam String year) {
    return sql.list("SELECT r.id, r.created_at, r.reason, r.old_amount, r.new_amount, r.status, r.decision_comment,"
        + " jsonb_build_object('period', l.period, 'account', (SELECT to_jsonb(x) FROM (SELECT code, name FROM public.gl_accounts WHERE id = l.gl_account_id) x),"
        + " 'section', (SELECT to_jsonb(x) FROM (SELECT code, name FROM public.analytic_values WHERE id = l.analytic_value_id) x)) AS line"
        + " FROM public.budget_revisions r JOIN public.budget_lines l ON l.id = r.budget_line_id JOIN public.budgets b ON b.id = l.budget_id"
        + " WHERE b.fiscal_year = ? ORDER BY r.created_at DESC", year);
  }

  @GetMapping("/alert-documents")
  @Operation(operationId = "listBudgetAlertDocuments", summary = "Demandes et commandes de l'exercice passées en dépassement")
  public JsonNode alertDocuments(@RequestParam String year) {
    tools.jackson.databind.node.ObjectNode out = new tools.jackson.databind.ObjectMapper().createObjectNode();
    out.set("pr", sql.list("SELECT id, pr_number, request_date, estimated_total, status, budget_warning, budget_override_reason, budget_override_at"
        + " FROM public.purchase_requisitions WHERE budget_warning IS NOT NULL AND request_date BETWEEN (? || '-01-01')::date AND (? || '-12-31')::date", year, year));
    out.set("po", sql.list("SELECT id, po_number, order_date, total, status, budget_warning, budget_override_reason, budget_override_at"
        + " FROM public.purchase_orders WHERE budget_warning IS NOT NULL AND order_date BETWEEN (? || '-01-01')::date AND (? || '-12-31')::date", year, year));
    return out;
  }

  @GetMapping("/budgetable-accounts")
  @Operation(operationId = "listBudgetableAccounts", summary = "Comptes actifs des types budgétables (séparés par des virgules)")
  public JsonNode budgetable(@RequestParam String types) {
    String t = "{" + String.join(",", Arrays.stream(types.split(",")).map(String::trim).toList()) + "}";
    return sql.list("SELECT id, code, name, account_type, is_header, normal_balance FROM public.gl_accounts WHERE is_active AND account_type = ANY (?::text[]) ORDER BY code", t);
  }

  // ─── Paramètres et scénarios ───

  @GetMapping("/settings")
  @Operation(operationId = "getBudgetSettings", summary = "Paramètres du contrôle budgétaire (null = valeurs par défaut)")
  public JsonNode settings() {
    return sql.one("SELECT control_mode, control_level, precommit_requisitions, control_requisitions, analytic_control, alert_threshold_pct, revision_second_person,"
        + " revision_threshold_pct, forecast_method, annual_spread, budgetable_types FROM public.budget_settings WHERE tenant_id = public.get_user_tenant_id(auth.uid())");
  }

  @PutMapping("/settings")
  @Operation(operationId = "saveBudgetSettings", summary = "Enregistrer les paramètres du contrôle budgétaire (droit budget.settings)")
  public JsonNode saveSettings(@RequestBody Map<String, Object> body) {
    Map<String, Object> b = new LinkedHashMap<>(body);
    b.put("updated_at", java.time.OffsetDateTime.now().toString());
    return sql.upsert("budget_settings", b, SETTINGS, List.of("tenant_id"));
  }

  @GetMapping("/scenarios")
  @Operation(operationId = "listBudgetScenarios", summary = "Scénarios de budget")
  public JsonNode scenarios() {
    return sql.list("SELECT id, code, name, description, is_active, sort_order FROM public.budget_scenarios ORDER BY sort_order, name");
  }

  @PostMapping("/scenarios")
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(operationId = "createBudgetScenario", summary = "Créer un scénario")
  public JsonNode createScenario(@RequestBody Map<String, Object> body) {
    return sql.insert("budget_scenarios", body, SCENARIO);
  }

  @PatchMapping("/scenarios/{id}")
  @Operation(operationId = "updateBudgetScenario", summary = "Modifier un scénario")
  public JsonNode updateScenario(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
    return sql.update("budget_scenarios", id, body, SCENARIO);
  }

  @DeleteMapping("/scenarios/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  @Operation(operationId = "deleteBudgetScenario", summary = "Supprimer un scénario non utilisé")
  public void deleteScenario(@PathVariable UUID id) {
    sql.delete("budget_scenarios", id);
  }

  @GetMapping("/role-audit")
  @Operation(operationId = "listBudgetRoleAudit", summary = "Journal des rôles budgétaires")
  public JsonNode roleAudit() {
    return sql.list("SELECT * FROM public.budget_role_audit ORDER BY created_at DESC LIMIT 500");
  }

  // ─── Prévisions ───

  @GetMapping("/forecasts")
  @Operation(operationId = "listBudgetForecasts", summary = "Versions de prévision d'un exercice")
  public JsonNode forecasts(@RequestParam String year) {
    return sql.list("SELECT id, fiscal_year, name, status, notes, created_at, published_at FROM public.budget_forecasts WHERE fiscal_year = ? ORDER BY created_at DESC", year);
  }

  @GetMapping("/forecasts/{id}/lines")
  @Operation(operationId = "listBudgetForecastLines", summary = "Lignes d'une version de prévision")
  public JsonNode forecastLines(@PathVariable UUID id) {
    return sql.list("SELECT id, forecast_id, gl_account_id, analytic_value_id, amount, comment FROM public.budget_forecast_lines WHERE forecast_id = ?::uuid", id.toString());
  }

  @GetMapping("/forecasts/{id}/amounts")
  @Operation(operationId = "listBudgetForecastAmounts", summary = "Montants d'une version par code de compte et de section")
  public JsonNode forecastAmounts(@PathVariable UUID id) {
    return sql.list("SELECT l.amount, (SELECT to_jsonb(x) FROM (SELECT code FROM public.gl_accounts WHERE id = l.gl_account_id) x) AS account,"
        + " (SELECT to_jsonb(x) FROM (SELECT code FROM public.analytic_values WHERE id = l.analytic_value_id) x) AS section FROM public.budget_forecast_lines l WHERE l.forecast_id = ?::uuid",
        id.toString());
  }

  @PostMapping("/forecasts")
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(operationId = "createBudgetForecast", summary = "Nouvelle version de prévision, avec ses lignes initiales (une transaction)")
  public JsonNode createForecast(@RequestBody Map<String, Object> body) {
    return forecasts.create(body);
  }

  @DeleteMapping("/forecasts/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  @Operation(operationId = "deleteBudgetForecast", summary = "Supprimer une version non publiée")
  public void deleteForecast(@PathVariable UUID id) {
    sql.delete("budget_forecasts", id);
  }

  @PostMapping("/forecast-lines")
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(operationId = "createBudgetForecastLine", summary = "Ajouter une ligne à une version")
  public JsonNode createForecastLine(@RequestBody Map<String, Object> body) {
    return sql.insert("budget_forecast_lines", body, FORECAST_LINE);
  }

  @PatchMapping("/forecast-lines/{id}")
  @Operation(operationId = "updateBudgetForecastLine", summary = "Modifier une ligne d'une version")
  public JsonNode updateForecastLine(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
    return sql.update("budget_forecast_lines", id, body, FORECAST_LINE);
  }

  @DeleteMapping("/forecast-lines/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  @Operation(operationId = "deleteBudgetForecastLine", summary = "Supprimer une ligne d'une version")
  public void deleteForecastLine(@PathVariable UUID id) {
    sql.delete("budget_forecast_lines", id);
  }

  /** Version et lignes initiales en une transaction. */
  @Service
  public static class Forecasts {
    private final Sql sql;

    public Forecasts(Sql sql) {
      this.sql = sql;
    }

    @Transactional
    @SuppressWarnings("unchecked")
    public JsonNode create(Map<String, Object> body) {
      JsonNode f = sql.insert("budget_forecasts", Sql.args("fiscal_year", body.get("year"), "name", String.valueOf(body.get("name")).trim()),
          Set.of("fiscal_year", "name"), Map.of("created_by", "auth.uid()"));
      List<Map<String, Object>> lines = (List<Map<String, Object>>) body.getOrDefault("lines", List.of());
      for (Map<String, Object> l : lines) {
        Map<String, Object> row = new LinkedHashMap<>(l);
        row.put("forecast_id", f.get("id").asString());
        double amount = Math.max(0, Math.round(((Number) l.getOrDefault("amount", 0)).doubleValue() * 100) / 100.0);
        row.put("amount", amount);
        sql.insert("budget_forecast_lines", row, FORECAST_LINE);
      }
      return f;
    }
  }
}
