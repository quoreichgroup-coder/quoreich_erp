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
  private static final String DERNIERE_MIGRATION = "103";

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
          "journal_entries/trg_journal_entry_audit",
          // V73 — faux engagement budgétaire (réalisé gonflé deux fois, jamais libéré).
          "purchase_orders/trg_commit_budget_on_po");

  /** V73 — fonction de la base de référence supprimée (remplacée par le contrôle budgétaire). */
  private static final Set<String> FONCTIONS_RETIREES = Set.of("commit_budget_on_po", "post_monthly_depreciation", "post_asset_disposal");

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
          // V75 — immobilisations : plus d'écriture pour tout membre.
          "asset_categories/Tenant isolation",
          "assets/Tenant isolation",
          "depreciation_entries/Access via asset",
          "asset_disposals/tenant access asset_disposals",
          // V73 — budgets : plus d'écriture pour tout membre.
          "budgets/Tenant isolation",
          "budget_lines/Access via budget",
          // V72 — factures fournisseurs : plus d'écriture pour tout membre.
          "ap_invoices/Tenant isolation",
          // V70 — trésorerie : plus d'écriture pour tout membre.
          "bank_accounts/Tenant isolation",
          "bank_transactions/Tenant isolation",
          "bank_statements/tenant_bank_statements",
          "bank_statement_lines/tenant_bank_statement_lines",
          "bank_reconciliations/tenant_bank_reconciliations",
          "treasury_settings/tenant_treasury_settings",
          // V53 — stocks : plus d'écriture pour tout membre.
          "stock_movements/Tenant isolation",
          "stock_valuation_layers/valuation layers tenant access",
          "inventory_settings/inv settings tenant access",
          "items/Tenant isolation",
          "warehouses/warehouses tenant access",
          "item_locations/item_locations tenant access",
          "inventory_counts/inv counts tenant access",
          "inventory_count_lines/inv count lines tenant access",
          // V56 — fiche fournisseur : écriture réservée.
          "suppliers/Tenant isolation",
          // V57 — achats paramétrables : paramètres des achats réservés.
          "procurement_settings/tenant_isolation_procurement_settings",
          // V58 — ventes et comptes clients paramétrables.
          "ar_general_settings/Tenant isolation",
          "ar_numbering_series/Tenant isolation",
          "ar_notification_log/Tenant isolation",
          // V60 — plan comptable : écriture réservée.
          "gl_accounts/Tenant isolation");

  private static final Set<String> CLES_AUTH_RETIREES = Set.of("user_roles/user_roles_user_id_fkey");
  /** V80 — référence au validateur qui a confirmé les paramètres de paie. */
  private static final Set<String> CLES_AUTH_AJOUTEES = Set.of("hr_payroll_settings/hr_payroll_settings_rules_validated_by_fkey");

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
          "replenishment_proposals",
          // V56 — fiche fournisseur et suivi des commandes.
          "supplier_change_log",
          "purchase_order_followup_log",
          // V60 — référentiel SYSCOHADA.
          "syscohada_reference_accounts",
          "syscohada_keyword_hints",
          // V62 — plans comptables et attributs de compte.
          "charts",
          "gl_account_attribute_definitions",
          "gl_account_history",
          // V63 — états par rubriques, paramètres de paie.
          "report_layouts",
          "report_lines",
          "report_line_rules",
          "tenant_report_line_accounts",
          "hr_payroll_settings",
          // V80 — audit indépendant du cycle de paie.
          "payroll_run_audit",
          // V64 — référentiels versionnés et règles de qualité.
          "framework_versions",
          "framework_reference_accounts",
          "framework_keyword_hints",
          "framework_role_expectations",
          "framework_quality_rules",
          "tenant_quality_rules",
          // V65 — import guidé du plan comptable.
          "chart_import_settings",
          "import_profiles",
          "chart_import_runs",
          "chart_import_rows",
          // V66 — correspondances et plans secondaires.
          "secondary_chart_accounts",
          "chart_mappings",
          "chart_mapping_lines",
          // V67 — migration du plan opérationnel.
          "chart_migrations",
          // V72 — factures fournisseurs à lignes, factures non parvenues.
          "ap_invoice_lines",
          "grni_ledger",
          // V73 — contrôle budgétaire.
          "budget_settings",
          "budget_revisions",
          // V75 — immobilisations.
          "asset_settings",
          "depreciation_runs",
          // V77 — imputation analytique des pièces d'achat.
          "purchase_requisition_analytics",
          "purchase_order_analytics",
          "ap_invoice_analytics",
          // V78 — sections par ligne, prévisions saisies.
          "requisition_line_analytics",
          "po_line_analytics",
          "ap_invoice_line_analytics",
          "budget_forecasts",
          "budget_forecast_lines",
          // V79 — scénarios de budget.
          "budget_scenarios",
          // V82-V91 — mouvements RH, rubriques de paie et campagnes d'inventaire.
          "employee_movement_audit", "employee_movements", "hr_employee_payroll_components",
          "hr_movement_references", "hr_payroll_components", "payroll_component_lines",
          "payroll_run_prechecks", "payroll_run_variables", "inventory_campaign_lines", "inventory_campaigns",
          // V93/V94/V96 — recomptages, journal des comptages, événements et règles du tournant.
          "inventory_campaign_count_log", "inventory_campaign_recounts",
          "inventory_campaign_events", "inventory_cycle_policies",
          // V95 — configuration de matricules par société.
          "hr_employee_number_settings");

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
          // V95 — import salariés, numérotation et actions groupées configurables.
          "create_employee_movements_bulk", "import_hr_employees", "list_hr_employee_number_settings",
          "next_hr_employee_number", "save_hr_employee_number_settings",
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
          "install_tenant_isolation_triggers",
          // V56 — fiche fournisseur et suivi des commandes.
          "guard_supplier_bank",
          "log_supplier_changes",
          "verify_supplier_bank_details",
          "guard_supplier_bank_payment",
          "default_po_dates",
          "po_followup_target",
          "acknowledge_purchase_order",
          "reschedule_purchase_order",
          // V57 — achats paramétrables.
          "procurement_setting",
          // V58 — ventes et comptes clients paramétrables.
          "sales_setting",
          "ar_setting",
          // V60 — plan comptable SYSCOHADA.
          "guard_gl_account",
          "guard_journal_line_account",
          "normalize_account_label",
          "labels_compatible",
          "syscohada_reference_of",
          "chart_of_accounts_issues",
          "require_chart_right",
          "replace_gl_account",
          "create_syscohada_headings",
          "link_gl_account_parents",
          "reclassify_gl_account_balance",
          // V62 — plans comptables et attributs de compte.
          "operational_chart_id",
          "default_gl_account_fields",
          "log_gl_account_changes",
          // V63 — états par rubriques.
          "report_line_of_account",
          "report_compute",
          "financial_statement",
          // V64 — moteur de qualité générique.
          "chart_framework",
          "quality_rule_severity",
          "framework_reference_of",
          // V65 — import guidé du plan comptable.
          "chart_import_setting",
          "import_account_type",
          "chart_import_check",
          "chart_import_run_for",
          "prepare_chart_import",
          "update_chart_import_row",
          "validate_chart_import",
          "cancel_chart_import",
          // V66 — correspondances et plans secondaires.
          "create_secondary_chart",
          "mapping_target",
          "mapping_for",
          "create_chart_mapping",
          "propose_chart_mapping",
          "set_chart_mapping_lines",
          "decide_chart_mapping_lines",
          "compare_chart_mapping",
          "validate_chart_mapping",
          "archive_chart_mapping",
          "mapped_trial_balance",
          // V67 — migration du plan opérationnel.
          "chart_migration_plan",
          "chart_migration_mapping",
          "chart_migration_plan_json",
          "simulate_chart_migration",
          "apply_chart_migration",
          "cancel_chart_migration",
          // V69 — import des correspondances.
          "import_chart_mapping_lines",
          // V70 — trésorerie reliée aux règlements.
          "treasury_require_account",
          "treasury_kind_for_method",
          "treasury_role_for_method",
          "resolve_treasury_account",
          "treasury_gl_account",
          "record_treasury_line",
          "refresh_bank_account_balance",
          "guard_bank_account",
          "set_default_treasury_account",
          "assign_payment_treasury",
          "payment_treasury_line",
          "guard_bank_statement_line",
          "guard_bank_reconciliation",
          "record_treasury_movement",
          "transfer_between_treasury_accounts",
          // V71 — relevés et rapprochement bancaire.
          "auto_match_statement",
          "import_bank_statement",
          "cancel_bank_statement",
          "post_statement_line",
          "prepare_bank_reconciliation",
          "validate_bank_reconciliation",
          // V72 — factures fournisseurs à lignes, factures non parvenues.
          "post_two_line_entry_as",
          "compute_ap_invoice_line",
          "sync_ap_invoice_totals",
          "po_line_received",
          "po_line_invoiced",
          "grni_open",
          "on_gr_grni",
          "on_supplier_return_grni",
          "ap_po_lines_to_invoice",
          // V73 — contrôle budgétaire.
          "budget_setting",
          "guard_budget",
          "guard_budget_line",
          "refresh_budget_total",
          "budget_for",
          "budget_submit",
          "budget_approve",
          "budget_reject",
          "budget_close",
          "budget_revise_line",
          "budget_actual",
          "budget_committed",
          "budget_availability",
          "budget_status",
          "check_budget_on_po",
          "budget_override_po",
          "check_budget_on_ap_invoice",
          // V75 — immobilisations.
          "asset_setting",
          "guard_asset_category",
          "guard_asset",
          "refresh_asset_depreciation",
          "asset_depreciation_amount",
          "run_depreciation",
          "reverse_last_depreciation",
          "dispose_asset",
          // V77 — pré-engagement et budgets par section.
          "guard_document_analytics",
          "document_analytic_values",
          "copy_requisition_analytics",
          "copy_po_analytics_to_ap_invoice",
          "impute_entry_analytics",
          "analytic_value_scope",
          "budget_precommitted",
          "budget_monthly_actual",
          "check_budget_on_pr",
          "budget_override_document",
          // V78.
          "guard_line_analytics",
          "analytic_key",
          "line_effective_analytics",
          "document_all_values",
          "document_amount_in_scope",
          "impute_line_analytics",
          "copy_po_line_analytics_to_ap_line",
          "guard_budget_forecast",
          "guard_budget_forecast_line",
          "budget_forecast_publish",
          "budget_import_resolve",
          "import_budget_lines",
          "import_budget_forecast_lines",
          "budget_revision_decide",
          // V79.
          "budget_account_ok",
          "ensure_budget_scenarios",
          "guard_budget_scenario",
          "budget_prior_year_monthly",
          // V101 — isolation des fonctions à paramètre société.
          "caller_tenant_matches",
          // V102 — référentiels RH (contrat, service, poste).
          "hr_reference_code",
          "hr_resolve_reference",
          "hr_reference_label",
          "guard_employee_references",
          "guard_employee_movement_values",
          "payroll_line_department_label",
          // V103 — séparation des fonctions de paie.
          "stamp_payroll_run_creator",
          // V80 — règles de paie par pays.
          "payroll_rules_valid",
          "compute_progressive_payroll_tax",
          "guard_hr_payroll_settings",
          "confirm_payroll_rules",
          "audit_payroll_run_change",
          // V81-V95 — API RH, mouvements, paie détaillée, isolement, inventaire et import RH.
          "approve_employee_movement", "compute_payroll_line_at", "create_employee_movement",
          "create_payroll_run", "create_payroll_run_variable", "decide_payroll_run_variable",
          "guard_campaign_stock_movement", "guard_employee_movement_references", "hr_employee_state_at",
          "inventory_campaign", "list_employee_movements", "list_hr_employee_payroll_components",
          "list_hr_employees", "list_hr_movement_references", "list_hr_payroll_components",
          "precheck_payroll_run", "prevent_payroll_precheck_mutation", "reject_employee_movement",
          "reject_employee_movement_audit_change", "save_hr_employee", "save_hr_employee_payroll_component",
          "save_hr_movement_reference", "save_hr_payroll_component",
          // V91/V93/V94 — périmètre, contrôle et catalogue des inventaires physiques.
          "inventory_campaign_open_items", "inventory_campaign_capture_cost", "inventory_campaign_log_count",
          "inventory_campaign_policy", "inventory_campaign_variances", "inventory_campaign_control",
          "inventory_campaign_numbering", "inventory_campaign_assign_reference", "inventory_campaign_keep_reference",
          "inventory_campaign_log_transition", "inventory_campaign_timeline", "inventory_campaign_save_counts",
          "inventory_campaign_catalog", "inventory_campaign_preview",
          // V96 — classement et planification du tournant ABC.
          "inventory_cycle_analysis", "inventory_cycle_policy", "inventory_cycle_prepare", "inventory_cycle_ranked_items",
          // V98 — résolution du compte de comptabilisation d'une rubrique de paie.
          "hr_component_posting_account",
          // V100 — les gains de campagne n'ajoutent pas un reliquat global non affecté.
          "guard_unallocated_campaign_gain");

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
          "inventory_settings/Paramétrage habilité",
          "items/Lecture société",
          "items/Création habilitée",
          "items/Modification habilitée",
          "items/Suppression habilitée",
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
          // V56 — fiche fournisseur et suivi des commandes.
          "suppliers/Lecture société",
          "suppliers/Création habilitée",
          "suppliers/Modification habilitée",
          "suppliers/Suppression habilitée",
          "supplier_change_log/Lecture habilitée",
          "procurement_settings/Lecture société",
          "procurement_settings/Modification habilitée",
          "procurement_settings/Création habilitée",
          // V58 — ventes et comptes clients paramétrables.
          "ar_general_settings/Lecture société",
          "ar_general_settings/Paramétrage habilité",
          "ar_numbering_series/Lecture société",
          "ar_numbering_series/Paramétrage habilité",
          "ar_notification_log/Lecture société",
          // V60 — plan comptable SYSCOHADA.
          "gl_accounts/Lecture société",
          "gl_accounts/Paramétrage habilité",
          "syscohada_reference_accounts/Lecture du référentiel",
          "syscohada_keyword_hints/Lecture du référentiel",
          // V62 — plans comptables et attributs de compte.
          "charts/Lecture société",
          "charts/Administration habilitée",
          "gl_account_attribute_definitions/Lecture société",
          "gl_account_attribute_definitions/Administration habilitée",
          "gl_account_history/Lecture habilitée",
          // V63 — états par rubriques, paramètres de paie.
          "report_layouts/Lecture du référentiel",
          "report_lines/Lecture du référentiel",
          "report_line_rules/Lecture du référentiel",
          "tenant_report_line_accounts/Lecture société",
          "tenant_report_line_accounts/Paramétrage habilité",
          "hr_payroll_settings/Lecture société",
          "hr_payroll_settings/Paramétrage habilité",
          // V64 — référentiels versionnés et règles de qualité.
          "framework_versions/Lecture du référentiel",
          "framework_reference_accounts/Lecture du référentiel",
          "framework_keyword_hints/Lecture du référentiel",
          "framework_role_expectations/Lecture du référentiel",
          "framework_quality_rules/Lecture du référentiel",
          "tenant_quality_rules/Lecture société",
          "tenant_quality_rules/Paramétrage habilité",
          // V65 — import guidé du plan comptable.
          "chart_import_settings/Lecture société",
          "chart_import_settings/Paramétrage habilité",
          "import_profiles/Lecture des profils",
          "import_profiles/Profils de la société",
          "chart_import_runs/Lecture habilitée",
          "chart_import_rows/Lecture habilitée",
          // V66 — correspondances et plans secondaires.
          "secondary_chart_accounts/Lecture société",
          "secondary_chart_accounts/Administration habilitée",
          "chart_mappings/Lecture société",
          "chart_mapping_lines/Lecture société",
          // V67 — migration du plan opérationnel.
          "chart_migrations/Lecture société",
          // V70 — trésorerie : les FOR ALL remplacés par des politiques par droit.
          "bank_accounts/Lecture société",
          "bank_accounts/Gestion habilitée",
          "bank_accounts/Modification habilitée",
          "bank_accounts/Suppression habilitée",
          "bank_transactions/Lecture société",
          "bank_statements/Lecture société",
          "bank_statements/Import habilité",
          "bank_statement_lines/Lecture société",
          "bank_statement_lines/Import habilité",
          "bank_statement_lines/Rapprochement habilité",
          "bank_statement_lines/Suppression habilitée",
          "bank_reconciliations/Lecture société",
          "bank_reconciliations/Rapprochement habilité",
          "treasury_settings/Lecture société",
          "treasury_settings/Paramétrage habilité",
          // V72 — factures fournisseurs : écriture réservée (droit ap.invoice).
          "ap_invoices/Lecture société",
          "ap_invoices/Saisie habilitée",
          "ap_invoices/Modification habilitée",
          "ap_invoices/Suppression habilitée",
          "ap_invoice_lines/Lecture société",
          "ap_invoice_lines/Saisie habilitée",
          "grni_ledger/Lecture société",
          // V73 — budgets : écriture réservée (droit budget.manage).
          "budget_settings/Lecture société",
          "budget_settings/Paramétrage habilité",
          "budget_revisions/Lecture société",
          "budgets/Lecture société",
          "budgets/Préparation habilitée",
          "budget_lines/Lecture société",
          "budget_lines/Préparation habilitée",
          // V75 — immobilisations : écriture réservée, amortissements et cessions par fonctions.
          "asset_settings/Lecture société",
          "asset_settings/Paramétrage habilité",
          "asset_categories/Lecture société",
          "asset_categories/Paramétrage habilité",
          "assets/Lecture société",
          "assets/Gestion habilitée",
          "depreciation_runs/Lecture société",
          "depreciation_entries/Lecture société",
          "asset_disposals/Lecture société",
          // V77 — imputation analytique des pièces d'achat.
          "purchase_requisition_analytics/Lecture société",
          "purchase_requisition_analytics/Écriture avec la pièce",
          "purchase_order_analytics/Lecture société",
          "purchase_order_analytics/Écriture avec la pièce",
          "ap_invoice_analytics/Lecture société",
          "ap_invoice_analytics/Écriture factures habilitée",
          // V78.
          "requisition_line_analytics/Lecture société",
          "requisition_line_analytics/Écriture avec la pièce",
          "po_line_analytics/Lecture société",
          "po_line_analytics/Écriture avec la pièce",
          "ap_invoice_line_analytics/Lecture société",
          "ap_invoice_line_analytics/Écriture factures habilitée",
          "budget_forecasts/Lecture société",
          "budget_forecasts/Prévision habilitée",
          "budget_forecast_lines/Lecture société",
          "budget_forecast_lines/Prévision habilitée",
          // V79.
          "budget_scenarios/Lecture société",
          "budget_scenarios/Paramétrage habilité",
          "purchase_order_followup_log/Lecture société",
          // V80 — historique paie réservé au droit d'audit.
          "payroll_run_audit/payroll_run_audit_read",
          // V81-V89 — policies for tenant-scoped HR/payroll tables.
          "employee_movement_audit/employee_movement_audit_delete",
          "employee_movement_audit/employee_movement_audit_insert",
          "employee_movement_audit/employee_movement_audit_select",
          "employee_movement_audit/employee_movement_audit_update",
          "employee_movements/employee_movements_delete",
          "employee_movements/employee_movements_insert",
          "employee_movements/employee_movements_select",
          "employee_movements/employee_movements_update",
          "hr_employee_payroll_components/hr_employee_payroll_components_no_direct_write",
          "hr_employee_payroll_components/hr_employee_payroll_components_read",
          "hr_movement_references/hr_movement_references_no_direct_write",
          "hr_movement_references/hr_movement_references_select",
          "hr_payroll_components/hr_payroll_components_no_direct_write",
          "hr_payroll_components/hr_payroll_components_read",
          "payroll_component_lines/payroll_component_lines_no_direct_write",
          "payroll_component_lines/payroll_component_lines_read",
          "payroll_run_prechecks/payroll_run_prechecks_no_direct_write",
          "payroll_run_prechecks/payroll_run_prechecks_read",
          "payroll_run_variables/payroll_run_variables_no_direct_write",
          "payroll_run_variables/payroll_run_variables_read",
          // V95 — paramétrage des matricules par droit central.
          "hr_employee_number_settings/hr_employee_number_settings_no_direct_write",
          "hr_employee_number_settings/hr_employee_number_settings_read",
          // V48 — clients et paramètres AR.
          "customers/Lecture société",
          "customers/Création habilitée",
          "customers/Modification habilitée",
          "customers/Suppression habilitée",
          "ar_payment_terms/Lecture société",
          "ar_payment_terms/Paramétrage habilité",
          "ar_dunning_rules/Lecture société",
          "ar_dunning_rules/Paramétrage habilité",
          "ar_notification_rules/Lecture société",
          "ar_notification_rules/Paramétrage habilité",
          "sales_numbering_series/Tenant read",
          "sales_numbering_series/Paramétrage habilité",
          "sales_settings/Tenant read",
          "sales_settings/Paramétrage habilité",
          "sales_settings/Création habilitée",
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
          "ar_invoice_analytics/Saisie habilitée",
          "journal_line_analytics/Tenant isolation",
          "journal_line_analytics/Gestion comptable",
          "tax_codes/Tenant isolation",
          "tax_codes/Gestion habilitée",
          "ar_invoice_lines/Tenant isolation",
          "ar_invoice_lines/Saisie habilitée",
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
          // V75 — immobilisations.
          "asset_categories/trg_guard_asset_category",
          "assets/trg_guard_asset",
          // V77.
          "purchase_requisition_analytics/trg_guard_document_analytics",
          "purchase_order_analytics/trg_guard_document_analytics",
          "ap_invoice_analytics/trg_guard_document_analytics",
          "purchase_requisitions/trg_copy_requisition_analytics",
          "ap_invoices/trg_copy_po_analytics_to_ap_invoice",
          "purchase_requisitions/trg_check_budget_on_pr",
          // V78.
          "requisition_line_analytics/trg_guard_line_analytics",
          "po_line_analytics/trg_guard_line_analytics",
          "ap_invoice_line_analytics/trg_guard_line_analytics",
          "ap_invoice_lines/trg_copy_po_line_analytics_to_ap_line",
          "budget_forecasts/trg_guard_budget_forecast",
          "budget_forecast_lines/trg_guard_budget_forecast_line",
          // V79.
          "budgets/trg_guard_budget_scenario",
          // V102.
          "employees/trg_guard_employee_references",
          "employee_movements/trg_guard_employee_movement_values",
          "payroll_lines/trg_payroll_line_department_label",
          "payroll_runs/trg_stamp_payroll_run_creator",
          // V80.
          "payroll_runs/trg_audit_payroll_run_change",
          "depreciation_entries/trg_refresh_asset_depreciation",
          // V73 — contrôle budgétaire.
          "budgets/trg_guard_budget",
          "budget_lines/trg_guard_budget_line",
          "budget_lines/trg_refresh_budget_total",
          "purchase_orders/trg_check_budget_on_po",
          "ap_invoices/trg_check_budget_on_ap_invoice",
          // V72 — factures fournisseurs à lignes, factures non parvenues.
          "ap_invoice_lines/trg_compute_ap_invoice_line",
          "ap_invoice_lines/trg_sync_ap_invoice_totals",
          "goods_receipts/trg_gr_grni",
          "supplier_return_lines/trg_supplier_return_grni",
          // V70 — trésorerie reliée aux règlements.
          "bank_transactions/trg_refresh_bank_account_balance",
          "bank_accounts/trg_guard_bank_account",
          "payments/trg_assign_payment_treasury",
          "payments/trg_payment_treasury_line",
          "bank_statement_lines/trg_guard_bank_statement_line",
          "bank_reconciliations/trg_guard_bank_reconciliation",
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
          "inventory_count_lines/trg_guard_inventory_count_lines",
          // V56 — double contrôle bancaire, journal, dates par défaut des commandes.
          "suppliers/trg_guard_supplier_bank",
          "suppliers/trg_log_supplier_changes",
          "payments/trg_guard_supplier_bank_payment",
          "purchase_orders/trg_default_po_dates",
          // V60 — plan comptable : garde des comptes et des imputations.
          "gl_accounts/trg_guard_gl_account",
          "journal_lines/trg_guard_journal_line_account",
          // V62 — valeurs par défaut, attributs personnalisés, historique des comptes.
          "gl_accounts/trg_default_gl_account_fields",
          "gl_accounts/trg_log_gl_account_changes",
          // V80 — toute modification des barèmes retire leur confirmation.
          "hr_payroll_settings/trg_guard_hr_payroll_settings",
          // V82/V89/V91 — historique RH immuable et garde du comptage inventaire.
          "employee_movement_audit/employee_movement_audit_immutable",
          "employee_movements/employee_movement_configured_references",
          "payroll_run_prechecks/payroll_run_prechecks_immutable",
          "item_locations/guard_campaign_stock_location",
          "stock_movements/guard_campaign_stock_movement",
          // V93 — valorisation à l'ouverture et journal des deux comptages.
          "inventory_campaign_lines/inventory_campaign_capture_cost",
          "inventory_campaign_lines/inventory_campaign_log_first",
          "inventory_campaign_recounts/inventory_campaign_log_second",
          // V94 — référence stable et historique de la campagne.
          "inventory_campaigns/inventory_campaign_assign_reference",
          "inventory_campaigns/inventory_campaign_keep_reference",
          "inventory_campaigns/inventory_campaign_log_transition",
          // V100 — garde de comptabilisation sur les gains d'inventaire.
          "stock_movements/trg_guard_unallocated_campaign_gain");

  /** V38 — synthèse des lots du grand livre. */
  private static final Set<String> VUES_AJOUTEES = Set.of("journal_batch_summary", "stock_projection_view", "purchase_order_followup_view");

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

    memeEnsemble(avec(sans(MANIFESTE.colonne("functions", 0), FONCTIONS_RETIREES), FONCTIONS_AJOUTEES), new LinkedHashSet<>(noms("""
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

    memeEnsemble(avec(sans(MANIFESTE.cles("fk_to_auth_users", 0, 1), CLES_AUTH_RETIREES), CLES_AUTH_AJOUTEES), new LinkedHashSet<>(noms("""
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
