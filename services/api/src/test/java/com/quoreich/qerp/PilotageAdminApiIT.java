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
 * Pilotage, administration, import et IA par l'API (sur site) : jeux de données des tableaux de bord limités à la
 * société, consolidation par la liste fermée, modules, invitations, import tout-ou-rien des lignes valides, analyse
 * IA refusée proprement sans fournisseur configuré (et tracée dans l'historique), planification.
 */
@SpringBootTest(properties = {"qerp.ai.base-url=", "qerp.ai.model="})
@AutoConfigureMockMvc
class PilotageAdminApiIT {

  private static final String DATABASE = "qerp_it_pilotage_admin_api";
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
    PostgresFixture.grantRoles(DATABASE, ADMIN, "admin", A);
    TenantContextHolder.clear();
  }

  private static RequestPostProcessor as(String user) {
    return jwt().jwt(b -> b.subject(user));
  }

  private JsonNode envoyer(String method, String path, String body, int expected) throws Exception {
    var req = "PUT".equals(method) ? MockMvcRequestBuilders.put(path) : MockMvcRequestBuilders.post(path);
    var resp = mvc.perform(req.with(as(ADMIN)).contentType(MediaType.APPLICATION_JSON).content(body)).andReturn().getResponse();
    String r = resp.getContentAsString();
    assertThat(resp.getStatus()).as(path + " → " + r).isEqualTo(expected);
    return r.isBlank() ? null : json.readTree(r);
  }

  @Test
  @DisplayName("tableaux de bord de la société, échéanciers, consolidation par la liste fermée")
  void pilotage() throws Exception {
    long facturesA = Long.parseLong(PostgresFixture.textAsAdmin(DATABASE, "SELECT count(*)::text FROM ar_invoices WHERE tenant_id = '" + A + "'"));
    mvc.perform(get("/api/v1/pilotage/dashboard").with(as(ADMIN))).andExpect(status().isOk()).andExpect(jsonPath("$.ar.length()").value((int) facturesA));
    mvc.perform(get("/api/v1/pilotage/cfo").with(as(ADMIN))).andExpect(status().isOk()).andExpect(jsonPath("$.banks").isArray())
        .andExpect(jsonPath("$.draftReconciliations").isNumber());
    mvc.perform(get("/api/v1/pilotage/overdue/ar").param("ascending", "false").with(as(ADMIN))).andExpect(status().isOk());
    mvc.perform(get("/api/v1/pilotage/overdue/ar_invoices").with(as(ADMIN))).andExpect(status().isNotFound());
    JsonNode societes = envoyer("POST", "/api/v1/pilotage/actions/get_accessible_tenants", "{}", 200);
    assertThat(societes.toString()).contains(A).doesNotContain(PostgresFixture.BETA_TENANT);
    envoyer("POST", "/api/v1/pilotage/actions/delete_tenant", "{}", 404);
  }

  @Test
  @DisplayName("modules, invitations, import des lignes valides dans la société de l'appelant")
  void administration() throws Exception {
    envoyer("POST", "/api/v1/admin/modules/Projects/activate", "{}", 200);
    envoyer("POST", "/api/v1/admin/modules/Projects/deactivate", "{}", 200);
    assertThat(PostgresFixture.textAsAdmin(DATABASE, "SELECT status FROM tenant_modules WHERE tenant_id = '" + A + "' AND module_name = 'Projects'")).isEqualTo("inactive");
    String code = envoyer("POST", "/api/v1/admin/invitations", "{\"validDays\":3,\"note\":\"Comptable\"}", 200).get("code").asString();
    mvc.perform(get("/api/v1/admin/invitations").with(as(ADMIN))).andExpect(status().isOk()).andExpect(jsonPath("$[?(@.code == '" + code + "')]").isNotEmpty());

    JsonNode r = envoyer("POST", "/api/v1/import", "{\"entity\":\"customers\",\"rows\":[{\"name\":\"Import API SARL\",\"email\":\"x@y.bf\",\"credit_limit\":999999,\"tenant_id\":\""
        + PostgresFixture.BETA_TENANT + "\"},{\"email\":\"sans-nom@y.bf\"}]}", 200);
    assertThat(r.get("inserted").asInt()).isEqualTo(1);
    assertThat(r.get("skipped").asInt()).isEqualTo(1);
    assertThat(PostgresFixture.textAsAdmin(DATABASE, "SELECT tenant_id::text || ' ' || COALESCE(credit_limit, 0)::text FROM customers WHERE name = 'Import API SARL'"))
        .as("société imposée par le serveur, colonne hors liste ignorée").startsWith(A + " ").doesNotContain("999999");
    envoyer("POST", "/api/v1/import", "{\"entity\":\"profiles\",\"rows\":[]}", 400);
  }

  @Test
  @DisplayName("analyse IA sans fournisseur : refus explicite tracé dans l'historique ; planification")
  void ia() throws Exception {
    JsonNode refus = envoyer("POST", "/api/v1/ai/cashflow-forecast", "{\"horizons\":[30]}", 503);
    assertThat(refus.toString()).contains("IA non configurée");
    mvc.perform(get("/api/v1/ai/history").param("type", "cashflow_forecast").with(as(ADMIN))).andExpect(status().isOk())
        .andExpect(jsonPath("$[0].status").value("error")).andExpect(jsonPath("$[0].inputs.buckets.30j").exists());
    envoyer("PUT", "/api/v1/ai/schedules", "{\"analysis_type\":\"gl_anomaly_detection\",\"frequency\":\"weekly\",\"enabled\":true,\"params\":{\"days\":14}}", 200);
    mvc.perform(get("/api/v1/ai/schedules").with(as(ADMIN))).andExpect(status().isOk()).andExpect(jsonPath("$[0].frequency").value("weekly"));
  }
}
