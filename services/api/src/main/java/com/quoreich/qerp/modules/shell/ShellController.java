package com.quoreich.qerp.modules.shell;

import static com.quoreich.qerp.platform.Sql.args;

import com.quoreich.qerp.platform.Sql;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * Coquille de l'application, lue dans la base locale : profil et société, modules actifs, alertes et
 * préférences de notification, calendrier fiscal (V33).
 */
@RestController
@RequestMapping("/api/v1")
@Tag(name = "Application", description = "Profil, société courante, modules actifs, alertes, calendrier fiscal")
public class ShellController {

  private static final Set<String> ALERT_SORT = Set.of("created_at", "severity", "module", "title", "alert_type");
  private static final Set<String> PREFS = Set.of("user_id", "modules", "severities", "include_resolved", "updated_at");
  private static final ObjectMapper JSON = new ObjectMapper();

  private final Sql sql;

  public ShellController(Sql sql) {
    this.sql = sql;
  }

  @GetMapping("/me")
  @Operation(operationId = "getMe", summary = "Profil de l'utilisateur connecté et sa société (tenant_id null = pas encore de société)")
  public JsonNode me() {
    return sql.one("SELECT p.id, p.full_name, p.tenant_id, (SELECT to_jsonb(t) FROM (SELECT id, name, currency FROM public.tenants WHERE id = p.tenant_id) t) AS tenant"
        + " FROM public.profiles p WHERE p.id = auth.uid()");
  }

  @GetMapping("/profiles")
  @Operation(operationId = "listTenantProfiles", summary = "Membres de la société courante (nom affiché)")
  public JsonNode profiles() {
    return sql.list("SELECT id, full_name, avatar_url, tenant_id, created_at FROM public.profiles WHERE tenant_id = public.get_user_tenant_id(auth.uid())");
  }

  @GetMapping("/tenant")
  @Operation(operationId = "getCurrentTenant", summary = "Société courante (nom, devise)")
  public JsonNode tenant() {
    return sql.one("SELECT name, currency FROM public.tenants WHERE id = public.get_user_tenant_id(auth.uid())");
  }

  @GetMapping("/active-modules")
  @Operation(operationId = "listActiveModules", summary = "Modules actifs de la société")
  public JsonNode activeModules() {
    return sql.list("SELECT module_name, status FROM public.tenant_modules WHERE tenant_id = public.get_user_tenant_id(auth.uid()) AND status = 'active'");
  }

  // ─── Alertes ───

  private static String csv(String s) {
    return s == null || s.isBlank() ? null : "{" + String.join(",", Arrays.stream(s.split(",")).map(String::trim).toList()) + "}";
  }

  @GetMapping("/alerts")
  @Operation(operationId = "listAlerts", summary = "Alertes (200 dernières ; filtres modules / gravités séparés par des virgules)")
  public JsonNode alerts(@RequestParam(defaultValue = "false") boolean includeResolved, @RequestParam(required = false) String modules,
      @RequestParam(required = false) String severities) {
    return sql.list("SELECT * FROM public.erp_alerts WHERE (? OR NOT is_resolved) AND (?::text[] IS NULL OR module = ANY (?::text[]))"
        + " AND (?::text[] IS NULL OR severity = ANY (?::text[])) ORDER BY created_at DESC LIMIT 200",
        includeResolved, csv(modules), csv(modules), csv(severities), csv(severities));
  }

  @GetMapping("/alerts/page")
  @Operation(operationId = "pageAlerts", summary = "Alertes paginées et triées côté serveur ({ rows, total })")
  public JsonNode alertsPage(@RequestParam(defaultValue = "false") boolean includeResolved, @RequestParam(defaultValue = "all") String module,
      @RequestParam(defaultValue = "all") String severity, @RequestParam(required = false) String modules, @RequestParam(required = false) String severities,
      @RequestParam(defaultValue = "") String search, @RequestParam(defaultValue = "created_at") String sortBy, @RequestParam(defaultValue = "desc") String sortDir,
      @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "25") int pageSize) {
    String sort = ALERT_SORT.contains(sortBy) ? sortBy : "created_at";
    String dir = "asc".equalsIgnoreCase(sortDir) ? "ASC" : "DESC";
    int size = Math.min(Math.max(pageSize, 1), 200);
    String where = " WHERE (? OR NOT is_resolved) AND (?::text = 'all' OR module = ?::text) AND (?::text <> 'all' OR ?::text[] IS NULL OR module = ANY (?::text[]))"
        + " AND (?::text = 'all' OR severity = ?::text) AND (?::text <> 'all' OR ?::text[] IS NULL OR severity = ANY (?::text[]))"
        + " AND (?::text = '' OR title ILIKE '%' || ?::text || '%' OR message ILIKE '%' || ?::text || '%')";
    String s = search.trim();
    List<Object> a = new ArrayList<>(List.of(includeResolved, module, module, module));
    a.add(csv(modules));
    a.add(csv(modules));
    a.addAll(List.of(severity, severity, severity));
    a.add(csv(severities));
    a.add(csv(severities));
    a.addAll(List.of(s, s, s));
    ObjectNode out = JSON.createObjectNode();
    List<Object> rowsArgs = new ArrayList<>(a);
    rowsArgs.add(size);
    rowsArgs.add(Math.max(page, 0) * size);
    out.set("rows", sql.list("SELECT * FROM public.erp_alerts" + where + " ORDER BY " + sort + " " + dir + " LIMIT ? OFFSET ?", rowsArgs.toArray()));
    out.put("total", sql.value(Long.class, "SELECT count(*) FROM public.erp_alerts" + where, a.toArray()));
    return out;
  }

  @GetMapping("/alerts/unread-count")
  @Operation(operationId = "countUnreadAlerts", summary = "Nombre d'alertes non lues et non résolues")
  public long unread(@RequestParam(required = false) String modules, @RequestParam(required = false) String severities) {
    return sql.value(Long.class, "SELECT count(*) FROM public.erp_alerts WHERE NOT is_resolved AND read_at IS NULL"
        + " AND (?::text[] IS NULL OR module = ANY (?::text[])) AND (?::text[] IS NULL OR severity = ANY (?::text[]))",
        csv(modules), csv(modules), csv(severities), csv(severities));
  }

  @PostMapping("/alerts/{id}/resolve")
  @Operation(operationId = "resolveAlert", summary = "Marquer une alerte comme résolue")
  public JsonNode resolve(@PathVariable UUID id) {
    return sql.call("resolve_erp_alert", args("_alert_id", id));
  }

  @PostMapping("/alerts/mark-all-read")
  @Operation(operationId = "markAllAlertsRead", summary = "Marquer toutes les alertes comme lues")
  public JsonNode markAllRead() {
    return sql.call("mark_all_erp_alerts_read");
  }

  @PostMapping("/alerts/resolve-all")
  @Operation(operationId = "resolveAllAlerts", summary = "Résoudre toutes les alertes (filtres facultatifs ; administrateur)")
  public JsonNode resolveAll(@RequestBody(required = false) Map<String, Object> b) {
    return sql.call("resolve_all_erp_alerts", args("_module", b == null ? null : b.get("module"), "_severity", b == null ? null : b.get("severity")));
  }

  @GetMapping("/notification-preferences")
  @Operation(operationId = "getNotificationPreferences", summary = "Préférences de notification de l'utilisateur")
  public JsonNode prefs() {
    return sql.one("SELECT * FROM public.notification_preferences WHERE user_id = auth.uid()");
  }

  @PutMapping("/notification-preferences")
  @Operation(operationId = "saveNotificationPreferences", summary = "Enregistrer les préférences de notification")
  public JsonNode savePrefs(@RequestBody Map<String, Object> body) {
    Map<String, Object> b = new java.util.LinkedHashMap<>(body);
    b.remove("user_id");
    b.put("updated_at", java.time.OffsetDateTime.now().toString());
    return sql.upsertWith("notification_preferences", b, PREFS, List.of("user_id"), Map.of("user_id", "auth.uid()"));
  }

  // ─── Calendrier fiscal ───

  @GetMapping("/fiscal-calendar")
  @Operation(operationId = "getFiscalCalendar", summary = "Exercices, périodes, modules et statuts des périodes")
  public JsonNode fiscalCalendar() {
    ObjectNode out = JSON.createObjectNode();
    out.set("years", sql.list("SELECT id, code, start_date, end_date, status FROM public.fiscal_years ORDER BY start_date"));
    out.set("periods", sql.list("SELECT id, fiscal_year_id, period_no, code, start_date, end_date FROM public.fiscal_periods ORDER BY code"));
    out.set("modules", sql.list("SELECT code, label, sort_order, is_ledger FROM public.fiscal_modules ORDER BY sort_order"));
    out.set("locks", sql.list("SELECT period, module, status, closed_at, reason FROM public.period_locks"));
    return out;
  }

  @GetMapping("/fiscal-calendar/audit")
  @Operation(operationId = "listFiscalCalendarAudit", summary = "Journal du calendrier fiscal (100 derniers)")
  public JsonNode fiscalAudit() {
    return sql.list("SELECT seq, created_at, action, fiscal_year_code, period, module, reason, actor_id FROM public.fiscal_calendar_audit ORDER BY seq DESC LIMIT 100");
  }

  @PostMapping("/fiscal-calendar/years")
  @Operation(operationId = "createFiscalYear", summary = "Créer un exercice (non ouvert)")
  public JsonNode createYear(@RequestBody Map<String, Object> b) {
    return sql.call("create_fiscal_year", args("_start", b.get("start"), "_end", b.get("end")));
  }

  @PostMapping("/fiscal-calendar/years/{id}/open")
  @Operation(operationId = "openFiscalYear", summary = "Ouvrir un exercice")
  public JsonNode openYear(@PathVariable UUID id) {
    return sql.call("open_fiscal_year", args("_id", id));
  }

  @PostMapping("/fiscal-calendar/years/{id}/close")
  @Operation(operationId = "closeFiscalYear", summary = "Clôturer définitivement un exercice")
  public JsonNode closeYear(@PathVariable UUID id) {
    return sql.call("close_fiscal_year", args("_id", id));
  }

  @PostMapping("/fiscal-calendar/period-status")
  @Operation(operationId = "setPeriodStatus", summary = "Ouvrir ou clôturer une période pour un module (motif pour rouvrir)")
  public JsonNode periodStatus(@RequestBody Map<String, Object> b) {
    return sql.call("set_period_status", args("_period", b.get("period"), "_module", b.get("module"), "_status", b.get("status"), "_reason", b.get("reason")));
  }
}
