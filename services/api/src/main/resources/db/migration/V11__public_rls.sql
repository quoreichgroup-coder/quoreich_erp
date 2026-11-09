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

--
-- Name: ai_analysis_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_analysis_history ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_analysis_schedules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_analysis_schedules ENABLE ROW LEVEL SECURITY;

--
-- Name: ap_approval_queue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ap_approval_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: ap_approval_thresholds; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ap_approval_thresholds ENABLE ROW LEVEL SECURITY;

--
-- Name: ap_general_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ap_general_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: ap_invoices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ap_invoices ENABLE ROW LEVEL SECURITY;

--
-- Name: ap_notification_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ap_notification_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: ap_numbering_series; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ap_numbering_series ENABLE ROW LEVEL SECURITY;

--
-- Name: ap_payment_methods; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ap_payment_methods ENABLE ROW LEVEL SECURITY;

--
-- Name: ap_withholding_rates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ap_withholding_rates ENABLE ROW LEVEL SECURITY;

--
-- Name: ar_dunning_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ar_dunning_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: ar_general_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ar_general_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: ar_invoices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ar_invoices ENABLE ROW LEVEL SECURITY;

--
-- Name: ar_notification_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ar_notification_log ENABLE ROW LEVEL SECURITY;

--
-- Name: ar_notification_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ar_notification_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: ar_numbering_series; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ar_numbering_series ENABLE ROW LEVEL SECURITY;

--
-- Name: ar_payment_terms; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ar_payment_terms ENABLE ROW LEVEL SECURITY;

--
-- Name: asset_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.asset_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: asset_disposals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.asset_disposals ENABLE ROW LEVEL SECURITY;

--
-- Name: assets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;

--
-- Name: bank_accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: bank_reconciliations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bank_reconciliations ENABLE ROW LEVEL SECURITY;

--
-- Name: bank_statement_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bank_statement_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: bank_statements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bank_statements ENABLE ROW LEVEL SECURITY;

--
-- Name: bank_transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: budget_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.budget_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: budget_role_audit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.budget_role_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: budgets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;

--
-- Name: cashflow_forecasts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cashflow_forecasts ENABLE ROW LEVEL SECURITY;

--
-- Name: compliance_controls; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.compliance_controls ENABLE ROW LEVEL SECURITY;

--
-- Name: compliance_frameworks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.compliance_frameworks ENABLE ROW LEVEL SECURITY;

--
-- Name: compliance_role_audit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.compliance_role_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: compliance_test_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.compliance_test_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_activities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_activities ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_contacts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_contacts ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_opportunities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_opportunities ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_role_audit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_role_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: customers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

--
-- Name: delivery_notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.delivery_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: depreciation_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.depreciation_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: dn_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dn_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: employees; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

--
-- Name: erp_alerts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.erp_alerts ENABLE ROW LEVEL SECURITY;

--
-- Name: erp_permissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.erp_permissions ENABLE ROW LEVEL SECURITY;

--
-- Name: erp_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.erp_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: expense_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.expense_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: expense_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.expense_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: expense_role_audit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.expense_role_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: fixed_asset_role_audit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fixed_asset_role_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: gl_accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gl_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: gl_audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gl_audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: goods_receipts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.goods_receipts ENABLE ROW LEVEL SECURITY;

--
-- Name: gr_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gr_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: hr_role_audit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hr_role_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_count_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventory_count_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_counts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventory_counts ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_period_closes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventory_period_closes ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_role_audit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventory_role_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventory_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: item_locations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.item_locations ENABLE ROW LEVEL SECURITY;

--
-- Name: items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;

--
-- Name: journal_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: journal_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.journal_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: licenses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.licenses ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_preferences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

--
-- Name: payroll_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payroll_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: payroll_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: period_locks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.period_locks ENABLE ROW LEVEL SECURITY;

--
-- Name: po_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.po_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: procurement_approval_thresholds; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.procurement_approval_thresholds ENABLE ROW LEVEL SECURITY;

--
-- Name: procurement_approvals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.procurement_approvals ENABLE ROW LEVEL SECURITY;

--
-- Name: procurement_match_decisions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.procurement_match_decisions ENABLE ROW LEVEL SECURITY;

--
-- Name: procurement_role_audit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.procurement_role_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: procurement_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.procurement_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: project_costs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_costs ENABLE ROW LEVEL SECURITY;

--
-- Name: project_role_audit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_role_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: projects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

--
-- Name: purchase_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: purchase_requisitions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.purchase_requisitions ENABLE ROW LEVEL SECURITY;

--
-- Name: quotations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.quotations ENABLE ROW LEVEL SECURITY;

--
-- Name: quote_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.quote_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: report_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.report_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: requisition_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.requisition_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: risk_assessments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.risk_assessments ENABLE ROW LEVEL SECURITY;

--
-- Name: risk_register; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.risk_register ENABLE ROW LEVEL SECURITY;

--
-- Name: risk_role_audit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.risk_role_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sales_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_role_audit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sales_role_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sales_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: so_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.so_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_movements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_valuation_layers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stock_valuation_layers ENABLE ROW LEVEL SECURITY;

--
-- Name: suppliers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

--
-- Name: tenant_modules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tenant_modules ENABLE ROW LEVEL SECURITY;

--
-- Name: tenants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

--
-- Name: treasury_period_closes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.treasury_period_closes ENABLE ROW LEVEL SECURITY;

--
-- Name: treasury_role_audit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.treasury_role_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: treasury_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.treasury_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: user_role_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_role_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: user_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: warehouses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;

--
-- Name: workflow_instances; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workflow_instances ENABLE ROW LEVEL SECURITY;

--
-- Name: workflow_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workflow_rules ENABLE ROW LEVEL SECURITY;

--
--


