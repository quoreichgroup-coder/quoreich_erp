package com.quoreich.qerp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
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
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import tools.jackson.databind.ObjectMapper;

/**
 * Comptes fournisseurs par l'API (lot 3 sur site) et socle commun {@code platform.Sql} : la société est
 * posée par le serveur, une colonne hors liste est ignorée, la RLS et les gardes répondent comme sur
 * Supabase (message de la base, 403 / 422), une ligne d'une autre société est introuvable, le cycle de
 * vie passe par les fonctions de la base.
 */
@SpringBootTest
@AutoConfigureMockMvc
class PayableApiIT {

  private static final String DATABASE = "qerp_it_payable_api";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String COMPTABLE = PostgresFixture.ALPHA_USER;
  private static final String LECTEUR = "aaaaaaaa-0000-0000-0000-00000000a9e9";

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
    PostgresFixture.execute(PostgresFixture.urlOf(DATABASE), "INSERT INTO auth.users (id) VALUES ('" + LECTEUR + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + LECTEUR + "', '" + A + "', 'Lecteur') ON CONFLICT (id) DO NOTHING;");
    PostgresFixture.grantRoles(DATABASE, COMPTABLE, "accountant", A, LECTEUR, "viewer", A);
    TenantContextHolder.clear();
  }

  private static RequestPostProcessor as(String user) {
    return jwt().jwt(b -> b.subject(user));
  }

  private String envoyer(String path, String body, String user, int expected) throws Exception {
    return mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post(path).with(as(user))
            .contentType(MediaType.APPLICATION_JSON).content(body))
        .andExpect(status().is(expected)).andReturn().getResponse().getContentAsString();
  }

  @Test
  @DisplayName("fournisseur : créé dans la société du profil (tenant du client ignoré), relu, modifié, refus du lecteur, invisible ailleurs")
  void fournisseurs() throws Exception {
    String cree = envoyer("/api/v1/ap/suppliers", "{\"name\":\"Fournisseur API\",\"country\":\"BF\",\"tenant_id\":\"" + PostgresFixture.BETA_TENANT
        + "\",\"bank_verified\":true}", COMPTABLE, 201);
    String id = json.readTree(cree).get("id").asString();
    assertThat(json.readTree(cree).get("tenant_id").asString()).as("société posée par le serveur").isEqualTo(A);
    assertThat(PostgresFixture.countAsAdmin(DATABASE, "SELECT count(*) FROM suppliers WHERE id = '" + id + "' AND tenant_id = '" + A + "'")).isEqualTo(1);

    mvc.perform(get("/api/v1/ap/suppliers").with(as(COMPTABLE))).andExpect(status().isOk())
        .andExpect(jsonPath("$[?(@.id == '" + id + "')].name").value("Fournisseur API"))
        .andExpect(jsonPath("$[?(@.id == '" + id + "')].lead_time_days").isNotEmpty());
    mvc.perform(patch("/api/v1/ap/suppliers/" + id).with(as(COMPTABLE)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"bank_name\":\"Banque A\",\"bank_account\":\"BF001\"}"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.bank_verified").value(false));
    mvc.perform(post("/api/v1/ap/suppliers/" + id + "/verify-bank").with(as(COMPTABLE)))
        .andExpect(status().is(422)).andExpect(jsonPath("$.error").value(org.hamcrest.Matchers.containsString("autre personne")));

    envoyer("/api/v1/ap/suppliers", "{\"name\":\"Refusé\"}", LECTEUR, 403);
    mvc.perform(patch("/api/v1/ap/suppliers/" + id).with(as(LECTEUR)).contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"x\"}"))
        .andExpect(status().is(403));
    mvc.perform(get("/api/v1/ap/suppliers").with(as(PostgresFixture.BETA_USER))).andExpect(status().isOk())
        .andExpect(jsonPath("$[?(@.id == '" + id + "')]").isEmpty());
    mvc.perform(delete("/api/v1/ap/suppliers/" + id).with(as(PostgresFixture.BETA_USER))).andExpect(status().is(403));
    mvc.perform(delete("/api/v1/ap/suppliers/" + id).with(as(COMPTABLE))).andExpect(status().isNoContent());
  }

  @Test
  @DisplayName("facture : brouillon par l'API, soumission par la fonction, statut non modifiable en direct, paramètres AP")
  void factures() throws Exception {
    String f = json.readTree(envoyer("/api/v1/ap/suppliers", "{\"name\":\"Fournisseur facture\"}", COMPTABLE, 201)).get("id").asString();
    String facture = envoyer("/api/v1/ap/invoices", "{\"invoice_number\":\"FA-API-1\",\"supplier_id\":\"" + f + "\",\"invoice_date\":\"2026-11-10\","
        + "\"due_date\":\"2026-12-10\",\"subtotal\":1000,\"tax_amount\":180,\"total\":1180,\"status\":\"open\",\"approval_status\":\"approved\"}", COMPTABLE, 201);
    String id = json.readTree(facture).get("id").asString();
    assertThat(json.readTree(facture).get("approval_status").asString()).as("statuts imposés par le serveur").isEqualTo("draft");
    assertThat(json.readTree(facture).get("created_by").asString()).isEqualTo(COMPTABLE);

    mvc.perform(get("/api/v1/ap/invoices").with(as(COMPTABLE))).andExpect(status().isOk())
        .andExpect(jsonPath("$[?(@.id == '" + id + "')].supplier.name").value("Fournisseur facture"));
    String levels = envoyer("/api/v1/ap/invoices/" + id + "/submit", "{}", COMPTABLE, 200);
    assertThat(Integer.parseInt(levels.trim())).isGreaterThanOrEqualTo(1);
    mvc.perform(patch("/api/v1/ap/invoices/" + id).with(as(COMPTABLE)).contentType(MediaType.APPLICATION_JSON).content("{\"total\":5}"))
        .andExpect(status().is(422));

    mvc.perform(get("/api/v1/ap/settings/general").with(as(COMPTABLE))).andExpect(status().isOk()).andExpect(jsonPath("$.tenant_id").value(A));
    mvc.perform(get("/api/v1/ap/settings/payment-methods").with(as(COMPTABLE))).andExpect(status().isOk());
    mvc.perform(get("/api/v1/ap/aging").with(as(COMPTABLE))).andExpect(status().isOk());
  }

  @Test
  @DisplayName("facture à lignes en une transaction : en-tête recalculé ; une ligne refusée n'en laisse rien ; lignes relues")
  void factureALignes() throws Exception {
    String f = json.readTree(envoyer("/api/v1/ap/suppliers", "{\"name\":\"Fournisseur lignes\"}", COMPTABLE, 201)).get("id").asString();
    String corps = "{\"header\":{\"supplier_id\":\"" + f + "\",\"invoice_number\":\"FL-1\",\"invoice_date\":\"2026-11-10\",\"due_date\":\"2026-12-10\"},"
        + "\"lines\":[{\"description\":\"Papier\",\"quantity\":2,\"unit_price\":1500,\"discount_pct\":10},{\"description\":\"Encre\",\"quantity\":1,\"unit_price\":4000}]}";
    String id = json.readTree(envoyer("/api/v1/ap/invoices/with-lines", corps, COMPTABLE, 201)).get("id").asString();
    assertThat(PostgresFixture.countAsAdmin(DATABASE, "SELECT count(*) FROM ap_invoices WHERE id = '" + id + "' AND subtotal = 6700 AND created_by = '" + COMPTABLE + "'"))
        .as("en-tête = somme des lignes (2 × 1 500 − 10 % + 4 000)").isEqualTo(1);
    mvc.perform(get("/api/v1/ap/invoices/" + id + "/lines").with(as(COMPTABLE))).andExpect(status().isOk())
        .andExpect(jsonPath("$.length()").value(2)).andExpect(jsonPath("$[0].description").value("Papier"));

    String mauvais = corps.replace("FL-1", "FL-2").replace("\"quantity\":1,", "\"quantity\":-1,");
    envoyer("/api/v1/ap/invoices/with-lines", mauvais, COMPTABLE, 422);
    assertThat(PostgresFixture.countAsAdmin(DATABASE, "SELECT count(*) FROM ap_invoices WHERE invoice_number = 'FL-2'"))
        .as("rien ne reste d'une facture refusée").isEqualTo(0);

    mvc.perform(get("/api/v1/approval-thresholds/ap").with(as(COMPTABLE))).andExpect(status().isOk());
    envoyer("/api/v1/approval-thresholds/inconnu", "{}", COMPTABLE, 400);
  }
}
