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
            + " rules_reference, rules_validated_at, rules_validated_by, proration_method"
            + " FROM public.hr_payroll_settings WHERE tenant_id = public.get_user_tenant_id(auth.uid())", ROW);
    return rows.isEmpty() ? Map.of() : rows.getFirst();
  }

  @Transactional
  public Map<String, Object> savePayrollSettings(Map<String, Object> input) {
    requirePermission("payroll_settings");
    jdbc.update(
        "INSERT INTO public.hr_payroll_settings (tenant_id, country_code, currency_code, employee_contribution_pct,"
            + " employee_contribution_cap, employer_contribution_pct, employer_contribution_cap, income_tax_bands,"
            + " rules_effective_from, rules_reference, proration_method)"
            + " VALUES (public.get_user_tenant_id(auth.uid()), ?, ?, ?, ?, ?, ?, ?::jsonb, ?::date, ?,"
            + " COALESCE(?::text, 'calendar_days'))"
            + " ON CONFLICT (tenant_id) DO UPDATE SET country_code = EXCLUDED.country_code,"
            + " currency_code = EXCLUDED.currency_code, employee_contribution_pct = EXCLUDED.employee_contribution_pct,"
            + " employee_contribution_cap = EXCLUDED.employee_contribution_cap,"
            + " employer_contribution_pct = EXCLUDED.employer_contribution_pct,"
            + " employer_contribution_cap = EXCLUDED.employer_contribution_cap,"
            + " income_tax_bands = EXCLUDED.income_tax_bands, rules_effective_from = EXCLUDED.rules_effective_from,"
            + " rules_reference = EXCLUDED.rules_reference,"
            // V148 : une méthode de prorata absente de la requête ne remplace pas celle enregistrée.
            + " proration_method = COALESCE(?::text, public.hr_payroll_settings.proration_method),"
            + " updated_at = now()",
        input.get("country_code"), input.get("currency_code"), input.get("employee_contribution_pct"),
        input.get("employee_contribution_cap"), input.get("employer_contribution_pct"),
        input.get("employer_contribution_cap"), json(input.get("income_tax_bands")),
        input.get("rules_effective_from"), input.get("rules_reference"), input.get("proration_method"),
        input.get("proration_method"));
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
        + " payroll_rules_snapshot::text AS payroll_rules_snapshot, created_at, updated_at,"
        + " run_kind, regularizes_run_id, journal_entry_id, reversed_at, reversed_by, reversal_reason, reversal_entry_id"
        + " FROM public.payroll_runs ORDER BY pay_date DESC, id", ROW);
  }

  /** V151 — contrepassation d'un cycle comptabilisé ; renvoie l'écriture de contrepassation. */
  @Transactional
  public UUID reversePayrollRun(UUID runId, String reason, String reverseDate) {
    return jdbc.queryForObject("SELECT public.reverse_payroll_run(?, ?, COALESCE(?::date, CURRENT_DATE))", UUID.class,
        runId, reason, reverseDate);
  }

  /** V151 — cycle de régularisation d'une période comptabilisée. */
  @Transactional
  public UUID createPayrollRegularization(UUID runId, String payDate, String reason) {
    return jdbc.queryForObject("SELECT public.create_payroll_regularization(?, ?::date, ?)", UUID.class, runId, payDate, reason);
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

  /** Fonction SQL renvoyant du jsonb, restitué tel quel en JSON. */
  private Object jsonResult(String sql, Object... args) {
    String result = jdbc.queryForObject(sql, String.class, args);
    try {
      return JSON.readTree(result == null ? "null" : result);
    } catch (Exception e) {
      throw new IllegalStateException("Réponse RH illisible", e);
    }
  }

  /** V152 — temps, absences et congés. */
  @Transactional(readOnly = true)
  public Object timeTypes() {
    return jsonResult("SELECT public.list_hr_time_types()::text");
  }

  @Transactional
  public UUID saveTimeType(Map<String, Object> input) {
    return jdbc.queryForObject("SELECT public.save_hr_time_type(?::jsonb)", UUID.class, json(input));
  }

  @Transactional(readOnly = true)
  public Object timeRequests(String from, String to) {
    return jsonResult("SELECT public.list_hr_time_requests(?::date, ?::date)::text", from, to);
  }

  @Transactional
  public UUID submitTimeRequest(Map<String, Object> input) {
    Object quantity = input.get("quantity");
    return jdbc.queryForObject("SELECT public.submit_hr_time_request(?::uuid, ?::uuid, ?::date, ?::date, ?::numeric, ?)", UUID.class,
        input.get("employee_id"), input.get("type_id"), input.get("start_date"), input.get("end_date"),
        quantity == null || String.valueOf(quantity).isBlank() ? null : String.valueOf(quantity), input.get("reason"));
  }

  @Transactional
  public UUID decideTimeRequest(UUID id, boolean approve, String reason) {
    return jdbc.queryForObject("SELECT public.decide_hr_time_request(?, ?, ?)", UUID.class, id, approve, reason);
  }

  @Transactional
  public UUID cancelTimeRequest(UUID id, String reason) {
    return jdbc.queryForObject("SELECT public.cancel_hr_time_request(?, ?)", UUID.class, id, reason);
  }

  /** V153 : la lecture des soldes rattrape d'abord les acquisitions automatiques (écriture). */
  @Transactional
  public Object leaveBalances() {
    return jsonResult("SELECT public.list_hr_leave_balances()::text");
  }

  /** V154 — paiement des salaires : formats de fichier bancaire, lots, fichier, retours. */
  @Transactional(readOnly = true)
  public Object bankFileProfiles() {
    return jsonResult("SELECT COALESCE(jsonb_agg(to_jsonb(p) - 'tenant_id' ORDER BY p.label), '[]'::jsonb)::text"
        + " FROM public.payroll_bank_file_profiles p WHERE p.tenant_id = public.get_user_tenant_id(auth.uid())");
  }

  @Transactional
  public UUID saveBankFileProfile(Map<String, Object> input) {
    return jdbc.queryForObject("SELECT public.save_payroll_bank_file_profile(?::jsonb)", UUID.class, json(input));
  }

  @Transactional(readOnly = true)
  public Object paymentBatches(UUID runId) {
    return jsonResult("SELECT public.list_payroll_payment_batches(?)::text", runId);
  }

  @Transactional
  public UUID createPaymentBatch(Map<String, Object> input) {
    return jdbc.queryForObject("SELECT public.create_payroll_payment_batch(?::uuid, ?::uuid, ?::uuid, ?::date, ?)", UUID.class,
        input.get("run_id"), input.get("bank_account_id"), input.get("profile_id"), input.get("payment_date"), input.get("reference"));
  }

  @Transactional
  public UUID approvePaymentBatch(UUID id) {
    return jdbc.queryForObject("SELECT public.approve_payroll_payment_batch(?)", UUID.class, id);
  }

  @Transactional
  public UUID cancelPaymentBatch(UUID id, String reason) {
    return jdbc.queryForObject("SELECT public.cancel_payroll_payment_batch(?, ?)", UUID.class, id, reason);
  }

  @Transactional
  public Object paymentFile(UUID id) {
    return jsonResult("SELECT public.generate_payroll_payment_file(?)::text", id);
  }

  @Transactional
  public Object paymentResults(UUID id, Object results, String resultDate) {
    return jsonResult("SELECT public.record_payroll_payment_results(?, ?::jsonb, ?::date)::text", id, json(results), resultDate);
  }

  @Transactional(readOnly = true)
  public Object runPaymentStatus(UUID runId) {
    return jsonResult("SELECT public.payroll_run_payment_status(?)::text", runId);
  }

  /** V153 — calendrier des jours fériés de la société. */
  @Transactional(readOnly = true)
  public Object publicHolidays(Integer year) {
    return jsonResult("SELECT public.list_hr_public_holidays(?)::text", year);
  }

  @Transactional
  public UUID savePublicHoliday(Map<String, Object> input) {
    return jdbc.queryForObject("SELECT public.save_hr_public_holiday(?::jsonb)", UUID.class, json(input));
  }

  @Transactional
  public UUID deletePublicHoliday(UUID id) {
    return jdbc.queryForObject("SELECT public.delete_hr_public_holiday(?)", UUID.class, id);
  }

  /** V153 — libre-service salarié (sa fiche, ses demandes, ses soldes ; demandes à approuver comme responsable). */
  @Transactional
  public Object mySelfService() {
    return jsonResult("SELECT public.my_hr_self_service()::text");
  }

  @Transactional
  public UUID submitMyTimeRequest(Map<String, Object> input) {
    Object quantity = input.get("quantity");
    return jdbc.queryForObject("SELECT public.submit_my_time_request(?::uuid, ?::date, ?::date, ?::numeric, ?)", UUID.class,
        input.get("type_id"), input.get("start_date"), input.get("end_date"),
        quantity == null || String.valueOf(quantity).isBlank() ? null : String.valueOf(quantity), input.get("reason"));
  }

  @Transactional
  public UUID cancelMyTimeRequest(UUID id, String reason) {
    return jdbc.queryForObject("SELECT public.cancel_my_time_request(?, ?)", UUID.class, id, reason);
  }

  @Transactional(readOnly = true)
  public Object selfServiceLinks() {
    return jsonResult("SELECT public.list_hr_self_service_links()::text");
  }

  @Transactional
  public UUID setSelfService(UUID employeeId, Object userId, Object approverId) {
    return jdbc.queryForObject("SELECT public.set_hr_employee_self_service(?, ?::uuid, ?::uuid)", UUID.class, employeeId,
        userId == null || String.valueOf(userId).isBlank() ? null : String.valueOf(userId),
        approverId == null || String.valueOf(approverId).isBlank() ? null : String.valueOf(approverId));
  }

  @Transactional
  public Integer accrueLeave(String period) {
    return jdbc.queryForObject("SELECT public.accrue_hr_leave(?)", Integer.class, period);
  }

  @Transactional
  public Long adjustLeave(Map<String, Object> input) {
    return jdbc.queryForObject("SELECT public.adjust_hr_leave_balance(?::uuid, ?::uuid, ?::numeric, ?::date, ?)", Long.class,
        input.get("employee_id"), input.get("type_id"), input.get("quantity") == null ? null : String.valueOf(input.get("quantity")),
        input.get("entry_date"), input.get("note"));
  }

  @Transactional
  public Integer transferTimeToPayroll(UUID runId) {
    return jdbc.queryForObject("SELECT public.transfer_hr_time_to_payroll(?)", Integer.class, runId);
  }

  /** V150 — bases de calcul nommées (salaire de base + rubriques). */
  @Transactional(readOnly = true)
  public Object payrollBases() {
    String result = jdbc.queryForObject("SELECT public.list_payroll_bases()::text", String.class);
    try {
      return JSON.readTree(result == null ? "[]" : result);
    } catch (Exception e) {
      throw new IllegalStateException("Bases de paie illisibles", e);
    }
  }

  @Transactional
  public UUID savePayrollBase(Map<String, Object> input) {
    return jdbc.queryForObject("SELECT public.save_payroll_base(?::jsonb)", UUID.class, json(input));
  }

  /** V150 — essai d'une formule de rubrique avec des valeurs données. */
  @Transactional(readOnly = true)
  public Object tryPayrollFormula(String formula, Object variables) {
    return jdbc.queryForObject("SELECT public.payroll_formula_try(?, ?::jsonb)", Object.class, formula,
        variables == null ? "{}" : json(variables));
  }

  /** V149 — versions datées des règles légales de paie (cotisations comprises). */
  @Transactional(readOnly = true)
  public Object payrollRuleVersions() {
    String result = jdbc.queryForObject("SELECT public.list_payroll_rule_versions()::text", String.class);
    try {
      return JSON.readTree(result == null ? "[]" : result);
    } catch (Exception e) {
      throw new IllegalStateException("Règles de paie illisibles", e);
    }
  }

  @Transactional
  public UUID savePayrollRuleVersion(Map<String, Object> input) {
    return jdbc.queryForObject("SELECT public.save_payroll_rule_version(?::jsonb)", UUID.class, json(input));
  }

  @Transactional
  public Object validatePayrollRuleVersion(UUID versionId) {
    return jdbc.queryForObject("SELECT public.validate_payroll_rule_version(?)", Object.class, versionId);
  }

  @Transactional
  public UUID archivePayrollRuleVersion(UUID versionId, String reason) {
    return jdbc.queryForObject("SELECT public.archive_payroll_rule_version(?, ?)", UUID.class, versionId, reason);
  }

  @Transactional
  public UUID deletePayrollRuleVersion(UUID versionId) {
    return jdbc.queryForObject("SELECT public.delete_payroll_rule_version(?)", UUID.class, versionId);
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
      // jsonb renvoyé tel quel par une fonction (ex. barème d'une rubrique, V150) : le pilote rend un PGobject,
      // que l'on restitue en JSON (classe lue par son nom : le pilote n'est qu'en portée d'exécution).
      if (value != null && "org.postgresql.util.PGobject".equals(value.getClass().getName())
          && "jsonb".equals(metadata.getColumnTypeName(column))) {
        try {
          value = JSON.readTree(value.toString());
        } catch (Exception ignored) {
          value = value.toString();
        }
      }
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
