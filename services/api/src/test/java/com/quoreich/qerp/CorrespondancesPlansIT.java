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
 * V66 (PC-5) — plans secondaires et correspondances : proposition automatique jamais validée d'office,
 * répartition à 100 %, validation par une autre personne, correspondance validée figée, balance
 * convertie dans le plan cible.
 */
@SpringBootTest
class CorrespondancesPlansIT {

  private static final String DATABASE = "qerp_it_correspondances";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String AUTEUR = PostgresFixture.ALPHA_USER;
  private static final String VALIDEUR = "aaaaaaaa-6666-0000-0000-000000000066";
  private static final String LECTEUR = "aaaaaaaa-6666-0000-0000-000000000067";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.applySyscohada(DATABASE, A);
    owner("INSERT INTO auth.users (id) VALUES ('" + VALIDEUR + "'), ('" + LECTEUR + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + VALIDEUR + "', '" + A + "', 'Valideur'), ('" + LECTEUR + "', '" + A
        + "', 'Lecteur') ON CONFLICT (id) DO NOTHING");
    PostgresFixture.grantRoles(DATABASE, AUTEUR, "accountant", A, VALIDEUR, "admin", A, LECTEUR, "viewer", A);
  }

  private static String compte(String code) {
    return texte("SELECT id::text FROM gl_accounts WHERE tenant_id = '" + A + "' AND code = '" + code + "'");
  }

  @Test
  @DisplayName("plan secondaire PCG, proposition, répartition, validation par un tiers, balance convertie")
  void correspondances() throws SQLException {
    assertThatThrownBy(() -> asUser(AUTEUR, "SELECT create_secondary_chart('PCG-GROUPE', 'Plan de groupe PCG', 'PCG_FR')::text"))
        .as("plan secondaire : administrateur des plans").hasMessageContaining("Droit insuffisant");
    String plan = asUser(VALIDEUR, "SELECT create_secondary_chart('PCG-GROUPE', 'Plan de groupe PCG', 'PCG_FR')::text");
    assertThat(Integer.parseInt(texte("SELECT count(*)::text FROM secondary_chart_accounts WHERE chart_id = '" + plan + "'"))).isGreaterThan(100);

    String e = UUID.randomUUID().toString();
    owner("INSERT INTO journal_entries (id, tenant_id, entry_number, entry_date, description, source, status, created_by) VALUES ('" + e + "', '" + A
        + "', 'JE-V66-" + e.substring(0, 6) + "', '2033-02-10', 'Essai V66', 'manual', 'draft', '" + AUTEUR + "');"
        + "INSERT INTO journal_lines (entry_id, account_id, debit, credit) VALUES ('" + e + "', '" + compte("521") + "', 1000, 0), ('" + e + "', '"
        + compte("701") + "', 0, 1000); UPDATE journal_entries SET status = 'posted' WHERE id = '" + e + "'");

    assertThatThrownBy(() -> asUser(LECTEUR, "SELECT create_chart_mapping('x', NULL, '" + plan + "')::text")).hasMessageContaining("Droit insuffisant");
    String m = asUser(AUTEUR, "SELECT create_chart_mapping('Vers le plan de groupe', NULL, '" + plan + "')::text");
    assertThat(Integer.parseInt(asUser(AUTEUR, "SELECT propose_chart_mapping('" + m + "')::text"))).isGreaterThan(0);
    assertThat(asUser(AUTEUR, "SELECT string_agg(source_code || '>' || target_code || ':' || method || ':' || status, ' ' ORDER BY source_code) FROM compare_chart_mapping('" + m
        + "') WHERE source_code IN ('411', '701')"))
        .as("même code ; jamais validé d'office").isEqualTo("411>411:same_code:proposed 701>701:same_code:proposed");

    assertThatThrownBy(() -> asUser(AUTEUR, "SELECT set_chart_mapping_lines('" + m + "', '" + compte("521") + "', '[{\"code\":\"512\",\"ratio\":60},{\"code\":\"530\",\"ratio\":30}]')::text"))
        .hasMessageContaining("100");
    asUser(AUTEUR, "SELECT set_chart_mapping_lines('" + m + "', '" + compte("521") + "', '[{\"code\":\"512\",\"ratio\":60},{\"code\":\"530\",\"ratio\":40}]', 'Banque et caisse')::text");
    // Comptes mouvementés du jeu de référence sans équivalent : affectés au compte d'attente 47.
    asUser(AUTEUR, "SELECT count(set_chart_mapping_lines('" + m + "', c.source_account_id, '[{\"code\":\"47\",\"ratio\":100}]'))::text FROM compare_chart_mapping('" + m
        + "') c WHERE c.finding = 'Compte non couvert' AND c.lines > 0");

    owner("SELECT set_config('qerp.system_roles_seed', 'on', false); INSERT INTO erp_role_permissions (role_id, permission_code) SELECT id, 'accounting.mapping_validate' FROM erp_roles WHERE tenant_id = '"
        + A + "' AND code = 'accountant' ON CONFLICT DO NOTHING");
    assertThatThrownBy(() -> asUser(AUTEUR, "SELECT decide_chart_mapping_lines('" + m + "', array_agg(id), true)::text FROM chart_mapping_lines WHERE mapping_id = '" + m + "'"))
        .as("séparation des tâches").hasMessageContaining("autre personne");
    assertThatThrownBy(() -> asUser(VALIDEUR, "SELECT validate_chart_mapping('" + m + "')::text")).hasMessageContaining("encore proposée");
    asUser(VALIDEUR, "SELECT decide_chart_mapping_lines('" + m + "', array_agg(id), true)::text FROM chart_mapping_lines WHERE mapping_id = '" + m + "'");
    assertThat(asUser(VALIDEUR, "SELECT validate_chart_mapping('" + m + "') ->> 'lignes_validees'")).isNotNull();

    assertThat(asUser(AUTEUR, "SELECT string_agg(target_code || '=' || balance, ' ' ORDER BY target_code) FROM mapped_trial_balance('" + m
        + "', '2033-01-01', '2033-12-31') WHERE target_code IN ('512', '530', '701')"))
        .as("balance convertie, banque répartie 60 / 40").isEqualTo("512=600.00 530=400.00 701=-1000.00");
    assertThatThrownBy(() -> asUser(AUTEUR, "SELECT propose_chart_mapping('" + m + "')::text")).hasMessageContaining("ne se modifie plus");
  }

  @Test
  @DisplayName("validation refusée tant qu'un compte mouvementé n'est pas couvert ; refus motivé")
  void couverture() throws SQLException {
    String m = asUser(AUTEUR, "SELECT create_chart_mapping('Vers PCG', 'PCG_FR', NULL)::text");
    asUser(AUTEUR, "SELECT set_chart_mapping_lines('" + m + "', '" + compte("411") + "', '[{\"code\":\"411\",\"ratio\":100}]')::text");
    String e = UUID.randomUUID().toString();
    owner("INSERT INTO journal_entries (id, tenant_id, entry_number, entry_date, description, source, status, created_by) VALUES ('" + e + "', '" + A
        + "', 'JE-V66-" + e.substring(0, 6) + "', '2034-02-10', 'Essai V66', 'manual', 'draft', '" + AUTEUR + "');"
        + "INSERT INTO journal_lines (entry_id, account_id, debit, credit) VALUES ('" + e + "', '" + compte("411") + "', 500, 0), ('" + e + "', '"
        + compte("4431") + "', 0, 500); UPDATE journal_entries SET status = 'posted' WHERE id = '" + e + "'");
    assertThatThrownBy(() -> asUser(VALIDEUR, "SELECT decide_chart_mapping_lines('" + m + "', array_agg(id), false)::text FROM chart_mapping_lines WHERE mapping_id = '" + m + "'"))
        .hasMessageContaining("Motif obligatoire");
    asUser(VALIDEUR, "SELECT decide_chart_mapping_lines('" + m + "', array_agg(id), true)::text FROM chart_mapping_lines WHERE mapping_id = '" + m + "'");
    assertThatThrownBy(() -> asUser(VALIDEUR, "SELECT validate_chart_mapping('" + m + "')::text")).hasMessageContaining("4431");
  }

  @Test
  @DisplayName("V69 : modèle rempli réimporté — refus global détaillé, puis lignes remplacées en propositions")
  void importDuModele() throws SQLException {
    String m = asUser(AUTEUR, "SELECT create_chart_mapping('Modèle importé', 'PCG_FR', NULL)::text");
    assertThatThrownBy(() -> asUser(AUTEUR, "SELECT import_chart_mapping_lines('" + m + "', '["
        + "{\"line\":2,\"source\":\"521\",\"target\":\"512\",\"ratio\":\"60\"},"
        + "{\"line\":3,\"source\":\"521\",\"target\":\"530\",\"ratio\":\"30\"},"
        + "{\"line\":4,\"source\":\"999999\",\"target\":\"411\"},"
        + "{\"line\":5,\"source\":\"701\",\"target\":\"ZZZ\"}]')::text"))
        .hasMessageContaining("rien n'a été modifié").hasMessageContaining("ligne 4 : compte source 999999 absent du plan")
        .hasMessageContaining("ligne 5 : compte cible ZZZ absent").hasMessageContaining("compte 521 : répartition de 90");
    assertThat(texte("SELECT count(*)::text FROM chart_mapping_lines WHERE mapping_id = '" + m + "'")).isEqualTo("0");

    assertThat(asUser(AUTEUR, "SELECT import_chart_mapping_lines('" + m + "', '["
        + "{\"line\":2,\"source\":\"521\",\"target\":\"512\",\"ratio\":\"66,5 %\"},"
        + "{\"line\":3,\"source\":\"521\",\"target\":\"530\",\"ratio\":\"33,5\"},"
        + "{\"line\":4,\"source\":\"701\",\"target\":\"707\",\"comment\":\"Ventes\"},"
        + "{\"line\":5,\"source\":\"411\",\"target\":\"\"}]')::text"))
        .isEqualTo("{\"lignes\": 3, \"comptes\": 2}");
    assertThat(texte("SELECT string_agg(g.code || '>' || l.target_code || ':' || l.ratio || ':' || l.status || ':' || l.method, ' ' ORDER BY g.code, l.target_code)"
        + " FROM chart_mapping_lines l JOIN gl_accounts g ON g.id = l.source_account_id WHERE l.mapping_id = '" + m + "'"))
        .as("virgule décimale et % acceptés ; propositions ; ligne sans cible ignorée")
        .isEqualTo("521>512:66.5000:proposed:manual 521>530:33.5000:proposed:manual 701>707:100.0000:proposed:manual");
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
