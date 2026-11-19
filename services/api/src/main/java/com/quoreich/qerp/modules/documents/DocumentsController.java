package com.quoreich.qerp.modules.documents;

import com.quoreich.qerp.platform.ApiRefusal;
import com.quoreich.qerp.platform.Sql;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

/** Services communs aux pièces : sections analytiques (V77–V78) et seuils d'approbation (V39, V41, V109). */
@RestController
@RequestMapping("/api/v1")
@Tag(name = "Pièces", description = "Sections analytiques des pièces d'achat et seuils d'approbation des circuits")
public class DocumentsController {

  private static final Map<String, String> THRESHOLDS = Map.of("procurement", "procurement_approval_thresholds", "ap", "ap_approval_thresholds",
      "expense", "expense_approval_thresholds");
  private static final Set<String> THRESHOLD = Set.of("doc_type", "doc_types", "level", "max_amount", "approver", "sla_hours");

  private final DocumentAnalytics analytics;
  private final Sql sql;

  public DocumentsController(DocumentAnalytics analytics, Sql sql) {
    this.analytics = analytics;
    this.sql = sql;
  }

  @GetMapping("/document-analytics/{kind}/{id}")
  @Operation(operationId = "getDocumentAnalytics", summary = "Sections de l'en-tête d'une pièce (PR, PO, AP)")
  public JsonNode header(@PathVariable String kind, @PathVariable UUID id) {
    return analytics.header(kind, id);
  }

  @PutMapping("/document-analytics/{kind}/{id}")
  @Operation(operationId = "saveDocumentAnalytics", summary = "Remplacer les sections de l'en-tête d'une pièce modifiable")
  public JsonNode saveHeader(@PathVariable String kind, @PathVariable UUID id, @RequestBody Map<String, String> values) {
    analytics.saveHeader(kind, id, values);
    return analytics.header(kind, id);
  }

  @GetMapping("/line-analytics/{kind}")
  @Operation(operationId = "listLineAnalytics", summary = "Sections des lignes d'une pièce (identifiants séparés par des virgules)")
  public JsonNode lines(@PathVariable String kind, @RequestParam(defaultValue = "") String ids) {
    return analytics.lines(kind, ids.isBlank() ? List.of() : Arrays.stream(ids.split(",")).map(String::trim).map(UUID::fromString).toList());
  }

  private static String thresholdTable(String kind) {
    String t = THRESHOLDS.get(kind);
    if (t == null) throw new ApiRefusal(400, "Circuit inconnu : " + kind);
    return t;
  }

  @GetMapping("/approval-thresholds/{kind}")
  @Operation(operationId = "listApprovalThresholds", summary = "Seuils d'approbation d'un circuit (procurement, ap, expense)")
  public JsonNode thresholds(@PathVariable String kind) {
    return sql.list("SELECT * FROM public." + thresholdTable(kind) + " ORDER BY max_amount ASC NULLS LAST");
  }

  @PostMapping("/approval-thresholds/{kind}")
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(operationId = "createApprovalThreshold", summary = "Créer un niveau d'approbation (droit de paramétrage du module)")
  public JsonNode createThreshold(@PathVariable String kind, @RequestBody Map<String, Object> body) {
    Map<String, Object> b = new LinkedHashMap<>(body);
    if (kind.equals("ap")) b.put("doc_types", "factures");
    return sql.insert(thresholdTable(kind), b, THRESHOLD);
  }

  @PutMapping("/approval-thresholds/{kind}/{id}")
  @Operation(operationId = "updateApprovalThreshold", summary = "Modifier un niveau d'approbation")
  public JsonNode updateThreshold(@PathVariable String kind, @PathVariable UUID id, @RequestBody Map<String, Object> body) {
    return sql.update(thresholdTable(kind), id, body, THRESHOLD);
  }

  @DeleteMapping("/approval-thresholds/{kind}/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  @Operation(operationId = "deleteApprovalThreshold", summary = "Supprimer un niveau d'approbation")
  public void deleteThreshold(@PathVariable String kind, @PathVariable UUID id) {
    sql.delete(thresholdTable(kind), id);
  }
}
