package com.quoreich.qerp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

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
 * V75 (lot F1, G-11 / G-20) — immobilisations : catégorie aux comptes contrôlés, amortissement linéaire
 * au prorata du premier mois, reprise d'un cumul d'ouverture, calcul idempotent et contre-passable,
 * dégressif, cession SYSCOHADA (sortie 28x / 81x / 2x, prix 485 / 82x, dotation du mois de sortie),
 * fiche figée, droits.
 */
@SpringBootTest
class ImmobilisationsIT {

  private static final String DATABASE = "qerp_it_immobilisations";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String ADMIN = PostgresFixture.ALPHA_USER;
  private static final String LECTEUR = "aaaaaaaa-7575-0000-0000-000000000075";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.applySyscohada(DATABASE, A);
    owner("INSERT INTO auth.users (id) VALUES ('" + LECTEUR + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + LECTEUR + "', '" + A + "', 'Lecteur') ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO gl_accounts (tenant_id, code, name, account_type) VALUES ('" + A + "', '2441', 'Matériel de bureau', 'asset'),"
        + " ('" + A + "', '2844', 'Amortissements du matériel et mobilier', 'asset'), ('" + A + "', '6813', 'Dotations aux amortissements des immobilisations corporelles', 'expense')"
        + " ON CONFLICT (tenant_id, code) DO NOTHING");
    PostgresFixture.grantRoles(DATABASE, ADMIN, "admin", A, LECTEUR, "viewer", A);
  }

  private static String compte(String code) {
    return texte("SELECT id::text FROM gl_accounts WHERE tenant_id = '" + A + "' AND code = '" + code + "'");
  }

  private static String immo(String categorie, String code, int cout, int mois, String methode, String miseEnService, int ouverture, String dateOuverture) throws SQLException {
    return asUser(ADMIN, "INSERT INTO assets (tenant_id, asset_code, name, category_id, acquisition_date, in_service_date, acquisition_cost, salvage_value, useful_life_months,"
        + " depreciation_method, opening_accumulated, opening_date, created_by) VALUES ('" + A + "', '" + code + "', 'Immobilisation " + code + "', '" + categorie + "', '"
        + miseEnService + "', '" + miseEnService + "', " + cout + ", 0, " + mois + ", '" + methode + "', " + ouverture + ", " + (dateOuverture == null ? "NULL" : "'" + dateOuverture + "'")
        + ", auth.uid()) RETURNING id::text");
  }

  private static String dotation(String asset, String mois) {
    return texte("SELECT amount::text FROM depreciation_entries WHERE asset_id = '" + asset + "' AND period_date = '" + mois + "-01'");
  }

  private static String ecriture(String entry) {
    return texte("SELECT string_agg(g.code || ':' || l.debit || '/' || l.credit, ' ' ORDER BY g.code, l.debit) FROM journal_lines l JOIN gl_accounts g ON g.id = l.account_id WHERE l.entry_id = '" + entry + "'");
  }

  @Test
  @DisplayName("amortissements (prorata, ouverture, dégressif), calcul idempotent et contre-passé, cession SYSCOHADA, fiche figée, droits")
  void cycleComplet() throws SQLException {
    assertThatThrownBy(() -> asUser(ADMIN, "INSERT INTO asset_categories (tenant_id, name, depreciation_method, useful_life_years, gl_asset_account_id, gl_depreciation_account_id, gl_expense_account_id)"
        + " VALUES ('" + A + "', 'Mauvaise', 'straight_line', 5, '" + compte("6813") + "', '" + compte("2844") + "', '" + compte("6813") + "') RETURNING id::text"))
        .hasMessageContaining("classe 2");
    String cat = asUser(ADMIN, "INSERT INTO asset_categories (tenant_id, name, depreciation_method, useful_life_years, gl_asset_account_id, gl_depreciation_account_id, gl_expense_account_id)"
        + " VALUES ('" + A + "', 'Matériel de bureau', 'straight_line', 5, '" + compte("2441") + "', '" + compte("2844") + "', '" + compte("6813") + "') RETURNING id::text");

    String a = immo(cat, "IMM-A", 1200000, 60, "straight_line", "2040-01-16", 0, null);
    String c = immo(cat, "IMM-C", 1200000, 60, "straight_line", "2037-01-01", 600000, "2039-12-31");
    assertThat(texte("SELECT accumulated_depreciation || ' ' || net_book_value FROM assets WHERE id = '" + c + "'")).as("reprise d'ouverture").isEqualTo("600000.00 600000.00");

    assertThatThrownBy(() -> asUser(LECTEUR, "SELECT run_depreciation('2040-01')::text")).hasMessageContaining("Droit insuffisant");
    String jan = asUser(ADMIN, "SELECT run_depreciation('2040-01')::text");
    assertThat(jan).contains("\"immobilisations\": 2");
    assertThat(dotation(a, "2040-01") + " " + dotation(c, "2040-01")).as("premier mois au prorata (16 jours sur 31) ; reprise : 20 000").isEqualTo("10322.58 20000.00");
    assertThat(ecriture(texte("SELECT journal_entry_id::text FROM depreciation_runs WHERE period = '2040-01' AND status = 'posted'")))
        .isEqualTo("2844:0.00/30322.58 6813:30322.58/0.00");
    assertThatThrownBy(() -> asUser(ADMIN, "SELECT run_depreciation('2040-01')::text")).hasMessageContaining("déjà calculés");

    asUser(ADMIN, "SELECT run_depreciation('2040-02')::text");
    assertThatThrownBy(() -> asUser(ADMIN, "SELECT reverse_last_depreciation('')::text")).hasMessageContaining("Motif");
    assertThat(asUser(ADMIN, "SELECT reverse_last_depreciation('Erreur de durée')::text")).isEqualTo("2040-02");
    assertThat(texte("SELECT accumulated_depreciation::text FROM assets WHERE id = '" + a + "'")).isEqualTo("10322.58");
    asUser(ADMIN, "SELECT run_depreciation('2040-02')::text");
    assertThat(texte("SELECT accumulated_depreciation::text FROM assets WHERE id = '" + a + "'")).isEqualTo("30322.58");

    assertThatThrownBy(() -> asUser(ADMIN, "UPDATE assets SET acquisition_cost = 1 WHERE id = '" + a + "' RETURNING id::text")).hasMessageContaining("figés");
    assertThatThrownBy(() -> asUser(ADMIN, "UPDATE assets SET accumulated_depreciation = 0 WHERE id = '" + a + "' RETURNING id::text")).hasMessageContaining("calculés");
    assertThatThrownBy(() -> asUser(ADMIN, "SELECT dispose_asset('" + a + "', '2040-04-10', 'sale', 1000000)::text")).as("mars non amorti").hasMessageContaining("jusqu'au mois précédant");

    String cession = asUser(ADMIN, "SELECT dispose_asset('" + a + "', '2040-03-10', 'sale', 1000000, 'receivable', 'Vente au personnel')::text");
    assertThat(cession).contains("\"prix\": 1000000").contains("\"valeur_nette\": 1163225.81").contains("\"plus_ou_moins_value\": -163225.81");
    assertThat(ecriture(texte("SELECT journal_entry_id::text FROM asset_disposals WHERE asset_id = '" + a + "'")))
        .as("dotation du mois (10 jours), sortie 28x / 812 / 2x, prix 485 / 822")
        .isEqualTo("2441:0.00/1200000.00 2844:0.00/6451.61 2844:36774.19/0.00 485:1000000.00/0.00 6813:6451.61/0.00 812:1163225.81/0.00 822:0.00/1000000.00");
    assertThat(texte("SELECT status FROM assets WHERE id = '" + a + "'")).isEqualTo("disposed");
    assertThatThrownBy(() -> asUser(ADMIN, "SELECT dispose_asset('" + a + "', '2040-03-11', 'scrap', 0)::text")).hasMessageContaining("déjà cédée");

    String b = immo(cat, "IMM-B", 100000, 60, "declining_balance", "2041-01-01", 0, null);
    asUser(ADMIN, "SELECT run_depreciation('2041-01')::text");
    assertThat(dotation(b, "2041-01")).as("dégressif : 100 000 × (2 / 5 ans) / 12").isEqualTo("3333.33");
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
