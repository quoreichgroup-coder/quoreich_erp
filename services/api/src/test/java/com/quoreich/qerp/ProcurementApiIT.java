package com.quoreich.qerp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.quoreich.qerp.tenant.TenantContextHolder;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Approvisionnement par l'API (lot 3 sur site) : demande à lignes en une transaction, soumission, refus à
 * l'auteur, approbation par un tiers, conversion en commande, réception à lignes validée (statut de la
 * commande par la base), sur-réception refusée sans rien laisser, invisibilité depuis une autre société.
 */
@SpringBootTest
@AutoConfigureMockMvc
class ProcurementApiIT {

  private static final String DATABASE = "qerp_it_procurement_api";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String ACHETEUR = PostgresFixture.ALPHA_USER;
  private static final String APPROBATEUR = "aaaaaaaa-0000-0000-0000-00000000b1a1";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @Autowired private MockMvc mvc;
  @Autowired private ObjectMapper json;

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.applySyscohada(DATABASE, A);
    PostgresFixture.execute(PostgresFixture.urlOf(DATABASE), "INSERT INTO auth.users (id) VALUES ('" + APPROBATEUR + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + APPROBATEUR + "', '" + A + "', 'Approbateur') ON CONFLICT (id) DO NOTHING;");
    PostgresFixture.grantRoles(DATABASE, ACHETEUR, "admin", A, APPROBATEUR, "procurement_l3", A);
    // Depuis le contrôle d'accès aux modules (V146–V147), un compte sans rôle dans sa propre société est refusé avant même
    // l'isolation : BETA reçoit donc un rôle chez elle, et le test prouve toujours qu'elle ne voit rien d'ALPHA.
    PostgresFixture.grantRoles(DATABASE, PostgresFixture.BETA_USER, "admin", PostgresFixture.BETA_TENANT);
    TenantContextHolder.clear();
  }

  private static RequestPostProcessor as(String user) {
    return jwt().jwt(b -> b.subject(user));
  }

  private JsonNode envoyer(String path, String body, String user, int expected) throws Exception {
    String r = mvc.perform(MockMvcRequestBuilders.post(path).with(as(user)).contentType(MediaType.APPLICATION_JSON).content(body))
        .andExpect(status().is(expected)).andReturn().getResponse().getContentAsString();
    return r.isBlank() ? null : json.readTree(r);
  }

  @Test
  @DisplayName("demande → soumise → refus à l'auteur → approuvée par un tiers → commande → réception validée ; sur-réception refusée sans effet")
  void circuitAchat() throws Exception {
    String fournisseur = envoyer("/api/v1/ap/suppliers", "{\"name\":\"Fournisseur achats API\"}", ACHETEUR, 201).get("id").asString();
    JsonNode pr = envoyer("/api/v1/procurement/documents/PR", "{\"pr_number\":\"PR-API-1\",\"description\":\"Fournitures\",\"estimated_total\":0,"
        + "\"lines\":[{\"description\":\"Ramettes\",\"quantity\":10,\"estimated_unit_cost\":2500},{\"description\":\"Stylos\",\"quantity\":20,\"estimated_unit_cost\":250}]}",
        ACHETEUR, 201);
    String prId = pr.get("id").asString();
    assertThat(pr.get("requested_by").asString()).as("auteur posé par le serveur").isEqualTo(ACHETEUR);
    mvc.perform(get("/api/v1/procurement/requisitions").with(as(ACHETEUR))).andExpect(status().isOk())
        .andExpect(jsonPath("$[?(@.id == '" + prId + "')].lines.length()").value(2));

    JsonNode niveaux = envoyer("/api/v1/procurement/documents/PR/" + prId + "/submit", "{}", ACHETEUR, 200);
    assertThat(niveaux.asInt()).isGreaterThanOrEqualTo(1);
    String etape = PostgresFixture.textAsAdmin(DATABASE, "SELECT id::text FROM procurement_approvals WHERE doc_id = '" + prId + "' AND status = 'pending' ORDER BY level_order LIMIT 1");
    JsonNode refus = envoyer("/api/v1/procurement/approvals/" + etape + "/approve", "{}", ACHETEUR, 422);
    assertThat(refus.get("error").asString()).as("message de la base").contains("Séparation des tâches");
    envoyer("/api/v1/procurement/approvals/" + etape + "/approve", "{\"comment\":\"ok\"}", APPROBATEUR, 200);
    assertThat(PostgresFixture.textAsAdmin(DATABASE, "SELECT status FROM purchase_requisitions WHERE id = '" + prId + "'")).isEqualTo("approved");

    String poId = envoyer("/api/v1/procurement/requisitions/" + prId + "/convert", "{\"supplier_id\":\"" + fournisseur + "\"}", ACHETEUR, 200).asString();
    PostgresFixture.execute(PostgresFixture.urlOf(DATABASE), "UPDATE purchase_orders SET status = 'approved' WHERE id = '" + poId + "'");
    String ligne = PostgresFixture.textAsAdmin(DATABASE, "SELECT id::text FROM po_lines WHERE po_id = '" + poId + "' AND description = 'Ramettes'");

    envoyer("/api/v1/procurement/goods-receipts", "{\"gr_number\":\"GR-API-X\",\"po_id\":\"" + poId + "\",\"complete\":true,"
        + "\"lines\":[{\"po_line_id\":\"" + ligne + "\",\"quantity_received\":99}]}", ACHETEUR, 422);
    assertThat(PostgresFixture.countAsAdmin(DATABASE, "SELECT count(*) FROM goods_receipts WHERE gr_number = 'GR-API-X'"))
        .as("sur-réception refusée : ni en-tête ni ligne").isEqualTo(0);

    JsonNode gr = envoyer("/api/v1/procurement/goods-receipts", "{\"gr_number\":\"GR-API-1\",\"po_id\":\"" + poId + "\",\"complete\":true,"
        + "\"lines\":[{\"po_line_id\":\"" + ligne + "\",\"quantity_received\":4}]}", ACHETEUR, 201);
    assertThat(gr.get("status").asString()).isEqualTo("completed");
    assertThat(PostgresFixture.textAsAdmin(DATABASE, "SELECT status FROM purchase_orders WHERE id = '" + poId + "'")).isEqualTo("partially_received");
    mvc.perform(get("/api/v1/procurement/goods-receipts").with(as(ACHETEUR))).andExpect(status().isOk())
        .andExpect(jsonPath("$[?(@.gr_number == 'GR-API-1')].po.supplier.name").value("Fournisseur achats API"));
    mvc.perform(get("/api/v1/procurement/purchase-orders").with(as(PostgresFixture.BETA_USER))).andExpect(status().isOk())
        .andExpect(jsonPath("$[?(@.id == '" + poId + "')]").isEmpty());
    mvc.perform(get("/api/v1/procurement/settings").with(as(ACHETEUR))).andExpect(status().isOk());
    mvc.perform(get("/api/v1/procurement/followup").with(as(ACHETEUR))).andExpect(status().isOk());
    mvc.perform(get("/api/v1/me").with(as(ACHETEUR))).andExpect(status().isOk()).andExpect(jsonPath("$.tenant_id").value(A));
  }
}
