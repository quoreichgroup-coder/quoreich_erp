package com.quoreich.qerp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * V31 : les douze écrans de rôles par module écrivent dans la matrice, sans pouvoir toucher une
 * autre société ; on rejoint une société sur invitation, plus par son nom.
 *
 * <p>Avant V31 (constaté sur la copie réelle) : onze des douze RPC échouaient ou n'avaient aucun
 * effet, neuf ne vérifiaient pas la société de la cible, et join_tenant(nom) ouvrait n'importe
 * quelle société. Joué sous le rôle applicatif avec les claims du porteur, comme une requête réelle.
 */
@SpringBootTest
class RolesDesModulesIT {

  private static final String DATABASE = "qerp_it_roles_modules";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String B = PostgresFixture.BETA_TENANT;
  private static final String ADMIN_A = PostgresFixture.ALPHA_USER;
  private static final String ADMIN_B = PostgresFixture.BETA_USER;
  private static final String MEMBRE_A = "aaaaaaaa-0000-0000-0000-0000000000e1";
  private static final String NOUVEAU = "aaaaaaaa-0000-0000-0000-0000000000e2";

  /** Module, appel d'attribution (%s = rôle, %s = action), rôle d'essai, actions attribuer / retirer. */
  private record Cas(String module, String appel, String role, String attribuer) {}

  private static final List<Cas> CAS = List.of(
      new Cas("budget", "assign_budget_role('" + MEMBRE_A + "', '%s', '%s')", "budget_planner", "assign"),
      new Cas("conformité", "assign_compliance_role('" + MEMBRE_A + "', '%s', '%s')", "compliance_officer", "grant"),
      new Cas("CRM", "assign_crm_role('" + MEMBRE_A + "', '%s', '%s')", "crm_agent", "grant"),
      new Cas("notes de frais", "assign_expense_role('" + MEMBRE_A + "', '%s', '%s')", "expense_approver", "grant"),
      new Cas("immobilisations", "assign_fixed_asset_role('" + MEMBRE_A + "', '%s', '%s')", "asset_clerk", "assign"),
      new Cas("RH", "assign_hr_role('" + MEMBRE_A + "', '%s', '%s')", "hr_clerk", "assign"),
      new Cas("inventaire", "assign_inventory_role('" + MEMBRE_A + "', '%s', '%s')", "inventory_clerk", "assign"),
      new Cas("achats", "assign_procurement_role('" + MEMBRE_A + "', '%s', '%s')", "procurement_l1", "assign"),
      new Cas("projets", "assign_project_role(NULL, '" + MEMBRE_A + "', '%s', '%s')", "project_planner", "grant"),
      new Cas("risques", "assign_risk_role('" + MEMBRE_A + "', '%s', '%s')", "risk_owner", "grant"),
      new Cas("ventes", "assign_sales_role('" + MEMBRE_A + "', '%s', '%s')", "sales_rep", "assign"),
      new Cas("trésorerie", "assign_treasury_role('" + MEMBRE_A + "', '%s', '%s')", "treasury_clerk", "assign"));

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    owner("INSERT INTO user_roles (user_id, role, tenant_id) SELECT v.u::uuid, 'admin', v.t::uuid FROM (VALUES ('"
        + ADMIN_A + "', '" + A + "'), ('" + ADMIN_B + "', '" + B + "')) AS v(u, t)"
        + " WHERE NOT EXISTS (SELECT 1 FROM user_roles x WHERE x.user_id = v.u::uuid AND x.role = 'admin');"
        + "INSERT INTO auth.users (id) VALUES ('" + MEMBRE_A + "'), ('" + NOUVEAU + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + MEMBRE_A + "', '" + A + "', 'Membre Alpha')"
        + " ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO profiles (id, full_name) VALUES ('" + NOUVEAU + "', 'Nouvel employé') ON CONFLICT (id) DO NOTHING");
  }

  @Test
  @DisplayName("les douze écrans de rôles attribuent puis retirent dans la matrice, dans la société de l'appelant")
  void douzeModules() throws Exception {
    for (Cas c : CAS) {
      asUser(ADMIN_A, "SELECT " + c.appel().formatted(c.role(), c.attribuer()) + "::text");
      assertThat(asUser(MEMBRE_A, "SELECT has_role(auth.uid(), '" + c.role() + "')::text"))
          .as("%s : rôle attribué effectif", c.module()).isEqualTo("true");
      assertThat(count("SELECT count(*) FROM user_role_assignments a JOIN erp_roles r ON r.id = a.role_id"
          + " WHERE a.user_id = '" + MEMBRE_A + "' AND r.code = '" + c.role() + "' AND a.tenant_id = '" + A + "'"))
          .as("%s : écrit dans la matrice de la société A", c.module()).isEqualTo(1);

      asUser(ADMIN_A, "SELECT " + c.appel().formatted(c.role(), "revoke") + "::text");
      assertThat(asUser(MEMBRE_A, "SELECT has_role(auth.uid(), '" + c.role() + "')::text"))
          .as("%s : rôle retiré", c.module()).isEqualTo("false");
    }
  }

  @Test
  @DisplayName("séparation des tâches lue dans la matrice ; aucune attribution ni retrait dans une autre société")
  void separationEtIsolation() throws Exception {
    asUser(ADMIN_A, "SELECT assign_budget_role('" + MEMBRE_A + "', 'budget_planner', 'assign')::text");
    assertThatThrownBy(() -> asUser(ADMIN_A, "SELECT assign_budget_role('" + MEMBRE_A + "', 'budget_approver', 'assign')::text"))
        .hasMessageContaining("SoD");
    asUser(ADMIN_A, "SELECT assign_budget_role('" + MEMBRE_A + "', 'budget_planner', 'revoke')::text");

    // B détient un rôle de trésorerie ; l'administrateur de A ne peut ni le retirer ni en ajouter.
    asUser(ADMIN_B, "SELECT assign_treasury_role('" + ADMIN_B + "', 'treasury_clerk', 'assign')::text");
    assertThatThrownBy(() -> asUser(ADMIN_A, "SELECT assign_treasury_role('" + ADMIN_B + "', 'treasury_clerk', 'revoke')::text"))
        .hasMessageContaining("Utilisateur cible non rattaché à votre société");
    assertThatThrownBy(() -> asUser(ADMIN_A, "SELECT assign_risk_role('" + ADMIN_B + "', 'risk_owner', 'grant')::text"))
        .hasMessageContaining("Utilisateur cible non rattaché à votre société");
    assertThat(asUser(ADMIN_B, "SELECT has_role(auth.uid(), 'treasury_clerk')::text")).isEqualTo("true");

    // La société ne vient plus d'un paramètre fourni par le client.
    assertThatThrownBy(() -> asUser(ADMIN_A, "SELECT assign_crm_role('" + MEMBRE_A + "', 'crm_agent', 'grant', NULL, '" + B + "')::text"))
        .hasMessageContaining("CRM_FORBIDDEN");
    assertThatThrownBy(() -> asUser(ADMIN_A, "SELECT assign_project_role('" + B + "', '" + MEMBRE_A + "', 'project_planner', 'grant')::text"))
        .hasMessageContaining("tenant mismatch");
    assertThat(count("SELECT count(*) FROM crm_role_audit WHERE tenant_id = '" + B + "'")).isZero();

    // Un membre sans droit d'administration ne peut rien attribuer.
    assertThatThrownBy(() -> asUser(MEMBRE_A, "SELECT assign_sales_role('" + MEMBRE_A + "', 'sales_rep', 'assign')::text"))
        .hasMessageContaining("Admin only");
  }

  @Test
  @DisplayName("on rejoint une société avec un code d'invitation à usage unique, jamais par son nom")
  void invitation() throws Exception {
    String nomDeA = rows("SELECT name FROM tenants WHERE id = '" + A + "'");
    // Un membre de B qui tape le nom de A : refusé (avant V31, il entrait dans A).
    assertThatThrownBy(() -> asUser(ADMIN_B, "SELECT join_tenant('" + nomDeA.replace("'", "''") + "')::text"))
        .hasMessageContaining("déjà rattaché");
    // Une personne sans société qui tape le nom : refusé aussi, sans indice.
    assertThatThrownBy(() -> asUser(NOUVEAU, "SELECT join_tenant('" + nomDeA.replace("'", "''") + "')::text"))
        .hasMessageContaining("Code d'invitation invalide ou expiré");
    // Seul un administrateur émet un code.
    assertThatThrownBy(() -> asUser(MEMBRE_A, "SELECT create_tenant_invitation()::text"))
        .hasMessageContaining("Seul un administrateur");

    String code = asUser(ADMIN_A, "SELECT create_tenant_invitation(NULL, 7, 'essai')->>'code'");
    assertThat(code).matches("[0-9A-F]{4}(-[0-9A-F]{4}){3}");
    assertThat(asUser(NOUVEAU, "SELECT join_tenant(lower('" + code + "'))::text")).isEqualTo(A);
    assertThat(asUser(NOUVEAU, "SELECT (my_access()->'roles')::text")).isEqualTo("[\"viewer\"]");
    assertThat(asUser(NOUVEAU, "SELECT count(*)::text FROM customers")).isEqualTo("3");
    // Usage unique, et une société déjà rejointe ne se quitte pas par une nouvelle création.
    assertThatThrownBy(() -> asUser(ADMIN_B, "SELECT join_tenant('" + code + "')::text")).hasMessageContaining("déjà rattaché");
    assertThatThrownBy(() -> asUser(NOUVEAU, "SELECT create_tenant_for_user('Autre société')::text")).hasMessageContaining("déjà rattaché");
    assertThat(count("SELECT count(*) FROM tenant_invitations WHERE code = '" + code + "' AND used_by = '" + NOUVEAU + "'")).isEqualTo(1);

    // Révocation : un code révoqué n'ouvre plus rien ; B ne voit pas les invitations de A.
    String id = asUser(ADMIN_A, "SELECT create_tenant_invitation()->>'id'");
    asUser(ADMIN_A, "SELECT revoke_tenant_invitation('" + id + "')::text");
    assertThat(asUser(ADMIN_B, "SELECT count(*)::text FROM tenant_invitations")).isEqualTo("0");
    assertThat(asUser(ADMIN_A, "SELECT count(*)::text FROM tenant_invitations WHERE revoked_at IS NOT NULL")).isEqualTo("1");
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
        String result = rs.next() ? rs.getString(1) : null;
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

  private static String rows(String sql) {
    try (Connection c = DriverManager.getConnection(
            PostgresFixture.urlOf(DATABASE), PostgresFixture.ADMIN_USER, PostgresFixture.ADMIN_PASSWORD);
        Statement st = c.createStatement();
        ResultSet rs = st.executeQuery(sql)) {
      return rs.next() ? rs.getString(1) : null;
    } catch (SQLException e) {
      throw new IllegalStateException("Observation échouée : " + sql, e);
    }
  }
}
