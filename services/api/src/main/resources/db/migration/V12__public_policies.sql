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
-- Name: gr_lines Access via GR; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Access via GR" ON public.gr_lines TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.goods_receipts gr
  WHERE ((gr.id = gr_lines.gr_id) AND (gr.tenant_id = public.get_user_tenant_id(auth.uid()))))));


--
-- Name: po_lines Access via PO; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Access via PO" ON public.po_lines TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.purchase_orders po
  WHERE ((po.id = po_lines.po_id) AND (po.tenant_id = public.get_user_tenant_id(auth.uid()))))));


--
-- Name: depreciation_entries Access via asset; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Access via asset" ON public.depreciation_entries TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.assets a
  WHERE ((a.id = depreciation_entries.asset_id) AND (a.tenant_id = public.get_user_tenant_id(auth.uid()))))));


--
-- Name: budget_lines Access via budget; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Access via budget" ON public.budget_lines TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.budgets b
  WHERE ((b.id = budget_lines.budget_id) AND (b.tenant_id = public.get_user_tenant_id(auth.uid()))))));


--
-- Name: compliance_test_logs Access via control; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Access via control" ON public.compliance_test_logs TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.compliance_controls c
     JOIN public.compliance_frameworks f ON ((f.id = c.framework_id)))
  WHERE ((c.id = compliance_test_logs.control_id) AND (f.tenant_id = public.get_user_tenant_id(auth.uid()))))));


--
-- Name: journal_lines Access via entry; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Access via entry" ON public.journal_lines TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.journal_entries je
  WHERE ((je.id = journal_lines.entry_id) AND (je.tenant_id = public.get_user_tenant_id(auth.uid()))))));


--
-- Name: compliance_controls Access via framework; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Access via framework" ON public.compliance_controls TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.compliance_frameworks f
  WHERE ((f.id = compliance_controls.framework_id) AND (f.tenant_id = public.get_user_tenant_id(auth.uid()))))));


--
-- Name: project_costs Access via project; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Access via project" ON public.project_costs TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = project_costs.project_id) AND (p.tenant_id = public.get_user_tenant_id(auth.uid()))))));


--
-- Name: expense_lines Access via report; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Access via report" ON public.expense_lines TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.expense_reports er
  WHERE ((er.id = expense_lines.report_id) AND (er.tenant_id = public.get_user_tenant_id(auth.uid()))))));


--
-- Name: requisition_lines Access via requisition; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Access via requisition" ON public.requisition_lines TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.purchase_requisitions pr
  WHERE ((pr.id = requisition_lines.requisition_id) AND (pr.tenant_id = public.get_user_tenant_id(auth.uid()))))));


--
-- Name: risk_assessments Access via risk; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Access via risk" ON public.risk_assessments TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.risk_register r
  WHERE ((r.id = risk_assessments.risk_id) AND (r.tenant_id = public.get_user_tenant_id(auth.uid()))))));


--
-- Name: erp_permissions Access via role; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Access via role" ON public.erp_permissions TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.erp_roles r
  WHERE ((r.id = erp_permissions.role_id) AND (r.tenant_id = public.get_user_tenant_id(auth.uid()))))));


--
-- Name: ai_analysis_schedules Admins can manage schedules; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage schedules" ON public.ai_analysis_schedules TO authenticated USING (((tenant_id = public.get_user_tenant_id(auth.uid())) AND public.has_role(auth.uid(), 'admin'::public.app_role))) WITH CHECK (((tenant_id = public.get_user_tenant_id(auth.uid())) AND public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: user_role_assignments Admins delete assignments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins delete assignments" ON public.user_role_assignments FOR DELETE TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) AND (tenant_id = public.get_user_tenant_id(auth.uid()))));


--
-- Name: user_roles Admins delete roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins delete roles" ON public.user_roles FOR DELETE TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) AND (tenant_id = public.get_user_tenant_id(auth.uid()))));


--
-- Name: user_role_assignments Admins insert assignments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins insert assignments" ON public.user_role_assignments FOR INSERT TO authenticated WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) AND (tenant_id = public.get_user_tenant_id(auth.uid()))));


--
-- Name: user_roles Admins insert roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins insert roles" ON public.user_roles FOR INSERT TO authenticated WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) AND (tenant_id = public.get_user_tenant_id(auth.uid()))));


--
-- Name: user_role_assignments Admins update assignments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins update assignments" ON public.user_role_assignments FOR UPDATE TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) AND (tenant_id = public.get_user_tenant_id(auth.uid())))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) AND (tenant_id = public.get_user_tenant_id(auth.uid()))));


--
-- Name: user_roles Admins update roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins update roles" ON public.user_roles FOR UPDATE TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) AND (tenant_id = public.get_user_tenant_id(auth.uid())))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) AND (tenant_id = public.get_user_tenant_id(auth.uid()))));


--
-- Name: user_roles Admins view all roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins view all roles" ON public.user_roles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: profiles Same tenant can view profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Same tenant can view profiles" ON public.profiles FOR SELECT TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: project_role_audit Service role full access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role full access" ON public.project_role_audit TO service_role USING (true) WITH CHECK (true);


--
-- Name: ai_analysis_history Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.ai_analysis_history TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid()))) WITH CHECK ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: ap_approval_queue Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.ap_approval_queue TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid()))) WITH CHECK ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: ap_approval_thresholds Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.ap_approval_thresholds TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid()))) WITH CHECK ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: ap_general_settings Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.ap_general_settings TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid()))) WITH CHECK ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: ap_invoices Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.ap_invoices TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: ap_notification_rules Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.ap_notification_rules TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid()))) WITH CHECK ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: ap_numbering_series Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.ap_numbering_series TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid()))) WITH CHECK ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: ap_payment_methods Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.ap_payment_methods TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid()))) WITH CHECK ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: ap_withholding_rates Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.ap_withholding_rates TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid()))) WITH CHECK ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: ar_dunning_rules Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.ar_dunning_rules TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid()))) WITH CHECK ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: ar_general_settings Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.ar_general_settings TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid()))) WITH CHECK ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: ar_invoices Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.ar_invoices TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: ar_notification_log Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.ar_notification_log TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid()))) WITH CHECK ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: ar_notification_rules Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.ar_notification_rules TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid()))) WITH CHECK ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: ar_numbering_series Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.ar_numbering_series TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid()))) WITH CHECK ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: ar_payment_terms Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.ar_payment_terms TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid()))) WITH CHECK ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: asset_categories Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.asset_categories TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: assets Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.assets TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: bank_accounts Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.bank_accounts TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: bank_transactions Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.bank_transactions TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: budgets Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.budgets TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: compliance_frameworks Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.compliance_frameworks TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: customers Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.customers TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: erp_alerts Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.erp_alerts TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: erp_roles Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.erp_roles TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: expense_reports Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.expense_reports TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: gl_accounts Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.gl_accounts TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: gl_audit_logs Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.gl_audit_logs TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: goods_receipts Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.goods_receipts TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: items Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.items TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: licenses Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.licenses TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: payments Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.payments TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: period_locks Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.period_locks TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid()))) WITH CHECK ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: projects Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.projects TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: purchase_orders Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.purchase_orders TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: purchase_requisitions Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.purchase_requisitions TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: quotations Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.quotations TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: report_templates Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.report_templates TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid()))) WITH CHECK ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: risk_register Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.risk_register TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: sales_orders Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.sales_orders TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: stock_movements Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.stock_movements TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: suppliers Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.suppliers TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: tenant_modules Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.tenant_modules TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: workflow_instances Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.workflow_instances TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: workflow_rules Tenant isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation" ON public.workflow_rules TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: ai_analysis_schedules Tenant members can view schedules; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant members can view schedules" ON public.ai_analysis_schedules FOR SELECT TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: user_role_assignments Tenant read assignments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant read assignments" ON public.user_role_assignments FOR SELECT TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: profiles Users can insert own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK ((id = auth.uid()));


--
-- Name: profiles Users can update own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING ((id = auth.uid()));


--
-- Name: profiles Users can view own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT TO authenticated USING ((id = auth.uid()));


--
-- Name: user_roles Users can view own roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: tenants Users can view own tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own tenant" ON public.tenants FOR SELECT TO authenticated USING ((id = public.get_user_tenant_id(auth.uid())));


--
-- Name: budget_role_audit budget_audit_admin_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY budget_audit_admin_insert ON public.budget_role_audit FOR INSERT TO authenticated WITH CHECK (((actor_user_id = auth.uid()) AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'budget_admin'::public.app_role))));


--
-- Name: compliance_role_audit compliance_audit_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY compliance_audit_service_all ON public.compliance_role_audit TO service_role USING (true) WITH CHECK (true);


--
-- Name: crm_activities crm_activities_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_activities_delete ON public.crm_activities FOR DELETE TO authenticated USING (((tenant_id = public.get_user_tenant_id(auth.uid())) AND public.has_crm_perm(auth.uid(), 'delete'::text)));


--
-- Name: crm_activities crm_activities_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_activities_insert ON public.crm_activities FOR INSERT TO authenticated WITH CHECK (((tenant_id = public.get_user_tenant_id(auth.uid())) AND public.has_crm_perm(auth.uid(), 'create'::text)));


--
-- Name: crm_activities crm_activities_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_activities_select ON public.crm_activities FOR SELECT TO authenticated USING (((tenant_id = public.get_user_tenant_id(auth.uid())) AND public.has_crm_perm(auth.uid(), 'view'::text)));


--
-- Name: crm_activities crm_activities_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_activities_update ON public.crm_activities FOR UPDATE TO authenticated USING (((tenant_id = public.get_user_tenant_id(auth.uid())) AND public.has_crm_perm(auth.uid(), 'edit'::text))) WITH CHECK (((tenant_id = public.get_user_tenant_id(auth.uid())) AND public.has_crm_perm(auth.uid(), 'edit'::text)));


--
-- Name: crm_contacts crm_contacts_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_contacts_delete ON public.crm_contacts FOR DELETE TO authenticated USING (((tenant_id = public.get_user_tenant_id(auth.uid())) AND public.has_crm_perm(auth.uid(), 'delete'::text)));


--
-- Name: crm_contacts crm_contacts_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_contacts_insert ON public.crm_contacts FOR INSERT TO authenticated WITH CHECK (((tenant_id = public.get_user_tenant_id(auth.uid())) AND public.has_crm_perm(auth.uid(), 'create'::text)));


--
-- Name: crm_contacts crm_contacts_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_contacts_select ON public.crm_contacts FOR SELECT TO authenticated USING (((tenant_id = public.get_user_tenant_id(auth.uid())) AND public.has_crm_perm(auth.uid(), 'view'::text)));


--
-- Name: crm_contacts crm_contacts_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_contacts_update ON public.crm_contacts FOR UPDATE TO authenticated USING (((tenant_id = public.get_user_tenant_id(auth.uid())) AND public.has_crm_perm(auth.uid(), 'edit'::text))) WITH CHECK (((tenant_id = public.get_user_tenant_id(auth.uid())) AND public.has_crm_perm(auth.uid(), 'edit'::text)));


--
-- Name: crm_opportunities crm_opportunities_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_opportunities_delete ON public.crm_opportunities FOR DELETE TO authenticated USING (((tenant_id = public.get_user_tenant_id(auth.uid())) AND public.has_crm_perm(auth.uid(), 'delete'::text)));


--
-- Name: crm_opportunities crm_opportunities_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_opportunities_insert ON public.crm_opportunities FOR INSERT TO authenticated WITH CHECK (((tenant_id = public.get_user_tenant_id(auth.uid())) AND public.has_crm_perm(auth.uid(), 'create'::text)));


--
-- Name: crm_opportunities crm_opportunities_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_opportunities_select ON public.crm_opportunities FOR SELECT TO authenticated USING (((tenant_id = public.get_user_tenant_id(auth.uid())) AND public.has_crm_perm(auth.uid(), 'view'::text)));


--
-- Name: crm_opportunities crm_opportunities_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_opportunities_update ON public.crm_opportunities FOR UPDATE TO authenticated USING (((tenant_id = public.get_user_tenant_id(auth.uid())) AND public.has_crm_perm(auth.uid(), 'edit'::text))) WITH CHECK (((tenant_id = public.get_user_tenant_id(auth.uid())) AND public.has_crm_perm(auth.uid(), 'edit'::text)));


--
-- Name: crm_role_audit crm_role_audit_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_role_audit_insert ON public.crm_role_audit FOR INSERT TO authenticated WITH CHECK (((tenant_id = public.get_user_tenant_id(auth.uid())) AND (performed_by = auth.uid())));


--
-- Name: crm_role_audit crm_role_audit_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_role_audit_select ON public.crm_role_audit FOR SELECT TO authenticated USING (((tenant_id = public.get_user_tenant_id(auth.uid())) AND public.has_crm_perm(auth.uid(), 'audit'::text)));


--
-- Name: employees employees_hr_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employees_hr_delete ON public.employees FOR DELETE TO authenticated USING (((tenant_id = public.get_user_tenant_id(auth.uid())) AND public.has_hr_perm(auth.uid(), 'manage_employees'::text)));


--
-- Name: employees employees_hr_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employees_hr_select ON public.employees FOR SELECT TO authenticated USING (((tenant_id = public.get_user_tenant_id(auth.uid())) AND public.has_hr_perm(auth.uid(), 'view_sensitive'::text)));


--
-- Name: employees employees_hr_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employees_hr_update ON public.employees FOR UPDATE TO authenticated USING (((tenant_id = public.get_user_tenant_id(auth.uid())) AND public.has_hr_perm(auth.uid(), 'manage_employees'::text))) WITH CHECK (((tenant_id = public.get_user_tenant_id(auth.uid())) AND public.has_hr_perm(auth.uid(), 'manage_employees'::text)));


--
-- Name: employees employees_hr_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employees_hr_write ON public.employees FOR INSERT TO authenticated WITH CHECK (((tenant_id = public.get_user_tenant_id(auth.uid())) AND public.has_hr_perm(auth.uid(), 'manage_employees'::text)));


--
-- Name: expense_role_audit expense_role_audit_no_direct_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY expense_role_audit_no_direct_write ON public.expense_role_audit FOR INSERT TO authenticated WITH CHECK (false);


--
-- Name: expense_role_audit expense_role_audit_select_tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY expense_role_audit_select_tenant ON public.expense_role_audit FOR SELECT TO authenticated USING ((tenant_id IN ( SELECT user_role_assignments.tenant_id
   FROM public.user_role_assignments
  WHERE (user_role_assignments.user_id = auth.uid()))));


--
-- Name: hr_role_audit hr_role_audit admin insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "hr_role_audit admin insert" ON public.hr_role_audit FOR INSERT TO authenticated WITH CHECK (((tenant_id = public.get_user_tenant_id(auth.uid())) AND public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: hr_role_audit hr_role_audit tenant read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "hr_role_audit tenant read" ON public.hr_role_audit FOR SELECT TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: hr_role_audit hr_role_audit_admin_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hr_role_audit_admin_insert ON public.hr_role_audit FOR INSERT TO authenticated WITH CHECK (((tenant_id = public.get_user_tenant_id(auth.uid())) AND (performed_by = auth.uid()) AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'hr_admin'::public.app_role))));


--
-- Name: inventory_count_lines inv count lines tenant access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "inv count lines tenant access" ON public.inventory_count_lines TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.inventory_counts c
  WHERE ((c.id = inventory_count_lines.count_id) AND (c.tenant_id = public.get_user_tenant_id(auth.uid())))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.inventory_counts c
  WHERE ((c.id = inventory_count_lines.count_id) AND (c.tenant_id = public.get_user_tenant_id(auth.uid()))))));


--
-- Name: inventory_counts inv counts tenant access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "inv counts tenant access" ON public.inventory_counts TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid()))) WITH CHECK ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: inventory_role_audit inv role audit read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "inv role audit read" ON public.inventory_role_audit FOR SELECT TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: inventory_settings inv settings tenant access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "inv settings tenant access" ON public.inventory_settings TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid()))) WITH CHECK ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: inventory_role_audit inv_role_audit_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inv_role_audit_insert ON public.inventory_role_audit FOR INSERT TO authenticated WITH CHECK (((tenant_id = public.get_user_tenant_id(auth.uid())) AND (performed_by = auth.uid())));


--
-- Name: item_locations item_locations tenant access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "item_locations tenant access" ON public.item_locations TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid()))) WITH CHECK ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: journal_entries je_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY je_delete_admin ON public.journal_entries FOR DELETE TO authenticated USING (((tenant_id = public.get_user_tenant_id(auth.uid())) AND public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: journal_entries je_insert_accountant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY je_insert_accountant ON public.journal_entries FOR INSERT TO authenticated WITH CHECK (((tenant_id = public.get_user_tenant_id(auth.uid())) AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'accountant'::public.app_role))));


--
-- Name: journal_entries je_select_tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY je_select_tenant ON public.journal_entries FOR SELECT TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: journal_entries je_update_accountant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY je_update_accountant ON public.journal_entries FOR UPDATE TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid()))) WITH CHECK (((tenant_id = public.get_user_tenant_id(auth.uid())) AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'accountant'::public.app_role))));


--
-- Name: journal_lines jl_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY jl_delete_admin ON public.journal_lines FOR DELETE TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.journal_entries je
  WHERE ((je.id = journal_lines.entry_id) AND (je.tenant_id = public.get_user_tenant_id(auth.uid()))))) AND public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: journal_lines jl_insert_accountant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY jl_insert_accountant ON public.journal_lines FOR INSERT TO authenticated WITH CHECK (((EXISTS ( SELECT 1
   FROM public.journal_entries je
  WHERE ((je.id = journal_lines.entry_id) AND (je.tenant_id = public.get_user_tenant_id(auth.uid()))))) AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'accountant'::public.app_role))));


--
-- Name: journal_lines jl_select_tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY jl_select_tenant ON public.journal_lines FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.journal_entries je
  WHERE ((je.id = journal_lines.entry_id) AND (je.tenant_id = public.get_user_tenant_id(auth.uid()))))));


--
-- Name: journal_lines jl_update_accountant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY jl_update_accountant ON public.journal_lines FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.journal_entries je
  WHERE ((je.id = journal_lines.entry_id) AND (je.tenant_id = public.get_user_tenant_id(auth.uid())))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM public.journal_entries je
  WHERE ((je.id = journal_lines.entry_id) AND (je.tenant_id = public.get_user_tenant_id(auth.uid()))))) AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'accountant'::public.app_role))));


--
-- Name: payroll_lines payroll_lines_hr_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_lines_hr_delete ON public.payroll_lines FOR DELETE TO authenticated USING (((tenant_id = public.get_user_tenant_id(auth.uid())) AND public.has_hr_perm(auth.uid(), 'run_payroll'::text)));


--
-- Name: payroll_lines payroll_lines_hr_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_lines_hr_select ON public.payroll_lines FOR SELECT TO authenticated USING (((tenant_id = public.get_user_tenant_id(auth.uid())) AND public.has_hr_perm(auth.uid(), 'view_payroll'::text)));


--
-- Name: payroll_lines payroll_lines_hr_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_lines_hr_update ON public.payroll_lines FOR UPDATE TO authenticated USING (((tenant_id = public.get_user_tenant_id(auth.uid())) AND public.has_hr_perm(auth.uid(), 'run_payroll'::text))) WITH CHECK (((tenant_id = public.get_user_tenant_id(auth.uid())) AND public.has_hr_perm(auth.uid(), 'run_payroll'::text)));


--
-- Name: payroll_lines payroll_lines_hr_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_lines_hr_write ON public.payroll_lines FOR INSERT TO authenticated WITH CHECK (((tenant_id = public.get_user_tenant_id(auth.uid())) AND public.has_hr_perm(auth.uid(), 'run_payroll'::text)));


--
-- Name: payroll_runs payroll_runs_hr_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_runs_hr_delete ON public.payroll_runs FOR DELETE TO authenticated USING (((tenant_id = public.get_user_tenant_id(auth.uid())) AND public.has_hr_perm(auth.uid(), 'run_payroll'::text)));


--
-- Name: payroll_runs payroll_runs_hr_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_runs_hr_select ON public.payroll_runs FOR SELECT TO authenticated USING (((tenant_id = public.get_user_tenant_id(auth.uid())) AND public.has_hr_perm(auth.uid(), 'view_payroll'::text)));


--
-- Name: payroll_runs payroll_runs_hr_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_runs_hr_update ON public.payroll_runs FOR UPDATE TO authenticated USING (((tenant_id = public.get_user_tenant_id(auth.uid())) AND public.has_hr_perm(auth.uid(), 'run_payroll'::text))) WITH CHECK (((tenant_id = public.get_user_tenant_id(auth.uid())) AND public.has_hr_perm(auth.uid(), 'run_payroll'::text)));


--
-- Name: payroll_runs payroll_runs_hr_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_runs_hr_write ON public.payroll_runs FOR INSERT TO authenticated WITH CHECK (((tenant_id = public.get_user_tenant_id(auth.uid())) AND public.has_hr_perm(auth.uid(), 'run_payroll'::text)));


--
-- Name: procurement_role_audit procurement_role_audit_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY procurement_role_audit_admin_read ON public.procurement_role_audit FOR SELECT TO authenticated USING (((tenant_id = public.get_user_tenant_id(auth.uid())) AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'procurement_controller'::public.app_role) OR public.has_role(auth.uid(), 'procurement_l3'::public.app_role))));


--
-- Name: procurement_role_audit procurement_role_audit_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY procurement_role_audit_insert ON public.procurement_role_audit FOR INSERT TO authenticated WITH CHECK (((tenant_id = public.get_user_tenant_id(auth.uid())) AND (performed_by = auth.uid())));


--
-- Name: risk_role_audit risk_audit_admin_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY risk_audit_admin_select ON public.risk_role_audit FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'risk_admin'::public.app_role)));


--
-- Name: risk_role_audit risk_audit_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY risk_audit_service_all ON public.risk_role_audit TO service_role USING (true) WITH CHECK (true);


--
-- Name: sales_role_audit sales_role_audit_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sales_role_audit_admin_read ON public.sales_role_audit FOR SELECT TO authenticated USING (((tenant_id = public.get_user_tenant_id(auth.uid())) AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'sales_manager'::public.app_role) OR public.has_role(auth.uid(), 'sales_controller'::public.app_role))));


--
-- Name: sales_role_audit sales_role_audit_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sales_role_audit_insert ON public.sales_role_audit FOR INSERT TO authenticated WITH CHECK (((tenant_id = public.get_user_tenant_id(auth.uid())) AND (performed_by = auth.uid())));


--
-- Name: inventory_period_closes service write inventory closes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service write inventory closes" ON public.inventory_period_closes TO service_role USING (true) WITH CHECK (true);


--
-- Name: asset_disposals tenant access asset_disposals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "tenant access asset_disposals" ON public.asset_disposals TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid()))) WITH CHECK ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: fixed_asset_role_audit tenant insert fa audit; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "tenant insert fa audit" ON public.fixed_asset_role_audit FOR INSERT TO authenticated WITH CHECK (((tenant_id = public.get_user_tenant_id(auth.uid())) AND (actor_user_id = auth.uid())));


--
-- Name: fixed_asset_role_audit tenant read fa audit; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "tenant read fa audit" ON public.fixed_asset_role_audit FOR SELECT TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: inventory_period_closes tenant read inventory closes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "tenant read inventory closes" ON public.inventory_period_closes FOR SELECT TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: delivery_notes tenant rw dn; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "tenant rw dn" ON public.delivery_notes TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid()))) WITH CHECK ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: dn_lines tenant rw dn_lines; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "tenant rw dn_lines" ON public.dn_lines TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.delivery_notes d
  WHERE ((d.id = dn_lines.dn_id) AND (d.tenant_id = public.get_user_tenant_id(auth.uid())))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.delivery_notes d
  WHERE ((d.id = dn_lines.dn_id) AND (d.tenant_id = public.get_user_tenant_id(auth.uid()))))));


--
-- Name: quote_lines tenant rw quote_lines; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "tenant rw quote_lines" ON public.quote_lines TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.quotations q
  WHERE ((q.id = quote_lines.quotation_id) AND (q.tenant_id = public.get_user_tenant_id(auth.uid())))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.quotations q
  WHERE ((q.id = quote_lines.quotation_id) AND (q.tenant_id = public.get_user_tenant_id(auth.uid()))))));


--
-- Name: sales_settings tenant rw sales_settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "tenant rw sales_settings" ON public.sales_settings TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid()))) WITH CHECK ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: so_lines tenant rw so_lines; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "tenant rw so_lines" ON public.so_lines TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.sales_orders s
  WHERE ((s.id = so_lines.so_id) AND (s.tenant_id = public.get_user_tenant_id(auth.uid())))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.sales_orders s
  WHERE ((s.id = so_lines.so_id) AND (s.tenant_id = public.get_user_tenant_id(auth.uid()))))));


--
-- Name: bank_reconciliations tenant_bank_reconciliations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_bank_reconciliations ON public.bank_reconciliations TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid()))) WITH CHECK ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: bank_statement_lines tenant_bank_statement_lines; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_bank_statement_lines ON public.bank_statement_lines TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid()))) WITH CHECK ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: bank_statements tenant_bank_statements; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_bank_statements ON public.bank_statements TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid()))) WITH CHECK ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: budget_role_audit tenant_budget_audit_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_budget_audit_select ON public.budget_role_audit FOR SELECT TO authenticated USING (((tenant_id = public.get_user_tenant_id(auth.uid())) AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'budget_admin'::public.app_role))));


--
-- Name: cashflow_forecasts tenant_cashflow_forecasts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_cashflow_forecasts ON public.cashflow_forecasts TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid()))) WITH CHECK ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: compliance_role_audit tenant_compliance_audit_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_compliance_audit_select ON public.compliance_role_audit FOR SELECT TO authenticated USING (((tenant_id = public.get_user_tenant_id(auth.uid())) AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'compliance_admin'::public.app_role))));


--
-- Name: procurement_match_decisions tenant_isolation_match_dec; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_match_dec ON public.procurement_match_decisions TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid()))) WITH CHECK ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: procurement_approvals tenant_isolation_proc_approvals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_proc_approvals ON public.procurement_approvals TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid()))) WITH CHECK ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: procurement_approval_thresholds tenant_isolation_proc_thresholds; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_proc_thresholds ON public.procurement_approval_thresholds TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid()))) WITH CHECK ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: procurement_settings tenant_isolation_procurement_settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_procurement_settings ON public.procurement_settings TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid()))) WITH CHECK ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: project_role_audit tenant_project_audit_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_project_audit_select ON public.project_role_audit FOR SELECT TO authenticated USING (((tenant_id = public.get_user_tenant_id(auth.uid())) AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'project_admin'::public.app_role))));


--
-- Name: risk_role_audit tenant_risk_audit_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_risk_audit_select ON public.risk_role_audit FOR SELECT TO authenticated USING (((tenant_id = public.get_user_tenant_id(auth.uid())) AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'risk_admin'::public.app_role))));


--
-- Name: treasury_role_audit tenant_treasury_audit_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_treasury_audit_insert ON public.treasury_role_audit FOR INSERT TO authenticated WITH CHECK (((tenant_id = public.get_user_tenant_id(auth.uid())) AND (actor_id = auth.uid())));


--
-- Name: treasury_period_closes tenant_treasury_closes_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_treasury_closes_insert ON public.treasury_period_closes FOR INSERT TO authenticated WITH CHECK (((tenant_id = public.get_user_tenant_id(auth.uid())) AND (closed_by = auth.uid()) AND public.has_treasury_perm(auth.uid(), 'close_period'::text)));


--
-- Name: treasury_period_closes tenant_treasury_closes_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_treasury_closes_select ON public.treasury_period_closes FOR SELECT TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: treasury_settings tenant_treasury_settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_treasury_settings ON public.treasury_settings TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid()))) WITH CHECK ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: treasury_role_audit treasury_role_audit_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY treasury_role_audit_admin_read ON public.treasury_role_audit FOR SELECT TO authenticated USING (((tenant_id = public.get_user_tenant_id(auth.uid())) AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'treasury_manager'::public.app_role) OR public.has_role(auth.uid(), 'treasury_controller'::public.app_role))));


--
-- Name: notification_preferences users manage their own notification prefs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users manage their own notification prefs" ON public.notification_preferences USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: stock_valuation_layers valuation layers tenant access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "valuation layers tenant access" ON public.stock_valuation_layers TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid()))) WITH CHECK ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: warehouses warehouses tenant access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "warehouses tenant access" ON public.warehouses TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid()))) WITH CHECK ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
--


