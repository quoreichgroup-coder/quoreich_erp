package com.quoreich.qerp.modules.procurement;

import com.quoreich.qerp.modules.documents.DocumentAnalytics;
import com.quoreich.qerp.platform.ApiRefusal;
import com.quoreich.qerp.platform.Sql;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;

/**
 * Pièces d'achat en trois zones (en-tête, lignes, pied calculé par la base) écrites en une transaction :
 * demande, commande, réception. Le chemin Supabase écrivait l'en-tête puis les lignes et devait supprimer
 * l'en-tête quand les lignes étaient refusées ; ici un refus n'en laisse rien.
 */
@Service
public class ProcurementDocuments {

  static final Set<String> PR = Set.of("pr_number", "description", "request_date", "estimated_total");
  static final Set<String> PO = Set.of("po_number", "supplier_id", "order_date", "expected_date", "incoterm", "total");
  static final Set<String> PR_LINE = Set.of("requisition_id", "description", "quantity", "estimated_unit_cost", "item_id");
  static final Set<String> PO_LINE = Set.of("po_id", "description", "quantity", "unit_cost", "item_id", "expected_date");
  static final Set<String> GR = Set.of("gr_number", "po_id", "receipt_date");
  static final Set<String> GR_LINE = Set.of("gr_id", "po_line_id", "item_id", "quantity_received", "quantity_rejected");

  private final Sql sql;
  private final DocumentAnalytics analytics;

  public ProcurementDocuments(Sql sql, DocumentAnalytics analytics) {
    this.sql = sql;
    this.analytics = analytics;
  }

  private record Kind(String table, String lines, String parent, Set<String> header, Set<String> line, Map<String, String> server, String analytic) {}

  private static Kind kind(String docType) {
    return switch (docType) {
      case "PR" -> new Kind("purchase_requisitions", "requisition_lines", "requisition_id", PR, PR_LINE, Map.of("requested_by", "auth.uid()"), "PR");
      case "PO" -> new Kind("purchase_orders", "po_lines", "po_id", PO, PO_LINE, Map.of("created_by", "auth.uid()"), "PO");
      default -> throw new ApiRefusal(400, "Type de pièce inconnu : " + docType);
    };
  }

  /** Crée (id null) ou remplace une demande ou une commande modifiable, avec ses lignes et ses sections. */
  @Transactional
  @SuppressWarnings("unchecked")
  public UUID save(String docType, UUID existing, Map<String, Object> body) {
    Kind k = kind(docType);
    Map<String, Object> header = new LinkedHashMap<>(body);
    List<Map<String, Object>> lines = (List<Map<String, Object>>) header.remove("lines");
    Map<String, String> headerAnalytics = (Map<String, String>) header.remove("analytics");
    if (lines == null) lines = List.of();
    UUID id;
    if (existing != null) {
      sql.update(k.table(), existing, header, k.header());
      sql.deleteWhereAny(k.lines(), k.parent() + " = ?::uuid", existing.toString());
      id = existing;
    } else {
      id = UUID.fromString(sql.insert(k.table(), header, k.header(), k.server()).get("id").asString());
    }
    List<UUID> lineIds = new ArrayList<>();
    List<Map<String, String>> perLine = new ArrayList<>();
    for (Map<String, Object> raw : lines) {
      Map<String, Object> l = new LinkedHashMap<>(raw);
      perLine.add((Map<String, String>) l.remove("analytics"));
      l.put(k.parent(), id);
      if (l.get("item_id") == null || "".equals(l.get("item_id"))) l.remove("item_id");
      lineIds.add(UUID.fromString(sql.insert(k.lines(), l, k.line()).get("id").asString()));
    }
    analytics.saveLines(k.analytic(), lineIds, perLine);
    analytics.saveHeader(k.analytic(), id, headerAnalytics);
    return id;
  }

  /** Réception : en attente, ses lignes, puis validée si demandé (la base refuse une réception créée validée). */
  @Transactional
  @SuppressWarnings("unchecked")
  public JsonNode receive(Map<String, Object> body) {
    Map<String, Object> header = new LinkedHashMap<>(body);
    List<Map<String, Object>> lines = (List<Map<String, Object>>) header.remove("lines");
    boolean complete = Boolean.TRUE.equals(header.remove("complete"));
    if (lines == null || lines.isEmpty()) throw new ApiRefusal(422, "Une réception comporte au moins une ligne.");
    JsonNode gr = sql.insert("goods_receipts", header, GR, Map.of("status", "'pending'", "received_by", "auth.uid()"));
    UUID id = UUID.fromString(gr.get("id").asString());
    for (Map<String, Object> raw : lines) {
      Map<String, Object> l = new LinkedHashMap<>(raw);
      l.put("gr_id", id);
      if (l.get("quantity_rejected") == null) l.put("quantity_rejected", 0);
      if (l.get("item_id") == null || "".equals(l.get("item_id"))) l.remove("item_id");
      sql.insert("gr_lines", l, GR_LINE);
    }
    if (complete) return sql.update("goods_receipts", id, Map.of("status", "completed"), Set.of("status"));
    return gr;
  }
}
