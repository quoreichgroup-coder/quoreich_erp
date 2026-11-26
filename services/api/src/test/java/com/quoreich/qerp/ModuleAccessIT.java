package com.quoreich.qerp;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;

import com.quoreich.qerp.tenant.TenantContextHolder;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/** The module boundary must reject a direct HTTP read, independently of the navigation. */
@SpringBootTest
@AutoConfigureMockMvc
class ModuleAccessIT {
  private static final String DATABASE = "qerp_it_module_access";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String ACCOUNTANT = "aaaaaaaa-0000-0000-0000-0000000000f1";
  private static final String CUSTOM = "aaaaaaaa-0000-0000-0000-0000000000f2";
  private static final String CUSTOM_ROLE = "aaaaaaaa-0000-0000-0000-0000000000f3";
  private static final String SALES = "aaaaaaaa-0000-0000-0000-0000000000f4";
  private static final String BUYER = "aaaaaaaa-0000-0000-0000-0000000000f5";
  private static final String SALES_ROLE = "aaaaaaaa-0000-0000-0000-0000000000f6";
  @Autowired private MockMvc mvc;

  @DynamicPropertySource
  static void properties(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void prepare() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    owner("INSERT INTO auth.users(id) VALUES ('" + ACCOUNTANT + "'), ('" + CUSTOM + "'), ('" + SALES + "'), ('" + BUYER + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles(id,tenant_id) VALUES ('" + ACCOUNTANT + "','" + A + "'), ('" + CUSTOM + "','" + A + "'),"
        + " ('" + SALES + "','" + A + "'), ('" + BUYER + "','" + A + "') ON CONFLICT DO NOTHING");
    PostgresFixture.grantRoles(DATABASE, ACCOUNTANT, "accountant", A, PostgresFixture.ALPHA_USER, "admin", A,
        BUYER, "procurement_controller", A);
    owner("INSERT INTO erp_roles(id,tenant_id,name,is_system,needs_review) VALUES ('" + SALES_ROLE + "','" + A + "','Ventes seules',false,false) ON CONFLICT DO NOTHING;"
        + "INSERT INTO erp_role_permissions(role_id,permission_code) VALUES ('" + SALES_ROLE + "','sales.create') ON CONFLICT DO NOTHING;"
        + "INSERT INTO user_role_assignments(user_id,role_id,tenant_id) VALUES ('" + SALES + "','" + SALES_ROLE + "','" + A + "') ON CONFLICT DO NOTHING");
    TenantContextHolder.clear();
  }

  @Test
  void accountantCannotReadUnassignedModules() throws Exception {
    for (String path : new String[]{"/api/v1/inventory/movements", "/api/v1/crm/contacts", "/api/v1/treasury/accounts",
        "/api/v1/risks", "/api/v1/compliance/frameworks", "/api/v1/grc/role-audit/risk", "/api/v1/pilotage/cfo"}) {
      mvc.perform(get(path).with(jwt().jwt(b -> b.subject(ACCOUNTANT)))).andExpect(status().isForbidden());
    }
  }

  @Test
  void sharedReferenceReadsKeepSalesAndProcurementFormsWorking() throws Exception {
    for (String path : new String[]{"/api/v1/customers", "/api/v1/customers/account-sets", "/api/v1/accounting/tax-codes", "/api/v1/ar/settings/payment-terms",
        "/api/v1/accounting/setup", "/api/v1/accounting/frameworks", "/api/v1/gl/charts/account-sets"}) {
      mvc.perform(get(path).with(jwt().jwt(b -> b.subject(SALES)))).andExpect(status().isOk());
    }
    for (String path : new String[]{"/api/v1/ap/suppliers", "/api/v1/inventory/items", "/api/v1/inventory/warehouses", "/api/v1/analytics"}) {
      mvc.perform(get(path).with(jwt().jwt(b -> b.subject(BUYER)))).andExpect(status().isOk());
    }
    mvc.perform(post("/api/v1/inventory/items").with(jwt().jwt(b -> b.subject(BUYER)))
        .contentType("application/json").content("{}")).andExpect(status().isForbidden());
    mvc.perform(get("/api/v1/inventory/movements").with(jwt().jwt(b -> b.subject(BUYER)))).andExpect(status().isForbidden());
    mvc.perform(post("/api/v1/customers").with(jwt().jwt(b -> b.subject(SALES)))
        .contentType("application/json").content("{}")).andExpect(status().isForbidden());
  }

  @Test
  void accountantKeepsCustomerAndInvoiceAccess() throws Exception {
    for (String path : new String[]{"/api/v1/customers", "/api/v1/ar/invoices", "/api/v1/authorizations/me"}) {
      mvc.perform(get(path).with(jwt().jwt(b -> b.subject(ACCOUNTANT)))).andExpect(status().isOk());
    }
  }

  @Test
  void administratorKeepsModuleAccess() throws Exception {
    for (String path : new String[]{"/api/v1/inventory/items", "/api/v1/crm/contacts", "/api/v1/treasury/accounts"}) {
      mvc.perform(get(path).with(jwt().jwt(b -> b.subject(PostgresFixture.ALPHA_USER)))).andExpect(status().isOk());
    }
  }

  @Test
  void customRoleAndRevocationFollowCurrentDatabasePermissions() throws Exception {
    owner("INSERT INTO erp_roles(id,tenant_id,name,is_system,needs_review) VALUES ('" + CUSTOM_ROLE + "','" + A + "','Export stocks',false,false);"
        + "INSERT INTO erp_role_permissions(role_id,permission_code) VALUES ('" + CUSTOM_ROLE + "','inventory.export');"
        + "INSERT INTO user_role_assignments(user_id,role_id,tenant_id) VALUES ('" + CUSTOM + "','" + CUSTOM_ROLE + "','" + A + "')");
    mvc.perform(get("/api/v1/inventory/items").with(jwt().jwt(b -> b.subject(CUSTOM)))).andExpect(status().isOk());
    mvc.perform(get("/api/v1/crm/contacts").with(jwt().jwt(b -> b.subject(CUSTOM)))).andExpect(status().isForbidden());
    owner("DELETE FROM erp_role_permissions WHERE role_id='" + CUSTOM_ROLE + "'");
    mvc.perform(get("/api/v1/inventory/items").with(jwt().jwt(b -> b.subject(CUSTOM)))).andExpect(status().isForbidden());
  }

  @Test
  void tenantClaimCannotSupplyAnotherCompanyRole() throws Exception {
    mvc.perform(get("/api/v1/inventory/movements").with(jwt().jwt(b -> b.subject(ACCOUNTANT)
        .claim("tenant_id", PostgresFixture.BETA_TENANT).claim("roles", java.util.List.of("admin")))))
        .andExpect(status().isForbidden());
  }

  @Test
  void alertsRespectModulePermissionsForListsPagesAndCounts() throws Exception {
    owner("INSERT INTO erp_alerts(tenant_id,module,alert_type,severity,title,message) VALUES"
        + " ('" + A + "','Inventory','module_test','warning','Hidden module alert','Inventory detail'),"
        + " ('" + A + "','AR','module_test','warning','Allowed module alert','Invoice detail')");
    mvc.perform(get("/api/v1/alerts").param("modules", "Inventory").with(jwt().jwt(b -> b.subject(ACCOUNTANT))))
        .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(0));
    mvc.perform(get("/api/v1/alerts/page").param("module", "Inventory").with(jwt().jwt(b -> b.subject(ACCOUNTANT))))
        .andExpect(status().isOk()).andExpect(jsonPath("$.total").value(0));
    mvc.perform(get("/api/v1/alerts/unread-count").param("modules", "Inventory").with(jwt().jwt(b -> b.subject(ACCOUNTANT))))
        .andExpect(status().isOk()).andExpect(jsonPath("$").value(0));
    mvc.perform(get("/api/v1/alerts").param("modules", "AR").with(jwt().jwt(b -> b.subject(ACCOUNTANT))))
        .andExpect(status().isOk()).andExpect(jsonPath("$[?(@.title == 'Allowed module alert')]").isNotEmpty());
    String hiddenId = PostgresFixture.textAsAdmin(DATABASE, "SELECT id::text FROM erp_alerts WHERE title='Hidden module alert'");
    mvc.perform(post("/api/v1/alerts/" + hiddenId + "/resolve").with(jwt().jwt(b -> b.subject(ACCOUNTANT))))
        .andExpect(status().isForbidden());
    mvc.perform(post("/api/v1/alerts/mark-all-read").with(jwt().jwt(b -> b.subject(ACCOUNTANT))))
        .andExpect(status().isOk()).andExpect(jsonPath("$").value(1));
    org.assertj.core.api.Assertions.assertThat(PostgresFixture.countAsAdmin(DATABASE,
        "SELECT count(*) FROM erp_alerts WHERE id='" + hiddenId + "' AND read_at IS NULL AND NOT is_resolved")).isEqualTo(1);
    mvc.perform(get("/api/v1/alerts").param("modules", "Inventory").with(jwt().jwt(b -> b.subject(PostgresFixture.ALPHA_USER))))
        .andExpect(status().isOk()).andExpect(jsonPath("$[?(@.title == 'Hidden module alert')]").isNotEmpty());
  }

  private static void owner(String sql) {
    PostgresFixture.execute(PostgresFixture.urlOf(DATABASE), sql);
  }
}
