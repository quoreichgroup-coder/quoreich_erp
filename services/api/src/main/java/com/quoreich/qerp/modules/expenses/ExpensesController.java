package com.quoreich.qerp.modules.expenses;

import com.quoreich.qerp.platform.ApiRefusal;
import com.quoreich.qerp.platform.Sql;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
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
import org.springframework.web.multipart.MultipartFile;
import tools.jackson.databind.JsonNode;

/**
 * Notes de frais (V109–V112) : notes et lignes (brouillon écrit en une transaction), cycle par les fonctions
 * de la base, catégories, barèmes, avances, paramètres, et justificatifs stockés sur le serveur
 * ({@code qerp.files.dir}) avec les règles du stockage du nuage : lecture par qui voit la note, dépôt par
 * l'auteur ou {@code expenses.manage} tant que la note est en brouillon ou rejetée.
 */
@RestController
@RequestMapping("/api/v1/expenses")
@Tag(name = "Notes de frais", description = "Notes, lignes, cycle d'approbation, barèmes, avances et justificatifs")
public class ExpensesController {

  static final Set<String> ACTIONS = Set.of("expense_report_submit", "expense_report_decide", "expense_report_post", "expense_report_pay",
      "expense_report_cancel", "expense_advance_pay", "expense_advance_refund", "assign_expense_role");
  static final Set<String> CATEGORY = Set.of("code", "name", "gl_account_id", "default_tax_code_id", "receipt_required_above", "max_amount_per_line", "is_active");
  static final Set<String> RATE = Set.of("kind", "code", "name", "unit", "rate", "category_id", "valid_from", "valid_to", "is_active");
  static final Set<String> SETTINGS = Set.of("receipt_required_above", "max_report_amount", "late_submission_days", "updated_at");
  static final Set<String> ALLOWED_TYPES = Set.of("image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf");

  private final Sql sql;
  private final Drafts drafts;
  private final Path files;

  public ExpensesController(Sql sql, Drafts drafts, @Value("${qerp.files.dir:./data/files}") String filesDir) {
    this.sql = sql;
    this.drafts = drafts;
    this.files = Path.of(filesDir).toAbsolutePath().normalize();
  }

  @PostMapping("/actions/{function}")
  @Operation(operationId = "runExpensesAction", summary = "Cycle des notes et des avances (fonction de la liste autorisée, arguments nommés)")
  public JsonNode action(@PathVariable String function, @RequestBody(required = false) Map<String, Object> a) {
    if (!ACTIONS.contains(function)) throw new ApiRefusal(404, "Opération inconnue : " + function);
    return sql.call(function, a == null ? Map.of() : a);
  }

  @GetMapping("/reports")
  @Operation(operationId = "listExpenseReports", summary = "Notes visibles (les siennes, ou toutes avec expenses.view_all), avec salarié, lignes, approbations, pièces")
  public JsonNode reports() {
    return sql.list("SELECT r.*, (SELECT to_jsonb(x) FROM (SELECT first_name, last_name, matricule FROM public.employees WHERE id = r.employee_id) x) AS employee,"
        + " coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.line_no) FROM public.expense_lines l WHERE l.report_id = r.id), '[]'::jsonb) AS lines,"
        + " coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.level_order) FROM public.expense_report_approvals a WHERE a.report_id = r.id), '[]'::jsonb) AS approvals,"
        + " (SELECT to_jsonb(x) FROM (SELECT piece_number FROM public.journal_entries WHERE id = r.journal_entry_id) x) AS entry,"
        + " (SELECT to_jsonb(x) FROM (SELECT piece_number FROM public.journal_entries WHERE id = r.payment_journal_entry_id) x) AS payment_entry"
        + " FROM public.expense_reports r ORDER BY r.created_at DESC");
  }

  @PostMapping("/reports")
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(operationId = "createExpenseDraft", summary = "Créer une note en brouillon avec ses lignes (une transaction)")
  public JsonNode create(@RequestBody Map<String, Object> body) {
    return sql.one("SELECT id FROM public.expense_reports WHERE id = ?::uuid", drafts.save(null, body).toString());
  }

  @PutMapping("/reports/{id}")
  @Operation(operationId = "updateExpenseDraft", summary = "Remplacer l'en-tête et les lignes d'une note modifiable")
  public JsonNode update(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
    return sql.one("SELECT id FROM public.expense_reports WHERE id = ?::uuid", drafts.save(id, body).toString());
  }

  @DeleteMapping("/reports/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  @Operation(operationId = "deleteExpenseDraft", summary = "Supprimer une note en brouillon")
  public void delete(@PathVariable UUID id) {
    sql.delete("expense_reports", id);
  }

  @GetMapping("/categories")
  @Operation(operationId = "listExpenseCategories", summary = "Catégories de frais")
  public JsonNode categories() {
    return sql.list("SELECT * FROM public.expense_categories ORDER BY code");
  }

  @PostMapping("/categories")
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(operationId = "createExpenseCategory", summary = "Créer une catégorie (droit expenses.settings)")
  public JsonNode createCategory(@RequestBody Map<String, Object> body) {
    return sql.insert("expense_categories", body, CATEGORY);
  }

  @PatchMapping("/categories/{id}")
  @Operation(operationId = "updateExpenseCategory", summary = "Modifier une catégorie")
  public JsonNode updateCategory(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
    return sql.update("expense_categories", id, body, CATEGORY);
  }

  @GetMapping("/rates")
  @Operation(operationId = "listExpenseRates", summary = "Barèmes (kilométrique, per diem)")
  public JsonNode rates() {
    return sql.list("SELECT * FROM public.expense_rates ORDER BY code");
  }

  @PostMapping("/rates")
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(operationId = "createExpenseRate", summary = "Créer un barème")
  public JsonNode createRate(@RequestBody Map<String, Object> body) {
    return sql.insert("expense_rates", body, RATE);
  }

  @PatchMapping("/rates/{id}")
  @Operation(operationId = "updateExpenseRate", summary = "Modifier un barème")
  public JsonNode updateRate(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
    return sql.update("expense_rates", id, body, RATE);
  }

  @GetMapping("/settings")
  @Operation(operationId = "getExpenseSettings", summary = "Règles des notes de frais")
  public JsonNode settings() {
    return sql.one("SELECT * FROM public.expense_settings WHERE tenant_id = public.get_user_tenant_id(auth.uid())");
  }

  @PutMapping("/settings")
  @Operation(operationId = "saveExpenseSettings", summary = "Enregistrer les règles (droit expenses.settings)")
  public JsonNode saveSettings(@RequestBody Map<String, Object> body) {
    Map<String, Object> b = new LinkedHashMap<>(body);
    b.put("updated_at", java.time.OffsetDateTime.now().toString());
    return sql.upsertWith("expense_settings", b, SETTINGS, List.of("tenant_id"), Map.of("updated_by", "auth.uid()"));
  }

  @GetMapping("/employees")
  @Operation(operationId = "listExpenseEmployees", summary = "Salariés (pour la saisie des notes)")
  public JsonNode employees() {
    return sql.list("SELECT id, matricule, first_name, last_name, status FROM public.employees ORDER BY last_name");
  }

  @GetMapping("/advances")
  @Operation(operationId = "listExpenseAdvances", summary = "Avances aux salariés")
  public JsonNode advances() {
    return sql.list("SELECT a.*, (SELECT to_jsonb(x) FROM (SELECT first_name, last_name FROM public.employees WHERE id = a.employee_id) x) AS employee"
        + " FROM public.expense_advances a ORDER BY a.advance_date DESC");
  }

  @GetMapping("/role-audit")
  @Operation(operationId = "listExpenseRoleAudit", summary = "Journal des rôles des notes de frais")
  public JsonNode roleAudit() {
    return sql.list("SELECT * FROM public.expense_role_audit ORDER BY created_at DESC LIMIT 500");
  }

  // ─── Justificatifs ───

  @PostMapping(value = "/reports/{reportId}/lines/{lineId}/receipt", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  @Operation(operationId = "attachExpenseReceipt", summary = "Joindre un justificatif à une ligne (image ou PDF, 10 Mo ; note modifiable)")
  public JsonNode attach(@PathVariable UUID reportId, @PathVariable UUID lineId, @RequestParam("file") MultipartFile file) throws IOException {
    if (file.isEmpty() || file.getSize() > 10L * 1024 * 1024) throw new ApiRefusal(422, "Justificatif vide ou de plus de 10 Mo");
    if (!ALLOWED_TYPES.contains(String.valueOf(file.getContentType()))) throw new ApiRefusal(422, "Type de fichier non admis (image ou PDF)");
    Boolean writable = sql.value(Boolean.class, "SELECT EXISTS (SELECT 1 FROM public.expense_reports r WHERE r.id = ?::uuid AND r.status IN ('draft', 'rejected')"
        + " AND (r.created_by = auth.uid() OR public.has_permission(auth.uid(), 'expenses.manage')))", reportId.toString());
    if (!Boolean.TRUE.equals(writable)) throw ApiRefusal.untouched();
    String tenant = sql.value(String.class, "SELECT public.get_user_tenant_id(auth.uid())::text");
    String safe = String.valueOf(file.getOriginalFilename()).replaceAll("[^A-Za-z0-9._-]+", "_");
    safe = safe.substring(Math.max(0, safe.length() - 80));
    String rel = tenant + "/" + reportId + "/" + UUID.randomUUID() + "-" + safe;
    Path target = resolve(rel);
    Files.createDirectories(target.getParent());
    file.transferTo(target);
    try {
      return sql.update("expense_lines", lineId, Sql.args("receipt_path", rel), Set.of("receipt_path"));
    } catch (RuntimeException e) {
      Files.deleteIfExists(target);
      throw e;
    }
  }

  @GetMapping("/receipts")
  @Operation(operationId = "downloadExpenseReceipt", summary = "Télécharger un justificatif (note visible par l'utilisateur)")
  public ResponseEntity<FileSystemResource> receipt(@RequestParam String path) throws IOException {
    String[] parts = path.split("/");
    if (parts.length != 3) throw new ApiRefusal(400, "Chemin de justificatif invalide");
    Boolean visible = sql.value(Boolean.class, "SELECT ?::text = public.get_user_tenant_id(auth.uid())::text"
        + " AND EXISTS (SELECT 1 FROM public.expense_reports r WHERE r.id::text = ?)", parts[0], parts[1]);
    Path f = resolve(path);
    if (!Boolean.TRUE.equals(visible) || !Files.isRegularFile(f)) throw new ApiRefusal(404, "Justificatif introuvable");
    String type = Files.probeContentType(f);
    return ResponseEntity.ok().header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"" + f.getFileName() + "\"")
        .contentType(type == null ? MediaType.APPLICATION_OCTET_STREAM : MediaType.parseMediaType(type)).body(new FileSystemResource(f));
  }

  /** Chemin sous le répertoire des fichiers, jamais au-dessus (pas de « .. »). */
  private Path resolve(String rel) {
    Path p = files.resolve(rel).normalize();
    if (!p.startsWith(files)) throw new ApiRefusal(400, "Chemin de justificatif invalide");
    return p;
  }

  /** Brouillon (en-tête et lignes) en une transaction. */
  @Service
  public static class Drafts {
    static final Set<String> HEADER = Set.of("employee_id", "purpose", "period_start", "period_end", "notes");
    static final Set<String> LINE = Set.of("report_id", "line_no", "expense_date", "category_id", "description", "merchant", "receipt_ref", "amount",
        "tax_code_id", "project_id", "rate_id", "quantity", "original_currency", "original_amount", "exchange_rate", "receipt_path");
    private final Sql sql;

    public Drafts(Sql sql) {
      this.sql = sql;
    }

    @Transactional
    @SuppressWarnings("unchecked")
    public UUID save(UUID existing, Map<String, Object> body) {
      Map<String, Object> header = new LinkedHashMap<>(body);
      List<Map<String, Object>> lines = (List<Map<String, Object>>) header.remove("lines");
      UUID id;
      if (existing != null) {
        sql.update("expense_reports", existing, header, HEADER);
        sql.deleteWhereAny("expense_lines", "report_id = ?::uuid", existing.toString());
        id = existing;
      } else {
        id = UUID.fromString(sql.insert("expense_reports", header, HEADER, Map.of("status", "'draft'")).get("id").asString());
      }
      int n = 0;
      for (Map<String, Object> raw : lines == null ? List.<Map<String, Object>>of() : lines) {
        Map<String, Object> l = new LinkedHashMap<>(raw);
        l.put("report_id", id);
        l.put("line_no", ++n);
        sql.insert("expense_lines", l, LINE);
      }
      return id;
    }
  }
}
