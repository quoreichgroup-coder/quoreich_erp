package com.quoreich.qerp.hr;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Contrat RH/Paie on-premise; PostgreSQL reste l'autorité pour tenant, RLS et mutations. */
@RestController
@RequestMapping("/api/v1/hr")
@Tag(name = "RH et paie", description = "Dossiers salariés et cycles de paie de la société courante")
public class HrController {

  private static final Logger LOG = LoggerFactory.getLogger(HrController.class);
  private static final Set<String> AUDIT_EVENTS = Set.of(
      "all", "created", "lines_generated", "prechecked", "approved", "posted", "status_changed", "deleted");
  private final HrQuery query;

  public HrController(HrQuery query) {
    this.query = query;
  }

  @GetMapping("/employees")
  @Operation(operationId = "listHrEmployees", summary = "Lister les salariés visibles dans la société courante")
  public List<Map<String, Object>> employees() {
    return query.employees();
  }

  @GetMapping("/company-context")
  @Operation(operationId = "getHrCompanyContext", summary = "Lire la devise et l'exercice de la société courante")
  public Map<String, Object> companyContext() {
    return query.companyContext();
  }

  @GetMapping("/roles/audit")
  @Operation(operationId = "listHrRoleAudit", summary = "Lire le journal des rôles RH autorisé")
  public List<Map<String, Object>> hrRoleAudit() {
    return query.hrRoleAudit();
  }

  @PostMapping("/employees")
  @Operation(operationId = "createHrEmployee", summary = "Créer un salarié dans la société courante")
  public ResponseEntity<Map<String, UUID>> createEmployee(@RequestBody Map<String, Object> payload) {
    return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("id", query.saveEmployee(payload)));
  }

  @PostMapping("/employees/import")
  @Operation(operationId = "importHrEmployees", summary = "Importer jusqu'à 1 000 salariés après validation du fichier")
  @SuppressWarnings("unchecked")
  public ResponseEntity<Map<String, Object>> importEmployees(@RequestBody Map<String, Object> payload) {
    Object rows = payload.get("rows");
    if (!(rows instanceof List<?> list)) throw new HrRefusal(HttpStatus.BAD_REQUEST, "La liste des salariés est obligatoire");
    return ResponseEntity.status(HttpStatus.CREATED).body(query.importEmployees((List<Map<String, Object>>) list));
  }

  @PostMapping("/employees/bulk-movements")
  @Operation(operationId = "createHrEmployeeMovementsBulk", summary = "Soumettre un mouvement RH paramétré pour plusieurs salariés")
  public ResponseEntity<Map<String, Object>> createEmployeeMovementsBulk(@RequestBody Map<String, Object> input) {
    return ResponseEntity.status(HttpStatus.CREATED).body(query.createEmployeeMovementsBulk(input));
  }

  @GetMapping("/employee-number-settings")
  @Operation(operationId = "getHrEmployeeNumberSettings", summary = "Lire la configuration des matricules")
  public Map<String, Object> employeeNumberSettings() {
    return query.employeeNumberSettings();
  }

  @PutMapping("/employee-number-settings")
  @Operation(operationId = "saveHrEmployeeNumberSettings", summary = "Configurer la numérotation des salariés")
  public Map<String, Object> saveEmployeeNumberSettings(@RequestBody Map<String, Object> input) {
    return query.saveEmployeeNumberSettings(input);
  }

  @GetMapping("/employees/{employeeId}/movements")
  @Operation(operationId = "listEmployeeMovements", summary = "Lire l'historique RH daté d'un salarié")
  public List<Map<String, Object>> employeeMovements(@PathVariable UUID employeeId) {
    return query.employeeMovements(employeeId);
  }

  @GetMapping("/movement-references")
  @Operation(operationId = "listHrMovementReferences", summary = "Lister les types et motifs RH configurés")
  public List<Map<String, Object>> movementReferences(@RequestParam(defaultValue = "false") boolean includeInactive) {
    return query.movementReferences(includeInactive);
  }

  @PostMapping("/movement-references")
  @Operation(operationId = "saveHrMovementReference", summary = "Créer ou modifier un type ou motif RH")
  public ResponseEntity<Map<String, UUID>> saveMovementReference(@RequestBody Map<String, Object> input) {
    return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("id", query.saveMovementReference(input)));
  }

  @PostMapping("/employees/{employeeId}/movements")
  @Operation(operationId = "createEmployeeMovement", summary = "Soumettre un changement RH effectif-daté")
  public ResponseEntity<Map<String, Object>> createEmployeeMovement(
      @PathVariable UUID employeeId, @RequestBody Map<String, Object> input) {
    UUID id = query.createEmployeeMovement(employeeId, input);
    return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("id", id, "status", "pending"));
  }

  @PostMapping("/employee-movements/{movementId}/approve")
  @Operation(operationId = "approveEmployeeMovement", summary = "Approuver un mouvement RH soumis par un autre utilisateur")
  public Map<String, Object> approveEmployeeMovement(
      @PathVariable UUID movementId, @RequestBody(required = false) Map<String, String> input) {
    query.approveEmployeeMovement(movementId, input == null ? null : input.get("reason"));
    return Map.of("id", movementId, "status", "approved");
  }

  @PostMapping("/employee-movements/{movementId}/reject")
  @Operation(operationId = "rejectEmployeeMovement", summary = "Rejeter un mouvement RH avec motif")
  public Map<String, Object> rejectEmployeeMovement(@PathVariable UUID movementId, @RequestBody Map<String, String> input) {
    query.rejectEmployeeMovement(movementId, input.get("reason"));
    return Map.of("id", movementId, "status", "rejected");
  }

  @PutMapping("/employees/{id}")
  @Operation(operationId = "updateHrEmployee", summary = "Modifier les données non historiques d'un salarié")
  public Map<String, UUID> updateEmployee(@PathVariable UUID id, @RequestBody Map<String, Object> payload) {
    payload.put("id", id.toString());
    return Map.of("id", query.saveEmployee(payload));
  }

  @GetMapping("/payroll/settings")
  @Operation(operationId = "getHrPayrollSettings", summary = "Lire les paramètres de paie")
  public Map<String, Object> payrollSettings() {
    return query.payrollSettings();
  }

  @PutMapping("/payroll/settings")
  @Operation(operationId = "saveHrPayrollSettings", summary = "Modifier les barèmes de paie de la société")
  public Map<String, Object> savePayrollSettings(@RequestBody Map<String, Object> input) {
    return query.savePayrollSettings(input);
  }

  @PostMapping("/payroll/settings/confirm")
  @Operation(operationId = "confirmHrPayrollSettings", summary = "Confirmer les barèmes renseignés")
  public Map<String, Object> confirmPayrollSettings() {
    return Map.of("rules_validated_at", query.confirmPayrollRules());
  }

  @GetMapping("/payroll/runs")
  @Operation(operationId = "listHrPayrollRuns", summary = "Lister les cycles visibles de la société courante")
  public List<Map<String, Object>> payrollRuns() {
    return query.payrollRuns();
  }

  @GetMapping("/payroll/register")
  @Operation(operationId = "getHrPayrollRegister", summary = "Lire le registre des paies comptabilisées")
  public List<Map<String, Object>> payrollRegister(@RequestParam String from, @RequestParam String to) {
    return query.payrollRegister(from, to);
  }

  @PostMapping("/payroll/runs")
  @Operation(operationId = "createHrPayrollRun", summary = "Créer un cycle de paie")
  public ResponseEntity<Map<String, UUID>> createPayrollRun(@RequestBody Map<String, String> input) {
    UUID id = query.createPayrollRun(input.get("period"), input.get("pay_date"));
    return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("id", id));
  }

  @GetMapping("/payroll/runs/{id}/lines")
  @Operation(operationId = "listHrPayrollLines", summary = "Lire les lignes d'un cycle")
  public List<Map<String, Object>> payrollLines(@PathVariable UUID id) {
    return query.payrollLines(id);
  }

  @PostMapping("/payroll/runs/{id}/generate")
  @Operation(operationId = "generateHrPayrollLines", summary = "Calculer les lignes d'un cycle brouillon")
  public Map<String, Integer> generate(@PathVariable UUID id) {
    return Map.of("count", query.generatePayrollLines(id));
  }

  @GetMapping("/payroll/runs/{id}/component-lines")
  @Operation(operationId = "listHrPayrollComponentLines", summary = "Lire les lignes détaillées et photographiées d'un cycle")
  public List<Map<String, Object>> payrollComponentLines(
      @PathVariable UUID id, @RequestParam(required = false) UUID employeeId) {
    return query.payrollComponentLines(id, employeeId);
  }

  @GetMapping("/payroll/runs/{id}/variables")
  @Operation(operationId = "listHrPayrollVariables", summary = "Lister les éléments variables d'un cycle")
  public List<Map<String, Object>> payrollRunVariables(@PathVariable UUID id) {
    return query.payrollRunVariables(id);
  }

  @PostMapping("/payroll/runs/{id}/variables")
  @Operation(operationId = "createHrPayrollVariable", summary = "Saisir un élément variable à approuver")
  public ResponseEntity<Map<String, UUID>> createPayrollRunVariable(
      @PathVariable UUID id, @RequestBody Map<String, Object> input) {
    return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("id", query.createPayrollRunVariable(id, input)));
  }

  @PostMapping("/payroll/variables/{variableId}/approve")
  @Operation(operationId = "approveHrPayrollVariable", summary = "Approuver une variable de paie par un tiers")
  public Map<String, Object> approvePayrollVariable(@PathVariable UUID variableId,
      @RequestBody(required = false) Map<String, String> input) {
    query.decidePayrollRunVariable(variableId, true, input == null ? null : input.get("reason"));
    return Map.of("id", variableId, "status", "approved");
  }

  @PostMapping("/payroll/variables/{variableId}/reject")
  @Operation(operationId = "rejectHrPayrollVariable", summary = "Rejeter une variable de paie avec motif")
  public Map<String, Object> rejectPayrollVariable(@PathVariable UUID variableId,
      @RequestBody Map<String, String> input) {
    query.decidePayrollRunVariable(variableId, false, input.get("reason"));
    return Map.of("id", variableId, "status", "rejected");
  }

  @PostMapping("/payroll/runs/{id}/approve")
  @Operation(operationId = "approveHrPayrollRun", summary = "Approuver un cycle calculé")
  public Map<String, String> approve(@PathVariable UUID id) {
    query.approvePayrollRun(id);
    return Map.of("status", "approved");
  }

  @PostMapping("/payroll/runs/{id}/precheck")
  @Operation(operationId = "precheckHrPayrollRun", summary = "Enregistrer le précontrôle d'un cycle avant approbation")
  public Map<String, Object> precheck(@PathVariable UUID id) {
    return query.precheckPayrollRun(id);
  }

  @GetMapping("/payroll/runs/{id}/prechecks")
  @Operation(operationId = "listHrPayrollPrechecks", summary = "Lire les précontrôles immuables d'un cycle")
  public List<Map<String, Object>> prechecks(@PathVariable UUID id) {
    return query.payrollRunPrechecks(id);
  }

  @PostMapping("/payroll/runs/{id}/post")
  @Operation(operationId = "postHrPayrollRun", summary = "Comptabiliser un cycle approuvé")
  public Map<String, UUID> post(@PathVariable UUID id) {
    return Map.of("journal_entry_id", query.postPayrollRun(id));
  }

  @GetMapping("/payroll/runs/{id}/audit")
  @Operation(operationId = "listHrPayrollRunAudit", summary = "Lire la piste d'audit d'un cycle")
  public Map<String, Object> audit(
      @PathVariable UUID id,
      @RequestParam(defaultValue = "all") String eventType,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "10") int pageSize) {
    if (!AUDIT_EVENTS.contains(eventType)) {
      throw new HrRefusal(HttpStatus.BAD_REQUEST, "Type d'événement inconnu");
    }
    return query.payrollRunAudit(id, eventType, page, pageSize);
  }

  @GetMapping("/payroll/posting-accounts")
  @Operation(operationId = "getHrPayrollPostingAccounts", summary = "Lire les comptes comptables de paie paramétrés")
  public Map<String, String> postingAccounts() {
    return query.payrollPostingAccounts();
  }

  @GetMapping("/payroll/components")
  @Operation(operationId = "listHrPayrollComponents", summary = "Lister les rubriques de paie configurées")
  public List<Map<String, Object>> payrollComponents(@RequestParam(defaultValue = "false") boolean includeInactive) {
    return query.payrollComponents(includeInactive);
  }

  @PostMapping("/payroll/components")
  @Operation(operationId = "saveHrPayrollComponent", summary = "Créer ou modifier une rubrique de paie")
  public ResponseEntity<Map<String, UUID>> savePayrollComponent(@RequestBody Map<String, Object> input) {
    return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("id", query.savePayrollComponent(input)));
  }

  @GetMapping("/employees/{employeeId}/payroll-components")
  @Operation(operationId = "listEmployeePayrollComponents", summary = "Lister les rubriques affectées à un salarié")
  public List<Map<String, Object>> employeePayrollComponents(@PathVariable UUID employeeId) {
    return query.employeePayrollComponents(employeeId);
  }

  @PostMapping("/employees/{employeeId}/payroll-components")
  @Operation(operationId = "saveEmployeePayrollComponent", summary = "Affecter une rubrique à un salarié")
  public ResponseEntity<Map<String, UUID>> saveEmployeePayrollComponent(
      @PathVariable UUID employeeId, @RequestBody Map<String, Object> input) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(Map.of("id", query.saveEmployeePayrollComponent(employeeId, input)));
  }

  @ExceptionHandler(HrRefusal.class)
  public ResponseEntity<Map<String, String>> refused(HrRefusal refusal) {
    return ResponseEntity.status(refusal.status()).body(Map.of("error", refusal.getMessage()));
  }

  /** Les codes de refus SQL connus deviennent des réponses fonctionnelles sans détail salarié dans le log. */
  @ExceptionHandler(DataAccessException.class)
  public ResponseEntity<Map<String, String>> database(DataAccessException error) {
    String state = null;
    for (Throwable cause = error; cause != null && state == null; cause = cause.getCause()) {
      if (cause instanceof SQLException sql) state = sql.getSQLState();
    }
    HttpStatus status = switch (state == null ? "" : state) {
      case "42501" -> HttpStatus.FORBIDDEN;
      case "QG028", "22023" -> HttpStatus.UNPROCESSABLE_ENTITY;
      case "23505", "23514" -> HttpStatus.CONFLICT;
      default -> HttpStatus.CONFLICT;
    };
    LOG.warn("Opération RH/Paie refusée par la base (SQLSTATE {})", state);
    String message = status == HttpStatus.FORBIDDEN
        ? "Droit RH insuffisant dans la société courante"
        : status == HttpStatus.UNPROCESSABLE_ENTITY
            ? "Les données ne respectent pas les règles RH/Paie configurées"
            : "Opération RH/Paie impossible dans l'état actuel";
    return ResponseEntity.status(status).body(Map.of("error", message));
  }
}
