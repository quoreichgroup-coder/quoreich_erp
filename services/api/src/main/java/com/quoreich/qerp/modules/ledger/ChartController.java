package com.quoreich.qerp.modules.ledger;

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
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * Plans comptables (V60–V69, V105) : référentiels et règles de qualité, import guidé, correspondances et plans
 * secondaires, migration du plan opérationnel, audit du plan, jeux de comptes. Les opérations passent par les
 * fonctions de la base, chacune avec ses droits ; la route d'action n'accepte que la liste ci-dessous.
 */
@RestController
@RequestMapping("/api/v1/gl/charts")
@Tag(name = "Plans comptables", description = "Référentiels, qualité, import, correspondances, migration, audit du plan, jeux de comptes")
public class ChartController {

  /** Fonctions de la base appelables par la route d'action (arguments nommés de la fonction). */
  static final Set<String> ACTIONS = Set.of(
      "prepare_chart_import", "update_chart_import_row", "validate_chart_import", "cancel_chart_import",
      "create_secondary_chart", "create_chart_mapping", "propose_chart_mapping", "set_chart_mapping_lines", "decide_chart_mapping_lines",
      "validate_chart_mapping", "archive_chart_mapping", "compare_chart_mapping", "mapped_trial_balance", "import_chart_mapping_lines",
      "simulate_chart_migration", "apply_chart_migration", "cancel_chart_migration",
      "chart_of_accounts_issues", "replace_gl_account", "reclassify_gl_account_balance", "create_syscohada_headings", "link_gl_account_parents",
      "apply_accounting_framework");
  static final Set<String> IMPORT_SETTINGS = Set.of("require_second_person", "allow_label_updates", "mapping_second_person", "migration_second_person", "updated_at");
  static final Set<String> SET = Set.of("kind", "code", "name", "is_active");
  private static final Map<String, String> MEMBERS = Map.of("customer", "customers", "supplier", "suppliers", "item", "items");
  private static final ObjectMapper JSON = new ObjectMapper();

  private final Sql sql;

  public ChartController(Sql sql) {
    this.sql = sql;
  }

  @PostMapping("/actions/{function}")
  @Operation(operationId = "runChartAction", summary = "Opération sur les plans comptables (fonction de la liste autorisée, arguments nommés)")
  public JsonNode action(@PathVariable String function, @RequestBody(required = false) Map<String, Object> args) {
    if (!ACTIONS.contains(function)) throw new ApiRefusal(404, "Opération inconnue : " + function);
    return sql.call(function, args == null ? Map.of() : args);
  }

  // ─── Référentiels et qualité ───

  @GetMapping("/frameworks")
  @Operation(operationId = "listChartFrameworks", summary = "Référentiels, versions et nombre de comptes de référence")
  public JsonNode frameworks() {
    ObjectNode out = JSON.createObjectNode();
    out.set("frameworks", sql.list("SELECT * FROM public.accounting_frameworks ORDER BY code"));
    out.set("versions", sql.list("SELECT * FROM public.framework_versions ORDER BY effective_from DESC"));
    out.set("references", sql.list("SELECT framework_code FROM public.framework_reference_accounts"));
    return out;
  }

  @GetMapping("/operational")
  @Operation(operationId = "getOperationalChart", summary = "Plan opérationnel actif de la société")
  public JsonNode operational() {
    return sql.one("SELECT id, name, framework_code, framework_version FROM public.charts WHERE tenant_id = public.get_user_tenant_id(auth.uid())"
        + " AND kind = 'operational' AND status = 'active'");
  }

  @GetMapping("/quality-rules")
  @Operation(operationId = "listQualityRules", summary = "Règles de qualité du référentiel et choix de la société")
  public JsonNode qualityRules(@RequestParam String framework) {
    ObjectNode out = JSON.createObjectNode();
    out.set("rules", sql.list("SELECT * FROM public.framework_quality_rules WHERE framework_code = ? ORDER BY rule_code", framework));
    out.set("tenant", sql.list("SELECT rule_code, enabled, severity FROM public.tenant_quality_rules WHERE tenant_id = public.get_user_tenant_id(auth.uid())"));
    return out;
  }

  @PutMapping("/quality-rules/{rule}")
  @Operation(operationId = "saveQualityRule", summary = "Activer, désactiver ou changer la gravité d'une règle (droit accounting.chart_admin)")
  public JsonNode saveRule(@PathVariable String rule, @RequestBody Map<String, Object> body) {
    Map<String, Object> b = new LinkedHashMap<>(body);
    b.put("rule_code", rule);
    b.put("updated_at", java.time.OffsetDateTime.now().toString());
    return sql.upsert("tenant_quality_rules", b, Set.of("rule_code", "enabled", "severity", "updated_at"), List.of("tenant_id", "rule_code"));
  }

  @DeleteMapping("/quality-rules/{rule}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  @Operation(operationId = "resetQualityRule", summary = "Revenir au réglage du référentiel")
  public void resetRule(@PathVariable String rule) {
    sql.deleteWhere("tenant_quality_rules", "tenant_id = public.get_user_tenant_id(auth.uid()) AND rule_code = ?", rule);
  }

  // ─── Import ───

  @GetMapping("/import/profiles")
  @Operation(operationId = "listImportProfiles", summary = "Formats d'import (plateforme et société)")
  public JsonNode profiles() {
    return sql.list("SELECT * FROM public.import_profiles ORDER BY tenant_id NULLS FIRST, name");
  }

  @GetMapping("/import/runs")
  @Operation(operationId = "listChartImportRuns", summary = "Imports du plan (50 derniers)")
  public JsonNode runs() {
    return sql.list("SELECT * FROM public.chart_import_runs ORDER BY created_at DESC LIMIT 50");
  }

  @GetMapping("/import/runs/{id}/rows")
  @Operation(operationId = "listChartImportRows", summary = "Lignes d'un import")
  public JsonNode rows(@PathVariable UUID id) {
    return sql.list("SELECT * FROM public.chart_import_rows WHERE run_id = ?::uuid ORDER BY line_no", id.toString());
  }

  @GetMapping("/import/settings")
  @Operation(operationId = "getChartImportSettings", summary = "Règles de double contrôle des imports, correspondances et migrations")
  public JsonNode importSettings() {
    return sql.one("SELECT require_second_person, allow_label_updates, mapping_second_person, migration_second_person FROM public.chart_import_settings"
        + " WHERE tenant_id = public.get_user_tenant_id(auth.uid())");
  }

  @PutMapping("/import/settings")
  @Operation(operationId = "saveChartImportSettings", summary = "Enregistrer les règles de double contrôle (droit accounting.chart_admin)")
  public JsonNode saveImportSettings(@RequestBody Map<String, Object> body) {
    Map<String, Object> b = new LinkedHashMap<>(body);
    b.put("updated_at", java.time.OffsetDateTime.now().toString());
    return sql.upsert("chart_import_settings", b, IMPORT_SETTINGS, List.of("tenant_id"));
  }

  // ─── Correspondances, plans secondaires, migrations ───

  @GetMapping("/secondary")
  @Operation(operationId = "listSecondaryCharts", summary = "Plans secondaires")
  public JsonNode secondary() {
    return sql.list("SELECT id, code, name, framework_code, framework_version, status FROM public.charts WHERE tenant_id = public.get_user_tenant_id(auth.uid())"
        + " AND kind = 'secondary' ORDER BY code");
  }

  @GetMapping("/mappings")
  @Operation(operationId = "listChartMappings", summary = "Correspondances entre plans")
  public JsonNode mappings() {
    return sql.list("SELECT * FROM public.chart_mappings ORDER BY created_at DESC");
  }

  @GetMapping("/mappings/{id}/proposers")
  @Operation(operationId = "listChartMappingProposers", summary = "Auteur et commentaire de chaque ligne d'une correspondance")
  public JsonNode proposers(@PathVariable UUID id) {
    return sql.list("SELECT id, proposed_by, comment FROM public.chart_mapping_lines WHERE mapping_id = ?::uuid", id.toString());
  }

  @GetMapping("/migrations")
  @Operation(operationId = "listChartMigrations", summary = "Migrations du plan opérationnel (30 dernières)")
  public JsonNode migrations() {
    return sql.list("SELECT * FROM public.chart_migrations ORDER BY simulated_at DESC LIMIT 30");
  }

  // ─── Jeux de comptes (V105) ───

  @GetMapping("/account-sets/roles")
  @Operation(operationId = "listPostingRoleSetKinds", summary = "Rôles admis par type de jeu")
  public JsonNode setRoles() {
    return sql.list("SELECT kind, role_code, control FROM public.posting_role_set_kinds ORDER BY role_code");
  }

  @GetMapping("/account-sets")
  @Operation(operationId = "listAccountSets", summary = "Jeux de comptes avec leurs lignes et leur nombre de fiches")
  public JsonNode sets(@RequestParam(required = false) String kind) {
    StringBuilder members = new StringBuilder("0");
    for (Map.Entry<String, String> m : MEMBERS.entrySet()) {
      members.append(" + CASE WHEN s.kind = '").append(m.getKey()).append("' THEN (SELECT count(*) FROM public.").append(m.getValue())
          .append(" x WHERE x.account_set_id = s.id) ELSE 0 END");
    }
    return sql.list("SELECT s.id, s.kind, s.code, s.name, s.is_active, (" + members + ") AS members,"
        + " coalesce((SELECT jsonb_agg(jsonb_build_object('role_code', l.role_code, 'gl_account_id', l.gl_account_id)) FROM public.posting_account_set_lines l WHERE l.set_id = s.id), '[]'::jsonb) AS lines"
        + " FROM public.posting_account_sets s WHERE (?::text IS NULL OR s.kind = ?::text) ORDER BY s.code", kind, kind);
  }

  @PostMapping("/account-sets")
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(operationId = "createAccountSet", summary = "Créer un jeu de comptes (droit accounting.account_sets)")
  public JsonNode createSet(@RequestBody Map<String, Object> body) {
    return sql.insert("posting_account_sets", body, SET, Map.of("created_by", "auth.uid()"));
  }

  @PatchMapping("/account-sets/{id}")
  @Operation(operationId = "updateAccountSet", summary = "Modifier un jeu de comptes")
  public JsonNode updateSet(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
    return sql.update("posting_account_sets", id, body, Set.of("name", "is_active"));
  }

  @DeleteMapping("/account-sets/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  @Operation(operationId = "deleteAccountSet", summary = "Supprimer un jeu non utilisé")
  public void deleteSet(@PathVariable UUID id) {
    sql.delete("posting_account_sets", id);
  }

  @PutMapping("/account-sets/{id}/roles/{role}")
  @Operation(operationId = "setAccountSetLine", summary = "Compte d'un rôle dans un jeu (vide = compte de la société)")
  public JsonNode setLine(@PathVariable UUID id, @PathVariable String role, @RequestBody Map<String, Object> body) {
    Object account = body.get("gl_account_id");
    if (account == null || "".equals(account)) {
      sql.deleteWhere("posting_account_set_lines", "set_id = ?::uuid AND role_code = ?", id.toString(), role);
      return tools.jackson.databind.node.NullNode.getInstance();
    }
    String kind = sql.value(String.class, "SELECT kind FROM public.posting_account_sets WHERE id = ?::uuid", id.toString());
    return sql.upsertWith("posting_account_set_lines", Sql.args("set_id", id, "kind", kind, "role_code", role, "gl_account_id", account,
        "updated_at", java.time.OffsetDateTime.now().toString()), Set.of("set_id", "kind", "role_code", "gl_account_id", "updated_at"),
        List.of("set_id", "role_code"), Map.of("updated_by", "auth.uid()"));
  }

  @GetMapping("/posting-settings")
  @Operation(operationId = "getPostingSettings", summary = "Verrouillage des comptes de contrôle")
  public JsonNode postingSettings() {
    return sql.one("SELECT lock_control_accounts FROM public.posting_settings WHERE tenant_id = public.get_user_tenant_id(auth.uid())");
  }

  @PutMapping("/posting-settings")
  @Operation(operationId = "savePostingSettings", summary = "Verrouiller ou non les comptes de contrôle (droit accounting.account_sets)")
  public JsonNode savePostingSettings(@RequestBody Map<String, Object> body) {
    return sql.upsertWith("posting_settings", Sql.args("lock_control_accounts", body.get("lock_control_accounts"), "updated_at", java.time.OffsetDateTime.now().toString()),
        Set.of("lock_control_accounts", "updated_at"), List.of("tenant_id"), Map.of("updated_by", "auth.uid()"));
  }
}
