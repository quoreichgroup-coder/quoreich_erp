package com.quoreich.qerp.modules.documents;

import com.quoreich.qerp.platform.ApiRefusal;
import com.quoreich.qerp.platform.Sql;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;

/**
 * Sections analytiques des pièces d'achat (V77 en-tête, V78 lignes) : demande, commande, facture fournisseur.
 * Gardes de la base (V77) : modifiables tant que la pièce est en brouillon ou rejetée.
 */
@Service
public class DocumentAnalytics {

  private static final Map<String, String> HEADER = Map.of("PR", "purchase_requisition_analytics", "PO", "purchase_order_analytics", "AP", "ap_invoice_analytics");
  private static final Map<String, String> LINE = Map.of("PR", "requisition_line_analytics", "PO", "po_line_analytics", "AP", "ap_invoice_line_analytics");

  private final Sql sql;

  public DocumentAnalytics(Sql sql) {
    this.sql = sql;
  }

  static String table(Map<String, String> m, String kind) {
    String t = m.get(kind);
    if (t == null) throw new ApiRefusal(400, "Type de pièce inconnu : " + kind);
    return t;
  }

  public JsonNode header(String kind, UUID id) {
    return sql.list("SELECT axis_id, value_id FROM public." + table(HEADER, kind) + " WHERE document_id = ?::uuid", id.toString());
  }

  public JsonNode lines(String kind, List<UUID> ids) {
    if (ids.isEmpty()) return sql.list("SELECT 1 WHERE false");
    return sql.list("SELECT line_id, axis_id, value_id FROM public." + table(LINE, kind) + " WHERE line_id = ANY (?::uuid[])",
        "{" + String.join(",", ids.stream().map(UUID::toString).toList()) + "}");
  }

  /** Remplace l'imputation de l'en-tête (axe sans section = rien) ; null = ne rien changer. */
  @Transactional
  public void saveHeader(String kind, UUID id, Map<String, String> values) {
    if (values == null) return;
    String t = table(HEADER, kind);
    sql.deleteWhereAny(t, "document_id = ?::uuid", id.toString());
    for (Map.Entry<String, String> e : values.entrySet()) {
      if (e.getValue() == null || e.getValue().isBlank()) continue;
      sql.insert(t, Sql.args("document_id", id, "axis_id", e.getKey(), "value_id", e.getValue()), Set.of("document_id", "axis_id", "value_id"));
    }
  }

  /** Sections ligne à ligne, dans l'ordre des lignes enregistrées ; axe vide = section de l'en-tête. */
  @Transactional
  public void saveLines(String kind, List<UUID> lineIds, List<Map<String, String>> perLine) {
    if (perLine == null) return;
    String t = table(LINE, kind);
    for (int i = 0; i < lineIds.size() && i < perLine.size(); i++) {
      Map<String, String> v = perLine.get(i);
      if (v == null) continue;
      for (Map.Entry<String, String> e : v.entrySet()) {
        if (e.getValue() == null || e.getValue().isBlank()) continue;
        sql.upsert(t, Sql.args("line_id", lineIds.get(i), "axis_id", e.getKey(), "value_id", e.getValue()), Set.of("line_id", "axis_id", "value_id"),
            List.of("line_id", "axis_id"));
      }
    }
  }

  /** Identifiants d'une liste de lignes insérées, triées par numéro de ligne. */
  public static List<UUID> idsByLineNo(List<JsonNode> inserted) {
    List<JsonNode> sorted = new ArrayList<>(inserted);
    sorted.sort((a, b) -> Integer.compare(a.get("line_no").asInt(), b.get("line_no").asInt()));
    return sorted.stream().map(n -> UUID.fromString(n.get("id").asString())).toList();
  }
}
