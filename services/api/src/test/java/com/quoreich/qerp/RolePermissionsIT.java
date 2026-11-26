package com.quoreich.qerp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.quoreich.qerp.tenant.TenantContextHolder;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
class RolePermissionsIT {
  private static final String DB = "qerp_it_role_permissions";
  private static final String TENANT = PostgresFixture.ALPHA_TENANT;
  private static final String ADMIN = PostgresFixture.ALPHA_USER;
  private static final String ACCOUNTANT = "aaaaaaaa-0000-0000-0000-0000000000e1";
  @Autowired private MockMvc mvc;

  @DynamicPropertySource
  static void properties(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DB, registry);
  }

  @BeforeEach
  void prepare() {
    PostgresFixture.loadReferenceDatasetOnce(DB);
    owner("INSERT INTO auth.users(id) VALUES ('" + ACCOUNTANT + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles(id,tenant_id) VALUES ('" + ACCOUNTANT + "','" + TENANT + "') ON CONFLICT DO NOTHING");
    PostgresFixture.grantRoles(DB, ADMIN, "admin", TENANT, ACCOUNTANT, "accountant", TENANT);
    TenantContextHolder.clear();
  }

  @Test
  void standardRoleCanBeCustomizedWithImmediateEffectAndNoReseeding() throws Exception {
    String accountant = role(TENANT, "accountant");
    String otherBefore = rights(role(PostgresFixture.BETA_TENANT, "accountant"));
    replace(ADMIN, accountant, "[\"ar.receipt\",\"inventory.export\"]", 200);
    assertThat(rights(accountant)).isEqualTo("ar.receipt,inventory.export");
    mvc.perform(get("/api/v1/inventory/items").with(jwt().jwt(b -> b.subject(ACCOUNTANT))))
        .andExpect(status().isOk());
    replace(ADMIN, accountant, "[\"ar.receipt\"]", 200);
    mvc.perform(get("/api/v1/inventory/items").with(jwt().jwt(b -> b.subject(ACCOUNTANT))))
        .andExpect(status().isForbidden());
    owner("SELECT seed_tenant_system_roles('" + TENANT + "')");
    assertThat(rights(accountant)).isEqualTo("ar.receipt");
    assertThat(rights(role(PostgresFixture.BETA_TENANT, "accountant"))).isEqualTo(otherBefore);
    assertThat(PostgresFixture.countAsAdmin(DB, "SELECT count(*) FROM erp_authorization_audit WHERE role_id='"
        + accountant + "' AND actor_id='" + ADMIN + "' AND action='permission_removed' AND permission_code='inventory.export'"))
        .isEqualTo(1);
    replace(ADMIN, accountant, "[]", 200);
    assertThat(rights(accountant)).isEmpty();
    owner("SELECT seed_tenant_system_roles('" + TENANT + "')");
    assertThat(rights(accountant)).isEmpty();
  }

  @Test
  void administratorPermissionsAndIdentityStayProtectedEvenInDirectWrites() throws Exception {
    String admin = role(TENANT, "admin");
    String before = rights(admin);
    replace(ADMIN, admin, "[]", 409);
    assertThatThrownBy(() -> authenticated(ADMIN, "SELECT set_erp_role_permissions('" + admin + "',ARRAY[]::text[])"))
        .hasMessageContaining("Administrateur est protégé");
    assertThatThrownBy(() -> authenticated(ADMIN, "DELETE FROM erp_role_permissions WHERE role_id='" + admin + "'"))
        .hasMessageContaining("Administrateur est protégé");
    // UPDATE must inspect both the old and the new role, not just the destination.
    assertThatThrownBy(() -> authenticated(ADMIN, "UPDATE erp_role_permissions SET role_id='" + role(TENANT, "viewer")
        + "' WHERE role_id='" + admin + "' AND permission_code='inventory.export'"))
        .hasMessageContaining("Administrateur est protégé");
    assertThatThrownBy(() -> authenticated(ADMIN, "UPDATE erp_roles SET name='Autre nom' WHERE id='" + admin + "'"))
        .hasMessageContaining("rôle système");
    assertThat(rights(admin)).isEqualTo(before);
  }

  @Test
  void seedMarkerCannotBeSpoofedAndPermissionUpdatesCannotBypassAudit() throws Exception {
    String admin = role(TENANT, "admin");
    assertThatThrownBy(() -> owner("BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims',"
        + "json_build_object('sub','" + ADMIN + "','role','authenticated')::text,true);"
        + "SELECT set_config('qerp.system_roles_seed','on',true);"
        + "DELETE FROM erp_role_permissions WHERE role_id='" + admin + "'; ROLLBACK;"))
        .hasMessageContaining("réservée au propriétaire");
    String accountant = role(TENANT, "accountant");
    replace(ADMIN, accountant, "[\"ar.receipt\"]", 200);
    assertThatThrownBy(() -> owner("BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims',"
        + "json_build_object('sub','" + ADMIN + "','role','authenticated')::text,true);"
        + "SELECT set_config('qerp.system_roles_seed','on',true);"
        + "DELETE FROM erp_role_permissions WHERE role_id='" + accountant + "'; ROLLBACK;"))
        .hasMessageContaining("réservée au propriétaire");
    assertThatThrownBy(() -> authenticated(ADMIN, "UPDATE erp_role_permissions SET permission_code='inventory.export'"
        + " WHERE role_id='" + accountant + "' AND permission_code='ar.receipt'"))
        .hasMessageContaining("remplacement des droits");
  }

  @Test
  void nonAdminAndOtherTenantCannotChangePermissions() throws Exception {
    String accountant = role(TENANT, "accountant");
    String before = rights(accountant);
    replace(ACCOUNTANT, accountant, "[]", 403);
    replace(ADMIN, role(PostgresFixture.BETA_TENANT, "accountant"), "[]", 404);
    assertThatThrownBy(() -> authenticated(ACCOUNTANT,
        "SELECT set_erp_role_permissions('" + accountant + "',ARRAY[]::text[])"))
        .hasMessageContaining("administrateur requis");
    assertThatThrownBy(() -> authenticated(ADMIN,
        "SELECT set_erp_role_permissions('" + role(PostgresFixture.BETA_TENANT, "accountant") + "',ARRAY[]::text[])"))
        .hasMessageContaining("Rôle introuvable");
    assertThat(rights(accountant)).isEqualTo(before);
  }

  @Test
  void unknownPermissionRejectsEntireReplacementForApiAndRpc() throws Exception {
    String accountant = role(TENANT, "accountant");
    String before = rights(accountant);
    replace(ADMIN, accountant, "[\"ar.receipt\",\"inconnu.droit\"]", 422);
    assertThat(rights(accountant)).isEqualTo(before);
    assertThatThrownBy(() -> authenticated(ADMIN,
        "SELECT set_erp_role_permissions('" + accountant + "',ARRAY['ar.receipt','inconnu.droit'])"))
        .hasMessageContaining("Droits inconnus");
    assertThat(rights(accountant)).isEqualTo(before);
  }

  private void replace(String user, String role, String permissions, int expected) throws Exception {
    mvc.perform(put("/api/v1/authorizations/roles/" + role + "/permissions").with(jwt().jwt(b -> b.subject(user)))
        .contentType(MediaType.APPLICATION_JSON).content("{\"permissions\":" + permissions + "}"))
        .andExpect(status().is(expected));
  }

  private String role(String tenant, String code) {
    return PostgresFixture.textAsAdmin(DB,
        "SELECT id::text FROM erp_roles WHERE tenant_id='" + tenant + "' AND code='" + code + "'");
  }

  private String rights(String role) {
    return PostgresFixture.textAsAdmin(DB,
        "SELECT coalesce(string_agg(permission_code,',' ORDER BY permission_code),'') FROM erp_role_permissions WHERE role_id='" + role + "'");
  }

  private void authenticated(String user, String statement) {
    owner("BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims',json_build_object('sub','"
        + user + "','role','authenticated')::text,true); " + statement + "; COMMIT;");
  }

  private void owner(String statement) {
    PostgresFixture.execute(PostgresFixture.urlOf(DB), statement);
  }
}
