package com.quoreich.qerp.authorization;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.util.List;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class ModuleAccessPolicyTest {
  private final ModuleAccessPolicy policy = new ModuleAccessPolicy(new ObjectMapper());

  ModuleAccessPolicyTest() throws IOException {}

  private boolean allowed(String path, String pattern, String method, String permission) {
    return policy.forApi(path, pattern, method).stream().anyMatch(rule -> policy.allows(rule, List.of(), List.of(permission)));
  }

  @Test
  void sharedReferencesDoNotGrantWritesOrOtherModuleData() {
    assertThat(allowed("/api/v1/ap/suppliers", "/api/v1/ap/suppliers", "GET", "suppliers.manage")).isTrue();
    assertThat(allowed("/api/v1/ap/invoices", "/api/v1/ap/invoices", "GET", "suppliers.manage")).isFalse();
    assertThat(allowed("/api/v1/customers", "/api/v1/customers", "GET", "sales.create_order")).isTrue();
    assertThat(allowed("/api/v1/customers", "/api/v1/customers", "POST", "sales.create_order")).isFalse();
    assertThat(allowed("/api/v1/inventory/items", "/api/v1/inventory/items", "GET", "procurement.import")).isTrue();
    assertThat(allowed("/api/v1/inventory/movements", "/api/v1/inventory/movements", "GET", "procurement.import")).isFalse();
  }

  @Test
  void dynamicReferencesStayConstrainedToTheExplicitKind() {
    assertThat(allowed("/api/v1/ar/settings/payment-terms", "/api/v1/ar/settings/{kind}", "GET", "sales.create_order")).isTrue();
    assertThat(allowed("/api/v1/ar/settings/general", "/api/v1/ar/settings/{kind}", "GET", "sales.create_order")).isFalse();
    assertThat(allowed("/api/v1/ar/settings/payment-terms", "/api/v1/ar/settings/{kind}", "POST", "sales.create_order")).isFalse();
  }

  @Test
  void accountantCannotReadGrcOrGlobalCfoThroughAnAlias() {
    for (String path : List.of("/api/v1/risks", "/api/v1/grc/role-audit/risk", "/api/v1/pilotage/cfo")) {
      assertThat(allowed(path, path, "GET", "accounting.chart")).as(path).isFalse();
    }
    assertThat(allowed("/api/v1/risks", "/api/v1/risks", "GET", "risks.export")).isTrue();
  }
}
