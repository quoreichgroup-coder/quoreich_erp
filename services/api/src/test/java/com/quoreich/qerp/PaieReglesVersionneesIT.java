package com.quoreich.qerp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * V149 — règles légales de paie versionnées : cotisations multiples plafonnées, abattement par catégorie,
 * réduction pour charges de famille, arrondis, exonération partielle d'une rubrique, version applicable par
 * date, version validée figée, comptabilisation par cotisation. Les taux sont des valeurs de TEST, pas des taux
 * légaux.
 */
@SpringBootTest
class PaieReglesVersionneesIT {

  private static final String DATABASE = "qerp_it_paie_regles";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String ADMIN = PostgresFixture.ALPHA_USER;
  private static final String APPROVER = "aaaaaaaa-0000-0000-0000-000000000003";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.applySyscohada(DATABASE, A);
    PostgresFixture.grantRoles(DATABASE, ADMIN, "admin", A);
    owner("INSERT INTO auth.users (id) VALUES ('" + APPROVER + "') ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + APPROVER + "', '" + A + "', 'Approbateur paie') ON CONFLICT (id) DO NOTHING");
    PostgresFixture.grantRoles(DATABASE, APPROVER, "hr_approver", A);
    owner("INSERT INTO hr_movement_references (tenant_id, kind, code, label) VALUES"
        + " ('" + A + "', 'contract_type', 'cdi', 'CDI'), ('" + A + "', 'payroll_category', 'cadre', 'Cadre'),"
        + " ('" + A + "', 'payroll_category', 'non-cadre', 'Non-cadre') ON CONFLICT (tenant_id, kind, code) DO NOTHING;"
        + "UPDATE employees SET status = 'inactive' WHERE tenant_id = '" + A + "';"
        + "DELETE FROM payroll_rule_versions WHERE tenant_id = '" + A + "';"
        + "DELETE FROM hr_payroll_settings WHERE tenant_id = '" + A + "'");
  }

  @Test
  @DisplayName("cotisations plafonnées, abattement par catégorie, charges de famille, arrondis, exonération partielle, écriture par compte")
  void calculComplet() throws SQLException {
    String version = asUser("SELECT save_payroll_rule_version('{\"country_code\":\"BF\",\"currency_code\":\"XOF\","
        + "\"effective_from\":\"2035-01-01\",\"reference\":\"Texte de test, article 1\",\"rounding_unit\":1,\"taxable_rounding_unit\":100,"
        + "\"income_tax_bands\":[{\"up_to\":100000,\"rate_pct\":0},{\"up_to\":null,\"rate_pct\":20}],"
        + "\"tax_abatements\":[{\"category\":\"cadre\",\"basis\":\"base_salary\",\"rate_pct\":20,\"max_amount\":50000},"
        + "{\"category\":null,\"basis\":\"base_salary\",\"rate_pct\":25}],"
        + "\"family_reductions\":[{\"dependents\":1,\"reduction_pct\":10},{\"dependents\":2,\"reduction_pct\":20}],\"family_max_dependents\":2,"
        + "\"contributions\":[{\"code\":\"PENS\",\"label\":\"Pension\",\"employee_rate_pct\":5.5,\"employer_rate_pct\":5.5,\"employee_ceiling\":600000,\"employer_ceiling\":600000},"
        + "{\"code\":\"PF\",\"label\":\"Prestations familiales\",\"employer_rate_pct\":7,\"employer_ceiling\":600000,\"sort_order\":1},"
        + "{\"code\":\"AT\",\"label\":\"Risques professionnels\",\"employer_rate_pct\":3.5,\"employer_ceiling\":600000,\"sort_order\":2}]}'::jsonb)::text");
    asUser("SELECT validate_payroll_rule_version('" + version + "')::text");

    String cadre = salarie("cadre", 3, 800000);
    String agent = salarie("non-cadre", 0, 200000);
    String code = "logement-" + UUID.randomUUID().toString().substring(0, 6);
    asUser("SELECT save_hr_payroll_component('{\"code\":\"" + code + "\",\"label\":\"Logement\",\"kind\":\"earning\",\"calculation_method\":\"fixed\","
        + "\"amount\":100000,\"effective_from\":\"2030-01-01\",\"taxable\":true,\"tax_exempt_pct\":20,\"tax_exempt_cap\":75000}'::jsonb)::text");
    owner("INSERT INTO hr_employee_payroll_components (tenant_id, employee_id, component_id, effective_from)"
        + " SELECT '" + A + "', '" + cadre + "', id, '2030-01-01' FROM hr_payroll_components WHERE tenant_id = '" + A + "' AND code = '" + code + "'");
    String run = cycle("2035-03");

    assertThat(asUser("SELECT generate_payroll_lines('" + run + "')::text")).isEqualTo("2");
    // Cadre : brut 900 000 ; base sociale 800 000 plafonnée à 600 000 → pension 33 000 / 33 000, PF 42 000, AT 21 000 ;
    // imposable 800 000 + (100 000 − 75 000 exonérés) − 33 000 = 792 000 ; abattement 20 % de 800 000 plafonné à 50 000 ;
    // 742 000 → impôt 20 % × 642 000 = 128 400 ; 3 charges retenues 2 → −20 % = 102 720 ; net 764 280.
    assertThat(ligne(run, cadre)).isEqualTo("900000.00|33000.00|102720.00|764280.00|96000.00");
    // Non-cadre : abattement « autres catégories » 25 % de 200 000 = 50 000 ; 200 000 − 11 000 − 50 000 = 139 000 ;
    // impôt 20 % × 39 000 = 7 800 ; net 181 200 ; charges 11 000 + 14 000 + 7 000.
    assertThat(ligne(run, agent)).isEqualTo("200000.00|11000.00|7800.00|181200.00|32000.00");
    assertThat(texte("SELECT string_agg(code_snapshot || ':' || kind || ':' || amount::bigint, ' ' ORDER BY code_snapshot, kind)"
        + " FROM payroll_component_lines WHERE run_id = '" + run + "' AND employee_id = '" + cadre + "' AND source_type = 'contribution'"))
        .as("une ligne de bulletin par part de cotisation")
        .isEqualTo("AT:employer_charge:21000 PENS:deduction:33000 PENS:employer_charge:33000 PF:employer_charge:42000");
    assertThat(texte("SELECT (definition_snapshot->'tax'->>'abatement') || '|' || (definition_snapshot->'tax'->>'dependents') || '|'"
        + " || (definition_snapshot->'tax'->>'reduction_pct') FROM payroll_component_lines WHERE run_id = '" + run
        + "' AND employee_id = '" + cadre + "' AND code_snapshot = 'BASE_SALARY'"))
        .as("le détail de l'impôt est photographié").isEqualTo("50000.00|2|20");
    assertThat(texte("SELECT (payroll_rules_snapshot->>'source') || '|' || (payroll_rules_snapshot->>'version_id') FROM payroll_runs WHERE id = '" + run + "'"))
        .isEqualTo("version|" + version);

    asUser(APPROVER, "SELECT precheck_payroll_run('" + run + "')::text");
    asUser(APPROVER, "SELECT approve_payroll_run('" + run + "')");
    String entry = asUser("SELECT post_payroll_run('" + run + "')::text");
    assertThat(texte("SELECT string_agg(g.code || ':' || l.debit::bigint || '/' || l.credit::bigint, ' ' ORDER BY g.code)"
        + " FROM journal_lines l JOIN gl_accounts g ON g.id = l.account_id WHERE l.entry_id = '" + entry + "'"))
        .as("écriture équilibrée : cotisations salariales et patronales créditées à l'organisme, part patronale en charge")
        .isEqualTo("422:0/945480 431:0/172000 447:0/110520 661:1100000/0 664:128000/0");
  }

  @Test
  @DisplayName("version applicable selon la date, version validée figée, validation contrôlée et réservée")
  void versionsDatees() throws SQLException {
    String v2036 = version("2036-01-01", 10, "Texte de test 2036");
    String v2036b = version("2036-07-01", 20, "Texte de test juillet 2036");
    String sansSource = version("2037-01-01", 30, "");
    asUser("SELECT validate_payroll_rule_version('" + v2036 + "')::text");
    asUser("SELECT validate_payroll_rule_version('" + v2036b + "')::text");
    assertThatThrownBy(() -> asUser("SELECT validate_payroll_rule_version('" + sansSource + "')::text"))
        .hasMessageContaining("Référence officielle");
    assertThatThrownBy(() -> asUser(APPROVER, "SELECT validate_payroll_rule_version('" + sansSource + "')::text"))
        .as("valider demande le droit dédié").hasMessageContaining("hr.payroll_rules_validate");

    String salarie = salarie("non-cadre", 0, 100000);
    String mars = cycle("2036-03"), aout = cycle("2036-08"), avant = cycle("2035-12");
    asUser("SELECT generate_payroll_lines('" + mars + "')::text");
    asUser("SELECT generate_payroll_lines('" + aout + "')::text");
    assertThat(ligne(mars, salarie)).startsWith("100000.00|10000.00|");
    assertThat(ligne(aout, salarie)).as("la version de juillet s'applique en août").startsWith("100000.00|20000.00|");
    assertThatThrownBy(() -> asUser("SELECT generate_payroll_lines('" + avant + "')::text"))
        .hasMessageContaining("pas applicables");

    assertThatThrownBy(() -> asUser("SELECT save_payroll_rule_version('{\"id\":\"" + v2036 + "\",\"country_code\":\"BF\",\"currency_code\":\"XOF\","
        + "\"effective_from\":\"2036-01-01\",\"reference\":\"x\"}'::jsonb)::text"))
        .as("une version validée ne se modifie pas").hasMessageContaining("seule une version brouillon");
    assertThatThrownBy(() -> owner("UPDATE payroll_contributions SET employee_rate_pct = 1 WHERE version_id = '" + v2036 + "'"))
        .as("même par le propriétaire").hasMessageContaining("figées");

    asUser("SELECT archive_payroll_rule_version('" + v2036b + "', 'Remplacée par erreur de saisie')::text");
    asUser("SELECT generate_payroll_lines('" + aout + "')::text");
    assertThat(ligne(aout, salarie)).as("archivée : la version précédente reprend").startsWith("100000.00|10000.00|");
    assertThat(texte("SELECT payroll_rules_snapshot->'contributions'->0->>'employee_rate_pct' FROM payroll_runs WHERE id = '" + mars + "'"))
        .as("le cycle garde la photographie des règles appliquées").isEqualTo("10.0000");
  }

  @Test
  @DisplayName("V150 — ordre de calcul, quantité × taux, formule, base nommée, barème ; dépendance circulaire refusée")
  void basesOrdreEtFormules() throws SQLException {
    asUser("SELECT validate_payroll_rule_version('" + version("2030-01-01", 0, "Texte de test sans cotisation") + "')::text");
    String s = UUID.randomUUID().toString().substring(0, 6);
    String hs = "hs-" + s, anc = "anc-" + s, logt = "logt-" + s, ech = "ech-" + s, ret = "ret-" + s, brut = "brut-" + s;
    rubrique("{\"code\":\"" + hs + "\",\"label\":\"Heures supplémentaires\",\"kind\":\"earning\",\"calculation_method\":\"quantity_rate\","
        + "\"amount\":1250,\"priority\":10}");
    rubrique("{\"code\":\"" + anc + "\",\"label\":\"Prime d'ancienneté\",\"kind\":\"earning\",\"calculation_method\":\"formula\","
        + "\"formula\":\"IF(SENIORITY_MONTHS >= 24, MIN(BASE * 0.05, 50000), 0)\",\"priority\":20}");
    asUser("SELECT save_payroll_base('{\"code\":\"" + brut + "\",\"label\":\"Brut cotisable\",\"include_base_salary\":true,"
        + "\"component_codes\":[\"" + hs + "\",\"" + anc + "\"]}'::jsonb)::text");
    rubrique("{\"code\":\"" + logt + "\",\"label\":\"Indemnité logement\",\"kind\":\"earning\",\"calculation_method\":\"percent_base\","
        + "\"amount\":10,\"base_code\":\"" + brut + "\",\"priority\":30}");
    rubrique("{\"code\":\"" + ech + "\",\"label\":\"Prime par tranche\",\"kind\":\"earning\",\"calculation_method\":\"scale\",\"scale_mode\":\"amount\","
        + "\"scale\":[{\"up_to\":100000,\"value\":5000},{\"up_to\":null,\"value\":10000}],\"priority\":30}");
    rubrique("{\"code\":\"" + ret + "\",\"label\":\"Retenue calculée\",\"kind\":\"deduction\",\"calculation_method\":\"formula\","
        + "\"formula\":\"ROUND([" + logt + "] / 2, 0)\",\"priority\":40}");

    assertThatThrownBy(() -> rubrique("{\"code\":\"boucle-" + s + "\",\"label\":\"Boucle\",\"kind\":\"earning\",\"calculation_method\":\"formula\","
        + "\"formula\":\"[" + ret + "] * 2\",\"priority\":5}"))
        .as("une rubrique ne peut utiliser qu'une rubrique calculée avant elle").hasMessageContaining("Ordre de calcul impossible");
    assertThatThrownBy(() -> rubrique("{\"code\":\"" + hs + "\",\"label\":\"Heures supplémentaires\",\"kind\":\"earning\","
        + "\"calculation_method\":\"quantity_rate\",\"amount\":1250,\"priority\":50,\"id\":\"" + texte("SELECT id FROM hr_payroll_components WHERE tenant_id = '" + A
        + "' AND code = '" + hs + "'") + "\"}"))
        .as("déplacer « hs » après le logement qui l'utilise (via la base) est refusé").hasMessageContaining("Ordre de calcul impossible");
    assertThatThrownBy(() -> rubrique("{\"code\":\"mauvaise-" + s + "\",\"label\":\"Formule\",\"kind\":\"earning\",\"calculation_method\":\"formula\","
        + "\"formula\":\"BASE * ; 2\"}"))
        .hasMessageContaining("caractère non autorisé");

    String salarie = salarie("non-cadre", 0, 173330);
    owner("INSERT INTO hr_employee_payroll_components (tenant_id, employee_id, component_id, effective_from, quantity)"
        + " SELECT '" + A + "', '" + salarie + "', id, '2030-01-01', CASE WHEN code = '" + hs + "' THEN 10 END FROM hr_payroll_components"
        + " WHERE tenant_id = '" + A + "' AND code IN ('" + hs + "', '" + anc + "', '" + logt + "', '" + ech + "', '" + ret + "')");
    String run = cycle("2035-05");
    asUser("SELECT generate_payroll_lines('" + run + "')::text");
    // hs 10 × 1 250 = 12 500 ; ancienneté 64 mois → 5 % de 173 330 = 8 666,50 ; base brut cotisable 194 496,50 ;
    // logement 10 % = 19 449,65 ; tranche (> 100 000) 10 000 ; retenue ROUND(19 449,65 / 2) = 9 725.
    assertThat(texte("SELECT string_agg(code_snapshot || '=' || amount, ' ' ORDER BY (definition_snapshot->>'priority')::int, code_snapshot)"
        + " FROM payroll_component_lines WHERE run_id = '" + run + "' AND employee_id = '" + salarie + "' AND component_id IS NOT NULL"))
        .isEqualTo(hs + "=12500.00 " + anc + "=8666.50 " + ech + "=10000.00 " + logt + "=19449.65 " + ret + "=9725.00");
    assertThat(ligne(run, salarie)).isEqualTo("223946.15|9725.00|0.00|214221.15|0.00");
    assertThat(texte("SELECT (definition_snapshot->>'base_value') || '|' || (definition_snapshot->>'base_code') FROM payroll_component_lines"
        + " WHERE run_id = '" + run + "' AND employee_id = '" + salarie + "' AND code_snapshot = '" + logt + "'"))
        .as("la base utilisée est photographiée").isEqualTo("194496.50|" + brut);
  }

  @Test
  @DisplayName("V151 — rappel rétroactif et trop-perçu par régularisation, contrepassation dans l'ordre")
  void regularisationEtContrepassation() throws SQLException {
    asUser("SELECT validate_payroll_rule_version('" + version("2030-01-01", 10, "Texte de test régularisation") + "')::text");
    owner("INSERT INTO hr_movement_references (tenant_id, kind, code, label) VALUES ('" + A + "', 'movement_type', 'salary_change', 'Changement de salaire'),"
        + " ('" + A + "', 'reason_code', 'promotion', 'Promotion') ON CONFLICT (tenant_id, kind, code) DO NOTHING");
    String salarie = salarie("non-cadre", 0, 100000);
    String initial = cycle("2038-02");
    asUser("SELECT generate_payroll_lines('" + initial + "')::text");
    approuverEtComptabiliser(initial);
    assertThat(ligne(initial, salarie)).isEqualTo("100000.00|10000.00|0.00|90000.00|0.00");

    assertThatThrownBy(() -> asUser("SELECT create_payroll_regularization('" + cycle("2038-03") + "', '2038-04-30', 'Rappel')::text"))
        .as("seul un cycle comptabilisé se régularise").hasMessageContaining("Seul un cycle comptabilisé");

    // Augmentation rétroactive au 1er février, approuvée après la comptabilisation de février.
    owner("INSERT INTO employee_movements (tenant_id, employee_id, movement_type, effective_date, reason_code, reason, before_values,"
        + " after_values, status, created_by, decided_by, decided_at) VALUES ('" + A + "', '" + salarie + "', 'salary_change', '2038-02-01',"
        + " 'promotion', 'Augmentation rétroactive', '{}', '{\"base_salary\":120000}', 'approved', '" + ADMIN + "', '" + APPROVER + "', now())");
    String rappel = asUser("SELECT create_payroll_regularization('" + initial + "', '2038-04-30', 'Rappel augmentation de février')::text");
    assertThat(asUser("SELECT generate_payroll_lines('" + rappel + "')::text")).isEqualTo("1");
    assertThat(ligne(rappel, salarie)).as("seule la différence est payée").isEqualTo("20000.00|2000.00|0.00|18000.00|0.00");
    String ecritureRappel = approuverEtComptabiliser(rappel);
    assertThat(ecriture(ecritureRappel)).isEqualTo("422:0/18000 431:0/2000 661:20000/0");

    // Retenue découverte après coup : trop-perçu (net négatif), à récupérer sur le salarié.
    String code = "avance-" + UUID.randomUUID().toString().substring(0, 6);
    rubrique("{\"code\":\"" + code + "\",\"label\":\"Avance non retenue\",\"kind\":\"deduction\",\"calculation_method\":\"fixed\",\"amount\":5000}");
    owner("INSERT INTO hr_employee_payroll_components (tenant_id, employee_id, component_id, effective_from)"
        + " SELECT '" + A + "', '" + salarie + "', id, '2038-02-01' FROM hr_payroll_components WHERE tenant_id = '" + A + "' AND code = '" + code + "'");
    String tropPercu = asUser("SELECT create_payroll_regularization('" + initial + "', '2038-05-31', 'Avance de février non retenue')::text");
    asUser("SELECT generate_payroll_lines('" + tropPercu + "')::text");
    assertThat(ligne(tropPercu, salarie)).isEqualTo("0.00|5000.00|0.00|-5000.00|0.00");
    String ecritureTropPercu = approuverEtComptabiliser(tropPercu);
    assertThat(ecriture(ecritureTropPercu)).as("le net négatif débite le compte du personnel")
        .isEqualTo("422:5000/0 431:0/5000");

    assertThatThrownBy(() -> asUser("SELECT reverse_payroll_run('" + initial + "', 'Erreur de période', '2038-06-01')::text"))
        .as("on ne contrepasse pas un cycle sous des régularisations comptabilisées").hasMessageContaining("contrepasser d'abord la plus récente");
    assertThatThrownBy(() -> asUser(APPROVER, "SELECT reverse_payroll_run('" + tropPercu + "', 'Erreur', '2038-06-01')::text"))
        .hasMessageContaining("hr.reverse_payroll");
    String contrepassation = asUser("SELECT reverse_payroll_run('" + tropPercu + "', 'Avance finalement retenue en mai', '2038-06-01')::text");
    assertThat(texte("SELECT status || '|' || (reversal_entry_id = '" + contrepassation + "') FROM payroll_runs WHERE id = '" + tropPercu + "'"))
        .isEqualTo("reversed|true");
    assertThat(ecriture(contrepassation)).as("l'écriture est contrepassée").isEqualTo("422:0/5000 431:5000/0");
    assertThatThrownBy(() -> owner("UPDATE payroll_runs SET notes = 'x' WHERE id = '" + tropPercu + "'"))
        .hasMessageContaining("contrepassé ne peut être modifié");
  }

  @Test
  @DisplayName("V152 — congés acquis et pris, solde contrôlé, absence en jours ouvrés, heures sup, transmission à la paie")
  void tempsAbsencesEtConges() throws SQLException {
    asUser("SELECT validate_payroll_rule_version('" + version("2030-01-01", 0, "Texte de test temps") + "')::text");
    String s = UUID.randomUUID().toString().substring(0, 6);
    rubrique("{\"code\":\"hsup-" + s + "\",\"label\":\"Heures supplémentaires\",\"kind\":\"earning\",\"calculation_method\":\"quantity_rate\",\"amount\":1500}");
    rubrique("{\"code\":\"absnp-" + s + "\",\"label\":\"Absence non payée\",\"kind\":\"deduction\",\"calculation_method\":\"formula\","
        + "\"formula\":\"ROUND(BASE / DAYS_TOTAL * QTY, 0)\"}");
    String hsup = typeTemps("{\"code\":\"hs-" + s + "\",\"label\":\"Heures sup\",\"kind\":\"overtime\",\"unit\":\"hour\",\"component_id\":\""
        + composant("hsup-" + s) + "\"}");
    String absence = typeTemps("{\"code\":\"anp-" + s + "\",\"label\":\"Absence non payée\",\"kind\":\"absence\",\"unit\":\"day\","
        + "\"count_method\":\"working\",\"component_id\":\"" + composant("absnp-" + s) + "\"}");
    String conge = typeTemps("{\"code\":\"cp-" + s + "\",\"label\":\"Congé payé\",\"kind\":\"leave\",\"unit\":\"day\",\"count_method\":\"calendar\","
        + "\"tracks_balance\":true,\"accrual_per_month\":2.5}");
    rubrique("{\"code\":\"fixe-" + s + "\",\"label\":\"Prime fixe\",\"kind\":\"earning\",\"calculation_method\":\"fixed\",\"amount\":1000}");
    assertThatThrownBy(() -> typeTemps("{\"code\":\"mauvais-" + s + "\",\"label\":\"X\",\"kind\":\"overtime\",\"unit\":\"hour\",\"component_id\":\""
        + composant("fixe-" + s) + "\"}"))
        .as("la rubrique liée porte la quantité").hasMessageContaining("quantité × taux");

    String salarie = salarie("non-cadre", 0, 310000);
    asUser("SELECT accrue_hr_leave('2039-01')::text");
    asUser("SELECT accrue_hr_leave('2039-02')::text");
    asUser("SELECT accrue_hr_leave('2039-02')::text");
    assertThat(texte("SELECT sum(quantity) FROM hr_leave_ledger WHERE employee_id = '" + salarie + "' AND type_id = '" + conge + "'"))
        .as("2,5 jours par mois, une seule acquisition par mois").isEqualTo("5.000");

    String cp = demande(salarie, conge, "2039-03-10", "2039-03-12", null);
    assertThatThrownBy(() -> asUser("SELECT decide_hr_time_request('" + cp + "', true)::text"))
        .as("l'auteur ne décide pas sa demande").hasMessageContaining("Séparation des tâches");
    asUser(APPROVER, "SELECT decide_hr_time_request('" + cp + "', true)::text");
    assertThatThrownBy(() -> demande(salarie, absence, "2039-03-11", "2039-03-11", null))
        .as("pas deux absences sur les mêmes dates").hasMessageContaining("couvre déjà");
    String cp2 = demande(salarie, conge, "2039-03-24", "2039-03-26", null);
    assertThatThrownBy(() -> asUser(APPROVER, "SELECT decide_hr_time_request('" + cp2 + "', true)::text"))
        .as("solde de 2 jours pour 3 demandés").hasMessageContaining("Solde insuffisant");

    // Vendredi 18 au lundi 21 mars 2039 : 2 jours ouvrés.
    String abs = demande(salarie, absence, "2039-03-18", "2039-03-21", null);
    assertThat(texte("SELECT quantity FROM hr_time_requests WHERE id = '" + abs + "'")).isEqualTo("2.00");
    String hs = demande(salarie, hsup, "2039-03-08", "2039-03-08", "10");
    asUser(APPROVER, "SELECT decide_hr_time_request('" + abs + "', true)::text");
    asUser(APPROVER, "SELECT decide_hr_time_request('" + hs + "', true)::text");

    String run = cycle("2039-03");
    assertThat(asUser("SELECT transfer_hr_time_to_payroll('" + run + "')::text")).as("le congé payé n'a pas de rubrique").isEqualTo("2");
    assertThat(asUser("SELECT transfer_hr_time_to_payroll('" + run + "')::text")).as("rien n'est transmis deux fois").isEqualTo("0");
    asUser("SELECT generate_payroll_lines('" + run + "')::text");
    // 310 000 + 10 h × 1 500 − ROUND(310 000 / 31 × 2) = 325 000 − 20 000.
    assertThat(ligne(run, salarie)).isEqualTo("325000.00|20000.00|0.00|305000.00|0.00");
    assertThatThrownBy(() -> asUser("SELECT cancel_hr_time_request('" + abs + "', 'Erreur de saisie')::text"))
        .as("une demande transmise ne s'annule plus").hasMessageContaining("déjà transmise");
    asUser("SELECT cancel_hr_time_request('" + cp + "', 'Congé reporté')::text");
    assertThat(texte("SELECT sum(quantity) FROM hr_leave_ledger WHERE employee_id = '" + salarie + "' AND type_id = '" + conge + "'"))
        .as("l'annulation recrédite le solde").isEqualTo("5.000");
  }

  @Test
  @DisplayName("V153 — jours fériés exclus, acquisition automatique au prorata, libre-service et approbateur désigné")
  void feriesAcquisitionAutoEtLibreService() throws SQLException {
    String s = UUID.randomUUID().toString().substring(0, 6);
    // 1er mai 2040 = mardi (férié récurrent) ; dimanche 6 mai 2040 reporté au lundi 7.
    asUser("SELECT save_hr_public_holiday('{\"label\":\"Fête du travail\",\"recurring_month\":5,\"recurring_day\":1}'::jsonb)::text");
    asUser("SELECT save_hr_public_holiday('{\"label\":\"Fête annoncée\",\"holiday_date\":\"2040-05-06\",\"move_if_sunday\":true}'::jsonb)::text");
    assertThat(asUser("SELECT string_agg(d->>'date', ',') FROM jsonb_array_elements(list_hr_public_holidays(2040)->'dates') d"))
        .isEqualTo("2040-05-01,2040-05-07");
    String absence = typeTemps("{\"code\":\"abs-" + s + "\",\"label\":\"Absence autorisée\",\"kind\":\"absence\",\"unit\":\"day\",\"count_method\":\"working\"}");
    String salarie = salarie("non-cadre", 0, 100000);
    owner("UPDATE employees SET hire_date = '2020-01-01' WHERE id = '" + salarie + "'");
    String a = demande(salarie, absence, "2040-05-01", "2040-05-08", null);
    assertThat(texte("SELECT quantity FROM hr_time_requests WHERE id = '" + a + "'"))
        .as("6 jours ouvrés du 1er au 8 mai, moins les fériés du 1er et du 7 (reporté)").isEqualTo("4.00");

    // Acquisition automatique : trois mois complets écoulés depuis accrual_from, rattrapés à la lecture des soldes.
    java.time.LocalDate debut = java.time.LocalDate.now().withDayOfMonth(1).minusMonths(3);
    String conge = typeTemps("{\"code\":\"cp-" + s + "\",\"label\":\"Congé payé\",\"kind\":\"leave\",\"unit\":\"day\",\"count_method\":\"calendar\","
        + "\"tracks_balance\":true,\"accrual_per_month\":2.5,\"accrual_from\":\"" + debut + "\",\"accrual_prorata\":true,"
        + "\"self_service\":true,\"approval_mode\":\"manager\"}");
    String embauche = UUID.randomUUID().toString();
    owner("INSERT INTO employees (id, tenant_id, matricule, first_name, last_name, contract_type, hire_date, base_salary, currency, status)"
        + " VALUES ('" + embauche + "', '" + A + "', 'R-" + embauche.substring(0, 8) + "', 'Ali', 'Prorata', 'CDI', '" + debut.withDayOfMonth(16)
        + "', 100000, 'XOF', 'active')");
    asUser("SELECT list_hr_leave_balances()::text");
    asUser("SELECT list_hr_leave_balances()::text");
    assertThat(asUser("SELECT qerp_jobs.hr_leave_accrue_all()::text"))
        .as("la tâche quotidienne (rôle de l'API) ne double rien une fois le rattrapage fait").isEqualTo("0");
    String solde ="SELECT sum(quantity)::text FROM hr_leave_ledger WHERE type_id = '" + conge + "' AND employee_id = '";
    assertThat(texte(solde + salarie + "'")).as("3 mois × 2,5, une seule fois").isEqualTo("7.500");
    int jours = debut.lengthOfMonth();
    java.math.BigDecimal premier = java.math.BigDecimal.valueOf(2.5 * (jours - 15) / jours).setScale(3, java.math.RoundingMode.HALF_UP);
    assertThat(texte(solde + embauche + "'")).as("embauché le 16 : premier mois au prorata des jours de présence")
        .isEqualTo(premier.add(new java.math.BigDecimal("5.000")).toPlainString());

    // Libre-service : le salarié saisit sa demande, son approbateur désigné (sans droit RH) la décide.
    String moi = UUID.randomUUID().toString(), chef = UUID.randomUUID().toString(), autre = UUID.randomUUID().toString();
    owner("INSERT INTO auth.users (id) VALUES ('" + moi + "'), ('" + chef + "'), ('" + autre + "');"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + moi + "', '" + A + "', 'Moi salarié'), ('" + chef + "', '" + A
        + "', 'Mon chef'), ('" + autre + "', '" + A + "', 'Autre membre')");
    for (String u : new String[] {moi, chef, autre}) PostgresFixture.grantRoles(DATABASE, u, "viewer", A);
    asUser("SELECT set_hr_employee_self_service('" + salarie + "', '" + moi + "', '" + chef + "')::text");
    assertThat(asUser(autre, "SELECT (my_hr_self_service()->'employee') IS NULL OR (my_hr_self_service()->'employee') = 'null'::jsonb"))
        .as("un compte non rattaché n'a pas de fiche").isEqualTo("t");
    assertThatThrownBy(() -> asUser(moi, "SELECT submit_my_time_request('" + absence + "', '2040-06-04', '2040-06-04', NULL, 'Rendez-vous')::text"))
        .as("type non ouvert au libre-service").hasMessageContaining("libre-service");
    String mienne = asUser(moi, "SELECT submit_my_time_request('" + conge + "', '2040-06-10', '2040-06-12', NULL, 'Vacances')::text");
    assertThatThrownBy(() -> asUser(moi, "SELECT decide_hr_time_request('" + mienne + "', true)::text"))
        .hasMessageContaining("hr.time_approve");
    assertThatThrownBy(() -> asUser(autre, "SELECT decide_hr_time_request('" + mienne + "', true)::text"))
        .as("un autre membre sans droit n'approuve pas").hasMessageContaining("hr.time_approve");
    assertThat(asUser(chef, "SELECT jsonb_array_length(my_hr_self_service()->'to_approve')::text")).isEqualTo("1");
    asUser(chef, "SELECT decide_hr_time_request('" + mienne + "', true)::text");
    assertThat(asUser(moi, "SELECT (b->>'balance') FROM jsonb_array_elements(my_hr_self_service()->'balances') b WHERE b->>'type_id' = '" + conge + "'"))
        .as("7,5 acquis − 3 pris").isEqualTo("4.500");
    // Type sans validation : approuvé dès l'enregistrement.
    String libre = typeTemps("{\"code\":\"tt-" + s + "\",\"label\":\"Télétravail\",\"kind\":\"absence\",\"unit\":\"day\",\"self_service\":true,\"approval_mode\":\"none\"}");
    String tt = asUser(moi, "SELECT submit_my_time_request('" + libre + "', '2040-06-14', '2040-06-14', NULL, 'Télétravail')::text");
    assertThat(texte("SELECT status FROM hr_time_requests WHERE id = '" + tt + "'")).isEqualTo("approved");
    asUser(moi, "SELECT cancel_my_time_request('" + mienne + "', 'Changement de dates')::text");
    assertThat(texte(solde + salarie + "'")).as("annulation : solde recrédité").isEqualTo("7.500");
  }

  @Test
  @DisplayName("V154 — lot de virement, fichier selon le format de la banque, retours payé / rejeté, 422 soldé, rejet repayé")
  void paiementDesSalaires() throws SQLException {
    asUser("SELECT validate_payroll_rule_version('" + version("2030-01-01", 10, "Texte de test paiement") + "')::text");
    String banque = UUID.randomUUID().toString();
    owner("INSERT INTO bank_accounts (id, tenant_id, name, bank_name, account_number, currency, account_type, gl_account_id, opening_balance, opening_date, is_active)"
        + " VALUES ('" + banque + "', '" + A + "', 'Banque paie', 'Banque test', 'BF999-000', 'XOF', 'bank', '"
        + texte("SELECT id FROM gl_accounts WHERE tenant_id = '" + A + "' AND code = '521'") + "', 0, '2041-01-01', true)");
    String format = asUser("SELECT save_payroll_bank_file_profile('{\"code\":\"vir-" + UUID.randomUUID().toString().substring(0, 6)
        + "\",\"label\":\"Gabarit banque test\",\"separator\":\";\",\"date_format\":\"DD/MM/YYYY\",\"amount_decimals\":0,\"columns\":["
        + "{\"header\":\"Matricule\",\"field\":\"matricule\"},{\"header\":\"RIB\",\"field\":\"bank_account\"},"
        + "{\"header\":\"Montant\",\"field\":\"amount\"},{\"header\":\"Date\",\"field\":\"payment_date\"},{\"header\":\"Motif\",\"value\":\"SALAIRE\"}]}'::jsonb)::text");
    String un = salarie("non-cadre", 0, 100000), deux = salarie("non-cadre", 0, 50000);
    owner("UPDATE employees SET bank_account = 'BF001 0001 1111' WHERE id = '" + un + "'; UPDATE employees SET bank_account = NULL WHERE id = '" + deux + "'");
    String run = cycle("2041-01");
    asUser("SELECT generate_payroll_lines('" + run + "')::text");
    approuverEtComptabiliser(run);
    String lot = "SELECT create_payroll_payment_batch('" + run + "', '" + banque + "', '" + format + "', '2041-01-31', NULL)::text";
    assertThatThrownBy(() -> asUser(lot)).as("RIB manquant : refus nominatif").hasMessageContaining("Coordonnées bancaires manquantes")
        .hasMessageContaining(texte("SELECT matricule FROM employees WHERE id = '" + deux + "'"));
    owner("UPDATE employees SET bank_account = 'BF001;0002' WHERE id = '" + deux + "'");
    String batch = asUser(lot);
    assertThat(texte("SELECT line_count || '|' || total_amount FROM payroll_payment_batches WHERE id = '" + batch + "'")).isEqualTo("2|135000.00");
    assertThatThrownBy(() -> asUser(lot)).as("jamais deux lots actifs pour les mêmes salariés").hasMessageContaining("Aucun net restant");
    assertThatThrownBy(() -> asUser("SELECT generate_payroll_payment_file('" + batch + "')::text")).hasMessageContaining("lot approuvé");
    assertThatThrownBy(() -> asUser("SELECT approve_payroll_payment_batch('" + batch + "')::text")).hasMessageContaining("Séparation des tâches");
    asUser(APPROVER, "SELECT approve_payroll_payment_batch('" + batch + "')::text");

    String fichier = asUser("SELECT generate_payroll_payment_file('" + batch + "')->>'content'");
    String m1 = texte("SELECT matricule FROM employees WHERE id = '" + un + "'"), m2 = texte("SELECT matricule FROM employees WHERE id = '" + deux + "'");
    assertThat(fichier.split("\r\n")).as("en-tête, puis une ligne par salarié ; la valeur contenant le séparateur est entre guillemets")
        .contains("Matricule;RIB;Montant;Date;Motif", m1 + ";BF001 0001 1111;90000;31/01/2041;SALAIRE", m2 + ";\"BF001;0002\";45000;31/01/2041;SALAIRE");
    String empreinte = texte("SELECT file_sha256 FROM payroll_payment_batches WHERE id = '" + batch + "'");
    assertThat(asUser("SELECT generate_payroll_payment_file('" + batch + "')->>'sha256'")).as("réédition : même fichier").isEqualTo(empreinte);
    assertThatThrownBy(() -> asUser("SELECT cancel_payroll_payment_batch('" + batch + "', 'Erreur')::text")).hasMessageContaining("ne s'annule plus");

    String resultat = asUser("SELECT record_payroll_payment_results('" + batch + "', '[{\"matricule\":\"" + m1 + "\",\"status\":\"paid\"},"
        + "{\"matricule\":\"" + m2 + "\",\"status\":\"rejected\",\"reason\":\"RIB invalide\"}]'::jsonb, '2041-02-02')->>'journal_entry_id'");
    assertThat(ecriture(resultat)).as("seul le payé est comptabilisé : 422 débité, banque créditée").isEqualTo("422:90000/0 521:0/90000");
    assertThat(texte("SELECT amount || '|' || reference || '|' || source FROM bank_transactions WHERE journal_entry_id = '" + resultat + "'"))
        .isEqualTo("-90000.00|" + texte("SELECT batch_number FROM payroll_payment_batches WHERE id = '" + batch + "'") + "|payroll");
    assertThat(texte("SELECT status FROM payroll_payment_batches WHERE id = '" + batch + "'")).isEqualTo("closed");

    String second = asUser(lot);
    assertThat(texte("SELECT line_count || '|' || total_amount FROM payroll_payment_batches WHERE id = '" + second + "'"))
        .as("le rejeté est repayable dans un nouveau lot").isEqualTo("1|45000.00");
    assertThat(asUser("SELECT (s->>'paid') || '|' || (s->>'in_progress') FROM payroll_run_payment_status('" + run + "') s"))
        .isEqualTo("90000.00|45000.00");
  }

  // ─── Outils ───

  private static String typeTemps(String json) throws SQLException {
    return asUser("SELECT save_hr_time_type('" + json.replace("'", "''") + "'::jsonb)::text");
  }

  private static String composant(String code) {
    return texte("SELECT id FROM hr_payroll_components WHERE tenant_id = '" + A + "' AND code = '" + code + "'");
  }

  private static String demande(String salarie, String type, String debut, String fin, String quantite) throws SQLException {
    return asUser("SELECT submit_hr_time_request('" + salarie + "', '" + type + "', '" + debut + "', '" + fin + "', "
        + (quantite == null ? "NULL" : quantite) + ", 'Demande de recette')::text");
  }

  private static String approuverEtComptabiliser(String run) throws SQLException {
    asUser(APPROVER, "SELECT precheck_payroll_run('" + run + "')::text");
    asUser(APPROVER, "SELECT approve_payroll_run('" + run + "')");
    return asUser("SELECT post_payroll_run('" + run + "')::text");
  }

  private static String ecriture(String entry) {
    return texte("SELECT string_agg(g.code || ':' || l.debit::bigint || '/' || l.credit::bigint, ' ' ORDER BY g.code)"
        + " FROM journal_lines l JOIN gl_accounts g ON g.id = l.account_id WHERE l.entry_id = '" + entry + "'");
  }

  private static void rubrique(String json) throws SQLException {
    String complet = json.substring(0, json.length() - 1) + ",\"effective_from\":\"2030-01-01\"}";
    asUser("SELECT save_hr_payroll_component('" + complet.replace("'", "''") + "'::jsonb)::text");
  }

  private static String version(String date, int taux, String source) throws SQLException {
    return asUser("SELECT save_payroll_rule_version('{\"country_code\":\"BF\",\"currency_code\":\"XOF\",\"effective_from\":\"" + date
        + "\",\"reference\":\"" + source + "\",\"income_tax_bands\":[{\"up_to\":null,\"rate_pct\":0}],"
        + "\"contributions\":[{\"code\":\"SOC\",\"label\":\"Sociale\",\"employee_rate_pct\":" + taux + "}]}'::jsonb)::text");
  }

  private static String salarie(String categorie, int charges, int salaire) {
    String id = UUID.randomUUID().toString();
    owner("INSERT INTO employees (id, tenant_id, matricule, first_name, last_name, contract_type, hire_date, base_salary, currency, status,"
        + " payroll_category, tax_dependents) VALUES ('" + id + "', '" + A + "', 'R-" + id.substring(0, 8) + "', 'Issa', 'Règles', 'CDI',"
        + " '2030-01-01', " + salaire + ", 'XOF', 'active', '" + categorie + "', " + charges + ")");
    return id;
  }

  private static String cycle(String periode) {
    String run = UUID.randomUUID().toString();
    owner("INSERT INTO payroll_runs (id, tenant_id, period, pay_date, status, created_by) VALUES ('" + run + "', '" + A + "', '"
        + periode + "', '" + periode + "-28', 'draft', '" + ADMIN + "')");
    return run;
  }

  private static String ligne(String run, String salarie) {
    return texte("SELECT gross || '|' || deductions || '|' || taxes || '|' || net || '|' || employer_charges FROM payroll_lines"
        + " WHERE run_id = '" + run + "' AND employee_id = '" + salarie + "'");
  }

  private static String asUser(String sql) throws SQLException {
    return asUser(ADMIN, sql);
  }

  private static String asUser(String userId, String sql) throws SQLException {
    try (Connection c = DriverManager.getConnection(
            PostgresFixture.urlOf(DATABASE), PostgresFixture.API_USER, PostgresFixture.API_PASSWORD)) {
      c.setAutoCommit(false);
      try (PreparedStatement claims = c.prepareStatement("SELECT set_config('request.jwt.claims', ?, true)")) {
        claims.setString(1, "{\"sub\":\"" + userId + "\",\"role\":\"authenticated\"}");
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
