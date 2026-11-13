package com.quoreich.qerp;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.hamcrest.Matchers.containsString;

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

/**
 * Paramétrage analytique par HTTP, comme le fera l'écran : axes, sections, règles, puis effet sur
 * une facture. Étapes enchaînées, d'où l'ordre explicite.
 */
@SpringBootTest
@AutoConfigureMockMvc
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class AnalyticsApiIT {

  private static final String DATABASE = "qerp_it_analytics_api";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String B = PostgresFixture.BETA_TENANT;
  private static final String COMPTABLE = "aaaaaaaa-0000-0000-0000-000000000005";

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
    PostgresFixture.execute(
        PostgresFixture.urlOf(DATABASE),
        "INSERT INTO auth.users (id) VALUES ('" + COMPTABLE + "') ON CONFLICT DO NOTHING;"
            + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + COMPTABLE + "', '" + A
            + "', 'Comptable Alpha') ON CONFLICT (id) DO NOTHING");
    PostgresFixture.grantRoles(DATABASE, PostgresFixture.ALPHA_USER, "admin", A, COMPTABLE, "accountant", A,
        PostgresFixture.BETA_USER, "admin", B);
    TenantContextHolder.clear();
  }

  private static RequestPostProcessor admin() {
    return jwt().jwt(b -> b.subject(PostgresFixture.ALPHA_USER));
  }

  private static RequestPostProcessor comptable() {
    return jwt().jwt(b -> b.subject(COMPTABLE));
  }

  private static RequestPostProcessor beta() {
    return jwt().jwt(b -> b.subject(PostgresFixture.BETA_USER));
  }

  private ResultActions send(MockHttpServletRequestBuilder r, RequestPostProcessor who, String body) throws Exception {
    return mockMvc.perform(r.with(who).contentType(MediaType.APPLICATION_JSON).content(body));
  }

  private JsonNode setup() throws Exception {
    return json.readTree(mockMvc.perform(get("/api/v1/analytics").with(admin()))
        .andReturn().getResponse().getContentAsString());
  }

  private String axe(String code) throws Exception {
    for (JsonNode a : setup().get("axes")) if (code.equals(a.get("code").asString())) return a.get("id").asString();
    throw new AssertionError("axe " + code);
  }

  private String section(String axe, String code) throws Exception {
    for (JsonNode a : setup().get("axes"))
      if (axe.equals(a.get("code").asString()))
        for (JsonNode v : a.get("values")) if (code.equals(v.get("code").asString())) return v.get("id").asString();
    throw new AssertionError("section " + code);
  }

  @Test
  @Order(1)
  @DisplayName("axes : comptable refusé, administrateur crée ; code en double 409, code invalide 400")
  void axes() throws Exception {
    mockMvc.perform(get("/api/v1/analytics").with(comptable()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.canManageAxes").value(false))
        .andExpect(jsonPath("$.canManageValues").value(true))
        .andExpect(jsonPath("$.axes").isEmpty());

    String dept = "{\"code\":\"DEPT\",\"name\":\"Département\",\"sortOrder\":1}";
    send(post("/api/v1/analytics/axes"), comptable(), dept).andExpect(status().isForbidden());
    send(post("/api/v1/analytics/axes"), admin(), dept)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.axes[0].code").value("DEPT"));
    send(post("/api/v1/analytics/axes"), admin(), dept).andExpect(status().isConflict());
    send(post("/api/v1/analytics/axes"), admin(), "{\"code\":\"dept\",\"name\":\"x\"}").andExpect(status().isBadRequest());
    send(post("/api/v1/analytics/axes"), admin(), "{\"code\":\"CC\",\"name\":\"Centre de coûts\",\"sortOrder\":2}")
        .andExpect(jsonPath("$.axes[1].code").value("CC"));
  }

  @Test
  @Order(2)
  @DisplayName("sections : le comptable crée ; doublon 409 ; parent d'un autre axe 422 ; boucle 422")
  void sections() throws Exception {
    String dept = axe("DEPT");
    send(post("/api/v1/analytics/axes/" + dept + "/values"), comptable(), "{\"code\":\"COM\",\"name\":\"Commercial\"}")
        .andExpect(status().isOk());
    send(post("/api/v1/analytics/axes/" + dept + "/values"), comptable(), "{\"code\":\"COM\",\"name\":\"Doublon\"}")
        .andExpect(status().isConflict());
    String com = section("DEPT", "COM");
    send(post("/api/v1/analytics/axes/" + dept + "/values"), comptable(),
            "{\"code\":\"COM-EST\",\"name\":\"Commercial Est\",\"parentId\":\"" + com + "\"}")
        .andExpect(status().isOk());

    String cc = axe("CC");
    send(post("/api/v1/analytics/axes/" + cc + "/values"), comptable(), "{\"code\":\"ATELIER\",\"name\":\"Atelier\"}");
    send(post("/api/v1/analytics/axes/" + cc + "/values"), comptable(),
            "{\"code\":\"X\",\"name\":\"Parent ailleurs\",\"parentId\":\"" + com + "\"}")
        .andExpect(status().is(422))
        .andExpect(jsonPath("$.error").value("La section parente doit appartenir au même axe"));

    // COM ne peut pas devenir l'enfant de son propre enfant.
    send(put("/api/v1/analytics/values/" + com), comptable(),
            "{\"name\":\"Commercial\",\"parentId\":\"" + section("DEPT", "COM-EST") + "\",\"active\":true}")
        .andExpect(status().is(422))
        .andExpect(jsonPath("$.error").value(containsString("circulaire")));
    send(post("/api/v1/analytics/axes/" + dept + "/values"), comptable(),
            "{\"code\":\"T\",\"name\":\"Dates\",\"validFrom\":\"2030-02-01\",\"validTo\":\"2030-01-01\"}")
        .andExpect(status().isBadRequest());
  }

  @Test
  @Order(3)
  @DisplayName("règles : administrateur seulement ; préfixe invalide 400 ; effet sur une facture (422 QG002)")
  void reglesEtEffet() throws Exception {
    String dept = axe("DEPT");
    send(put("/api/v1/analytics/axes/" + dept + "/rules/7"), comptable(), "{\"requirement\":\"required\"}")
        .andExpect(status().isForbidden());
    send(put("/api/v1/analytics/axes/" + dept + "/rules/7a"), admin(), "{\"requirement\":\"required\"}")
        .andExpect(status().isBadRequest());
    send(put("/api/v1/analytics/axes/" + dept + "/rules/7"), admin(), "{\"requirement\":\"required\"}")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.axes[0].rules[0].accountPrefix").value("7"))
        .andExpect(jsonPath("$.axes[0].rules[0].requirement").value("required"));

    String facture = "{\"invoiceNumber\":\"%s\",\"customerId\":\"c0000001-0000-0000-0000-000000000000\","
        + "\"invoiceDate\":\"2030-06-01\",\"dueDate\":\"2030-07-01\",\"subtotal\":100.00,\"taxAmount\":0}";
    send(post("/api/v1/ar/invoices"), admin(), facture.formatted("ANA-API-1"))
        .andExpect(status().is(422))
        .andExpect(jsonPath("$.error").value(containsString("l'axe « Département » est obligatoire sur le compte 701")));

    // Axe désactivé : il n'est plus contrôlé, la facture passe.
    send(put("/api/v1/analytics/axes/" + dept), admin(), "{\"name\":\"Département\",\"active\":false}")
        .andExpect(status().isOk());
    send(post("/api/v1/ar/invoices"), admin(), facture.formatted("ANA-API-2")).andExpect(status().isCreated());

    mockMvc.perform(delete("/api/v1/analytics/axes/" + dept + "/rules/7").with(admin())).andExpect(status().isOk());
    mockMvc.perform(delete("/api/v1/analytics/axes/" + dept + "/rules/7").with(admin())).andExpect(status().isNotFound());
  }

  private static final String CLIENT = "c0000001-0000-0000-0000-000000000000";

  private String facture(String numero, String analytics) {
    return "{\"invoiceNumber\":\"" + numero + "\",\"customerId\":\"" + CLIENT + "\",\"invoiceDate\":\"2030-06-10\","
        + "\"dueDate\":\"2030-07-10\",\"subtotal\":100.00,\"taxAmount\":0"
        + (analytics == null ? "" : ",\"analytics\":" + analytics) + "}";
  }

  /** Section portée par la ligne de produit (701) de l'écriture de la facture. */
  private String sectionDeLaLigneDeProduit(ResultActions creation) throws Exception {
    String entry = json.readTree(creation.andReturn().getResponse().getContentAsString()).get("journalEntryId").asString();
    try (var c = java.sql.DriverManager.getConnection(PostgresFixture.urlOf(DATABASE), PostgresFixture.ADMIN_USER, PostgresFixture.ADMIN_PASSWORD);
        var st = c.createStatement();
        var rs = st.executeQuery("SELECT coalesce(v.code, '-') FROM journal_lines l JOIN gl_accounts g ON g.id = l.account_id"
            + " LEFT JOIN journal_line_analytics la ON la.line_id = l.id LEFT JOIN analytic_values v ON v.id = la.value_id"
            + " WHERE l.entry_id = '" + entry + "' AND g.code = '701'")) {
      rs.next();
      return rs.getString(1);
    }
  }

  @Test
  @Order(5)
  @DisplayName("section par défaut d'un client : posée par le comptable, reprise sur sa facture")
  void sectionParDefautDuClient() throws Exception {
    String dept = axe("DEPT");
    send(put("/api/v1/analytics/axes/" + dept), admin(), "{\"name\":\"Département\",\"active\":true}").andExpect(status().isOk());
    send(put("/api/v1/analytics/axes/" + dept + "/rules/7"), admin(), "{\"requirement\":\"required\"}").andExpect(status().isOk());

    String base = "/api/v1/analytics/customers/" + CLIENT + "/defaults";
    mockMvc.perform(get(base).with(comptable())).andExpect(status().isOk()).andExpect(jsonPath("$").isEmpty());
    send(put(base + "/" + dept), comptable(), "{\"valueId\":\"" + section("CC", "ATELIER") + "\"}")
        .andExpect(status().is(422))
        .andExpect(jsonPath("$.error").value("La section doit appartenir à cet axe"));
    send(put(base + "/" + dept), comptable(), "{\"valueId\":\"" + section("DEPT", "COM") + "\"}")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].axisId").value(dept))
        .andExpect(jsonPath("$[0].valueId").value(section("DEPT", "COM")));
    // Le client d'Alpha est invisible pour Beta.
    mockMvc.perform(get(base).with(beta())).andExpect(status().isNotFound());

    org.assertj.core.api.Assertions.assertThat(
            sectionDeLaLigneDeProduit(send(post("/api/v1/ar/invoices"), admin(), facture("ANA-DEF-1", null)).andExpect(status().isCreated())))
        .isEqualTo("COM");
  }

  @Test
  @Order(6)
  @DisplayName("section choisie sur la facture : prioritaire ; autre axe 422 sans effet ; axe en double 400")
  void sectionChoisieSurLaFacture() throws Exception {
    String dept = axe("DEPT");
    String choix = "[{\"axisId\":\"" + dept + "\",\"valueId\":\"" + section("DEPT", "COM-EST") + "\"}]";
    org.assertj.core.api.Assertions.assertThat(
            sectionDeLaLigneDeProduit(send(post("/api/v1/ar/invoices"), admin(), facture("ANA-CHX-1", choix)).andExpect(status().isCreated())))
        .isEqualTo("COM-EST");

    String autreAxe = "[{\"axisId\":\"" + dept + "\",\"valueId\":\"" + section("CC", "ATELIER") + "\"}]";
    send(post("/api/v1/ar/invoices"), admin(), facture("ANA-CHX-2", autreAxe))
        .andExpect(status().is(422))
        .andExpect(jsonPath("$.error").value("Section analytique inconnue pour cet axe dans la société"));
    org.assertj.core.api.Assertions.assertThat(PostgresFixture.countAsAdmin(DATABASE,
            "SELECT count(*) FROM ar_invoices WHERE invoice_number = 'ANA-CHX-2'"))
        .isZero();

    String doublon = "[{\"axisId\":\"" + dept + "\",\"valueId\":\"" + section("DEPT", "COM") + "\"},"
        + "{\"axisId\":\"" + dept + "\",\"valueId\":\"" + section("DEPT", "COM-EST") + "\"}]";
    send(post("/api/v1/ar/invoices"), admin(), facture("ANA-CHX-3", doublon)).andExpect(status().isBadRequest());

    // Sans défaut ni choix, l'obligation refuse la facture.
    mockMvc.perform(delete("/api/v1/analytics/customers/" + CLIENT + "/defaults/" + dept).with(comptable()))
        .andExpect(status().isOk()).andExpect(jsonPath("$").isEmpty());
    send(post("/api/v1/ar/invoices"), admin(), facture("ANA-CHX-4", null))
        .andExpect(status().is(422))
        .andExpect(jsonPath("$.error").value(containsString("obligatoire sur le compte 701")));
  }

  @Test
  @Order(4)
  @DisplayName("une autre société ne voit ni ne modifie l'analytique d'Alpha")
  void isolation() throws Exception {
    String dept = axe("DEPT");
    mockMvc.perform(get("/api/v1/analytics").with(beta())).andExpect(jsonPath("$.axes").isEmpty());
    send(put("/api/v1/analytics/axes/" + dept), beta(), "{\"name\":\"Piraté\",\"active\":true}")
        .andExpect(status().isNotFound());
    // Introuvable, pas interdit : l'existence de l'axe d'Alpha n'est pas révélée.
    send(post("/api/v1/analytics/axes/" + dept + "/values"), beta(), "{\"code\":\"P\",\"name\":\"Piraté\"}")
        .andExpect(status().isNotFound());
    mockMvc.perform(get("/api/v1/analytics")).andExpect(status().isUnauthorized());
  }
}
