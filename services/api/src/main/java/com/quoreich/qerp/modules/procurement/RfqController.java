package com.quoreich.qerp.modules.procurement;

import com.quoreich.qerp.platform.ApiRefusal;
import com.quoreich.qerp.platform.Sql;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
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
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

/**
 * Demandes de prix et comparatif fournisseurs sur site (V139), jumelles des fonctions du nuage : création (libre ou depuis
 * une demande d'achat approuvée), fournisseurs consultés, envoi, offres, comparatif au cours du jour, attribution (crée les
 * commandes), annulation. Les tables sont en lecture seule : toute écriture passe par ces fonctions.
 */
@RestController
@RequestMapping("/api/v1/procurement")
@Tag(name = "Approvisionnement", description = "Demandes de prix, offres des fournisseurs et attribution")
public class RfqController {

  static final Set<String> ACTIONS = Set.of("create_rfq", "rfq_set_suppliers", "rfq_send", "record_rfq_quote", "award_rfq", "rfq_cancel");
  static final Set<String> SETTINGS = Set.of("min_quotes", "award_second_person", "default_validity_days", "updated_at");

  private final Sql sql;

  public RfqController(Sql sql) {
    this.sql = sql;
  }

  @GetMapping("/rfqs")
  @Operation(operationId = "listRfqs", summary = "Demandes de prix de la société (lignes, fournisseurs consultés, offres reçues)")
  public JsonNode rfqs() {
    return sql.list("SELECT r.*, (SELECT pr_number FROM public.purchase_requisitions p WHERE p.id = r.requisition_id) AS pr_number,"
        + " (SELECT count(*) FROM public.rfq_lines l WHERE l.rfq_id = r.id) AS line_count,"
        + " (SELECT count(*) FROM public.rfq_suppliers s WHERE s.rfq_id = r.id) AS supplier_count,"
        + " (SELECT count(*) FROM public.rfq_suppliers s WHERE s.rfq_id = r.id AND s.status = 'responded') AS response_count"
        + " FROM public.rfqs r ORDER BY r.created_at DESC");
  }

  @GetMapping("/rfqs/{id}/lines")
  @Operation(operationId = "listRfqLines", summary = "Lignes d'une demande de prix")
  public JsonNode lines(@PathVariable UUID id) {
    return sql.list("SELECT * FROM public.rfq_lines WHERE rfq_id = ? ORDER BY line_no", id);
  }

  @GetMapping("/rfqs/{id}/suppliers")
  @Operation(operationId = "listRfqSuppliers", summary = "Fournisseurs consultés et conditions de leur offre")
  public JsonNode suppliers(@PathVariable UUID id) {
    return sql.list("SELECT rs.*, s.name AS supplier_name FROM public.rfq_suppliers rs JOIN public.suppliers s ON s.id = rs.supplier_id"
        + " WHERE rs.rfq_id = ? ORDER BY s.name", id);
  }

  @GetMapping("/rfqs/{id}/comparison")
  @Operation(operationId = "listRfqComparison", summary = "Comparatif des offres par ligne (prix au cours du jour, rang)")
  public JsonNode comparison(@PathVariable UUID id) {
    return sql.list("SELECT * FROM public.rfq_comparison WHERE rfq_id = ? ORDER BY line_no, price_rank, supplier_name", id);
  }

  @GetMapping("/rfqs/{id}/awards")
  @Operation(operationId = "listRfqAwards", summary = "Attributions d'une demande de prix et commandes créées")
  public JsonNode awards(@PathVariable UUID id) {
    return sql.list("SELECT a.*, s.name AS supplier_name, (SELECT po_number FROM public.purchase_orders p WHERE p.id = a.po_id) AS po_number"
        + " FROM public.rfq_awards a JOIN public.suppliers s ON s.id = a.supplier_id WHERE a.rfq_id = ?", id);
  }

  @PostMapping("/rfqs/actions/{function}")
  @Operation(operationId = "runRfqAction", summary = "Opération sur les demandes de prix (fonction de la liste autorisée, arguments nommés)")
  public JsonNode action(@PathVariable String function, @RequestBody(required = false) Map<String, Object> a) {
    if (!ACTIONS.contains(function)) throw new ApiRefusal(404, "Opération inconnue : " + function);
    return sql.call(function, a == null ? Map.of() : a);
  }

  @GetMapping("/rfq-settings")
  @Operation(operationId = "getRfqSettings", summary = "Réglages des demandes de prix (null = valeurs par défaut)")
  public JsonNode settings() {
    return sql.one("SELECT * FROM public.rfq_settings");
  }

  @PutMapping("/rfq-settings")
  @Operation(operationId = "saveRfqSettings", summary = "Enregistrer les réglages des demandes de prix (droit procurement.settings)")
  public JsonNode saveSettings(@RequestBody Map<String, Object> body) {
    return sql.upsert("rfq_settings", body, SETTINGS, List.of("tenant_id"));
  }
}
