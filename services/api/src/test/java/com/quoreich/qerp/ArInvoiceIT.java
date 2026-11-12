package com.quoreich.qerp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
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

/**
 * Critère de sortie du lot 2 (AR) : facture → écriture équilibrée ; paiement partiel → solde
 * exact ; paiement final → soldé ; période close → refus sans effet ; isolation entre sociétés.
 *
 * <p>La parité avec l'implémentation SQL est obtenue par construction : les règles sont celles
 * des triggers, le Java ne fait que les déclencher. Le test observe donc le résultat réel en
 * base, en tant que propriétaire (sinon la RLS le rendrait aveugle aux lignes recherchées).
 */
@SpringBootTest
@AutoConfigureMockMvc
class ArInvoiceIT {

  private static final String DATABASE = "qerp_it_ar";
  private static final String CUSTOMER_ALPHA = "c0000001-0000-0000-0000-000000000000";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @Autowired private MockMvc mockMvc;
  @Autowired private ObjectMapper json;

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.execute(
        PostgresFixture.urlOf(DATABASE),
        "INSERT INTO gl_accounts (tenant_id, code, name, account_type) "
            + "SELECT '"
            + PostgresFixture.ALPHA_TENANT
            + "', v.code, v.name, v.t FROM (VALUES "
            + "('4110','Clients','asset'),('4000','Ventes','revenue'),('4310','TVA collectée','liability'))"
            + " AS v(code,name,t) WHERE NOT EXISTS (SELECT 1 FROM gl_accounts g "
            + "WHERE g.tenant_id = '"
            + PostgresFixture.ALPHA_TENANT
            + "' AND g.code = v.code)");
    // Rôles : propres à ce test (le jeu de référence n'en porte aucun, et d'autres IT en
    // dépendent). ALPHA_VIEWER lit seulement ; ALPHA_FOREIGN_ROLE est comptable, mais dans Beta.
    PostgresFixture.execute(
        PostgresFixture.urlOf(DATABASE),
        "INSERT INTO auth.users (id) VALUES ('"
            + ALPHA_VIEWER
            + "'), ('"
            + ALPHA_FOREIGN_ROLE
            + "') ON CONFLICT DO NOTHING;"
            + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('"
            + ALPHA_VIEWER
            + "', '"
            + PostgresFixture.ALPHA_TENANT
            + "', 'Lecteur Alpha'), ('"
            + ALPHA_FOREIGN_ROLE
            + "', '"
            + PostgresFixture.ALPHA_TENANT
            + "', 'Rôle ailleurs') ON CONFLICT (id) DO NOTHING;"
            + "INSERT INTO user_roles (user_id, role, tenant_id) SELECT v.u::uuid, v.r::app_role,"
            + " v.t::uuid FROM (VALUES ('"
            + PostgresFixture.ALPHA_USER
            + "', 'accountant', '"
            + PostgresFixture.ALPHA_TENANT
            + "'), ('"
            + PostgresFixture.BETA_USER
            + "', 'admin', '"
            + PostgresFixture.BETA_TENANT
            + "'), ('"
            + ALPHA_VIEWER
            + "', 'viewer', '"
            + PostgresFixture.ALPHA_TENANT
            + "'), ('"
            + ALPHA_FOREIGN_ROLE
            + "', 'accountant', '"
            + PostgresFixture.BETA_TENANT
            + "')) AS v(u, r, t) WHERE NOT EXISTS (SELECT 1 FROM user_roles x"
            + " WHERE x.user_id = v.u::uuid AND x.role = v.r::app_role)");
    TenantContextHolder.clear();
  }

  private static final String ALPHA_VIEWER = "aaaaaaaa-0000-0000-0000-000000000003";
  private static final String ALPHA_FOREIGN_ROLE = "aaaaaaaa-0000-0000-0000-000000000004";

  private static RequestPostProcessor as(String user) {
    return jwt().jwt(b -> b.subject(user));
  }

  private static RequestPostProcessor alpha() {
    return jwt().jwt(b -> b.subject(PostgresFixture.ALPHA_USER));
  }

  private static RequestPostProcessor beta() {
    return jwt().jwt(b -> b.subject(PostgresFixture.BETA_USER));
  }

  private static String invoiceBody(String number, String date) {
    return "{\"invoiceNumber\":\""
        + number
        + "\",\"customerId\":\""
        + CUSTOMER_ALPHA
        + "\",\"invoiceDate\":\""
        + date
        + "\",\"dueDate\":\"2030-12-31\",\"subtotal\":1000.00,\"taxAmount\":180.00}";
  }

  private JsonNode createInvoice(String number, String date) throws Exception {
    String body =
        mockMvc
            .perform(
                post("/api/v1/ar/invoices")
                    .with(alpha())
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(invoiceBody(number, date)))
            .andExpect(status().isCreated())
            .andReturn()
            .getResponse()
            .getContentAsString();
    return json.readTree(body);
  }

  private JsonNode pay(String invoiceId, String amount) throws Exception {
    String body =
        mockMvc
            .perform(
                post("/api/v1/ar/invoices/" + invoiceId + "/payments")
                    .with(alpha())
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"amount\":" + amount + "}"))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString();
    return json.readTree(body);
  }

  @Test
  @DisplayName("facture → créance et écriture équilibrée DR=CR ; paiement partiel puis final")
  void cycleDeVieDUneFacture() throws Exception {
    JsonNode invoice = createInvoice("IT-AR-001", "2030-01-15");

    assertThat(invoice.get("total").decimalValue()).isEqualByComparingTo("1180.00");
    assertThat(invoice.get("balance").decimalValue()).isEqualByComparingTo("1180.00");
    assertThat(invoice.get("journalEntryId").isNull()).isFalse();

    String entry = invoice.get("journalEntryId").asString();
    long unbalanced =
        PostgresFixture.countAsAdmin(
            DATABASE,
            "SELECT count(*) FROM (SELECT entry_id FROM journal_lines WHERE entry_id = '"
                + entry
                + "' GROUP BY entry_id HAVING sum(debit) <> sum(credit)) x");
    long lines =
        PostgresFixture.countAsAdmin(
            DATABASE, "SELECT count(*) FROM journal_lines WHERE entry_id = '" + entry + "'");
    assertThat(unbalanced).isZero();
    assertThat(lines).isEqualTo(3);

    String id = invoice.get("id").asString();
    JsonNode partial = pay(id, "400.00");
    assertThat(partial.get("amountPaid").decimalValue()).isEqualByComparingTo("400.00");
    assertThat(partial.get("balance").decimalValue()).isEqualByComparingTo("780.00");
    assertThat(partial.get("status").asString()).isEqualTo("partially_paid");

    JsonNode settled = pay(id, "780.00");
    assertThat(settled.get("balance").decimalValue()).isEqualByComparingTo("0.00");
    assertThat(settled.get("status").asString()).isEqualTo("paid");
  }

  @Test
  @DisplayName("un surpaiement est refusé en 409 sans effet partiel")
  void unSurpaiementEstRefuse() throws Exception {
    JsonNode invoice = createInvoice("IT-AR-002", "2030-01-16");
    String id = invoice.get("id").asString();

    mockMvc
        .perform(
            post("/api/v1/ar/invoices/" + id + "/payments")
                .with(alpha())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"amount\":5000.00}"))
        .andExpect(status().isConflict());

    assertThat(
            PostgresFixture.countAsAdmin(
                DATABASE, "SELECT count(*) FROM payments WHERE ar_invoice_id = '" + id + "'"))
        .isZero();
  }

  @Test
  @DisplayName("période GL close → facture refusée en 409, aucune ligne ni écriture créée")
  void periodeCloseRefuseSansEffet() throws Exception {
    PostgresFixture.execute(
        PostgresFixture.urlOf(DATABASE),
        "INSERT INTO period_locks (tenant_id, period, module, status) SELECT '"
            + PostgresFixture.ALPHA_TENANT
            + "', '2020-01', 'GL', 'closed' WHERE NOT EXISTS (SELECT 1 FROM period_locks "
            + "WHERE tenant_id = '"
            + PostgresFixture.ALPHA_TENANT
            + "' AND period = '2020-01' AND module = 'GL')");
    long invoicesBefore =
        PostgresFixture.countAsAdmin(DATABASE, "SELECT count(*) FROM ar_invoices");
    long entriesBefore =
        PostgresFixture.countAsAdmin(DATABASE, "SELECT count(*) FROM journal_entries");

    mockMvc
        .perform(
            post("/api/v1/ar/invoices")
                .with(alpha())
                .contentType(MediaType.APPLICATION_JSON)
                .content(invoiceBody("IT-AR-CLOSED", "2020-01-10")))
        .andExpect(status().isConflict());

    assertThat(PostgresFixture.countAsAdmin(DATABASE, "SELECT count(*) FROM ar_invoices"))
        .isEqualTo(invoicesBefore);
    assertThat(PostgresFixture.countAsAdmin(DATABASE, "SELECT count(*) FROM journal_entries"))
        .isEqualTo(entriesBefore);
  }

  @Test
  @DisplayName("une autre société ne voit pas la facture et ne peut pas l'encaisser (404)")
  void isolationEntreSocietes() throws Exception {
    JsonNode invoice = createInvoice("IT-AR-003", "2030-01-17");
    String id = invoice.get("id").asString();

    mockMvc.perform(get("/api/v1/ar/invoices/" + id).with(beta())).andExpect(status().isNotFound());
    mockMvc
        .perform(
            post("/api/v1/ar/invoices/" + id + "/payments")
                .with(beta())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"amount\":10.00}"))
        .andExpect(status().isNotFound());
    mockMvc
        .perform(get("/api/v1/ar/invoices").with(beta()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.length()").value(0));
  }

  @Test
  @DisplayName("l'export CSV ne contient que les factures de la société du porteur")
  void exportConformeAuxDroits() throws Exception {
    createInvoice("IT-AR-004", "2030-01-18");

    String alphaCsv =
        mockMvc
            .perform(get("/api/v1/ar/invoices/export").with(alpha()))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString();
    assertThat(alphaCsv).contains("IT-AR-004").contains("1180.00");

    String betaCsv =
        mockMvc
            .perform(get("/api/v1/ar/invoices/export").with(beta()))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString();
    assertThat(betaCsv).doesNotContain("IT-AR-").contains("Numéro,Client");

    mockMvc.perform(get("/api/v1/ar/invoices/export")).andExpect(status().isUnauthorized());
  }

  @Test
  @DisplayName("lecteur, ou rôle détenu dans une autre société → 403 sans effet ; lecture permise")
  void ecritureReserveeAuxComptables() throws Exception {
    JsonNode invoice = createInvoice("IT-AR-005", "2030-01-19");
    String id = invoice.get("id").asString();
    long invoices = PostgresFixture.countAsAdmin(DATABASE, "SELECT count(*) FROM ar_invoices");
    long entries = PostgresFixture.countAsAdmin(DATABASE, "SELECT count(*) FROM journal_entries");
    long payments = PostgresFixture.countAsAdmin(DATABASE, "SELECT count(*) FROM payments");

    for (String user : new String[] {ALPHA_VIEWER, ALPHA_FOREIGN_ROLE}) {
      mockMvc
          .perform(
              post("/api/v1/ar/invoices")
                  .with(as(user))
                  .contentType(MediaType.APPLICATION_JSON)
                  .content(invoiceBody("IT-AR-REFUS-" + user.substring(32), "2030-01-19")))
          .andExpect(status().isForbidden());
      mockMvc
          .perform(
              post("/api/v1/ar/invoices/" + id + "/payments")
                  .with(as(user))
                  .contentType(MediaType.APPLICATION_JSON)
                  .content("{\"amount\":10.00}"))
          .andExpect(status().isForbidden());
      // Même société : la lecture et l'export restent ouverts.
      mockMvc.perform(get("/api/v1/ar/invoices/" + id).with(as(user))).andExpect(status().isOk());
      mockMvc.perform(get("/api/v1/ar/invoices/export").with(as(user))).andExpect(status().isOk());
    }

    assertThat(PostgresFixture.countAsAdmin(DATABASE, "SELECT count(*) FROM ar_invoices"))
        .isEqualTo(invoices);
    assertThat(PostgresFixture.countAsAdmin(DATABASE, "SELECT count(*) FROM journal_entries"))
        .isEqualTo(entries);
    assertThat(PostgresFixture.countAsAdmin(DATABASE, "SELECT count(*) FROM payments"))
        .isEqualTo(payments);
  }

  @Test
  @DisplayName("une requête sans jeton est refusée en 401")
  void sansJeton() throws Exception {
    mockMvc.perform(get("/api/v1/ar/invoices")).andExpect(status().isUnauthorized());
  }
}
