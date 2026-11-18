package com.quoreich.qerp.hr;

import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/** Requêtes RH/Paie on-premise. Les contrôles de société et d'action restent dans PostgreSQL. */
@Repository
public class HrQuery {

  private static final ObjectMapper JSON = new ObjectMapper();
  private static final RowMapper<Map<String, Object>> ROW = HrQuery::mapRow;
  private final JdbcTemplate jdbc;

  public HrQuery(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Transactional(readOnly = true)
  public List<Map<String, Object>> employees() {
    return jdbc.query("SELECT * FROM public.list_hr_employees()", ROW);
  }

  @Transactional(readOnly = true)
  public Map<String, Object> companyContext() {
    List<Map<String, Object>> rows = jdbc.query(
        "SELECT name, legal_name, address, phone, email, rccm, tax_id, currency, fiscal_year_start FROM public.tenants"
            + " WHERE id = public.get_user_tenant_id(auth.uid())", ROW);
    return rows.isEmpty() ? Map.of() : rows.getFirst();
  }

  @Transactional(readOnly = true)
  public List<Map<String, Object>> hrRoleAudit() {
    requirePermission("audit_payroll");
    return jdbc.query("SELECT id, created_at, tenant_id, performed_by, target_user_id, role, action, reason"
        + " FROM public.hr_role_audit ORDER BY created_at DESC, id", ROW);
  }

  @Transactional
  public UUID saveEmployee(Map<String, Object> payload) {
    try {
      return jdbc.queryForObject("SELECT public.save_hr_employee(?::jsonb)", UUID.class, JSON.writeValueAsString(payload));
    } catch (Exception e) {
      if (e instanceof RuntimeException runtime) throw runtime;
      throw new IllegalArgumentException("Dossier salarié invalide", e);
    }
  }

  @Transactional(readOnly = true)
  public Map<String, Object> employeeNumberSettings() {
    List<Map<String, Object>> rows = jdbc.query("SELECT * FROM public.list_hr_employee_number_settings()", ROW);
    return rows.isEmpty() ? Map.of() : rows.getFirst();
  }

  @Transactional
  public Map<String, Object> saveEmployeeNumberSettings(Map<String, Object> input) {
    List<Map<String, Object>> rows = jdbc.query(
        "SELECT * FROM public.save_hr_employee_number_settings(?, ?, ?, ?, ?, ?)", ROW,
        input.get("prefix"), input.getOrDefault("include_year", false), input.get("separator"),
        input.get("number_width"), input.get("next_number"), input.get("default_status"));
    return rows.isEmpty() ? Map.of() : rows.getFirst();
  }

  @Transactional
  public Map<String, Object> importEmployees(List<Map<String, Object>> rows) {
    try {
      String result = jdbc.queryForObject("SELECT public.import_hr_employees(?::jsonb)::text", String.class,
          JSON.writeValueAsString(rows));
      return JSON.readValue(result, Map.class);
    } catch (Exception e) {
      if (e instanceof RuntimeException runtime) throw runtime;
      throw new IllegalArgumentException("Import des salariés invalide", e);
    }
  }

  @Transactional
  public Map<String, Object> createEmployeeMovementsBulk(Map<String, Object> input) {
    try {
      String result = jdbc.queryForObject(
          "SELECT public.create_employee_movements_bulk(ARRAY(SELECT jsonb_array_elements_text(?::jsonb)::uuid), ?, ?::date, ?, ?, ?)::text", String.class,
          JSON.writeValueAsString(input.get("employee_ids")), input.get("movement_type"), input.get("effective_date"),
          input.get("reason_code"), input.get("reason"), input.get("action_value"));
      return JSON.readValue(result, Map.class);
    } catch (Exception e) {
      if (e instanceof RuntimeException runtime) throw runtime;
      throw new IllegalArgumentException("Mouvement groupé invalide", e);
    }
  }

  @Transactional(readOnly = true)
  public List<Map<String, Object>> employeeMovements(UUID employeeId) {
    requirePermission("view_employee_history");
    return jdbc.query("SELECT * FROM public.list_employee_movements(?)", ROW, employeeId);
  }

  @Transactional(readOnly = true)
  public List<Map<String, Object>> movementReferences(boolean includeInactive) {
    return jdbc.query("SELECT id, tenant_id, kind, code, label, active, sort_order, bulk_action_field, bulk_action_options::text AS bulk_action_options"
        + " FROM public.list_hr_movement_references(?)", ROW, includeInactive);
  }

  @Transactional
  public UUID saveMovementReference(Map<String, Object> input) {
    try {
      return jdbc.queryForObject("SELECT public.save_hr_movement_reference(?, ?, ?, ?, ?, ?, ?::jsonb)", UUID.class,
        input.get("kind"), input.get("code"), input.get("label"), input.getOrDefault("active", true),
        input.getOrDefault("sort_order", 0), input.get("bulk_action_field"),
        JSON.writeValueAsString(input.getOrDefault("bulk_action_options", List.of())));
    } catch (Exception e) {
      if (e instanceof RuntimeException runtime) throw runtime;
      throw new IllegalArgumentException("Référentiel de mouvement invalide", e);
    }
  }

  @Transactional(readOnly = true)
  public List<Map<String, Object>> payrollComponents(boolean includeInactive) {
    return jdbc.query("SELECT * FROM public.list_hr_payroll_components(?)", ROW, includeInactive);
  }

  @Transactional
  public UUID savePayrollComponent(Map<String, Object> input) {
    try {
      return jdbc.queryForObject("SELECT public.save_hr_payroll_component(?::jsonb)", UUID.class,
          JSON.writeValueAsString(input));
    } catch (Exception e) {
      if (e instanceof RuntimeException runtime) throw runtime;
      throw new IllegalArgumentException("Rubrique de paie invalide", e);
    }
  }

  @Transactional(readOnly = true)
  public List<Map<String, Object>> employeePayrollComponents(UUID employeeId) {
    return jdbc.query("SELECT * FROM public.list_hr_employee_payroll_components(?)", ROW, employeeId);
  }

  @Transactional
  public UUID saveEmployeePayrollComponent(UUID employeeId, Map<String, Object> input) {
    try {
      return jdbc.queryForObject("SELECT public.save_hr_employee_payroll_component(?, ?::jsonb)", UUID.class,
          employeeId, JSON.writeValueAsString(input));
    } catch (Exception e) {
      if (e instanceof RuntimeException runtime) throw runtime;
      throw new IllegalArgumentException("Affectation de rubrique invalide", e);
    }
  }

  @Transactional
  public UUID createEmployeeMovement(UUID employeeId, Map<String, Object> input) {
    try {
      return jdbc.queryForObject("SELECT public.create_employee_movement(?, ?, ?::date, ?, ?, ?::jsonb)", UUID.class,
          employeeId, input.get("movement_type"), input.get("effective_date"), input.get("reason_code"),
          input.get("reason"), JSON.writeValueAsString(input.get("after_values")));
    } catch (Exception e) {
      if (e instanceof RuntimeException runtime) throw runtime;
      throw new IllegalArgumentException("Mouvement RH invalide", e);
    }
  }

  @Transactional
  public UUID approveEmployeeMovement(UUID movementId, String reason) {
    return jdbc.queryForObject("SELECT public.approve_employee_movement(?, ?)", UUID.class, movementId, reason);
  }

  @Transactional
  public UUID rejectEmployeeMovement(UUID movementId, String reason) {
    return jdbc.queryForObject("SELECT public.reject_employee_movement(?, ?)", UUID.class, movementId, reason);
  }

  @Transactional(readOnly = true)
  public Map<String, Object> payrollSettings() {
    requirePermission("view_payroll");
    List<Map<String, Object>> rows = jdbc.query(
        "SELECT tenant_id, country_code, currency_code, employee_contribution_pct, employee_contribution_cap,"
            + " employer_contribution_pct, employer_contribution_cap, income_tax_bands::text AS income_tax_bands, rules_effective_from,"
            + " rules_reference, rules_validated_at, rules_validated_by"
            + " FROM public.hr_payroll_settings WHERE tenant_id = public.get_user_tenant_id(auth.uid())", ROW);
    return rows.isEmpty() ? Map.of() : rows.getFirst();
  }

  @Transactional
  public Map<String, Object> savePayrollSettings(Map<String, Object> input) {
    requirePermission("payroll_settings");
    jdbc.update(
        "INSERT INTO public.hr_payroll_settings (tenant_id, country_code, currency_code, employee_contribution_pct,"
            + " employee_contribution_cap, employer_contribution_pct, employer_contribution_cap, income_tax_bands,"
            + " rules_effective_from, rules_reference)"
            + " VALUES (public.get_user_tenant_id(auth.uid()), ?, ?, ?, ?, ?, ?, ?::jsonb, ?::date, ?)"
            + " ON CONFLICT (tenant_id) DO UPDATE SET country_code = EXCLUDED.country_code,"
            + " currency_code = EXCLUDED.currency_code, employee_contribution_pct = EXCLUDED.employee_contribution_pct,"
            + " employee_contribution_cap = EXCLUDED.employee_contribution_cap,"
            + " employer_contribution_pct = EXCLUDED.employer_contribution_pct,"
            + " employer_contribution_cap = EXCLUDED.employer_contribution_cap,"
            + " income_tax_bands = EXCLUDED.income_tax_bands, rules_effective_from = EXCLUDED.rules_effective_from,"
            + " rules_reference = EXCLUDED.rules_reference, updated_at = now()",
        input.get("country_code"), input.get("currency_code"), input.get("employee_contribution_pct"),
        input.get("employee_contribution_cap"), input.get("employer_contribution_pct"),
        input.get("employer_contribution_cap"), json(input.get("income_tax_bands")),
        input.get("rules_effective_from"), input.get("rules_reference"));
    return payrollSettings();
  }

  @Transactional
  public Object confirmPayrollRules() {
    return jdbc.queryForObject("SELECT public.confirm_payroll_rules()", Object.class);
  }

  @Transactional(readOnly = true)
  public List<Map<String, Object>> payrollRuns() {
    requirePermission("view_payroll");
    return jdbc.query("SELECT id, tenant_id, period, pay_date, status, gross_total, net_total, deductions_total,"
        + " taxes_total, employer_charges_total, employee_count, created_by, approved_by, executed_by,"
        + " approved_at, executed_at, notes, payroll_country_code, payroll_currency_code,"
        + " payroll_rules_snapshot::text AS payroll_rules_snapshot, created_at, updated_at"
        + " FROM public.payroll_runs ORDER BY pay_date DESC, id", ROW);
  }

  @Transactional(readOnly = true)
  public List<Map<String, Object>> payrollRegister(String from, String to) {
    requirePermission("view_payroll");
    if (from == null || to == null || !from.matches("\\d{4}-\\d{2}") || !to.matches("\\d{4}-\\d{2}") || from.compareTo(to) > 0) {
      throw new HrRefusal(org.springframework.http.HttpStatus.BAD_REQUEST, "Période de rapport invalide");
    }
    return jdbc.query("SELECT tenant_id, period, status, matricule, department, gross, net"
        + " FROM public.payroll_register_view WHERE status = 'posted' AND period BETWEEN ? AND ?"
        + " ORDER BY period, matricule", ROW, from, to);
  }

  @Transactional
  public UUID createPayrollRun(String period, String payDate) {
    return jdbc.queryForObject("SELECT public.create_payroll_run(?, ?::date)", UUID.class, period, payDate);
  }

  @Transactional(readOnly = true)
  public List<Map<String, Object>> payrollLines(UUID runId) {
    requirePermission("view_payroll");
    return jdbc.query("SELECT l.id, l.tenant_id, l.run_id, l.employee_id, l.gross, l.deductions, l.taxes,"
        + " l.net, l.employer_charges, l.department_snapshot,"
        + " jsonb_build_object('matricule', e.matricule, 'first_name', e.first_name, 'last_name', e.last_name)::text AS employee"
        + " FROM public.payroll_lines l JOIN public.employees e ON e.id = l.employee_id"
        + " WHERE l.run_id = ? ORDER BY l.id", ROW, runId);
  }

  @Transactional
  public int generatePayrollLines(UUID runId) {
    return jdbc.queryForObject("SELECT public.generate_payroll_lines(?)", Integer.class, runId);
  }

  @Transactional(readOnly = true)
  public List<Map<String, Object>> payrollComponentLines(UUID runId, UUID employeeId) {
    requirePermission("view_sensitive");
    return jdbc.query("SELECT id, tenant_id, run_id, employee_id, component_id, code_snapshot, label_snapshot,"
        + " kind, calculation_method, calculation_base, rate_snapshot, amount, source_type, source_id,"
        + " definition_snapshot::text AS definition_snapshot FROM public.payroll_component_lines"
        + " WHERE run_id = ? AND (?::uuid IS NULL OR employee_id = ?) ORDER BY employee_id, id",
        ROW, runId, employeeId, employeeId);
  }

  @Transactional(readOnly = true)
  public List<Map<String, Object>> payrollRunVariables(UUID runId) {
    requirePermission("view_payroll");
    return jdbc.query("SELECT id, tenant_id, run_id, employee_id, component_id, source_key, amount, reason,"
        + " status, created_by, created_at, decided_by, decided_at, decision_reason"
        + " FROM public.payroll_run_variables WHERE run_id = ? ORDER BY created_at, id", ROW, runId);
  }

  @Transactional
  public UUID createPayrollRunVariable(UUID runId, Map<String, Object> input) {
    return jdbc.queryForObject("SELECT public.create_payroll_run_variable(?, ?::uuid, ?::uuid, ?::numeric, ?, ?)",
        UUID.class, runId, input.get("employee_id"), input.get("component_id"), input.get("amount"),
        input.get("source_key"), input.get("reason"));
  }

  @Transactional
  public UUID decidePayrollRunVariable(UUID variableId, boolean approve, String reason) {
    return jdbc.queryForObject("SELECT public.decide_payroll_run_variable(?, ?, ?)", UUID.class,
        variableId, approve, reason);
  }

  @Transactional
  public void approvePayrollRun(UUID runId) {
    jdbc.query("SELECT public.approve_payroll_run(?)", rs -> null, runId);
  }

  @Transactional
  public Map<String, Object> precheckPayrollRun(UUID runId) {
    String result = jdbc.queryForObject("SELECT public.precheck_payroll_run(?)::text", String.class, runId);
    try {
      return JSON.readValue(result, Map.class);
    } catch (Exception e) {
      throw new IllegalStateException("Résultat du précontrôle RH invalide", e);
    }
  }

  @Transactional(readOnly = true)
  public List<Map<String, Object>> payrollRunPrechecks(UUID runId) {
    requirePermission("view_payroll");
    return jdbc.query("SELECT id, tenant_id, run_id, passed, findings::text AS findings, checked_by, checked_at"
        + " FROM public.payroll_run_prechecks WHERE run_id = ? ORDER BY checked_at DESC, id DESC", ROW, runId);
  }

  @Transactional
  public UUID postPayrollRun(UUID runId) {
    return jdbc.queryForObject("SELECT public.post_payroll_run(?)", UUID.class, runId);
  }

  @Transactional(readOnly = true)
  public Map<String, Object> payrollRunAudit(UUID runId, String eventType, int page, int pageSize) {
    requirePermission("audit_payroll");
    int safePage = Math.max(1, page);
    int safeSize = Math.min(100, Math.max(1, pageSize));
    int offset = (safePage - 1) * safeSize;
    String filter = "all".equals(eventType) ? null : eventType;
    Integer total = jdbc.queryForObject(
        "SELECT count(*) FROM public.payroll_run_audit WHERE run_id = ? AND (?::text IS NULL OR event_type = ?)",
        Integer.class, runId, filter, filter);
    List<Map<String, Object>> rows = jdbc.query(
        "SELECT id, tenant_id, run_id, event_type, from_status, to_status, performed_by, created_at, details::text AS details"
            + " FROM public.payroll_run_audit WHERE run_id = ? AND (?::text IS NULL OR event_type = ?)"
            + " ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
        ROW, runId, filter, filter, safeSize, offset);
    return Map.of("rows", rows, "total", total == null ? 0 : total);
  }

  @Transactional(readOnly = true)
  public Map<String, String> payrollPostingAccounts() {
    requirePermission("view_payroll");
    List<Map<String, Object>> rows = jdbc.query(
        "SELECT p.role_code, g.code AS account_code FROM public.tenant_posting_accounts p"
            + " JOIN public.gl_accounts g ON g.id = p.gl_account_id"
            + " WHERE p.role_code LIKE 'PAYROLL_%' ORDER BY p.role_code", ROW);
    Map<String, String> result = new LinkedHashMap<>();
    rows.forEach(row -> result.put(String.valueOf(row.get("role_code")), String.valueOf(row.get("account_code"))));
    return result;
  }

  @Transactional(readOnly = true)
  public boolean hasPermission(String action) {
    Boolean permitted = jdbc.queryForObject("SELECT public.has_hr_perm(auth.uid(), ?)", Boolean.class, action);
    return Boolean.TRUE.equals(permitted);
  }

  private void requirePermission(String action) {
    if (!hasPermission(action)) throw new HrRefusal(org.springframework.http.HttpStatus.FORBIDDEN, "Droit RH insuffisant");
  }

  private static String json(Object value) {
    try {
      return value == null ? "[]" : JSON.writeValueAsString(value);
    } catch (Exception e) {
      throw new IllegalArgumentException("Paramètres RH invalides", e);
    }
  }

  private static Map<String, Object> mapRow(ResultSet rs, int rowNum) throws SQLException {
    ResultSetMetaData metadata = rs.getMetaData();
    Map<String, Object> values = new LinkedHashMap<>();
    for (int column = 1; column <= metadata.getColumnCount(); column++) {
      Object value = rs.getObject(column);
      String label = metadata.getColumnLabel(column);
      if (value instanceof String json && Set.of("income_tax_bands", "payroll_rules_snapshot", "definition_snapshot", "employee", "details", "before_values", "after_values", "bulk_action_options").contains(label)) {
        try {
          value = JSON.readTree(json);
        } catch (Exception ignored) {
          value = json;
        }
      }
      values.put(label, value);
    }
    return values;
  }
}
