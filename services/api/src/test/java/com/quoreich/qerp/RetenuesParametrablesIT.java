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
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * V137 — retenues paramétrables : arrondi de la société, interrupteur général, seuil de base par catégorie, validité du
 * taux (facture soumise hors validité refusée), attestation d'exonération du fournisseur (tracée), réglages réservés au
 * droit ap.settings.
 */
@SpringBootTest
class RetenuesParametrablesIT {

  private static final String DATABASE = "qerp_it_retenues_param";
  private static final String T = "33333333-3333-3333-3333-333333333137";
  private static final String U = "cccccccc-0000-0000-0000-000000000137";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  private static void owner(String sql) {
    PostgresFixture.execute(PostgresFixture.urlOf(DATABASE), sql);
  }

  private static String texte(String sql) {
    return PostgresFixture.textAsAdmin(DATABASE, sql);
  }

  private static String asUser(String sql) throws SQLException {
    try (Connection c = DriverManager.getConnection(PostgresFixture.urlOf(DATABASE), PostgresFixture.API_USER, PostgresFixture.API_PASSWORD)) {
      c.setAutoCommit(false);
      try (PreparedStatement claims = c.prepareStatement("SELECT set_config('request.jwt.claims', ?, true)")) {
        claims.setString(1, "{\"sub\":\"" + U + "\",\"role\":\"authenticated\"}");
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

  private static final String F = "00000000-0000-0000-0000-0000000f0137";
  private static final String R = "00000000-0000-0000-0000-0000000e0137";

  private String facture(String numero, String date, int ht) throws SQLException {
    return asUser("INSERT INTO ap_invoices (tenant_id, invoice_number, supplier_id, invoice_date, due_date, subtotal, tax_amount, total, status, approval_status, created_by)"
        + " VALUES ('" + T + "', '" + numero + "', '" + F + "', '" + date + "', '" + date + "', " + ht + ", 0, " + ht + ", 'draft', 'draft', auth.uid())"
        + " RETURNING withholding_amount::text");
  }

  @Test
  @DisplayName("arrondi, interrupteur, seuil, validité du taux, exonération du fournisseur")
  void parametres() throws SQLException {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    owner("INSERT INTO tenants (id, name) VALUES ('" + T + "', 'Client V137') ON CONFLICT DO NOTHING;"
        + "INSERT INTO auth.users (id) VALUES ('" + U + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + U + "', '" + T + "', 'Comptable V137') ON CONFLICT (id) DO NOTHING");
    PostgresFixture.grantRoles(DATABASE, U, "admin", T);
    owner("INSERT INTO ap_withholding_rates (id, tenant_id, category, rate_pct, gl_account, min_base, valid_from, valid_to)"
        + " VALUES ('" + R + "', '" + T + "', 'Prestations', 2.5, '447', 50000, '2031-01-01', '2031-12-31');"
        + "INSERT INTO suppliers (id, tenant_id, name, withholding_rate_id) VALUES ('" + F + "', '" + T + "', 'Prestataire V137', '" + R + "')");

    // Arrondi par défaut : 1 XOF (2,5 % de 123 457 = 3 086,425 → 3 086).
    assertThat(facture("P-1", "2031-03-01", 123457)).isEqualTo("3086.00");
    asUser("INSERT INTO ap_withholding_settings (tenant_id, rounding_step) VALUES ('" + T + "', 5) RETURNING tenant_id::text");
    assertThat(facture("P-2", "2031-03-01", 123457)).as("arrondi à 5 XOF").isEqualTo("3085.00");
    // Seuil : base sous 50 000, pas de retenue.
    assertThat(facture("P-3", "2031-03-01", 40000)).isEqualTo("0.00");
    // Hors validité : brouillon sans retenue, soumission refusée.
    assertThat(facture("P-4", "2032-02-01", 100000)).isEqualTo("0.00");
    assertThatThrownBy(() -> owner("UPDATE ap_invoices SET approval_status = 'approved', status = 'open' WHERE tenant_id = '" + T + "' AND invoice_number = 'P-4'"))
        .hasMessageContaining("non valable");
    // Exonération du fournisseur jusqu'au 30 juin, tracée.
    asUser("UPDATE suppliers SET withholding_exempt_until = '2031-06-30', withholding_exempt_ref = 'ATT-2031-17' WHERE id = '" + F + "' RETURNING id::text");
    assertThat(facture("P-5", "2031-06-15", 100000)).isEqualTo("0.00");
    assertThat(facture("P-6", "2031-07-01", 100000)).isEqualTo("2500.00");
    assertThat(texte("SELECT string_agg(field || '=' || new_value, ' ' ORDER BY field) FROM supplier_change_log WHERE supplier_id = '" + F + "' AND field LIKE 'withholding%'"))
        .isEqualTo("withholding_exempt_ref=ATT-2031-17 withholding_exempt_until=2031-06-30");
    // Interrupteur général.
    asUser("UPDATE ap_withholding_settings SET enabled = false WHERE tenant_id = '" + T + "' RETURNING tenant_id::text");
    assertThat(facture("P-7", "2031-08-01", 100000)).isEqualTo("0.00");
    // Réglages : droit ap.settings ; fonction interne non exécutable par les utilisateurs.
    assertThatThrownBy(() -> owner("SET ROLE authenticated; SELECT public.withholding_setting('" + T + "')")).hasMessageContaining("permission denied");
  }
}
