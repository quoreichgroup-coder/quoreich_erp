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
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Numérotation des factures (V22) : unique, continue, attribuée à l'émission, sans trou.
 * La société Alpha est en numérotation automatique (série par défaut INV-YYYY-####) ; les
 * étapes s'enchaînent parce que les compteurs avancent.
 */
@SpringBootTest
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class NumerotationFacturesIT {

  private static final String DATABASE = "qerp_it_numerotation";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String B = PostgresFixture.BETA_TENANT;
  private static final String CLIENT_A = "c0000001-0000-0000-0000-000000000000";
  private static final String CLIENT_B = "c0000004-0000-0000-0000-000000000000";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.applySyscohada(DATABASE, A);
    PostgresFixture.applySyscohada(DATABASE, B);
    owner("UPDATE ar_general_settings SET auto_numbering = true WHERE tenant_id = '" + A + "'");
    PostgresFixture.grantRoles(DATABASE, PostgresFixture.ALPHA_USER, "admin", A, PostgresFixture.BETA_USER, "admin", B);
  }

  /** Émet une facture d'en-tête (chemin historique : INSERT direct en 'sent'). Renvoie son numéro. */
  private static String emettre(String user, String client, String date, String numeroSaisi) throws SQLException {
    String id = UUID.randomUUID().toString();
    asUser(user, "INSERT INTO ar_invoices (id, invoice_number, customer_id, invoice_date, due_date, subtotal,"
        + " tax_amount, total, tenant_id, created_by, status, amount_paid) VALUES ('" + id + "', '" + numeroSaisi
        + "', '" + client + "', '" + date + "', '" + date + "'::date + 30, 100, 0, 100,"
        + " get_user_tenant_id(auth.uid()), auth.uid(), 'sent', 0)");
    return rows("SELECT invoice_number FROM ar_invoices WHERE id = '" + id + "'").getFirst();
  }

  @Test
  @Order(1)
  @DisplayName("numéros attribués à l'émission, continus ; le numéro saisi est remplacé ; l'écriture porte le définitif")
  void suiteContinue() throws Exception {
    assertThat(emettre(PostgresFixture.ALPHA_USER, CLIENT_A, "2030-03-01", "INV-ALEATOIRE")).isEqualTo("INV-2030-0001");
    assertThat(emettre(PostgresFixture.ALPHA_USER, CLIENT_A, "2030-03-02", "INV-AUTRE")).isEqualTo("INV-2030-0002");
    assertThat(rows("SELECT je.description FROM ar_invoices i JOIN journal_entries je ON je.id = i.journal_entry_id"
            + " WHERE i.invoice_number = 'INV-2030-0002'"))
        .containsExactly("AR Invoice: INV-2030-0002");
  }

  @Test
  @Order(2)
  @DisplayName("un brouillon garde son numéro provisoire et ne consomme rien ; il est numéroté à l'émission")
  void brouillon() throws Exception {
    String id = UUID.randomUUID().toString();
    asUser(PostgresFixture.ALPHA_USER, "INSERT INTO ar_invoices (id, invoice_number, customer_id, invoice_date, due_date,"
        + " subtotal, tax_amount, tenant_id, created_by, status) VALUES ('" + id + "', 'BROUILLON-1', '" + CLIENT_A
        + "', '2030-03-03', '2030-04-03', 100, 0, get_user_tenant_id(auth.uid()), auth.uid(), 'draft')");
    assertThat(rows("SELECT invoice_number FROM ar_invoices WHERE id = '" + id + "'")).containsExactly("BROUILLON-1");
    asUser(PostgresFixture.ALPHA_USER, "UPDATE ar_invoices SET status = 'sent' WHERE id = '" + id + "'");
    assertThat(rows("SELECT invoice_number FROM ar_invoices WHERE id = '" + id + "'")).containsExactly("INV-2030-0003");
  }

  @Test
  @Order(3)
  @DisplayName("émission refusée (période close) : aucun numéro consommé ; compteur par année ; facture antidatée")
  void sansTrouEtParAnnee() throws Exception {
    owner("INSERT INTO period_locks (tenant_id, period, module, status) VALUES ('" + A + "', '2031-01', 'GL', 'closed')");
    assertThatThrownBy(() -> emettre(PostgresFixture.ALPHA_USER, CLIENT_A, "2031-01-15", "X"))
        .hasMessageContaining("2031-01");
    assertThat(emettre(PostgresFixture.ALPHA_USER, CLIENT_A, "2031-02-01", "X")).isEqualTo("INV-2031-0001");
    // Facture de 2030 émise après les premières de 2031 : suite de 2030, jamais un numéro déjà donné.
    assertThat(emettre(PostgresFixture.ALPHA_USER, CLIENT_A, "2030-12-31", "X")).isEqualTo("INV-2030-0004");
  }

  @Test
  @Order(4)
  @DisplayName("le numéro d'une facture émise ne se modifie plus")
  void numeroFige() {
    assertThatThrownBy(() -> asUser(PostgresFixture.ALPHA_USER,
            "UPDATE ar_invoices SET invoice_number = 'CHANGE' WHERE invoice_number = 'INV-2030-0001'"))
        .hasMessageContaining("Le numéro d'une facture émise ne se modifie pas (INV-2030-0001)");
  }

  @Test
  @Order(5)
  @DisplayName("numérotation manuelle : le numéro saisi est gardé, un doublon est refusé ; reprise d'une série existante")
  void manuelleEtReprise() throws Exception {
    // Beta : numérotation manuelle (réglage des tests), numéro saisi conservé, doublon refusé.
    assertThat(emettre(PostgresFixture.BETA_USER, CLIENT_B, "2030-05-01", "FB-001")).isEqualTo("FB-001");
    assertThatThrownBy(() -> emettre(PostgresFixture.BETA_USER, CLIENT_B, "2030-05-02", "FB-001"))
        .hasMessageContaining("ar_invoices_tenant_number_key");

    // Puis automatique, en reprenant une numérotation existante à partir de 500, format à 5 chiffres.
    owner("UPDATE ar_general_settings SET auto_numbering = true WHERE tenant_id = '" + B + "';"
        + "UPDATE ar_numbering_series SET format = 'FAC-YYYY-#####', next_number = 500"
        + " WHERE tenant_id = '" + B + "' AND doc_type = 'invoice'");
    assertThat(emettre(PostgresFixture.BETA_USER, CLIENT_B, "2030-05-03", "X")).isEqualTo("FAC-2030-00500");
    assertThat(emettre(PostgresFixture.BETA_USER, CLIENT_B, "2030-05-04", "X")).isEqualTo("FAC-2030-00501");
    // Les compteurs d'Alpha n'ont pas bougé.
    assertThat(rows("SELECT period || ':' || next_number FROM document_counters WHERE tenant_id = '" + A
            + "' ORDER BY period"))
        .containsExactly("2030:5", "2031:2");
  }

  // ─── Outils ───

  private static void asUser(String user, String sql) throws SQLException {
    try (Connection c = DriverManager.getConnection(
            PostgresFixture.urlOf(DATABASE), PostgresFixture.API_USER, PostgresFixture.API_PASSWORD)) {
      c.setAutoCommit(false);
      try (PreparedStatement claims = c.prepareStatement("SELECT set_config('request.jwt.claims', ?, true)")) {
        claims.setString(1, "{\"sub\":\"" + user + "\",\"role\":\"authenticated\"}");
        claims.execute();
      }
      try (Statement st = c.createStatement()) {
        st.execute(sql);
        c.commit();
      } catch (SQLException e) {
        c.rollback();
        throw e;
      }
    }
  }

  private static void owner(String sql) {
    PostgresFixture.execute(PostgresFixture.urlOf(DATABASE), sql);
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
