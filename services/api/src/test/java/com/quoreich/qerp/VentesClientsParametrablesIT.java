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
 * V58 — ventes et comptes clients paramétrables : droits du catalogue attribuables à un rôle
 * personnalisé (clients, factures) ; contrôle de crédit bloquer / avertir / désactivé ; devis expiré
 * commandable si la société le permet ; lettrage automatique désactivable ; paramètres réservés.
 */
@SpringBootTest
class VentesClientsParametrablesIT {

  private static final String DATABASE = "qerp_it_ventes_parametrables";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String ADMIN = PostgresFixture.ALPHA_USER;
  private static final String COMMIS = "aaaaaaaa-0000-0000-0000-0000000005f8";
  private static final String CLIENT = "c0000003-0000-0000-0000-000000000000";
  private static final String LIGNE = "'[{\"description\":\"Prestation\",\"quantity\":1,\"unit_price\":150000}]'";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.applySyscohada(DATABASE, A);
    owner("INSERT INTO auth.users (id) VALUES ('" + COMMIS + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + COMMIS + "', '" + A + "', 'Commis ventes') ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO sales_settings (tenant_id) VALUES ('" + A + "') ON CONFLICT (tenant_id) DO NOTHING;"
        + "UPDATE sales_settings SET credit_control_mode = 'block', block_expired_quotations = true WHERE tenant_id = '" + A + "';"
        + "INSERT INTO ar_general_settings (tenant_id) VALUES ('" + A + "') ON CONFLICT (tenant_id) DO NOTHING;"
        + "UPDATE ar_general_settings SET auto_lettering = true, auto_numbering = false WHERE tenant_id = '" + A + "';"
        + "UPDATE customers SET credit_limit = 100000 WHERE id = '" + CLIENT + "'");
    PostgresFixture.grantRoles(DATABASE, ADMIN, "admin", A, COMMIS, "viewer", A);
  }

  private static String commande() throws SQLException {
    return asUser(ADMIN, "SELECT create_sales_order('" + CLIENT + "', CURRENT_DATE, " + LIGNE + "::jsonb)::text");
  }

  @Test
  @DisplayName("rôle personnalisé : customers.manage et ar.invoice suffisent ; paramètres AR et ventes réservés à leur droit")
  void droitsAttribuables() throws SQLException {
    String creer = "INSERT INTO customers (tenant_id, name) VALUES ('" + A + "', 'Client V58') RETURNING id::text";
    String facturer = "INSERT INTO ar_invoices (tenant_id, invoice_number, customer_id, due_date, subtotal, tax_amount, status, created_by)"
        + " VALUES ('" + A + "', 'F58-" + UUID.randomUUID().toString().substring(0, 6) + "', '" + CLIENT + "', CURRENT_DATE + 30, 1000, 0, 'draft', '"
        + COMMIS + "') RETURNING id::text";
    assertThatThrownBy(() -> asUser(COMMIS, creer)).hasMessageContaining("row-level security");
    assertThatThrownBy(() -> asUser(COMMIS, facturer)).hasMessageContaining("Droit insuffisant");

    String role = UUID.randomUUID().toString();
    owner("INSERT INTO erp_roles (id, tenant_id, name, is_system) VALUES ('" + role + "', '" + A + "', 'Commis ventes " + role.substring(0, 4) + "', false);"
        + "INSERT INTO erp_role_permissions (role_id, permission_code) VALUES ('" + role + "', 'customers.manage'), ('" + role + "', 'ar.invoice');"
        + "INSERT INTO user_role_assignments (user_id, role_id, tenant_id) VALUES ('" + COMMIS + "', '" + role + "', '" + A + "')");
    assertThat(asUser(COMMIS, creer)).isNotNull();
    assertThat(asUser(COMMIS, facturer)).isNotNull();
    assertThat(asUser(COMMIS, "WITH u AS (UPDATE ar_general_settings SET grace_period_days = 9 WHERE tenant_id = '" + A
        + "' RETURNING 1) SELECT count(*)::text FROM u")).as("droit ar.settings requis").isEqualTo("0");
    assertThat(asUser(COMMIS, "WITH u AS (UPDATE sales_settings SET credit_control_mode = 'off' WHERE tenant_id = '" + A
        + "' RETURNING 1) SELECT count(*)::text FROM u")).as("droit sales.settings requis").isEqualTo("0");
  }

  @Test
  @DisplayName("limite de crédit : bloquer (défaut), avertir ou ne pas contrôler, selon la société")
  void controleDeCreditParametrable() throws SQLException {
    String c1 = commande();
    assertThatThrownBy(() -> asUser(ADMIN, "SELECT confirm_so('" + c1 + "')::text")).hasMessageContaining("Limite de crédit dépassée");
    owner("UPDATE sales_settings SET credit_control_mode = 'warn' WHERE tenant_id = '" + A + "'");
    asUser(ADMIN, "SELECT confirm_so('" + c1 + "')::text");
    assertThat(texte("SELECT status FROM sales_orders WHERE id = '" + c1 + "'")).as("avertir : confirmée").isEqualTo("confirmed");
    owner("UPDATE sales_settings SET credit_control_mode = 'off' WHERE tenant_id = '" + A + "'");
    String c2 = commande();
    asUser(ADMIN, "SELECT confirm_so('" + c2 + "')::text");
    assertThat(texte("SELECT status FROM sales_orders WHERE id = '" + c2 + "'")).isEqualTo("confirmed");
  }

  @Test
  @DisplayName("devis expiré : refusé par défaut, commandable si la société le permet ; lettrage automatique désactivable")
  void devisExpireEtLettrage() throws SQLException {
    owner("UPDATE customers SET credit_limit = NULL WHERE id = '" + CLIENT + "'");
    String devis = asUser(ADMIN, "SELECT create_sales_quotation('" + CLIENT + "', CURRENT_DATE, CURRENT_DATE + 30, " + LIGNE + "::jsonb)::text");
    owner("UPDATE quotations SET quote_date = CURRENT_DATE - 40, valid_until = CURRENT_DATE - 1 WHERE id = '" + devis + "'");
    assertThatThrownBy(() -> asUser(ADMIN, "SELECT confirm_quote_to_so('" + devis + "')::text")).hasMessageContaining("expiré");
    owner("UPDATE sales_settings SET block_expired_quotations = false WHERE tenant_id = '" + A + "'");
    assertThat(asUser(ADMIN, "SELECT confirm_quote_to_so('" + devis + "')::text")).isNotNull();

    owner("UPDATE ar_general_settings SET auto_lettering = false WHERE tenant_id = '" + A + "'");
    String f = asUser(ADMIN, "INSERT INTO ar_invoices (tenant_id, invoice_number, customer_id, due_date, subtotal, tax_amount, status, created_by)"
        + " VALUES ('" + A + "', 'F58L-" + UUID.randomUUID().toString().substring(0, 6) + "', '" + CLIENT + "', CURRENT_DATE + 30, 5000, 0, 'draft', '"
        + ADMIN + "') RETURNING id::text");
    asUser(ADMIN, "UPDATE ar_invoices SET status = 'sent' WHERE id = '" + f + "' RETURNING id::text");
    asUser(ADMIN, "INSERT INTO payments (tenant_id, payment_type, ar_invoice_id, amount, payment_date, payment_method, created_by)"
        + " VALUES ('" + A + "', 'ar_receipt', '" + f + "', 5000, CURRENT_DATE, 'cash', '" + ADMIN + "') RETURNING id::text");
    assertThat(texte("SELECT status || ' ' || (SELECT count(*) FROM ar_letterings WHERE invoice_id = '" + f + "') FROM ar_invoices WHERE id = '" + f + "'"))
        .as("soldée, non lettrée").isEqualTo("paid 0");
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
