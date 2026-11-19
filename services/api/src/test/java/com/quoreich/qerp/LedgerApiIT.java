package com.quoreich.qerp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
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
 * Grand livre et plans comptables par l'API (lot 3 sur site) : écriture manuelle en une transaction
 * (brouillon, lignes, comptabilisation ; déséquilibre refusé sans rien laisser), balance, contre-passation,
 * route d'action limitée à sa liste, audit du plan, jeux de comptes, contrôles, états par rubriques.
 */
@SpringBootTest
@AutoConfigureMockMvc
class LedgerApiIT {

  private static final String DATABASE = "qerp_it_ledger_api";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String ADMIN = PostgresFixture.ALPHA_USER;

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
    PostgresFixture.grantRoles(DATABASE, ADMIN, "admin", A);
    TenantContextHolder.clear();
  }

  private static RequestPostProcessor as(String user) {
    return jwt().jwt(b -> b.subject(user));
  }

  private JsonNode envoyer(String path, String body, int expected) throws Exception {
    String r = mvc.perform(MockMvcRequestBuilders.post(path).with(as(ADMIN)).contentType(MediaType.APPLICATION_JSON).content(body))
        .andExpect(status().is(expected)).andReturn().getResponse().getContentAsString();
    return r.isBlank() ? null : json.readTree(r);
  }

  private String compte(String code) {
    return PostgresFixture.textAsAdmin(DATABASE, "SELECT id::text FROM gl_accounts WHERE tenant_id = '" + A + "' AND code = '" + code + "'");
  }

  @Test
  @DisplayName("écriture manuelle comptabilisée en une transaction ; déséquilibrée refusée sans rien laisser ; balance ; contre-passation")
  void ecritures() throws Exception {
    String banque = compte("521"), achats = compte("601");
    JsonNode e = envoyer("/api/v1/gl/journal-entries", "{\"entry_number\":\"OD-API-1\",\"entry_date\":\"" + java.time.LocalDate.now() + "\",\"description\":\"Achat comptant\","
        + "\"source\":\"manual\",\"status\":\"posted\",\"lines\":[{\"account_id\":\"" + achats + "\",\"description\":\"Achat\",\"debit\":5000,\"credit\":0},"
        + "{\"account_id\":\"" + banque + "\",\"description\":\"Banque\",\"debit\":0,\"credit\":5000}]}", 201);
    assertThat(e.get("status").asString()).isEqualTo("posted");
    assertThat(e.get("posted_by").asString()).as("auteur de la comptabilisation posé par le serveur").isEqualTo(ADMIN);
    String id = e.get("id").asString();

    JsonNode refus = envoyer("/api/v1/gl/journal-entries", "{\"entry_number\":\"OD-API-2\",\"entry_date\":\"" + java.time.LocalDate.now() + "\",\"description\":\"x\","
        + "\"source\":\"manual\",\"status\":\"posted\",\"lines\":[{\"account_id\":\"" + achats + "\",\"debit\":5000,\"credit\":0},"
        + "{\"account_id\":\"" + banque + "\",\"debit\":0,\"credit\":4000}]}", 422);
    assertThat(refus.get("error").asString()).isNotBlank();
    assertThat(PostgresFixture.countAsAdmin(DATABASE, "SELECT count(*) FROM journal_entries WHERE entry_number = 'OD-API-2'")).as("rien ne reste").isEqualTo(0);

    mvc.perform(get("/api/v1/gl/journal-entries/" + id).with(as(ADMIN))).andExpect(status().isOk()).andExpect(jsonPath("$.lines.length()").value(2));
    mvc.perform(get("/api/v1/gl/trial-balance").with(as(ADMIN))).andExpect(status().isOk()).andExpect(jsonPath("$[?(@.code == '601')]").isNotEmpty());
    mvc.perform(get("/api/v1/gl/transactions").with(as(ADMIN))).andExpect(status().isOk()).andExpect(jsonPath("$[?(@.id == '" + id + "')].batch").isNotEmpty());
    envoyer("/api/v1/gl/journal-entries/" + id + "/reverse", "{\"reason\":\"Erreur de saisie\"}", 200);
    assertThat(PostgresFixture.textAsAdmin(DATABASE, "SELECT status FROM journal_entries WHERE id = '" + id + "'")).isEqualTo("reversed");
    mvc.perform(get("/api/v1/gl/journal-entries/" + id).with(as(PostgresFixture.BETA_USER))).andExpect(status().isOk()).andExpect(content -> assertThat(content.getResponse().getContentAsString()).isEqualTo("null"));
  }

  @Test
  @DisplayName("plans comptables : route d'action limitée à sa liste, audit du plan, jeux de comptes, contrôles, états")
  void plansEtControles() throws Exception {
    envoyer("/api/v1/gl/charts/actions/delete_everything", "{}", 404);
    JsonNode issues = envoyer("/api/v1/gl/charts/actions/chart_of_accounts_issues", "{}", 200);
    assertThat(issues.isArray()).isTrue();
    mvc.perform(get("/api/v1/gl/charts/frameworks").with(as(ADMIN))).andExpect(status().isOk()).andExpect(jsonPath("$.frameworks").isArray());
    mvc.perform(get("/api/v1/gl/charts/operational").with(as(ADMIN))).andExpect(status().isOk());

    JsonNode set = envoyer("/api/v1/gl/charts/account-sets", "{\"kind\":\"supplier\",\"code\":\"ETR\",\"name\":\"Fournisseurs étrangers\"}", 201);
    String setId = set.get("id").asString();
    mvc.perform(put("/api/v1/gl/charts/account-sets/" + setId + "/roles/AP_PAYABLE").with(as(ADMIN)).contentType(MediaType.APPLICATION_JSON)
        .content("{\"gl_account_id\":\"" + compte("401") + "\"}")).andExpect(status().isOk());
    mvc.perform(get("/api/v1/gl/charts/account-sets?kind=supplier").with(as(ADMIN))).andExpect(status().isOk())
        .andExpect(jsonPath("$[?(@.code == 'ETR')].lines[0].role_code").value("AP_PAYABLE"));

    mvc.perform(get("/api/v1/gl/controls/integrity").with(as(ADMIN))).andExpect(status().isOk());
    mvc.perform(get("/api/v1/gl/controls/reconciliation?asOf=" + java.time.LocalDate.now()).with(as(ADMIN))).andExpect(status().isOk());
    mvc.perform(put("/api/v1/gl/controls/settings").with(as(ADMIN)).contentType(MediaType.APPLICATION_JSON).content("{\"large_entry_threshold\":1000000}"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.updated_by").value(ADMIN));
    mvc.perform(get("/api/v1/gl/financial-statement?layout=CR_SYSCOHADA&from=2026-01-01&to=2026-12-31").with(as(ADMIN))).andExpect(status().isOk())
        .andExpect(jsonPath("$").isArray());
    mvc.perform(get("/api/v1/gl/journals").with(as(ADMIN))).andExpect(status().isOk()).andExpect(jsonPath("$.journals").isArray());
  }
}
