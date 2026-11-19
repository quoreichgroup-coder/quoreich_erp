package com.quoreich.qerp.modules.payable;

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
 * Facture fournisseur à lignes (V72) en une transaction : en-tête, lignes (l'en-tête est recalculé par la
 * base), sections analytiques. Un refus à n'importe quelle étape annule tout — le chemin Supabase devait
 * supprimer l'en-tête à la main.
 */
@Service
public class PayableInvoices {

  static final Set<String> HEADER = Set.of("supplier_id", "po_id", "invoice_number", "invoice_date", "due_date", "control_total");
  static final Set<String> LINE = Set.of("invoice_id", "line_no", "description", "quantity", "unit_price", "discount_pct", "tax_code_id", "po_line_id",
      "expense_account_id");

  private final Sql sql;
  private final DocumentAnalytics analytics;

  public PayableInvoices(Sql sql, DocumentAnalytics analytics) {
    this.sql = sql;
    this.analytics = analytics;
  }

  @Transactional
  @SuppressWarnings("unchecked")
  public UUID save(UUID existing, Map<String, Object> body) {
    Map<String, Object> header = (Map<String, Object>) body.getOrDefault("header", Map.of());
    List<Map<String, Object>> lines = (List<Map<String, Object>>) body.getOrDefault("lines", List.of());
    if (lines.isEmpty()) throw new ApiRefusal(422, "Au moins une ligne de facture");
    UUID id;
    if (existing != null) {
      sql.update("ap_invoices", existing, header, HEADER);
      sql.deleteWhereAny("ap_invoice_lines", "invoice_id = ?::uuid", existing.toString());
      id = existing;
    } else {
      JsonNode inv = sql.insert("ap_invoices", header, HEADER, Map.of("created_by", "auth.uid()", "status", "'draft'", "approval_status", "'draft'",
          "amount_paid", "0", "subtotal", "0", "tax_amount", "0", "total", "0"));
      id = UUID.fromString(inv.get("id").asString());
    }
    List<JsonNode> inserted = new ArrayList<>();
    List<Map<String, String>> perLine = new ArrayList<>();
    for (int i = 0; i < lines.size(); i++) {
      Map<String, Object> l = new LinkedHashMap<>(lines.get(i));
      perLine.add((Map<String, String>) l.remove("analytics"));
      l.put("invoice_id", id);
      l.put("line_no", i + 1);
      if (l.get("discount_pct") == null) l.put("discount_pct", 0);
      inserted.add(sql.insert("ap_invoice_lines", l, LINE));
    }
    analytics.saveHeader("AP", id, (Map<String, String>) body.get("analytics"));
    analytics.saveLines("AP", DocumentAnalytics.idsByLineNo(inserted), perLine);
    return id;
  }
}
