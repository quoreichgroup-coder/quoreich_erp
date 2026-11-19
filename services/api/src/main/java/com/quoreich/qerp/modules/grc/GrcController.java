package com.quoreich.qerp.modules.grc;

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

/**
 * Risques et conformité (V113) : registre, évaluations datées, actions, liens aux contrôles, paramètres ;
 * référentiels, contrôles, tests, constats. Cotations, états et constats ne changent que par les fonctions.
 */
@RestController
@Tag(name = "Risques et conformité", description = "Registre des risques, évaluations, actions ; référentiels, contrôles, tests et constats")
public class GrcController {

  static final Set<String> ACTIONS = Set.of("risk_assess", "risk_set_status", "compliance_record_test", "compliance_issue_update", "assign_risk_role",
      "assign_compliance_role");
  static final Set<String> RISK = Set.of("risk_code", "title", "description", "category", "category_id", "owner", "mitigation_plan", "review_date",
      "project_id", "treatment", "likelihood", "impact");
  static final Set<String> RISK_SETTINGS = Set.of("scale_max", "medium_from", "high_from", "critical_from", "appetite_score", "review_days", "updated_at");
  static final Set<String> FRAMEWORK = Set.of("name", "version", "description", "status");
  static final Set<String> CONTROL = Set.of("framework_id", "control_code", "title", "description", "category", "owner", "risk_level", "frequency",
      "test_procedure", "next_review_at", "is_active");
  private static final Map<String, String> LISTS = Map.of(
      "frameworks", "SELECT * FROM public.compliance_frameworks ORDER BY name",
      "controls", "SELECT * FROM public.compliance_controls ORDER BY control_code",
      "tests", "SELECT * FROM public.compliance_test_logs ORDER BY test_date DESC",
      "issues", "SELECT * FROM public.compliance_issues ORDER BY created_at DESC");

  private final Sql sql;

  public GrcController(Sql sql) {
    this.sql = sql;
  }

  @PostMapping("/api/v1/grc/actions/{function}")
  @Operation(operationId = "runGrcAction", summary = "Évaluation, statut, test, constat, rôles (fonction de la liste autorisée)")
  public JsonNode action(@PathVariable String function, @RequestBody(required = false) Map<String, Object> a) {
    if (!ACTIONS.contains(function)) throw new ApiRefusal(404, "Opération inconnue : " + function);
    return sql.call(function, a == null ? Map.of() : a);
  }

  // ─── Risques ───

  @GetMapping("/api/v1/risks")
  @Operation(operationId = "listRisks", summary = "Registre des risques")
  public JsonNode risks() {
    return sql.list("SELECT * FROM public.risk_register ORDER BY risk_code");
  }

  @PostMapping("/api/v1/risks")
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(operationId = "createRisk", summary = "Créer un risque (identifié ; droit risks.manage)")
  public JsonNode createRisk(@RequestBody Map<String, Object> body) {
    return sql.insert("risk_register", body, RISK);
  }

  @PatchMapping("/api/v1/risks/{id}")
  @Operation(operationId = "updateRisk", summary = "Modifier la fiche d'un risque (cotation et statut par les fonctions)")
  public JsonNode updateRisk(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
    Map<String, Object> b = new LinkedHashMap<>(body);
    for (String k : List.of("risk_code", "likelihood", "impact")) b.remove(k);
    return sql.update("risk_register", id, b, RISK);
  }

  @GetMapping("/api/v1/risks/assessments")
  @Operation(operationId = "listRiskAssessments", summary = "Évaluations (filtre facultatif par risque)")
  public JsonNode assessments(@RequestParam(required = false) UUID riskId) {
    String r = riskId == null ? null : riskId.toString();
    return sql.list("SELECT * FROM public.risk_assessments WHERE (?::uuid IS NULL OR risk_id = ?::uuid) ORDER BY created_at DESC", r, r);
  }

  @GetMapping("/api/v1/risks/actions")
  @Operation(operationId = "listRiskActions", summary = "Actions de traitement")
  public JsonNode actions() {
    return sql.list("SELECT * FROM public.risk_actions ORDER BY due_date NULLS LAST");
  }

  @PostMapping("/api/v1/risks/actions")
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(operationId = "createRiskAction", summary = "Ajouter une action de traitement")
  public JsonNode createAction(@RequestBody Map<String, Object> body) {
    return sql.insert("risk_actions", body, Set.of("risk_id", "title", "owner", "due_date", "notes"), Map.of("created_by", "auth.uid()"));
  }

  @PatchMapping("/api/v1/risks/actions/{id}")
  @Operation(operationId = "updateRiskAction", summary = "Clore ou abandonner une action")
  public JsonNode updateAction(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
    return "done".equals(body.get("status"))
        ? sql.updateWith("risk_actions", Map.of("status", "done"), Set.of("status"), Map.of("done_at", "now()"), "id = ?::uuid", id.toString())
        : sql.update("risk_actions", id, body, Set.of("status", "title", "owner", "due_date", "notes"));
  }

  @GetMapping("/api/v1/risks/control-links")
  @Operation(operationId = "listRiskControlLinks", summary = "Contrôles rattachés aux risques")
  public JsonNode links() {
    return sql.list("SELECT risk_id, control_id FROM public.risk_control_links");
  }

  @PostMapping("/api/v1/risks/control-links")
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(operationId = "linkRiskControl", summary = "Rattacher un contrôle à un risque")
  public JsonNode link(@RequestBody Map<String, Object> body) {
    return sql.insert("risk_control_links", body, Set.of("risk_id", "control_id"));
  }

  @DeleteMapping("/api/v1/risks/{riskId}/control-links/{controlId}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  @Operation(operationId = "unlinkRiskControl", summary = "Retirer un contrôle d'un risque")
  public void unlink(@PathVariable UUID riskId, @PathVariable UUID controlId) {
    sql.deleteWhere("risk_control_links", "risk_id = ?::uuid AND control_id = ?::uuid", riskId.toString(), controlId.toString());
  }

  @GetMapping("/api/v1/risks/categories")
  @Operation(operationId = "listRiskCategories", summary = "Catégories de risques")
  public JsonNode categories() {
    return sql.list("SELECT * FROM public.risk_categories ORDER BY code");
  }

  @PutMapping("/api/v1/risks/categories")
  @Operation(operationId = "saveRiskCategory", summary = "Créer ou modifier une catégorie (droit risks.settings)")
  public JsonNode saveCategory(@RequestBody Map<String, Object> body) {
    Object id = body.get("id");
    Set<String> cols = Set.of("code", "name", "is_active");
    return id == null ? sql.insert("risk_categories", body, cols) : sql.update("risk_categories", UUID.fromString(String.valueOf(id)), body, cols);
  }

  @GetMapping("/api/v1/risks/settings")
  @Operation(operationId = "getRiskSettings", summary = "Échelle, seuils et appétence")
  public JsonNode riskSettings() {
    return sql.one("SELECT * FROM public.risk_settings WHERE tenant_id = public.get_user_tenant_id(auth.uid())");
  }

  @PutMapping("/api/v1/risks/settings")
  @Operation(operationId = "saveRiskSettings", summary = "Enregistrer l'échelle et les seuils (droit risks.settings)")
  public JsonNode saveRiskSettings(@RequestBody Map<String, Object> body) {
    Map<String, Object> b = new LinkedHashMap<>(body);
    b.put("updated_at", java.time.OffsetDateTime.now().toString());
    return sql.upsertWith("risk_settings", b, RISK_SETTINGS, List.of("tenant_id"), Map.of("updated_by", "auth.uid()"));
  }

  // ─── Conformité ───

  @GetMapping("/api/v1/compliance/{list}")
  @Operation(operationId = "listCompliance", summary = "Référentiels, contrôles, tests ou constats")
  public JsonNode list(@PathVariable String list) {
    String q = LISTS.get(list);
    if (q == null) throw new ApiRefusal(404, "Liste inconnue : " + list);
    return sql.list(q);
  }

  @PutMapping("/api/v1/compliance/frameworks")
  @Operation(operationId = "saveComplianceFramework", summary = "Créer ou modifier un référentiel (droit compliance.manage)")
  public JsonNode saveFramework(@RequestBody Map<String, Object> body) {
    Object id = body.get("id");
    return id == null ? sql.insert("compliance_frameworks", body, FRAMEWORK) : sql.update("compliance_frameworks", UUID.fromString(String.valueOf(id)), body, FRAMEWORK);
  }

  @PutMapping("/api/v1/compliance/controls")
  @Operation(operationId = "saveComplianceControl", summary = "Créer ou modifier un contrôle (état par les tests)")
  public JsonNode saveControl(@RequestBody Map<String, Object> body) {
    Object id = body.get("id");
    if (id == null) return sql.insert("compliance_controls", body, CONTROL);
    Map<String, Object> b = new LinkedHashMap<>(body);
    b.remove("framework_id");
    b.remove("control_code");
    return sql.update("compliance_controls", UUID.fromString(String.valueOf(id)), b, CONTROL);
  }

  @GetMapping("/api/v1/compliance/settings")
  @Operation(operationId = "getComplianceSettings", summary = "Paramètres de la conformité")
  public JsonNode complianceSettings() {
    return sql.one("SELECT issue_second_person FROM public.compliance_settings WHERE tenant_id = public.get_user_tenant_id(auth.uid())");
  }

  @PutMapping("/api/v1/compliance/settings")
  @Operation(operationId = "saveComplianceSettings", summary = "Enregistrer les paramètres (droit compliance.settings)")
  public JsonNode saveComplianceSettings(@RequestBody Map<String, Object> body) {
    Map<String, Object> b = new LinkedHashMap<>(body);
    b.put("updated_at", java.time.OffsetDateTime.now().toString());
    return sql.upsertWith("compliance_settings", b, Set.of("issue_second_person", "updated_at"), List.of("tenant_id"), Map.of("updated_by", "auth.uid()"));
  }

  @GetMapping("/api/v1/grc/role-audit/{module}")
  @Operation(operationId = "listGrcRoleAudit", summary = "Journal des rôles (risk ou compliance)")
  public JsonNode roleAudit(@PathVariable String module) {
    String t = switch (module) {
      case "risk" -> "risk_role_audit";
      case "compliance" -> "compliance_role_audit";
      default -> throw new ApiRefusal(404, "Module inconnu : " + module);
    };
    return sql.list("SELECT * FROM public." + t + " ORDER BY created_at DESC LIMIT 500");
  }
}
