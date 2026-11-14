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
 * V60 — plan comptable SYSCOHADA : écriture du plan réservée, compte mouvementé figé (code, type),
 * parent par préfixe, imputation refusée sur un compte inactif ou de regroupement ; contrôle de
 * cohérence ; remplacement non destructif (imputation automatique redirigée) et reclassement du solde
 * par une écriture nouvelle, l'historique restant intact.
 */
@SpringBootTest
class PlanComptableSyscohadaIT {

  private static final String DATABASE = "qerp_it_plan_syscohada";
  private static final String B = PostgresFixture.BETA_TENANT;
  private static final String ADMIN_B = PostgresFixture.BETA_USER;
  private static final String LECTEUR = "bbbbbbbb-0000-0000-0000-0000000006a0";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    owner("INSERT INTO auth.users (id) VALUES ('" + LECTEUR + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + LECTEUR + "', '" + B + "', 'Lecteur B') ON CONFLICT (id) DO NOTHING");
    PostgresFixture.grantRoles(DATABASE, ADMIN_B, "admin", B, LECTEUR, "viewer", B);
  }

  private static String compte(String code, String nom, String type) {
    String id = UUID.randomUUID().toString();
    owner("INSERT INTO gl_accounts (id, tenant_id, code, name, account_type) VALUES ('" + id + "', '" + B + "', '" + code + "', '" + nom + "', '" + type + "')");
    return id;
  }

  private static String ecriture(String debit, String credit, int montant) {
    String e = UUID.randomUUID().toString();
    owner("INSERT INTO journal_entries (id, tenant_id, entry_number, entry_date, description, source, status, created_by) VALUES ('" + e + "', '"
        + B + "', 'JE-V60-" + e.substring(0, 6) + "', CURRENT_DATE, 'Essai V60', 'manual', 'draft', '" + ADMIN_B + "');"
        + "INSERT INTO journal_lines (entry_id, account_id, debit, credit) VALUES ('" + e + "', '" + debit + "', " + montant + ", 0), ('"
        + e + "', '" + credit + "', 0, " + montant + ");"
        + "UPDATE journal_entries SET status = 'posted' WHERE id = '" + e + "'");
    return e;
  }

  @Test
  @DisplayName("protection : lecteur refusé, compte mouvementé figé, parent par préfixe, regroupement et inactif non imputables")
  void protection() throws SQLException {
    String suffixe = UUID.randomUUID().toString().substring(0, 3).replaceAll("[^0-9]", "7");
    String banque = compte("5219" + suffixe, "Banque V60", "asset"), vente = compte("7019" + suffixe, "Ventes V60", "revenue");
    ecriture(banque, vente, 1000);
    assertThat(asUser(LECTEUR, "WITH u AS (UPDATE gl_accounts SET name = 'x' WHERE id = '" + vente + "' RETURNING 1) SELECT count(*)::text FROM u"))
        .isEqualTo("0");
    assertThatThrownBy(() -> asUser(ADMIN_B, "UPDATE gl_accounts SET account_type = 'expense' WHERE id = '" + vente + "' RETURNING id::text"))
        .hasMessageContaining("figés");
    assertThat(asUser(ADMIN_B, "UPDATE gl_accounts SET name = 'Ventes de marchandises V60' WHERE id = '" + vente + "' RETURNING name"))
        .as("l'intitulé reste modifiable").isEqualTo("Ventes de marchandises V60");
    assertThatThrownBy(() -> asUser(ADMIN_B, "INSERT INTO gl_accounts (tenant_id, code, name, account_type) VALUES ('" + B + "', 'ABC', 'x', 'asset') RETURNING id::text"))
        .hasMessageContaining("chiffres uniquement");
    assertThatThrownBy(() -> asUser(ADMIN_B, "INSERT INTO gl_accounts (tenant_id, code, name, account_type) VALUES ('" + B + "', '9', 'x', 'bizarre') RETURNING id::text"))
        .hasMessageContaining("account_type_check");
    String tete = asUser(ADMIN_B, "INSERT INTO gl_accounts (tenant_id, code, name, account_type, is_header) VALUES ('" + B + "', '52" + suffixe
        + "', 'Banques (regroupement)', 'asset', true) RETURNING id::text");
    assertThatThrownBy(() -> asUser(ADMIN_B, "UPDATE gl_accounts SET parent_id = '" + tete + "' WHERE id = '" + vente + "' RETURNING id::text"))
        .as("parent qui n'est pas un préfixe").hasMessageContaining("Compte parent invalide");
    assertThatThrownBy(() -> ecriture(tete, vente, 10)).hasStackTraceContaining("regroupement");
    owner("UPDATE gl_accounts SET is_active = false WHERE id = '" + banque + "'");
    assertThatThrownBy(() -> ecriture(banque, vente, 10)).hasStackTraceContaining("inactif");
    assertThatThrownBy(() -> asUser(ADMIN_B, "DELETE FROM gl_accounts WHERE id = '" + vente + "' RETURNING id::text")).hasMessageContaining("mouvementé");
  }

  @Test
  @DisplayName("contrôle et correction : TVA en 431 et ventes en 4000 signalées ; remplacement, imputation redirigée, solde reclassé")
  void controleEtCorrection() throws SQLException {
    owner("DELETE FROM tenant_posting_accounts WHERE tenant_id = '" + B + "'");
    String caisse = compte("1000", "Caisse", "asset");
    String tva = compte("4310", "TVA collectée", "liability");
    String vente = compte("4000", "Ventes de marchandises", "revenue");
    String client = compte("4110", "Clients", "asset");
    owner("INSERT INTO tenant_posting_accounts (tenant_id, role_code, gl_account_id) VALUES ('" + B + "', 'SALES_REVENUE', '" + vente + "'),"
        + " ('" + B + "', 'VAT_OUTPUT', '" + tva + "')");
    ecriture(client, vente, 50000);

    String issues = asUser(ADMIN_B, "SELECT string_agg(code || ':' || issue || ':' || COALESCE(suggested_code, ''), ' | ' ORDER BY code, issue) FROM chart_of_accounts_issues()"
        + " WHERE code IN ('1000', '4310', '4000', '4110')");
    assertThat(issues)
        .contains("1000:Classe et type incohérents:571")
        .contains("4000:Classe et type incohérents:701")
        .contains("4000:Imputation automatique hors classe attendue:701")
        .contains("4310:Imputation automatique hors classe attendue:4431")
        .contains("4310:Intitulé différent du compte SYSCOHADA:4431")
        .doesNotContain("4110:");

    String nouveau = asUser(ADMIN_B, "SELECT replace_gl_account('" + vente + "', '701', 'Ventes de marchandises', 'revenue')::text");
    assertThat(texte("SELECT (gl_account_id = '" + nouveau + "')::text FROM tenant_posting_accounts WHERE tenant_id = '" + B + "' AND role_code = 'SALES_REVENUE'"))
        .as("imputation automatique redirigée").isEqualTo("true");
    assertThat(texte("SELECT is_active::text || ' ' || (replaced_by = '" + nouveau + "')::text FROM gl_accounts WHERE id = '" + vente + "'"))
        .as("ancien compte conservé, inactif, relié").isEqualTo("false true");

    String recl = asUser(ADMIN_B, "SELECT reclassify_gl_account_balance('" + vente + "', CURRENT_DATE, 'Mise en conformité SYSCOHADA')::text");
    assertThat(texte("SELECT string_agg(g.code || ':' || l.debit || '/' || l.credit, ' ' ORDER BY g.code) FROM journal_lines l JOIN gl_accounts g ON g.id = l.account_id"
            + " WHERE l.entry_id = '" + recl + "'"))
        .isEqualTo("4000:50000.00/0.00 701:0.00/50000.00");
    assertThat(texte("SELECT count(*)::text FROM journal_lines WHERE account_id = '" + vente + "' AND credit = 50000"))
        .as("l'écriture d'origine est intacte").isEqualTo("1");
    assertThat(texte("SELECT is_active::text FROM gl_accounts WHERE id = '" + vente + "'")).isEqualTo("false");
    assertThatThrownBy(() -> asUser(LECTEUR, "SELECT replace_gl_account('" + tva + "', '4431', 'TVA facturée sur ventes', 'liability')::text"))
        .hasMessageContaining("Droit insuffisant");

    asUser(ADMIN_B, "SELECT replace_gl_account('" + caisse + "', '571', 'Caisse siège social', 'asset')::text");
    assertThat(Integer.parseInt(asUser(ADMIN_B, "SELECT create_syscohada_headings()::text"))).isPositive();
    asUser(ADMIN_B, "SELECT link_gl_account_parents()::text");
    assertThat(texte("SELECT p.code FROM gl_accounts g JOIN gl_accounts p ON p.id = g.parent_id WHERE g.tenant_id = '" + B + "' AND g.code = '701'"))
        .as("701 rattaché à 70").isEqualTo("70");
    assertThat(texte("SELECT is_header::text FROM gl_accounts WHERE tenant_id = '" + B + "' AND code = '70'")).isEqualTo("true");
    assertThat(asUser(ADMIN_B, "SELECT count(*)::text FROM chart_of_accounts_issues() i JOIN gl_accounts g ON g.id = i.account_id WHERE g.is_header AND i.severity = 'error'"))
        .as("V61 : les comptes de regroupement créés (classes comprises) ne sont pas signalés").isEqualTo("0");
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
