package com.quoreich.qerp;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * V119 — paramètres par défaut : aucun taux de retenue pré-rempli, aucun frais de relance inventé, et des appels
 * répétés de seed_ap_defaults (un par modification des paramètres fournisseurs) ne créent aucun doublon.
 */
@SpringBootTest
class ParametresParDefautIT {

  private static final String DATABASE = "qerp_it_parametres_par_defaut";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String ADMIN = PostgresFixture.ALPHA_USER;

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.grantRoles(DATABASE, ADMIN, "admin", A);
  }

  private static String asUser(String user, String sql) throws SQLException {
    try (Connection c = DriverManager.getConnection(PostgresFixture.urlOf(DATABASE), PostgresFixture.API_USER, PostgresFixture.API_PASSWORD)) {
      c.setAutoCommit(false);
      try (PreparedStatement claims = c.prepareStatement("SELECT set_config('request.jwt.claims', ?, true)")) {
        claims.setString(1, "{\"sub\":\"" + user + "\",\"role\":\"authenticated\"}");
        claims.execute();
      }
      try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql)) {
        String r = rs.next() ? rs.getString(1) : null;
        c.commit();
        return r;
      }
    }
  }

  @Test
  @DisplayName("paramètres fournisseurs : appels répétés sans doublon, aucune retenue pré-remplie")
  void parametresFournisseurs() throws SQLException {
    for (int i = 0; i < 3; i++) asUser(ADMIN, "SELECT seed_ap_defaults('" + A + "')::text");
    assertThat(PostgresFixture.textAsAdmin(DATABASE, "SELECT count(*)::text FROM ap_withholding_rates WHERE tenant_id = '" + A + "'")).isEqualTo("0");
    assertThat(PostgresFixture.textAsAdmin(DATABASE, "SELECT (count(*) = count(DISTINCT (event, channel)))::text || ' ' || count(*) FROM ap_notification_rules WHERE tenant_id = '" + A + "'"))
        .isEqualTo("true 3");
    assertThat(PostgresFixture.textAsAdmin(DATABASE, "SELECT count(*)::text FROM ap_numbering_series WHERE tenant_id = '" + A + "'")).isEqualTo("3");
  }

  @Test
  @DisplayName("nouvelle société : relances proposées sans frais, conditions de paiement en français")
  void nouvelleSociete() {
    String t = PostgresFixture.textAsAdmin(DATABASE, "INSERT INTO tenants (name) VALUES ('Société V119') RETURNING id::text");
    assertThat(PostgresFixture.textAsAdmin(DATABASE, "SELECT count(*) || ' ' || COALESCE(sum(fee_amount), 0)::int FROM ar_dunning_rules WHERE tenant_id = '" + t + "'"))
        .isEqualTo("4 0");
    assertThat(PostgresFixture.textAsAdmin(DATABASE, "SELECT string_agg(label, ', ' ORDER BY days) FROM ar_payment_terms WHERE tenant_id = '" + t + "'"))
        .isEqualTo("Comptant à la livraison, Net à 30 jours, Net à 60 jours");
  }
}
