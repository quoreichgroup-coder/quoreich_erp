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
 * Trésorerie, budget et ventes par l'API (lot 4 sur site) : compte de trésorerie et mouvement comptabilisé
 * par la fonction de la base, solde calculé ; budget en brouillon, ligne, soumission, version de prévision
 * avec ses lignes en une transaction ; devis créé par la fonction, lu avec son client et ses lignes ;
 * routes d'action limitées à leur liste ; invisibilité depuis une autre société.
 */
@SpringBootTest
@AutoConfigureMockMvc
class TreasuryBudgetSalesApiIT {

  private static final String DATABASE = "qerp_it_treasury_budget_sales_api";
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
    // Depuis le contrôle d'accès aux modules (V146–V147), un compte sans rôle dans sa propre société est refusé avant même
    // l'isolation : BETA reçoit donc un rôle chez elle, et le test prouve toujours qu'elle ne voit rien d'ALPHA.
    PostgresFixture.grantRoles(DATABASE, PostgresFixture.BETA_USER, "admin", PostgresFixture.BETA_TENANT);
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
  @DisplayName("trésorerie : compte, mouvement comptabilisé par la fonction, solde calculé, vues, route d'action limitée")
  void tresorerie() throws Exception {
    String caisse = envoyer("/api/v1/treasury/accounts", "{\"name\":\"Caisse API\",\"bank_name\":\"Caisse\",\"account_number\":\"CAISSE-1\",\"account_type\":\"cash\",\"currency\":\"XOF\",\"gl_account_id\":\""
        + compte("571") + "\",\"opening_balance\":0,\"balance\":999999}", 201).get("id").asString();
    envoyer("/api/v1/treasury/actions/record_treasury_movement", "{\"_account\":\"" + caisse + "\",\"_date\":\"" + java.time.LocalDate.now()
        + "\",\"_amount\":-2500,\"_counter_account\":\"" + compte("601") + "\",\"_description\":\"Fournitures\",\"_reference\":\"T-1\"}", 200);
    assertThat(PostgresFixture.textAsAdmin(DATABASE, "SELECT balance::text FROM bank_accounts WHERE id = '" + caisse + "'"))
        .as("solde calculé par la base (le solde envoyé est ignoré)").isEqualTo("-2500.00");
    mvc.perform(get("/api/v1/treasury/transactions?accountId=" + caisse).with(as(ADMIN))).andExpect(status().isOk())
        .andExpect(jsonPath("$[0].bank_account.name").value("Caisse API")).andExpect(jsonPath("$[0].journal_entry.piece_number").isNotEmpty());
    mvc.perform(get("/api/v1/treasury/views/cash-position").with(as(ADMIN))).andExpect(status().isOk());
    mvc.perform(get("/api/v1/treasury/views/inconnue").with(as(ADMIN))).andExpect(status().isNotFound());
    envoyer("/api/v1/treasury/actions/drop_table", "{}", 404);
    mvc.perform(get("/api/v1/treasury/accounts").with(as(PostgresFixture.BETA_USER))).andExpect(status().isOk())
        .andExpect(jsonPath("$[?(@.id == '" + caisse + "')]").isEmpty());
  }

  @Test
  @DisplayName("budget : brouillon, ligne, soumission par la fonction ; version de prévision avec ses lignes ; paramètres")
  void budget() throws Exception {
    String b = envoyer("/api/v1/budget/budgets", "{\"name\":\"Budget API\",\"fiscal_year\":\"2041\",\"status\":\"approved\"}", 201).get("id").asString();
    assertThat(PostgresFixture.textAsAdmin(DATABASE, "SELECT status FROM budgets WHERE id = '" + b + "'")).isEqualTo("draft");
    envoyer("/api/v1/budget/lines", "{\"budget_id\":\"" + b + "\",\"gl_account_id\":\"" + compte("601") + "\",\"period\":\"2041\",\"planned_amount\":100000}", 201);
    envoyer("/api/v1/budget/actions/budget_submit", "{\"_budget\":\"" + b + "\"}", 200);
    assertThat(PostgresFixture.textAsAdmin(DATABASE, "SELECT status FROM budgets WHERE id = '" + b + "'")).isEqualTo("submitted");
    JsonNode f = envoyer("/api/v1/budget/forecasts", "{\"year\":\"2041\",\"name\":\"Révision API\",\"lines\":[{\"gl_account_id\":\"" + compte("601")
        + "\",\"analytic_value_id\":null,\"amount\":120000.456}]}", 201);
    mvc.perform(get("/api/v1/budget/forecasts/" + f.get("id").asString() + "/lines").with(as(ADMIN))).andExpect(status().isOk())
        .andExpect(jsonPath("$[0].amount").value(120000.46));
    mvc.perform(put("/api/v1/budget/settings").with(as(ADMIN)).contentType(MediaType.APPLICATION_JSON).content("{\"control_mode\":\"warn\"}"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.control_mode").value("warn"));
    mvc.perform(get("/api/v1/budget/budgetable-accounts?types=expense,revenue").with(as(ADMIN))).andExpect(status().isOk());
  }

  @Test
  @DisplayName("ventes : devis créé par la fonction (numéro de la série), lu avec son client et ses lignes ; vues")
  void ventes() throws Exception {
    String client = envoyer("/api/v1/customers", "{\"name\":\"Client ventes API\"}", 201).get("id").asString();
    envoyer("/api/v1/sales/actions/create_sales_quotation", "{\"_customer_id\":\"" + client + "\",\"_quote_date\":\"" + java.time.LocalDate.now() + "\",\"_valid_until\":\""
        + java.time.LocalDate.now().plusDays(30) + "\",\"_lines\":[{\"description\":\"Prestation\",\"quantity\":2,\"unit_price\":15000}]}", 200);
    String q = PostgresFixture.textAsAdmin(DATABASE, "SELECT id::text FROM quotations WHERE customer_id = '" + client + "'");
    mvc.perform(get("/api/v1/sales/quotations").with(as(ADMIN))).andExpect(status().isOk())
        .andExpect(jsonPath("$[?(@.id == '" + q + "')].customer.name").value("Client ventes API"));
    mvc.perform(get("/api/v1/sales/quotations/" + q + "/lines").with(as(ADMIN))).andExpect(status().isOk()).andExpect(jsonPath("$[0].description").value("Prestation"));
    mvc.perform(get("/api/v1/sales/views/kpis").with(as(ADMIN))).andExpect(status().isOk());
    mvc.perform(get("/api/v1/sales/reporting").with(as(ADMIN))).andExpect(status().isOk()).andExpect(jsonPath("$.invoices").isArray());
  }
}
