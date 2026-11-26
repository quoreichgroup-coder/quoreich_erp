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
 * Stocks, CRM, comptes clients (complément) et immobilisations par l'API (sur site) : stock et coût moyen
 * tenus par la base (ajustement par la fonction), CRM avec actions groupées, paramètres AR et identité de
 * la société, immobilisation créée avec VNC calculée ; refus avec leur SQLSTATE ; autre société aveugle.
 */
@SpringBootTest
@AutoConfigureMockMvc
class StocksCrmAssetsApiIT {

  private static final String DATABASE = "qerp_it_stocks_crm_assets_api";
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
  @DisplayName("stocks : article (stock du client ignoré), ajustement par la fonction, mouvements, vues, autre société aveugle")
  void stocks() throws Exception {
    String depot = envoyer("/api/v1/inventory/warehouses", "{\"code\":\"DEP-API\",\"name\":\"Dépôt API\"}", 201).get("id").asString();
    String article = envoyer("/api/v1/inventory/items", "{\"code\":\"ART-API\",\"name\":\"Article API\",\"unit\":\"u\",\"quantity_on_hand\":999}", 201).get("id").asString();
    assertThat(PostgresFixture.textAsAdmin(DATABASE, "SELECT quantity_on_hand::int::text FROM items WHERE id = '" + article + "'")).as("stock tenu par la base").isEqualTo("0");
    PostgresFixture.execute(PostgresFixture.urlOf(DATABASE), "UPDATE inventory_settings SET auto_je_on_movement = false WHERE tenant_id = '" + A + "'");
    envoyer("/api/v1/inventory/actions/create_stock_adjustment", "{\"_item_id\":\"" + article + "\",\"_warehouse_id\":\"" + depot + "\",\"_quantity\":5,\"_unit_cost\":1200,"
        + "\"_movement_date\":\"" + java.time.LocalDate.now() + "\",\"_reason\":\"Stock initial\"}", 200);
    assertThat(PostgresFixture.textAsAdmin(DATABASE, "SELECT quantity_on_hand::int::text FROM items WHERE id = '" + article + "'")).isEqualTo("5");
    mvc.perform(get("/api/v1/inventory/movements?itemId=" + article).with(as(ADMIN))).andExpect(status().isOk())
        .andExpect(jsonPath("$[0].item.code").value("ART-API")).andExpect(jsonPath("$[0].warehouse.code").value("DEP-API"));
    mvc.perform(get("/api/v1/inventory/views/valuation").with(as(ADMIN))).andExpect(status().isOk());
    mvc.perform(get("/api/v1/inventory/views/kpis").with(as(ADMIN))).andExpect(status().isOk());
    JsonNode refus = envoyer("/api/v1/inventory/actions/create_stock_adjustment", "{\"_item_id\":\"" + article + "\",\"_warehouse_id\":\"" + depot + "\",\"_quantity\":-50,"
        + "\"_unit_cost\":null,\"_movement_date\":\"" + java.time.LocalDate.now() + "\",\"_reason\":\"Sortie\"}", 422);
    assertThat(refus.get("code").asString()).as("SQLSTATE transmis").isNotBlank();
    envoyer("/api/v1/inventory/role-audit", "{\"role\":\"inventory_controller\",\"action\":\"export_csv\",\"comment\":\"test\"}", 201);
    envoyer("/api/v1/inventory/role-audit", "{\"role\":\"admin\",\"action\":\"grant\",\"comment\":\"x\"}", 422);
    mvc.perform(get("/api/v1/inventory/items").with(as(PostgresFixture.BETA_USER))).andExpect(status().isOk())
        .andExpect(jsonPath("$[?(@.id == '" + article + "')]").isEmpty());
  }

  @Test
  @DisplayName("CRM : contacts (import tout ou rien, actions groupées), opportunité, activité faite ; AR : paramètres et identité")
  void crmEtClients() throws Exception {
    envoyer("/api/v1/crm/contacts/import", "{\"rows\":[{\"full_name\":\"Awa API\",\"email\":\"awa@exemple.invalid\"},{\"full_name\":\"Moussa API\"}]}", 201);
    mvc.perform(get("/api/v1/crm/contacts?search=API").with(as(ADMIN))).andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(2));
    String ids = PostgresFixture.textAsAdmin(DATABASE, "SELECT string_agg('\"' || id || '\"', ',') FROM crm_contacts WHERE full_name LIKE '% API'");
    envoyer("/api/v1/crm/contacts/bulk-update", "{\"ids\":[" + ids + "],\"patch\":{\"status\":\"inactive\"}}", 200);
    assertThat(PostgresFixture.countAsAdmin(DATABASE, "SELECT count(*) FROM crm_contacts WHERE full_name LIKE '% API' AND status = 'inactive'")).isEqualTo(2);
    String opp = envoyer("/api/v1/crm/opportunities", "{\"name\":\"Affaire API\",\"stage\":\"lead\",\"amount\":500000}", 201).get("id").asString();
    String act = envoyer("/api/v1/crm/activities", "{\"opportunity_id\":\"" + opp + "\",\"type\":\"call\",\"subject\":\"Relance\",\"due_at\":\"2030-01-01T09:00:00Z\"}", 201)
        .get("id").asString();
    envoyer("/api/v1/crm/activities/" + act + "/complete", "{}", 200);
    assertThat(PostgresFixture.countAsAdmin(DATABASE, "SELECT count(*) FROM crm_activities WHERE id = '" + act + "' AND completed_at IS NOT NULL")).isEqualTo(1);
    envoyer("/api/v1/crm/actions/delete_all", "{}", 404);

    mvc.perform(put("/api/v1/ar/settings/payment-terms").with(as(ADMIN)).contentType(MediaType.APPLICATION_JSON)
        .content("{\"code\":\"N45\",\"label\":\"45 jours\",\"days\":45}")).andExpect(status().isOk()).andExpect(jsonPath("$.days").value(45));
    mvc.perform(get("/api/v1/ar/settings/payment-terms").with(as(ADMIN))).andExpect(status().isOk()).andExpect(jsonPath("$[?(@.code == 'N45')]").isNotEmpty());
    mvc.perform(put("/api/v1/company/identity").with(as(ADMIN)).contentType(MediaType.APPLICATION_JSON)
        .content("{\"legal_name\":\"Alpha SARL\",\"rccm\":\"BF-OUA-2026-B-1\"}")).andExpect(status().isOk());
    mvc.perform(get("/api/v1/company/identity").with(as(ADMIN))).andExpect(status().isOk()).andExpect(jsonPath("$.legal_name").value("Alpha SARL"));
    mvc.perform(get("/api/v1/ar/aging").with(as(ADMIN))).andExpect(status().isOk());
    mvc.perform(get("/api/v1/ar/customer-credits").with(as(ADMIN))).andExpect(status().isOk()).andExpect(jsonPath("$.advances").isArray());
  }

  private void comptes(String... codeTypeNom) {
    StringBuilder q = new StringBuilder();
    for (int i = 0; i < codeTypeNom.length; i += 3) {
      q.append("INSERT INTO gl_accounts (tenant_id, code, name, account_type) SELECT '").append(A).append("', '").append(codeTypeNom[i]).append("', '")
          .append(codeTypeNom[i + 2]).append("', '").append(codeTypeNom[i + 1]).append("' WHERE NOT EXISTS (SELECT 1 FROM gl_accounts WHERE tenant_id = '")
          .append(A).append("' AND code = '").append(codeTypeNom[i]).append("');");
    }
    PostgresFixture.execute(PostgresFixture.urlOf(DATABASE), q.toString());
  }

  @Test
  @DisplayName("immobilisations : catégorie aux comptes contrôlés, immobilisation à VNC calculée, registre, paramètres")
  void immobilisations() throws Exception {
    comptes("2441", "asset", "Matériel de bureau", "2844", "asset", "Amortissements du matériel", "6813", "expense", "Dotations aux amortissements");
    String cat = envoyer("/api/v1/assets/categories", "{\"name\":\"Matériel API\",\"depreciation_method\":\"straight_line\",\"useful_life_years\":5,"
        + "\"gl_asset_account_id\":\"" + compte("2441") + "\",\"gl_depreciation_account_id\":\"" + compte("2844") + "\",\"gl_expense_account_id\":\"" + compte("6813") + "\"}", 201)
        .get("id").asString();
    envoyer("/api/v1/assets/categories", "{\"name\":\"Mauvaise\",\"gl_asset_account_id\":\"" + compte("601") + "\",\"gl_depreciation_account_id\":\"" + compte("2844")
        + "\",\"gl_expense_account_id\":\"" + compte("6813") + "\"}", 422);
    JsonNode a = envoyer("/api/v1/assets", "{\"asset_code\":\"IMM-API\",\"name\":\"Ordinateur\",\"category_id\":\"" + cat + "\",\"acquisition_date\":\"2026-01-10\","
        + "\"acquisition_cost\":600000,\"useful_life_months\":36,\"depreciation_method\":\"straight_line\",\"net_book_value\":1}", 201);
    assertThat(a.get("net_book_value").asDouble()).as("VNC calculée par la base").isEqualTo(600000.0);
    mvc.perform(get("/api/v1/assets").with(as(ADMIN))).andExpect(status().isOk()).andExpect(jsonPath("$[?(@.asset_code == 'IMM-API')].category.name").value("Matériel API"));
    mvc.perform(get("/api/v1/assets/register").with(as(ADMIN))).andExpect(status().isOk());
    mvc.perform(put("/api/v1/assets/settings").with(as(ADMIN)).contentType(MediaType.APPLICATION_JSON).content("{\"first_month_prorata\":false}"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.first_month_prorata").value(false));
  }
}
