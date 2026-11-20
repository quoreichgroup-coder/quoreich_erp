package com.quoreich.qerp.modules.inventory;

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
 * Stocks (lot 4) : articles, entrepôts, emplacements, mouvements (écrits par les pièces et les fonctions — V53),
 * inventoriages et campagnes (V91–V100), clôtures, indicateurs, paramètres. Route d'action limitée à sa liste.
 */
@RestController
@RequestMapping("/api/v1/inventory")
@Tag(name = "Stocks", description = "Articles, entrepôts, mouvements, inventaires, campagnes, clôtures et indicateurs")
public class InventoryController {

  static final Set<String> ACTIONS = Set.of("create_stock_adjustment", "transfer_stock", "post_inventory_count", "close_inventory_period",
      "assign_inventory_role", "inventory_campaign", "inventory_campaign_control", "inventory_campaign_policy", "inventory_campaign_numbering",
      "inventory_campaign_catalog", "inventory_campaign_preview", "inventory_campaign_timeline", "inventory_campaign_save_counts",
      "inventory_cycle_policy", "inventory_cycle_prepare", "inventory_cycle_analysis");
  static final Set<String> ITEM = Set.of("code", "name", "category", "unit", "unit_cost", "selling_price", "reorder_level", "status", "valuation_method",
      "default_warehouse_id", "safety_stock", "max_stock", "abc_class", "account_set_id");
  static final Set<String> WAREHOUSE = Set.of("code", "name", "address", "is_default", "status", "kind", "country");
  static final Set<String> SETTINGS = Set.of("valuation_method", "negative_stock_allowed", "auto_je_on_movement", "low_stock_alerts_enabled",
      "adjustment_reason_required", "campaign_tolerance_percent", "campaign_tolerance_value", "default_warehouse_id", "campaign_item_scope",
      "campaign_document_prefix", "campaign_document_width", "updated_at");
  private static final Map<String, String> VIEWS = Map.ofEntries(
      Map.entry("valuation", "SELECT * FROM public.stock_valuation_view ORDER BY stock_value DESC"),
      Map.entry("low-stock", "SELECT * FROM public.low_stock_alerts_view ORDER BY gap DESC"),
      Map.entry("slow-moving", "SELECT * FROM public.inventory_slow_moving_view ORDER BY stock_value DESC"),
      Map.entry("variance", "SELECT * FROM public.inventory_variance_view ORDER BY count_date DESC LIMIT 50"),
      Map.entry("valuation-by-category", "SELECT * FROM public.inventory_valuation_by_category_view"),
      Map.entry("turnover", "SELECT * FROM public.inventory_turnover_view"),
      Map.entry("aging", "SELECT * FROM public.stock_aging_view"),
      Map.entry("period-locks", "SELECT id, period, module, closed_at AS locked_at, closed_by AS locked_by FROM public.period_locks"
          + " WHERE module = 'INVENTORY' AND status = 'closed' ORDER BY closed_at DESC LIMIT 50"));

  private final Sql sql;

  public InventoryController(Sql sql) {
    this.sql = sql;
  }

  @PostMapping("/actions/{function}")
  @Operation(operationId = "runInventoryAction", summary = "Opération de stock (fonction de la liste autorisée, arguments nommés)")
  public JsonNode action(@PathVariable String function, @RequestBody(required = false) Map<String, Object> a) {
    if (!ACTIONS.contains(function)) throw new ApiRefusal(404, "Opération inconnue : " + function);
    return sql.call(function, a == null ? Map.of() : a);
  }

  // ─── Articles, entrepôts ───

  @GetMapping("/items")
  @Operation(operationId = "listItems", summary = "Articles de la société (tous)")
  public JsonNode items() {
    return sql.list("SELECT * FROM public.items ORDER BY code, id");
  }

  @PostMapping("/items")
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(operationId = "createItem", summary = "Créer un article (droit inventory.move ; stock et coût moyen tenus par la base)")
  public JsonNode createItem(@RequestBody Map<String, Object> body) {
    return sql.insert("items", body, ITEM);
  }

  @PatchMapping("/items/{id}")
  @Operation(operationId = "updateItem", summary = "Modifier un article")
  public JsonNode updateItem(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
    return sql.update("items", id, body, ITEM);
  }

  @GetMapping("/items/{id}/locations")
  @Operation(operationId = "listItemLocations", summary = "Emplacements d'un article par entrepôt")
  public JsonNode locations(@PathVariable UUID id) {
    return sql.list("SELECT l.*, (SELECT to_jsonb(x) FROM (SELECT code, name FROM public.warehouses WHERE id = l.warehouse_id) x) AS warehouse"
        + " FROM public.item_locations l WHERE l.item_id = ?::uuid", id.toString());
  }

  @GetMapping("/warehouses")
  @Operation(operationId = "listWarehouses", summary = "Entrepôts")
  public JsonNode warehouses() {
    return sql.list("SELECT id, code, name, is_default, status, address FROM public.warehouses ORDER BY code");
  }

  @PostMapping("/warehouses")
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(operationId = "createWarehouse", summary = "Créer un entrepôt")
  public JsonNode createWarehouse(@RequestBody Map<String, Object> body) {
    return sql.insert("warehouses", body, WAREHOUSE);
  }

  @PatchMapping("/warehouses/{id}")
  @Operation(operationId = "updateWarehouse", summary = "Modifier un entrepôt")
  public JsonNode updateWarehouse(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
    return sql.update("warehouses", id, body, WAREHOUSE);
  }

  // ─── Mouvements ───

  @GetMapping("/movements")
  @Operation(operationId = "listStockMovements", summary = "Mouvements (filtres facultatifs ; all=true : tous, avec la pièce comptable)")
  public JsonNode movements(@RequestParam(required = false) String from, @RequestParam(required = false) String to,
      @RequestParam(required = false) UUID itemId, @RequestParam(required = false) UUID warehouseId, @RequestParam(defaultValue = "false") boolean all) {
    String i = itemId == null ? null : itemId.toString(), w = warehouseId == null ? null : warehouseId.toString();
    return sql.list("SELECT m.*, (SELECT to_jsonb(x) FROM (SELECT name, code, unit FROM public.items WHERE id = m.item_id) x) AS item,"
        + " (SELECT to_jsonb(x) FROM (SELECT code, name FROM public.warehouses WHERE id = m.warehouse_id) x) AS warehouse,"
        + " (SELECT to_jsonb(x) FROM (SELECT piece_number FROM public.journal_entries WHERE id = m.journal_entry_id) x) AS entry"
        + " FROM public.stock_movements m WHERE (?::date IS NULL OR m.movement_date >= ?::date) AND (?::date IS NULL OR m.movement_date <= ?::date)"
        + " AND (?::uuid IS NULL OR m.item_id = ?::uuid) AND (?::uuid IS NULL OR m.warehouse_id = ?::uuid)"
        + " ORDER BY m.movement_date DESC, m.created_at DESC" + (all ? "" : " LIMIT 500"), from, from, to, to, i, i, w, w);
  }

  @GetMapping("/movements/audit")
  @Operation(operationId = "listStockMovementsAudit", summary = "Piste d'audit des mouvements (500 derniers, filtres facultatifs)")
  public JsonNode movementsAudit(@RequestParam(required = false) String from, @RequestParam(required = false) String to, @RequestParam(required = false) UUID itemId) {
    String i = itemId == null ? null : itemId.toString();
    return sql.list("SELECT * FROM public.stock_movements_audit_view WHERE (?::date IS NULL OR movement_date >= ?::date) AND (?::date IS NULL OR movement_date <= ?::date)"
        + " AND (?::uuid IS NULL OR item_id = ?::uuid) ORDER BY movement_date DESC LIMIT 500", from, from, to, to, i, i);
  }

  // ─── Inventoriages ───

  @GetMapping("/counts")
  @Operation(operationId = "listInventoryCounts", summary = "Inventaires, avec l'entrepôt")
  public JsonNode counts() {
    return sql.list("SELECT c.*, (SELECT to_jsonb(x) FROM (SELECT code, name FROM public.warehouses WHERE id = c.warehouse_id) x) AS warehouse"
        + " FROM public.inventory_counts c ORDER BY c.count_date DESC");
  }

  @GetMapping("/counts/{id}/lines")
  @Operation(operationId = "listInventoryCountLines", summary = "Lignes d'un inventaire, avec l'article")
  public JsonNode countLines(@PathVariable UUID id) {
    return sql.list("SELECT l.*, (SELECT to_jsonb(x) FROM (SELECT code, name, unit FROM public.items WHERE id = l.item_id) x) AS item"
        + " FROM public.inventory_count_lines l WHERE l.count_id = ?::uuid", id.toString());
  }

  @PostMapping("/counts")
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(operationId = "createInventoryCount", summary = "Créer un inventaire en brouillon (droit inventory.count)")
  public JsonNode createCount(@RequestBody Map<String, Object> body) {
    return sql.insert("inventory_counts", body, Set.of("count_number", "warehouse_id", "count_date", "notes"), Map.of("created_by", "auth.uid()", "status", "'draft'"));
  }

  // ─── Clôtures, journaux, indicateurs ───

  @GetMapping("/period-closes")
  @Operation(operationId = "listInventoryPeriodCloses", summary = "Clôtures de stock (filtres, tri ; toutes les lignes)")
  public JsonNode closes(@RequestParam(defaultValue = "period") String sortKey, @RequestParam(defaultValue = "desc") String sortDir,
      @RequestParam(required = false) String from, @RequestParam(required = false) String to, @RequestParam(required = false) String periodSearch) {
    String key = "closed_at".equals(sortKey) ? "closed_at" : "period";
    String dir = "asc".equalsIgnoreCase(sortDir) ? "ASC" : "DESC";
    String search = periodSearch == null || periodSearch.isBlank() ? null : periodSearch.trim();
    return sql.list("SELECT id, period, closed_at, closed_by, total_value, total_qty, items_count, snapshot FROM public.inventory_period_closes"
        + " WHERE (?::date IS NULL OR closed_at >= ?::date) AND (?::date IS NULL OR closed_at < ?::date + 1) AND (?::text IS NULL OR period ILIKE '%' || ?::text || '%')"
        + " ORDER BY " + key + " " + dir, from, from, to, to, search, search);
  }

  @GetMapping("/role-audit")
  @Operation(operationId = "listInventoryRoleAudit", summary = "Journal des stocks : rôles, clôtures, exports (filtre facultatif par actions)")
  public JsonNode roleAudit(@RequestParam(required = false) String actions, @RequestParam(defaultValue = "500") int limit) {
    String a = actions == null || actions.isBlank() ? null : "{" + actions + "}";
    return sql.list("SELECT * FROM public.inventory_role_audit WHERE (?::text[] IS NULL OR action = ANY (?::text[])) ORDER BY created_at DESC LIMIT ?",
        a, a, Math.min(Math.max(limit, 1), 1000));
  }

  @PostMapping("/role-audit")
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(operationId = "logInventoryEvent", summary = "Tracer un export ou une tentative de clôture (journal des stocks)")
  public JsonNode log(@RequestBody Map<String, Object> body) {
    Map<String, Object> b = new LinkedHashMap<>(body);
    String action = String.valueOf(b.get("action"));
    if (!Set.of("export_csv", "export_pdf", "export_aborted", "export_failed", "period_close_attempt", "period_close_failed").contains(action)) {
      throw new ApiRefusal(422, "Événement non traçable : " + action);
    }
    return sql.insert("inventory_role_audit", b, Set.of("role", "action", "comment"), Map.of("performed_by", "auth.uid()", "target_user_id", "auth.uid()"));
  }

  @GetMapping("/views/{view}")
  @Operation(operationId = "readInventoryView", summary = "Vues des stocks : valorisation, alertes, rotation, ancienneté, écarts, verrous")
  public JsonNode view(@PathVariable String view) {
    String q = VIEWS.get(view);
    if (q != null) return sql.list(q);
    if (view.equals("kpis")) return sql.one("SELECT * FROM public.inventory_kpis_view");
    throw new ApiRefusal(404, "Vue inconnue : " + view);
  }

  @GetMapping("/settings")
  @Operation(operationId = "getInventorySettings", summary = "Paramètres des stocks")
  public JsonNode settings() {
    return sql.one("SELECT * FROM public.inventory_settings WHERE tenant_id = public.get_user_tenant_id(auth.uid())");
  }

  @PutMapping("/settings")
  @Operation(operationId = "saveInventorySettings", summary = "Enregistrer les paramètres des stocks (droit inventory.settings)")
  public JsonNode saveSettings(@RequestBody Map<String, Object> body) {
    Map<String, Object> b = new LinkedHashMap<>(body);
    b.put("updated_at", java.time.OffsetDateTime.now().toString());
    return sql.upsert("inventory_settings", b, SETTINGS, List.of("tenant_id"));
  }
}
