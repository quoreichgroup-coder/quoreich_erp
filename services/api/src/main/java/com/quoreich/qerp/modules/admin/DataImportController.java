package com.quoreich.qerp.modules.admin;

import com.quoreich.qerp.platform.ApiRefusal;
import com.quoreich.qerp.platform.Sql;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * Import en masse (jumeau de la fonction import-data du nuage, supabase/functions/import-data/lib.ts) : colonnes
 * importables limitées par entité, champs requis, société et auteur posés par le serveur, insertion sous la RLS
 * de l'utilisateur en une transaction (tout ou rien).
 */
@RestController
@RequestMapping("/api/v1/import")
@Tag(name = "Import", description = "Import en masse de tiers, comptes, articles et factures")
public class DataImportController {

  static final Map<String, List<String>> REQUIRED = Map.of(
      "customers", List.of("name"), "suppliers", List.of("name"), "gl_accounts", List.of("code", "name", "account_type"),
      "items", List.of("code", "name"), "ar_invoices", List.of("invoice_number", "customer_id", "due_date", "total"),
      "ap_invoices", List.of("invoice_number", "supplier_id", "due_date", "total"));
  static final Map<String, Set<String>> ALLOWED = Map.of(
      "customers", Set.of("name", "email", "phone", "address", "tax_id", "currency", "payment_terms"),
      "suppliers", Set.of("name", "email", "phone", "address", "tax_id", "currency", "payment_terms"),
      "gl_accounts", Set.of("code", "name", "account_type", "parent_code", "currency", "is_active"),
      "items", Set.of("code", "name", "description", "unit_of_measure", "category", "unit_cost", "selling_price", "quantity_on_hand", "reorder_level"),
      "ar_invoices", Set.of("invoice_number", "customer_id", "invoice_date", "due_date", "subtotal", "tax_amount", "total", "currency"),
      "ap_invoices", Set.of("invoice_number", "supplier_id", "invoice_date", "due_date", "subtotal", "tax_amount", "total", "currency"));
  private static final ObjectMapper JSON = new ObjectMapper();

  private final Sql sql;

  public DataImportController(Sql sql) {
    this.sql = sql;
  }

  static double number(Object v) {
    if (v == null || "".equals(v)) return 0;
    if (v instanceof Number n) return n.doubleValue();
    try {
      return Double.parseDouble(String.valueOf(v).replace(",", ""));
    } catch (NumberFormatException e) {
      return 0;
    }
  }

  static Map<String, Object> normalize(String entity, Map<String, Object> raw) {
    Set<String> allowed = ALLOWED.get(entity);
    Map<String, Object> r = new LinkedHashMap<>();
    raw.forEach((k, v) -> {
      if (allowed.contains(k)) r.put(k, v);
    });
    switch (entity) {
      case "items" -> {
        for (String k : List.of("unit_cost", "selling_price", "quantity_on_hand", "reorder_level")) r.put(k, number(r.get(k)));
      }
      case "ar_invoices", "ap_invoices" -> {
        r.put("subtotal", number(r.get("subtotal") != null ? r.get("subtotal") : r.get("total")));
        r.put("tax_amount", number(r.get("tax_amount")));
        r.put("total", number(r.get("total")));
      }
      case "customers", "suppliers" -> {
        Object t = r.get("payment_terms");
        r.put("payment_terms", t == null || "".equals(t) ? 30L : Math.round(number(t)));
      }
      default -> { }
    }
    return r;
  }

  @PostMapping
  @Transactional
  @Operation(operationId = "importData", summary = "Importer des lignes d'une entité ({ entity, rows }) : lignes incomplètes ignorées et listées, le reste en une transaction")
  public ResponseEntity<JsonNode> importRows(@RequestBody Map<String, Object> body) {
    Object entityRaw = body.get("entity");
    if (entityRaw == null || !(body.get("rows") instanceof List<?> rows)) throw new ApiRefusal(400, "Données invalides : entity et rows sont requis");
    String entity = String.valueOf(entityRaw);
    List<String> required = REQUIRED.get(entity);
    if (required == null) throw new ApiRefusal(400, "Entité non prise en charge : " + entity);
    List<Map<String, Object>> errors = new ArrayList<>();
    List<Map<String, Object>> valid = new ArrayList<>();
    int idx = 0;
    for (Object o : rows) {
      idx++;
      if (!(o instanceof Map<?, ?> m)) {
        errors.add(Map.of("row", idx, "message", "Ligne invalide"));
        continue;
      }
      @SuppressWarnings("unchecked")
      Map<String, Object> raw = (Map<String, Object>) m;
      List<String> missing = required.stream().filter(f -> raw.get(f) == null || "".equals(raw.get(f))).toList();
      if (!missing.isEmpty()) {
        errors.add(Map.of("row", idx, "message", "Champ(s) requis manquant(s) : " + String.join(", ", missing)));
        continue;
      }
      valid.add(normalize(entity, raw));
    }
    Map<String, String> server = entity.endsWith("_invoices") ? Map.of("created_by", "auth.uid()") : Map.of();
    for (Map<String, Object> r : valid) sql.insert(entity, r, ALLOWED.get(entity), server);
    ObjectNode out = JSON.createObjectNode();
    out.put("success", true);
    out.put("entity", entity);
    out.put("total", rows.size());
    out.put("inserted", valid.size());
    out.put("skipped", errors.size());
    out.set("errors", JSON.valueToTree(errors));
    return ResponseEntity.ok(out);
  }
}
