package com.quoreich.qerp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
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
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Matrice des autorisations par HTTP (V23, V25) : rôles sur mesure, droits du catalogue,
 * affectations, avec leur effet réel dans la base, la recopie vers user_roles et le journal.
 */
@SpringBootTest
@AutoConfigureMockMvc
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class AuthorizationsApiIT {

  private static final String DATABASE = "qerp_it_authorizations";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String ADMIN = PostgresFixture.ALPHA_USER;
  private static final String COMPTABLE = "aaaaaaaa-0000-0000-0000-000000000005";
  private static final String CAISSIER = "aaaaaaaa-0000-0000-0000-000000000006";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @Autowired private MockMvc mockMvc;
  @Autowired private ObjectMapper json;

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.execute(PostgresFixture.urlOf(DATABASE),
        "INSERT INTO auth.users (id) VALUES ('" + COMPTABLE + "'), ('" + CAISSIER + "') ON CONFLICT DO NOTHING;"
            + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + COMPTABLE + "', '" + A + "', 'Comptable Alpha'),"
            + " ('" + CAISSIER + "', '" + A + "', 'Caissier Alpha') ON CONFLICT (id) DO NOTHING;"
            + "INSERT INTO user_roles (user_id, role, tenant_id) SELECT v.u::uuid, v.r::app_role, '" + A + "' FROM (VALUES ('"
            + ADMIN + "', 'admin'), ('" + COMPTABLE + "', 'accountant')) AS v(u, r)"
            + " WHERE NOT EXISTS (SELECT 1 FROM user_roles x WHERE x.user_id = v.u::uuid AND x.role = v.r::app_role)");
    TenantContextHolder.clear();
  }

  private ResultActions send(MockHttpServletRequestBuilder r, String user, String body) throws Exception {
    return mockMvc.perform(r.with(jwt().jwt(b -> b.subject(user))).contentType(MediaType.APPLICATION_JSON).content(body));
  }

  private JsonNode view() throws Exception {
    return json.readTree(mockMvc.perform(get("/api/v1/authorizations").with(jwt().jwt(b -> b.subject(ADMIN))))
        .andReturn().getResponse().getContentAsString());
  }

  private String roleId(String name) throws Exception {
    for (JsonNode r : view().get("roles")) if (name.equals(r.get("name").asString())) return r.get("id").asString();
    throw new AssertionError("rôle " + name);
  }

  private String systemRoleId(String code) throws Exception {
    for (JsonNode r : view().get("roles")) if (code.equals(r.path("code").asString(""))) return r.get("id").asString();
    throw new AssertionError("rôle système " + code);
  }

  private static String sql(String query) {
    return String.valueOf(PostgresFixture.countAsAdmin(DATABASE, query));
  }

  @Test
  @Order(1)
  @DisplayName("lecture : catalogue de 43 droits, 50 rôles système ; seul l'administrateur gère")
  void lecture() throws Exception {
    mockMvc.perform(get("/api/v1/authorizations").with(jwt().jwt(b -> b.subject(ADMIN))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.canManage").value(true))
        .andExpect(jsonPath("$.catalog.length()").value(43));
    long systeme = 0;
    for (JsonNode r : view().get("roles")) if (r.get("system").asBoolean()) systeme++;
    assertThat(systeme).isEqualTo(50);
    mockMvc.perform(get("/api/v1/authorizations").with(jwt().jwt(b -> b.subject(COMPTABLE))))
        .andExpect(jsonPath("$.canManage").value(false));
    send(post("/api/v1/authorizations/roles"), COMPTABLE, "{\"name\":\"Pirate\"}").andExpect(status().isForbidden());
  }

  @Test
  @Order(2)
  @DisplayName("rôle sur mesure copié d'un rôle système, droits ajustés : effet réel dans la base")
  void roleSurMesure() throws Exception {
    send(post("/api/v1/authorizations/roles"), ADMIN,
            "{\"name\":\"Caissier\",\"description\":\"Encaissements\",\"copyFromRoleId\":\"" + systemRoleId("treasury_clerk") + "\"}")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.roles[?(@.name == 'Caissier')].permissions.length()").value(4));
    send(post("/api/v1/authorizations/roles"), ADMIN, "{\"name\":\"Caissier\"}").andExpect(status().isConflict());

    String caissier = roleId("Caissier");
    send(put("/api/v1/authorizations/roles/" + caissier + "/permissions"), ADMIN,
            "{\"permissions\":[\"treasury.match\",\"treasury.export\"]}")
        .andExpect(status().isOk());
    send(put("/api/v1/authorizations/roles/" + caissier + "/permissions"), ADMIN, "{\"permissions\":[\"treasury.inventer\"]}")
        .andExpect(status().is(422))
        .andExpect(jsonPath("$.error").value("Droits inconnus du catalogue : treasury.inventer"));
    send(put("/api/v1/authorizations/roles/" + systemRoleId("viewer")), ADMIN, "{\"name\":\"Lecteur\",\"active\":true}")
        .andExpect(status().isConflict());

    send(post("/api/v1/authorizations/assignments"), ADMIN, "{\"userId\":\"" + CAISSIER + "\",\"roleId\":\"" + caissier + "\"}")
        .andExpect(status().isOk());
    assertThat(sql("SELECT count(*) FROM (SELECT 1 WHERE has_treasury_perm('" + CAISSIER + "', 'export')"
            + " AND NOT has_treasury_perm('" + CAISSIER + "', 'close_period')) x"))
        .isEqualTo("1");
  }

  @Test
  @Order(3)
  @DisplayName("affectations : utilisateur hors société 404, rôle à revoir 409, recopie vers user_roles")
  void affectations() throws Exception {
    send(post("/api/v1/authorizations/assignments"), ADMIN,
            "{\"userId\":\"" + PostgresFixture.BETA_USER + "\",\"roleId\":\"" + roleId("Caissier") + "\"}")
        .andExpect(status().isNotFound());

    PostgresFixture.execute(PostgresFixture.urlOf(DATABASE),
        "INSERT INTO erp_roles (tenant_id, name, needs_review) VALUES ('" + A + "', 'Ancien rôle', true) ON CONFLICT DO NOTHING");
    send(post("/api/v1/authorizations/assignments"), ADMIN,
            "{\"userId\":\"" + CAISSIER + "\",\"roleId\":\"" + roleId("Ancien rôle") + "\"}")
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.error").value("Rôle à revoir : vérifiez ses droits et activez-le avant de l'affecter"));
    send(put("/api/v1/authorizations/roles/" + roleId("Ancien rôle")), ADMIN, "{\"name\":\"Ancien rôle\",\"active\":true}")
        .andExpect(jsonPath("$.roles[?(@.name == 'Ancien rôle')].needsReview").value(false));

    // Un rôle système affecté depuis la matrice apparaît aussi pour les écrans de modules.
    String manager = systemRoleId("treasury_manager");
    send(post("/api/v1/authorizations/assignments"), ADMIN, "{\"userId\":\"" + CAISSIER + "\",\"roleId\":\"" + manager + "\"}");
    assertThat(sql("SELECT count(*) FROM user_roles WHERE user_id = '" + CAISSIER + "' AND role = 'treasury_manager'")).isEqualTo("1");
    mockMvc.perform(delete("/api/v1/authorizations/assignments/" + CAISSIER + "/" + manager).with(jwt().jwt(b -> b.subject(ADMIN))))
        .andExpect(status().isOk());
    assertThat(sql("SELECT count(*) FROM user_roles WHERE user_id = '" + CAISSIER + "' AND role = 'treasury_manager'")).isEqualTo("0");
  }

  @Test
  @Order(5)
  @DisplayName("mes accès : rôles système et droits de la société, rôles sur mesure compris, hors rôles à revoir")
  void mesAcces() throws Exception {
    String caissier2 = "aaaaaaaa-0000-0000-0000-000000000007";
    PostgresFixture.execute(PostgresFixture.urlOf(DATABASE),
        "INSERT INTO auth.users (id) VALUES ('" + caissier2 + "') ON CONFLICT DO NOTHING;"
            + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + caissier2 + "', '" + A + "', 'Caissière') ON CONFLICT (id) DO NOTHING");
    send(post("/api/v1/authorizations/roles"), ADMIN, "{\"name\":\"Rapprocheur\"}");
    String r = roleId("Rapprocheur");
    send(put("/api/v1/authorizations/roles/" + r + "/permissions"), ADMIN, "{\"permissions\":[\"treasury.match\"]}");
    send(post("/api/v1/authorizations/assignments"), ADMIN, "{\"userId\":\"" + caissier2 + "\",\"roleId\":\"" + r + "\"}");
    send(post("/api/v1/authorizations/assignments"), ADMIN, "{\"userId\":\"" + caissier2 + "\",\"roleId\":\"" + systemRoleId("budget_planner") + "\"}");

    mockMvc.perform(get("/api/v1/authorizations/me").with(jwt().jwt(b -> b.subject(caissier2))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.roles").value(org.hamcrest.Matchers.contains("budget_planner")))
        .andExpect(jsonPath("$.permissions").value(org.hamcrest.Matchers.contains("treasury.match")));
    mockMvc.perform(get("/api/v1/authorizations/me").with(jwt().jwt(b -> b.subject(ADMIN))))
        .andExpect(jsonPath("$.roles").value(org.hamcrest.Matchers.hasItem("admin")))
        .andExpect(jsonPath("$.permissions.length()").value(43));
  }

  @Test
  @Order(4)
  @DisplayName("garde-fous : dernier administrateur intouchable, rôle affecté non supprimable ; journal tenu")
  void gardeFousEtJournal() throws Exception {
    String admin = systemRoleId("admin");
    mockMvc.perform(delete("/api/v1/authorizations/assignments/" + ADMIN + "/" + admin).with(jwt().jwt(b -> b.subject(ADMIN))))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.error").value("Impossible de retirer le dernier administrateur de la société"));

    String caissier = roleId("Caissier");
    mockMvc.perform(delete("/api/v1/authorizations/roles/" + caissier).with(jwt().jwt(b -> b.subject(ADMIN))))
        .andExpect(status().isConflict());
    mockMvc.perform(delete("/api/v1/authorizations/assignments/" + CAISSIER + "/" + caissier).with(jwt().jwt(b -> b.subject(ADMIN))));
    mockMvc.perform(delete("/api/v1/authorizations/roles/" + caissier).with(jwt().jwt(b -> b.subject(ADMIN))))
        .andExpect(status().isOk());

    mockMvc.perform(get("/api/v1/authorizations/audit").with(jwt().jwt(b -> b.subject(ADMIN))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].action").value("role_deleted"))
        .andExpect(jsonPath("$[0].roleName").value("Caissier"))
        .andExpect(jsonPath("$[?(@.action == 'role_assigned' && @.targetUser == 'Caissier Alpha')]").exists())
        .andExpect(jsonPath("$[?(@.action == 'permission_granted' && @.permission == 'treasury.export')]").exists());
    mockMvc.perform(get("/api/v1/authorizations/audit").with(jwt().jwt(b -> b.subject(COMPTABLE))))
        .andExpect(status().isForbidden());
  }

  @Test
  @Order(6)
  @DisplayName("journal : l'ordre des événements d'une même opération est celui des faits (V28)")
  void ordreDuJournal() throws Exception {
    // Une seule requête = une seule transaction : created_at (now()) y est identique partout.
    send(post("/api/v1/authorizations/roles"), ADMIN,
        "{\"name\":\"Copie ordonnée\",\"copyFromRoleId\":\"" + systemRoleId("treasury_clerk") + "\"}");
    String r = roleId("Copie ordonnée");
    send(put("/api/v1/authorizations/roles/" + r + "/permissions"), ADMIN, "{\"permissions\":[\"treasury.match\"]}");

    assertThat(sql("SELECT count(DISTINCT created_at) FROM erp_authorization_audit WHERE role_id = '" + r
        + "' AND action IN ('role_created', 'permission_granted')")).isEqualTo("1");
    assertThat(sql("SELECT count(*) FROM (SELECT string_agg(action, ',' ORDER BY seq) AS suite"
        + " FROM erp_authorization_audit WHERE role_id = '" + r + "') x WHERE suite = 'role_created,"
        + "permission_granted,permission_granted,permission_granted,permission_granted,"
        + "permission_removed,permission_removed,permission_removed'")).isEqualTo("1");
    mockMvc.perform(get("/api/v1/authorizations/audit").with(jwt().jwt(b -> b.subject(ADMIN))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].action").value("permission_removed"))
        .andExpect(jsonPath("$[3].action").value("permission_granted"))
        .andExpect(jsonPath("$[7].action").value("role_created"));
  }
}
