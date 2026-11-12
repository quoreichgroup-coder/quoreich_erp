package com.quoreich.qerp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.quoreich.qerp.tenant.TenantContextHolder;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** Codes TVA et factures à lignes par HTTP, comme l'écran : étapes enchaînées. */
@SpringBootTest
@AutoConfigureMockMvc
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class InvoiceLinesApiIT {

  private static final String DATABASE = "qerp_it_invoice_lines_api";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String B = PostgresFixture.BETA_TENANT;
  private static final String COMPTABLE = "aaaaaaaa-0000-0000-0000-000000000005";
  private static final String CLIENT = "c0000001-0000-0000-0000-000000000000";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @Autowired private MockMvc mockMvc;
  @Autowired private ObjectMapper json;

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.applySyscohada(DATABASE, A);
    PostgresFixture.execute(PostgresFixture.urlOf(DATABASE),
        "INSERT INTO auth.users (id) VALUES ('" + COMPTABLE + "') ON CONFLICT DO NOTHING;"
            + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + COMPTABLE + "', '" + A
            + "', 'Comptable Alpha') ON CONFLICT (id) DO NOTHING;"
            + "INSERT INTO user_roles (user_id, role, tenant_id) SELECT v.u::uuid, v.r::app_role, v.t::uuid FROM (VALUES ('"
            + PostgresFixture.ALPHA_USER + "', 'admin', '" + A + "'), ('" + COMPTABLE + "', 'accountant', '" + A + "'), ('"
            + PostgresFixture.BETA_USER + "', 'admin', '" + B + "')) AS v(u, r, t) WHERE NOT EXISTS"
            + " (SELECT 1 FROM user_roles x WHERE x.user_id = v.u::uuid AND x.role = v.r::app_role)");
    TenantContextHolder.clear();
  }

  private static RequestPostProcessor as(String user) {
    return jwt().jwt(b -> b.subject(user));
  }

  private ResultActions send(MockHttpServletRequestBuilder r, String user, String body) throws Exception {
    return mockMvc.perform(r.with(as(user)).contentType(MediaType.APPLICATION_JSON).content(body));
  }

  private String taxCode(String code) throws Exception {
    for (JsonNode t : json.readTree(mockMvc.perform(get("/api/v1/accounting/tax-codes").with(as(COMPTABLE)))
        .andReturn().getResponse().getContentAsString())) {
      if (code.equals(t.get("code").asString())) return t.get("id").asString();
    }
    throw new AssertionError("code " + code);
  }

  private static String facture(String numero, String lines) {
    return "{\"invoiceNumber\":\"" + numero + "\",\"customerId\":\"" + CLIENT + "\",\"invoiceDate\":\"2030-07-01\","
        + "\"dueDate\":\"2030-08-01\",\"lines\":" + lines + "}";
  }

  @Test
  @Order(1)
  @DisplayName("codes TVA : l'administrateur crée, le comptable lit ; doublon 409, taux invalide 400")
  void codesTva() throws Exception {
    String tva18 = "{\"code\":\"TVA18\",\"name\":\"TVA 18 %\",\"rate\":18}";
    send(post("/api/v1/accounting/tax-codes"), COMPTABLE, tva18).andExpect(status().isForbidden());
    send(post("/api/v1/accounting/tax-codes"), PostgresFixture.ALPHA_USER, tva18)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].code").value("TVA18"))
        .andExpect(jsonPath("$[0].rate").value(18.00));
    send(post("/api/v1/accounting/tax-codes"), PostgresFixture.ALPHA_USER, tva18).andExpect(status().isConflict());
    send(post("/api/v1/accounting/tax-codes"), PostgresFixture.ALPHA_USER, "{\"code\":\"T\",\"name\":\"x\",\"rate\":18.555}")
        .andExpect(status().isBadRequest());
    send(post("/api/v1/accounting/tax-codes"), PostgresFixture.ALPHA_USER, "{\"code\":\"EXO\",\"name\":\"Exonéré\",\"rate\":0}")
        .andExpect(status().isOk());
    mockMvc.perform(get("/api/v1/accounting/tax-codes").with(as(COMPTABLE))).andExpect(jsonPath("$.length()").value(2));
  }

  @Test
  @Order(2)
  @DisplayName("facture à lignes : HT et TVA calculés par la base, lignes relisibles, écriture équilibrée")
  void factureALignes() throws Exception {
    String lines = "[{\"description\":\"Licence\",\"quantity\":2,\"unitPrice\":500,\"discountPct\":10,\"taxCodeId\":\""
        + taxCode("TVA18") + "\"},{\"description\":\"Formation\",\"quantity\":1,\"unitPrice\":100,\"taxCodeId\":\""
        + taxCode("EXO") + "\"}]";
    JsonNode f = json.readTree(send(post("/api/v1/ar/invoices"), COMPTABLE, facture("API-LIG-1", lines))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.subtotal").value(1000.00))
        .andExpect(jsonPath("$.taxAmount").value(162.00))
        .andExpect(jsonPath("$.total").value(1162.00))
        .andReturn().getResponse().getContentAsString());

    mockMvc.perform(get("/api/v1/ar/invoices/" + f.get("id").asString() + "/lines").with(as(COMPTABLE)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].netAmount").value(900.00))
        .andExpect(jsonPath("$[0].taxAmount").value(162.00))
        .andExpect(jsonPath("$[0].taxCode").value("TVA18"))
        .andExpect(jsonPath("$[1].netAmount").value(100.00));

    assertThat(PostgresFixture.countAsAdmin(DATABASE,
            "SELECT count(*) FROM (SELECT 1 FROM journal_lines WHERE entry_id = '" + f.get("journalEntryId").asString()
                + "' HAVING SUM(debit) = SUM(credit) AND SUM(debit) = 1162.00) x"))
        .isEqualTo(1);
    // Une autre société ne voit pas les lignes.
    mockMvc.perform(get("/api/v1/ar/invoices/" + f.get("id").asString() + "/lines").with(as(PostgresFixture.BETA_USER)))
        .andExpect(status().isNotFound());
  }

  @Test
  @Order(3)
  @DisplayName("refus : code TVA inactif 422 sans effet, quantité nulle 400")
  void refus() throws Exception {
    send(put("/api/v1/accounting/tax-codes/" + taxCode("EXO")), PostgresFixture.ALPHA_USER,
            "{\"name\":\"Exonéré\",\"active\":false}")
        .andExpect(status().isOk());
    send(post("/api/v1/ar/invoices"), COMPTABLE, facture("API-LIG-2",
            "[{\"description\":\"Formation\",\"quantity\":1,\"unitPrice\":100,\"taxCodeId\":\"" + taxCode("EXO") + "\"}]"))
        .andExpect(status().is(422))
        .andExpect(jsonPath("$.error").value("Code TVA inconnu ou inactif dans la société (ligne 1)"));
    assertThat(PostgresFixture.countAsAdmin(DATABASE, "SELECT count(*) FROM ar_invoices WHERE invoice_number = 'API-LIG-2'"))
        .isZero();
    send(post("/api/v1/ar/invoices"), COMPTABLE, facture("API-LIG-3",
            "[{\"description\":\"Vide\",\"quantity\":0,\"unitPrice\":100}]"))
        .andExpect(status().isBadRequest());
  }
}
