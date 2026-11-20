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
 * V130 — cours BCEAO publiés : enregistrés par la tâche seule (jamais par un utilisateur), la parité fixe de l'euro
 * jamais remplacée, cours retenu au choix de la société (milieu, achat, vente), désactivables, cours de la société
 * prioritaire, reprise d'une même date sans doublon.
 */
@SpringBootTest
class CoursBceaoIT {

  private static final String DATABASE = "qerp_it_cours_bceao";
  private static final String T = "33333333-3333-3333-3333-333333333130";
  private static final String U = "cccccccc-0000-0000-0000-000000000130";

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

  private static final String RATES = "'[{\"currency\":\"USD\",\"buy\":580,\"sell\":590},{\"currency\":\"EUR\",\"buy\":1,\"sell\":1},"
      + "{\"currency\":\"GBP\",\"buy\":780,\"sell\":790}]'::jsonb";

  @Test
  @DisplayName("cours publiés : écriture réservée à la tâche, parité intacte, milieu / achat / vente, désactivation, priorité société")
  void coursPublies() throws SQLException {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    owner("INSERT INTO tenants (id, name) VALUES ('" + T + "', 'Société cours V130') ON CONFLICT DO NOTHING;"
        + "INSERT INTO auth.users (id) VALUES ('" + U + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + U + "', '" + T + "', 'Trésorier V130') ON CONFLICT (id) DO NOTHING");
    PostgresFixture.grantRoles(DATABASE, U, "admin", T);

    assertThatThrownBy(() -> owner("SET ROLE authenticated; SELECT public.import_reference_rates('XOF', '2031-05-02', 'BCEAO', " + RATES + ")"))
        .hasMessageContaining("permission denied");
    assertThat(texte("SELECT public.import_reference_rates('XOF', '2031-05-02', 'BCEAO', " + RATES + ")::text")).as("l'euro est ignoré").isEqualTo("2");
    assertThat(texte("SELECT public.import_reference_rates('XOF', '2031-05-02', 'BCEAO', " + RATES + ")::text")).as("reprise sans doublon").isEqualTo("2");
    assertThat(texte("SELECT count(*)::text FROM exchange_rates WHERE tenant_id IS NULL AND currency = 'USD'")).isEqualTo("1");

    String usd = "SELECT exchange_rate_at('" + T + "', 'USD', '2031-05-10')::numeric(12,2)::text";
    assertThat(asUser(usd)).as("milieu par défaut").isEqualTo("585.00");
    assertThat(asUser("SELECT exchange_rate_at('" + T + "', 'EUR', '2031-05-10')::numeric(12,3)::text")).isEqualTo("655.957");
    asUser("INSERT INTO currency_settings (tenant_id, reference_rate) VALUES ('" + T + "', 'sell') RETURNING reference_rate");
    assertThat(asUser(usd)).isEqualTo("590.00");
    asUser("UPDATE currency_settings SET reference_rate = 'buy' WHERE tenant_id = '" + T + "' RETURNING reference_rate");
    assertThat(asUser(usd)).isEqualTo("580.00");
    asUser("UPDATE currency_settings SET use_published_rates = false WHERE tenant_id = '" + T + "' RETURNING reference_rate");
    assertThat(asUser(usd)).as("cours publiés désactivés").isNull();
    assertThat(asUser("SELECT exchange_rate_at('" + T + "', 'EUR', '2031-05-10')::numeric(12,3)::text")).as("parité toujours appliquée").isEqualTo("655.957");
    asUser("UPDATE currency_settings SET use_published_rates = true WHERE tenant_id = '" + T + "' RETURNING reference_rate");
    asUser("INSERT INTO exchange_rates (tenant_id, base_currency, currency, rate_date, rate, source) VALUES ('" + T + "', 'XOF', 'USD', '2031-05-02', 600, 'Banque') RETURNING id::text");
    assertThat(asUser(usd)).as("le cours de la société prime").isEqualTo("600.00");
  }
}
