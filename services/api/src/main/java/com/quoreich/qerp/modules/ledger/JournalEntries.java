package com.quoreich.qerp.modules.ledger;

import com.quoreich.qerp.platform.ApiRefusal;
import com.quoreich.qerp.platform.Sql;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;

/**
 * Écriture manuelle en une transaction : brouillon, lignes, sections analytiques, puis comptabilisation si
 * demandée. Un refus d'équilibre, de période ou d'analytique (QG002) annule tout — le chemin Supabase
 * laissait un brouillon à supprimer à la main.
 */
@Service
public class JournalEntries {

  static final Set<String> HEADER = Set.of("entry_number", "entry_date", "description", "source");
  static final Set<String> LINE = Set.of("entry_id", "account_id", "description", "debit", "credit", "cost_center", "department", "project");

  private final Sql sql;

  public JournalEntries(Sql sql) {
    this.sql = sql;
  }

  @Transactional
  @SuppressWarnings("unchecked")
  public JsonNode create(Map<String, Object> body) {
    List<Map<String, Object>> lines = (List<Map<String, Object>>) body.get("lines");
    if (lines == null || lines.size() < 2) throw new ApiRefusal(422, "Une écriture comporte au moins deux lignes");
    JsonNode entry = sql.insert("journal_entries", body, HEADER, Map.of("status", "'draft'", "created_by", "auth.uid()"));
    UUID id = UUID.fromString(entry.get("id").asString());
    for (Map<String, Object> raw : lines) {
      Map<String, Object> l = new LinkedHashMap<>(raw);
      Map<String, String> analytics = (Map<String, String>) l.remove("analytics");
      l.put("entry_id", id);
      String lineId = sql.insert("journal_lines", l, LINE).get("id").asString();
      if (analytics == null) continue;
      for (Map.Entry<String, String> a : analytics.entrySet()) {
        if (a.getValue() == null || a.getValue().isBlank()) continue;
        sql.insert("journal_line_analytics", Sql.args("line_id", lineId, "axis_id", a.getKey(), "value_id", a.getValue()), Set.of("line_id", "axis_id", "value_id"));
      }
    }
    if ("posted".equals(body.get("status"))) {
      return sql.updateWith("journal_entries", Map.of("status", "posted"), Set.of("status"), Map.of("posted_by", "auth.uid()", "posted_at", "now()"),
          "id = ?::uuid", id.toString());
    }
    return entry;
  }
}
