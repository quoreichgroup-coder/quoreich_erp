package com.quoreich.qerp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * V120 — piste d'audit du grand livre chaînée en SHA-256 : chaîne intacte au fil des écritures (y compris deux
 * comptabilisations simultanées), journal intangible, et toute altération faite en contournant la garde (contenu
 * modifié, événement supprimé) détectée par gl_audit_chain_breaks et le contrôle d'intégrité AUDIT_CHAIN.
 */
@SpringBootTest
class PisteAuditChaineeIT {

  private static final String DATABASE = "qerp_it_piste_audit_chainee";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String ADMIN = PostgresFixture.ALPHA_USER;

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.applySyscohada(DATABASE, A);
    PostgresFixture.grantRoles(DATABASE, ADMIN, "admin", A);
  }

  private static String texte(String sql) {
    return PostgresFixture.textAsAdmin(DATABASE, sql);
  }

  private static String compte(String code) {
    return texte("SELECT id::text FROM gl_accounts WHERE tenant_id = '" + A + "' AND code = '" + code + "'");
  }

  /** Écriture saisie en brouillon, lignes, puis comptabilisée : deux événements d'audit (Created, Posted). */
  private static void ecriture(int montant) {
    String e = UUID.randomUUID().toString();
    PostgresFixture.execute(PostgresFixture.urlOf(DATABASE),
        "INSERT INTO journal_entries (id, tenant_id, entry_number, entry_date, description, source, status, created_by) VALUES ('" + e + "', '" + A
            + "', 'JE-V120-" + e.substring(0, 8) + "', CURRENT_DATE, 'Pièce V120', 'manual', 'draft', '" + ADMIN + "');"
            + "INSERT INTO journal_lines (entry_id, account_id, debit, credit) VALUES ('" + e + "', '" + compte("601") + "', " + montant + ", 0), ('" + e
            + "', '" + compte("521") + "', 0, " + montant + ");"
            + "UPDATE journal_entries SET status = 'posted' WHERE id = '" + e + "'");
  }

  private static List<String> ruptures() throws SQLException {
    try (Connection c = DriverManager.getConnection(PostgresFixture.urlOf(DATABASE), PostgresFixture.API_USER, PostgresFixture.API_PASSWORD)) {
      c.setAutoCommit(false);
      try (PreparedStatement claims = c.prepareStatement("SELECT set_config('request.jwt.claims', ?, true)")) {
        claims.setString(1, "{\"sub\":\"" + ADMIN + "\",\"role\":\"authenticated\"}");
        claims.execute();
      }
      List<String> out = new ArrayList<>();
      try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery("SELECT seq || ' ' || problem FROM gl_audit_chain_breaks()")) {
        while (rs.next()) out.add(rs.getString(1));
      }
      try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery("SELECT status || ' ' || issues FROM gl_integrity_checks() WHERE check_code = 'AUDIT_CHAIN'")) {
        out.add("controle " + (rs.next() ? rs.getString(1) : "absent"));
      }
      c.commit();
      return out;
    }
  }

  @Test
  @DisplayName("chaîne intacte (écritures successives et simultanées), journal intangible, altérations détectées")
  void chaineEtAlterations() throws Exception {
    for (int i = 0; i < 3; i++) ecriture(1000 + i);
    CompletableFuture<Void> a = CompletableFuture.runAsync(() -> ecriture(5000));
    CompletableFuture<Void> b = CompletableFuture.runAsync(() -> ecriture(6000));
    CompletableFuture.allOf(a, b).get();

    assertThat(texte("SELECT count(*)::text FROM gl_audit_logs WHERE tenant_id = '" + A + "' AND details LIKE '%V120%' OR (tenant_id = '" + A + "' AND action = 'Posted')"))
        .isNotEqualTo("0");
    assertThat(texte("SELECT bool_and(length(hash) = 64 AND hash_version = 2)::text FROM gl_audit_logs WHERE tenant_id = '" + A + "'")).isEqualTo("true");
    assertThat(texte("SELECT (snapshot ->> 'total_debit')::numeric::int::text FROM gl_audit_logs WHERE tenant_id = '" + A
        + "' AND action = 'Posted' ORDER BY seq DESC LIMIT 1")).isIn("5000", "6000");
    assertThat(ruptures()).as("chaîne intacte, simultanéité comprise").containsExactly("controle pass 0");

    assertThatThrownBy(() -> PostgresFixture.execute(PostgresFixture.urlOf(DATABASE),
        "UPDATE gl_audit_logs SET details = 'falsifié' WHERE tenant_id = '" + A + "'"))
        .as("même le propriétaire de la base").hasMessageContaining("intangible");
    assertThatThrownBy(() -> PostgresFixture.execute(PostgresFixture.urlOf(DATABASE), "DELETE FROM gl_audit_logs WHERE tenant_id = '" + A + "'"))
        .hasMessageContaining("intangible");

    // Altération en contournant la garde (désactivation du déclencheur) : détectée.
    String cible = texte("SELECT seq::text FROM gl_audit_logs WHERE tenant_id = '" + A + "' AND action = 'Posted' ORDER BY seq LIMIT 1");
    PostgresFixture.execute(PostgresFixture.urlOf(DATABASE), "ALTER TABLE gl_audit_logs DISABLE TRIGGER trg_guard_gl_audit_log;"
        + "UPDATE gl_audit_logs SET details = 'Posted to GL by quelqu''un d''autre' WHERE seq = " + cible + ";"
        + "ALTER TABLE gl_audit_logs ENABLE TRIGGER trg_guard_gl_audit_log");
    List<String> r = ruptures();
    assertThat(r).anyMatch(x -> x.startsWith(cible + " Contenu modifié"));
    assertThat(r).contains("controle fail 1");

    String supprime = texte("SELECT seq::text FROM gl_audit_logs WHERE tenant_id = '" + A + "' ORDER BY seq DESC OFFSET 1 LIMIT 1");
    PostgresFixture.execute(PostgresFixture.urlOf(DATABASE), "ALTER TABLE gl_audit_logs DISABLE TRIGGER trg_guard_gl_audit_log;"
        + "DELETE FROM gl_audit_logs WHERE seq = " + supprime + ";"
        + "ALTER TABLE gl_audit_logs ENABLE TRIGGER trg_guard_gl_audit_log");
    assertThat(ruptures()).anyMatch(x -> x.contains("Lien rompu"));
  }
}
