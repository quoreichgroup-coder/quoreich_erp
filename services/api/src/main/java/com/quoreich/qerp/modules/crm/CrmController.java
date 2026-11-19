package com.quoreich.qerp.modules.crm;

import com.quoreich.qerp.platform.ApiRefusal;
import com.quoreich.qerp.platform.Sql;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

/** CRM (lot 5) : contacts, opportunités, activités et relances, conversion en devis, rôles et journal. */
@RestController
@RequestMapping("/api/v1/crm")
@Tag(name = "CRM", description = "Contacts, opportunités, activités, relances et conversion en devis")
public class CrmController {

  static final Set<String> ACTIONS = Set.of("convert_opportunity_to_quote", "convert_quote_to_so", "log_crm_export", "assign_crm_role");
  static final Set<String> CONTACT = Set.of("full_name", "email", "phone", "company", "position", "owner_id", "status", "source", "tags", "notes");
  static final Set<String> OPPORTUNITY = Set.of("contact_id", "name", "stage", "amount", "currency", "probability", "expected_close_date", "owner_id", "status",
      "notes", "customer_id");
  static final Set<String> ACTIVITY = Set.of("opportunity_id", "contact_id", "type", "subject", "notes", "due_at", "assigned_to", "completed_at");
  private static final ObjectMapper JSON = new ObjectMapper();

  private final Sql sql;
  private final Bulk bulk;

  public CrmController(Sql sql, Bulk bulk) {
    this.sql = sql;
    this.bulk = bulk;
  }

  @PostMapping("/actions/{function}")
  @Operation(operationId = "runCrmAction", summary = "Opération CRM (fonction de la liste autorisée, arguments nommés)")
  public JsonNode action(@PathVariable String function, @RequestBody(required = false) Map<String, Object> a) {
    if (!ACTIONS.contains(function)) throw new ApiRefusal(404, "Opération inconnue : " + function);
    return sql.call(function, a == null ? Map.of() : a);
  }

  // ─── Contacts ───

  @GetMapping("/contacts")
  @Operation(operationId = "listCrmContacts", summary = "Contacts (recherche facultative sur nom, e-mail, société, téléphone)")
  public JsonNode contacts(@RequestParam(defaultValue = "") String search) {
    String s = search.trim();
    return sql.list("SELECT * FROM public.crm_contacts WHERE ?::text = '' OR full_name ILIKE '%' || ?::text || '%' OR email ILIKE '%' || ?::text || '%'"
        + " OR company ILIKE '%' || ?::text || '%' OR phone ILIKE '%' || ?::text || '%' ORDER BY created_at DESC, id", s, s, s, s, s);
  }

  @PostMapping("/contacts")
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(operationId = "createCrmContact", summary = "Créer un contact")
  public JsonNode createContact(@RequestBody Map<String, Object> body) {
    return sql.insert("crm_contacts", body, CONTACT, Map.of("created_by", "auth.uid()"));
  }

  @PostMapping("/contacts/import")
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(operationId = "importCrmContacts", summary = "Importer des contacts (tout ou rien)")
  @SuppressWarnings("unchecked")
  public JsonNode importContacts(@RequestBody Map<String, Object> body) {
    return bulk.insertContacts((List<Map<String, Object>>) body.getOrDefault("rows", List.of()));
  }

  @PatchMapping("/contacts/{id}")
  @Operation(operationId = "updateCrmContact", summary = "Modifier un contact")
  public JsonNode updateContact(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
    return sql.update("crm_contacts", id, body, CONTACT);
  }

  @PostMapping("/contacts/bulk-update")
  @Operation(operationId = "bulkUpdateCrmContacts", summary = "Modifier plusieurs contacts")
  @SuppressWarnings("unchecked")
  public JsonNode bulkUpdateContacts(@RequestBody Map<String, Object> body) {
    return sql.updateWhere("crm_contacts", (Map<String, Object>) body.get("patch"), CONTACT, "id = ANY (?::uuid[])", ids(body));
  }

  @PostMapping("/contacts/bulk-delete")
  @Operation(operationId = "bulkDeleteCrmContacts", summary = "Supprimer plusieurs contacts")
  public JsonNode bulkDeleteContacts(@RequestBody Map<String, Object> body) {
    return JSON.getNodeFactory().numberNode(sql.deleteWhere("crm_contacts", "id = ANY (?::uuid[])", ids(body)));
  }

  @DeleteMapping("/contacts/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  @Operation(operationId = "deleteCrmContact", summary = "Supprimer un contact")
  public void deleteContact(@PathVariable UUID id) {
    sql.delete("crm_contacts", id);
  }

  // ─── Opportunités ───

  @GetMapping("/opportunities")
  @Operation(operationId = "listCrmOpportunities", summary = "Opportunités")
  public JsonNode opportunities() {
    return sql.list("SELECT * FROM public.crm_opportunities ORDER BY expected_close_date ASC NULLS LAST, id");
  }

  @PostMapping("/opportunities")
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(operationId = "createCrmOpportunity", summary = "Créer une opportunité")
  public JsonNode createOpportunity(@RequestBody Map<String, Object> body) {
    return sql.insert("crm_opportunities", body, OPPORTUNITY, Map.of("created_by", "auth.uid()"));
  }

  @PatchMapping("/opportunities/{id}")
  @Operation(operationId = "updateCrmOpportunity", summary = "Modifier une opportunité (étape, montant…)")
  public JsonNode updateOpportunity(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
    return sql.update("crm_opportunities", id, body, OPPORTUNITY);
  }

  @PostMapping("/opportunities/bulk-update")
  @Operation(operationId = "bulkUpdateCrmOpportunities", summary = "Modifier plusieurs opportunités (étape, responsable, statut, probabilité)")
  @SuppressWarnings("unchecked")
  public JsonNode bulkUpdateOpportunities(@RequestBody Map<String, Object> body) {
    return sql.updateWhere("crm_opportunities", (Map<String, Object>) body.get("patch"), Set.of("stage", "owner_id", "status", "probability"), "id = ANY (?::uuid[])", ids(body));
  }

  @DeleteMapping("/opportunities/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  @Operation(operationId = "deleteCrmOpportunity", summary = "Supprimer une opportunité")
  public void deleteOpportunity(@PathVariable UUID id) {
    sql.delete("crm_opportunities", id);
  }

  @GetMapping("/opportunities/{id}/quote")
  @Operation(operationId = "getCrmOpportunityQuote", summary = "Devis issu d'une opportunité, ses lignes et sa commande")
  public JsonNode quote(@PathVariable UUID id) {
    String qid = sql.value(String.class, "SELECT converted_quotation_id::text FROM public.crm_opportunities WHERE id = ?::uuid", id.toString());
    if (qid == null) return tools.jackson.databind.node.NullNode.getInstance();
    JsonNode quote = sql.one("SELECT id, quote_number, customer_id, quote_date, valid_until, total, status FROM public.quotations WHERE id = ?::uuid", qid);
    if (quote.isNull()) return quote;
    ObjectNode out = JSON.createObjectNode();
    out.set("quote", quote);
    out.set("lines", sql.list("SELECT id, description, quantity, unit_price, total FROM public.quote_lines WHERE quotation_id = ?::uuid", qid));
    out.set("salesOrder", sql.one("SELECT id, so_number, status FROM public.sales_orders WHERE quotation_id = ?::uuid", qid));
    return out;
  }

  @GetMapping("/converted-quotations")
  @Operation(operationId = "listConvertedQuotationIds", summary = "Devis déjà commandés (identifiants)")
  public JsonNode converted() {
    return sql.list("SELECT quotation_id FROM public.sales_orders WHERE quotation_id IS NOT NULL");
  }

  @GetMapping("/customers")
  @Operation(operationId = "listCrmCustomers", summary = "Clients (identifiant, nom) pour la conversion")
  public JsonNode customers() {
    return sql.list("SELECT id, name FROM public.customers ORDER BY name");
  }

  // ─── Activités ───

  @GetMapping("/activities")
  @Operation(operationId = "listCrmActivities", summary = "Activités : d'une opportunité, relances (avec échéance) ou changements d'étape")
  public JsonNode activities(@RequestParam(required = false) UUID opportunityId, @RequestParam(defaultValue = "all") String kind) {
    return switch (kind) {
      case "reminders" -> sql.list("SELECT * FROM public.crm_activities WHERE due_at IS NOT NULL ORDER BY due_at, id");
      case "stage-changes" -> sql.list("SELECT * FROM public.crm_activities WHERE type = 'stage_change' ORDER BY created_at DESC, id");
      default -> sql.list("SELECT * FROM public.crm_activities WHERE opportunity_id = ?::uuid ORDER BY created_at DESC",
          opportunityId == null ? null : opportunityId.toString());
    };
  }

  @PostMapping("/activities")
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(operationId = "createCrmActivity", summary = "Créer une activité ou une relance")
  public JsonNode createActivity(@RequestBody Map<String, Object> body) {
    return sql.insert("crm_activities", body, ACTIVITY, Map.of("created_by", "auth.uid()"));
  }

  @PostMapping("/activities/{id}/complete")
  @Operation(operationId = "completeCrmActivity", summary = "Marquer une activité comme faite")
  public JsonNode complete(@PathVariable UUID id) {
    return sql.updateWith("crm_activities", Map.of(), Set.of(), Map.of("completed_at", "now()"), "id = ?::uuid", id.toString());
  }

  @GetMapping("/role-audit")
  @Operation(operationId = "listCrmRoleAudit", summary = "Journal des rôles CRM")
  public JsonNode roleAudit() {
    return sql.list("SELECT * FROM public.crm_role_audit ORDER BY created_at DESC LIMIT 500");
  }

  @SuppressWarnings("unchecked")
  private static String ids(Map<String, Object> body) {
    List<Object> ids = (List<Object>) body.getOrDefault("ids", List.of());
    if (ids.isEmpty()) throw new ApiRefusal(422, "Aucun élément sélectionné");
    List<String> out = new ArrayList<>();
    for (Object o : ids) out.add(UUID.fromString(String.valueOf(o)).toString());
    return "{" + String.join(",", out) + "}";
  }

  /** Import de contacts en une transaction. */
  @Service
  public static class Bulk {
    private final Sql sql;

    public Bulk(Sql sql) {
      this.sql = sql;
    }

    @Transactional
    public JsonNode insertContacts(List<Map<String, Object>> rows) {
      for (Map<String, Object> r : rows) sql.insert("crm_contacts", new LinkedHashMap<>(r), CONTACT, Map.of("created_by", "auth.uid()"));
      return JSON.createObjectNode().put("inserted", rows.size());
    }
  }
}
