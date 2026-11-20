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
 * V123 — notes annexes : tableaux de mouvements (ouverture, augmentations, diminutions, clôture) des immobilisations,
 * amortissements, trésorerie, dettes financières et clients ; montants de période des produits et achats ; brouillon
 * exclu ; continuité d'une année sur l'autre ; commentaire rédigé seulement avec le droit accounting.annex.
 */
@SpringBootTest
class NotesAnnexesIT {

  private static final String DATABASE = "qerp_it_notes_annexes";
  private static final String T = "33333333-3333-3333-3333-333333333123";
  private static final String U = "cccccccc-0000-0000-0000-000000000123";
  private static final String V = "cccccccc-0000-0000-0000-00000000a123";

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

  private static String compte(String code) {
    return texte("SELECT id::text FROM gl_accounts WHERE tenant_id = '" + T + "' AND code = '" + code + "'");
  }

  private static String ecriture(String date, String debit, String credit, int montant, String statut) {
    String e = UUID.randomUUID().toString();
    owner("INSERT INTO journal_entries (id, tenant_id, entry_number, entry_date, description, source, status, created_by) VALUES ('" + e + "', '" + T
        + "', 'JE-V123-" + e.substring(0, 8) + "', '" + date + "', 'Pièce V122', 'manual', 'draft', '" + U + "');"
        + "INSERT INTO journal_lines (entry_id, account_id, debit, credit) VALUES ('" + e + "', '" + compte(debit) + "', " + montant + ", 0), ('" + e
        + "', '" + compte(credit) + "', 0, " + montant + ")" + ("posted".equals(statut) ? ";UPDATE journal_entries SET status = 'posted' WHERE id = '" + e + "'" : ""));
    return e;
  }

  /** Écriture à plusieurs lignes : "compte:débit:crédit". */
  private static void piece(String date, String statut, String... lignes) {
    String e = UUID.randomUUID().toString();
    StringBuilder sb = new StringBuilder("INSERT INTO journal_entries (id, tenant_id, entry_number, entry_date, description, source, status, created_by) VALUES ('" + e
        + "', '" + T + "', 'JE-V123-" + e.substring(0, 8) + "', '" + date + "', 'Pièce TFT', 'manual', 'draft', '" + U + "');");
    for (String l : lignes) {
      String[] p = l.split(":");
      sb.append("INSERT INTO journal_lines (entry_id, account_id, debit, credit) VALUES ('" + e + "', '" + compte(p[0]) + "', " + p[1] + ", " + p[2] + ");");
    }
    if ("posted".equals(statut)) sb.append("UPDATE journal_entries SET status = 'posted' WHERE id = '" + e + "'");
    owner(sb.toString());
  }

  private static String note(String code, String from, String to) throws SQLException {
    return asUser("SELECT string_agg(account_code || ':' || opening::bigint || '/' || increase::bigint || '/' || decrease::bigint || '/' || closing::bigint, ' ' ORDER BY group_order, account_code)"
        + " FROM annex_note_lines('" + code + "', '" + from + "', '" + to + "')");
  }

  private static String asOther(String sql) throws SQLException {
    try (Connection c = DriverManager.getConnection(PostgresFixture.urlOf(DATABASE), PostgresFixture.API_USER, PostgresFixture.API_PASSWORD)) {
      c.setAutoCommit(false);
      try (PreparedStatement claims = c.prepareStatement("SELECT set_config('request.jwt.claims', ?, true)")) {
        claims.setString(1, "{\"sub\":\"" + V + "\",\"role\":\"authenticated\"}");
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

  @Test
  @DisplayName("tableaux de mouvements, montants de période, brouillon exclu, continuité, commentaire réservé au droit")
  void notesAnnexes() throws SQLException {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    owner("INSERT INTO tenants (id, name) VALUES ('" + T + "', 'Société annexes V123') ON CONFLICT DO NOTHING;"
        + "INSERT INTO auth.users (id) VALUES ('" + U + "'), ('" + V + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + U + "', '" + T + "', 'Comptable V123'), ('" + V + "', '" + T + "', 'Lecteur V123') ON CONFLICT (id) DO NOTHING");
    PostgresFixture.applySyscohada(DATABASE, T);
    PostgresFixture.grantRoles(DATABASE, U, "admin", T);
    PostgresFixture.grantRoles(DATABASE, V, "viewer", T);
    owner("INSERT INTO gl_accounts (tenant_id, code, name, account_type) VALUES"
        + " ('" + T + "', '101', 'Capital social', 'equity'), ('" + T + "', '162', 'Emprunts auprès des établissements de crédit', 'liability'),"
        + " ('" + T + "', '2441', 'Matériel de bureau', 'asset'), ('" + T + "', '2841', 'Amortissements du matériel de bureau', 'asset'),"
        + " ('" + T + "', '481', 'Fournisseurs d''investissements', 'liability'), ('" + T + "', '6813', 'Dotations aux amortissements', 'expense')");

    piece("2031-01-10", "posted", "521:5000000:0", "101:0:5000000");
    piece("2031-02-01", "posted", "411:1180000:0", "701:0:1000000", "4431:0:180000");
    piece("2031-02-20", "posted", "521:1000000:0", "411:0:1000000");
    piece("2031-03-01", "posted", "601:400000:0", "401:0:400000");
    piece("2031-04-01", "posted", "2441:2000000:0", "481:0:2000000");
    piece("2031-04-30", "posted", "481:2000000:0", "521:0:2000000");
    piece("2031-06-30", "posted", "6813:200000:0", "2841:0:200000");
    piece("2031-07-01", "posted", "2841:50000:0", "812:250000:0", "2441:0:300000");
    piece("2031-08-01", "posted", "521:1500000:0", "162:0:1500000");
    piece("2031-12-01", "posted", "162:500000:0", "521:0:500000");
    piece("2031-12-15", "posted", "571:100000:0", "521:0:100000");
    piece("2031-12-20", "draft", "601:999000:0", "521:0:999000");

    String a = "2031-01-01", z = "2031-12-31";
    assertThat(note("3A", a, z)).isEqualTo("2441:0/2000000/300000/1700000");
    assertThat(note("3C", a, z)).isEqualTo("2841:0/200000/50000/150000");
    assertThat(note("11", a, z)).isEqualTo("521:0/7500000/2600000/4900000 571:0/100000/0/100000");
    assertThat(note("16A", a, z)).isEqualTo("162:0/1500000/500000/1000000");
    assertThat(note("7", a, z)).isEqualTo("411:0/1180000/1000000/180000");
    assertThat(note("17", a, z)).isEqualTo("401:0/400000/0/400000");
    assertThat(note("21", a, z)).isEqualTo("701:0/1000000/0/1000000");
    assertThat(note("22", a, z)).as("brouillon exclu").isEqualTo("601:0/400000/0/400000");
    assertThat(note("1", a, z)).as("note rédigée : pas de tableau").isNull();

    // Continuité : l'ouverture 2032 reprend la clôture 2031 ; une note de période repart de zéro.
    assertThat(note("3A", "2032-01-01", "2032-12-31")).isEqualTo("2441:1700000/0/0/1700000");
    assertThat(note("21", "2032-01-01", "2032-12-31")).isNull();

    // Commentaire : rédigé par le comptable, refusé au lecteur.
    asUser("INSERT INTO annex_note_texts (tenant_id, note_code, period_end, body) VALUES ('" + T + "', '2', '" + z + "', 'Coût historique ; amortissement linéaire.') RETURNING note_code");
    assertThat(asOther("SELECT body FROM annex_note_texts WHERE note_code = '2'")).isEqualTo("Coût historique ; amortissement linéaire.");
    assertThatThrownBy(() -> asOther("INSERT INTO annex_note_texts (tenant_id, note_code, period_end, body) VALUES ('" + T + "', '1', '" + z + "', 'x') RETURNING note_code"))
        .hasMessageContaining("row-level security");
  }
}
