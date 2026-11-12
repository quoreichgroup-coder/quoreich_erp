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
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Axes analytiques (V19) : sections, règles par compte, valeurs par défaut, contrôle à la
 * comptabilisation (QG002), contre-passation, isolation.
 *
 * <p>Écritures jouées sous le rôle applicatif avec les claims du porteur (RLS réelle) ; constats
 * en propriétaire. La société Alpha a un axe « Département » obligatoire sur la classe 7 et
 * interdit sur la classe 4.
 */
@SpringBootTest
class AxesAnalytiquesIT {

  private static final String DATABASE = "qerp_it_analytique";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String B = PostgresFixture.BETA_TENANT;
  private static final String ADMIN = PostgresFixture.ALPHA_USER;
  private static final String COMPTABLE = "aaaaaaaa-0000-0000-0000-000000000005";
  private static final String BETA = PostgresFixture.BETA_USER;
  private static final String CLIENT_SANS_DEFAUT = "c0000001-0000-0000-0000-000000000000";
  private static final String CLIENT_AVEC_DEFAUT = "c0000002-0000-0000-0000-000000000000";

  private static final String DEPT = "d0000000-0000-0000-0000-0000000000a1";
  private static final String COM = "d0000000-0000-0000-0000-0000000000b1";
  private static final String PROD = "d0000000-0000-0000-0000-0000000000b2";
  private static final String ANCIEN = "d0000000-0000-0000-0000-0000000000b3";
  private static final String FUTUR = "d0000000-0000-0000-0000-0000000000b4";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.applySyscohada(DATABASE, A);
    PostgresFixture.applySyscohada(DATABASE, B);
    owner(
        "INSERT INTO auth.users (id) VALUES ('" + COMPTABLE + "') ON CONFLICT DO NOTHING;"
            + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + COMPTABLE + "', '" + A
            + "', 'Comptable Alpha') ON CONFLICT (id) DO NOTHING;"
            + "INSERT INTO user_roles (user_id, role, tenant_id) SELECT v.u::uuid, v.r::app_role,"
            + " v.t::uuid FROM (VALUES ('" + ADMIN + "', 'admin', '" + A + "'), ('" + COMPTABLE
            + "', 'accountant', '" + A + "'), ('" + BETA + "', 'admin', '" + B + "')) AS v(u, r, t)"
            + " WHERE NOT EXISTS (SELECT 1 FROM user_roles x WHERE x.user_id = v.u::uuid"
            + " AND x.role = v.r::app_role);"
            + "INSERT INTO analytic_axes (id, tenant_id, code, name) VALUES ('" + DEPT + "', '" + A
            + "', 'DEPT', 'Département') ON CONFLICT DO NOTHING;"
            + "INSERT INTO analytic_values (id, tenant_id, axis_id, code, name, is_active, valid_from)"
            + " VALUES ('" + COM + "', '" + A + "', '" + DEPT + "', 'COM', 'Commercial', true, NULL),"
            + " ('" + PROD + "', '" + A + "', '" + DEPT + "', 'PROD', 'Production', true, NULL),"
            + " ('" + ANCIEN + "', '" + A + "', '" + DEPT + "', 'ANC', 'Ancien service', false, NULL),"
            + " ('" + FUTUR + "', '" + A + "', '" + DEPT + "', 'FUT', 'Futur service', true, '2031-01-01')"
            + " ON CONFLICT DO NOTHING;"
            + "INSERT INTO analytic_rules (tenant_id, axis_id, account_prefix, requirement) VALUES"
            + " ('" + A + "', '" + DEPT + "', '7', 'required'), ('" + A + "', '" + DEPT
            + "', '4', 'forbidden') ON CONFLICT DO NOTHING;"
            + "INSERT INTO analytic_defaults (tenant_id, customer_id, axis_id, value_id) VALUES ('" + A
            + "', '" + CLIENT_AVEC_DEFAUT + "', '" + DEPT + "', '" + COM + "') ON CONFLICT DO NOTHING");
  }

  // ─── Factures clients ───

  private static String factureEmise(String user, String customer, String numero) throws SQLException {
    String id = UUID.randomUUID().toString();
    asUser(user,
        "INSERT INTO ar_invoices (id, invoice_number, customer_id, invoice_date, due_date, subtotal,"
            + " tax_amount, total, tenant_id, created_by, status, amount_paid) VALUES ('" + id + "', '"
            + numero + "', '" + customer + "', '2030-05-02', '2030-06-02', 1000, 180, 1180,"
            + " get_user_tenant_id(auth.uid()), auth.uid(), 'sent', 0)");
    return id;
  }

  /** Comme l'API : brouillon, section choisie sur la facture, puis émission. */
  private static String factureAvecSection(String customer, String numero, String section) throws SQLException {
    String id = UUID.randomUUID().toString();
    asUser(COMPTABLE,
        "INSERT INTO ar_invoices (id, invoice_number, customer_id, invoice_date, due_date, subtotal,"
            + " tax_amount, tenant_id, created_by, status) VALUES ('" + id + "', '" + numero + "', '"
            + customer + "', '2030-05-02', '2030-06-02', 1000, 180, get_user_tenant_id(auth.uid()),"
            + " auth.uid(), 'draft');"
            + "INSERT INTO ar_invoice_analytics (tenant_id, invoice_id, axis_id, value_id) VALUES"
            + " (get_user_tenant_id(auth.uid()), '" + id + "', '" + DEPT + "', '" + section + "');"
            + "UPDATE ar_invoices SET status = 'sent' WHERE id = '" + id + "'");
    return id;
  }

  /** Imputation de chaque ligne de l'écriture d'une facture : « compte section ». */
  private static List<String> imputations(String factureId) {
    return rows(
        "SELECT g.code || ' ' || coalesce(v.code, '-') FROM ar_invoices i"
            + " JOIN journal_lines l ON l.entry_id = i.journal_entry_id"
            + " JOIN gl_accounts g ON g.id = l.account_id"
            + " LEFT JOIN journal_line_analytics la ON la.line_id = l.id"
            + " LEFT JOIN analytic_values v ON v.id = la.value_id"
            + " WHERE i.id = '" + factureId + "' ORDER BY g.code");
  }

  @Test
  @DisplayName("facture sans section alors que l'axe est obligatoire en classe 7 : refusée, rien créé")
  void factureSansSectionRefusee() {
    long avant = count("SELECT count(*) FROM ar_invoices");
    assertThatThrownBy(() -> factureEmise(ADMIN, CLIENT_SANS_DEFAUT, "ANA-SANS"))
        .isInstanceOfSatisfying(SQLException.class, e -> assertThat(e.getSQLState()).isEqualTo("QG002"))
        .hasMessageContaining("l'axe « Département » est obligatoire sur le compte 701");
    assertThat(count("SELECT count(*) FROM ar_invoices")).isEqualTo(avant);
  }

  @Test
  @DisplayName("section par défaut du client : portée par la seule ligne de produit")
  void sectionParDefautDuClient() throws Exception {
    String f = factureEmise(ADMIN, CLIENT_AVEC_DEFAUT, "ANA-DEFAUT");
    assertThat(imputations(f)).containsExactly("411 -", "4431 -", "701 COM");
  }

  @Test
  @DisplayName("section choisie sur la facture : prioritaire sur le défaut, puis figée à l'émission")
  void sectionDeLaFacturePrioritaire() throws Exception {
    String f = factureAvecSection(CLIENT_AVEC_DEFAUT, "ANA-CHOIX", PROD);
    assertThat(imputations(f)).containsExactly("411 -", "4431 -", "701 PROD");
    assertThatThrownBy(
            () -> asUser(COMPTABLE, "UPDATE ar_invoice_analytics SET value_id = '" + COM
                + "' WHERE invoice_id = '" + f + "'"))
        .hasMessageContaining("la facture n'est plus en brouillon");
  }

  @Test
  @DisplayName("section inactive, ou pas encore valide à la date : refusée")
  void sectionInutilisableRefusee() {
    for (String section : new String[] {ANCIEN, FUTUR}) {
      assertThatThrownBy(() -> factureAvecSection(CLIENT_SANS_DEFAUT, "ANA-" + section.substring(34), section))
          .isInstanceOfSatisfying(SQLException.class, e -> assertThat(e.getSQLState()).isEqualTo("QG002"))
          .hasMessageContaining("n'est pas utilisable le 2030-05-02");
    }
  }

  // ─── Écritures manuelles ───

  private static String compte(String tenant, String code) {
    return rows("SELECT id FROM gl_accounts WHERE tenant_id = '" + tenant + "' AND code = '" + code + "'")
        .getFirst();
  }

  /** Écriture manuelle 411 / 701 en brouillon ; renvoie [écriture, ligne 411, ligne 701]. */
  private static String[] ecritureManuelle(String source, String debit, String credit) throws SQLException {
    String e = UUID.randomUUID().toString();
    String l1 = UUID.randomUUID().toString();
    String l2 = UUID.randomUUID().toString();
    asUser(COMPTABLE,
        "INSERT INTO journal_entries (id, tenant_id, entry_number, entry_date, description, source,"
            + " status, created_by) VALUES ('" + e + "', get_user_tenant_id(auth.uid()), 'OD-"
            + e.substring(0, 8) + "', '2030-05-03', 'Écriture de test', '" + source
            + "', 'draft', auth.uid());"
            + "INSERT INTO journal_lines (id, entry_id, account_id, debit, credit) VALUES ('" + l1
            + "', '" + e + "', '" + compte(A, debit) + "', 100, 0), ('" + l2 + "', '" + e + "', '"
            + compte(A, credit) + "', 0, 100)");
    return new String[] {e, l1, l2};
  }

  private static void imputer(String ligne, String section) throws SQLException {
    asUser(COMPTABLE, "INSERT INTO journal_line_analytics (line_id, axis_id, value_id) VALUES ('"
        + ligne + "', '" + DEPT + "', '" + section + "')");
  }

  private static void comptabiliser(String ecriture) throws SQLException {
    asUser(COMPTABLE, "UPDATE journal_entries SET status = 'posted', posted_by = auth.uid(),"
        + " posted_at = now() WHERE id = '" + ecriture + "'");
  }

  @Test
  @DisplayName("écriture manuelle : interdit en classe 4, obligatoire en classe 7, puis figée")
  void ecritureManuelle() throws Exception {
    String[] e = ecritureManuelle("manual", "411", "701");
    imputer(e[1], COM); // interdit sur 411
    imputer(e[2], COM);
    assertThatThrownBy(() -> comptabiliser(e[0]))
        .hasMessageContaining("l'axe « Département » ne s'applique pas au compte 411");

    asUser(COMPTABLE, "DELETE FROM journal_line_analytics WHERE line_id = '" + e[1] + "'");
    comptabiliser(e[0]);
    assertThat(rows("SELECT status FROM journal_entries WHERE id = '" + e[0] + "'")).containsExactly("posted");

    assertThatThrownBy(() -> asUser(COMPTABLE, "DELETE FROM journal_line_analytics WHERE line_id = '" + e[2] + "'"))
        .hasMessageContaining("Imputation analytique figée");
  }

  @Test
  @DisplayName("la contre-passation recopie l'imputation et passe, même si la section a été désactivée")
  void contrepassationRecopieLAnalytique() throws Exception {
    String[] e = ecritureManuelle("manual", "411", "701");
    imputer(e[2], PROD);
    comptabiliser(e[0]);
    owner("UPDATE analytic_values SET is_active = false WHERE id = '" + PROD + "'");
    try {
      String rev = asUser(COMPTABLE, "SELECT reverse_journal_entry('" + e[0] + "', '2030-05-04', 'test')::text");
      assertThat(rows("SELECT g.code || ' ' || coalesce(v.code, '-') || ' ' || je.status FROM journal_lines l"
              + " JOIN journal_entries je ON je.id = l.entry_id JOIN gl_accounts g ON g.id = l.account_id"
              + " LEFT JOIN journal_line_analytics la ON la.line_id = l.id"
              + " LEFT JOIN analytic_values v ON v.id = la.value_id WHERE l.entry_id = '" + rev
              + "' ORDER BY g.code"))
          .containsExactly("411 - posted", "701 PROD posted");
    } finally {
      owner("UPDATE analytic_values SET is_active = true WHERE id = '" + PROD + "'");
    }
  }

  @Test
  @DisplayName("source non contrôlée (facture fournisseur) : l'obligation ne la bloque pas")
  void sourceExemptee() throws Exception {
    owner("INSERT INTO analytic_rules (tenant_id, axis_id, account_prefix, requirement) VALUES ('" + A
        + "', '" + DEPT + "', '6', 'required') ON CONFLICT DO NOTHING");
    try {
      String[] e = ecritureManuelle("ap_invoice", "601", "401");
      comptabiliser(e[0]);
      assertThat(rows("SELECT status FROM journal_entries WHERE id = '" + e[0] + "'")).containsExactly("posted");
      String[] m = ecritureManuelle("manual", "601", "401");
      assertThatThrownBy(() -> comptabiliser(m[0])).hasMessageContaining("obligatoire sur le compte 601");
    } finally {
      owner("DELETE FROM analytic_rules WHERE axis_id = '" + DEPT + "' AND account_prefix = '6'");
    }
  }

  // ─── Droits et isolation ───

  @Test
  @DisplayName("droits : le comptable gère les sections, pas les axes ; une autre société ne voit rien")
  void droitsEtIsolation() throws Exception {
    assertThatThrownBy(() -> asUser(COMPTABLE, "INSERT INTO analytic_axes (tenant_id, code, name) VALUES"
            + " (get_user_tenant_id(auth.uid()), 'CC', 'Centre de coûts')"))
        .hasMessageContaining("row-level security");
    asUser(COMPTABLE, "INSERT INTO analytic_values (tenant_id, axis_id, code, name) VALUES"
        + " (get_user_tenant_id(auth.uid()), '" + DEPT + "', 'RH-" + UUID.randomUUID().toString().substring(0, 4)
        + "', 'Ressources humaines')");

    assertThat(asUser(BETA, "SELECT count(*)::text FROM analytic_axes")).isEqualTo("0");
    assertThat(asUser(BETA, "SELECT count(*)::text FROM analytic_values")).isEqualTo("0");

    // Un axe d'une autre société ne peut pas imputer une ligne d'Alpha, même en propriétaire.
    String axeBeta = UUID.randomUUID().toString();
    String sectionBeta = UUID.randomUUID().toString();
    owner("INSERT INTO analytic_axes (id, tenant_id, code, name) VALUES ('" + axeBeta + "', '" + B
        + "', 'B" + axeBeta.substring(0, 4).toUpperCase().replaceAll("[^A-Z0-9]", "X") + "', 'Axe Beta');"
        + "INSERT INTO analytic_values (id, tenant_id, axis_id, code, name) VALUES ('" + sectionBeta
        + "', '" + B + "', '" + axeBeta + "', 'X', 'Section Beta')");
    String[] e = ecritureManuelle("manual", "411", "701");
    assertThatThrownBy(() -> owner("INSERT INTO journal_line_analytics (line_id, axis_id, value_id) VALUES ('"
            + e[2] + "', '" + axeBeta + "', '" + sectionBeta + "')"))
        .hasMessageContaining("Axe analytique inconnu dans la société");
    // Et une section ne peut pas être imputée sous un autre axe (clé composite).
    assertThatThrownBy(() -> owner("INSERT INTO journal_line_analytics (line_id, axis_id, value_id) VALUES ('"
            + e[2] + "', '" + DEPT + "', '" + sectionBeta + "')"))
        .hasMessageContaining("journal_line_analytics_value_id_axis_id_fkey");
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
      try (Statement st = c.createStatement()) {
        String result = null;
        if (st.execute(sql)) {
          try (ResultSet rs = st.getResultSet()) {
            if (rs.next()) result = rs.getString(1);
          }
        }
        c.commit();
        return result;
      } catch (SQLException e) {
        c.rollback();
        throw e;
      }
    }
  }

  private static void owner(String sql) {
    PostgresFixture.execute(PostgresFixture.urlOf(DATABASE), sql);
  }

  private static long count(String sql) {
    return PostgresFixture.countAsAdmin(DATABASE, sql);
  }

  private static List<String> rows(String sql) {
    List<String> out = new ArrayList<>();
    try (Connection c = DriverManager.getConnection(
            PostgresFixture.urlOf(DATABASE), PostgresFixture.ADMIN_USER, PostgresFixture.ADMIN_PASSWORD);
        Statement st = c.createStatement();
        ResultSet rs = st.executeQuery(sql)) {
      while (rs.next()) out.add(rs.getString(1));
    } catch (SQLException e) {
      throw new IllegalStateException("Observation échouée : " + sql, e);
    }
    return out;
  }
}
