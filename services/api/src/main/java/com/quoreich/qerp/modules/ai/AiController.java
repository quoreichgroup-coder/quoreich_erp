package com.quoreich.qerp.modules.ai;

import com.quoreich.qerp.platform.ApiRefusal;
import com.quoreich.qerp.platform.Sql;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * Analyses IA sur site : prévision de trésorerie et détection d'anomalies du grand livre (mêmes invites, mêmes
 * schémas d'outil et mêmes réponses que les fonctions du nuage), historique et planifications. Les données sont
 * lues sous la RLS de l'utilisateur ; chaque exécution laisse une ligne dans ai_analysis_history.
 */
@RestController
@RequestMapping("/api/v1/ai")
@Tag(name = "IA", description = "Prévision de trésorerie, anomalies du grand livre, historique et planifications")
public class AiController {

  private static final Set<String> SCHEDULE = Set.of("analysis_type", "frequency", "enabled", "params", "next_run_at");

  private final Sql sql;
  private final AiAnalyses analyses;

  public AiController(Sql sql, AiAnalyses analyses) {
    this.sql = sql;
    this.analyses = analyses;
  }

  @PostMapping("/cashflow-forecast")
  @Operation(operationId = "runCashflowForecast", summary = "Prévision de trésorerie par horizons (30/60/90 jours par défaut)")
  public JsonNode cashflow(@RequestBody(required = false) Map<String, Object> b) {
    return analyses.cashflow(b, "manual");
  }

  @PostMapping("/gl-anomalies")
  @Operation(operationId = "runGlAnomalyDetection", summary = "Écritures suspectes des derniers jours (30 par défaut)")
  public JsonNode anomalies(@RequestBody(required = false) Map<String, Object> b) {
    return analyses.anomalies(b, "manual");
  }

  // ─── Historique et planifications ───

  @GetMapping("/history")
  @Operation(operationId = "listAiHistory", summary = "Historique des analyses (filtres type et dates, pagination)")
  public JsonNode historyList(@RequestParam(required = false) String type, @RequestParam(required = false) String dateFrom,
      @RequestParam(required = false) String dateTo, @RequestParam(defaultValue = "0") int offset, @RequestParam(defaultValue = "25") int limit) {
    return sql.list("SELECT * FROM public.ai_analysis_history WHERE (?::text IS NULL OR analysis_type = ?::text)"
        + " AND (?::timestamptz IS NULL OR created_at >= ?::timestamptz) AND (?::timestamptz IS NULL OR created_at <= ?::timestamptz)"
        + " ORDER BY created_at DESC LIMIT ? OFFSET ?", type, type, dateFrom, dateFrom, dateTo, dateTo, Math.min(Math.max(limit, 1), 200), Math.max(offset, 0));
  }

  @GetMapping("/schedules")
  @Operation(operationId = "listAiSchedules", summary = "Planifications des analyses")
  public JsonNode schedules() {
    return sql.list("SELECT * FROM public.ai_analysis_schedules ORDER BY analysis_type");
  }

  @PutMapping("/schedules")
  @Operation(operationId = "saveAiSchedule", summary = "Enregistrer la planification d'une analyse (administrateur)")
  public JsonNode saveSchedule(@RequestBody Map<String, Object> b) {
    Map<String, Object> row = new HashMap<>();
    row.put("analysis_type", b.get("analysis_type"));
    row.put("frequency", b.get("frequency"));
    row.put("enabled", b.get("enabled"));
    row.put("params", b.get("params") == null ? Map.of() : b.get("params"));
    return sql.upsertWith("ai_analysis_schedules", row, SCHEDULE, List.of("tenant_id", "analysis_type"),
        Map.of("next_run_at", "now()", "created_by", "auth.uid()", "updated_at", "now()"));
  }
}
