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
 * V113 — risques (registre, évaluation datée inhérent / résiduel sur l'échelle de la société, traitement,
 * actions, clôture motivée) et conformité (référentiels, contrôles dont l'état vient des tests, constats
 * clôturés par une autre personne) ; gardes et droits du catalogue.
 */
@SpringBootTest
class ConformiteRisquesIT {

  private static final String DATABASE = "qerp_it_conformite_risques";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String RISQUES = "aaaaaaaa-0000-0000-0000-0000000113a1";
  private static final String EVALUATEUR = "aaaaaaaa-0000-0000-0000-0000000113a2";
  private static final String OFFICIER = "aaaaaaaa-0000-0000-0000-0000000113c1";
  private static final String AUDITEUR = "aaaaaaaa-0000-0000-0000-0000000113c2";
  private static final String LECTEUR = "aaaaaaaa-0000-0000-0000-0000000113e9";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    StringBuilder sql = new StringBuilder();
    for (String u : new String[] {RISQUES, EVALUATEUR, OFFICIER, AUDITEUR, LECTEUR}) {
      sql.append("INSERT INTO auth.users (id) VALUES ('").append(u).append("') ON CONFLICT DO NOTHING;")
          .append("INSERT INTO profiles (id, tenant_id, full_name) VALUES ('").append(u).append("', '").append(A).append("', 'U') ON CONFLICT (id) DO NOTHING;");
    }
    owner(sql.toString());
    PostgresFixture.grantRoles(DATABASE, RISQUES, "risk_admin", A, EVALUATEUR, "risk_assessor", A, OFFICIER, "compliance_officer", A,
        AUDITEUR, "compliance_auditor", A, LECTEUR, "viewer", A);
  }

  @Test
  @DisplayName("risque : création identifiée, cotation par évaluation datée, traitement, actions, clôture motivée")
  void risques() throws SQLException {
    String r = asUser(RISQUES, "INSERT INTO risk_register (tenant_id, risk_code, title, category, likelihood, impact, status) VALUES (get_user_tenant_id(auth.uid()), "
        + "'R-001', 'Rupture fournisseur', 'Opérationnel', 4, 5, 'closed') RETURNING id::text");
    assertThat(texte("SELECT status || ' ' || risk_score FROM risk_register WHERE id = '" + r + "'")).as("statut imposé").isEqualTo("identified 20");
    assertThatThrownBy(() -> asUser(RISQUES, "UPDATE risk_register SET likelihood = 1 WHERE id = '" + r + "' RETURNING id"))
        .hasMessageContaining("Évaluer");
    assertThatThrownBy(() -> asUser(RISQUES, "INSERT INTO risk_register (tenant_id, risk_code, title, category, likelihood, impact) VALUES (get_user_tenant_id(auth.uid()), "
        + "'R-002', 'x', 'y', 6, 1) RETURNING id")).hasMessageContaining("échelle");
    assertThatThrownBy(() -> asUser(LECTEUR, "INSERT INTO risk_register (tenant_id, risk_code, title, category) VALUES (get_user_tenant_id(auth.uid()), 'R-9', 'x', 'y') RETURNING id"))
        .hasMessageContaining("row-level security");
    assertThatThrownBy(() -> asUser(RISQUES, "SELECT risk_set_status('" + r + "', 'treating', 'reduce', NULL)")).hasMessageContaining("Évaluer le risque");
    assertThatThrownBy(() -> asUser(LECTEUR, "SELECT risk_assess('" + r + "', 4, 5, 2, 3, NULL)")).hasMessageContaining("risks.assess");
    assertThatThrownBy(() -> asUser(EVALUATEUR, "SELECT risk_assess('" + r + "', 2, 2, 3, 3, NULL)")).hasMessageContaining("résiduel");
    asUser(EVALUATEUR, "SELECT risk_assess('" + r + "', 4, 5, 2, 3, 'Fournisseur unique')");
    assertThat(texte("SELECT status || ' ' || risk_score || ' ' || residual_score FROM risk_register WHERE id = '" + r + "'")).isEqualTo("assessed 20 6");
    assertThat(texte("SELECT count(*) || ' ' || max(residual_impact) FROM risk_assessments WHERE risk_id = '" + r + "'")).isEqualTo("1 3");
    assertThatThrownBy(() -> asUser(EVALUATEUR, "DELETE FROM risk_assessments WHERE risk_id = '" + r + "' RETURNING id")).hasMessageContaining("permission denied");

    asUser(RISQUES, "SELECT risk_set_status('" + r + "', 'treating', 'reduce', NULL)");
    String act = asUser(RISQUES, "INSERT INTO risk_actions (tenant_id, risk_id, title, due_date) VALUES (get_user_tenant_id(auth.uid()), '" + r + "', 'Second fournisseur', CURRENT_DATE + 30) RETURNING id::text");
    assertThatThrownBy(() -> asUser(RISQUES, "SELECT risk_set_status('" + r + "', 'closed', NULL, 'Traité')")).hasMessageContaining("actions");
    asUser(RISQUES, "UPDATE risk_actions SET status = 'done', done_at = now() WHERE id = '" + act + "' RETURNING id");
    assertThatThrownBy(() -> asUser(RISQUES, "SELECT risk_set_status('" + r + "', 'closed', NULL, NULL)")).hasMessageContaining("Motif");
    asUser(RISQUES, "SELECT risk_set_status('" + r + "', 'closed', NULL, 'Second fournisseur référencé')");
    assertThat(texte("SELECT status || ' ' || treatment || ' ' || (closed_at IS NOT NULL) FROM risk_register WHERE id = '" + r + "'")).isEqualTo("closed reduce true");
    assertThatThrownBy(() -> asUser(EVALUATEUR, "SELECT risk_assess('" + r + "', 1, 1, NULL, NULL, NULL)")).hasMessageContaining("clôturé");

    // Échelle paramétrée : 1 à 3.
    asUser(RISQUES, "INSERT INTO risk_settings (tenant_id, scale_max, medium_from, high_from, critical_from, review_days) VALUES (get_user_tenant_id(auth.uid()), 3, 2, 4, 6, 90) RETURNING tenant_id");
    String r2 = asUser(RISQUES, "INSERT INTO risk_register (tenant_id, risk_code, title, category, likelihood, impact) VALUES (get_user_tenant_id(auth.uid()), 'R-003', 'Fraude', 'Fraude', 2, 2) RETURNING id::text");
    assertThatThrownBy(() -> asUser(EVALUATEUR, "SELECT risk_assess('" + r2 + "', 4, 3, NULL, NULL, NULL)")).hasMessageContaining("1 à 3");
    asUser(EVALUATEUR, "SELECT risk_assess('" + r2 + "', 3, 3, NULL, NULL, NULL)");
    assertThat(texte("SELECT review_date - CURRENT_DATE FROM risk_register WHERE id = '" + r2 + "'")).as("revue périodique").isEqualTo("90");
    assertThat(asUser(EVALUATEUR, "WITH u AS (UPDATE risk_settings SET scale_max = 5 RETURNING 1) SELECT count(*)::text FROM u")).as("paramètres : risks.settings").isEqualTo("0");
  }

  @Test
  @DisplayName("conformité : l'état d'un contrôle vient de ses tests ; constat clôturé par une autre personne, avec remédiation")
  void conformite() throws SQLException {
    String f = asUser(OFFICIER, "INSERT INTO compliance_frameworks (tenant_id, name, version) VALUES (get_user_tenant_id(auth.uid()), 'Contrôle interne', '2026') RETURNING id::text");
    String c = asUser(OFFICIER, "INSERT INTO compliance_controls (framework_id, control_code, title, status, frequency) VALUES ('" + f + "', 'CI-01', 'Séparation des tâches achats', 'effective', 'quarterly') RETURNING id::text");
    assertThat(texte("SELECT status || ' ' || tenant_id FROM compliance_controls WHERE id = '" + c + "'")).isEqualTo("not_tested " + A);
    assertThat(texte("SELECT total_controls || '/' || compliant_controls FROM compliance_frameworks WHERE id = '" + f + "'")).isEqualTo("1/0");
    assertThatThrownBy(() -> asUser(OFFICIER, "UPDATE compliance_controls SET status = 'effective' WHERE id = '" + c + "' RETURNING id")).hasMessageContaining("tests");
    assertThatThrownBy(() -> asUser(LECTEUR, "SELECT compliance_record_test('" + c + "', CURRENT_DATE, 'pass')")).hasMessageContaining("compliance.test");
    assertThatThrownBy(() -> asUser(OFFICIER, "SELECT compliance_record_test('" + c + "', CURRENT_DATE, 'fail')")).hasMessageContaining("Décrire");
    asUser(OFFICIER, "SELECT compliance_record_test('" + c + "', DATE '2026-01-15', 'fail', 2, 'Deux commandes approuvées par leur auteur', 'Approbations par l''auteur', 'high', NULL, NULL)");
    assertThat(texte("SELECT status || ' ' || next_review_at FROM compliance_controls WHERE id = '" + c + "'")).isEqualTo("deficient 2026-04-15");
    String i = texte("SELECT id::text FROM compliance_issues WHERE control_id = '" + c + "'");
    assertThat(texte("SELECT status || ' ' || severity FROM compliance_issues WHERE id = '" + i + "'")).isEqualTo("open high");
    assertThatThrownBy(() -> asUser(OFFICIER, "UPDATE compliance_issues SET status = 'closed' WHERE id = '" + i + "' RETURNING id")).hasMessageContaining("permission denied");
    assertThatThrownBy(() -> asUser(OFFICIER, "SELECT compliance_issue_update('" + i + "', 'closed', 'ok')")).hasMessageContaining("close_issue");
    assertThatThrownBy(() -> asUser(AUDITEUR, "SELECT compliance_issue_update('" + i + "', 'closed', NULL)")).hasMessageContaining("remédiation");
    asUser(AUDITEUR, "SELECT compliance_issue_update('" + i + "', 'closed', 'Contrôle bloquant ajouté (V39)')");
    assertThat(texte("SELECT status || ' ' || (closed_by = '" + AUDITEUR + "') FROM compliance_issues WHERE id = '" + i + "'")).isEqualTo("closed true");

    asUser(AUDITEUR, "SELECT compliance_record_test('" + c + "', CURRENT_DATE, 'partial', 1, 'Un écart mineur', 'Écart mineur', 'low', NULL, NULL)");
    String i2 = texte("SELECT id::text FROM compliance_issues WHERE control_id = '" + c + "' AND status = 'open'");
    assertThatThrownBy(() -> asUser(AUDITEUR, "SELECT compliance_issue_update('" + i2 + "', 'closed', 'corrigé')")).hasMessageContaining("autre personne");
    asUser(AUDITEUR, "SELECT compliance_record_test('" + c + "', CURRENT_DATE, 'pass')");
    assertThat(texte("SELECT total_controls || '/' || compliant_controls FROM compliance_frameworks WHERE id = '" + f + "'")).isEqualTo("1/1");
    assertThat(texte("SELECT count(*) FROM compliance_test_logs WHERE control_id = '" + c + "'")).isEqualTo("3");

    // Risque couvert par le contrôle.
    String r = asUser(RISQUES, "INSERT INTO risk_register (tenant_id, risk_code, title, category) VALUES (get_user_tenant_id(auth.uid()), 'R-100', 'Fraude achats', 'Fraude') RETURNING id::text");
    asUser(RISQUES, "INSERT INTO risk_control_links (tenant_id, risk_id, control_id) VALUES (get_user_tenant_id(auth.uid()), '" + r + "', '" + c + "') RETURNING risk_id");
    assertThat(texte("SELECT count(*) FROM risk_control_links WHERE risk_id = '" + r + "'")).isEqualTo("1");
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
