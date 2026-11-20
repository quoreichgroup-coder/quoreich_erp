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
 * V122 — tableau des flux de trésorerie SYSCOHADA : chaque rubrique sur un jeu d'opérations connu (capital, vente et
 * encaissement, achat et paiement partiel, investissement payé, dotation, cession encaissée, emprunt et remboursement,
 * virement interne), brouillon exclu, équilibre (écart nul), mouvement déclassé par une exception de la société rendu
 * visible, continuité avec la période suivante, refus pour une autre société.
 */
@SpringBootTest
class TableauFluxTresorerieIT {

  private static final String DATABASE = "qerp_it_tableau_flux";
  private static final String T = "33333333-3333-3333-3333-333333333122";
  private static final String U = "cccccccc-0000-0000-0000-000000000122";

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
        + "', 'JE-V122-" + e.substring(0, 8) + "', '" + date + "', 'Pièce V122', 'manual', 'draft', '" + U + "');"
        + "INSERT INTO journal_lines (entry_id, account_id, debit, credit) VALUES ('" + e + "', '" + compte(debit) + "', " + montant + ", 0), ('" + e
        + "', '" + compte(credit) + "', 0, " + montant + ")" + ("posted".equals(statut) ? ";UPDATE journal_entries SET status = 'posted' WHERE id = '" + e + "'" : ""));
    return e;
  }

  /** Écriture à plusieurs lignes : "compte:débit:crédit". */
  private static void piece(String date, String statut, String... lignes) {
    String e = UUID.randomUUID().toString();
    StringBuilder sb = new StringBuilder("INSERT INTO journal_entries (id, tenant_id, entry_number, entry_date, description, source, status, created_by) VALUES ('" + e
        + "', '" + T + "', 'JE-V122-" + e.substring(0, 8) + "', '" + date + "', 'Pièce TFT', 'manual', 'draft', '" + U + "');");
    for (String l : lignes) {
      String[] p = l.split(":");
      sb.append("INSERT INTO journal_lines (entry_id, account_id, debit, credit) VALUES ('" + e + "', '" + compte(p[0]) + "', " + p[1] + ", " + p[2] + ");");
    }
    if ("posted".equals(statut)) sb.append("UPDATE journal_entries SET status = 'posted' WHERE id = '" + e + "'");
    owner(sb.toString());
  }

  private static String tft(String from, String to) throws SQLException {
    return asUser("SELECT string_agg(line_code || '=' || amount::bigint, ' ' ORDER BY line_order) FROM financial_statement('TFT_SYSCOHADA', '" + from + "', '" + to + "')"
        + " WHERE line_code IN ('ZA','FA','FB','FC','FD','FE','ZB','FF','FG','FH','FI','FJ','ZC','FK','FN','FO','FQ','ZF','ZG','ZH','ZK','ZN','ZU','ZX')");
  }

  @Test
  @DisplayName("rubriques du TFT, équilibre, brouillon exclu, mouvement non classé visible, continuité, isolation")
  void tableauDesFlux() throws SQLException {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    owner("INSERT INTO tenants (id, name) VALUES ('" + T + "', 'Société TFT V122') ON CONFLICT DO NOTHING;"
        + "INSERT INTO auth.users (id) VALUES ('" + U + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + U + "', '" + T + "', 'Comptable V122') ON CONFLICT (id) DO NOTHING");
    PostgresFixture.applySyscohada(DATABASE, T);
    PostgresFixture.grantRoles(DATABASE, U, "admin", T);
    owner("INSERT INTO gl_accounts (tenant_id, code, name, account_type) VALUES"
        + " ('" + T + "', '101', 'Capital social', 'equity'), ('" + T + "', '162', 'Emprunts auprès des établissements de crédit', 'liability'),"
        + " ('" + T + "', '2441', 'Matériel de bureau', 'asset'), ('" + T + "', '2841', 'Amortissements du matériel de bureau', 'asset'),"
        + " ('" + T + "', '481', 'Fournisseurs d''investissements', 'liability'), ('" + T + "', '6813', 'Dotations aux amortissements', 'expense')");

    piece("2031-01-10", "posted", "521:5000000:0", "101:0:5000000");                        // apport en capital
    piece("2031-02-01", "posted", "411:1180000:0", "701:0:1000000", "4431:0:180000");        // vente TTC
    piece("2031-02-20", "posted", "521:1000000:0", "411:0:1000000");                         // encaissement partiel
    piece("2031-03-01", "posted", "601:400000:0", "401:0:400000");                           // achat
    piece("2031-03-15", "posted", "401:300000:0", "521:0:300000");                           // paiement partiel
    piece("2031-04-01", "posted", "2441:2000000:0", "481:0:2000000");                        // investissement facturé
    piece("2031-04-30", "posted", "481:2000000:0", "521:0:2000000");                         // investissement payé
    piece("2031-06-30", "posted", "6813:200000:0", "2841:0:200000");                         // dotation
    piece("2031-07-01", "posted", "2841:50000:0", "812:250000:0", "2441:0:300000");          // sortie de l'immobilisation cédée
    piece("2031-07-01", "posted", "485:280000:0", "822:0:280000");                           // prix de cession
    piece("2031-07-20", "posted", "521:280000:0", "485:0:280000");                           // prix encaissé
    piece("2031-08-01", "posted", "521:1500000:0", "162:0:1500000");                         // emprunt
    piece("2031-12-01", "posted", "162:500000:0", "521:0:500000");                           // remboursement
    piece("2031-12-15", "posted", "571:100000:0", "521:0:100000");                           // virement interne banque → caisse
    piece("2031-12-20", "draft", "601:999000:0", "521:0:999000");                            // brouillon : hors flux

    assertThat(tft("2031-01-01", "2031-12-31")).isEqualTo(
        "ZA=0 FA=600000 FB=0 FC=0 FD=-180000 FE=280000 ZB=700000 FF=0 FG=-2000000 FH=0 FI=280000 FJ=0 ZC=-1720000"
            + " FK=5000000 FN=0 FO=1500000 FQ=-500000 ZF=6000000 ZG=4980000 ZH=4980000 ZK=4980000 ZN=0 ZU=0 ZX=0");

    // Exception de la société : la TVA collectée sortie du tableau devient un mouvement non classé, et l'écart le montre.
    owner("INSERT INTO tenant_report_line_accounts (tenant_id, layout_code, account_id, line_code) VALUES ('" + T + "', 'TFT_SYSCOHADA', '" + compte("4431") + "', NULL)");
    assertThat(tft("2031-01-01", "2031-12-31")).contains("FE=100000", "ZU=180000", "ZX=-180000");
    assertThat(asUser("SELECT account_code || ':' || side || ':' || amount::bigint FROM cash_flow_details('TFT_SYSCOHADA', '2031-01-01', '2031-12-31') WHERE line_code = 'ZU'"))
        .isEqualTo("4431:credit:180000");
    owner("DELETE FROM tenant_report_line_accounts WHERE tenant_id = '" + T + "'");

    // Continuité : la période suivante part de la trésorerie de clôture.
    assertThat(tft("2032-01-01", "2032-12-31")).startsWith("ZA=4980000 FA=0").contains("ZH=4980000", "ZX=0");

    // Une autre société ne se calcule pas par ce point d'entrée.
    assertThatThrownBy(() -> asUser("SELECT count(*)::text FROM cash_flow_compute('TFT_SYSCOHADA', '33333333-3333-3333-3333-333333333121', '2031-01-01', '2031-12-31')"))
        .hasMessageContaining("Société non autorisée");
  }
}
