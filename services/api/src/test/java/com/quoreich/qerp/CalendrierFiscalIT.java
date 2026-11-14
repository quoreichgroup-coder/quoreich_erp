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
 * V33 — calendrier fiscal central (SAP OB52, calendrier fiscal Sage 300, exercices Sage X3,
 * AUDCIF art. 7). Joué sous le rôle applicatif avec les claims du porteur, comme une requête réelle.
 *
 * <p>Alpha n'a pas d'exercice (comportement antérieur : seuls les verrous de période jouent) ;
 * Beta définit les siens, ce qui y rend obligatoire un exercice ouvert pour toute opération.
 */
@SpringBootTest
class CalendrierFiscalIT {

  private static final String DATABASE = "qerp_it_calendrier_fiscal";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String B = PostgresFixture.BETA_TENANT;
  private static final String ADMIN_A = PostgresFixture.ALPHA_USER;
  private static final String ADMIN_B = PostgresFixture.BETA_USER;
  private static final String LECTEUR = "aaaaaaaa-0000-0000-0000-0000000000c9";
  private static final String CLIENT_A = "c0000001-0000-0000-0000-000000000000";
  private static final String CLIENT_B = "c0000004-0000-0000-0000-000000000000";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    owner("INSERT INTO auth.users (id) VALUES ('" + LECTEUR + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + LECTEUR + "', '" + A + "', 'Lecteur Alpha')"
        + " ON CONFLICT (id) DO NOTHING");
    PostgresFixture.grantRoles(DATABASE, ADMIN_A, "admin", A, ADMIN_B, "admin", B, LECTEUR, "viewer", A);
  }

  @Test
  @DisplayName("un lecteur ne clôture rien : ni par la table (lecture seule), ni par la fonction")
  void lecteurSansEcriture() throws Exception {
    assertThatThrownBy(() -> asUser(LECTEUR, "INSERT INTO period_locks (tenant_id, period, module, status)"
            + " VALUES ('" + A + "', '2020-02', 'GL', 'closed') RETURNING id::text"))
        .hasMessageContaining("permission denied");
    assertThatThrownBy(() -> asUser(LECTEUR, "SELECT set_period_status('2020-02', 'AR', 'closed')::text"))
        .hasMessageContaining("periods.close");
    assertThatThrownBy(() -> asUser(LECTEUR, "SELECT close_gl_period('2020-02')::text"))
        .hasMessageContaining("periods.close");
    assertThat(count("SELECT count(*) FROM period_locks WHERE tenant_id = '" + A + "' AND period = '2020-02'")).isZero();
  }

  @Test
  @DisplayName("ordre de clôture bloquant, refus par module, réouverture avec motif ; stock et trésorerie se clôturent")
  void ordreDeClotureEtModules() throws Exception {
    String p = "2020-03";
    assertThatThrownBy(() -> asUser(ADMIN_A, "SELECT close_gl_period('" + p + "')::text"))
        .hasMessageContaining("Clôturez d'abord la période " + p);

    // Stock et trésorerie : leurs clôtures propres (photographie) échouaient avant V33.
    assertThat(asUser(ADMIN_A, "SELECT (close_inventory_period('" + p + "')).period")).isEqualTo(p);
    assertThat(asUser(ADMIN_A, "SELECT (close_treasury_period('" + p + "')).status")).isEqualTo("completed");
    for (String m : new String[] {"SALES", "PURCHASING", "AR", "AP", "ASSETS", "PAYROLL"}) {
      asUser(ADMIN_A, "SELECT set_period_status('" + p + "', '" + m + "', 'closed')::text");
    }
    asUser(ADMIN_A, "SELECT set_period_status('" + p + "', 'GL', 'closed')::text");
    assertThat(count("SELECT count(*) FROM period_locks WHERE tenant_id = '" + A + "' AND period = '" + p
        + "' AND status = 'closed'")).isEqualTo(9);

    // Chaque module refuse ses opérations dans la période close.
    assertThatThrownBy(() -> owner("INSERT INTO quotations (tenant_id, quote_number, customer_id, quote_date, created_by)"
            + " VALUES ('" + A + "', 'DEV-CLOS', '" + CLIENT_A + "', '2020-03-10', '" + ADMIN_A + "')"))
        .hasMessageContaining("clôturée pour le module Ventes");
    assertThatThrownBy(() -> owner("INSERT INTO ar_invoices (tenant_id, invoice_number, customer_id, invoice_date, due_date,"
            + " subtotal, tax_amount, total, status, amount_paid, created_by) VALUES ('" + A + "', 'FAC-CLOS', '" + CLIENT_A
            + "', '2020-03-10', '2020-04-10', 100, 18, 118, 'sent', 0, '" + ADMIN_A + "')"))
        .hasMessageContaining("clôturée pour le module Comptes clients");

    // Réouverture : motif obligatoire, Grand livre d'abord.
    assertThatThrownBy(() -> asUser(ADMIN_A, "SELECT set_period_status('" + p + "', 'AR', 'open', 'correction')::text"))
        .hasMessageContaining("Rouvrez d'abord le Grand livre");
    assertThatThrownBy(() -> asUser(ADMIN_A, "SELECT set_period_status('" + p + "', 'GL', 'open')::text"))
        .hasMessageContaining("Motif obligatoire");
    assertThatThrownBy(() -> asUser(ADMIN_A, "SELECT reopen_gl_period('" + p + "')::text"))
        .hasMessageContaining("Motif obligatoire");
    asUser(ADMIN_A, "SELECT set_period_status('" + p + "', 'GL', 'open', 'Régularisation oubliée')::text");
    asUser(ADMIN_A, "SELECT set_period_status('" + p + "', 'TREASURY', 'open', 'Relevé corrigé')::text");
    assertThat(count("SELECT count(*) FROM treasury_period_closes WHERE tenant_id = '" + A + "' AND period = '" + p + "'"))
        .as("la photographie de trésorerie est retirée : la prochaine clôture en reprendra une à jour").isZero();

    // Journal : dans l'ordre des faits, avec l'auteur et le motif ; invisible au lecteur.
    assertThat(count("SELECT count(*) FROM fiscal_calendar_audit WHERE tenant_id = '" + A + "' AND period = '" + p
        + "' AND action = 'period_reopened' AND reason IS NOT NULL AND actor_id = '" + ADMIN_A + "'")).isEqualTo(2);
    assertThat(asUser(ADMIN_A, "SELECT string_agg(module, ',' ORDER BY seq) FROM fiscal_calendar_audit WHERE period = '" + p
        + "' AND action = 'period_closed'")).endsWith(",GL");
    assertThat(asUser(LECTEUR, "SELECT count(*)::text FROM fiscal_calendar_audit")).isEqualTo("0");
  }

  @Test
  @DisplayName("exercices : premier exercice décalé, suivants de 12 mois contigus, deux ouverts au plus, clôture définitive")
  void exercices() throws Exception {
    // Exercice décalé juillet → juin (autorisé hors OHADA, et pour un premier exercice).
    String fy1 = asUser(ADMIN_B, "SELECT create_fiscal_year('2025-07-01')::text");
    assertThat(asUser(ADMIN_B, "SELECT code || ' ' || status || ' ' || (SELECT count(*) FROM fiscal_periods WHERE fiscal_year_id = y.id)"
        + " FROM fiscal_years y WHERE id = '" + fy1 + "'")).isEqualTo("2025-2026 not_open 12");
    assertThatThrownBy(() -> asUser(ADMIN_B, "SELECT create_fiscal_year('2026-07-01', '2026-12-31')::text"))
        .hasMessageContaining("Un exercice dure 12 mois");
    assertThatThrownBy(() -> asUser(ADMIN_B, "SELECT create_fiscal_year('2027-01-01')::text"))
        .hasMessageContaining("suit le dernier");
    assertThatThrownBy(() -> asUser(ADMIN_A, "SELECT open_fiscal_year('" + fy1 + "')::text"))
        .as("une autre société ne touche pas aux exercices de Beta").hasMessageContaining("Exercice introuvable");

    // Une fois des exercices définis : rien hors d'un exercice ouvert.
    assertThatThrownBy(() -> devisBeta("2025-09-10")).hasMessageContaining("n'est pas encore ouvert");
    assertThatThrownBy(() -> devisBeta("2030-01-10")).hasMessageContaining("Aucun exercice ne couvre le 10/01/2030");
    asUser(ADMIN_B, "SELECT open_fiscal_year('" + fy1 + "')::text");
    devisBeta("2025-09-10");

    String fy2 = asUser(ADMIN_B, "SELECT create_fiscal_year('2026-07-01')::text");
    String fy3 = asUser(ADMIN_B, "SELECT create_fiscal_year('2027-07-01')::text");
    asUser(ADMIN_B, "SELECT open_fiscal_year('" + fy2 + "')::text");
    assertThatThrownBy(() -> asUser(ADMIN_B, "SELECT open_fiscal_year('" + fy3 + "')::text"))
        .hasMessageContaining("Deux exercices sont déjà ouverts");

    // Clôture : refusée tant qu'une période reste ouverte ; puis définitive.
    assertThatThrownBy(() -> asUser(ADMIN_B, "SELECT close_fiscal_year('" + fy1 + "')::text"))
        .hasMessageContaining("période(s) ouverte(s)");
    asUser(ADMIN_B, """
        DO $$ DECLARE p record; m record; BEGIN
          FOR p IN SELECT code FROM fiscal_periods WHERE fiscal_year_id = '%s' ORDER BY code LOOP
            FOR m IN SELECT code FROM fiscal_modules ORDER BY sort_order LOOP
              PERFORM set_period_status(p.code, m.code, 'closed');
            END LOOP;
          END LOOP;
        END $$""".formatted(fy1));
    asUser(ADMIN_B, "SELECT close_fiscal_year('" + fy1 + "')::text");
    assertThat(count("SELECT count(*) FROM fiscal_years WHERE id = '" + fy1 + "' AND status = 'closed'")).isEqualTo(1);
    assertThatThrownBy(() -> devisBeta("2025-10-10")).hasMessageContaining("est clôturé");
    assertThatThrownBy(() -> asUser(ADMIN_B, "SELECT set_period_status('2025-10', 'GL', 'open', 'essai')::text"))
        .hasMessageContaining("n'est pas ouvert");
    asUser(ADMIN_B, "SELECT open_fiscal_year('" + fy3 + "')::text");
    assertThat(count("SELECT count(*) FROM fiscal_calendar_audit WHERE tenant_id = '" + B
        + "' AND action IN ('fiscal_year_created', 'fiscal_year_opened', 'fiscal_year_closed')")).isEqualTo(7);
  }

  // ─── Outils ───

  private static void devisBeta(String date) throws SQLException {
    // Depuis V40, un devis se crée par la fonction contrôlée (plus d'écriture directe) ; le contrôle
    // de période s'y applique de même.
    asUser(ADMIN_B, "SELECT create_sales_quotation('" + CLIENT_B + "', '" + date + "', '" + date + "'::date + 30,"
        + " '[{\"description\": \"Article\", \"quantity\": 1, \"unit_price\": 100}]'::jsonb)::text");
  }

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
}
