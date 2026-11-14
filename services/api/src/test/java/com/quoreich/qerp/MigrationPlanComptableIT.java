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
 * V67 (PC-6) — migration du plan opérationnel : correspondance validée obligatoire, simulation sans
 * effet, application par une autre personne, plan recalculé identique, une écriture OD équilibrée,
 * rôles redirigés, anciens comptes conservés et reliés, historique intact, référentiel mis à jour.
 */
@SpringBootTest
class MigrationPlanComptableIT {

  private static final String DATABASE = "qerp_it_migration_plan";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String COMPTABLE = PostgresFixture.ALPHA_USER;
  private static final String CHEF = "aaaaaaaa-6767-0000-0000-000000000067";
  private static final String DIRECTEUR = "aaaaaaaa-6767-0000-0000-000000000068";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.applySyscohada(DATABASE, A);
    owner("INSERT INTO auth.users (id) VALUES ('" + CHEF + "'), ('" + DIRECTEUR + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + CHEF + "', '" + A + "', 'Chef comptable'), ('" + DIRECTEUR + "', '" + A
        + "', 'Directeur financier') ON CONFLICT (id) DO NOTHING");
    PostgresFixture.grantRoles(DATABASE, COMPTABLE, "accountant", A, CHEF, "admin", A, DIRECTEUR, "admin", A);
  }

  private static String compte(String code) {
    return texte("SELECT id::text FROM gl_accounts WHERE tenant_id = '" + A + "' AND code = '" + code + "'");
  }

  private static void ecriture(String date, String debit, String credit, int montant) {
    String e = UUID.randomUUID().toString();
    owner("INSERT INTO journal_entries (id, tenant_id, entry_number, entry_date, description, source, status, created_by) VALUES ('" + e + "', '" + A
        + "', 'JE-V67-" + e.substring(0, 6) + "', '" + date + "', 'Essai V67', 'manual', 'draft', '" + COMPTABLE + "');"
        + "INSERT INTO journal_lines (entry_id, account_id, debit, credit) VALUES ('" + e + "', '" + compte(debit) + "', " + montant + ", 0), ('" + e + "', '"
        + compte(credit) + "', 0, " + montant + "); UPDATE journal_entries SET status = 'posted' WHERE id = '" + e + "'");
  }

  private static String solde(String code) {
    return texte("SELECT COALESCE(sum(l.debit - l.credit), 0)::text FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN gl_accounts g ON g.id = l.account_id"
        + " WHERE g.tenant_id = '" + A + "' AND g.code = '" + code + "' AND e.status IN ('posted', 'reversed')");
  }

  @Test
  @DisplayName("SYSCOHADA → PCG : simulation, séparation des tâches, OD de reclassement, rôles redirigés, historique intact")
  void migration() throws SQLException {
    ecriture("2035-03-10", "521", "701", 1000);
    ecriture("2035-03-11", "411", "701", 500);
    String lignes521 = texte("SELECT count(*)::text FROM journal_lines WHERE account_id = '" + compte("521") + "'");

    String m = asUser(COMPTABLE, "SELECT create_chart_mapping('SYSCOHADA vers PCG', 'PCG_FR', NULL)::text");
    asUser(COMPTABLE, "SELECT set_chart_mapping_lines('" + m + "', '" + compte("521") + "', '[{\"code\":\"512\",\"ratio\":100}]')::text");
    asUser(COMPTABLE, "SELECT set_chart_mapping_lines('" + m + "', '" + compte("701") + "', '[{\"code\":\"707\",\"ratio\":70},{\"code\":\"706\",\"ratio\":30}]')::text");
    asUser(COMPTABLE, "SELECT set_chart_mapping_lines('" + m + "', '" + compte("411") + "', '[{\"code\":\"411\",\"ratio\":100}]')::text");
    assertThatThrownBy(() -> asUser(CHEF, "SELECT simulate_chart_migration('" + m + "', '2035-03-31', 'Passage au PCG')::text"))
        .as("correspondance validée obligatoire").hasMessageContaining("validée");
    asUser(CHEF, "SELECT decide_chart_mapping_lines('" + m + "', array_agg(id), true)::text FROM chart_mapping_lines WHERE mapping_id = '" + m + "'");
    // Les autres comptes mouvementés du jeu de référence restent sous leur code.
    asUser(COMPTABLE, "SELECT count(set_chart_mapping_lines('" + m + "', c.source_account_id, ('[{\"code\":\"' || "
        + "COALESCE((SELECT r.code FROM framework_reference_accounts r WHERE r.framework_code = 'PCG_FR' AND c.source_code LIKE r.code || '%' AND length(r.code) > 1 ORDER BY length(r.code) DESC LIMIT 1), '47')"
        + " || '\",\"ratio\":100}]')::jsonb))::text FROM compare_chart_mapping('" + m + "') c WHERE c.finding = 'Compte non couvert' AND c.lines > 0");
    asUser(CHEF, "SELECT decide_chart_mapping_lines('" + m + "', array_agg(id), true)::text FROM chart_mapping_lines WHERE mapping_id = '" + m + "' AND status = 'proposed'");
    asUser(CHEF, "SELECT validate_chart_mapping('" + m + "')::text");

    assertThatThrownBy(() -> asUser(COMPTABLE, "SELECT simulate_chart_migration('" + m + "', '2035-03-31', 'Passage au PCG')::text")).hasMessageContaining("Droit insuffisant");
    String sim = asUser(CHEF, "SELECT simulate_chart_migration('" + m + "', '2035-03-31', 'Passage au PCG')::text");
    assertThat(texte("SELECT string_agg((x ->> 'source_code') || '>' || (x ->> 'target_code') || ':' || (x ->> 'action') || ':' || (x ->> 'moved'), ' ' ORDER BY x ->> 'source_code', x ->> 'target_code')"
        + " FROM chart_migrations, jsonb_array_elements(plan) x WHERE id = '" + sim + "' AND x ->> 'source_code' IN ('411', '521', '701')"))
        .as("plan : même code, compte à créer ou réutilisé (706 existe), répartition avec arrondi sur la dernière cible")
        .isEqualTo("411>411:same:0 521>512:create:" + solde("521") + " 701>706:reuse:" + part(solde("701"), 30) + " 701>707:create:"
            + new java.math.BigDecimal(solde("701")).subtract(new java.math.BigDecimal(part(solde("701"), 30))).toPlainString());
    assertThat(compte("512")).as("simulation : rien n'est créé").isNull();

    assertThatThrownBy(() -> asUser(CHEF, "SELECT apply_chart_migration('" + sim + "')::text")).hasMessageContaining("autre personne");
    ecriture("2035-03-20", "521", "701", 10);
    String total701 = solde("701");
    assertThatThrownBy(() -> asUser(DIRECTEUR, "SELECT apply_chart_migration('" + sim + "')::text")).as("soldes changés").hasMessageContaining("simuler à nouveau");

    String sim2 = asUser(CHEF, "SELECT simulate_chart_migration('" + m + "', '2035-03-31', 'Passage au PCG')::text");
    assertThat(texte("SELECT status FROM chart_migrations WHERE id = '" + sim + "'")).isEqualTo("cancelled");
    String bilan = asUser(DIRECTEUR, "SELECT apply_chart_migration('" + sim2 + "')::text");
    assertThat(bilan).contains("\"referentiel\": \"PCG_FR\"");

    String od = texte("SELECT entry_id::text FROM chart_migrations WHERE id = '" + sim2 + "'");
    assertThat(texte("SELECT (sum(debit) = sum(credit))::text || ' ' || source FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE e.id = '" + od + "' GROUP BY source"))
        .isEqualTo("true reclassification");
    assertThat(solde("521") + " " + solde("701") + " " + solde("707") + " " + solde("706")).as("comptes migrés soldés, répartition 70 / 30")
        .isEqualTo("0.00 0.00 " + new java.math.BigDecimal(total701).subtract(new java.math.BigDecimal(part(total701, 30))).toPlainString() + " " + part(total701, 30));
    assertThat(texte("SELECT count(*)::text FROM journal_lines WHERE account_id = '" + compte("521") + "'"))
        .as("historique intact : une ligne de plus (l'OD), aucune modifiée").isEqualTo(String.valueOf(Integer.parseInt(lignes521) + 2));
    assertThat(texte("SELECT g.code FROM tenant_posting_accounts t JOIN gl_accounts g ON g.id = t.gl_account_id WHERE t.tenant_id = '" + A + "' AND t.role_code = 'BANK'"))
        .isEqualTo("512");
    assertThat(texte("SELECT o.is_active || ' ' || n.code FROM gl_accounts o JOIN gl_accounts n ON n.id = o.replaced_by WHERE o.id = '" + compte("701") + "'"))
        .isEqualTo("false 707");
    assertThat(texte("SELECT s.framework_code || ' ' || c.framework_code || ' ' || c.framework_version FROM tenant_accounting_settings s JOIN charts c ON c.tenant_id = s.tenant_id"
        + " AND c.kind = 'operational' WHERE s.tenant_id = '" + A + "'")).isEqualTo("PCG_FR PCG_FR 2025");
    assertThatThrownBy(() -> asUser(DIRECTEUR, "SELECT apply_chart_migration('" + sim2 + "')::text")).hasMessageContaining("simulation en cours");
  }

  private static String part(String montant, int pct) {
    return new java.math.BigDecimal(montant).multiply(java.math.BigDecimal.valueOf(pct)).divide(java.math.BigDecimal.valueOf(100), 2, java.math.RoundingMode.HALF_UP).toPlainString();
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
