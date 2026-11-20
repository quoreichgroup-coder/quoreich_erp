package com.quoreich.qerp.modules.procurement;

import static com.quoreich.qerp.platform.Sql.args;

import com.quoreich.qerp.platform.ApiRefusal;
import com.quoreich.qerp.platform.Sql;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
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
import tools.jackson.databind.JsonNode;

/**
 * Approvisionnement (lot 3) : demandes, commandes, réceptions, circuits d'approbation (V39), suivi des
 * livraisons (V56), rapprochement à 3 voies, réapprovisionnement (V54), paramètres (V57).
 */
@RestController
@RequestMapping("/api/v1/procurement")
@Tag(name = "Approvisionnement", description = "Demandes, commandes, réceptions, approbations, suivi et réapprovisionnement")
public class ProcurementController {

  static final Set<String> SETTINGS = Set.of("three_way_tolerance_pct", "three_way_tolerance_amount", "require_pr_before_po", "require_gr_before_ap",
      "sla_pr_hours", "sla_pr_to_po_hours", "sla_po_to_gr_days", "sla_gr_to_ap_days", "sla_warning_pct", "sla_critical_pct", "sla_color_ok",
      "sla_color_warning", "sla_color_critical", "bank_dual_control", "bank_control_methods", "followup_grace_days", "default_lead_time_days",
      "replenishment_include_requisitions", "replenishment_include_reservations", "grni_on_receipt", "updated_at");
  static final Set<String> SUPPLIER_ITEM = Set.of("supplier_id", "item_id", "supplier_ref", "unit_price", "currency", "lead_time_days",
      "min_order_qty", "order_multiple", "is_preferred", "valid_from", "valid_to", "active", "updated_at");
  static final Set<String> RULE = Set.of("item_id", "warehouse_id", "method", "reorder_point", "safety_stock", "order_qty", "max_qty", "active",
      "updated_at");

  private final Sql sql;
  private final ProcurementDocuments documents;

  public ProcurementController(Sql sql, ProcurementDocuments documents) {
    this.sql = sql;
    this.documents = documents;
  }

  private static String table(String docType) {
    return switch (docType) {
      case "PR" -> "purchase_requisitions";
      case "PO" -> "purchase_orders";
      default -> throw new ApiRefusal(400, "Type de pièce inconnu : " + docType);
    };
  }

  // ─── Demandes, commandes ───

  @GetMapping("/requisitions")
  @Operation(operationId = "listRequisitions", summary = "Demandes d'achat avec leurs lignes")
  public JsonNode requisitions() {
    return sql.list("SELECT r.*, coalesce((SELECT jsonb_agg(to_jsonb(l)) FROM public.requisition_lines l WHERE l.requisition_id = r.id), '[]'::jsonb) AS lines"
        + " FROM public.purchase_requisitions r ORDER BY r.created_at DESC");
  }

  @GetMapping("/purchase-orders")
  @Operation(operationId = "listPurchaseOrders", summary = "Commandes avec le fournisseur et les lignes")
  public JsonNode purchaseOrders() {
    return sql.list("SELECT o.*, (SELECT to_jsonb(x) FROM (SELECT name FROM public.suppliers WHERE id = o.supplier_id) x) AS supplier,"
        + " coalesce((SELECT jsonb_agg(to_jsonb(l)) FROM public.po_lines l WHERE l.po_id = o.id), '[]'::jsonb) AS lines"
        + " FROM public.purchase_orders o ORDER BY o.created_at DESC");
  }

  @PostMapping("/documents/{docType}")
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(operationId = "createProcurementDocument", summary = "Créer une demande (PR) ou une commande (PO) avec lignes et sections, en une transaction")
  public JsonNode create(@PathVariable String docType, @RequestBody Map<String, Object> body) {
    UUID id = documents.save(docType, null, body);
    return sql.one("SELECT * FROM public." + table(docType) + " WHERE id = ?::uuid", id.toString());
  }

  @PutMapping("/documents/{docType}/{id}")
  @Operation(operationId = "updateProcurementDocument", summary = "Remplacer l'en-tête et les lignes d'un brouillon ou d'une pièce rejetée")
  public JsonNode update(@PathVariable String docType, @PathVariable UUID id, @RequestBody Map<String, Object> body) {
    documents.save(docType, id, body);
    return sql.one("SELECT * FROM public." + table(docType) + " WHERE id = ?::uuid", id.toString());
  }

  @DeleteMapping("/documents/{docType}/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  @Operation(operationId = "deleteProcurementDocument", summary = "Supprimer un brouillon ou une pièce rejetée")
  public void delete(@PathVariable String docType, @PathVariable UUID id) {
    sql.delete(table(docType), id);
  }

  @PostMapping("/documents/{docType}/{id}/submit")
  @Operation(operationId = "submitProcurementDocument", summary = "Soumettre à l'approbation (file construite à partir des seuils)")
  public JsonNode submit(@PathVariable String docType, @PathVariable UUID id) {
    return sql.call("procurement_submit", args("_doc_type", docType, "_doc_id", id));
  }

  @PostMapping("/documents/{docType}/{id}/cancel")
  @Operation(operationId = "cancelProcurementDocument", summary = "Annuler une pièce avec motif")
  public JsonNode cancel(@PathVariable String docType, @PathVariable UUID id, @RequestBody Map<String, Object> body) {
    return sql.call("procurement_cancel", args("_doc_type", docType, "_doc_id", id, "_reason", body.get("reason")));
  }

  @PostMapping("/requisitions/{id}/convert")
  @Operation(operationId = "convertRequisition", summary = "Convertir une demande approuvée en commande")
  public JsonNode convert(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
    return sql.call("convert_pr_to_po", args("_pr_id", id, "_supplier_id", body.get("supplier_id")));
  }

  // ─── Approbations ───

  @GetMapping("/approvals")
  @Operation(operationId = "listProcurementApprovals", summary = "Files d'approbation (filtres facultatifs : type, statut)")
  public JsonNode approvals(@RequestParam(required = false) String docType, @RequestParam(defaultValue = "pending") String status) {
    return sql.list("SELECT * FROM public.procurement_approvals WHERE (?::text IS NULL OR doc_type = ?::text) AND (?::text = 'all' OR status = ?::text)"
        + " ORDER BY created_at DESC", docType, docType, status, status);
  }

  @PostMapping("/approvals/{id}/approve")
  @Operation(operationId = "approveProcurementStep", summary = "Approuver le niveau en cours (droit du niveau, jamais l'auteur)")
  public JsonNode approve(@PathVariable UUID id, @RequestBody(required = false) Map<String, Object> body) {
    return sql.call("approve_procurement_step", args("_approval_id", id, "_comment", body == null ? null : body.get("comment")));
  }

  @PostMapping("/approvals/{id}/reject")
  @Operation(operationId = "rejectProcurementStep", summary = "Rejeter le niveau en cours (motif obligatoire)")
  public JsonNode reject(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
    return sql.call("reject_procurement_step", args("_approval_id", id, "_comment", body.get("comment")));
  }

  @GetMapping("/thresholds")
  @Operation(operationId = "listProcurementThresholds", summary = "Seuils d'approbation des achats")
  public JsonNode thresholds(@RequestParam(required = false) String docType) {
    return sql.list("SELECT * FROM public.procurement_approval_thresholds WHERE (?::text IS NULL OR doc_type = ?::text)"
        + " ORDER BY doc_type, max_amount ASC NULLS LAST", docType, docType);
  }

  // ─── Réceptions ───

  @GetMapping("/goods-receipts")
  @Operation(operationId = "listGoodsReceipts", summary = "Réceptions avec la commande, le fournisseur et les lignes")
  public JsonNode receipts() {
    return sql.list("SELECT g.*, (SELECT to_jsonb(x) FROM (SELECT o.po_number, (SELECT to_jsonb(s) FROM (SELECT name FROM public.suppliers WHERE id = o.supplier_id) s) AS supplier"
        + " FROM public.purchase_orders o WHERE o.id = g.po_id) x) AS po,"
        + " coalesce((SELECT jsonb_agg(to_jsonb(l)) FROM public.gr_lines l WHERE l.gr_id = g.id), '[]'::jsonb) AS lines"
        + " FROM public.goods_receipts g ORDER BY g.created_at DESC");
  }

  @PostMapping("/goods-receipts")
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(operationId = "createGoodsReceipt", summary = "Réception en attente avec ses lignes, validée si demandé (stock et statut de la commande par la base)")
  public JsonNode receive(@RequestBody Map<String, Object> body) {
    return documents.receive(body);
  }

  @PostMapping("/goods-receipts/{id}/complete")
  @Operation(operationId = "completeGoodsReceipt", summary = "Valider une réception en attente")
  public JsonNode complete(@PathVariable UUID id) {
    return sql.update("goods_receipts", id, Map.of("status", "completed"), Set.of("status"));
  }

  // ─── Rapprochement, suivi, indicateurs ───

  @GetMapping("/three-way-match")
  @Operation(operationId = "listThreeWayMatch", summary = "Rapprochement commande / réception / facture")
  public JsonNode threeWay(@RequestParam(defaultValue = "all") String status) {
    return sql.list("SELECT * FROM public.three_way_match_view WHERE (?::text = 'all' OR match_status = ?::text) ORDER BY order_date DESC", status, status);
  }

  @PostMapping("/purchase-orders/{id}/match-decision")
  @Operation(operationId = "recordMatchDecision", summary = "Décision sur un écart de rapprochement")
  public JsonNode matchDecision(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
    return sql.call("record_match_decision", args("_po_id", id, "_decision", body.get("decision"), "_reason", body.get("reason")));
  }

  @GetMapping("/match-decisions")
  @Operation(operationId = "listMatchDecisions", summary = "Décisions de rapprochement")
  public JsonNode matchDecisions(@RequestParam(required = false) UUID poId) {
    String p = poId == null ? null : poId.toString();
    return sql.list("SELECT * FROM public.procurement_match_decisions WHERE (?::uuid IS NULL OR po_id = ?::uuid) ORDER BY created_at DESC", p, p);
  }

  @GetMapping("/kpis")
  @Operation(operationId = "getProcurementKpis", summary = "Indicateurs des achats")
  public JsonNode kpis() {
    return sql.one("SELECT * FROM public.procurement_kpis_view");
  }

  @GetMapping("/sla")
  @Operation(operationId = "listProcurementSla", summary = "Délais du circuit achat")
  public JsonNode sla() {
    return sql.list("SELECT * FROM public.procurement_sla_view ORDER BY po_date DESC LIMIT 200");
  }

  @GetMapping("/audit")
  @Operation(operationId = "listProcurementAudit", summary = "Piste d'audit des achats")
  public JsonNode audit(@RequestParam(required = false) String dateFrom, @RequestParam(required = false) String dateTo,
      @RequestParam(defaultValue = "all") String eventType) {
    return sql.list("SELECT * FROM public.procurement_audit_view WHERE (?::timestamptz IS NULL OR event_at >= ?::timestamptz)"
        + " AND (?::timestamptz IS NULL OR event_at <= ?::timestamptz) AND (?::text = 'all' OR event_type = ?::text) ORDER BY event_at DESC LIMIT 500",
        dateFrom, dateFrom, dateTo, dateTo, eventType, eventType);
  }

  @GetMapping("/role-audit")
  @Operation(operationId = "listProcurementRoleAudit", summary = "Journal des rôles achats")
  public JsonNode roleAudit() {
    return sql.list("SELECT * FROM public.procurement_role_audit ORDER BY created_at DESC LIMIT 200");
  }

  @PostMapping("/roles")
  @Operation(operationId = "assignProcurementRole", summary = "Attribuer ou retirer un rôle achats")
  public JsonNode assignRole(@RequestBody Map<String, Object> b) {
    return sql.call("assign_procurement_role", args("_target_user", b.get("target_user"), "_role", b.get("role"), "_action", b.get("action"),
        "_comment", b.get("comment")));
  }

  @GetMapping("/followup")
  @Operation(operationId = "listPurchaseFollowup", summary = "Suivi des livraisons attendues")
  public JsonNode followup() {
    return sql.list("SELECT * FROM public.purchase_order_followup_view ORDER BY promised_date ASC");
  }

  @PostMapping("/purchase-orders/{id}/acknowledge")
  @Operation(operationId = "acknowledgePurchaseOrder", summary = "Accusé de réception du fournisseur")
  public JsonNode acknowledge(@PathVariable UUID id, @RequestBody Map<String, Object> b) {
    return sql.call("acknowledge_purchase_order", args("_po_id", id, "_supplier_reference", b.get("supplier_reference"), "_confirmed_date", b.get("confirmed_date")));
  }

  @PostMapping("/purchase-orders/{id}/reschedule")
  @Operation(operationId = "reschedulePurchaseOrder", summary = "Nouvelle date de livraison (motif)")
  public JsonNode reschedule(@PathVariable UUID id, @RequestBody Map<String, Object> b) {
    return sql.call("reschedule_purchase_order", args("_po_id", id, "_new_date", b.get("new_date"), "_reason", b.get("reason")));
  }

  @GetMapping("/report")
  @Operation(operationId = "getProcurementReport", summary = "Données des rapports achats : commandes et réceptions")
  public JsonNode report() {
    ObjectNodeBuilder out = new ObjectNodeBuilder();
    out.put("pos", sql.list("SELECT o.id, o.po_number, o.order_date, o.expected_date, o.total, o.status,"
        + " (SELECT to_jsonb(x) FROM (SELECT name, category FROM public.suppliers WHERE id = o.supplier_id) x) AS supplier FROM public.purchase_orders o ORDER BY o.order_date"));
    out.put("grs", sql.list("SELECT po_id, receipt_date, status FROM public.goods_receipts"));
    return out.build();
  }

  // ─── Paramètres ───

  @GetMapping("/settings")
  @Operation(operationId = "getProcurementSettings", summary = "Paramètres des achats de la société")
  public JsonNode settings() {
    return sql.one("SELECT * FROM public.procurement_settings");
  }

  @PatchMapping("/settings/{id}")
  @Operation(operationId = "updateProcurementSettings", summary = "Modifier les paramètres des achats (droit procurement.settings)")
  public JsonNode updateSettings(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
    return sql.update("procurement_settings", id, body, SETTINGS);
  }

  // ─── Réapprovisionnement ───

  // ─── Dossiers d'importation, frais d'approche, douane (V129) ───
  static final Set<String> IMPORT_FILE = Set.of("supplier_id", "forwarder_id", "incoterm", "transport_mode", "bill_of_lading", "containers",
      "origin_country", "destination_country", "tec_category", "customs_office", "customs_declaration", "customs_date", "eta", "arrival_date",
      "status", "notes");
  static final Set<String> IMPORT_COST = Set.of("import_file_id", "cost_type_id", "description", "amount", "allocation_basis", "ap_invoice_id");
  static final Set<String> COST_TYPE = Set.of("code", "label", "category", "allocation_basis", "capitalize", "is_active");

  @GetMapping("/import-files")
  @Operation(operationId = "listImportFiles", summary = "Dossiers d'importation (V129)")
  public JsonNode importFiles() {
    return sql.list("SELECT f.*, (SELECT name FROM public.suppliers WHERE id = f.supplier_id) AS supplier_name,"
        + " (SELECT name FROM public.suppliers WHERE id = f.forwarder_id) AS forwarder_name,"
        + " (SELECT COALESCE(jsonb_agg(o.po_id), '[]') FROM public.import_file_orders o WHERE o.import_file_id = f.id) AS po_ids"
        + " FROM public.import_files f ORDER BY f.created_at DESC");
  }

  @PostMapping("/import-files")
  @Operation(operationId = "createImportFile", summary = "Ouvrir un dossier d'importation (droit procurement.import)")
  public JsonNode createImportFile(@RequestBody Map<String, Object> b) {
    return sql.insert("import_files", b, IMPORT_FILE, Map.of("created_by", "auth.uid()"));
  }

  @PatchMapping("/import-files/{id}")
  @Operation(operationId = "updateImportFile", summary = "Modifier un dossier d'importation tant que ses frais ne sont pas répartis")
  public JsonNode updateImportFile(@PathVariable UUID id, @RequestBody Map<String, Object> b) {
    return sql.update("import_files", id, b, IMPORT_FILE);
  }

  @PostMapping("/import-files/{id}/orders")
  @Operation(operationId = "addImportFileOrder", summary = "Rattacher une commande au dossier")
  public JsonNode addImportFileOrder(@PathVariable UUID id, @RequestBody Map<String, Object> b) {
    return sql.insert("import_file_orders", Map.of("import_file_id", id.toString(), "po_id", b.get("po_id")), Set.of("import_file_id", "po_id"));
  }

  @DeleteMapping("/import-files/{id}/orders/{poId}")
  @Operation(operationId = "removeImportFileOrder", summary = "Détacher une commande du dossier")
  public void removeImportFileOrder(@PathVariable UUID id, @PathVariable UUID poId) {
    sql.deleteWhere("import_file_orders", "import_file_id = ?::uuid AND po_id = ?::uuid", id.toString(), poId.toString());
  }

  @GetMapping("/import-files/{id}/costs")
  @Operation(operationId = "listImportFileCosts", summary = "Frais d'approche du dossier")
  public JsonNode importFileCosts(@PathVariable UUID id) {
    return sql.list("SELECT c.*, t.code AS type_code, t.label AS type_label, t.capitalize, t.allocation_basis AS type_basis,"
        + " (SELECT invoice_number FROM public.ap_invoices WHERE id = c.ap_invoice_id) AS ap_invoice_number"
        + " FROM public.import_file_costs c JOIN public.landed_cost_types t ON t.id = c.cost_type_id WHERE c.import_file_id = ? ORDER BY c.created_at", id);
  }

  @PostMapping("/import-files/{id}/costs")
  @Operation(operationId = "addImportFileCost", summary = "Ajouter un frais au dossier")
  public JsonNode addImportFileCost(@PathVariable UUID id, @RequestBody Map<String, Object> b) {
    java.util.Map<String, Object> body = new java.util.HashMap<>(b);
    body.put("import_file_id", id.toString());
    return sql.insert("import_file_costs", body, IMPORT_COST, Map.of("created_by", "auth.uid()"));
  }

  @DeleteMapping("/import-files/{id}/costs/{costId}")
  @Operation(operationId = "deleteImportFileCost", summary = "Retirer un frais du dossier")
  public void deleteImportFileCost(@PathVariable UUID id, @PathVariable UUID costId) {
    sql.deleteWhere("import_file_costs", "id = ?::uuid AND import_file_id = ?::uuid", costId.toString(), id.toString());
  }

  @GetMapping("/import-files/{id}/received-lines")
  @Operation(operationId = "listImportFileReceivedLines", summary = "Lignes reçues des commandes du dossier (bases de répartition)")
  public JsonNode importFileReceivedLines(@PathVariable UUID id) {
    return sql.list("SELECT * FROM public.import_file_received_lines(?)", id);
  }

  @GetMapping("/import-files/{id}/allocations")
  @Operation(operationId = "listImportFileAllocations", summary = "Répartition des frais par ligne reçue")
  public JsonNode importFileAllocations(@PathVariable UUID id) {
    return sql.list("SELECT a.*, (SELECT name FROM public.items WHERE id = a.item_id) AS item_name FROM public.import_file_allocations a"
        + " WHERE a.import_file_id = ? ORDER BY a.cost_id, a.allocated DESC", id);
  }

  @PostMapping("/import-files/{id}/allocate")
  @Operation(operationId = "allocateImportCosts", summary = "Répartir les frais dans le coût du stock (dossier figé ensuite)")
  public JsonNode allocateImportCosts(@PathVariable UUID id, @RequestBody Map<String, Object> b) {
    return sql.call("allocate_import_costs", args("_file", id, "_date", b.getOrDefault("date", java.time.LocalDate.now().toString())));
  }

  @GetMapping("/customs-estimate")
  @Operation(operationId = "estimateCustoms", summary = "Droits et taxes à l'importation estimés (taux UEMOA du pays, catégorie TEC)")
  public JsonNode customsEstimate(@RequestParam String country, @RequestParam(required = false) java.math.BigDecimal category, @RequestParam java.math.BigDecimal cif) {
    return sql.list("SELECT * FROM public.customs_estimate(?, ?, ?)", country, category, cif);
  }

  // ─── Suivi des commandes et des expéditions (V131) ───
  static final Set<String> SHIPMENT_EVENT = Set.of("import_file_id", "po_id", "event_code", "event_class", "event_at", "location", "vessel", "voyage",
      "container_number", "notes");

  @GetMapping("/shipment-event-codes")
  @Operation(operationId = "listShipmentEventCodes", summary = "Étapes de suivi de référence (inspirées de DCSA Track & Trace)")
  public JsonNode shipmentEventCodes() {
    return sql.list("SELECT * FROM public.shipment_event_codes ORDER BY stage");
  }

  @GetMapping("/tracking-status")
  @Operation(operationId = "listTrackingStatus", summary = "État de suivi des dossiers : dernier événement, ETA initiale et actuelle, retard")
  public JsonNode trackingStatus() {
    return sql.list("SELECT * FROM public.shipment_tracking_status");
  }

  @GetMapping("/import-files/{id}/timeline")
  @Operation(operationId = "listShipmentTimeline", summary = "Chronologie du dossier : faits de l'ERP et événements de suivi")
  public JsonNode shipmentTimeline(@PathVariable UUID id) {
    return sql.list("SELECT * FROM public.shipment_timeline(?, NULL)", id);
  }

  @PostMapping("/import-files/{id}/events")
  @Operation(operationId = "addShipmentEvent", summary = "Ajouter un événement de suivi (droit procurement.import ou procurement.followup)")
  public JsonNode addShipmentEvent(@PathVariable UUID id, @RequestBody Map<String, Object> b) {
    java.util.Map<String, Object> body = new java.util.HashMap<>(b);
    body.put("import_file_id", id.toString());
    return sql.insert("shipment_events", body, SHIPMENT_EVENT, Map.of("created_by", "auth.uid()"));
  }

  @PostMapping("/import-files/{id}/events/import")
  @Operation(operationId = "importShipmentEvents", summary = "Importer un fichier de suivi (tout ou rien, sans doublon)")
  public JsonNode importShipmentEvents(@PathVariable UUID id, @RequestBody Map<String, Object> b) {
    return sql.call("import_shipment_events", args("_import_file", id, "_rows", b.get("rows")));
  }

  @DeleteMapping("/shipment-events/{eventId}")
  @Operation(operationId = "deleteShipmentEvent", summary = "Retirer un événement de suivi")
  public void deleteShipmentEvent(@PathVariable UUID eventId) {
    sql.delete("shipment_events", eventId);
  }

  @PostMapping("/purchase-orders/{poId}/import-file")
  @Operation(operationId = "createImportFileFromPo", summary = "Ouvrir un dossier d'importation depuis une commande, déjà rempli")
  public JsonNode createImportFileFromPo(@PathVariable UUID poId) {
    return sql.call("create_import_file_from_po", args("_po", poId));
  }

  @GetMapping("/landed-cost-types")
  @Operation(operationId = "listLandedCostTypes", summary = "Types de frais d'approche de la société")
  public JsonNode landedCostTypes() {
    return sql.list("SELECT * FROM public.landed_cost_types ORDER BY code");
  }

  @PostMapping("/landed-cost-types")
  @Operation(operationId = "createLandedCostType", summary = "Créer un type de frais d'approche")
  public JsonNode createLandedCostType(@RequestBody Map<String, Object> b) {
    return sql.insert("landed_cost_types", b, COST_TYPE);
  }

  @PatchMapping("/landed-cost-types/{id}")
  @Operation(operationId = "updateLandedCostType", summary = "Modifier un type de frais d'approche")
  public JsonNode updateLandedCostType(@PathVariable UUID id, @RequestBody Map<String, Object> b) {
    return sql.update("landed_cost_types", id, b, COST_TYPE);
  }

  @GetMapping("/supplier-items")
  @Operation(operationId = "listSupplierItems", summary = "Catalogue fournisseurs (prix, délais, minimum, multiple)")
  public JsonNode supplierItems() {
    return sql.list("SELECT s.*, (SELECT to_jsonb(x) FROM (SELECT name FROM public.suppliers WHERE id = s.supplier_id) x) AS supplier,"
        + " (SELECT to_jsonb(x) FROM (SELECT code, name, unit FROM public.items WHERE id = s.item_id) x) AS item FROM public.supplier_items s ORDER BY s.created_at");
  }

  @PostMapping("/supplier-items")
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(operationId = "createSupplierItem", summary = "Ajouter une ligne au catalogue fournisseur")
  public JsonNode createSupplierItem(@RequestBody Map<String, Object> body) {
    return sql.insert("supplier_items", body, SUPPLIER_ITEM);
  }

  @PatchMapping("/supplier-items/{id}")
  @Operation(operationId = "updateSupplierItem", summary = "Modifier une ligne du catalogue fournisseur")
  public JsonNode updateSupplierItem(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
    return sql.update("supplier_items", id, stamp(body), SUPPLIER_ITEM);
  }

  @DeleteMapping("/supplier-items/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  @Operation(operationId = "deleteSupplierItem", summary = "Supprimer une ligne du catalogue fournisseur")
  public void deleteSupplierItem(@PathVariable UUID id) {
    sql.delete("supplier_items", id);
  }

  @GetMapping("/replenishment-rules")
  @Operation(operationId = "listReplenishmentRules", summary = "Règles de réapprovisionnement par article")
  public JsonNode rules() {
    return sql.list("SELECT r.*, (SELECT to_jsonb(x) FROM (SELECT code, name, unit FROM public.items WHERE id = r.item_id) x) AS item,"
        + " (SELECT to_jsonb(x) FROM (SELECT code, name FROM public.warehouses WHERE id = r.warehouse_id) x) AS warehouse"
        + " FROM public.item_replenishment_rules r ORDER BY r.created_at");
  }

  @PostMapping("/replenishment-rules")
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(operationId = "createReplenishmentRule", summary = "Créer une règle de réapprovisionnement")
  public JsonNode createRule(@RequestBody Map<String, Object> body) {
    return sql.insert("item_replenishment_rules", body, RULE);
  }

  @PatchMapping("/replenishment-rules/{id}")
  @Operation(operationId = "updateReplenishmentRule", summary = "Modifier une règle de réapprovisionnement")
  public JsonNode updateRule(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
    return sql.update("item_replenishment_rules", id, stamp(body), RULE);
  }

  @DeleteMapping("/replenishment-rules/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  @Operation(operationId = "deleteReplenishmentRule", summary = "Supprimer une règle de réapprovisionnement")
  public void deleteRule(@PathVariable UUID id) {
    sql.delete("item_replenishment_rules", id);
  }

  @GetMapping("/stock-projection")
  @Operation(operationId = "listStockProjection", summary = "Stock projeté : disponible + commandé − réservé")
  public JsonNode projection() {
    return sql.list("SELECT * FROM public.stock_projection_view");
  }

  @GetMapping("/replenishment-proposals")
  @Operation(operationId = "listReplenishmentProposals", summary = "Propositions de réapprovisionnement")
  public JsonNode proposals() {
    return sql.list("SELECT p.*, (SELECT to_jsonb(x) FROM (SELECT code, name, unit FROM public.items WHERE id = p.item_id) x) AS item,"
        + " (SELECT to_jsonb(x) FROM (SELECT code, name FROM public.warehouses WHERE id = p.warehouse_id) x) AS warehouse,"
        + " (SELECT to_jsonb(x) FROM (SELECT name FROM public.suppliers WHERE id = p.supplier_id) x) AS supplier,"
        + " (SELECT to_jsonb(x) FROM (SELECT pr_number FROM public.purchase_requisitions WHERE id = p.requisition_id) x) AS requisition"
        + " FROM public.replenishment_proposals p ORDER BY p.created_at DESC LIMIT 1000");
  }

  @PostMapping("/replenishment-proposals/generate")
  @Operation(operationId = "generateReplenishmentProposals", summary = "Calculer les propositions (remplace les propositions en attente)")
  public JsonNode generate() {
    return sql.call("generate_replenishment_proposals");
  }

  @PostMapping("/replenishment-proposals/convert")
  @Operation(operationId = "convertReplenishmentProposals", summary = "Convertir des propositions en demandes d'achat (une par fournisseur)")
  public JsonNode convertProposals(@RequestBody Map<String, Object> body) {
    return sql.call("convert_replenishment_proposals", args("_ids", body.get("ids")));
  }

  @PostMapping("/replenishment-proposals/{id}/dismiss")
  @Operation(operationId = "dismissReplenishmentProposal", summary = "Écarter une proposition (motif)")
  public JsonNode dismiss(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
    return sql.call("dismiss_replenishment_proposal", args("_id", id, "_reason", body.get("reason")));
  }

  private static Map<String, Object> stamp(Map<String, Object> body) {
    Map<String, Object> b = new LinkedHashMap<>(body);
    b.put("updated_at", java.time.OffsetDateTime.now().toString());
    return b;
  }

  /** Petit assembleur d'objet JSON pour les réponses composées. */
  static final class ObjectNodeBuilder {
    private final tools.jackson.databind.node.ObjectNode node = new tools.jackson.databind.ObjectMapper().createObjectNode();

    void put(String key, JsonNode value) {
      node.set(key, value);
    }

    JsonNode build() {
      return node;
    }
  }
}
