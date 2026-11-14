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
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Paramétrage comptable par HTTP : ce que fera l'écran.
 *
 * <p>Les étapes s'enchaînent (société vierge → référentiel appliqué → compte modifié → facture
 * comptabilisée sur le nouveau compte), d'où l'ordre explicite.
 */
@SpringBootTest
@AutoConfigureMockMvc
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class AccountingSetupApiIT {

  private static final String DATABASE = "qerp_it_accounting_api";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String B = PostgresFixture.BETA_TENANT;
  private static final String ALPHA_LECTEUR = "aaaaaaaa-0000-0000-0000-000000000003";

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
        "INSERT INTO auth.users (id) VALUES ('" + ALPHA_LECTEUR + "') ON CONFLICT DO NOTHING;"
            + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + ALPHA_LECTEUR + "', '"
            + A + "', 'Lecteur Alpha') ON CONFLICT (id) DO NOTHING");
    PostgresFixture.grantRoles(DATABASE, PostgresFixture.ALPHA_USER, "admin", A, ALPHA_LECTEUR, "viewer", A,
        PostgresFixture.BETA_USER, "admin", B);
    TenantContextHolder.clear();
  }

  private static RequestPostProcessor as(String user) {
    return jwt().jwt(b -> b.subject(user));
  }

  private static RequestPostProcessor admin() {
    return as(PostgresFixture.ALPHA_USER);
  }

  private JsonNode read(org.springframework.test.web.servlet.ResultActions r) throws Exception {
    return json.readTree(r.andReturn().getResponse().getContentAsString());
  }

  private String accountId(String code) throws Exception {
    for (JsonNode a : read(mockMvc.perform(get("/api/v1/accounting/gl-accounts").with(admin())))) {
      if (code.equals(a.get("code").asString())) return a.get("id").asString();
    }
    throw new AssertionError("compte " + code + " absent");
  }

  @Test
  @Order(1)
  @DisplayName("société vierge : aucun référentiel, 7 rôles non prêts, paramétrage incomplet")
  void societeVierge() throws Exception {
    mockMvc
        .perform(get("/api/v1/accounting/setup").with(admin()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.framework").doesNotExist())
        .andExpect(jsonPath("$.canEdit").value(true))
        .andExpect(jsonPath("$.complete").value(false))
        .andExpect(jsonPath("$.roles.length()").value(8))
        .andExpect(jsonPath("$.roles[?(@.ready == true)]").isEmpty());
    mockMvc
        .perform(get("/api/v1/accounting/frameworks").with(admin()))
        .andExpect(jsonPath("$[0].code").value("SYSCOHADA_REVISE"))
        .andExpect(jsonPath("$[0].validated").value(false));
  }

  @Test
  @Order(2)
  @DisplayName("un lecteur ne peut pas appliquer ; référentiel inconnu → 404")
  void appliquerRefuse() throws Exception {
    mockMvc
        .perform(post("/api/v1/accounting/frameworks/SYSCOHADA_REVISE/apply").with(as(ALPHA_LECTEUR)))
        .andExpect(status().isForbidden());
    mockMvc
        .perform(post("/api/v1/accounting/frameworks/PCG_FR/apply").with(admin()))
        .andExpect(status().isNotFound());
    assertThat(PostgresFixture.countAsAdmin(DATABASE,
            "SELECT count(*) FROM tenant_posting_accounts WHERE tenant_id = '" + A + "'"))
        .isZero();
  }

  @Test
  @Order(3)
  @DisplayName("l'administrateur applique SYSCOHADA ; rejouer ne change rien ; paramétrage complet")
  void appliquer() throws Exception {
    mockMvc
        .perform(post("/api/v1/accounting/frameworks/SYSCOHADA_REVISE/apply").with(admin()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.accountsCreated").value(9))
        .andExpect(jsonPath("$.rolesAssigned").value(8));
    mockMvc
        .perform(post("/api/v1/accounting/frameworks/SYSCOHADA_REVISE/apply").with(admin()))
        .andExpect(jsonPath("$.accountsCreated").value(0))
        .andExpect(jsonPath("$.rolesAssigned").value(0));
    mockMvc
        .perform(get("/api/v1/accounting/setup").with(as(ALPHA_LECTEUR)))
        .andExpect(jsonPath("$.framework.code").value("SYSCOHADA_REVISE"))
        .andExpect(jsonPath("$.canEdit").value(false))
        .andExpect(jsonPath("$.complete").value(true))
        .andExpect(jsonPath("$.roles[?(@.roleCode == 'SALES_REVENUE')].accountCode").value("701"))
        .andExpect(
            jsonPath("$.roles[?(@.roleCode == 'SALES_REVENUE')].suggestedAccountCode").value("701"));
  }

  @Test
  @Order(4)
  @DisplayName("Ventes passe de 701 à 706 : la facture suivante est comptabilisée en 706")
  void lePametrageGouverneLaComptabilisation() throws Exception {
    mockMvc
        .perform(
            put("/api/v1/accounting/posting-accounts/SALES_REVENUE")
                .with(admin())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"glAccountId\":\"" + accountId("706") + "\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.roles[?(@.roleCode == 'SALES_REVENUE')].accountCode").value("706"));

    JsonNode facture =
        read(
            mockMvc.perform(
                post("/api/v1/ar/invoices")
                    .with(admin())
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(
                        "{\"invoiceNumber\":\"PARAM-706\",\"customerId\":"
                            + "\"c0000001-0000-0000-0000-000000000000\",\"invoiceDate\":\"2030-03-02\","
                            + "\"dueDate\":\"2030-04-02\",\"subtotal\":1000.00,\"taxAmount\":180.00}")));
    assertThat(PostgresFixture.countAsAdmin(DATABASE,
            "SELECT count(*) FROM journal_lines l JOIN gl_accounts g ON g.id = l.account_id"
                + " WHERE l.entry_id = '" + facture.get("journalEntryId").asString()
                + "' AND g.code = '706' AND l.credit = 1000.00"))
        .isEqualTo(1);
  }

  @Test
  @Order(5)
  @DisplayName("refus : lecteur 403, rôle inconnu 404, compte d'une autre société ou inactif 422, corps vide 400")
  void refusDAffectation() throws Exception {
    String compte701 = accountId("701");
    mockMvc
        .perform(
            put("/api/v1/accounting/posting-accounts/SALES_REVENUE")
                .with(as(ALPHA_LECTEUR))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"glAccountId\":\"" + compte701 + "\"}"))
        .andExpect(status().isForbidden());
    mockMvc
        .perform(
            put("/api/v1/accounting/posting-accounts/INCONNU")
                .with(admin())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"glAccountId\":\"" + compte701 + "\"}"))
        .andExpect(status().isNotFound());

    PostgresFixture.execute(PostgresFixture.urlOf(DATABASE),
        "INSERT INTO gl_accounts (tenant_id, code, name, account_type) VALUES ('" + B
            + "', '999', 'Compte Beta', 'asset') ON CONFLICT (tenant_id, code) DO NOTHING;"
            + "INSERT INTO gl_accounts (tenant_id, code, name, account_type, is_active) VALUES ('" + A
            + "', '7099', 'Ancien compte', 'revenue', false) ON CONFLICT (tenant_id, code) DO NOTHING");
    String compteBeta =
        idAsAdmin("SELECT id FROM gl_accounts WHERE tenant_id = '" + B + "' AND code = '999'");
    for (String id : new String[] {compteBeta, accountId("7099")}) {
      mockMvc
          .perform(
              put("/api/v1/accounting/posting-accounts/SALES_REVENUE")
                  .with(admin())
                  .contentType(MediaType.APPLICATION_JSON)
                  .content("{\"glAccountId\":\"" + id + "\"}"))
          .andExpect(status().is(422));
    }
    mockMvc
        .perform(
            put("/api/v1/accounting/posting-accounts/SALES_REVENUE")
                .with(admin())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
        .andExpect(status().isBadRequest());

    // Aucun des refus n'a modifié le compte des Ventes (toujours 706, posé à l'étape 4).
    assertThat(PostgresFixture.countAsAdmin(DATABASE,
            "SELECT count(*) FROM tenant_posting_accounts p JOIN gl_accounts g ON g.id ="
                + " p.gl_account_id WHERE p.tenant_id = '" + A
                + "' AND p.role_code = 'SALES_REVENUE' AND g.code = '706'"))
        .isEqualTo(1);
  }

  @Test
  @Order(6)
  @DisplayName("une autre société ne voit rien du paramétrage d'Alpha")
  void isolation() throws Exception {
    mockMvc
        .perform(get("/api/v1/accounting/setup").with(as(PostgresFixture.BETA_USER)))
        .andExpect(jsonPath("$.framework").doesNotExist())
        .andExpect(jsonPath("$.roles[?(@.ready == true)]").isEmpty());
    mockMvc.perform(get("/api/v1/accounting/setup")).andExpect(status().isUnauthorized());
  }

  private static String idAsAdmin(String sql) throws Exception {
    try (var c =
            java.sql.DriverManager.getConnection(
                PostgresFixture.urlOf(DATABASE),
                PostgresFixture.ADMIN_USER,
                PostgresFixture.ADMIN_PASSWORD);
        var st = c.createStatement();
        var rs = st.executeQuery(sql)) {
      rs.next();
      return rs.getString(1);
    }
  }
}
