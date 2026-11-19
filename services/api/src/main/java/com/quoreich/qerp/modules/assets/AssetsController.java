package com.quoreich.qerp.modules.assets;

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
 * Immobilisations (V75) : catégories (comptes contrôlés par la base), fiches, registre, amortissements
 * (calcul, contre-passation), cessions, paramètres. Les montants cumulés et la VNC sont tenus par la base.
 */
@RestController
@RequestMapping("/api/v1/assets")
@Tag(name = "Immobilisations", description = "Catégories, fiches, amortissements, cessions et paramètres")
public class AssetsController {

  static final Set<String> ACTIONS = Set.of("run_depreciation", "reverse_last_depreciation", "dispose_asset", "assign_fixed_asset_role");
  static final Set<String> ASSET = Set.of("asset_code", "name", "category_id", "acquisition_date", "acquisition_cost", "salvage_value", "useful_life_months",
      "depreciation_method", "location", "assigned_to", "warranty_expiry", "next_maintenance", "in_service_date", "opening_accumulated", "opening_date");
  static final Set<String> CATEGORY = Set.of("name", "depreciation_method", "useful_life_years", "gl_asset_account_id", "gl_depreciation_account_id", "gl_expense_account_id");
  static final Set<String> SETTINGS = Set.of("declining_coef_short", "declining_coef_mid", "declining_coef_long", "first_month_prorata", "updated_at");

  private final Sql sql;

  public AssetsController(Sql sql) {
    this.sql = sql;
  }

  @PostMapping("/actions/{function}")
  @Operation(operationId = "runAssetsAction", summary = "Opération sur les immobilisations (fonction de la liste autorisée, arguments nommés)")
  public JsonNode action(@PathVariable String function, @RequestBody(required = false) Map<String, Object> a) {
    if (!ACTIONS.contains(function)) throw new ApiRefusal(404, "Opération inconnue : " + function);
    return sql.call(function, a == null ? Map.of() : a);
  }

  @GetMapping("/categories")
  @Operation(operationId = "listAssetCategories", summary = "Catégories d'immobilisations")
  public JsonNode categories() {
    return sql.list("SELECT * FROM public.asset_categories ORDER BY name");
  }

  @PostMapping("/categories")
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(operationId = "createAssetCategory", summary = "Créer une catégorie (droit assets.settings ; comptes 2x / 28x / 68x)")
  public JsonNode createCategory(@RequestBody Map<String, Object> body) {
    return sql.insert("asset_categories", body, CATEGORY);
  }

  @PatchMapping("/categories/{id}")
  @Operation(operationId = "updateAssetCategory", summary = "Modifier une catégorie")
  public JsonNode updateCategory(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
    return sql.update("asset_categories", id, body, CATEGORY);
  }

  @GetMapping
  @Operation(operationId = "listAssets", summary = "Immobilisations avec leur catégorie")
  public JsonNode assets() {
    return sql.list("SELECT a.*, (SELECT to_jsonb(x) FROM (SELECT name FROM public.asset_categories WHERE id = a.category_id) x) AS category"
        + " FROM public.assets a ORDER BY a.asset_code");
  }

  @PostMapping
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(operationId = "createAsset", summary = "Créer une immobilisation (droit assets.manage ; cumul et VNC calculés)")
  public JsonNode createAsset(@RequestBody Map<String, Object> body) {
    return sql.insert("assets", body, ASSET, Map.of("created_by", "auth.uid()"));
  }

  @GetMapping("/register")
  @Operation(operationId = "listAssetRegister", summary = "Registre des immobilisations")
  public JsonNode register() {
    return sql.list("SELECT * FROM public.fixed_assets_register_view ORDER BY acquisition_date DESC");
  }

  @GetMapping("/kpis")
  @Operation(operationId = "getAssetKpis", summary = "Indicateurs des immobilisations")
  public JsonNode kpis() {
    return sql.one("SELECT * FROM public.asset_kpis_view");
  }

  @GetMapping("/disposals")
  @Operation(operationId = "listAssetDisposals", summary = "Cessions et mises au rebut")
  public JsonNode disposals() {
    return sql.list("SELECT * FROM public.asset_disposals ORDER BY disposal_date DESC");
  }

  @GetMapping("/depreciation-runs")
  @Operation(operationId = "listDepreciationRuns", summary = "Calculs d'amortissement (24 derniers)")
  public JsonNode runs() {
    return sql.list("SELECT * FROM public.depreciation_runs ORDER BY period DESC LIMIT 24");
  }

  @GetMapping("/depreciation-entries")
  @Operation(operationId = "listDepreciationEntries", summary = "Dotations (filtres facultatifs : immobilisation, plage de dates), avec l'immobilisation et la pièce")
  public JsonNode entries(@RequestParam(required = false) UUID assetId, @RequestParam(required = false) String from, @RequestParam(required = false) String to) {
    String a = assetId == null ? null : assetId.toString();
    return sql.list("SELECT d.*, (SELECT to_jsonb(x) FROM (SELECT name, asset_code, depreciation_method FROM public.assets WHERE id = d.asset_id) x) AS asset,"
        + " (SELECT to_jsonb(x) FROM (SELECT piece_number FROM public.journal_entries WHERE id = d.journal_entry_id) x) AS entry FROM public.depreciation_entries d"
        + " WHERE (?::uuid IS NULL OR d.asset_id = ?::uuid) AND (?::date IS NULL OR d.period_date >= ?::date) AND (?::date IS NULL OR d.period_date <= ?::date)"
        + " ORDER BY d.period_date " + (a == null ? "DESC" : "ASC"), a, a, from, from, to, to);
  }

  @GetMapping("/settings")
  @Operation(operationId = "getAssetSettings", summary = "Paramètres des amortissements")
  public JsonNode settings() {
    return sql.one("SELECT * FROM public.asset_settings WHERE tenant_id = public.get_user_tenant_id(auth.uid())");
  }

  @PutMapping("/settings")
  @Operation(operationId = "saveAssetSettings", summary = "Enregistrer les paramètres des amortissements (droit assets.settings)")
  public JsonNode saveSettings(@RequestBody Map<String, Object> body) {
    Map<String, Object> b = new LinkedHashMap<>(body);
    b.put("updated_at", java.time.OffsetDateTime.now().toString());
    return sql.upsert("asset_settings", b, SETTINGS, List.of("tenant_id"));
  }

  @GetMapping("/role-audit")
  @Operation(operationId = "listFixedAssetRoleAudit", summary = "Journal des rôles des immobilisations")
  public JsonNode roleAudit() {
    return sql.list("SELECT * FROM public.fixed_asset_role_audit ORDER BY created_at DESC LIMIT 500");
  }
}
