package com.quoreich.qerp.modules.admin;

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
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

/**
 * Administration de la société : licences (lecture), modules (administrateur, par la RLS), règles de flux,
 * invitations (fonctions V31) et rattachement à une société (création ou code d'invitation).
 */
@RestController
@RequestMapping("/api/v1/admin")
@Tag(name = "Administration", description = "Licences, modules, règles de flux, invitations, rattachement à une société")
public class AdminController {

  private static final Set<String> MODULE_FIELDS = Set.of("module_name", "status", "activated_at", "deactivated_at", "license_id", "updated_at");

  private final Sql sql;

  public AdminController(Sql sql) {
    this.sql = sql;
  }

  @GetMapping("/licenses")
  @Operation(operationId = "listLicenses", summary = "Licences de la société")
  public JsonNode licenses() {
    return sql.list("SELECT * FROM public.licenses ORDER BY module_name");
  }

  @GetMapping("/modules")
  @Operation(operationId = "listTenantModules", summary = "Modules de la société et leur statut")
  public JsonNode modules() {
    return sql.list("SELECT * FROM public.tenant_modules ORDER BY module_name");
  }

  @PostMapping("/modules/{module}/activate")
  @Operation(operationId = "activateModule", summary = "Activer un module (administrateur de la société)")
  public JsonNode activate(@PathVariable String module, @RequestBody(required = false) Map<String, Object> b) {
    Map<String, Object> row = new LinkedHashMap<>();
    row.put("module_name", module);
    row.put("status", "active");
    row.put("license_id", b == null ? null : b.get("licenseId"));
    return sql.upsertWith("tenant_modules", row, MODULE_FIELDS, List.of("tenant_id", "module_name"),
        Map.of("activated_at", "now()", "updated_at", "now()", "activated_by", "auth.uid()::text"));
  }

  @PostMapping("/modules/{module}/deactivate")
  @Operation(operationId = "deactivateModule", summary = "Désactiver un module (administrateur de la société)")
  public JsonNode deactivate(@PathVariable String module) {
    return sql.updateWith("tenant_modules", Map.of("status", "inactive"), MODULE_FIELDS, Map.of("deactivated_at", "now()", "updated_at", "now()"),
        "tenant_id = public.get_user_tenant_id(auth.uid()) AND module_name = ?", module);
  }

  @GetMapping("/workflow-rules")
  @Operation(operationId = "listWorkflowRules", summary = "Règles de flux de la société")
  public JsonNode workflowRules() {
    return sql.list("SELECT * FROM public.workflow_rules ORDER BY created_at DESC");
  }

  @GetMapping("/invitations")
  @Operation(operationId = "listInvitations", summary = "Invitations de la société (administrateurs)")
  public JsonNode invitations() {
    return sql.list("SELECT id, code, role_id, note, created_at, expires_at, used_at, used_by, revoked_at FROM public.tenant_invitations ORDER BY created_at DESC LIMIT 200");
  }

  @PostMapping("/invitations")
  @Operation(operationId = "createInvitation", summary = "Émettre un code d'invitation (rôle, durée 1 à 30 jours, note)")
  public JsonNode createInvitation(@RequestBody Map<String, Object> b) {
    return sql.call("create_tenant_invitation", args("_role_id", b.get("roleId"), "_valid_days", b.get("validDays"), "_note", b.get("note")));
  }

  @PostMapping("/invitations/{id}/revoke")
  @Operation(operationId = "revokeInvitation", summary = "Révoquer une invitation")
  public JsonNode revokeInvitation(@PathVariable UUID id) {
    return sql.call("revoke_tenant_invitation", args("_id", id));
  }

  @PostMapping("/onboarding/{mode}")
  @Operation(operationId = "joinOrCreateTenant", summary = "Créer sa société (create) ou la rejoindre par un code d'invitation (join)")
  public JsonNode onboarding(@PathVariable String mode, @RequestBody Map<String, Object> b) {
    String fn = switch (mode) {
      case "create" -> "create_tenant_for_user";
      case "join" -> "join_tenant";
      default -> throw new ApiRefusal(404, "Opération inconnue : " + mode);
    };
    return sql.call(fn, args("_tenant_name", b.get("value")));
  }
}
