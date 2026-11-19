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
 * V106 — contrôles du grand livre : anomalies paramétrées (seuil, doublons, séparation des tâches,
 * antidatage), examen tracé, intégrité, concordance clients / comptes collectifs, piste d'audit
 * en lecture seule, paramètres réservés au droit du catalogue.
 */
@SpringBootTest
class ControlesGrandLivreIT {

  private static final String DATABASE = "qerp_it_controles_gl";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String COMPTABLE = PostgresFixture.ALPHA_USER;
  private static final String LECTEUR = "aaaaaaaa-0000-0000-0000-0000000106e9";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.applySyscohada(DATABASE, A);
    owner("INSERT INTO auth.users (id) VALUES ('" + LECTEUR + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + LECTEUR + "', '" + A + "', 'Lecteur') ON CONFLICT (id) DO NOTHING");
    PostgresFixture.grantRoles(DATABASE, COMPTABLE, "accountant", A, LECTEUR, "viewer", A);
  }

  private static String compte(String code) {
    return texte("SELECT id::text FROM gl_accounts WHERE tenant_id = '" + A + "' AND code = '" + code + "'");
  }

  /** Écriture manuelle comptabilisée (saisie et comptabilisée par le comptable, ou par personne). */
  private static String ecriture(String libelle, String date, int montant, boolean memePersonne) {
    String e = UUID.randomUUID().toString();
    owner("INSERT INTO journal_entries (id, tenant_id, entry_number, entry_date, description, source, status, created_by) VALUES ('" + e + "', '" + A
        + "', 'JE-106-" + e.substring(0, 8) + "', '" + date + "', '" + libelle + "', 'manual', 'draft', '" + COMPTABLE + "');"
        + "INSERT INTO journal_lines (entry_id, account_id, debit, credit) VALUES ('" + e + "', '" + compte("601") + "', " + montant + ", 0), ('" + e + "', '"
        + compte("521") + "', 0, " + montant + ");"
        + "UPDATE journal_entries SET status = 'posted', posted_at = now(), posted_by = " + (memePersonne ? "created_by" : "NULL") + " WHERE id = '" + e + "'");
    return e;
  }

  private static String constats(String entry) throws SQLException {
    return asUser(COMPTABLE, "SELECT string_agg(check_code || ':' || reviewed::text, ' ' ORDER BY check_code) FROM gl_control_findings('2000-01-01', '2100-12-31')"
        + " WHERE entry_id = '" + entry + "'");
  }

  @Test
  @DisplayName("anomalies paramétrées : doublon, même personne, seuil seulement s'il est fixé, antidatage ; examen tracé ; contrôle désactivable")
  void anomaliesParametrees() throws SQLException {
    String e1 = ecriture("Loyer janvier", "2040-01-10", 300000, true);
    String e2 = ecriture("Loyer janvier", "2040-01-11", 300000, false);
    String e3 = ecriture("Régularisation ancienne", java.time.LocalDate.now().minusDays(60).toString(), 1000, false);
    assertThat(constats(e1)).as("doublon + saisie et comptabilisation par la même personne ; aucun seuil fixé").isEqualTo("DUPLICATE:false SOD:false");
    assertThat(constats(e2)).isEqualTo("DUPLICATE:false");
    assertThat(constats(e3)).as("antidatage désactivé tant qu'aucun délai n'est fixé").isNull();

    asUser(COMPTABLE, "INSERT INTO gl_control_settings (tenant_id, large_entry_threshold, backdating_days) VALUES (get_user_tenant_id(auth.uid()), 250000, 30)"
        + " RETURNING tenant_id::text");
    assertThat(constats(e2)).as("seuil fixé à 250 000").isEqualTo("DUPLICATE:false LARGE_ENTRY:false");
    assertThat(constats(e3)).as("comptabilisée 60 jours après la date de pièce, délai 30").isEqualTo("BACKDATED:false");

    asUser(COMPTABLE, "INSERT INTO gl_control_reviews (tenant_id, check_code, entry_id, comment) VALUES (get_user_tenant_id(auth.uid()), 'DUPLICATE', '"
        + e2 + "', 'Deux baux distincts') RETURNING id::text");
    assertThat(constats(e2)).contains("DUPLICATE:true");
    assertThatThrownBy(() -> asUser(LECTEUR, "INSERT INTO gl_control_reviews (tenant_id, check_code, entry_id, comment) VALUES (get_user_tenant_id(auth.uid()),"
        + " 'SOD', '" + e1 + "', 'x') RETURNING id::text")).hasMessageContaining("row-level security");

    asUser(COMPTABLE, "UPDATE gl_control_settings SET disabled_checks = ARRAY['DUPLICATE', 'BACKDATED'] WHERE tenant_id = get_user_tenant_id(auth.uid()) RETURNING tenant_id::text");
    assertThat(constats(e2)).isEqualTo("LARGE_ENTRY:false");
    assertThat(asUser(LECTEUR, "SELECT count(*)::text FROM gl_control_settings WHERE tenant_id = get_user_tenant_id(auth.uid())")).isEqualTo("1");
    assertThat(asUser(LECTEUR, "UPDATE gl_control_settings SET large_entry_threshold = NULL WHERE tenant_id = get_user_tenant_id(auth.uid()) RETURNING 1"))
        .as("paramètres réservés au droit accounting.controls").isNull();
  }

  @Test
  @DisplayName("intégrité réussie, concordance clients au centime, piste d'audit non effaçable par un membre")
  void integriteEtConcordance() throws SQLException {
    String f = asUser(COMPTABLE, "INSERT INTO ar_invoices (tenant_id, invoice_number, customer_id, due_date, subtotal, tax_amount, status, created_by)"
        + " VALUES (get_user_tenant_id(auth.uid()), 'F106-1', (SELECT id FROM customers WHERE tenant_id = get_user_tenant_id(auth.uid()) LIMIT 1),"
        + " CURRENT_DATE + 30, 70000, 0, 'draft', auth.uid()) RETURNING id::text");
    asUser(COMPTABLE, "UPDATE ar_invoices SET status = 'sent' WHERE id = '" + f + "' RETURNING id::text");
    assertThat(asUser(COMPTABLE, "SELECT string_agg(check_code || ':' || status, ' ' ORDER BY check_code) FROM gl_integrity_checks()"
        + " WHERE check_code IN ('BALANCED', 'NOT_EMPTY', 'SUBLEDGER_LINKS')")).isEqualTo("BALANCED:pass NOT_EMPTY:pass SUBLEDGER_LINKS:pass");
    String ar = asUser(COMPTABLE, "SELECT subledger::text || ' ' || ledger::text || ' ' || status FROM gl_subledger_reconciliation() WHERE area = 'AR'");
    String[] p = ar.split(" ");
    assertThat(p[0]).as("livre clients = solde des comptes clients").isEqualTo(p[1]);
    assertThat(p[2]).isEqualTo("pass");

    int avant = Integer.parseInt(texte("SELECT count(*) FROM gl_audit_logs WHERE tenant_id = '" + A + "'"));
    assertThat(avant).isPositive();
    assertThatThrownBy(() -> asUser(LECTEUR, "DELETE FROM gl_audit_logs WHERE tenant_id = get_user_tenant_id(auth.uid()) RETURNING 1"))
        .hasMessageContaining("permission denied");
    assertThatThrownBy(() -> asUser(COMPTABLE, "UPDATE gl_audit_logs SET details = 'x' WHERE tenant_id = get_user_tenant_id(auth.uid()) RETURNING 1"))
        .hasMessageContaining("permission denied");
    assertThat(Integer.parseInt(texte("SELECT count(*) FROM gl_audit_logs WHERE tenant_id = '" + A + "'"))).isEqualTo(avant);
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
