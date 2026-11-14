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
 * V65 (PC-4) — import guidé du plan comptable : contrôle ligne à ligne (doublon, format, parent, type
 * déduit du référentiel, compte existant), correction, validation par une autre personne (paramétrable),
 * application tout ou rien avec rattachement des parents ; droits et isolement des sociétés.
 */
@SpringBootTest
class ImportPlanComptableIT {

  private static final String DATABASE = "qerp_it_import_plan";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String PREPARATEUR = PostgresFixture.ALPHA_USER;
  private static final String VALIDEUR = "aaaaaaaa-6565-0000-0000-000000000065";
  private static final String LECTEUR = "aaaaaaaa-6565-0000-0000-000000000066";
  private static final String AUTRE = PostgresFixture.BETA_USER;

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
    PostgresFixture.grantRoles(DATABASE, PREPARATEUR, "accountant", A, VALIDEUR, "admin", A, LECTEUR, "viewer", A,
        AUTRE, "admin", PostgresFixture.BETA_TENANT);
  }

  private static String preparer(String user, String lignes) throws SQLException {
    return asUser(user, "SELECT prepare_chart_import(NULL, 'plan.csv', '"
        + lignes + "'::jsonb)::text");
  }

  private static String etat(String run) {
    return texte("SELECT string_agg(line_no || ':' || action || ':' || status, ' ' ORDER BY line_no) FROM chart_import_rows WHERE run_id = '" + run + "'");
  }

  @Test
  @DisplayName("contrôle, correction, validation par une autre personne, tout ou rien, parents rattachés")
  void importGuide() throws SQLException {
    String run = preparer(PREPARATEUR, "[{\"code\":\"6056\",\"name\":\"Achats de petit matériel\",\"header\":\"oui\"},"
        + "{\"code\":\"605610\",\"name\":\"Petit matériel informatique\",\"type\":\"Charges\",\"parent\":\"6056\"},"
        + "{\"code\":\"605620\",\"name\":\"Petit outillage\"},"
        + "{\"code\":\"605620\",\"name\":\"Doublon\"},"
        + "{\"code\":\"701\",\"name\":\"Ventes de marchandises\",\"type\":\"Produits\"}]");
    assertThat(etat(run)).isEqualTo("1:create:ok 2:create:ok 3:create:error 4:create:error 5:skip:ok");
    assertThat(texte("SELECT string_agg(code || ':' || name, ' ') FROM import_profiles WHERE tenant_id IS NULL"))
        .as("V68 : un seul format standard, aucun profil à choisir").isEqualTo("QUOREICH:Format standard");

    assertThatThrownBy(() -> asUser(VALIDEUR, "SELECT validate_chart_import('" + run + "')::text")).hasMessageContaining("ligne(s) en erreur");
    String ligne4 = texte("SELECT id::text FROM chart_import_rows WHERE run_id = '" + run + "' AND line_no = 4");
    assertThatThrownBy(() -> asUser(LECTEUR, "SELECT update_chart_import_row('" + ligne4 + "', '605620', 'Doublon', NULL, NULL, false, true)::text"))
        .hasMessageContaining("Droit insuffisant");
    asUser(PREPARATEUR, "SELECT update_chart_import_row(id, code, name, account_type, parent_code, is_header, true)::text FROM chart_import_rows WHERE run_id = '"
        + run + "' AND line_no = 4");
    assertThat(etat(run)).isEqualTo("1:create:ok 2:create:ok 3:create:ok 4:skip:ok 5:skip:ok");

    assertThatThrownBy(() -> asUser(PREPARATEUR, "SELECT validate_chart_import('" + run + "')::text"))
        .as("le comptable n'a pas le droit de valider").hasMessageContaining("Droit insuffisant");
    owner("SELECT set_config('qerp.system_roles_seed', 'on', false); INSERT INTO erp_role_permissions (role_id, permission_code) SELECT id, 'accounting.import_validate' FROM erp_roles WHERE tenant_id = '" + A
        + "' AND code = 'accountant' ON CONFLICT DO NOTHING");
    assertThatThrownBy(() -> asUser(PREPARATEUR, "SELECT validate_chart_import('" + run + "')::text"))
        .as("séparation des tâches").hasMessageContaining("autre personne");

    assertThat(asUser(VALIDEUR, "SELECT validate_chart_import('" + run + "') ->> 'crees'")).isEqualTo("3");
    assertThat(texte("SELECT string_agg(g.code || ':' || g.account_type || ':' || g.is_header || ':' || COALESCE(p.code, '-'), ' ' ORDER BY g.code) FROM gl_accounts g"
        + " LEFT JOIN gl_accounts p ON p.id = g.parent_id WHERE g.tenant_id = '" + A + "' AND g.code LIKE '6056%'"))
        .as("types déduits du référentiel, parents rattachés").isEqualTo("6056:expense:true:- 605610:expense:false:6056 605620:expense:false:6056");
    assertThat(texte("SELECT count(*)::text FROM gl_account_history WHERE tenant_id = '" + A + "' AND account_code LIKE '6056%' AND action = 'insert'")).isEqualTo("3");
    assertThatThrownBy(() -> asUser(PREPARATEUR, "SELECT update_chart_import_row(id, code, name, account_type, parent_code, is_header, true)::text FROM chart_import_rows WHERE run_id = '"
        + run + "' AND line_no = 1")).hasMessageContaining("déjà validé");
  }

  @Test
  @DisplayName("validation par la même personne si la société le permet ; tout ou rien ; isolement ; lecteur refusé")
  void parametresEtDroits() throws SQLException {
    assertThatThrownBy(() -> preparer(LECTEUR, "[{\"code\":\"6057\",\"name\":\"x\"}]")).hasMessageContaining("Droit insuffisant");
    owner("INSERT INTO chart_import_settings (tenant_id, require_second_person) VALUES ('" + A + "', false)"
        + " ON CONFLICT (tenant_id) DO UPDATE SET require_second_person = false");
    String run = preparer(VALIDEUR, "[{\"code\":\"6057\",\"name\":\"Fournitures atelier\"},{\"code\":\"605710\",\"name\":\"Fournitures V65\"}]");
    assertThat(asUser(AUTRE, "SELECT count(*)::text FROM chart_import_runs WHERE id = '" + run + "'")).as("autre société : invisible").isEqualTo("0");
    assertThatThrownBy(() -> asUser(AUTRE, "SELECT validate_chart_import('" + run + "')::text")).hasMessageContaining("introuvable");

    owner("INSERT INTO gl_account_attribute_definitions (tenant_id, key, label, data_type, required) VALUES ('" + A + "', 'v65_req', 'Responsable V65', 'text', true)");
    assertThatThrownBy(() -> asUser(VALIDEUR, "SELECT validate_chart_import('" + run + "')::text")).as("attribut obligatoire : refus, rien n'est créé")
        .hasMessageContaining("ligne(s) en erreur");
    assertThat(texte("SELECT count(*)::text FROM gl_accounts WHERE tenant_id = '" + A + "' AND code LIKE '6057%'")).isEqualTo("0");
    owner("DELETE FROM gl_account_attribute_definitions WHERE tenant_id = '" + A + "' AND key = 'v65_req'");

    assertThat(asUser(VALIDEUR, "SELECT validate_chart_import('" + run + "') ->> 'rattaches'")).as("même personne autorisée par le paramètre").isEqualTo("1");
    owner("UPDATE chart_import_settings SET require_second_person = true WHERE tenant_id = '" + A + "'");
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
