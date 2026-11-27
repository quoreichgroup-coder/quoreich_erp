package com.quoreich.qerp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.quoreich.qerp.platform.PublicErrorDetails;
import com.quoreich.qerp.tenant.TenantContextHolder;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

/**
 * V155 — langues et formats (PoC i18n). Préférences résolues et validées par la base, droit
 * {@code languages.settings}, isolation entre sociétés, refus métier porteur d'une clé (base et API),
 * facture émise en anglais avec langue, locale et modèle figés avant le hachage.
 */
@SpringBootTest
@AutoConfigureMockMvc
class LanguesEtFormatsIT {

  private static final String DATABASE = "qerp_it_langues_formats";
  private static final String T1 = "55555555-5555-5555-5555-555555555155";
  private static final String T2 = "55555555-5555-5555-5555-555555555255";
  private static final String ADMIN = "55555555-0000-0000-0000-000000000155";
  private static final String MEMBER = "55555555-0000-0000-0000-000000000255";
  private static final String ADMIN2 = "55555555-0000-0000-0000-000000000355";
  private static final String CUSTOMER = "55555555-0000-0000-0000-000000000455";
  private static final String INVOICE = "55555555-0000-0000-0000-000000000555";
  private static final String CUSTOMER2 = "55555555-0000-0000-0000-000000000655";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @Autowired private MockMvc mvc;

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    if (PostgresFixture.countAsAdmin(DATABASE, "SELECT count(*) FROM tenants WHERE id = '" + T1 + "'") == 0) {
      owner("""
          INSERT INTO tenants (id, name) VALUES ('%1$s', 'Société langues'), ('%2$s', 'Autre société langues');
          INSERT INTO auth.users (id) VALUES ('%3$s'), ('%4$s'), ('%5$s');
          INSERT INTO profiles (id, tenant_id, full_name) VALUES ('%3$s', '%1$s', 'Admin'), ('%4$s', '%1$s', 'Membre'), ('%5$s', '%2$s', 'Admin 2');
          INSERT INTO customers (id, tenant_id, name) VALUES ('%6$s', '%1$s', 'Customer Ltd'), ('%7$s', '%2$s', 'Client sans plan');
          """.formatted(T1, T2, ADMIN, MEMBER, ADMIN2, CUSTOMER, CUSTOMER2));
      PostgresFixture.grantRoles(DATABASE, ADMIN, "admin", T1, MEMBER, "viewer", T1, ADMIN2, "admin", T2);
    }
    TenantContextHolder.clear();
  }

  private static RequestPostProcessor as(String user) {
    return jwt().jwt(b -> b.subject(user));
  }

  @Test
  @DisplayName("préférences : résolution, repli sur une langue retirée sans réécriture, validation sur tous les chemins, droits et isolation")
  void preferences() throws Exception {
    // Rien de réglé : langue source, sa locale par défaut, aucun fuseau.
    assertThat(user(MEMBER, "SELECT my_language_context()->>'language' || ' ' || (my_language_context()->>'locale')")).isEqualTo("fr fr-FR");
    // Interface anglaise avec dates françaises : langue et locale indépendantes.
    assertThat(user(MEMBER, "SELECT set_my_language_preferences('en', 'fr-BF')->>'language'")).isEqualTo("en");
    assertThat(user(MEMBER, "SELECT my_language_context()->>'locale'")).isEqualTo("fr-BF");

    // Le réglage de la société exige languages.settings (le lecteur ne l'a pas).
    assertThatThrownBy(() -> user(MEMBER, "SELECT set_company_language_settings('en', 'en-GB', 'Africa/Ouagadougou', ARRAY['fr','en'])"))
        .extracting("SQLState").isEqualTo("42501");
    SQLException fuseau = catchSql(() -> user(ADMIN, "SELECT set_company_language_settings('fr', 'fr-BF', 'Mars/Olympus', ARRAY['fr'])"));
    assertThat(fuseau.getSQLState()).isEqualTo("QG039");
    assertThat(PublicErrorDetails.from(fuseau).key()).isEqualTo("errors:i18n.timezone_invalid");

    // La société retire l'anglais : la préférence du membre est ignorée (repli), pas effacée.
    user(ADMIN, "SELECT set_company_language_settings('fr', 'fr-BF', 'Africa/Ouagadougou', ARRAY['fr'])");
    assertThat(user(MEMBER, "SELECT my_language_context()->>'language' || ' ' || (my_language_context()->>'timezone')"))
        .isEqualTo("fr Africa/Ouagadougou");
    assertThat(PostgresFixture.textAsAdmin(DATABASE, "SELECT language FROM profiles WHERE id = '" + MEMBER + "'")).isEqualTo("en");
    // … et ne peut plus être choisie, ni par la fonction ni par une mise à jour directe du profil.
    SQLException refus = catchSql(() -> user(MEMBER, "SELECT set_my_language_preferences('en', NULL)"));
    assertThat(refus.getSQLState()).isEqualTo("QG039");
    var keyed = PublicErrorDetails.from(refus);
    assertThat(keyed.key()).isEqualTo("errors:i18n.language_not_allowed");
    assertThat(keyed.params()).containsEntry("language", "en");
    user(MEMBER, "SELECT set_my_language_preferences(NULL, NULL)");
    // Mise à jour directe du profil : déjà refusée à l'utilisateur par les droits existants…
    assertThatThrownBy(() -> user(MEMBER, "UPDATE profiles SET language = 'en' WHERE id = auth.uid() RETURNING id"))
        .extracting("SQLState").isEqualTo("42501");
    // … et le garde V155 s'applique à tout écrivain, propriétaire compris (langue retirée, langue inconnue).
    assertThatThrownBy(() -> owner("UPDATE profiles SET language = 'en' WHERE id = '" + MEMBER + "'"))
        .hasMessageContaining("Langue non autorisée");
    assertThatThrownBy(() -> owner("UPDATE profiles SET language = 'de' WHERE id = '" + MEMBER + "'"))
        .hasMessageContaining("Langue non autorisée");
    assertThatThrownBy(() -> owner("UPDATE profiles SET locale = 'de-DE' WHERE id = '" + MEMBER + "'"))
        .hasMessageContaining("supported_locales");
    // La langue source reste toujours autorisée.
    assertThat(user(ADMIN, "SELECT set_company_language_settings('fr', NULL, NULL, ARRAY['en'])->'tenant_languages'"))
        .contains("fr").contains("en");

    // Isolation : l'autre société ne voit pas ces réglages et ne les modifie pas.
    assertThat(user(ADMIN2, "SELECT count(*) FROM tenant_languages")).isEqualTo("0");
    user(ADMIN2, "SELECT set_company_language_settings('en', 'en-US', NULL, ARRAY['fr','en'])");
    assertThat(PostgresFixture.textAsAdmin(DATABASE, "SELECT default_language || ' ' || coalesce(timezone, '-') FROM tenants WHERE id = '" + T1 + "'"))
        .isEqualTo("fr -");
    assertThat(user(ADMIN2, "SELECT my_language_context()->>'language'")).isEqualTo("en");
    assertThat(user(ADMIN2, "SELECT count(*) FROM profiles WHERE language IS NOT NULL AND tenant_id = '" + T1 + "'")).isEqualTo("0");

    // Langue source protégée, même pour le propriétaire.
    assertThatThrownBy(() -> owner("UPDATE languages SET is_active = false WHERE code = 'fr'")).hasMessageContaining("langue source");
    user(ADMIN, "SELECT set_company_language_settings(NULL, NULL, NULL, NULL)");
  }

  @Test
  @DisplayName("API : contexte de langue, réglage par l'utilisateur, refus traduisible (code, key, params, error) et route société protégée")
  void api() throws Exception {
    mvc.perform(get("/api/v1/me/language").with(as(MEMBER))).andExpect(status().isOk())
        .andExpect(jsonPath("$.source_language").value("fr"))
        .andExpect(jsonPath("$.languages[1].code").value("en"))
        .andExpect(jsonPath("$.locales.length()").value(4));
    mvc.perform(put("/api/v1/me/language").with(as(MEMBER)).contentType(MediaType.APPLICATION_JSON)
        .content("{\"language\":\"de\",\"locale\":null}"))
        .andExpect(status().isUnprocessableContent())
        .andExpect(jsonPath("$.code").value("QG039"))
        .andExpect(jsonPath("$.key").value("errors:i18n.language_not_allowed"))
        .andExpect(jsonPath("$.params.language").value("de"))
        .andExpect(jsonPath("$.error").value("Langue non autorisée pour cette société : de"));
    mvc.perform(put("/api/v1/languages/settings").with(as(MEMBER)).contentType(MediaType.APPLICATION_JSON)
        .content("{\"default_language\":\"en\",\"languages\":[\"fr\",\"en\"]}")).andExpect(status().isForbidden());
    mvc.perform(put("/api/v1/languages/settings").with(as(ADMIN)).contentType(MediaType.APPLICATION_JSON)
        .content("{\"default_language\":\"en\",\"default_locale\":\"en-GB\",\"timezone\":\"Africa/Abidjan\",\"languages\":[\"fr\",\"en\"]}"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.language").value("en"));
    mvc.perform(put("/api/v1/languages/settings").with(as(ADMIN)).contentType(MediaType.APPLICATION_JSON)
        .content("{\"default_language\":null,\"languages\":[]}")).andExpect(status().isOk());

    // Refus réel de la comptabilisation (chemin AR du lot 2) : société sans paramétrage comptable
    // (la seconde société n'en reçoit jamais dans cette classe).
    mvc.perform(post("/api/v1/ar/invoices").with(as(ADMIN2)).contentType(MediaType.APPLICATION_JSON)
        .content("{\"invoiceNumber\":\"LG-001\",\"customerId\":\"" + CUSTOMER2 + "\",\"invoiceDate\":\"2031-05-02\","
            + "\"dueDate\":\"2031-06-01\",\"subtotal\":1250300,\"taxAmount\":0}"))
        .andExpect(status().isUnprocessableContent())
        .andExpect(jsonPath("$.code").value("QG001"))
        .andExpect(jsonPath("$.key").value("errors:posting.account_missing"))
        .andExpect(jsonPath("$.params.roles[0]").value("AR_RECEIVABLE"))
        // Numéro définitif attribué à l'émission (numérotation automatique) : c'est lui que nomme le refus.
        .andExpect(jsonPath("$.params.document").value(org.hamcrest.Matchers.not(org.hamcrest.Matchers.emptyString())))
        .andExpect(jsonPath("$.error").value(org.hamcrest.Matchers.startsWith("Paramétrage comptable incomplet")));
  }

  @Test
  @DisplayName("facture en anglais : refus explicite sans modèle anglais, puis langue, locale et modèle figés ; bascule FR sans effet sur l'archive")
  void factureEnAnglais() throws Exception {
    PostgresFixture.applySyscohada(DATABASE, T1);
    owner("""
        UPDATE customers SET document_language = 'en' WHERE id = '%s';
        INSERT INTO ar_invoices (id, tenant_id, invoice_number, customer_id, invoice_date, due_date, status, created_by)
          VALUES ('%s', '%s', 'LG-EN-1', '%s', '2031-05-02', '2031-06-01', 'draft', '%s');
        INSERT INTO ar_invoice_lines (tenant_id, invoice_id, line_no, description, quantity, unit_price, discount_pct)
          VALUES ('%s', '%s', 1, 'Consulting', 1, 1250300, 0);
        """.formatted(CUSTOMER, INVOICE, T1, CUSTOMER, ADMIN, T1, INVOICE));
    owner("UPDATE ar_invoices SET status = 'sent' WHERE id = '" + INVOICE + "'");
    String layout = "'{\"title\":\"%s\",\"intro\":\"\",\"footer\":\"\",\"accent_color\":\"#17324D\",\"font_size\":10}'";

    // Modèle français seulement : le client anglophone n'obtient pas une pièce en français.
    String fr = user(ADMIN, "SELECT save_document_template(NULL, 'Standard FR', " + layout.formatted("Facture") + ", 'Initial')->'version'->>'id'");
    user(ADMIN, "SELECT publish_document_template('" + fr + "', 'Publication')");
    SQLException manque = catchSql(() -> user(ADMIN, "SELECT request_document_edition('" + INVOICE + "')"));
    assertThat(manque.getSQLState()).isEqualTo("QG038");
    assertThat(PublicErrorDetails.from(manque).key()).isEqualTo("errors:documents.template_missing_language");
    assertThat(PublicErrorDetails.from(manque).params()).containsEntry("language", "en");
    // Langue d'un modèle figée ; bons de commande en français seulement.
    String frTemplate = user(ADMIN, "SELECT template_id::text FROM document_template_versions WHERE id = '" + fr + "'");
    assertThatThrownBy(() -> user(ADMIN, "SELECT save_document_template('" + frTemplate + "', 'X', " + layout.formatted("X") + ", 'Essai', 'en')"))
        .extracting("SQLState").isEqualTo("QG039");

    String en = user(ADMIN, "SELECT save_document_template(NULL, 'Standard EN', " + layout.formatted("Invoice") + ", 'Initial', 'en')->'version'->>'id'");
    user(ADMIN, "SELECT publish_document_template('" + en + "', 'Publication')");
    assertThat(user(ADMIN, "SELECT content_html LIKE '%<html lang=\"en\">%Customer%Unit price%' FROM document_template_versions WHERE id = '" + en + "'"))
        .isEqualTo("t");

    String edition = user(ADMIN, "SELECT request_document_edition('" + INVOICE + "')->>'id'");
    assertThat(PostgresFixture.textAsAdmin(DATABASE, "SELECT concat_ws(' ', language, locale, template_version_id, context #>> '{meta,language}', "
        + "context #>> '{meta,locale}', context_sha256 = document_hash(context::text)) FROM issued_documents WHERE id = '" + edition + "'"))
        .isEqualTo("en en-GB " + en + " en en-GB t");
    String html = apiWorker(ADMIN, "SELECT claim_document_edition('" + edition + "', '" + ADMIN + "')->>'html'");
    assertThat(html).contains("<html lang=\"en\">", "Customer Ltd", "Issued on 2031-05-02", "1250300")
        .doesNotContain("Émise le", "Désignation");
    String pdfHash = "c".repeat(64);
    worker("SELECT complete_document_edition('" + edition + "', '" + ADMIN + "', '" + T1 + "/issued/" + edition + ".pdf', '"
        + pdfHash + "', 'Gotenberg', '9.2')");
    String before = user(ADMIN, "SELECT context_sha256 || ' ' || pdf_sha256 || ' ' || language FROM issued_documents WHERE id = '" + edition + "'");

    // L'utilisateur repasse en français, la société aussi : l'édition archivée ne bouge pas.
    user(ADMIN, "SELECT set_my_language_preferences('fr', 'fr-FR')");
    user(ADMIN, "SELECT set_company_language_settings('fr', 'fr-FR', NULL, NULL)");
    assertThat(user(ADMIN, "SELECT context_sha256 || ' ' || pdf_sha256 || ' ' || language FROM issued_documents WHERE id = '" + edition + "'"))
        .isEqualTo(before);
    assertThat(user(ADMIN, "SELECT request_document_edition('" + INVOICE + "')->>'id'")).isEqualTo(edition);
    // Un remplacement garde la langue de l'édition remplacée, même si le client change d'avis.
    owner("UPDATE customers SET document_language = 'fr' WHERE id = '" + CUSTOMER + "'");
    String replacement = user(ADMIN, "SELECT request_document_edition('" + INVOICE + "', NULL, '" + edition + "', 'Coquille')->>'id'");
    assertThat(user(ADMIN, "SELECT language FROM issued_documents WHERE id = '" + replacement + "'")).isEqualTo("en");
    // L'autre société ne voit aucune édition.
    assertThat(user(ADMIN2, "SELECT count(*) FROM issued_documents")).isEqualTo("0");
  }

  // ─── Outils ───

  private interface SqlCall { void run() throws Exception; }

  private static SQLException catchSql(SqlCall call) {
    try {
      call.run();
    } catch (SQLException e) {
      return e;
    } catch (Exception e) {
      throw new AssertionError(e);
    }
    throw new AssertionError("refus attendu");
  }

  private static void owner(String sql) {
    PostgresFixture.execute(PostgresFixture.urlOf(DATABASE), sql);
  }

  private static String user(String actor, String sql) throws SQLException {
    return query("authenticated", actor, sql);
  }

  private static String worker(String sql) throws SQLException {
    return query("service_role", null, sql);
  }

  private static String apiWorker(String actor, String sql) throws SQLException {
    return query(PostgresFixture.API_USER, actor, sql);
  }

  private static String query(String role, String actor, String sql) throws SQLException {
    boolean apiLogin = role.equals(PostgresFixture.API_USER);
    try (Connection connection = DriverManager.getConnection(PostgresFixture.urlOf(DATABASE),
        apiLogin ? PostgresFixture.API_USER : PostgresFixture.ADMIN_USER,
        apiLogin ? PostgresFixture.API_PASSWORD : PostgresFixture.ADMIN_PASSWORD)) {
      connection.setAutoCommit(false);
      if (!apiLogin) {
        try (Statement statement = connection.createStatement()) {
          statement.execute("SET LOCAL ROLE " + role);
        }
      }
      if (actor != null) {
        try (PreparedStatement claims = connection.prepareStatement("SELECT set_config('request.jwt.claims', ?, true)")) {
          claims.setString(1, "{\"sub\":\"" + actor + "\",\"role\":\"authenticated\"}");
          claims.execute();
        }
      }
      try (Statement statement = connection.createStatement(); ResultSet result = statement.executeQuery(sql)) {
        String value = result.next() ? result.getString(1) : null;
        connection.commit();
        return value;
      }
    }
  }
}
