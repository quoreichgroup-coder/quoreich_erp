package com.quoreich.qerp.modules.ai;

import com.quoreich.qerp.platform.ApiRefusal;
import com.quoreich.qerp.platform.Sql;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * Analyses IA sur site (appelées par les routes et par la planification) : prévision de trésorerie et détection d'anomalies du grand livre (mêmes invites, mêmes
 * schémas d'outil et mêmes réponses que les fonctions du nuage), historique et planifications. Les données sont
 * lues sous la RLS de l'utilisateur ; chaque exécution laisse une ligne dans ai_analysis_history.
 */
@Component
public class AiAnalyses {

  private static final Set<String> HISTORY = Set.of("analysis_type", "trigger_source", "status", "params", "result", "inputs", "error_message", "duration_ms");
  private static final ObjectMapper JSON = new ObjectMapper();

  private final Sql sql;
  private final AiProvider ai;

  public AiAnalyses(Sql sql, AiProvider ai) {
    this.sql = sql;
    this.ai = ai;
  }

  private void history(String trigger, String type, String status, Object params, Object result, Object inputs, String error, long started) {
    Map<String, Object> row = new HashMap<>();
    row.put("analysis_type", type);
    row.put("trigger_source", trigger);
    row.put("status", status);
    row.put("params", params);
    row.put("result", result);
    row.put("inputs", inputs);
    row.put("error_message", error);
    row.put("duration_ms", System.currentTimeMillis() - started);
    sql.insert("ai_analysis_history", row, HISTORY, Map.of("created_by", "auth.uid()"));
  }

  private static ObjectNode tool(String name, String description, ObjectNode parameters) {
    ObjectNode t = JSON.createObjectNode();
    t.put("type", "function");
    ObjectNode f = t.putObject("function");
    f.put("name", name);
    f.put("description", description);
    f.set("parameters", parameters);
    return t;
  }

  private static ObjectNode request(String system, String user, ObjectNode tool) {
    ObjectNode body = JSON.createObjectNode();
    ArrayNode messages = body.putArray("messages");
    messages.addObject().put("role", "system").put("content", system);
    messages.addObject().put("role", "user").put("content", user);
    body.putArray("tools").add(tool);
    ObjectNode choice = body.putObject("tool_choice");
    choice.put("type", "function");
    choice.putObject("function").put("name", tool.path("function").path("name").asString());
    return body;
  }

  private static int refusalStatus(int code) {
    return code == 429 || code == 402 || code == 503 ? code : 502;
  }

  private static double num(JsonNode n) {
    return n == null || n.isNull() || n.isMissingNode() ? 0 : n.asDouble();
  }

  // ─── Prévision de trésorerie ───

  public JsonNode cashflow(Map<String, Object> b, String trigger) {
    long started = System.currentTimeMillis();
    Map<String, Object> body = b == null ? Map.of() : b;
    List<Integer> horizons = new ArrayList<>(List.of(30, 60, 90));
    if (body.get("horizons") instanceof List<?> l && !l.isEmpty()) {
      TreeSet<Integer> set = new TreeSet<>();
      for (Object o : l) set.add((int) Math.max(1, Math.min(365, Math.round(Double.parseDouble(String.valueOf(o))))));
      horizons = new ArrayList<>(set).subList(0, Math.min(6, set.size()));
    } else if (body.get("from") != null && body.get("to") != null) {
      long diff = Math.max(1, java.time.temporal.ChronoUnit.DAYS.between(LocalDate.parse(String.valueOf(body.get("from")).substring(0, 10)),
          LocalDate.parse(String.valueOf(body.get("to")).substring(0, 10))));
      horizons = List.of((int) diff);
    }
    JsonNode ar = sql.list("SELECT total, amount_paid, due_date, status FROM public.ar_invoices WHERE status <> 'paid' LIMIT 500");
    JsonNode ap = sql.list("SELECT total, amount_paid, due_date, status FROM public.ap_invoices WHERE status <> 'paid' LIMIT 500");
    JsonNode banks = sql.list("SELECT balance, currency, name FROM public.bank_accounts WHERE is_active");
    LocalDate today = LocalDate.now();
    ObjectNode summary = JSON.createObjectNode();
    double cash = 0;
    for (JsonNode bk : banks) cash += num(bk.get("balance"));
    summary.put("cash_on_hand", cash);
    summary.put("currency", banks.size() > 0 && banks.get(0).hasNonNull("currency") ? banks.get(0).get("currency").asString() : "XOF");
    summary.put("ar_open_total", openTotal(ar, null));
    summary.put("ap_open_total", openTotal(ap, null));
    summary.put("open_ar_count", ar.size());
    summary.put("open_ap_count", ap.size());
    ArrayNode h = summary.putArray("horizons");
    ObjectNode buckets = summary.putObject("buckets");
    List<String> horizonEnum = new ArrayList<>();
    for (int d : horizons) {
      h.add(d);
      horizonEnum.add(d + "j");
      ObjectNode bucket = buckets.putObject(d + "j");
      bucket.put("ar", openTotal(ar, today.plusDays(d)));
      bucket.put("ap", openTotal(ap, today.plusDays(d)));
    }
    Map<String, Object> params = new LinkedHashMap<>();
    params.put("horizons", horizons);
    params.put("from", body.get("from"));
    params.put("to", body.get("to"));
    String missing = ai.configurationError();
    if (missing != null) {
      history(trigger, "cashflow_forecast", "error", params, Map.of(), summary, missing, started);
      throw new ApiRefusal(503, missing);
    }
    ObjectNode schema = JSON.createObjectNode();
    schema.put("type", "object");
    ObjectNode props = schema.putObject("properties");
    ObjectNode proj = props.putObject("projections");
    proj.put("type", "array");
    ObjectNode item = proj.putObject("items");
    item.put("type", "object");
    ObjectNode ip = item.putObject("properties");
    ArrayNode en = ip.putObject("horizon").put("type", "string").putArray("enum");
    horizonEnum.forEach(en::add);
    ip.putObject("projected_cash").put("type", "number");
    ip.putObject("net_movement").put("type", "number");
    ip.putObject("confidence").put("type", "string").putArray("enum").add("low").add("medium").add("high");
    item.putArray("required").add("horizon").add("projected_cash").add("net_movement").add("confidence");
    props.putObject("summary").put("type", "string");
    props.putObject("recommendations").put("type", "array").putObject("items").put("type", "string");
    props.putObject("risk_level").put("type", "string").putArray("enum").add("low").add("medium").add("high");
    schema.putArray("required").add("projections").add("summary").add("recommendations").add("risk_level");
    ObjectNode req = request("Tu es un analyste financier ERP. Tu produis des prévisions de trésorerie courtes, en français, basées uniquement sur les chiffres fournis. Sois factuel et concis.",
        "Données du tenant (devise " + summary.get("currency").asString() + "):\n" + summary.toPrettyString() + "\n\nProduis une prévision pour CHACUN des horizons demandés ("
            + String.join(", ", horizonEnum) + ") et 2-3 recommandations.",
        tool("cashflow_forecast", "Prévision de trésorerie structurée", schema));
    AiProvider.Result r = ai.chat(req);
    if (!r.ok()) {
      history(trigger, "cashflow_forecast", "error", params, Map.of(), summary, r.message(), started);
      throw new ApiRefusal(refusalStatus(r.status()), r.message());
    }
    JsonNode forecast = AiProvider.toolArguments(r.json());
    ObjectNode payload = JSON.createObjectNode();
    payload.set("forecast", forecast);
    payload.set("inputs", summary);
    history(trigger, "cashflow_forecast", forecast != null ? "success" : "partial", params, payload, summary, null, started);
    return payload;
  }

  private static double openTotal(JsonNode rows, LocalDate cutoff) {
    double t = 0;
    for (JsonNode r : rows) {
      if (cutoff != null && (!r.hasNonNull("due_date") || LocalDate.parse(r.get("due_date").asString().substring(0, 10)).isAfter(cutoff))) continue;
      double open = num(r.get("total")) - num(r.get("amount_paid"));
      t += cutoff == null ? open : Math.max(0, open);
    }
    return t;
  }

  // ─── Anomalies du grand livre ───

  public JsonNode anomalies(Map<String, Object> b, String trigger) {
    long started = System.currentTimeMillis();
    int days = 30;
    if (b != null && b.get("days") != null) days = (int) Math.max(1, Math.min(365, Math.round(Double.parseDouble(String.valueOf(b.get("days"))))));
    String since = LocalDate.now().minusDays(days).toString();
    JsonNode entries = sql.list("SELECT e.id, e.entry_number, e.entry_date, e.description, e.source, e.status,"
        + " COALESCE((SELECT jsonb_agg(jsonb_build_object('id', l.id, 'debit', l.debit, 'credit', l.credit, 'description', l.description,"
        + " 'account_code', a.code, 'account_name', a.name)) FROM public.journal_lines l LEFT JOIN public.gl_accounts a ON a.id = l.account_id"
        + " WHERE l.entry_id = e.id), '[]'::jsonb) AS lines"
        + " FROM public.journal_entries e WHERE e.entry_date >= ?::date ORDER BY e.entry_date DESC LIMIT 150", since);
    Map<String, JsonNode> byRef = new HashMap<>();
    ArrayNode compact = JSON.createArrayNode();
    for (JsonNode e : entries) {
      byRef.put(e.path("entry_number").asString(), e);
      double debit = 0;
      double credit = 0;
      for (JsonNode l : e.path("lines")) {
        debit += num(l.get("debit"));
        credit += num(l.get("credit"));
      }
      ObjectNode c = compact.addObject();
      c.set("id", e.get("id"));
      c.set("ref", e.get("entry_number"));
      c.set("date", e.get("entry_date"));
      c.set("source", e.get("source"));
      c.set("status", e.get("status"));
      c.set("description", e.get("description"));
      c.put("debit", debit);
      c.put("credit", credit);
      c.put("balanced", Math.abs(debit - credit) < 0.01);
      c.put("line_count", e.path("lines").size());
    }
    Map<String, Object> params = Map.of("days", days);
    Map<String, Object> inputs = Map.of("total_entries", compact.size(), "since", since);
    if (compact.isEmpty()) {
      ObjectNode empty = JSON.createObjectNode();
      empty.putArray("anomalies");
      empty.put("summary", "Aucune écriture sur la période.");
      empty.put("total_reviewed", 0);
      history(trigger, "gl_anomaly_detection", "success", params, empty, inputs, null, started);
      return empty;
    }
    String missing = ai.configurationError();
    if (missing != null) {
      history(trigger, "gl_anomaly_detection", "error", params, Map.of(), inputs, missing, started);
      throw new ApiRefusal(503, missing);
    }
    ObjectNode schema = JSON.createObjectNode();
    schema.put("type", "object");
    ObjectNode props = schema.putObject("properties");
    ObjectNode an = props.putObject("anomalies");
    an.put("type", "array");
    ObjectNode item = an.putObject("items");
    item.put("type", "object");
    ObjectNode ip = item.putObject("properties");
    ip.putObject("entry_ref").put("type", "string");
    ip.putObject("severity").put("type", "string").putArray("enum").add("low").add("medium").add("high");
    ip.putObject("type").put("type", "string");
    ip.putObject("description").put("type", "string");
    ip.putObject("recommendation").put("type", "string");
    item.putArray("required").add("entry_ref").add("severity").add("type").add("description").add("recommendation");
    props.putObject("summary").put("type", "string");
    schema.putArray("required").add("anomalies").add("summary");
    ObjectNode req = request("Tu es un auditeur comptable. Identifie les écritures suspectes (déséquilibre, doublon potentiel, montant anormalement élevé, libellé absent, source inhabituelle). Réponds en français, sois précis et factuel.",
        "Voici " + compact.size() + " écritures récentes:\n" + compact + "\n\nIdentifie au maximum 10 anomalies réelles. Si rien d'anormal, retourne un tableau vide.",
        tool("report_anomalies", "Liste structurée d'anomalies détectées", schema));
    AiProvider.Result r = ai.chat(req);
    if (!r.ok()) {
      history(trigger, "gl_anomaly_detection", "error", params, Map.of(), inputs, r.message(), started);
      throw new ApiRefusal(refusalStatus(r.status()), r.message());
    }
    JsonNode parsed = AiProvider.toolArguments(r.json());
    ObjectNode payload = JSON.createObjectNode();
    ArrayNode out = payload.putArray("anomalies");
    if (parsed != null) {
      for (JsonNode a : parsed.path("anomalies")) {
        ObjectNode x = a.isObject() ? ((ObjectNode) a).deepCopy() : JSON.createObjectNode();
        JsonNode e = byRef.get(a.path("entry_ref").asString());
        x.set("entry_id", e == null ? null : e.get("id"));
        x.set("entry_date", e == null ? null : e.get("entry_date"));
        x.set("entry_description", e == null ? null : e.get("description"));
        ArrayNode lines = x.putArray("lines");
        if (e != null) {
          for (JsonNode l : e.path("lines")) {
            ObjectNode ln = lines.addObject();
            ln.set("account_code", l.get("account_code"));
            ln.set("account_name", l.get("account_name"));
            ln.put("debit", num(l.get("debit")));
            ln.put("credit", num(l.get("credit")));
            ln.set("description", l.get("description"));
          }
        }
        out.add(x);
      }
    }
    payload.put("summary", parsed == null ? "" : parsed.path("summary").asString(""));
    payload.put("total_reviewed", compact.size());
    history(trigger, "gl_anomaly_detection", "success", params, payload, inputs, null, started);
    return payload;
  }
}
