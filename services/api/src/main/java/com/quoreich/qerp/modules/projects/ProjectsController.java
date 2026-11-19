package com.quoreich.qerp.modules.projects;

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
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

/** Projets (V111) : fiches (section analytique créée par la base), budget par compte, chiffres et grand livre, statut. */
@RestController
@RequestMapping("/api/v1/projects")
@Tag(name = "Projets", description = "Projets, budget par compte, réalisé, engagé et grand livre du projet")
public class ProjectsController {

  static final Set<String> ACTIONS = Set.of("project_set_status", "project_financials", "project_ledger", "assign_project_role");
  static final Set<String> PROJECT = Set.of("project_code", "name", "status", "description", "customer_id", "project_manager", "department", "start_date",
      "end_date", "completion_pct");
  static final Set<String> BUDGET = Set.of("project_id", "gl_account_id", "amount", "description");

  private final Sql sql;

  public ProjectsController(Sql sql) {
    this.sql = sql;
  }

  @PostMapping("/actions/{function}")
  @Operation(operationId = "runProjectsAction", summary = "Opération sur les projets (fonction de la liste autorisée, arguments nommés)")
  public JsonNode action(@PathVariable String function, @RequestBody(required = false) Map<String, Object> a) {
    if (!ACTIONS.contains(function)) throw new ApiRefusal(404, "Opération inconnue : " + function);
    return sql.call(function, a == null ? Map.of() : a);
  }

  @GetMapping
  @Operation(operationId = "listProjects", summary = "Projets avec le client")
  public JsonNode projects() {
    return sql.list("SELECT p.*, (SELECT to_jsonb(x) FROM (SELECT name FROM public.customers WHERE id = p.customer_id) x) AS customer"
        + " FROM public.projects p ORDER BY p.project_code");
  }

  @PostMapping
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(operationId = "createProject", summary = "Créer un projet (droit projects.manage ; axe des projets paramétré)")
  public JsonNode create(@RequestBody Map<String, Object> body) {
    Map<String, Object> b = new LinkedHashMap<>(body);
    b.putIfAbsent("status", "planned");
    if (b.get("completion_pct") == null) b.put("completion_pct", 0);
    return sql.insert("projects", b, PROJECT);
  }

  @PatchMapping("/{id}")
  @Operation(operationId = "updateProject", summary = "Modifier un projet (code et section figés)")
  public JsonNode update(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
    Map<String, Object> b = new LinkedHashMap<>(body);
    b.remove("project_code");
    b.remove("status");
    return sql.update("projects", id, b, PROJECT);
  }

  @GetMapping("/{id}/budget")
  @Operation(operationId = "listProjectBudget", summary = "Budget d'un projet par compte")
  public JsonNode budget(@PathVariable UUID id) {
    return sql.list("SELECT * FROM public.project_budget_lines WHERE project_id = ?::uuid", id.toString());
  }

  @PostMapping("/budget-lines")
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(operationId = "createProjectBudgetLine", summary = "Ajouter une ligne de budget (droit projects.budget)")
  public JsonNode createLine(@RequestBody Map<String, Object> body) {
    return sql.insert("project_budget_lines", body, BUDGET);
  }

  @PatchMapping("/budget-lines/{id}")
  @Operation(operationId = "updateProjectBudgetLine", summary = "Modifier une ligne de budget")
  public JsonNode updateLine(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
    return sql.update("project_budget_lines", id, body, BUDGET);
  }

  @DeleteMapping("/budget-lines/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  @Operation(operationId = "deleteProjectBudgetLine", summary = "Supprimer une ligne de budget")
  public void deleteLine(@PathVariable UUID id) {
    sql.delete("project_budget_lines", id);
  }

  @GetMapping("/settings")
  @Operation(operationId = "getProjectSettings", summary = "Paramètres des projets (axe analytique)")
  public JsonNode settings() {
    return sql.one("SELECT project_axis_id, include_requisitions_in_commitments FROM public.project_settings WHERE tenant_id = public.get_user_tenant_id(auth.uid())");
  }

  @PutMapping("/settings")
  @Operation(operationId = "saveProjectSettings", summary = "Enregistrer les paramètres des projets (droit projects.settings)")
  public JsonNode saveSettings(@RequestBody Map<String, Object> body) {
    Map<String, Object> b = new LinkedHashMap<>(body);
    b.put("updated_at", java.time.OffsetDateTime.now().toString());
    return sql.upsertWith("project_settings", b, Set.of("project_axis_id", "include_requisitions_in_commitments", "updated_at"), List.of("tenant_id"),
        Map.of("updated_by", "auth.uid()"));
  }

  @GetMapping("/role-audit")
  @Operation(operationId = "listProjectRoleAudit", summary = "Journal des rôles des projets")
  public JsonNode roleAudit() {
    return sql.list("SELECT * FROM public.project_role_audit ORDER BY created_at DESC LIMIT 500");
  }
}
