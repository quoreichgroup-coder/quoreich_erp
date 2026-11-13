package com.quoreich.qerp;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.LinkedHashSet;
import java.util.Set;
import java.util.TreeSet;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationInfo;
import org.flywaydb.core.api.MigrationState;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Reconstruit le schéma depuis une base vide, avec PostgreSQL 18.6 et Flyway 13.12.1.
 *
 * <h2>Ce que ce test ajoute à la preuve du lot 0</h2>
 * Le script {@code verify-lot0.sh} prouve la parité objet par objet, mais il
 * applique les migrations avec {@code psql}. Ici, ce sont les migrations
 * <em>pilotées par Spring Boot</em> qui s'exécutent, avec Flyway surchargé en
 * 13.12.1 contre le 12.4.0 du BOM 4.1.2. Une surcharge de version qui casserait
 * l'auto-configuration de Boot se manifesterait par un échec de démarrage du
 * contexte, donc par l'échec de cette classe — pas par un avertissement que
 * personne ne lit.
 *
 * <p>La comparaison porte sur des <b>ensembles de noms d'objets</b>, jamais sur
 * des totaux : un total juste peut cacher un objet manquant compensé par un
 * objet en trop.
 */
@SpringBootTest
class SchemaMigrationIT {

  private static final String DATABASE = "qerp_it_schema";

  /**
   * Table de suivi de Flyway, et seule table du schéma qui n'appartient pas au
   * référentiel métier.
   *
   * <p>Flyway la crée dans le premier schéma géré — {@code public} — au premier
   * déploiement. Elle n'existe donc pas dans le dump d'origine, et le manifeste
   * de parité ne la connaît pas. C'est la seule exception, et
   * {@link #laSeuleTableHorsReferentielMetierEstCelleDeFlyway()} l'affirme
   * explicitement plutôt que de la filtrer en silence.
   */
  private static final String TABLE_HISTORIQUE_FLYWAY = "flyway_schema_history";

  private static final ManifestReference MANIFESTE = ManifestReference.charger();

  /** Dernière migration attendue. V1..V15 = base de référence (dump) ; au-delà, évolutions. */
  private static final String DERNIERE_MIGRATION = "26";

  /**
   * Écarts <b>voulus</b> au manifeste de référence, introduits après V15 et déclarés un par un.
   *
   * <p>Le manifeste reste la photographie du dump de production ({@code verify-lot0.sh} compare
   * V1..V15 au dump, pas au-delà) ; les évolutions sont listées ici plutôt que réécrites dans le
   * manifeste, pour que l'écart reste lisible et justifié. V16 retire les déclencheurs branchés en
   * double sur la même fonction.
   */
  private static final Set<String> DECLENCHEURS_RETIRES =
      Set.of(
          "payments/trg_payment_gl",
          "payments/trg_payment_gl_posting",
          "goods_receipts/trg_gr_completed",
          "journal_entries/trg_journal_entry_audit");

  /** V18 — paramétrage comptable : référentiels et comptes de comptabilisation par société. */
  private static final Set<String> TABLES_AJOUTEES =
      Set.of(
          "accounting_frameworks",
          "accounting_framework_accounts",
          "posting_roles",
          "accounting_framework_role_defaults",
          "tenant_accounting_settings",
          "tenant_posting_accounts",
          // V19 — axes analytiques.
          "analytic_axes",
          "analytic_values",
          "analytic_rules",
          "analytic_defaults",
          "ar_invoice_analytics",
          "journal_line_analytics",
          // V21 — lignes de facture et codes TVA.
          "tax_codes",
          "ar_invoice_lines",
          // V22 — numérotation des factures.
          "document_counters",
          // V23 — rôles centralisés.
          "erp_permission_catalog",
          "erp_system_roles",
          "erp_system_role_permissions",
          "erp_role_permissions",
          "erp_authorization_audit");

  private static final Set<String> FONCTIONS_AJOUTEES =
      Set.of(
          "is_tenant_admin",
          "posting_account",
          "posting_roles_label",
          "apply_accounting_framework_to",
          "apply_accounting_framework",
          "tenant_has_any_role",
          "guard_journal_line_analytics",
          "guard_ar_invoice_analytics",
          "enforce_analytics",
          "guard_analytic_value_hierarchy",
          "guard_tax_code",
          "compute_ar_invoice_line",
          "sum_ar_invoice_lines",
          "impute_ar_revenue_line",
          "next_document_number",
          "assign_ar_invoice_number",
          "has_permission",
          "seed_tenant_system_roles",
          "on_tenant_seed_system_roles",
          "mirror_user_roles",
          "guard_system_roles",
          "legacy_has_role",
          "legacy_has_crm_perm",
          "legacy_has_hr_perm",
          "legacy_has_inventory_perm",
          "legacy_has_procurement_perm",
          "legacy_has_sales_perm",
          "legacy_has_treasury_perm",
          "guard_profile_tenant",
          "audit_authorizations",
          "mirror_role_assignments",
          "guard_role_assignments",
          "guard_role_in_use");

  private static final Set<String> POLITIQUES_AJOUTEES =
      Set.of(
          "accounting_frameworks/Lecture du référentiel",
          "accounting_framework_accounts/Lecture du référentiel",
          "posting_roles/Lecture du référentiel",
          "accounting_framework_role_defaults/Lecture du référentiel",
          "tenant_accounting_settings/Tenant isolation",
          "tenant_posting_accounts/Tenant isolation",
          "tenant_posting_accounts/Administrateur de la société",
          "analytic_axes/Tenant isolation",
          "analytic_axes/Administrateur de la société",
          "analytic_rules/Tenant isolation",
          "analytic_rules/Administrateur de la société",
          "analytic_values/Tenant isolation",
          "analytic_values/Gestion comptable",
          "analytic_defaults/Tenant isolation",
          "analytic_defaults/Gestion comptable",
          "ar_invoice_analytics/Tenant isolation",
          "ar_invoice_analytics/Gestion comptable",
          "journal_line_analytics/Tenant isolation",
          "journal_line_analytics/Gestion comptable",
          "tax_codes/Tenant isolation",
          "tax_codes/Administrateur de la société",
          "ar_invoice_lines/Tenant isolation",
          "ar_invoice_lines/Gestion comptable",
          "document_counters/Tenant isolation",
          "erp_permission_catalog/Lecture du référentiel",
          "erp_system_roles/Lecture du référentiel",
          "erp_system_role_permissions/Lecture du référentiel",
          "erp_role_permissions/Tenant isolation",
          "erp_role_permissions/Administrateur de la société",
          "erp_roles/Administrateur de la société",
          "erp_authorization_audit/Administrateur de la société");

  /** V19 — contrôle analytique à la comptabilisation et gardes des imputations. */
  private static final Set<String> DECLENCHEURS_AJOUTES =
      Set.of(
          "journal_entries/trg_enforce_analytics",
          "journal_line_analytics/trg_guard_journal_line_analytics",
          "ar_invoice_analytics/trg_guard_ar_invoice_analytics",
          "analytic_values/trg_guard_analytic_value_hierarchy",
          "tax_codes/trg_guard_tax_code",
          "ar_invoice_lines/trg_compute_ar_invoice_line",
          "ar_invoice_lines/trg_sum_ar_invoice_lines",
          "ar_invoices/trg_assign_ar_invoice_number",
          "tenants/trg_seed_system_roles",
          "user_roles/trg_mirror_user_roles",
          "erp_roles/trg_guard_system_roles",
          "erp_role_permissions/trg_guard_system_role_permissions",
          "profiles/trg_guard_profile_tenant",
          "erp_roles/trg_audit_erp_roles",
          "erp_role_permissions/trg_audit_erp_role_permissions",
          "user_role_assignments/trg_audit_user_role_assignments",
          "user_role_assignments/trg_mirror_role_assignments",
          "user_role_assignments/trg_guard_role_assignments",
          "erp_roles/trg_guard_role_in_use");

  /** Référence (manifeste du dump) plus les ajouts déclarés. */
  private static Set<String> avec(Set<String> reference, Set<String> ajouts) {
    Set<String> attendu = new LinkedHashSet<>(reference);
    assertThat(attendu).as("un ajout déclaré ne doit pas déjà exister dans le dump").doesNotContainAnyElementsOf(ajouts);
    attendu.addAll(ajouts);
    return attendu;
  }

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @Autowired private Flyway flyway;
  @Autowired private JdbcTemplate jdbc;

  @Test
  @DisplayName("les migrations s'appliquent toutes, sans échec ni résidu en attente")
  void toutesLesMigrationsSontAppliquees() {
    MigrationInfo[] appliquees = flyway.info().applied();

    assertThat(appliquees).isNotEmpty();
    assertThat(flyway.info().pending()).isEmpty();
    assertThat(appliquees).allMatch(info -> info.getState() == MigrationState.SUCCESS);
    assertThat(appliquees[appliquees.length - 1].getVersion().getVersion())
        .as("la dernière migration appliquée doit être V%s", DERNIERE_MIGRATION)
        .isEqualTo(DERNIERE_MIGRATION);
  }

  @Test
  @DisplayName("aucune fonction n'est branchée deux fois sur la même table")
  void aucuneFonctionDeclencheeEnDouble() {
    // Le dump en contenait trois (paiements ×3, réceptions ×2, audit ×2) : chaque
    // branchement réexécute la fonction, d'où des écritures et des mouvements de
    // stock en double. Ce garde-fou empêche qu'une migration en réintroduise un.
    assertThat(noms("""
        SELECT c.relname || '/' || p.proname || ' : ' || string_agg(t.tgname, ', ' ORDER BY t.tgname)
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE n.nspname = 'public' AND NOT t.tgisinternal
        GROUP BY c.relname, p.proname
        HAVING count(*) > 1
        """))
        .as("fonctions déclenchées plusieurs fois sur la même table")
        .isEmpty();
  }

  @Test
  @DisplayName("les tables du schéma reconstruit sont exactement celles du manifeste, plus celle de Flyway")
  void lesTablesCorrespondentAuManifeste() {
    Set<String> reconstruites = new LinkedHashSet<>(noms("""
        SELECT c.relname FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
          AND c.relname <> ?
        """, TABLE_HISTORIQUE_FLYWAY));

    memeEnsemble(avec(MANIFESTE.colonne("tables_columns", 0), TABLES_AJOUTEES), reconstruites, "tables");
  }

  @Test
  @DisplayName("la seule table hors référentiel métier est celle de Flyway")
  void laSeuleTableHorsReferentielMetierEstCelleDeFlyway() {
    Set<String> toutes = new LinkedHashSet<>(noms("""
        SELECT c.relname FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
        """));

    Set<String> horsManifeste = new TreeSet<>(toutes);
    horsManifeste.removeAll(avec(MANIFESTE.colonne("tables_columns", 0), TABLES_AJOUTEES));

    assertThat(horsManifeste)
        .as("toute autre table inattendue signalerait un objet créé hors des migrations du lot 0")
        .containsExactly(TABLE_HISTORIQUE_FLYWAY);
  }

  @Test
  @DisplayName("les vues, fonctions, déclencheurs, politiques, séquences et clés étrangères correspondent au manifeste")
  void lesAutresObjetsCorrespondentAuManifeste() {
    memeEnsemble(MANIFESTE.colonne("views", 0), new LinkedHashSet<>(noms("""
        SELECT c.relname FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
        """)), "vues");

    memeEnsemble(avec(MANIFESTE.colonne("functions", 0), FONCTIONS_AJOUTEES), new LinkedHashSet<>(noms("""
        SELECT DISTINCT p.proname FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
        """)), "fonctions");

    Set<String> declencheursAttendus = new LinkedHashSet<>(MANIFESTE.cles("triggers", 0, 1));
    assertThat(declencheursAttendus)
        .as("chaque déclencheur déclaré retiré doit exister dans le manifeste de référence")
        .containsAll(DECLENCHEURS_RETIRES);
    declencheursAttendus.removeAll(DECLENCHEURS_RETIRES);
    declencheursAttendus = avec(declencheursAttendus, DECLENCHEURS_AJOUTES);
    memeEnsemble(declencheursAttendus, new LinkedHashSet<>(noms("""
        SELECT c.relname || '/' || t.tgname FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND NOT t.tgisinternal
        """)), "déclencheurs");

    memeEnsemble(avec(MANIFESTE.cles("policies", 1, 2), POLITIQUES_AJOUTEES), new LinkedHashSet<>(noms("""
        SELECT tablename || '/' || policyname FROM pg_policies WHERE schemaname = 'public'
        """)), "politiques RLS");

    memeEnsemble(MANIFESTE.colonne("sequences", 0), new LinkedHashSet<>(noms("""
        SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public'
        """)), "séquences");

    memeEnsemble(MANIFESTE.cles("fk_to_auth_users", 0, 1), new LinkedHashSet<>(noms("""
        SELECT c.relname || '/' || con.conname FROM pg_constraint con
        JOIN pg_class c ON c.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND con.contype = 'f'
          AND con.confrelid = 'auth.users'::regclass
        """)), "clés étrangères vers auth.users");
  }

  @Test
  @DisplayName("la RLS est active exactement sur les tables du manifeste, et FORCE est absent partout")
  void laRlsEstActiveSansEtreForceeSurLesProprietaires() {
    memeEnsemble(avec(MANIFESTE.tablesAvecRlsActive(), TABLES_AJOUTEES), new LinkedHashSet<>(noms("""
        SELECT c.relname FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity
        """)), "tables avec RLS activée");

    // FORCE ROW LEVEL SECURITY reste absent : c'est ce qui rend le rôle de
    // connexion critique, donc le garde-fou de démarrage nécessaire. Le jour où
    // une migration l'activera, ce test le dira et DatabaseSecurityGuard
    // pourra être allégé — pas avant.
    assertThat(compter("""
        SELECT count(*) FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relforcerowsecurity
        """))
        .as("tables en FORCE ROW LEVEL SECURITY — attendu 0")
        .isZero();
  }

  @Test
  @DisplayName("la connexion applicative est non propriétaire, sans BYPASSRLS, membre de authenticated")
  void laConnexionApplicativeSubitLaRls() {
    // Ce test passe si le contexte a démarré : DatabaseSecurityGuard refuse le
    // démarrage dans le cas contraire. On rejoue le verdict ici pour que le
    // constat soit lisible dans le rapport, et pas seulement implicite.
    assertThat(compter("""
        SELECT count(*) FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
          AND pg_get_userbyid(c.relowner) = current_user
        """))
        .isZero();

    assertThat(jdbc.queryForObject("SELECT current_user", String.class))
        .isEqualTo(PostgresFixture.API_USER);
  }

  /** Liste de noms, dans l'ordre du serveur, pour que l'écart affiché soit lisible. */
  private Set<String> noms(String sql, Object... parametres) {
    return new LinkedHashSet<>(jdbc.queryForList(sql, String.class, parametres));
  }

  private long compter(String sql) {
    Long valeur = jdbc.queryForObject(sql, Long.class);
    return valeur == null ? -1L : valeur;
  }

  /**
   * Compare deux ensembles et nomme séparément les manquants et les superflus.
   *
   * <p>Un {@code containsExactlyInAnyOrderElementsOf} sur 157 politiques rend, en
   * cas d'écart, un message de 157 lignes où l'objet fautif est invisible. Ici
   * l'échec nomme l'écart, et rien d'autre.
   */
  private void memeEnsemble(Set<String> attendu, Set<String> constate, String quoi) {
    Set<String> manquants = new TreeSet<>(attendu);
    manquants.removeAll(constate);
    Set<String> superflus = new TreeSet<>(constate);
    superflus.removeAll(attendu);

    assertThat(manquants).as("%s du manifeste absents du schéma reconstruit", quoi).isEmpty();
    assertThat(superflus)
        .as("%s absents du manifeste mais présents dans le schéma reconstruit", quoi)
        .isEmpty();
  }
}
