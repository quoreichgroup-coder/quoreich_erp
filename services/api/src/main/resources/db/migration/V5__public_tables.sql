--
-- PostgreSQL database dump
--


-- Dumped from database version 18.6
-- Dumped by pg_dump version 18.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: inventory_period_closes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_period_closes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    period text NOT NULL,
    closed_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_by uuid,
    total_value numeric DEFAULT 0 NOT NULL,
    total_qty numeric DEFAULT 0 NOT NULL,
    items_count integer DEFAULT 0 NOT NULL,
    snapshot jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: treasury_period_closes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.treasury_period_closes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    period text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempt integer DEFAULT 1 NOT NULL,
    total_balance numeric(18,2) DEFAULT 0 NOT NULL,
    accounts_count integer DEFAULT 0 NOT NULL,
    reconciliations_count integer DEFAULT 0 NOT NULL,
    snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    error_message text,
    closed_by uuid NOT NULL,
    closed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT treasury_period_closes_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text, 'failed'::text])))
);


--
-- Name: delivery_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delivery_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    dn_number text NOT NULL,
    so_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    delivery_date date DEFAULT CURRENT_DATE NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    ar_invoice_id uuid,
    notes text,
    created_by uuid NOT NULL,
    delivered_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: dn_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dn_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    dn_id uuid NOT NULL,
    so_line_id uuid,
    item_id uuid,
    description text,
    quantity numeric DEFAULT 0 NOT NULL,
    unit_price numeric DEFAULT 0 NOT NULL,
    total numeric DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_analysis_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_analysis_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    analysis_type text NOT NULL,
    trigger_source text DEFAULT 'manual'::text NOT NULL,
    status text DEFAULT 'success'::text NOT NULL,
    params jsonb DEFAULT '{}'::jsonb NOT NULL,
    result jsonb DEFAULT '{}'::jsonb NOT NULL,
    inputs jsonb DEFAULT '{}'::jsonb NOT NULL,
    error_message text,
    duration_ms integer,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_analysis_history_analysis_type_check CHECK ((analysis_type = ANY (ARRAY['cashflow_forecast'::text, 'gl_anomaly_detection'::text]))),
    CONSTRAINT ai_analysis_history_status_check CHECK ((status = ANY (ARRAY['success'::text, 'error'::text, 'partial'::text]))),
    CONSTRAINT ai_analysis_history_trigger_source_check CHECK ((trigger_source = ANY (ARRAY['manual'::text, 'scheduled'::text])))
);


--
-- Name: ai_analysis_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_analysis_schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    analysis_type text NOT NULL,
    frequency text DEFAULT 'daily'::text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    params jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_run_at timestamp with time zone,
    next_run_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_analysis_schedules_analysis_type_check CHECK ((analysis_type = ANY (ARRAY['cashflow_forecast'::text, 'gl_anomaly_detection'::text]))),
    CONSTRAINT ai_analysis_schedules_frequency_check CHECK ((frequency = ANY (ARRAY['daily'::text, 'weekly'::text, 'monthly'::text])))
);


--
-- Name: ap_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ap_invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    invoice_number text NOT NULL,
    supplier_id uuid NOT NULL,
    invoice_date date DEFAULT CURRENT_DATE NOT NULL,
    due_date date NOT NULL,
    subtotal numeric(18,2) DEFAULT 0 NOT NULL,
    tax_amount numeric(18,2) DEFAULT 0 NOT NULL,
    total numeric(18,2) DEFAULT 0 NOT NULL,
    amount_paid numeric(18,2) DEFAULT 0 NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    approval_status text DEFAULT 'pending'::text NOT NULL,
    journal_entry_id uuid,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    po_id uuid
);


--
-- Name: suppliers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suppliers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    email text,
    phone text,
    address text,
    tax_id text,
    payment_terms integer DEFAULT 30,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ap_approval_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ap_approval_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    doc_number text NOT NULL,
    doc_type text NOT NULL,
    amount numeric DEFAULT 0 NOT NULL,
    level text NOT NULL,
    requester text NOT NULL,
    request_date date DEFAULT CURRENT_DATE NOT NULL,
    sla_hours integer DEFAULT 24 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ap_approval_thresholds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ap_approval_thresholds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    level text NOT NULL,
    max_amount numeric,
    approver text NOT NULL,
    sla_hours integer DEFAULT 24 NOT NULL,
    doc_types text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ap_general_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ap_general_settings (
    tenant_id uuid NOT NULL,
    default_currency text DEFAULT 'XOF'::text,
    default_payment_method text DEFAULT 'WIRE'::text,
    po_required text DEFAULT 'mandatory'::text,
    three_way_match boolean DEFAULT true,
    early_payment_discount_pct numeric DEFAULT 2.0,
    discount_window_days integer DEFAULT 10,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ap_notification_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ap_notification_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    event text NOT NULL,
    channel text DEFAULT 'email'::text NOT NULL,
    recipients text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ap_numbering_series; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ap_numbering_series (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    doc_type text NOT NULL,
    prefix text NOT NULL,
    format text DEFAULT 'PREFIX-YYYY-####'::text NOT NULL,
    next_number integer DEFAULT 1 NOT NULL,
    reset_frequency text DEFAULT 'yearly'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ap_payment_methods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ap_payment_methods (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    code text NOT NULL,
    label text NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ap_withholding_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ap_withholding_rates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    category text NOT NULL,
    rate_pct numeric DEFAULT 0 NOT NULL,
    gl_account text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ar_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ar_invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    invoice_number text NOT NULL,
    customer_id uuid NOT NULL,
    invoice_date date DEFAULT CURRENT_DATE NOT NULL,
    due_date date NOT NULL,
    subtotal numeric(18,2) DEFAULT 0 NOT NULL,
    tax_amount numeric(18,2) DEFAULT 0 NOT NULL,
    total numeric(18,2) DEFAULT 0 NOT NULL,
    amount_paid numeric(18,2) DEFAULT 0 NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    journal_entry_id uuid,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    so_id uuid,
    dn_id uuid
);


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    email text,
    phone text,
    address text,
    tax_id text,
    credit_limit numeric(18,2) DEFAULT 0,
    payment_terms integer DEFAULT 30,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ar_dunning_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ar_dunning_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    level integer NOT NULL,
    days_overdue integer NOT NULL,
    action text NOT NULL,
    fee_amount numeric DEFAULT 0 NOT NULL,
    template text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ar_general_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ar_general_settings (
    tenant_id uuid NOT NULL,
    default_payment_term_code text DEFAULT 'NET30'::text,
    default_currency text DEFAULT 'XOF'::text,
    default_credit_limit numeric DEFAULT 10000000,
    auto_numbering boolean DEFAULT true,
    late_payment_interest_pct numeric DEFAULT 1.5,
    grace_period_days integer DEFAULT 5,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ar_notification_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ar_notification_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    rule_id uuid,
    customer_id uuid,
    customer_name text,
    channel text NOT NULL,
    detail text,
    status text DEFAULT 'delivered'::text NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ar_notification_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ar_notification_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    trigger_condition text NOT NULL,
    channel text DEFAULT 'email'::text NOT NULL,
    recipients text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    last_triggered_at timestamp with time zone,
    trigger_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ar_numbering_series; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ar_numbering_series (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    doc_type text NOT NULL,
    prefix text NOT NULL,
    format text DEFAULT 'PREFIX-YYYY-####'::text NOT NULL,
    next_number integer DEFAULT 1 NOT NULL,
    reset_frequency text DEFAULT 'yearly'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ar_payment_terms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ar_payment_terms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    code text NOT NULL,
    label text NOT NULL,
    days integer DEFAULT 30 NOT NULL,
    discount_percent numeric DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: asset_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    depreciation_method text DEFAULT 'straight_line'::text NOT NULL,
    useful_life_years integer DEFAULT 5 NOT NULL,
    gl_asset_account_id uuid,
    gl_depreciation_account_id uuid,
    gl_expense_account_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: asset_disposals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_disposals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    asset_id uuid NOT NULL,
    disposal_date date NOT NULL,
    disposal_type text DEFAULT 'sale'::text NOT NULL,
    sale_price numeric DEFAULT 0 NOT NULL,
    net_book_value_at_disposal numeric DEFAULT 0 NOT NULL,
    gain_loss numeric DEFAULT 0 NOT NULL,
    journal_entry_id uuid,
    notes text,
    created_by uuid DEFAULT auth.uid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT asset_disposals_disposal_type_check CHECK ((disposal_type = ANY (ARRAY['sale'::text, 'scrap'::text, 'donation'::text, 'loss'::text])))
);


--
-- Name: assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    asset_code text NOT NULL,
    name text NOT NULL,
    category_id uuid,
    acquisition_date date NOT NULL,
    acquisition_cost numeric DEFAULT 0 NOT NULL,
    salvage_value numeric DEFAULT 0 NOT NULL,
    useful_life_months integer DEFAULT 60 NOT NULL,
    depreciation_method text DEFAULT 'straight_line'::text NOT NULL,
    accumulated_depreciation numeric DEFAULT 0 NOT NULL,
    net_book_value numeric DEFAULT 0 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    location text,
    assigned_to text,
    warranty_expiry date,
    next_maintenance date,
    disposal_date date,
    disposal_amount numeric,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: depreciation_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.depreciation_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    asset_id uuid NOT NULL,
    period_date date NOT NULL,
    amount numeric NOT NULL,
    accumulated numeric NOT NULL,
    net_book_value numeric NOT NULL,
    journal_entry_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bank_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bank_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    bank_name text NOT NULL,
    account_number text,
    currency text DEFAULT 'XOF'::text NOT NULL,
    balance numeric DEFAULT 0 NOT NULL,
    account_type text DEFAULT 'checking'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    last_reconciled_at date,
    gl_account_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bank_reconciliations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bank_reconciliations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    bank_account_id uuid NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    book_balance numeric(18,2) DEFAULT 0 NOT NULL,
    bank_balance numeric(18,2) DEFAULT 0 NOT NULL,
    difference numeric(18,2) GENERATED ALWAYS AS ((bank_balance - book_balance)) STORED,
    status text DEFAULT 'in_progress'::text NOT NULL,
    validated_by uuid,
    validated_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bank_statement_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bank_statement_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    statement_id uuid NOT NULL,
    line_date date NOT NULL,
    description text,
    amount numeric(18,2) NOT NULL,
    reference text,
    matched_transaction_id uuid,
    matched_at timestamp with time zone,
    matched_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bank_statements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bank_statements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    bank_account_id uuid NOT NULL,
    statement_date date NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    opening_balance numeric(18,2) DEFAULT 0 NOT NULL,
    closing_balance numeric(18,2) DEFAULT 0 NOT NULL,
    file_name text,
    status text DEFAULT 'imported'::text NOT NULL,
    imported_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bank_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bank_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    bank_account_id uuid NOT NULL,
    transaction_date date DEFAULT CURRENT_DATE NOT NULL,
    description text,
    amount numeric NOT NULL,
    transaction_type text NOT NULL,
    reference text,
    is_reconciled boolean DEFAULT false NOT NULL,
    payment_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: budget_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.budget_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    budget_id uuid NOT NULL,
    gl_account_id uuid,
    department text,
    period text NOT NULL,
    planned_amount numeric DEFAULT 0 NOT NULL,
    actual_amount numeric DEFAULT 0 NOT NULL,
    variance numeric GENERATED ALWAYS AS ((planned_amount - actual_amount)) STORED,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: budget_role_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.budget_role_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    actor_user_id uuid NOT NULL,
    target_user_id uuid,
    role public.app_role,
    action text NOT NULL,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT budget_role_audit_action_check CHECK ((action = ANY (ARRAY['assign'::text, 'revoke'::text])))
);


--
-- Name: budgets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.budgets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    fiscal_year text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    scenario text DEFAULT 'base'::text NOT NULL,
    total_amount numeric DEFAULT 0 NOT NULL,
    created_by uuid NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: cashflow_forecasts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cashflow_forecasts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    week_start date NOT NULL,
    bank_account_id uuid,
    category text NOT NULL,
    direction text NOT NULL,
    amount_forecast numeric(18,2) DEFAULT 0 NOT NULL,
    amount_actual numeric(18,2) DEFAULT 0 NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cashflow_forecasts_direction_check CHECK ((direction = ANY (ARRAY['inflow'::text, 'outflow'::text])))
);


--
-- Name: compliance_controls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compliance_controls (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    framework_id uuid NOT NULL,
    control_code text NOT NULL,
    title text NOT NULL,
    description text,
    category text,
    owner text,
    status text DEFAULT 'not_tested'::text NOT NULL,
    last_tested_at timestamp with time zone,
    next_review_at date,
    risk_level text DEFAULT 'medium'::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: compliance_frameworks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compliance_frameworks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    version text,
    status text DEFAULT 'active'::text NOT NULL,
    total_controls integer DEFAULT 0 NOT NULL,
    compliant_controls integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: compliance_role_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compliance_role_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    actor_user_id uuid NOT NULL,
    target_user_id uuid NOT NULL,
    role public.app_role NOT NULL,
    action text NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT compliance_role_audit_action_check CHECK ((action = ANY (ARRAY['grant'::text, 'revoke'::text])))
);


--
-- Name: compliance_test_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compliance_test_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    control_id uuid NOT NULL,
    test_date date DEFAULT CURRENT_DATE NOT NULL,
    tester text NOT NULL,
    result text NOT NULL,
    findings integer DEFAULT 0 NOT NULL,
    notes text,
    duration text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_activities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_activities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    opportunity_id uuid,
    contact_id uuid,
    type text DEFAULT 'task'::text NOT NULL,
    subject text NOT NULL,
    notes text,
    due_at timestamp with time zone,
    completed_at timestamp with time zone,
    assigned_to uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    full_name text NOT NULL,
    email text,
    phone text,
    company text,
    "position" text,
    owner_id uuid,
    status text DEFAULT 'active'::text NOT NULL,
    source text,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_opportunities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_opportunities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    contact_id uuid,
    name text NOT NULL,
    stage text DEFAULT 'lead'::text NOT NULL,
    amount numeric(18,2) DEFAULT 0 NOT NULL,
    currency text DEFAULT 'XOF'::text NOT NULL,
    probability numeric(5,2) DEFAULT 0 NOT NULL,
    expected_close_date date,
    owner_id uuid,
    status text DEFAULT 'open'::text NOT NULL,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    customer_id uuid,
    converted_quotation_id uuid
);


--
-- Name: crm_role_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_role_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    target_user_id uuid NOT NULL,
    role public.app_role NOT NULL,
    action text NOT NULL,
    performed_by uuid,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: employees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employees (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    matricule text NOT NULL,
    first_name text NOT NULL,
    last_name text NOT NULL,
    email text,
    phone text,
    job_title text,
    department text,
    contract_type text DEFAULT 'CDI'::text NOT NULL,
    hire_date date DEFAULT CURRENT_DATE NOT NULL,
    end_date date,
    base_salary numeric(18,2) DEFAULT 0 NOT NULL,
    currency text DEFAULT 'XOF'::text NOT NULL,
    bank_account text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: erp_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.erp_alerts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    module text NOT NULL,
    alert_type text NOT NULL,
    severity text DEFAULT 'info'::text NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    action_required boolean DEFAULT false NOT NULL,
    is_resolved boolean DEFAULT false NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    read_at timestamp with time zone
);

ALTER TABLE ONLY public.erp_alerts REPLICA IDENTITY FULL;


--
-- Name: erp_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.erp_permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    role_id uuid NOT NULL,
    module text NOT NULL,
    permission text NOT NULL
);


--
-- Name: erp_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.erp_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    is_system boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: expense_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expense_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    report_id uuid NOT NULL,
    expense_date date NOT NULL,
    category text NOT NULL,
    description text,
    amount numeric(18,2) NOT NULL,
    receipt_url text
);


--
-- Name: expense_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expense_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    report_number text NOT NULL,
    employee_id uuid NOT NULL,
    submission_date date DEFAULT CURRENT_DATE NOT NULL,
    total numeric(18,2) DEFAULT 0 NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    approval_status text DEFAULT 'pending'::text NOT NULL,
    journal_entry_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: expense_role_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expense_role_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    actor_user_id uuid NOT NULL,
    target_user_id uuid NOT NULL,
    action text NOT NULL,
    role public.app_role NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT expense_role_audit_action_check CHECK ((action = ANY (ARRAY['grant'::text, 'revoke'::text])))
);


--
-- Name: fixed_asset_role_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fixed_asset_role_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    actor_user_id uuid DEFAULT auth.uid() NOT NULL,
    target_user_id uuid,
    action text NOT NULL,
    role text,
    details jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: gl_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gl_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    account_type text DEFAULT 'asset'::text NOT NULL,
    parent_id uuid,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: gl_audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gl_audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    batch_id text NOT NULL,
    entry_id uuid,
    action text NOT NULL,
    user_name text DEFAULT 'System'::text NOT NULL,
    details text,
    hash text DEFAULT ''::text NOT NULL,
    prev_hash text DEFAULT '00000000'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: journal_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journal_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    entry_number text NOT NULL,
    entry_date date DEFAULT CURRENT_DATE NOT NULL,
    description text,
    source text DEFAULT 'manual'::text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    posted_by uuid,
    posted_at timestamp with time zone,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: journal_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journal_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entry_id uuid NOT NULL,
    account_id uuid NOT NULL,
    description text,
    debit numeric(18,2) DEFAULT 0 NOT NULL,
    credit numeric(18,2) DEFAULT 0 NOT NULL,
    cost_center text,
    department text,
    project text
);


--
-- Name: period_locks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.period_locks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    period text NOT NULL,
    module text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    closed_by uuid,
    closed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: goods_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.goods_receipts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    gr_number text NOT NULL,
    po_id uuid NOT NULL,
    receipt_date date DEFAULT CURRENT_DATE NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    received_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: gr_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gr_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gr_id uuid NOT NULL,
    po_line_id uuid,
    item_id uuid,
    quantity_received numeric DEFAULT 0 NOT NULL,
    quantity_rejected numeric DEFAULT 0 NOT NULL
);


--
-- Name: hr_role_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hr_role_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    target_user_id uuid NOT NULL,
    role text NOT NULL,
    action text NOT NULL,
    performed_by uuid NOT NULL,
    reason text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    category text,
    unit text DEFAULT 'unit'::text NOT NULL,
    unit_cost numeric(18,2) DEFAULT 0 NOT NULL,
    selling_price numeric(18,2) DEFAULT 0 NOT NULL,
    quantity_on_hand numeric(18,2) DEFAULT 0 NOT NULL,
    reorder_level numeric(18,2) DEFAULT 0,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    valuation_method text DEFAULT 'CMP'::text NOT NULL,
    default_warehouse_id uuid,
    safety_stock numeric DEFAULT 0 NOT NULL,
    max_stock numeric,
    abc_class text,
    average_cost numeric DEFAULT 0 NOT NULL
);


--
-- Name: stock_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    item_id uuid NOT NULL,
    movement_type text NOT NULL,
    quantity numeric(18,2) NOT NULL,
    reference_type text,
    reference_id uuid,
    movement_date date DEFAULT CURRENT_DATE NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    warehouse_id uuid,
    unit_cost numeric DEFAULT 0 NOT NULL,
    total_value numeric DEFAULT 0 NOT NULL,
    journal_entry_id uuid,
    status text DEFAULT 'posted'::text NOT NULL
);


--
-- Name: inventory_count_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_count_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    count_id uuid NOT NULL,
    item_id uuid NOT NULL,
    expected_qty numeric DEFAULT 0 NOT NULL,
    counted_qty numeric DEFAULT 0 NOT NULL,
    variance numeric GENERATED ALWAYS AS ((counted_qty - expected_qty)) STORED,
    unit_cost numeric DEFAULT 0 NOT NULL,
    variance_value numeric GENERATED ALWAYS AS (((counted_qty - expected_qty) * unit_cost)) STORED,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inventory_counts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_counts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    count_number text NOT NULL,
    warehouse_id uuid,
    count_date date DEFAULT CURRENT_DATE NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    notes text,
    created_by uuid,
    posted_by uuid,
    posted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inventory_role_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_role_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    target_user_id uuid NOT NULL,
    role public.app_role NOT NULL,
    action text NOT NULL,
    performed_by uuid,
    comment text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inventory_role_audit_action_check CHECK ((action = ANY (ARRAY['assign'::text, 'revoke'::text, 'period_close'::text, 'period_close_idempotent'::text, 'period_close_attempt'::text, 'period_close_failed'::text, 'export_csv'::text, 'export_pdf'::text, 'export_aborted'::text, 'export_failed'::text])))
);


--
-- Name: inventory_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_settings (
    tenant_id uuid NOT NULL,
    valuation_method text DEFAULT 'CMP'::text NOT NULL,
    negative_stock_allowed boolean DEFAULT false NOT NULL,
    auto_je_on_movement boolean DEFAULT true NOT NULL,
    stock_account_code text DEFAULT '3100'::text NOT NULL,
    variance_account_code text DEFAULT '6580'::text NOT NULL,
    cogs_account_code text DEFAULT '6010'::text NOT NULL,
    low_stock_alerts_enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: stock_valuation_layers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_valuation_layers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    item_id uuid NOT NULL,
    warehouse_id uuid,
    layer_date date DEFAULT CURRENT_DATE NOT NULL,
    qty_in numeric DEFAULT 0 NOT NULL,
    cost_in numeric DEFAULT 0 NOT NULL,
    qty_remaining numeric DEFAULT 0 NOT NULL,
    source_type text,
    source_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: warehouses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.warehouses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    address text,
    is_default boolean DEFAULT false NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: item_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_locations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    item_id uuid NOT NULL,
    warehouse_id uuid NOT NULL,
    bin_location text,
    quantity_on_hand numeric DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: licenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.licenses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    module_name text NOT NULL,
    plan text DEFAULT 'Enterprise'::text NOT NULL,
    license_type text DEFAULT 'per-module'::text NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    max_users integer,
    active_users integer DEFAULT 0,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notification_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_preferences (
    user_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    modules text[] DEFAULT ARRAY[]::text[] NOT NULL,
    severities text[] DEFAULT ARRAY['critical'::text, 'error'::text, 'warning'::text, 'info'::text] NOT NULL,
    include_resolved boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    payment_type text NOT NULL,
    ar_invoice_id uuid,
    ap_invoice_id uuid,
    amount numeric(18,2) NOT NULL,
    payment_date date DEFAULT CURRENT_DATE NOT NULL,
    payment_method text DEFAULT 'bank_transfer'::text NOT NULL,
    reference text,
    journal_entry_id uuid,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payroll_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    period text NOT NULL,
    pay_date date NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    gross_total numeric(18,2) DEFAULT 0 NOT NULL,
    net_total numeric(18,2) DEFAULT 0 NOT NULL,
    employee_count integer DEFAULT 0 NOT NULL,
    created_by uuid,
    approved_by uuid,
    executed_by uuid,
    approved_at timestamp with time zone,
    executed_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payroll_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    run_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    gross numeric(18,2) DEFAULT 0 NOT NULL,
    deductions numeric(18,2) DEFAULT 0 NOT NULL,
    taxes numeric(18,2) DEFAULT 0 NOT NULL,
    net numeric(18,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: po_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.po_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    po_id uuid NOT NULL,
    item_id uuid,
    description text NOT NULL,
    quantity numeric DEFAULT 1 NOT NULL,
    unit_cost numeric DEFAULT 0 NOT NULL,
    total numeric GENERATED ALWAYS AS ((quantity * unit_cost)) STORED
);


--
-- Name: purchase_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    po_number text DEFAULT ('PO-'::text || lpad((nextval('public.po_number_seq'::regclass))::text, 5, '0'::text)) NOT NULL,
    supplier_id uuid NOT NULL,
    order_date date DEFAULT CURRENT_DATE NOT NULL,
    total numeric(18,2) DEFAULT 0 NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    approved_by uuid,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: procurement_approval_thresholds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.procurement_approval_thresholds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    doc_type text NOT NULL,
    level text NOT NULL,
    max_amount numeric,
    approver text NOT NULL,
    sla_hours integer DEFAULT 24 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT procurement_approval_thresholds_doc_type_check CHECK ((doc_type = ANY (ARRAY['PR'::text, 'PO'::text])))
);


--
-- Name: procurement_approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.procurement_approvals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    doc_type text NOT NULL,
    doc_id uuid NOT NULL,
    level_order integer NOT NULL,
    level_label text NOT NULL,
    approver_role text NOT NULL,
    sla_hours integer DEFAULT 24 NOT NULL,
    sla_due_at timestamp with time zone DEFAULT (now() + '24:00:00'::interval) NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    decided_by uuid,
    decided_at timestamp with time zone,
    comment text,
    amount numeric DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT procurement_approvals_doc_type_check CHECK ((doc_type = ANY (ARRAY['PR'::text, 'PO'::text]))),
    CONSTRAINT procurement_approvals_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'skipped'::text])))
);


--
-- Name: procurement_match_decisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.procurement_match_decisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    po_id uuid NOT NULL,
    decision text NOT NULL,
    reason text NOT NULL,
    decided_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT procurement_match_decisions_decision_check CHECK ((decision = ANY (ARRAY['accepted'::text, 'revision_requested'::text])))
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    tenant_id uuid,
    full_name text,
    avatar_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: purchase_requisitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_requisitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    pr_number text DEFAULT ('PR-'::text || lpad((nextval('public.pr_number_seq'::regclass))::text, 5, '0'::text)) NOT NULL,
    requested_by uuid NOT NULL,
    request_date date DEFAULT CURRENT_DATE NOT NULL,
    description text,
    estimated_total numeric DEFAULT 0 NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    po_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: procurement_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.procurement_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    three_way_tolerance_pct numeric DEFAULT 2.0 NOT NULL,
    three_way_tolerance_amount numeric DEFAULT 5000 NOT NULL,
    require_pr_before_po boolean DEFAULT true NOT NULL,
    require_gr_before_ap boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    sla_pr_hours integer DEFAULT 48 NOT NULL,
    sla_pr_to_po_hours integer DEFAULT 24 NOT NULL,
    sla_po_to_gr_days integer DEFAULT 14 NOT NULL,
    sla_gr_to_ap_days integer DEFAULT 7 NOT NULL,
    sla_warning_pct numeric DEFAULT 80 NOT NULL,
    sla_critical_pct numeric DEFAULT 100 NOT NULL,
    sla_color_ok text DEFAULT '#16a34a'::text NOT NULL,
    sla_color_warning text DEFAULT '#f59e0b'::text NOT NULL,
    sla_color_critical text DEFAULT '#dc2626'::text NOT NULL
);


--
-- Name: tenants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    currency text DEFAULT 'XOF'::text NOT NULL,
    fiscal_year_start integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: procurement_role_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.procurement_role_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    target_user_id uuid NOT NULL,
    role public.app_role NOT NULL,
    action text NOT NULL,
    performed_by uuid NOT NULL,
    comment text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT procurement_role_audit_action_check CHECK ((action = ANY (ARRAY['assign'::text, 'revoke'::text])))
);


--
-- Name: project_costs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_costs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    cost_date date DEFAULT CURRENT_DATE NOT NULL,
    category text NOT NULL,
    description text,
    amount numeric NOT NULL,
    gl_account_id uuid,
    journal_entry_id uuid,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: project_role_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_role_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    target_user_id uuid NOT NULL,
    role public.app_role NOT NULL,
    action text NOT NULL,
    performed_by uuid NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT project_role_audit_action_check CHECK ((action = ANY (ARRAY['grant'::text, 'revoke'::text])))
);


--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    project_code text NOT NULL,
    name text NOT NULL,
    client text,
    status text DEFAULT 'active'::text NOT NULL,
    budget numeric DEFAULT 0 NOT NULL,
    total_costs numeric DEFAULT 0 NOT NULL,
    completion_pct integer DEFAULT 0 NOT NULL,
    project_manager text,
    start_date date,
    end_date date,
    department text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: quotations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quotations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    quote_number text DEFAULT ('QUO-'::text || lpad((nextval('public.quote_number_seq'::regclass))::text, 5, '0'::text)) NOT NULL,
    customer_id uuid NOT NULL,
    quote_date date DEFAULT CURRENT_DATE NOT NULL,
    valid_until date,
    total numeric(18,2) DEFAULT 0 NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: quote_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quote_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    quotation_id uuid NOT NULL,
    item_id uuid,
    description text,
    quantity numeric DEFAULT 1 NOT NULL,
    unit_price numeric DEFAULT 0 NOT NULL,
    total numeric DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: report_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    module text NOT NULL,
    name text NOT NULL,
    data_source text NOT NULL,
    columns jsonb DEFAULT '[]'::jsonb NOT NULL,
    filters jsonb DEFAULT '{}'::jsonb NOT NULL,
    group_by text,
    status text DEFAULT 'active'::text NOT NULL,
    permission text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: requisition_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.requisition_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    requisition_id uuid NOT NULL,
    item_id uuid,
    description text NOT NULL,
    quantity numeric DEFAULT 1 NOT NULL,
    estimated_unit_cost numeric DEFAULT 0 NOT NULL,
    total numeric GENERATED ALWAYS AS ((quantity * estimated_unit_cost)) STORED
);


--
-- Name: risk_assessments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.risk_assessments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    risk_id uuid NOT NULL,
    assessment_date date DEFAULT CURRENT_DATE NOT NULL,
    assessor text NOT NULL,
    likelihood integer NOT NULL,
    impact integer NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: risk_register; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.risk_register (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    risk_code text NOT NULL,
    title text NOT NULL,
    description text,
    category text NOT NULL,
    likelihood integer DEFAULT 3 NOT NULL,
    impact integer DEFAULT 3 NOT NULL,
    risk_score integer GENERATED ALWAYS AS ((likelihood * impact)) STORED,
    status text DEFAULT 'open'::text NOT NULL,
    owner text,
    mitigation_plan text,
    residual_likelihood integer,
    residual_impact integer,
    review_date date,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: risk_role_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.risk_role_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    actor_user_id uuid NOT NULL,
    target_user_id uuid NOT NULL,
    role public.app_role NOT NULL,
    action text NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT risk_role_audit_action_check CHECK ((action = ANY (ARRAY['grant'::text, 'revoke'::text])))
);


--
-- Name: sales_role_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_role_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    target_user_id uuid NOT NULL,
    role public.app_role NOT NULL,
    action text NOT NULL,
    performed_by uuid NOT NULL,
    comment text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sales_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    so_number text DEFAULT ('SO-'::text || lpad((nextval('public.so_number_seq'::regclass))::text, 5, '0'::text)) NOT NULL,
    quotation_id uuid,
    customer_id uuid NOT NULL,
    order_date date DEFAULT CURRENT_DATE NOT NULL,
    total numeric(18,2) DEFAULT 0 NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sales_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_settings (
    tenant_id uuid NOT NULL,
    auto_invoice_on_delivery boolean DEFAULT true NOT NULL,
    reserve_stock_on_confirm boolean DEFAULT true NOT NULL,
    sla_quote_hours integer DEFAULT 48 NOT NULL,
    sla_quote_to_so_hours integer DEFAULT 72 NOT NULL,
    sla_so_to_dn_days integer DEFAULT 7 NOT NULL,
    sla_dn_to_invoice_days integer DEFAULT 2 NOT NULL,
    sla_warning_pct integer DEFAULT 75 NOT NULL,
    sla_critical_pct integer DEFAULT 100 NOT NULL,
    color_ok text DEFAULT '#16a34a'::text NOT NULL,
    color_warning text DEFAULT '#f59e0b'::text NOT NULL,
    color_critical text DEFAULT '#dc2626'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: so_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.so_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    so_id uuid NOT NULL,
    item_id uuid,
    description text,
    quantity numeric DEFAULT 1 NOT NULL,
    unit_price numeric DEFAULT 0 NOT NULL,
    total numeric DEFAULT 0 NOT NULL,
    quantity_delivered numeric DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tenant_modules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_modules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    module_name text NOT NULL,
    status text DEFAULT 'inactive'::text NOT NULL,
    activated_at timestamp with time zone,
    deactivated_at timestamp with time zone,
    activated_by text,
    license_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: treasury_role_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.treasury_role_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    target_user_id uuid NOT NULL,
    role public.app_role NOT NULL,
    action text NOT NULL,
    comment text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT treasury_role_audit_action_check CHECK ((action = ANY (ARRAY['assign'::text, 'revoke'::text, 'period_close_started'::text, 'period_close_completed'::text, 'period_close_failed'::text, 'period_close_idempotent'::text, 'export_csv'::text, 'export_pdf'::text, 'export_aborted'::text, 'export_failed'::text])))
);


--
-- Name: treasury_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.treasury_settings (
    tenant_id uuid NOT NULL,
    pivot_currency text DEFAULT 'XOF'::text NOT NULL,
    match_amount_tolerance numeric(18,2) DEFAULT 0 NOT NULL,
    match_date_window_days integer DEFAULT 3 NOT NULL,
    unreconciled_alert_days integer DEFAULT 7 NOT NULL,
    low_cash_threshold numeric(18,2) DEFAULT 0 NOT NULL,
    auto_je_on_reconciliation boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_role_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_role_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    assigned_by uuid
);


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role public.app_role NOT NULL,
    tenant_id uuid
);


--
-- Name: workflow_instances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_instances (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    rule_id uuid NOT NULL,
    reference_type text NOT NULL,
    reference_id uuid,
    status text DEFAULT 'pending'::text NOT NULL,
    current_step integer DEFAULT 0 NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    decided_by text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: workflow_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    module text NOT NULL,
    event_type text NOT NULL,
    conditions jsonb DEFAULT '[]'::jsonb NOT NULL,
    combinator text DEFAULT 'AND'::text NOT NULL,
    approvers jsonb DEFAULT '[]'::jsonb NOT NULL,
    escalation jsonb,
    sla_hours integer DEFAULT 24 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
--


