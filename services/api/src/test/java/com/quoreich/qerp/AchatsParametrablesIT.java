package com.quoreich.qerp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * V57 — achats paramétrables : droits du catalogue attribuables à un rôle personnalisé ; paramètres
 * par société (double contrôle, modes contrôlés, tolérance de retard, délai par défaut, contenu du
 * stock prévisionnel), modifiables seulement avec procurement.settings.
 */
@SpringBootTest
class AchatsParametrablesIT {

  private static final String DATABASE = "qerp_it_achats_parametrables";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String ADMIN = PostgresFixture.ALPHA_USER;
  private static final String COMMIS = "aaaaaaaa-0000-0000-0000-0000000005e7";
  private static final String CLIENT = "c0000003-0000-0000-0000-000000000000";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.applySyscohada(DATABASE, A);
    owner("INSERT INTO auth.users (id) VALUES ('" + COMMIS + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + COMMIS + "', '" + A + "', 'Commis achats') ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO procurement_settings (tenant_id) VALUES ('" + A + "') ON CONFLICT (tenant_id) DO NOTHING;"
        + "UPDATE procurement_settings SET bank_dual_control = true, bank_control_methods = ARRAY['bank_transfer'], followup_grace_days = 0,"
        + " default_lead_time_days = 0, replenishment_include_requisitions = true, replenishment_include_reservations = true WHERE tenant_id = '" + A + "'");
    PostgresFixture.grantRoles(DATABASE, ADMIN, "admin", A, COMMIS, "viewer", A);
  }

  @Test
  @DisplayName("rôle personnalisé : le droit suppliers.manage suffit à créer une fiche ; sans lui, refus ; paramètres réservés")
  void droitsAttribuables() throws SQLException {
    String creer = "INSERT INTO suppliers (tenant_id, name) VALUES ('" + A + "', 'Fournisseur V57 " + UUID.randomUUID().toString().substring(0, 5) + "') RETURNING id::text";
    assertThatThrownBy(() -> asUser(COMMIS, creer)).hasMessageContaining("row-level security");

    String role = UUID.randomUUID().toString();
    owner("INSERT INTO erp_roles (id, tenant_id, name, is_system) VALUES ('" + role + "', '" + A + "', 'Commis achats " + role.substring(0, 4) + "', false);"
        + "INSERT INTO erp_role_permissions (role_id, permission_code) VALUES ('" + role + "', 'suppliers.manage');"
        + "INSERT INTO user_role_assignments (user_id, role_id, tenant_id) VALUES ('" + COMMIS + "', '" + role + "', '" + A + "')");
    assertThat(asUser(COMMIS, creer)).isNotNull();
    assertThat(asUser(COMMIS, "WITH u AS (UPDATE procurement_settings SET followup_grace_days = 9 WHERE tenant_id = '" + A
            + "' RETURNING 1) SELECT count(*)::text FROM u"))
        .as("paramètres : droit procurement.settings requis").isEqualTo("0");
    assertThat(asUser(ADMIN, "WITH u AS (UPDATE procurement_settings SET followup_grace_days = 0 WHERE tenant_id = '" + A
            + "' RETURNING 1) SELECT count(*)::text FROM u")).isEqualTo("1");
  }

  @Test
  @DisplayName("double contrôle désactivable, modes de paiement contrôlés au choix")
  void doubleControleParametrable() {
    String f = UUID.randomUUID().toString(), facture = UUID.randomUUID().toString();
    owner("INSERT INTO suppliers (id, tenant_id, name, bank_account) VALUES ('" + f + "', '" + A + "', 'Fournisseur RIB V57', 'BF01 0002');"
        + "INSERT INTO ap_invoices (id, tenant_id, invoice_number, supplier_id, invoice_date, due_date, subtotal, tax_amount, status,"
        + " approval_status, created_by) VALUES ('" + facture + "', '" + A + "', 'FF-V57-" + facture.substring(0, 5) + "', '" + f
        + "', CURRENT_DATE, CURRENT_DATE + 30, 10000, 0, 'draft', 'pending', '" + ADMIN + "');"
        + "UPDATE ap_invoices SET approval_status = 'approved', status = 'open' WHERE id = '" + facture + "'");
    java.util.function.Function<String, String> paiement = (mode) -> "INSERT INTO payments (tenant_id, payment_type, ap_invoice_id, amount,"
        + " payment_date, payment_method, created_by) VALUES ('" + A + "', 'ap_payment', '" + facture + "', 100, CURRENT_DATE, '" + mode + "', '" + ADMIN + "')";

    owner(paiement.apply("check"));
    owner("UPDATE procurement_settings SET bank_control_methods = ARRAY['bank_transfer', 'check'] WHERE tenant_id = '" + A + "'");
    assertThatThrownBy(() -> owner(paiement.apply("check"))).as("chèque désormais contrôlé").hasStackTraceContaining("Paiement refusé");
    owner("UPDATE procurement_settings SET bank_dual_control = false WHERE tenant_id = '" + A + "'");
    owner(paiement.apply("bank_transfer"));
    assertThat(texte("SELECT amount_paid::text FROM ap_invoices WHERE id = '" + facture + "'")).isEqualTo("200.00");
  }

  @Test
  @DisplayName("délai par défaut de la société, tolérance avant retard, réservations clients comptées ou non")
  void delaisToleranceEtPrevisionnel() {
    String f = UUID.randomUUID().toString(), po = UUID.randomUUID().toString(), art = UUID.randomUUID().toString(), so = UUID.randomUUID().toString();
    owner("UPDATE procurement_settings SET default_lead_time_days = 15, followup_grace_days = 5 WHERE tenant_id = '" + A + "';"
        + "INSERT INTO suppliers (id, tenant_id, name) VALUES ('" + f + "', '" + A + "', 'Fournisseur sans délai');"
        + "INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, order_date, status, created_by) VALUES ('" + po + "', '" + A
        + "', 'PO-V57-" + po.substring(0, 5) + "', '" + f + "', CURRENT_DATE - 18, 'approved', '" + ADMIN + "');"
        + "INSERT INTO po_lines (po_id, description, quantity, unit_cost) VALUES ('" + po + "', 'x', 1, 100)");
    assertThat(texte("SELECT (expected_date = CURRENT_DATE - 3)::text FROM purchase_orders WHERE id = '" + po + "'"))
        .as("commande + 15 j (délai de la société)").isEqualTo("true");
    assertThat(texte("SELECT followup_state || ' ' || days_late FROM purchase_order_followup_view WHERE po_id = '" + po + "'"))
        .as("3 jours de retard, dans la tolérance de 5 j").isEqualTo("unconfirmed 3");

    owner("INSERT INTO items (id, tenant_id, code, name, quantity_on_hand) VALUES ('" + art + "', '" + A + "', 'P-" + art.substring(0, 5) + "', 'Article V57', 10);"
        + "INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, total, status, created_by) VALUES ('" + so + "', '" + A
        + "', 'SO-" + so.substring(0, 6) + "', '" + CLIENT + "', 0, 'confirmed', '" + ADMIN + "');"
        + "INSERT INTO so_lines (so_id, item_id, description, quantity, unit_price) VALUES ('" + so + "', '" + art + "', 'x', 4, 1)");
    assertThat(texte("SELECT reserved || ' ' || projected FROM stock_projection_view WHERE item_id = '" + art + "'")).isEqualTo("4 6.00");
    owner("UPDATE procurement_settings SET replenishment_include_reservations = false WHERE tenant_id = '" + A + "'");
    assertThat(texte("SELECT reserved || ' ' || projected || ' ' || sales_reserved FROM stock_projection_view WHERE item_id = '" + art + "'"))
        .isEqualTo("0 10.00 4");
  }

  // ─── Outils ───

  private static String asUser(String user, String sql) throws SQLException {
    try (Connection c = DriverManager.getConnection(
            PostgresFixture.urlOf(DATABASE), PostgresFixture.API_USER, PostgresFixture.API_PASSWORD)) {
      c.setAutoCommit(false);
      try (PreparedStatement claims = c.prepareStatement("SELECT set_config('request.jwt.claims', ?, true)")) {
        claims.setString(1, "{\"sub\":\"" + user + "\",\"role\":\"authenticated\"}");
        claims.execute();
      }
      try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql)) {
        String r = rs.next() ? rs.getString(1) : null;
        c.commit();
        return r;
      } catch (SQLException e) {
        c.rollback();
        throw e;
      }
    }
  }

  private static void owner(String sql) {
    PostgresFixture.execute(PostgresFixture.urlOf(DATABASE), sql);
  }

  private static String texte(String sql) {
    try (Connection c = DriverManager.getConnection(
            PostgresFixture.urlOf(DATABASE), PostgresFixture.ADMIN_USER, PostgresFixture.ADMIN_PASSWORD);
        Statement st = c.createStatement();
        var rs = st.executeQuery(sql)) {
      return rs.next() ? rs.getString(1) : null;
    } catch (SQLException e) {
      throw new IllegalStateException(e);
    }
  }
}
