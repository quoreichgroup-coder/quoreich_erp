import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { moduleCan, useMyAccess } from "@/hooks/use-my-access";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/use-tenant";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { HrPerms, HrRole } from "@/lib/hr-roles";
import { ALL_HR_ROLES } from "@/lib/hr-roles";
import { useTenantRoleMembers } from "@/hooks/use-role-members";
import { validatePayrollRunInput } from "@/lib/hr-periods";
import { sumPostedPayrollGrossForFiscalYear } from "@/lib/payroll-summary";
import { apiGet, apiPost, apiPut, isApiEnabled } from "@/api/client";

export type Employee = {
  id: string;
  tenant_id: string;
  matricule: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  department: string | null;
  contract_type: string;
  hire_date: string;
  end_date: string | null;
  base_salary: number | null;
  currency: string;
  bank_account: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export type EmployeeMovement = {
  id: string;
  tenant_id: string;
  employee_id: string;
  movement_type: string;
  effective_date: string;
  reason_code: string;
  reason: string;
  before_values: Record<string, unknown>;
  after_values: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
  created_by: string;
  created_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_reason: string | null;
};

export type HrMovementReference = {
  id: string;
  tenant_id: string;
  kind: "movement_type" | "reason_code" | "contract_type" | "department" | "job_title";
  code: string;
  label: string;
  active: boolean;
  sort_order: number;
  bulk_action_field: string | null;
  bulk_action_options: { value: string; label: string }[];
};

export type HrEmployeeNumberSettings = {
  tenant_id?: string;
  prefix: string;
  include_year: boolean;
  separator: string;
  number_width: number;
  next_number: number;
  default_status: string;
};

export function useHrEmployeeNumberSettings() {
  const { data: tenantId } = useTenantId();
  const source = isApiEnabled() ? "api" : "supabase";
  return useQuery({
    queryKey: ["hr-employee-number-settings", tenantId, source],
    enabled: !!tenantId,
    queryFn: async () => {
      if (isApiEnabled()) return apiGet<HrEmployeeNumberSettings>("/api/v1/hr/employee-number-settings");
      const { data, error } = await (supabase as any).rpc("list_hr_employee_number_settings");
      if (error) throw error;
      return (Array.isArray(data) ? data[0] : data) as HrEmployeeNumberSettings;
    },
  });
}

export function useSaveHrEmployeeNumberSettings() {
  const qc = useQueryClient();
  const { data: tenantId } = useTenantId();
  return useMutation({
    mutationFn: async (input: HrEmployeeNumberSettings) => {
      if (isApiEnabled()) return apiPut<HrEmployeeNumberSettings>("/api/v1/hr/employee-number-settings", input);
      const { data, error } = await (supabase as any).rpc("save_hr_employee_number_settings", {
        _prefix: input.prefix, _include_year: input.include_year, _separator: input.separator,
        _number_width: input.number_width, _next_number: input.next_number, _default_status: input.default_status,
      });
      if (error) throw error;
      return (Array.isArray(data) ? data[0] : data) as HrEmployeeNumberSettings;
    },
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["hr-employee-number-settings", tenantId] }); toast.success("Numérotation enregistrée."); },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useImportHrEmployees() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rows: Record<string, unknown>[]) => {
      if (isApiEnabled()) return apiPost<{ created_count: number; employees: { id: string; matricule: string }[] }>("/api/v1/hr/employees/import", { rows });
      const { data, error } = await (supabase as any).rpc("import_hr_employees", { _rows: rows });
      if (error) throw error;
      return data as { created_count: number; employees: { id: string; matricule: string }[] };
    },
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["hr-employees"] }); toast.success("Import des salariés terminé."); },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useCreateEmployeeMovementsBulk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { employee_ids: string[]; movement_type: string; effective_date: string; reason_code: string; reason: string; action_value: string }) => {
      if (isApiEnabled()) return apiPost<{ created_count: number }>("/api/v1/hr/employees/bulk-movements", input);
      const { data, error } = await (supabase as any).rpc("create_employee_movements_bulk", {
        _employee_ids: input.employee_ids, _movement_type: input.movement_type, _effective_date: input.effective_date,
        _reason_code: input.reason_code, _reason: input.reason, _action_value: input.action_value,
      });
      if (error) throw error;
      return data as { created_count: number };
    },
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["hr-employees"] }); await qc.invalidateQueries({ queryKey: ["hr-employee-movements"] }); toast.success("Mouvements groupés soumis à approbation."); },
    onError: (error: Error) => toast.error(error.message),
  });
}

export type PayrollRun = {
  id: string;
  tenant_id: string;
  period: string;
  pay_date: string;
  status: string;
  gross_total: number;
  net_total: number;
  deductions_total: number;
  taxes_total: number;
  employer_charges_total: number;
  employee_count: number;
  created_by: string | null;
  approved_by: string | null;
  executed_by: string | null;
  approved_at: string | null;
  executed_at: string | null;
  notes: string | null;
  payroll_country_code: string | null;
  payroll_currency_code: string | null;
  payroll_rules_snapshot: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type HrRoleAuditRow = {
  id: string; created_at: string; tenant_id: string;
  performed_by: string; target_user_id: string;
  role: string; action: "grant" | "revoke"; reason: string | null;
};

export type HrPayrollSettings = {
  country_code: string | null;
  currency_code: string | null;
  employee_contribution_pct: number | null;
  employee_contribution_cap: number | null;
  employer_contribution_pct: number | null;
  employer_contribution_cap: number | null;
  income_tax_bands: { up_to: number | null; rate_pct: number }[] | null;
  rules_effective_from: string | null;
  rules_reference: string | null;
  rules_validated_at: string | null;
  rules_validated_by: string | null;
};

export type HrPayrollComponent = {
  id: string;
  tenant_id: string;
  code: string;
  label: string;
  kind: "earning" | "deduction" | "employer_charge";
  calculation_method: "fixed" | "percent_base";
  amount: number;
  cap: number | null;
  effective_from: string;
  effective_to: string | null;
  gl_account_code: string | null;
  printable: boolean;
  active: boolean;
  sort_order: number;
  taxable: boolean;
  subject_employee_social: boolean;
  subject_employer_social: boolean;
};

export function useHrPayrollComponents(includeInactive = true) {
  const { data: tenantId } = useTenantId();
  const source = isApiEnabled() ? "api" : "supabase";
  return useQuery({
    queryKey: ["hr-payroll-components", tenantId, source, includeInactive],
    enabled: !!tenantId,
    queryFn: async () => {
      if (isApiEnabled()) return apiGet<HrPayrollComponent[]>(`/api/v1/hr/payroll/components?includeInactive=${includeInactive}`);
      const { data, error } = await (supabase as any).rpc("list_hr_payroll_components", { _include_inactive: includeInactive });
      if (error) throw error;
      return (data ?? []) as HrPayrollComponent[];
    },
  });
}

export function useSaveHrPayrollComponent() {
  const qc = useQueryClient();
  const { data: tenantId } = useTenantId();
  return useMutation({
    mutationFn: async (input: Omit<HrPayrollComponent, "id" | "tenant_id">) => {
      if (isApiEnabled()) return apiPost<{ id: string }>("/api/v1/hr/payroll/components", input);
      const { data, error } = await (supabase as any).rpc("save_hr_payroll_component", { _input: input });
      if (error) throw error;
      return data as string;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["hr-payroll-components", tenantId] });
      toast.success("Rubrique de paie enregistrée.");
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export type HrEmployeePayrollComponent = Pick<HrPayrollComponent,
  "id" | "tenant_id" | "code" | "label" | "kind" | "calculation_method" | "cap" | "effective_from" | "effective_to" | "active"> & {
    employee_id: string; component_id: string; amount: number; amount_override: number | null;
  };

export function useHrEmployeePayrollComponents(employeeId: string | null, enabled = true) {
  const { data: tenantId } = useTenantId();
  const source = isApiEnabled() ? "api" : "supabase";
  return useQuery({
    queryKey: ["hr-employee-payroll-components", tenantId, source, employeeId],
    enabled: !!tenantId && !!employeeId && enabled,
    queryFn: async () => {
      if (isApiEnabled()) return apiGet<HrEmployeePayrollComponent[]>(`/api/v1/hr/employees/${encodeURIComponent(employeeId!)}/payroll-components`);
      const { data, error } = await (supabase as any).rpc("list_hr_employee_payroll_components", { _employee: employeeId });
      if (error) throw error;
      return (data ?? []) as HrEmployeePayrollComponent[];
    },
  });
}

export function useSaveHrEmployeePayrollComponent() {
  const qc = useQueryClient();
  const { data: tenantId } = useTenantId();
  return useMutation({
    mutationFn: async (args: { employeeId: string; input: { component_id: string; amount_override: number | null; effective_from: string; effective_to: string | null; active: boolean } }) => {
      if (isApiEnabled()) return apiPost<{ id: string }>(`/api/v1/hr/employees/${encodeURIComponent(args.employeeId)}/payroll-components`, args.input);
      const { data, error } = await (supabase as any).rpc("save_hr_employee_payroll_component", {
        _employee: args.employeeId, _input: args.input,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: async (_result, args) => {
      await qc.invalidateQueries({ queryKey: ["hr-employee-payroll-components", tenantId, undefined, args.employeeId] });
      await qc.invalidateQueries({ queryKey: ["hr-employee-payroll-components", tenantId] });
      toast.success("Affectation de rubrique enregistrée.");
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

// ────────── Employees ──────────

export function useEmployees() {
  const { data: tenantId } = useTenantId();
  const source = isApiEnabled() ? "api" : "supabase";
  return useQuery({
    queryKey: ["hr-employees", tenantId, source],
    enabled: !!tenantId,
    queryFn: async () => {
      if (isApiEnabled()) return apiGet<Employee[]>("/api/v1/hr/employees");
      const { data, error } = await supabase.rpc("list_hr_employees" as never);
      if (error) throw error;
      return ((data ?? []) as unknown as Employee[])
        .sort((a, b) => a.matricule.localeCompare(b.matricule) || a.id.localeCompare(b.id));
    },
  });
}

export function useHrPayrollSettings() {
  const { data: tenantId } = useTenantId();
  const source = isApiEnabled() ? "api" : "supabase";
  return useQuery({
    queryKey: ["hr-payroll-settings", tenantId, source],
    enabled: !!tenantId,
    queryFn: async () => {
      if (isApiEnabled()) return apiGet<HrPayrollSettings | null>("/api/v1/hr/payroll/settings");
      const { data, error } = await (supabase as any).from("hr_payroll_settings")
        .select("country_code, currency_code, employee_contribution_pct, employee_contribution_cap, employer_contribution_pct, employer_contribution_cap, income_tax_bands, rules_effective_from, rules_reference, rules_validated_at, rules_validated_by")
        .eq("tenant_id", tenantId).maybeSingle();
      if (error) throw error;
      return data as HrPayrollSettings | null;
    },
  });
}

export function useTenantHrCurrency() {
  const { data: tenantId } = useTenantId();
  const source = isApiEnabled() ? "api" : "supabase";
  return useQuery({
    queryKey: ["hr-tenant-currency", tenantId, source],
    enabled: !!tenantId,
    queryFn: async () => {
      if (isApiEnabled()) {
        const context = await apiGet<{ currency?: string | null }>("/api/v1/hr/company-context");
        return context.currency?.trim().toUpperCase() || null;
      }
      const { data, error } = await supabase.from("tenants").select("currency").eq("id", tenantId!).single();
      if (error) throw error;
      return data.currency?.trim().toUpperCase() || null;
    },
  });
}

export type HrCompanyContext = {
  name: string;
  legal_name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  rccm: string | null;
  tax_id: string | null;
  currency: string | null;
  fiscal_year_start: number | null;
};

export function useHrCompanyContext() {
  const { data: tenantId } = useTenantId();
  const source = isApiEnabled() ? "api" : "supabase";
  return useQuery({
    queryKey: ["hr-company-context", tenantId, source],
    enabled: !!tenantId,
    queryFn: async (): Promise<HrCompanyContext> => {
      if (isApiEnabled()) return apiGet<HrCompanyContext>("/api/v1/hr/company-context");
      const { data, error } = await supabase.from("tenants")
        .select("name, legal_name, address, phone, email, rccm, tax_id, currency, fiscal_year_start")
        .eq("id", tenantId!).single();
      if (error) throw error;
      return data as HrCompanyContext;
    },
  });
}

export function useTenantFiscalYearStart() {
  const { data: tenantId } = useTenantId();
  const source = isApiEnabled() ? "api" : "supabase";
  return useQuery({
    queryKey: ["hr-fiscal-year-start", tenantId, source],
    enabled: !!tenantId,
    queryFn: async () => {
      if (isApiEnabled()) {
        const context = await apiGet<{ fiscal_year_start?: number | null }>("/api/v1/hr/company-context");
        return Number(context.fiscal_year_start) || 1;
      }
      const { data, error } = await supabase.from("tenants").select("fiscal_year_start").eq("id", tenantId!).single();
      if (error) throw error;
      return Number(data.fiscal_year_start) || 1;
    },
  });
}

export type PayrollRegisterRow = {
  tenant_id: string | null;
  period: string | null;
  status: string | null;
  matricule: string | null;
  department: string | null;
  gross: number | null;
  net: number | null;
};

export function usePayrollRegister(from: string, to: string, enabled: boolean) {
  const { data: tenantId } = useTenantId();
  const source = isApiEnabled() ? "api" : "supabase";
  return useQuery({
    queryKey: ["hr-payroll-register", tenantId, source, from, to],
    enabled: !!tenantId && enabled,
    queryFn: async () => {
      if (isApiEnabled()) return apiGet<PayrollRegisterRow[]>(`/api/v1/hr/payroll/register?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      const rows: PayrollRegisterRow[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await supabase.from("payroll_register_view")
          .select("tenant_id, period, status, matricule, department, gross, net")
          .eq("tenant_id", tenantId!).eq("status", "posted")
          .gte("period", from).lte("period", to)
          .order("period", { ascending: true }).order("matricule", { ascending: true })
          .range(offset, offset + 499);
        if (error) throw error;
        const page = (data ?? []) as PayrollRegisterRow[];
        rows.push(...page);
        if (page.length < 500) return rows;
      }
    },
  });
}

export function useUpsertEmployee() {
  const qc = useQueryClient();
  const { data: tenantId } = useTenantId();
  const { data: access } = useMyAccess();
  const canManageCompensation = moduleCan(access, "hr")("manage_compensation");
  const canManageBankDetails = moduleCan(access, "hr")("manage_bank_details");
  return useMutation({
    mutationFn: async (input: Partial<Employee> & { matricule: string; first_name: string; last_name: string; base_salary: number }) => {
      const submitted: Record<string, unknown> = { ...input };
      if (!canManageCompensation) delete submitted.base_salary;
      if (!canManageBankDetails) delete submitted.bank_account;
      if (isApiEnabled()) {
        const payload: Record<string, unknown> = { ...submitted };
        const id = typeof payload.id === "string" ? payload.id : null;
        delete payload.id;
        delete payload.tenant_id;
        delete payload.created_at;
        delete payload.updated_at;
        return id
          ? apiPut(`/api/v1/hr/employees/${encodeURIComponent(id)}`, payload)
          : apiPost<{ id: string }>("/api/v1/hr/employees", payload);
      }
      const payload: Record<string, unknown> = { ...submitted };
      delete payload.tenant_id;
      delete payload.created_at;
      delete payload.updated_at;
      const { data, error } = await supabase.rpc("save_hr_employee" as never, { _payload: payload } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hr-employees"] });
      toast.success("Employé enregistré");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useEmployeeMovements(employeeId: string | null, canRead = true) {
  const { data: tenantId } = useTenantId();
  const source = isApiEnabled() ? "api" : "supabase";
  return useQuery({
    queryKey: ["hr-employee-movements", tenantId, source, employeeId],
    enabled: !!tenantId && !!employeeId && canRead,
    queryFn: async (): Promise<EmployeeMovement[]> => {
      if (isApiEnabled()) return apiGet<EmployeeMovement[]>(`/api/v1/hr/employees/${encodeURIComponent(employeeId!)}/movements`);
      const { data, error } = await supabase.rpc("list_employee_movements" as never, { _employee_id: employeeId! } as never);
      if (error) throw error;
      return (data ?? []) as unknown as EmployeeMovement[];
    },
  });
}

export function useHrMovementReferences(includeInactive = false) {
  const { data: tenantId } = useTenantId();
  const source = isApiEnabled() ? "api" : "supabase";
  return useQuery({
    queryKey: ["hr-movement-references", tenantId, source, includeInactive],
    enabled: !!tenantId,
    queryFn: async () => {
      if (isApiEnabled()) return apiGet<HrMovementReference[]>(`/api/v1/hr/movement-references?includeInactive=${includeInactive}`);
      const { data, error } = await supabase.rpc("list_hr_movement_references" as never, { _include_inactive: includeInactive } as never);
      if (error) throw error;
      return (data ?? []) as unknown as HrMovementReference[];
    },
  });
}

export function useSaveHrMovementReference() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Pick<HrMovementReference, "kind" | "code" | "label" | "active" | "sort_order" | "bulk_action_field" | "bulk_action_options">) => {
      if (isApiEnabled()) return apiPost<{ id: string }>("/api/v1/hr/movement-references", input);
      const { data, error } = await supabase.rpc("save_hr_movement_reference" as never, {
        _kind: input.kind, _code: input.code, _label: input.label, _active: input.active, _sort_order: input.sort_order,
        _bulk_action_field: input.bulk_action_field, _bulk_action_options: input.bulk_action_options,
      } as never);
      if (error) throw error;
      return { id: data as string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hr-movement-references"] });
      toast.success("Référentiel RH enregistré");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

function invalidateEmployeeMovementQueries(qc: ReturnType<typeof useQueryClient>, employeeId: string) {
  qc.invalidateQueries({ queryKey: ["hr-employee-movements"] });
  qc.invalidateQueries({ queryKey: ["hr-employees"] });
}

export function useCreateEmployeeMovement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      employeeId: string; movement_type: string; effective_date: string; reason_code: string; reason: string;
      after_values: Record<string, unknown>;
    }) => {
      const { employeeId, ...payload } = input;
      if (isApiEnabled()) return apiPost<{ id: string; status: string }>(`/api/v1/hr/employees/${encodeURIComponent(employeeId)}/movements`, payload);
      const { data, error } = await supabase.rpc("create_employee_movement" as never, {
        _employee_id: employeeId, _movement_type: payload.movement_type, _effective_date: payload.effective_date,
        _reason_code: payload.reason_code, _reason: payload.reason, _after_values: payload.after_values,
      } as never);
      if (error) throw error;
      return { id: data as string, status: "pending" };
    },
    onSuccess: (_data, input) => {
      invalidateEmployeeMovementQueries(qc, input.employeeId);
      toast.success("Mouvement RH soumis pour approbation");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDecideEmployeeMovement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { movementId: string; employeeId: string; decision: "approve" | "reject"; reason?: string }) => {
      const path = `/api/v1/hr/employee-movements/${encodeURIComponent(input.movementId)}/${input.decision}`;
      if (isApiEnabled()) return apiPost<{ id: string; status: string }>(path, { reason: input.reason ?? "" });
      const rpc = input.decision === "approve" ? "approve_employee_movement" : "reject_employee_movement";
      const params = input.decision === "approve"
        ? { _movement_id: input.movementId, _decision_reason: input.reason ?? null }
        : { _movement_id: input.movementId, _decision_reason: input.reason ?? "" };
      const { data, error } = await supabase.rpc(rpc as never, params as never);
      if (error) throw error;
      return { id: data as string, status: input.decision === "approve" ? "approved" : "rejected" };
    },
    onSuccess: (_data, input) => {
      invalidateEmployeeMovementQueries(qc, input.employeeId);
      toast.success(input.decision === "approve" ? "Mouvement RH approuvé" : "Mouvement RH rejeté");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ────────── Payroll Runs ──────────

export type PayrollLine = {
  id: string;
  tenant_id: string;
  run_id: string;
  employee_id: string;
  gross: number;
  deductions: number;
  taxes: number;
  net: number;
  employer_charges: number;
  employee?: { matricule: string; first_name: string; last_name: string } | null;
};

export type PayrollComponentLine = {
  id: string; tenant_id: string; run_id: string; employee_id: string; component_id: string | null;
  code_snapshot: string; label_snapshot: string; kind: "earning" | "deduction" | "employer_charge";
  calculation_method: "fixed" | "percent_base"; calculation_base: number; rate_snapshot: number | null;
  amount: number; source_type: "base_salary" | "employee_assignment" | "payroll_variable";
  source_id: string | null; definition_snapshot: Record<string, unknown>;
};

export type PayrollRunVariable = {
  id: string; tenant_id: string; run_id: string; employee_id: string; component_id: string;
  source_key: string; amount: number; reason: string; status: "pending" | "approved" | "rejected";
  created_by: string; created_at: string; decided_by: string | null; decided_at: string | null;
  decision_reason: string | null;
};

export function usePayrollComponentLines(runId: string | null, employeeId?: string | null) {
  const { data: tenantId } = useTenantId();
  const source = isApiEnabled() ? "api" : "supabase";
  return useQuery({
    queryKey: ["hr-payroll-component-lines", tenantId, source, runId, employeeId ?? null],
    enabled: !!tenantId && !!runId,
    queryFn: async () => {
      if (isApiEnabled()) {
        const suffix = employeeId ? `?employeeId=${encodeURIComponent(employeeId)}` : "";
        return apiGet<PayrollComponentLine[]>(`/api/v1/hr/payroll/runs/${encodeURIComponent(runId!)}/component-lines${suffix}`);
      }
      let query = (supabase as any).from("payroll_component_lines").select("*").eq("tenant_id", tenantId).eq("run_id", runId).order("employee_id").order("id");
      if (employeeId) query = query.eq("employee_id", employeeId);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as PayrollComponentLine[];
    },
  });
}

export function usePayrollRunVariables(runId: string | null) {
  const { data: tenantId } = useTenantId();
  const source = isApiEnabled() ? "api" : "supabase";
  return useQuery({
    queryKey: ["hr-payroll-variables", tenantId, source, runId],
    enabled: !!tenantId && !!runId,
    queryFn: async () => {
      if (isApiEnabled()) return apiGet<PayrollRunVariable[]>(`/api/v1/hr/payroll/runs/${encodeURIComponent(runId!)}/variables`);
      const { data, error } = await (supabase as any).from("payroll_run_variables").select("*")
        .eq("tenant_id", tenantId).eq("run_id", runId).order("created_at").order("id");
      if (error) throw error;
      return (data ?? []) as PayrollRunVariable[];
    },
  });
}

export function useCreatePayrollRunVariable() {
  const qc = useQueryClient();
  const { data: tenantId } = useTenantId();
  return useMutation({
    mutationFn: async (input: { runId: string; employee_id: string; component_id: string; amount: number; source_key: string; reason: string }) => {
      const { runId, ...payload } = input;
      if (isApiEnabled()) return apiPost<{ id: string }>(`/api/v1/hr/payroll/runs/${encodeURIComponent(runId)}/variables`, payload);
      const { data, error } = await (supabase as any).rpc("create_payroll_run_variable", {
        _run: runId, _employee: payload.employee_id, _component: payload.component_id,
        _amount: payload.amount, _source_key: payload.source_key, _reason: payload.reason,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: async (_result, input) => {
      await qc.invalidateQueries({ queryKey: ["hr-payroll-variables", tenantId, undefined, input.runId] });
      await qc.invalidateQueries({ queryKey: ["hr-payroll-variables", tenantId] });
      toast.success("Variable soumise pour approbation.");
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useDecidePayrollRunVariable() {
  const qc = useQueryClient();
  const { data: tenantId } = useTenantId();
  return useMutation({
    mutationFn: async (input: { runId: string; variableId: string; decision: "approve" | "reject"; reason?: string }) => {
      const { runId: _runId, variableId, decision, reason } = input;
      if (isApiEnabled()) return apiPost<{ id: string; status: string }>(`/api/v1/hr/payroll/variables/${encodeURIComponent(variableId)}/${decision}`, { reason: reason ?? "" });
      const { data, error } = await (supabase as any).rpc("decide_payroll_run_variable", {
        _variable: variableId, _approve: decision === "approve", _reason: reason ?? null,
      });
      if (error) throw error;
      return { id: data as string, status: decision === "approve" ? "approved" : "rejected" };
    },
    onSuccess: async (_result, input) => {
      await qc.invalidateQueries({ queryKey: ["hr-payroll-variables", tenantId] });
      toast.success(input.decision === "approve" ? "Variable approuvée." : "Variable rejetée.");
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function usePayrollPostingAccounts() {
  const { data: tenantId } = useTenantId();
  const source = isApiEnabled() ? "api" : "supabase";
  return useQuery({
    queryKey: ["hr-payroll-posting-accounts", tenantId, source],
    enabled: !!tenantId,
    queryFn: async () => {
      if (isApiEnabled()) return apiGet<Record<string, string>>("/api/v1/hr/payroll/posting-accounts");
      const { data, error } = await (supabase as any).from("tenant_posting_accounts")
        .select("role_code, account:gl_accounts!inner(code)")
        .eq("tenant_id", tenantId)
        .in("role_code", ["PAYROLL_SALARIES", "PAYROLL_EMPLOYER_CHARGES", "PAYROLL_NET_PAYABLE", "PAYROLL_SOCIAL", "PAYROLL_TAX"]);
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((row: { role_code: string; account: { code: string } }) => [row.role_code, row.account.code]));
    },
  });
}

export function usePayrollRuns() {
  const { data: tenantId } = useTenantId();
  const source = isApiEnabled() ? "api" : "supabase";
  return useQuery({
    queryKey: ["hr-payroll-runs", tenantId, source],
    enabled: !!tenantId,
    queryFn: async () => {
      if (isApiEnabled()) return apiGet<PayrollRun[]>("/api/v1/hr/payroll/runs");
      const rows: PayrollRun[] = [];
      for (let from = 0; ; from += 500) {
        const { data, error } = await supabase.from("payroll_runs" as never).select("*")
          .eq("tenant_id", tenantId!).order("pay_date", { ascending: false }).order("id", { ascending: true })
          .range(from, from + 499);
        if (error) throw error;
        const page = (data ?? []) as unknown as PayrollRun[];
        rows.push(...page);
        if (page.length < 500) return rows;
      }
    },
  });
}

export function usePayrollLines(runId: string | null) {
  const { data: tenantId } = useTenantId();
  const source = isApiEnabled() ? "api" : "supabase";
  return useQuery({
    queryKey: ["hr-payroll-lines", tenantId, source, runId],
    enabled: !!tenantId && !!runId,
    queryFn: async () => {
      if (isApiEnabled()) return apiGet<PayrollLine[]>(`/api/v1/hr/payroll/runs/${encodeURIComponent(runId!)}/lines`);
      const rows: PayrollLine[] = [];
      for (let from = 0; ; from += 500) {
        const { data, error } = await supabase.from("payroll_lines" as never)
          .select("*, employee:employees(matricule, first_name, last_name)")
          .eq("tenant_id", tenantId!).eq("run_id", runId!).order("id", { ascending: true })
          .range(from, from + 499);
        if (error) throw error;
        const page = (data ?? []) as unknown as PayrollLine[];
        rows.push(...page);
        if (page.length < 500) return rows;
      }
    },
  });
}

export function usePayrollKpis() {
  const fiscalStart = useTenantFiscalYearStart();
  const runsQuery = usePayrollRuns();
  const employeesQuery = useEmployees();
  const settingsQuery = useHrPayrollSettings();
  const tenantCurrency = useTenantHrCurrency();
  const runs = runsQuery.data ?? [];
  const employees = employeesQuery.data ?? [];
  const refresh = async () => {
    await Promise.all([
      fiscalStart.refetch(), runsQuery.refetch(), employeesQuery.refetch(),
      settingsQuery.refetch(), tenantCurrency.refetch(),
    ]);
  };
  const active = employees.filter((e) => e.status === "active");
  const currentPeriod = new Date().toISOString().slice(0, 7);
  const currency = settingsQuery.data?.currency_code ?? tenantCurrency.data ?? undefined;
  const ytdGross = sumPostedPayrollGrossForFiscalYear(runs, currentPeriod, fiscalStart.data ?? 1, currency);
  const last = runs[0];
  const upcoming = runs
    .filter((r) => r.status !== "posted" && new Date(r.pay_date) >= new Date(new Date().toDateString()))
    .slice(0, 5);
  return {
    activeEmployees: active.length,
    runsCount: runs.length,
    ytdGross,
    currency,
    isLoading: fiscalStart.isLoading || runsQuery.isLoading || employeesQuery.isLoading || settingsQuery.isLoading || tenantCurrency.isLoading,
    isError: runsQuery.isError || employeesQuery.isError || fiscalStart.isError || settingsQuery.isError || tenantCurrency.isError,
    error: runsQuery.error ?? employeesQuery.error ?? fiscalStart.error ?? settingsQuery.error ?? tenantCurrency.error,
    refetch: refresh,
    lastRun: last,
    upcoming,
    runs,
  };
}

// ────────── Payroll RPCs (compute/approve/post) ──────────

function invalidatePayroll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["hr-payroll-runs"] });
  qc.invalidateQueries({ queryKey: ["hr-payroll-lines"] });
}

export function useCreatePayrollRun() {
  const qc = useQueryClient();
  const { data: tenantId } = useTenantId();
  return useMutation({
    mutationFn: async (input: { period: string; pay_date: string }) => {
      const invalid = validatePayrollRunInput(input.period, input.pay_date);
      if (invalid) throw new Error(invalid);
      if (!tenantId) throw new Error("Aucune société active.");
      if (isApiEnabled()) return apiPost<{ id: string }>("/api/v1/hr/payroll/runs", input);
      const { data, error } = await supabase
        .from("payroll_runs" as never)
        .insert({ tenant_id: tenantId!, period: input.period, pay_date: input.pay_date, status: "draft" } as never)
        .select("id")
        .single();
      if (error) throw error;
      return data as { id: string };
    },
    onSuccess: () => {
      invalidatePayroll(qc);
      toast.success("Cycle de paie créé");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useGeneratePayrollLines() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (runId: string) => {
      if (isApiEnabled()) return (await apiPost<{ count: number }>(`/api/v1/hr/payroll/runs/${encodeURIComponent(runId)}/generate`, {})).count;
      const { data, error } = await supabase.rpc("generate_payroll_lines" as never, { _run_id: runId } as never);
      if (error) throw error;
      return data as number;
    },
    onSuccess: (count) => {
      invalidatePayroll(qc);
      toast.success(`${count ?? 0} ligne(s) de paie générée(s)`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useApprovePayrollRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (runId: string) => {
      if (isApiEnabled()) return apiPost<void>(`/api/v1/hr/payroll/runs/${encodeURIComponent(runId)}/approve`, {});
      const { error } = await supabase.rpc("approve_payroll_run" as never, { _run_id: runId } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidatePayroll(qc);
      toast.success("Cycle approuvé");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export type PayrollPrecheck = { id: string; run_id: string; passed: boolean; findings: string[]; checked_by: string; checked_at: string };

export function usePrecheckPayrollRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (runId: string): Promise<PayrollPrecheck> => {
      if (isApiEnabled()) return apiPost<PayrollPrecheck>(`/api/v1/hr/payroll/runs/${encodeURIComponent(runId)}/precheck`, {});
      const { data, error } = await supabase.rpc("precheck_payroll_run" as never, { _run_id: runId } as never);
      if (error) throw error;
      return data as unknown as PayrollPrecheck;
    },
    onSuccess: (result, runId) => {
      qc.invalidateQueries({ queryKey: ["payroll-prechecks", runId] });
      if (!result.passed) throw new Error(`Précontrôle bloquant : ${result.findings.join(" ")}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function usePostPayrollRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (runId: string) => {
      if (isApiEnabled()) return (await apiPost<{ journal_entry_id: string }>(`/api/v1/hr/payroll/runs/${encodeURIComponent(runId)}/post`, {})).journal_entry_id;
      const { data, error } = await supabase.rpc("post_payroll_run" as never, { _run_id: runId } as never);
      if (error) throw error;
      return data as string; // journal_entry_id
    },
    onSuccess: () => {
      invalidatePayroll(qc);
      qc.invalidateQueries({ queryKey: ["journal-entries"] });
      toast.success("Cycle comptabilisé — écriture SYSCOHADA générée");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ────────── HR Role Audit ──────────

export function useHrRoleAudit() {
  const { data: tenantId } = useTenantId();
  const source = isApiEnabled() ? "api" : "supabase";
  return useQuery({
    queryKey: ["hr-role-audit", tenantId, source],
    enabled: !!tenantId,
    queryFn: async () => {
      if (isApiEnabled()) return apiGet<HrRoleAuditRow[]>("/api/v1/hr/roles/audit");
      const rows: HrRoleAuditRow[] = [];
      for (let from = 0; ; from += 500) {
        const { data, error } = await supabase.from("hr_role_audit" as never).select("*")
          .eq("tenant_id", tenantId!).order("created_at", { ascending: false }).order("id", { ascending: true })
          .range(from, from + 499);
        if (error) throw error;
        const page = (data ?? []) as unknown as HrRoleAuditRow[];
        rows.push(...page);
        if (page.length < 500) return rows;
      }
    },
  });
}

export type PayrollRunAuditEvent = {
  id: string;
  tenant_id: string;
  run_id: string;
  event_type: "created" | "lines_generated" | "prechecked" | "approved" | "posted" | "status_changed" | "deleted";
  from_status: string | null;
  to_status: string | null;
  performed_by: string | null;
  created_at: string;
  details: Record<string, unknown>;
};

/** Server-side audit query; row policy restricts it to this tenant's auditors. */
export function usePayrollRunAudit(
  runId: string | null,
  opts: { eventType?: "all" | PayrollRunAuditEvent["event_type"]; page?: number; pageSize?: number } = {},
) {
  const { eventType = "all", page = 1, pageSize = 10 } = opts;
  const { data: tenantId } = useTenantId();
  const { user } = useAuth();
  const source = isApiEnabled() ? "api" : "supabase";
  return useQuery({
    queryKey: ["payroll-run-audit", tenantId, source, user?.id, runId, eventType, page, pageSize],
    enabled: !!tenantId && !!user?.id && !!runId,
    queryFn: async () => {
      if (isApiEnabled()) {
        const query = new URLSearchParams({ eventType, page: String(page), pageSize: String(pageSize) });
        return apiGet<{ rows: PayrollRunAuditEvent[]; total: number }>(`/api/v1/hr/payroll/runs/${encodeURIComponent(runId!)}/audit?${query}`);
      }
      const from = (Math.max(1, page) - 1) * pageSize;
      const to = from + pageSize - 1;
      let q = supabase
        .from("payroll_run_audit" as never)
        .select("*", { count: "exact" })
        .eq("tenant_id", tenantId!)
        .eq("run_id", runId!);
      if (eventType !== "all") q = q.eq("event_type", eventType);
      const { data, error, count } = await q
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to);
      if (error) throw error;
      return { rows: (data ?? []) as unknown as PayrollRunAuditEvent[], total: count ?? 0 };
    },
  });
}

// ────────── RBAC ──────────

export function useMyHrRoles(): HrPerms {
  // Droits dits par la base (my_access, V27). Création et modification de salariés suivent
  // hr.manage_employees, comme la politique RLS (l'ancien calcul les ouvrait à hr_clerk, que la
  // base refusait). Seul le paramétrage du module reste par rôle.
  const { data: access } = useMyAccess();
  const can = moduleCan(access, "hr");
  return {
    canCreateEmployee:    can("manage_employees"),
    canEditEmployee:      can("manage_employees"),
    canCreatePayrollRun:  can("create_payroll_run"),
    canApprovePayrollRun: can("approve_payroll_run"),
    canExecutePayroll:    can("execute_payroll"),
    canAuditPayroll:      can("audit_payroll"),
    canManageSettings:    can("payroll_settings"),
    canExport:            can("export"),
    canViewSensitive:     can("view_sensitive"),
    canManageCompensation: can("manage_compensation"),
    canManageBankDetails:  can("manage_bank_details"),
    canCreateEmployeeMovement: can("create_employee_movement"),
    canApproveEmployeeMovement: can("approve_employee_movement"),
    canViewEmployeeHistory: can("view_employee_history"),
    canManageMovementSettings: can("manage_movement_settings"),
  };
}

export function useTenantHrRoles() {
  return useTenantRoleMembers("tenant-hr-roles", ALL_HR_ROLES);
}

// ────────── Assign role (SoD enforced server-side) ──────────

export function useAssignHrRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { target_user: string; role: HrRole; action: "assign" | "revoke"; reason?: string }) => {
      const { error } = await supabase.rpc("assign_hr_role" as never, {
        p_target_user: input.target_user,
        p_role: input.role,
        p_action: input.action,
        p_reason: input.reason ?? null,
      } as never);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["tenant-hr-roles"] });
      qc.invalidateQueries({ queryKey: ["hr-role-audit"] });
      // Droits de l'utilisateur (my_access, V27) et matrice de /settings : le rôle y est recopié.
      qc.invalidateQueries({ queryKey: ["my-access"] });
      qc.invalidateQueries({ queryKey: ["authorizations"] });
      toast.success(v.action === "assign" ? "Rôle attribué" : "Rôle révoqué");
    },
    onError: (e: Error) => {
      const msg = e.message?.includes("SoD")
        ? e.message
        : e.message?.includes("administrateurs")
        ? "Seuls les administrateurs peuvent assigner les rôles RH"
        : e.message || "Erreur lors de l'attribution";
      toast.error(msg);
    },
  });
}

