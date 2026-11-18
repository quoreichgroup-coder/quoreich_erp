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
 * V55 — isolation stricte des sociétés : aucune ligne ne cite une ligne d'une autre société, quel
 * que soit l'écrivain (ici le propriétaire de la base, qui contourne la RLS : le contrôle ne dépend
 * donc pas d'elle). Toute clé étrangère entre tables de sociétés doit être couverte.
 */
@SpringBootTest
class IsolationSocietesIT {

  private static final String DATABASE = "qerp_it_isolation_societes";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String B = PostgresFixture.BETA_TENANT;
  private static final String ADMIN = PostgresFixture.ALPHA_USER;

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
  }

  @Test
  @DisplayName("couverture : chaque clé étrangère entre tables de sociétés est contrôlée par trg_zz_isolation_societe")
  void toutesLesClesSontCouvertes() {
    List<String> nonCouvertes = lignes("""
        WITH tables_societe AS (
          SELECT c.oid, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
             AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped))
        SELECT src.relname || '.' || a.attname || ' -> ' || dst.relname
          FROM pg_constraint c
          JOIN tables_societe src ON src.oid = c.conrelid
          JOIN tables_societe dst ON dst.oid = c.confrelid
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
         WHERE c.contype = 'f' AND cardinality(c.conkey) = 1 AND a.attname <> 'tenant_id'
           AND NOT EXISTS (
             SELECT 1 FROM pg_trigger t WHERE t.tgrelid = c.conrelid AND t.tgname = 'trg_zz_isolation_societe'
                AND ',' || replace(encode(t.tgargs, 'escape'), '\\000', ',') LIKE '%,' || a.attname || ',' || dst.relname || ',%')
         ORDER BY 1
        """);
    assertThat(nonCouvertes)
        .as("une migration qui ajoute une clé étrangère entre sociétés doit appeler install_tenant_isolation_triggers()")
        .isEmpty();
    assertThat(lignes("SELECT count(*)::text FROM pg_trigger WHERE tgname = 'trg_zz_isolation_societe'").get(0))
        .satisfies(n -> assertThat(Integer.parseInt(n)).isGreaterThanOrEqualTo(60));
  }

  @Test
  @DisplayName("refus QG017 : commande avec le fournisseur, ligne avec l'article, écriture avec le compte d'une autre société")
  void referencesEtrangeresRefusees() {
    String fournisseurB = UUID.randomUUID().toString(), fournisseurA = UUID.randomUUID().toString();
    String articleB = UUID.randomUUID().toString(), compteB = UUID.randomUUID().toString();
    owner("INSERT INTO suppliers (id, tenant_id, name) VALUES ('" + fournisseurB + "', '" + B + "', 'Fournisseur B'), ('"
        + fournisseurA + "', '" + A + "', 'Fournisseur A');"
        + "INSERT INTO items (id, tenant_id, code, name) VALUES ('" + articleB + "', '" + B + "', 'B-" + articleB.substring(0, 5) + "', 'Article B');"
        + "INSERT INTO gl_accounts (id, tenant_id, code, name, account_type) VALUES ('" + compteB + "', '" + B + "', '9" + articleB.substring(0, 5).replaceAll("[^0-9]", "1")
        + "', 'Compte B', 'expense')");

    assertThatThrownBy(() -> owner("INSERT INTO purchase_orders (tenant_id, po_number, supplier_id, status, created_by) VALUES ('" + A
            + "', 'PO-X-" + fournisseurB.substring(0, 5) + "', '" + fournisseurB + "', 'draft', '" + ADMIN + "')"))
        .hasStackTraceContaining("Isolation des sociétés").hasStackTraceContaining("supplier_id");

    String po = UUID.randomUUID().toString();
    owner("INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, created_by) VALUES ('" + po + "', '" + A
        + "', 'PO-A-" + po.substring(0, 5) + "', '" + fournisseurA + "', 'draft', '" + ADMIN + "')");
    assertThatThrownBy(() -> owner("INSERT INTO po_lines (po_id, item_id, description, quantity, unit_cost) VALUES ('" + po + "', '"
            + articleB + "', 'x', 1, 1)"))
        .as("table de lignes : la société est celle de la commande").hasStackTraceContaining("item_id");
    assertThatThrownBy(() -> owner("UPDATE purchase_orders SET supplier_id = '" + fournisseurB + "' WHERE id = '" + po + "'"))
        .as("une modification est contrôlée comme une création").hasStackTraceContaining("Isolation des sociétés");

    String entry = UUID.randomUUID().toString();
    owner("INSERT INTO journal_entries (id, tenant_id, entry_number, entry_date, description, source, status, created_by) VALUES ('"
        + entry + "', '" + A + "', 'JE-ISO-" + entry.substring(0, 5) + "', CURRENT_DATE, 'Isolation', 'manual', 'draft', '" + ADMIN + "')");
    assertThatThrownBy(() -> owner("INSERT INTO journal_lines (entry_id, account_id, debit, credit) VALUES ('" + entry + "', '" + compteB + "', 1, 0)"))
        .hasStackTraceContaining("account_id");
  }

  /** V101 : fonctions SECURITY DEFINER exposées aux utilisateurs avec un paramètre « société », toutes vérifiées. */
  private static final List<String> EXPOSEES_VERIFIEES = List.of(
      "assign_crm_role", "assign_project_role", // contrôlent la société de l'appelant (V31)
      "budget_account_ok", "caller_tenant_matches", "chart_framework", "quality_rule_severity", "replenishment_target_ok", "seed_ap_defaults", // V101
      "get_consolidated_cfo_kpis", "get_consolidated_cfo_trends", // intersection avec get_accessible_tenants
      "inventory_campaign_catalog", "inventory_campaign_numbering", "inventory_campaign_policy", "inventory_campaign_preview",
      "inventory_campaign_timeline", "inventory_cycle_analysis", "inventory_cycle_policy", "inventory_cycle_prepare"); // société déduite côté serveur

  @Test
  @DisplayName("V101 : aucune fonction SECURITY DEFINER exposée ne prend une société sans contrôle revu")
  void fonctionsAParametreSocieteRevues() {
    List<String> exposees = lignes("""
        SELECT DISTINCT p.proname FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
           AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
           AND pg_get_function_identity_arguments(p.oid) ~ '(_tenant|tenant_id|_company)[a-z_]* uuid' ORDER BY 1""");
    assertThat(exposees).as("nouvelle fonction à paramètre société : contrôler la société de l'appelant puis l'ajouter ici")
        .containsExactlyInAnyOrderElementsOf(EXPOSEES_VERIFIEES);
  }

  @Test
  @DisplayName("V101 : un membre de A n'obtient ni les totaux, ni les paramètres, ni l'écriture de la société B")
  void fonctionsInternesFermees() throws SQLException {
    String compteB = lignes("SELECT id::text FROM gl_accounts WHERE tenant_id = '" + B + "' LIMIT 1").get(0);
    assertThatThrownBy(() -> asUser(ADMIN, "SELECT budget_actual('" + B + "', '', '2000-01-01', '2100-12-31')::text"))
        .hasMessageContaining("permission denied");
    assertThatThrownBy(() -> asUser(ADMIN, "SELECT (budget_setting('" + B + "')).control_mode")).hasMessageContaining("permission denied");
    assertThatThrownBy(() -> asUser(ADMIN, "SELECT notify_sales('" + B + "', 'info', 'Intrusion', 'x', NULL)::text")).hasMessageContaining("permission denied");
    assertThatThrownBy(() -> asUser(ADMIN, "SELECT seed_ap_defaults('" + B + "')::text")).hasMessageContaining("société différente");
    assertThat(asUser(ADMIN, "SELECT budget_account_ok('" + B + "', '" + compteB + "')::text")).isEqualTo("false");
    assertThat(asUser(ADMIN, "SELECT chart_framework('" + B + "')")).isNull();
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

  private static List<String> lignes(String sql) {
    try (Connection c = DriverManager.getConnection(
            PostgresFixture.urlOf(DATABASE), PostgresFixture.ADMIN_USER, PostgresFixture.ADMIN_PASSWORD);
        Statement st = c.createStatement();
        var rs = st.executeQuery(sql)) {
      List<String> out = new ArrayList<>();
      while (rs.next()) out.add(rs.getString(1));
      return out;
    } catch (SQLException e) {
      throw new IllegalStateException(e);
    }
  }
}
