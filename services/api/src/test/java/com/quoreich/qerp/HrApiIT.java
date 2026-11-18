package com.quoreich.qerp;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static com.jayway.jsonpath.JsonPath.read;
import static org.junit.jupiter.api.Assertions.assertEquals;

import com.quoreich.qerp.tenant.TenantContextHolder;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/** Parité de consultation RH entre le client Supabase et l'API PostgreSQL on-premise. */
@SpringBootTest
@AutoConfigureMockMvc
class HrApiIT {

  private static final String DATABASE = "qerp_it_hr_api";
  private static final String EMPLOYEE_ID = "e0000001-0000-0000-0000-000000000001";
  private static final String ALPHA_APPROVER = "aaaaaaaa-0000-0000-0000-000000000003";
  private static final String ALPHA_HR_ADMIN = "aaaaaaaa-0000-0000-0000-000000000004";

  @DynamicPropertySource
  static void properties(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @Autowired private MockMvc mockMvc;

  @BeforeEach
  void prepare() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.grantRoles(DATABASE, PostgresFixture.ALPHA_USER, "hr_clerk", PostgresFixture.ALPHA_TENANT);
    PostgresFixture.grantRoles(DATABASE, PostgresFixture.BETA_USER, "hr_clerk", PostgresFixture.BETA_TENANT);
    PostgresFixture.execute(PostgresFixture.urlOf(DATABASE), """
        INSERT INTO auth.users (id) VALUES ('%s'), ('%s') ON CONFLICT (id) DO NOTHING;
        INSERT INTO profiles (id, tenant_id, full_name) VALUES ('%s', '%s', 'Approbateur Alpha')
        ON CONFLICT (id) DO NOTHING;
        INSERT INTO profiles (id, tenant_id, full_name) VALUES ('%s', '%s', 'Administrateur RH Alpha')
        ON CONFLICT (id) DO NOTHING;
        """.formatted(ALPHA_APPROVER, ALPHA_HR_ADMIN, ALPHA_APPROVER, PostgresFixture.ALPHA_TENANT,
            ALPHA_HR_ADMIN, PostgresFixture.ALPHA_TENANT));
    PostgresFixture.grantRoles(DATABASE, ALPHA_APPROVER, "hr_approver", PostgresFixture.ALPHA_TENANT);
    PostgresFixture.grantRoles(DATABASE, ALPHA_HR_ADMIN, "hr_admin", PostgresFixture.ALPHA_TENANT);
    // V102 : contrat, service et poste viennent des référentiels de la société.
    PostgresFixture.execute(PostgresFixture.urlOf(DATABASE), """
        INSERT INTO hr_payroll_settings (tenant_id, currency_code, employer_contribution_pct) VALUES ('%s', 'XOF', 0)
        ON CONFLICT (tenant_id) DO NOTHING;
        INSERT INTO hr_movement_references (tenant_id, kind, code, label, active)
        VALUES ('%s', 'contract_type', 'cdi', 'CDI', true), ('%s', 'contract_type', 'cdd', 'CDD', true),
               ('%s', 'department', 'finance', 'Finance', true),
               ('%s', 'job_title', 'controleur', 'Contrôleur', true), ('%s', 'job_title', 'superviseur', 'Superviseur', true),
               ('%s', 'job_title', 'doublon', 'Doublon', true)
        ON CONFLICT (tenant_id, kind, code) DO NOTHING;
        """.formatted(PostgresFixture.ALPHA_TENANT, PostgresFixture.ALPHA_TENANT, PostgresFixture.ALPHA_TENANT, PostgresFixture.ALPHA_TENANT,
            PostgresFixture.ALPHA_TENANT, PostgresFixture.ALPHA_TENANT, PostgresFixture.ALPHA_TENANT));
    PostgresFixture.execute(PostgresFixture.urlOf(DATABASE), """
        INSERT INTO employees (id, tenant_id, matricule, first_name, last_name, contract_type,
                               hire_date, base_salary, currency, bank_account, status)
        VALUES ('%s', '%s', 'HR-API-1', 'Employée', 'Alpha', 'CDI', CURRENT_DATE,
                125000, 'XOF', 'CI1234567890', 'active')
        ON CONFLICT (id) DO NOTHING
        ;
        INSERT INTO hr_movement_references (tenant_id, kind, code, label, active)
        VALUES ('%s', 'movement_type', 'salary_change', 'Changement de salaire', true),
               ('%s', 'reason_code', 'promotion', 'Promotion', true),
               ('%s', 'movement_type', 'departure', 'Départ', true),
               ('%s', 'movement_type', 'rehire', 'Réintégration', true),
               ('%s', 'reason_code', 'termination', 'Fin de contrat', true),
               ('%s', 'reason_code', 'return', 'Reprise de fonction', true)
        ON CONFLICT (tenant_id, kind, code) DO NOTHING
        """.formatted(EMPLOYEE_ID, PostgresFixture.ALPHA_TENANT, PostgresFixture.ALPHA_TENANT,
            PostgresFixture.ALPHA_TENANT, PostgresFixture.ALPHA_TENANT, PostgresFixture.ALPHA_TENANT,
            PostgresFixture.ALPHA_TENANT, PostgresFixture.ALPHA_TENANT));
    PostgresFixture.execute(PostgresFixture.urlOf(DATABASE), """
        UPDATE hr_movement_references SET bulk_action_field = 'status',
          bulk_action_options = '[{"value":"terminated","label":"Terminé"}]'::jsonb
         WHERE tenant_id = '%s' AND kind = 'movement_type' AND code = 'departure';
        UPDATE hr_movement_references SET bulk_action_field = 'status',
          bulk_action_options = '[{"value":"active","label":"Actif"}]'::jsonb
         WHERE tenant_id = '%s' AND kind = 'movement_type' AND code = 'rehire'
        """.formatted(PostgresFixture.ALPHA_TENANT, PostgresFixture.ALPHA_TENANT));
    TenantContextHolder.clear();
  }

  @Test
  @DisplayName("les référentiels RH sont par société et modifiables seulement par l'administrateur RH")
  void referentielsMouvementConfiguresParTenant() throws Exception {
    mockMvc.perform(get("/api/v1/hr/movement-references")
            .with(jwt().jwt(b -> b.subject(PostgresFixture.ALPHA_USER))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[?(@.code == 'salary_change')]").isNotEmpty());
    mockMvc.perform(get("/api/v1/hr/movement-references")
            .with(jwt().jwt(b -> b.subject(PostgresFixture.BETA_USER))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[?(@.code == 'salary_change')]").isEmpty());
    mockMvc.perform(post("/api/v1/hr/movement-references")
            .with(jwt().jwt(b -> b.subject(PostgresFixture.ALPHA_USER)))
            .contentType(APPLICATION_JSON)
            .content("{\"kind\":\"movement_type\",\"code\":\"promotion\",\"label\":\"Promotion\",\"active\":true,\"sort_order\":0}"))
        .andExpect(status().isForbidden());
    mockMvc.perform(post("/api/v1/hr/movement-references")
            .with(jwt().jwt(b -> b.subject(ALPHA_HR_ADMIN)))
            .contentType(APPLICATION_JSON)
            .content("{\"kind\":\"movement_type\",\"code\":\"promotion\",\"label\":\"Promotion\",\"active\":true,\"sort_order\":0}"))
        .andExpect(status().isCreated());
    mockMvc.perform(post("/api/v1/hr/employees/" + EMPLOYEE_ID + "/movements")
            .with(jwt().jwt(b -> b.subject(PostgresFixture.ALPHA_USER)))
            .contentType(APPLICATION_JSON)
            .content("{\"movement_type\":\"unknown\",\"effective_date\":\"2099-01-01\",\"reason_code\":\"promotion\",\"reason\":\"Motif de recette\",\"after_values\":{\"job_title\":\"Contrôleur\"}}"))
        .andExpect(status().isUnprocessableEntity());
    mockMvc.perform(post("/api/v1/hr/employees/" + EMPLOYEE_ID + "/movements")
            .with(jwt().jwt(b -> b.subject(PostgresFixture.ALPHA_USER)))
            .contentType(APPLICATION_JSON)
            .content("{\"movement_type\":\"salary_change\",\"effective_date\":\"2099-01-02\",\"reason_code\":\"promotion\",\"reason\":\"\",\"after_values\":{\"job_title\":\"Contrôleur\"}}"))
        .andExpect(status().isUnprocessableEntity());
  }

  @Test
  @DisplayName("un motif RH désactivé ne peut pas servir à soumettre un mouvement")
  void refuseUnMotifDeMouvementInactif() throws Exception {
    PostgresFixture.execute(PostgresFixture.urlOf(DATABASE), """
        UPDATE hr_movement_references SET active = false
         WHERE tenant_id = '%s' AND kind = 'reason_code' AND code = 'promotion'
        """.formatted(PostgresFixture.ALPHA_TENANT));

    mockMvc.perform(post("/api/v1/hr/employees/" + EMPLOYEE_ID + "/movements")
            .with(jwt().jwt(b -> b.subject(PostgresFixture.ALPHA_USER)))
            .contentType(APPLICATION_JSON)
            .content("""
                {"movement_type":"salary_change","effective_date":"2099-02-01","reason_code":"promotion",
                 "reason":"Promotion de recette","after_values":{"job_title":"Superviseur"}}
                """))
        .andExpect(status().isUnprocessableEntity());
  }

  @Test
  @DisplayName("les rubriques de paie sont des paramètres propres à la société et protégés par les rôles centraux")
  void rubriquesPaieParametreesEtProtegees() throws Exception {
    mockMvc.perform(get("/api/v1/hr/payroll/components")
            .with(jwt().jwt(b -> b.subject(PostgresFixture.ALPHA_USER))))
        .andExpect(status().isOk());
    mockMvc.perform(post("/api/v1/hr/payroll/components")
            .with(jwt().jwt(b -> b.subject(PostgresFixture.ALPHA_USER)))
            .contentType(APPLICATION_JSON)
            .content("{\"code\":\"transport\",\"label\":\"Indemnité transport\",\"kind\":\"earning\",\"calculation_method\":\"fixed\",\"amount\":15000,\"effective_from\":\"2026-01-01\",\"active\":true}"))
        .andExpect(status().isForbidden());
    mockMvc.perform(post("/api/v1/hr/payroll/components")
            .with(jwt().jwt(b -> b.subject(ALPHA_HR_ADMIN)))
            .contentType(APPLICATION_JSON)
            .content("{\"code\":\"transport\",\"label\":\"Indemnité transport\",\"kind\":\"earning\",\"calculation_method\":\"fixed\",\"amount\":15000,\"effective_from\":\"2026-01-01\",\"active\":true}"))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.id").isNotEmpty());
    mockMvc.perform(get("/api/v1/hr/payroll/components")
            .with(jwt().jwt(b -> b.subject(PostgresFixture.BETA_USER))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[?(@.code == 'transport')]").isEmpty());
    mockMvc.perform(post("/api/v1/hr/payroll/components")
            .with(jwt().jwt(b -> b.subject(ALPHA_HR_ADMIN)))
            .contentType(APPLICATION_JSON)
            .content("{\"code\":\"invalid-rate\",\"label\":\"Taux invalide\",\"kind\":\"earning\",\"calculation_method\":\"percent_base\",\"amount\":101,\"effective_from\":\"2026-01-01\"}"))
        .andExpect(status().isUnprocessableEntity());
  }

  @Test
  @DisplayName("une rubrique récurrente s'affecte à un salarié du tenant et reste isolée")
  void affectationRubriqueSalarieIsolee() throws Exception {
    var component = mockMvc.perform(post("/api/v1/hr/payroll/components")
            .with(jwt().jwt(b -> b.subject(ALPHA_HR_ADMIN)))
            .contentType(APPLICATION_JSON)
            .content("{\"code\":\"meal\",\"label\":\"Indemnité repas\",\"kind\":\"earning\",\"calculation_method\":\"fixed\",\"amount\":5000,\"effective_from\":\"2026-01-01\"}"))
        .andExpect(status().isCreated()).andReturn();
    String componentId = read(component.getResponse().getContentAsString(), "$.id");
    PostgresFixture.execute(PostgresFixture.urlOf(DATABASE),
        "UPDATE hr_payroll_components SET sort_order = 17 WHERE id = '" + componentId + "'");
    PostgresFixture.execute(PostgresFixture.urlOf(DATABASE),
        "UPDATE hr_payroll_components SET sort_order = 17 WHERE id = '" + componentId + "'");
    var housing = mockMvc.perform(post("/api/v1/hr/payroll/components")
            .with(jwt().jwt(b -> b.subject(ALPHA_HR_ADMIN)))
            .contentType(APPLICATION_JSON)
            .content("{\"code\":\"housing\",\"label\":\"Indemnité logement\",\"kind\":\"earning\",\"calculation_method\":\"percent_base\",\"amount\":10,\"cap\":10000,\"effective_from\":\"2026-01-01\",\"taxable\":true,\"subject_employee_social\":true}"))
        .andExpect(status().isCreated()).andReturn();
    String housingId = read(housing.getResponse().getContentAsString(), "$.id");
    var loan = mockMvc.perform(post("/api/v1/hr/payroll/components")
            .with(jwt().jwt(b -> b.subject(ALPHA_HR_ADMIN)))
            .contentType(APPLICATION_JSON)
            .content("{\"code\":\"loan\",\"label\":\"Retenue prêt\",\"kind\":\"deduction\",\"calculation_method\":\"fixed\",\"amount\":2000,\"effective_from\":\"2026-01-01\"}"))
        .andExpect(status().isCreated()).andReturn();
    String loanId = read(loan.getResponse().getContentAsString(), "$.id");
    mockMvc.perform(post("/api/v1/hr/employees/" + EMPLOYEE_ID + "/payroll-components")
            .with(jwt().jwt(b -> b.subject(ALPHA_HR_ADMIN)))
            .contentType(APPLICATION_JSON)
            .content("{\"component_id\":\"" + componentId + "\",\"effective_from\":\"2026-01-01\",\"active\":true}"))
        .andExpect(status().isCreated());
    mockMvc.perform(post("/api/v1/hr/employees/" + EMPLOYEE_ID + "/payroll-components")
            .with(jwt().jwt(b -> b.subject(ALPHA_HR_ADMIN)))
            .contentType(APPLICATION_JSON)
            .content("{\"component_id\":\"" + componentId + "\",\"effective_from\":\"2026-02-01\",\"active\":true}"))
        .andExpect(status().isConflict());
    mockMvc.perform(post("/api/v1/hr/employees/" + EMPLOYEE_ID + "/payroll-components")
            .with(jwt().jwt(b -> b.subject(ALPHA_HR_ADMIN))).contentType(APPLICATION_JSON)
            .content("{\"component_id\":\"" + housingId + "\",\"effective_from\":\"2026-01-01\",\"active\":true}"))
        .andExpect(status().isCreated());
    mockMvc.perform(post("/api/v1/hr/employees/" + EMPLOYEE_ID + "/payroll-components")
            .with(jwt().jwt(b -> b.subject(ALPHA_HR_ADMIN))).contentType(APPLICATION_JSON)
            .content("{\"component_id\":\"" + loanId + "\",\"effective_from\":\"2026-01-01\",\"active\":true}"))
        .andExpect(status().isCreated());
    PostgresFixture.execute(PostgresFixture.urlOf(DATABASE), """
        INSERT INTO hr_payroll_settings (tenant_id, country_code, currency_code, employee_contribution_pct,
          employer_contribution_pct, income_tax_bands, rules_effective_from, rules_reference,
          rules_validated_at, rules_validated_by)
        VALUES ('%s', 'BF', 'XOF', 0, 0, '[{"up_to":null,"rate_pct":0}]'::jsonb,
          DATE '2026-01-01', 'Référence de test', now(), '%s')
        ON CONFLICT (tenant_id) DO UPDATE SET country_code = EXCLUDED.country_code,
          currency_code = EXCLUDED.currency_code, employee_contribution_pct = EXCLUDED.employee_contribution_pct,
          employer_contribution_pct = EXCLUDED.employer_contribution_pct, income_tax_bands = EXCLUDED.income_tax_bands,
          rules_effective_from = EXCLUDED.rules_effective_from, rules_reference = EXCLUDED.rules_reference,
          rules_validated_at = EXCLUDED.rules_validated_at, rules_validated_by = EXCLUDED.rules_validated_by
        """.formatted(PostgresFixture.ALPHA_TENANT, ALPHA_HR_ADMIN));
    assertEquals(1L, PostgresFixture.countAsAdmin(DATABASE,
        "SELECT CASE WHEN public.payroll_rules_valid(s) THEN 1 ELSE 0 END"
            + " FROM hr_payroll_settings s WHERE tenant_id = '" + PostgresFixture.ALPHA_TENANT + "'"));
    var run = mockMvc.perform(post("/api/v1/hr/payroll/runs")
            .with(jwt().jwt(b -> b.subject(PostgresFixture.ALPHA_USER)))
            .contentType(APPLICATION_JSON)
            .content("{\"period\":\"2027-01\",\"pay_date\":\"2027-01-31\"}"))
        .andExpect(status().isCreated()).andReturn();
    String runId = read(run.getResponse().getContentAsString(), "$.id");
    mockMvc.perform(post("/api/v1/hr/payroll/runs/" + runId + "/generate")
            .with(jwt().jwt(b -> b.subject(PostgresFixture.ALPHA_USER))))
        .andExpect(status().isOk());
    mockMvc.perform(get("/api/v1/hr/payroll/runs/" + runId + "/lines")
            .with(jwt().jwt(b -> b.subject(PostgresFixture.ALPHA_USER))))
        .andExpect(status().isOk());
    mockMvc.perform(post("/api/v1/hr/payroll/runs/" + runId + "/approve")
            .with(jwt().jwt(b -> b.subject(ALPHA_APPROVER))))
        .andExpect(status().isUnprocessableEntity());
    mockMvc.perform(post("/api/v1/hr/payroll/runs/" + runId + "/precheck")
            .with(jwt().jwt(b -> b.subject(ALPHA_APPROVER))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.run_id").value(runId))
        .andExpect(jsonPath("$.findings").isArray());
    mockMvc.perform(post("/api/v1/hr/payroll/runs/" + runId + "/generate")
            .with(jwt().jwt(b -> b.subject(PostgresFixture.ALPHA_USER))))
        .andExpect(status().isOk());
    mockMvc.perform(post("/api/v1/hr/payroll/runs/" + runId + "/approve")
            .with(jwt().jwt(b -> b.subject(ALPHA_APPROVER))))
        .andExpect(status().isUnprocessableEntity());
    assertEquals(140000L, PostgresFixture.countAsAdmin(DATABASE,
        "SELECT gross::bigint FROM payroll_lines WHERE run_id = '" + runId + "' AND employee_id = '" + EMPLOYEE_ID + "'"));
    assertEquals(138000L, PostgresFixture.countAsAdmin(DATABASE,
        "SELECT net::bigint FROM payroll_lines WHERE run_id = '" + runId + "' AND employee_id = '" + EMPLOYEE_ID + "'"));
    assertEquals(1L, PostgresFixture.countAsAdmin(DATABASE,
        "SELECT count(*) FROM payroll_component_lines WHERE run_id = '" + runId + "' AND employee_id = '" + EMPLOYEE_ID
            + "' AND code_snapshot = 'meal' AND amount = 5000"));
    PostgresFixture.execute(PostgresFixture.urlOf(DATABASE),
        "UPDATE hr_payroll_components SET sort_order = 99 WHERE id = '" + componentId + "'");
    assertEquals(1L, PostgresFixture.countAsAdmin(DATABASE,
        "SELECT count(*) FROM payroll_component_lines WHERE run_id = '" + runId
            + "' AND component_id = '" + componentId + "' AND definition_snapshot->>'sort_order' = '17'"));
    assertEquals(1L, PostgresFixture.countAsAdmin(DATABASE,
        "SELECT count(*) FROM payroll_component_lines WHERE run_id = '" + runId + "' AND employee_id = '" + EMPLOYEE_ID
            + "' AND code_snapshot = 'housing' AND amount = 10000 AND definition_snapshot->>'taxable' = 'true'"));
    mockMvc.perform(get("/api/v1/hr/payroll/runs/" + runId + "/component-lines?employeeId=" + EMPLOYEE_ID)
            .with(jwt().jwt(b -> b.subject(ALPHA_HR_ADMIN))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[?(@.code_snapshot == 'meal')]").isNotEmpty());
    var variableRun = mockMvc.perform(post("/api/v1/hr/payroll/runs")
            .with(jwt().jwt(b -> b.subject(PostgresFixture.ALPHA_USER)))
            .contentType(APPLICATION_JSON).content("{\"period\":\"2027-02\",\"pay_date\":\"2027-02-28\"}"))
        .andExpect(status().isCreated()).andReturn();
    String variableRunId = read(variableRun.getResponse().getContentAsString(), "$.id");
    var variable = mockMvc.perform(post("/api/v1/hr/payroll/runs/" + variableRunId + "/variables")
            .with(jwt().jwt(b -> b.subject(PostgresFixture.ALPHA_USER)))
            .contentType(APPLICATION_JSON)
            .content("{\"employee_id\":\"" + EMPLOYEE_ID + "\",\"component_id\":\"" + componentId
                + "\",\"amount\":7000,\"source_key\":\"prime-feb-1\",\"reason\":\"Prime approuvée de recette\"}"))
        .andExpect(status().isCreated()).andReturn();
    String variableId = read(variable.getResponse().getContentAsString(), "$.id");
    mockMvc.perform(post("/api/v1/hr/payroll/runs/" + variableRunId + "/generate")
            .with(jwt().jwt(b -> b.subject(PostgresFixture.ALPHA_USER))))
        .andExpect(status().isUnprocessableEntity());
    mockMvc.perform(post("/api/v1/hr/payroll/variables/" + variableId + "/approve")
            .with(jwt().jwt(b -> b.subject(ALPHA_HR_ADMIN))).contentType(APPLICATION_JSON).content("{}"))
        .andExpect(status().isOk());
    var selfVariable = mockMvc.perform(post("/api/v1/hr/payroll/runs/" + variableRunId + "/variables")
            .with(jwt().jwt(b -> b.subject(ALPHA_HR_ADMIN)))
            .contentType(APPLICATION_JSON)
            .content("{\"employee_id\":\"" + EMPLOYEE_ID + "\",\"component_id\":\"" + componentId
                + "\",\"amount\":1000,\"source_key\":\"prime-feb-self\",\"reason\":\"Prime pour contrôle SoD\"}"))
        .andExpect(status().isCreated()).andReturn();
    String selfVariableId = read(selfVariable.getResponse().getContentAsString(), "$.id");
    mockMvc.perform(post("/api/v1/hr/payroll/variables/" + selfVariableId + "/approve")
            .with(jwt().jwt(b -> b.subject(ALPHA_HR_ADMIN))).contentType(APPLICATION_JSON).content("{}"))
        .andExpect(status().isForbidden());
    mockMvc.perform(post("/api/v1/hr/payroll/variables/" + variableId + "/approve")
            .with(jwt().jwt(b -> b.subject(ALPHA_APPROVER))).contentType(APPLICATION_JSON).content("{}"))
        .andExpect(status().isUnprocessableEntity());
    mockMvc.perform(post("/api/v1/hr/payroll/variables/" + selfVariableId + "/approve")
            .with(jwt().jwt(b -> b.subject(ALPHA_APPROVER))).contentType(APPLICATION_JSON).content("{}"))
        .andExpect(status().isOk());
    mockMvc.perform(post("/api/v1/hr/payroll/runs/" + variableRunId + "/generate")
            .with(jwt().jwt(b -> b.subject(PostgresFixture.ALPHA_USER))))
        .andExpect(status().isOk());
    assertEquals(148000L, PostgresFixture.countAsAdmin(DATABASE,
        "SELECT gross::bigint FROM payroll_lines WHERE run_id = '" + variableRunId + "' AND employee_id = '" + EMPLOYEE_ID + "'"));
    assertEquals(3L, PostgresFixture.countAsAdmin(DATABASE,
        "SELECT count(*) FROM payroll_component_lines WHERE run_id = '" + variableRunId
            + "' AND component_id = '" + componentId + "' AND definition_snapshot->>'sort_order' = '99'"));
    mockMvc.perform(get("/api/v1/hr/employees/" + EMPLOYEE_ID + "/payroll-components")
            .with(jwt().jwt(b -> b.subject(PostgresFixture.ALPHA_USER))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[?(@.code == 'meal')]").isNotEmpty());
    mockMvc.perform(get("/api/v1/hr/employees/" + EMPLOYEE_ID + "/payroll-components")
            .with(jwt().jwt(b -> b.subject(PostgresFixture.BETA_USER))))
        .andExpect(status().isForbidden());
  }

  @Test
  @DisplayName("le gestionnaire RH lit son annuaire on-premise sans exposer salaire ni compte bancaire")
  void annuaireMasqueLesChampsSensibles() throws Exception {
    mockMvc.perform(get("/api/v1/hr/employees").with(jwt().jwt(b -> b.subject(PostgresFixture.ALPHA_USER))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[?(@.id == '" + EMPLOYEE_ID + "')].matricule")
            .value(org.hamcrest.Matchers.contains("HR-API-1")))
        .andExpect(jsonPath("$[?(@.id == '" + EMPLOYEE_ID + "')].base_salary")
            .value(org.hamcrest.Matchers.contains(org.hamcrest.Matchers.nullValue())))
        .andExpect(jsonPath("$[?(@.id == '" + EMPLOYEE_ID + "')].bank_account")
            .value(org.hamcrest.Matchers.contains(org.hamcrest.Matchers.nullValue())));
  }

  @Test
  @DisplayName("les dossiers salariés restent isolés par société dans l'API RH")
  void annuaireLimiteAuTenantDuJeton() throws Exception {
    mockMvc.perform(get("/api/v1/hr/employees").with(jwt().jwt(b -> b.subject(PostgresFixture.BETA_USER))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[?(@.id == '" + EMPLOYEE_ID + "')]").isEmpty());
  }

  @Test
  @DisplayName("la création d'un dossier passe par le contrôle RH de la base")
  void creeUnSalarieSansEcraserLeTenant() throws Exception {
    mockMvc.perform(post("/api/v1/hr/employees")
            .with(jwt().jwt(b -> b.subject(PostgresFixture.ALPHA_USER)))
            .contentType(APPLICATION_JSON)
            .content("""
                {"matricule":"HR-API-2","first_name":"Nadia","last_name":"Test","contract_type":"CDI","base_salary":0}
                """))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.id").isNotEmpty());
  }

  @Test
  @DisplayName("les matricules automatiques suivent la configuration de la société")
  void genereMatriculeDepuisLesParametres() throws Exception {
    mockMvc.perform(put("/api/v1/hr/employee-number-settings")
            .with(jwt().jwt(b -> b.subject(ALPHA_HR_ADMIN)))
            .contentType(APPLICATION_JSON)
            .content("""
                {"prefix":"QERP","include_year":true,"separator":"/","number_width":4,"next_number":42,"default_status":"active"}
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.prefix").value("QERP"));

    mockMvc.perform(post("/api/v1/hr/employees")
            .with(jwt().jwt(b -> b.subject(PostgresFixture.ALPHA_USER)))
            .contentType(APPLICATION_JSON)
            .content("""
                {"first_name":"Nina","last_name":"Sans matricule","contract_type":"CDI"}
                """))
        .andExpect(status().isCreated());

    mockMvc.perform(get("/api/v1/hr/employees").with(jwt().jwt(b -> b.subject(ALPHA_HR_ADMIN))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[?(@.first_name == 'Nina')].matricule").value(org.hamcrest.Matchers.contains(
            "QERP/" + java.time.LocalDate.now().getYear() + "/0042")));
  }

  @Test
  @DisplayName("l'import CSV et les actions groupées s'appuient sur les références paramétrées")
  void importeEmployesEtSoumetActionGroupeeParametree() throws Exception {
    var imported = mockMvc.perform(post("/api/v1/hr/employees/import")
            .with(jwt().jwt(b -> b.subject(PostgresFixture.ALPHA_USER)))
            .contentType(APPLICATION_JSON)
            .content("""
                {"rows":[{"first_name":"Awa","last_name":"Importée","contract_type":"CDD"}]}
                """))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.created_count").value(1))
        .andExpect(jsonPath("$.employees[0].matricule").isNotEmpty())
        .andReturn();
    String importedId = read(imported.getResponse().getContentAsString(), "$.employees[0].id");

    mockMvc.perform(post("/api/v1/hr/movement-references")
            .with(jwt().jwt(b -> b.subject(ALPHA_HR_ADMIN)))
            .contentType(APPLICATION_JSON)
            .content("""
                {"kind":"movement_type","code":"department_move","label":"Changement de service","active":true,"sort_order":1,
                 "bulk_action_field":"department","bulk_action_options":[{"value":"Finance","label":"Finance"}]}
                """))
        .andExpect(status().isCreated());

    mockMvc.perform(post("/api/v1/hr/employees/bulk-movements")
            .with(jwt().jwt(b -> b.subject(PostgresFixture.ALPHA_USER)))
            .contentType(APPLICATION_JSON)
            .content("""
                {"employee_ids":["%s"],"movement_type":"department_move","effective_date":"2099-01-01",
                 "reason_code":"promotion","reason":"Réorganisation du service","action_value":"Finance"}
                """.formatted(importedId)))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.created_count").value(1));

    mockMvc.perform(get("/api/v1/hr/employees").with(jwt().jwt(b -> b.subject(PostgresFixture.ALPHA_USER))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[?(@.id == '" + importedId + "')].department").value(org.hamcrest.Matchers.contains((Object) null)));
  }

  @Test
  @DisplayName("la paie crée un cycle dans la société du jeton")
  void creeUnCycleDePaie() throws Exception {
    mockMvc.perform(post("/api/v1/hr/payroll/runs")
            .with(jwt().jwt(b -> b.subject(PostgresFixture.ALPHA_USER)))
            .contentType(APPLICATION_JSON)
            .content("""
                {"period":"2026-12","pay_date":"2026-12-31"}
                """))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.id").isNotEmpty());
  }

  @Test
  @DisplayName("le contexte RH provient de la société rattachée au jeton")
  void litLeContexteDeLaSociete() throws Exception {
    mockMvc.perform(get("/api/v1/hr/company-context").with(jwt().jwt(b -> b.subject(PostgresFixture.ALPHA_USER))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.currency").isNotEmpty())
        .andExpect(jsonPath("$.fiscal_year_start").isNumber());
  }

  @Test
  @DisplayName("un gestionnaire de dossier ne peut pas modifier les paramètres légaux de paie")
  void refuseLaModificationDesBaremesSansDroitCentral() throws Exception {
    mockMvc.perform(put("/api/v1/hr/payroll/settings")
            .with(jwt().jwt(b -> b.subject(PostgresFixture.ALPHA_USER)))
            .contentType(APPLICATION_JSON)
            .content("""
                {"country_code":"BF","currency_code":"XOF","employee_contribution_pct":0,"employer_contribution_pct":0,"income_tax_bands":[],"rules_effective_from":"2026-01-01","rules_reference":"Référence test"}
                """))
        .andExpect(status().isForbidden());
  }

  @Test
  @DisplayName("un taux de tranche nul ne peut pas être confirmé comme barème de paie valide")
  void refuseUnTauxDeTrancheNul() throws Exception {
    try {
      mockMvc.perform(put("/api/v1/hr/payroll/settings")
              .with(jwt().jwt(b -> b.subject(ALPHA_HR_ADMIN)))
              .contentType(APPLICATION_JSON)
              .content("""
                  {"country_code":"CI","currency_code":"XOF","employee_contribution_pct":0,
                   "employer_contribution_pct":0,"income_tax_bands":[{"up_to":null,"rate_pct":null}],
                   "rules_effective_from":"2026-01-01","rules_reference":"Paramètre de validation de test"}
                  """))
          .andExpect(status().isOk());

      mockMvc.perform(post("/api/v1/hr/payroll/settings/confirm")
              .with(jwt().jwt(b -> b.subject(ALPHA_HR_ADMIN)))
              .contentType(APPLICATION_JSON).content("{}"))
          .andExpect(status().isUnprocessableEntity());
    } finally {
      PostgresFixture.execute(PostgresFixture.urlOf(DATABASE), """
          UPDATE hr_payroll_settings SET country_code = 'BF', currency_code = 'XOF',
            employee_contribution_pct = 0, employee_contribution_cap = NULL,
            employer_contribution_pct = 0, employer_contribution_cap = NULL,
            income_tax_bands = '[{"up_to":null,"rate_pct":0}]'::jsonb,
            rules_effective_from = DATE '2026-01-01', rules_reference = 'Référence de test'
           WHERE tenant_id = '%s';
          UPDATE hr_payroll_settings SET rules_validated_at = now(), rules_validated_by = '%s'
           WHERE tenant_id = '%s';
          """.formatted(PostgresFixture.ALPHA_TENANT, ALPHA_HR_ADMIN, PostgresFixture.ALPHA_TENANT));
    }
  }

  @Test
  @DisplayName("un changement RH est soumis comme mouvement effectif-daté")
  void soumetUnMouvementDate() throws Exception {
    var submitted = mockMvc.perform(post("/api/v1/hr/employees/" + EMPLOYEE_ID + "/movements")
            .with(jwt().jwt(b -> b.subject(PostgresFixture.ALPHA_USER)))
            .contentType(APPLICATION_JSON)
            .content("""
                {"movement_type":"salary_change","effective_date":"2099-01-01","reason_code":"promotion","reason":"Promotion de recette","after_values":{"base_salary":150000,"job_title":"Superviseur"}}
                """))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.id").isNotEmpty())
        .andExpect(jsonPath("$.status").value("pending"))
        .andReturn();
    String movementId = read(submitted.getResponse().getContentAsString(), "$.id");
    mockMvc.perform(get("/api/v1/hr/employees/" + EMPLOYEE_ID + "/movements")
            .with(jwt().jwt(b -> b.subject(PostgresFixture.ALPHA_USER))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].after_values.base_salary").doesNotExist());
    mockMvc.perform(post("/api/v1/hr/employee-movements/" + movementId + "/approve")
            .with(jwt().jwt(b -> b.subject(PostgresFixture.ALPHA_USER)))
            .contentType(APPLICATION_JSON).content("{}"))
        .andExpect(status().isForbidden());
    mockMvc.perform(post("/api/v1/hr/employee-movements/" + movementId + "/approve")
            .with(jwt().jwt(b -> b.subject(ALPHA_APPROVER)))
            .contentType(APPLICATION_JSON).content("{}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("approved"));
    String before = """
        WITH claim AS (SELECT set_config('request.jwt.claims', '{\"sub\":\"%s\",\"role\":\"authenticated\"}', true))
        SELECT (public.hr_employee_state_at('%s'::uuid, DATE '2098-12-31')->>'base_salary')::numeric FROM claim
        """.formatted(PostgresFixture.ALPHA_USER, EMPLOYEE_ID);
    String after = """
        WITH claim AS (SELECT set_config('request.jwt.claims', '{\"sub\":\"%s\",\"role\":\"authenticated\"}', true))
        SELECT (public.hr_employee_state_at('%s'::uuid, DATE '2099-01-01')->>'base_salary')::numeric FROM claim
        """.formatted(PostgresFixture.ALPHA_USER, EMPLOYEE_ID);
    assertEquals(125000L, PostgresFixture.countAsAdmin(DATABASE, before));
    assertEquals(150000L, PostgresFixture.countAsAdmin(DATABASE, after));

    mockMvc.perform(post("/api/v1/hr/employees/" + EMPLOYEE_ID + "/movements")
            .with(jwt().jwt(b -> b.subject(PostgresFixture.ALPHA_USER)))
            .contentType(APPLICATION_JSON)
            .content("{\"movement_type\":\"salary_change\",\"effective_date\":\"2099-01-01\",\"reason_code\":\"promotion\",\"reason\":\"Même date\",\"after_values\":{\"job_title\":\"Doublon\"}}"))
        .andExpect(status().isConflict());

    String departure = submitMovement("departure", "2100-01-01", "termination", "Fin de contrat", "terminated");
    approveMovement(departure);
    String rehire = submitMovement("rehire", "2101-01-01", "return", "Réintégration", "active");
    approveMovement(rehire);
    assertEquals(1L, PostgresFixture.countAsAdmin(DATABASE, stateIs("2099-12-31", "active")));
    assertEquals(1L, PostgresFixture.countAsAdmin(DATABASE, stateIs("2100-01-01", "terminated")));
    assertEquals(1L, PostgresFixture.countAsAdmin(DATABASE, stateIs("2101-01-01", "active")));
  }

  @Test
  @DisplayName("un mouvement rejeté reste audité et ne modifie pas le dossier effectif")
  void rejetteUnMouvementSansAppliquerSesValeurs() throws Exception {
    var submitted = mockMvc.perform(post("/api/v1/hr/employees/" + EMPLOYEE_ID + "/movements")
            .with(jwt().jwt(b -> b.subject(PostgresFixture.ALPHA_USER)))
            .contentType(APPLICATION_JSON)
            .content("""
                {"movement_type":"salary_change","effective_date":"2099-03-01","reason_code":"promotion",
                 "reason":"Changement refusé","after_values":{"job_title":"Superviseur"}}
                """))
        .andExpect(status().isCreated())
        .andReturn();
    String movementId = read(submitted.getResponse().getContentAsString(), "$.id");
    mockMvc.perform(post("/api/v1/hr/employee-movements/" + movementId + "/reject")
            .with(jwt().jwt(b -> b.subject(ALPHA_APPROVER)))
            .contentType(APPLICATION_JSON).content("{\"reason\":\"Pièce justificative absente\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("rejected"));

    mockMvc.perform(get("/api/v1/hr/employees/" + EMPLOYEE_ID + "/movements")
            .with(jwt().jwt(b -> b.subject(PostgresFixture.ALPHA_USER))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[?(@.id == '" + movementId + "')].status")
            .value(org.hamcrest.Matchers.contains("rejected")))
        .andExpect(jsonPath("$[?(@.id == '" + movementId + "')].decision_reason")
            .value(org.hamcrest.Matchers.contains("Pièce justificative absente")));
    assertEquals(1L, PostgresFixture.countAsAdmin(DATABASE, stateIs("2099-03-01", "active")));

    mockMvc.perform(post("/api/v1/hr/employee-movements/" + movementId + "/approve")
            .with(jwt().jwt(b -> b.subject(ALPHA_APPROVER)))
            .contentType(APPLICATION_JSON).content("{}"))
        .andExpect(status().isUnprocessableEntity());
  }

  private String submitMovement(String type, String date, String reasonCode, String reason, String status) throws Exception {
    String json = "{\"movement_type\":\"" + type + "\",\"effective_date\":\"" + date
        + "\",\"reason_code\":\"" + reasonCode + "\",\"reason\":\"" + reason
        + "\",\"after_values\":{\"status\":\"" + status + "\"}}";
    var response = mockMvc.perform(post("/api/v1/hr/employees/" + EMPLOYEE_ID + "/movements")
            .with(jwt().jwt(b -> b.subject(PostgresFixture.ALPHA_USER)))
            .contentType(APPLICATION_JSON).content(json))
        .andExpect(status().isCreated())
        .andReturn();
    return read(response.getResponse().getContentAsString(), "$.id");
  }

  private void approveMovement(String movementId) throws Exception {
    mockMvc.perform(post("/api/v1/hr/employee-movements/" + movementId + "/approve")
            .with(jwt().jwt(b -> b.subject(ALPHA_APPROVER)))
            .contentType(APPLICATION_JSON).content("{}"))
        .andExpect(status().isOk());
  }

  private String stateIs(String date, String expectedStatus) {
    return ("WITH claim AS (SELECT set_config('request.jwt.claims', '{\"sub\":\"%s\",\"role\":\"authenticated\"}', true)) "
        + "SELECT CASE WHEN public.hr_employee_state_at('%s'::uuid, DATE '%s')->>'status' = '%s' THEN 1 ELSE 0 END FROM claim")
        .formatted(PostgresFixture.ALPHA_USER, EMPLOYEE_ID, date, expectedStatus);
  }
}




