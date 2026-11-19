package com.quoreich.qerp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
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
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Notes de frais, projets, risques et conformité par l'API (sur site) : note à lignes en une transaction,
 * justificatif stocké sur le serveur (lu par qui voit la note, refusé ailleurs et après soumission, chemin
 * hors du répertoire refusé), projet et sa section, risque évalué, contrôle testé.
 */
@SpringBootTest(properties = "qerp.files.dir=target/it-files")
@AutoConfigureMockMvc
class ExpensesProjectsGrcApiIT {

  private static final String DATABASE = "qerp_it_expenses_projects_grc_api";
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

  @Test
  @DisplayName("note de frais à lignes, justificatif stocké sur le serveur et relu ; refus hors règles")
  void notesDeFrais() throws Exception {
    PostgresFixture.execute(PostgresFixture.urlOf(DATABASE), "INSERT INTO hr_movement_references (tenant_id, kind, code, label, active) VALUES ('" + A
        + "', 'contract_type', 'cdi', 'CDI', true) ON CONFLICT (tenant_id, kind, code) DO NOTHING");
    String salarie = PostgresFixture.textAsAdmin(DATABASE, "INSERT INTO employees (tenant_id, matricule, first_name, last_name, contract_type, hire_date, base_salary, currency, status)"
        + " VALUES ('" + A + "', 'NDF-API', 'Awa', 'Ouedraogo', 'cdi', '2026-01-01', 300000, 'XOF', 'active') RETURNING id::text");
    String compte = PostgresFixture.textAsAdmin(DATABASE, "SELECT id::text FROM gl_accounts WHERE tenant_id = '" + A + "' AND code = '601'");
    String cat = envoyer("/api/v1/expenses/categories", "{\"code\":\"TRA\",\"name\":\"Transport\",\"gl_account_id\":\"" + compte + "\"}", 201).get("id").asString();
    String note = envoyer("/api/v1/expenses/reports", "{\"employee_id\":\"" + salarie + "\",\"purpose\":\"Mission API\",\"lines\":[{\"expense_date\":\""
        + java.time.LocalDate.now() + "\",\"category_id\":\"" + cat + "\",\"description\":\"Taxi\",\"amount\":5000}]}", 201).get("id").asString();
    String ligne = PostgresFixture.textAsAdmin(DATABASE, "SELECT id::text FROM expense_lines WHERE report_id = '" + note + "'");
    MockMultipartFile pdf = new MockMultipartFile("file", "recu taxi.pdf", "application/pdf", "%PDF-1.4 recu".getBytes());
    String path = json.readTree(mvc.perform(multipart("/api/v1/expenses/reports/" + note + "/lines/" + ligne + "/receipt").file(pdf).with(as(ADMIN)))
        .andExpect(status().isOk()).andReturn().getResponse().getContentAsString()).get("receipt_path").asString();
    assertThat(path).startsWith(A + "/" + note + "/").endsWith("recu_taxi.pdf");
    mvc.perform(get("/api/v1/expenses/receipts").param("path", path).with(as(ADMIN))).andExpect(status().isOk()).andExpect(content().bytes("%PDF-1.4 recu".getBytes()));
    mvc.perform(get("/api/v1/expenses/receipts").param("path", path).with(as(PostgresFixture.BETA_USER))).andExpect(status().isNotFound());
    mvc.perform(get("/api/v1/expenses/receipts").param("path", A + "/" + note + "/../../../pom.xml").with(as(ADMIN))).andExpect(status().is4xxClientError());
    MockMultipartFile exe = new MockMultipartFile("file", "x.exe", "application/octet-stream", new byte[] {1});
    mvc.perform(multipart("/api/v1/expenses/reports/" + note + "/lines/" + ligne + "/receipt").file(exe).with(as(ADMIN))).andExpect(status().is(422));
    mvc.perform(get("/api/v1/expenses/reports").with(as(ADMIN))).andExpect(status().isOk())
        .andExpect(jsonPath("$[?(@.id == '" + note + "')].lines[0].receipt_path").value(path));
  }

  @Test
  @DisplayName("projet (section créée), budget ; risque évalué ; contrôle testé ; routes d'action limitées")
  void projetsRisquesConformite() throws Exception {
    String axe = PostgresFixture.textAsAdmin(DATABASE, "INSERT INTO analytic_axes (tenant_id, code, name) VALUES ('" + A + "', 'PRJ', 'Projets') RETURNING id::text");
    mvc.perform(MockMvcRequestBuilders.put("/api/v1/projects/settings").with(as(ADMIN)).contentType(MediaType.APPLICATION_JSON)
        .content("{\"project_axis_id\":\"" + axe + "\"}")).andExpect(status().isOk());
    JsonNode p = envoyer("/api/v1/projects", "{\"project_code\":\"P-API\",\"name\":\"Chantier API\",\"status\":\"active\"}", 201);
    assertThat(p.get("analytic_value_id").isNull()).as("section créée par la base").isFalse();
    envoyer("/api/v1/projects/actions/project_financials", "{\"_from\":null,\"_to\":null}", 200);
    envoyer("/api/v1/projects/actions/drop", "{}", 404);

    String r = envoyer("/api/v1/risks", "{\"risk_code\":\"R-API\",\"title\":\"Panne\",\"category\":\"Opérationnel\",\"likelihood\":2,\"impact\":2}", 201).get("id").asString();
    envoyer("/api/v1/grc/actions/risk_assess", "{\"_risk\":\"" + r + "\",\"_likelihood\":4,\"_impact\":3,\"_residual_likelihood\":2,\"_residual_impact\":2,\"_notes\":null}", 200);
    assertThat(PostgresFixture.textAsAdmin(DATABASE, "SELECT status || ' ' || risk_score FROM risk_register WHERE id = '" + r + "'")).isEqualTo("assessed 12");
    String f = json.readTree(mvc.perform(MockMvcRequestBuilders.put("/api/v1/compliance/frameworks").with(as(ADMIN)).contentType(MediaType.APPLICATION_JSON)
        .content("{\"name\":\"Contrôle interne API\"}")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString()).get("id").asString();
    String c = json.readTree(mvc.perform(MockMvcRequestBuilders.put("/api/v1/compliance/controls").with(as(ADMIN)).contentType(MediaType.APPLICATION_JSON)
        .content("{\"framework_id\":\"" + f + "\",\"control_code\":\"CI-API\",\"title\":\"Double signature\"}")).andExpect(status().isOk())
        .andReturn().getResponse().getContentAsString()).get("id").asString();
    envoyer("/api/v1/grc/actions/compliance_record_test", "{\"_control\":\"" + c + "\",\"_date\":\"" + java.time.LocalDate.now() + "\",\"_result\":\"pass\"}", 200);
    mvc.perform(get("/api/v1/compliance/controls").with(as(ADMIN))).andExpect(status().isOk()).andExpect(jsonPath("$[?(@.id == '" + c + "')].status").value("effective"));
    mvc.perform(get("/api/v1/compliance/inconnu").with(as(ADMIN))).andExpect(status().isNotFound());
  }
}
