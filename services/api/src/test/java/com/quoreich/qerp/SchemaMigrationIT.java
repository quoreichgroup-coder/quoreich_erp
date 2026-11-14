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
  private static final String DERNIERE_MIGRATION = "55";

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

  /** V32 — user_roles, table de transition depuis V23, est supprimée avec ses politiques. */
  private static final Set<String> TABLES_RETIREES = Set.of("user_roles");

  private static final Set<String> POLITIQUES_RETIREES =
      Set.of(
          "user_roles/Admins delete roles",
          "user_roles/Admins insert roles",
          "user_roles/Admins update roles",
          "user_roles/Admins view all roles",
          "user_roles/Users can view own roles",
          // V34 — FOR ALL à tout membre, annulait les politiques comptable / administrateur.
          "journal_lines/Access via entry",
          // V40 — paramètres des ventes : lecture pour tous, modification par l'administrateur.
          "sales_settings/tenant rw sales_settings",
          // V48 — clients et paramètres AR : plus d'écriture pour tout membre.
          "customers/Tenant isolation",
          "ar_payment_terms/Tenant isolation",
          "ar_dunning_rules/Tenant isolation",
          "ar_notification_rules/Tenant isolation",
          // V53 — stocks : plus d'écriture pour tout membre.
          "stock_movements/Tenant isolation",
          "stock_valuation_layers/valuation layers tenant access",
          "inventory_settings/inv settings tenant access",
          "items/Tenant isolation",
          "warehouses/warehouses tenant access",
          "item_locations/item_locations tenant access",
          "inventory_counts/inv counts tenant access",
          "inventory_count_lines/inv count lines tenant access");

  private static final Set<String> CLES_AUTH_RETIREES = Set.of("user_roles/user_roles_user_id_fkey");

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
          "erp_authorization_audit",
          // V31 — invitations à rejoindre une société.
          "tenant_invitations",
          // V33 — calendrier fiscal central.
          "fiscal_modules",
          "fiscal_years",
          "fiscal_periods",
          "fiscal_calendar_audit",
          // V38 — journaux, lots et compteurs de pièces.
          "accounting_journals",
          "journal_batches",
          "journal_piece_counters",
          // V40 — séries de numérotation des pièces de vente.
          "sales_numbering_series",
          // V41 — file d'approbation des factures fournisseurs.
          "ap_invoice_approvals",
          // V45 — avoirs clients.
          "ar_credit_notes",
          "ar_credit_note_lines",
          // V49 — acomptes, remboursements et lettrage clients.
          "ar_customer_advances",
          "ar_customer_refunds",
          "ar_letterings",
          "ar_lettering_counters",
          // V50 — retours clients.
          "customer_returns",
          "customer_return_lines",
          // V52 — retours et avoirs fournisseurs.
          "ap_credit_notes",
          "supplier_returns",
          "supplier_return_lines",
          // V54 — réapprovisionnement.
          "supplier_items",
          "item_replenishment_rules",
          "replenishment_proposals");

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
          "guard_system_roles",
          "guard_profile_tenant",
          "audit_authorizations",
          "guard_role_assignments",
          "guard_role_in_use",
          "my_access",
          // V31 — rôles des modules écrits dans la matrice ; invitations.
          "module_role_tenant",
          "module_role_held",
          "module_role_set",
          "create_tenant_invitation",
          "revoke_tenant_invitation",
          // V33 — calendrier fiscal central.
          "fiscal_module_label",
          "assert_fiscal_period_open",
          "enforce_fiscal_period",
          "fiscal_period_set",
          "set_period_status",
          "fiscal_generate_periods",
          "create_fiscal_year",
          "open_fiscal_year",
          "close_fiscal_year",
          "guard_goods_receipt",
          "guard_gr_lines",
          "record_settlement",
          "guard_invoice_origin",
          "ap_invoice_journal_entry",
          "journal_for_source",
          "assign_journal_batch",
          "procurement_doc",
          "procurement_set_status",
          "procurement_submit",
          "procurement_cancel",
          "guard_procurement_document",
          "guard_procurement_lines",
          "next_sales_document_number",
          "assign_sales_document_number",
          "create_sales_quotation",
          "create_sales_order",
          "ap_invoice_for_caller",
          "ap_invoice_submit",
          "ap_invoice_decide",
          "guard_ap_invoice_lifecycle",
          // V42 — ventes et clients : règlements, facture client, livraison.
          "guard_payment",
          "reverse_settlement",
          "guard_ar_invoice_lifecycle",
          "guard_ar_invoice_lines",
          "draft_invoice_from_delivery",
          // V43 — pièces commerciales complètes (TVA et remise par ligne, crédit bloquant).
          "sales_line_tax_rate",
          "sales_check_lines",
          "customer_credit_exposure",
          // V44 — commande depuis les lignes d'un devis.
          "create_sales_order_from_quote",
          // V45 — avoirs clients.
          "create_ar_credit_note",
          // V46 — modifier / supprimer devis et commandes non engagés.
          "update_sales_quotation",
          "delete_sales_quotation",
          "update_sales_order",
          "delete_sales_order",
          // V47 — identité légale de la société.
          "set_company_identity",
          // V49 — acomptes, crédits et lettrage clients.
          "post_two_line_entry",
          "require_posting_account",
          "record_customer_advance",
          "apply_customer_credit",
          "refund_customer_credit",
          "lettering_code_of",
          "letter_ar_invoice",
          "on_ar_invoice_lettering",
          // V50 — retours clients.
          "create_customer_return",
          "credit_customer_return",
          "release_delivery_on_draft_delete",
          // V52 — retours et avoirs fournisseurs.
          "po_line_returned",
          "create_ap_credit_note",
          "credit_supplier_return",
          "create_supplier_return",
          // V53 — stocks sécurisés.
          "guard_item_stock_fields",
          "guard_inventory_count",
          "stock_item_of_tenant",
          "create_stock_adjustment",
          // V54 — réapprovisionnement.
          "replenishment_target_ok",
          "replenishment_quantity",
          "generate_replenishment_proposals",
          "convert_replenishment_proposals",
          "dismiss_replenishment_proposal",
          // V55 — isolation stricte des sociétés.
          "assert_same_tenant",
          "install_tenant_isolation_triggers");

  private static final Set<String> POLITIQUES_AJOUTEES =
      Set.of(
          "tenant_invitations/Administrateur de la société",
          "accounting_journals/Lecture du référentiel",
          "journal_batches/Tenant isolation",
          "ap_invoice_approvals/Tenant isolation",
          "ar_credit_notes/Tenant isolation",
          "ar_credit_note_lines/Tenant isolation",
          "ar_customer_advances/Tenant isolation",
          "ar_customer_refunds/Tenant isolation",
          "ar_letterings/Tenant isolation",
          "customer_returns/Tenant isolation",
          "customer_return_lines/Tenant isolation",
          "ap_credit_notes/Tenant isolation",
          "supplier_returns/Tenant isolation",
          "supplier_return_lines/Tenant isolation",
          // V53 — stocks sécurisés.
          "stock_movements/Lecture société",
          "stock_valuation_layers/Lecture société",
          "inventory_settings/Lecture société",
          "inventory_settings/Administrateur de la société",
          "items/Lecture société",
          "items/Création habilitée",
          "items/Modification habilitée",
          "items/Suppression administrateur",
          "warehouses/Lecture société",
          "warehouses/Écriture habilitée",
          "item_locations/Lecture société",
          "item_locations/Écriture habilitée",
          "inventory_counts/Lecture société",
          "inventory_counts/Comptage habilité",
          "inventory_count_lines/Lecture société",
          "inventory_count_lines/Comptage habilité",
          // V54 — réapprovisionnement.
          "supplier_items/Lecture société",
          "supplier_items/Écriture habilitée",
          "item_replenishment_rules/Lecture société",
          "item_replenishment_rules/Écriture habilitée",
          "replenishment_proposals/Lecture société",
          // V48 — clients et paramètres AR.
          "customers/Lecture société",
          "customers/Création habilitée",
          "customers/Modification habilitée",
          "customers/Suppression comptable",
          "ar_payment_terms/Lecture société",
          "ar_payment_terms/Gestion comptable",
          "ar_dunning_rules/Lecture société",
          "ar_dunning_rules/Gestion comptable",
          "ar_notification_rules/Lecture société",
          "ar_notification_rules/Gestion comptable",
          "sales_numbering_series/Tenant read",
          "sales_numbering_series/Tenant admin update",
          "sales_settings/Tenant read",
          "sales_settings/Tenant admin update",
          "fiscal_modules/Lecture du référentiel",
          "fiscal_years/Tenant isolation",
          "fiscal_periods/Tenant isolation",
          "fiscal_calendar_audit/Clôture des périodes",
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
          "erp_roles/trg_guard_system_roles",
          "erp_role_permissions/trg_guard_system_role_permissions",
          "profiles/trg_guard_profile_tenant",
          "erp_roles/trg_audit_erp_roles",
          "erp_role_permissions/trg_audit_erp_role_permissions",
          "user_role_assignments/trg_audit_user_role_assignments",
          "user_role_assignments/trg_guard_role_assignments",
          "erp_roles/trg_guard_role_in_use",
          // V33 — contrôle du calendrier fiscal par module.
          "ar_invoices/trg_fiscal_period_ar_invoices",
          "ap_invoices/trg_fiscal_period_ap_invoices",
          "payments/trg_fiscal_period_payments",
          "purchase_orders/trg_fiscal_period_purchase_orders",
          "bank_transactions/trg_fiscal_period_bank_transactions",
          "payroll_runs/trg_fiscal_period_payroll_runs",
          "depreciation_entries/trg_fiscal_period_depreciation_entries",
          // V34 — réception : en-tête puis lignes, figées une fois validée.
          "goods_receipts/trg_guard_goods_receipt",
          "gr_lines/trg_guard_gr_lines",
          // V36 — une facture ne cite qu'une commande de son propre tiers.
          "ap_invoices/trg_guard_ap_invoice_origin",
          "ar_invoices/trg_guard_ar_invoice_origin",
          // V38 — journal, lot et numéro de pièce attribués à l'insertion.
          "journal_entries/trg_assign_journal_batch",
          // V39 — cycle de vie des pièces d'achat.
          "purchase_requisitions/trg_guard_procurement_document",
          "purchase_orders/trg_guard_procurement_document",
          "requisition_lines/trg_guard_procurement_lines",
          "po_lines/trg_guard_procurement_lines",
          // V40 — numéro attribué par la base aux devis, commandes et livraisons.
          "quotations/trg_assign_sales_document_number",
          "sales_orders/trg_assign_sales_document_number",
          "delivery_notes/trg_assign_sales_document_number",
          // V41 — cycle de vie des factures fournisseurs.
          "ap_invoices/trg_guard_ap_invoice_lifecycle",
          // V42 — règlements figés, facture client figée une fois émise.
          "payments/trg_guard_payment",
          "ar_invoices/trg_guard_ar_invoice_lifecycle",
          "ar_invoice_lines/trg_guard_ar_invoice_lines",
          // V49 — lettrage automatique des factures soldées.
          "ar_invoices/trg_ar_invoice_lettering",
          // V50 — supprimer un brouillon issu d'une livraison libère la livraison.
          "ar_invoices/trg_release_delivery_on_draft_delete",
          // V53 — stock et coût moyen non saisissables, comptage validé figé.
          "items/trg_guard_item_stock_fields",
          "inventory_counts/trg_guard_inventory_count",
          "inventory_count_lines/trg_guard_inventory_count_lines");

  /** V38 — synthèse des lots du grand livre. */
  private static final Set<String> VUES_AJOUTEES = Set.of("journal_batch_summary", "stock_projection_view");

  /** Référence moins les retraits déclarés, chacun devant exister dans la référence. */
  private static Set<String> sans(Set<String> reference, Set<String> retraits) {
    Set<String> attendu = new LinkedHashSet<>(reference);
    assertThat(attendu).as("un retrait déclaré doit exister dans le dump").containsAll(retraits);
    attendu.removeAll(retraits);
    return attendu;
  }

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

    memeEnsemble(avec(sans(MANIFESTE.colonne("tables_columns", 0), TABLES_RETIREES), TABLES_AJOUTEES), reconstruites, "tables");
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
    horsManifeste.removeAll(avec(sans(MANIFESTE.colonne("tables_columns", 0), TABLES_RETIREES), TABLES_AJOUTEES));

    assertThat(horsManifeste)
        .as("toute autre table inattendue signalerait un objet créé hors des migrations du lot 0")
        .containsExactly(TABLE_HISTORIQUE_FLYWAY);
  }

  @Test
  @DisplayName("les vues, fonctions, déclencheurs, politiques, séquences et clés étrangères correspondent au manifeste")
  void lesAutresObjetsCorrespondentAuManifeste() {
    memeEnsemble(avec(MANIFESTE.colonne("views", 0), VUES_AJOUTEES), new LinkedHashSet<>(noms("""
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
          AND t.tgname <> 'trg_zz_isolation_societe'
        """)), "déclencheurs"); // V55 : famille générée, couverture vérifiée par IsolationSocietesIT

    memeEnsemble(avec(sans(MANIFESTE.cles("policies", 1, 2), POLITIQUES_RETIREES), POLITIQUES_AJOUTEES), new LinkedHashSet<>(noms("""
        SELECT tablename || '/' || policyname FROM pg_policies WHERE schemaname = 'public'
        """)), "politiques RLS");

    // La colonne d'identité de V28 (erp_authorization_audit.seq) n'apparaît pas ici :
    // information_schema.sequences ne liste pas les séquences internes des colonnes d'identité.
    memeEnsemble(MANIFESTE.colonne("sequences", 0), new LinkedHashSet<>(noms("""
        SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public'
        """)), "séquences");

    memeEnsemble(sans(MANIFESTE.cles("fk_to_auth_users", 0, 1), CLES_AUTH_RETIREES), new LinkedHashSet<>(noms("""
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
    memeEnsemble(avec(sans(MANIFESTE.tablesAvecRlsActive(), TABLES_RETIREES), TABLES_AJOUTEES), new LinkedHashSet<>(noms("""
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
