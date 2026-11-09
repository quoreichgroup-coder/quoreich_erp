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

--
-- Name: erp_alerts_tenant_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX erp_alerts_tenant_created_idx ON public.erp_alerts USING btree (tenant_id, created_at DESC);


--
-- Name: erp_roles_tenant_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX erp_roles_tenant_name ON public.erp_roles USING btree (tenant_id, name);


--
-- Name: expense_role_audit_tenant_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX expense_role_audit_tenant_created_idx ON public.expense_role_audit USING btree (tenant_id, created_at DESC);


--
-- Name: idx_ai_history_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_history_tenant_created ON public.ai_analysis_history USING btree (tenant_id, created_at DESC);


--
-- Name: idx_ai_history_tenant_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_history_tenant_type ON public.ai_analysis_history USING btree (tenant_id, analysis_type, created_at DESC);


--
-- Name: idx_ai_schedules_next_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_schedules_next_run ON public.ai_analysis_schedules USING btree (enabled, next_run_at) WHERE (enabled = true);


--
-- Name: idx_ap_invoices_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ap_invoices_po ON public.ap_invoices USING btree (po_id);


--
-- Name: idx_asset_disposals_asset; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_asset_disposals_asset ON public.asset_disposals USING btree (asset_id);


--
-- Name: idx_asset_disposals_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_asset_disposals_tenant ON public.asset_disposals USING btree (tenant_id);


--
-- Name: idx_bsl_matched; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bsl_matched ON public.bank_statement_lines USING btree (matched_transaction_id);


--
-- Name: idx_bsl_statement; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bsl_statement ON public.bank_statement_lines USING btree (statement_id);


--
-- Name: idx_budget_role_audit_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_budget_role_audit_tenant_created ON public.budget_role_audit USING btree (tenant_id, created_at DESC);


--
-- Name: idx_cff_week; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cff_week ON public.cashflow_forecasts USING btree (tenant_id, week_start);


--
-- Name: idx_crm_activities_opp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_activities_opp ON public.crm_activities USING btree (opportunity_id);


--
-- Name: idx_crm_contacts_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_contacts_tenant ON public.crm_contacts USING btree (tenant_id);


--
-- Name: idx_crm_opp_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_opp_customer ON public.crm_opportunities USING btree (customer_id);


--
-- Name: idx_crm_opp_tenant_stage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_opp_tenant_stage ON public.crm_opportunities USING btree (tenant_id, stage);


--
-- Name: idx_crm_role_audit_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_role_audit_tenant ON public.crm_role_audit USING btree (tenant_id, created_at DESC);


--
-- Name: idx_employees_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employees_tenant ON public.employees USING btree (tenant_id);


--
-- Name: idx_fa_audit_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fa_audit_tenant ON public.fixed_asset_role_audit USING btree (tenant_id, created_at DESC);


--
-- Name: idx_gl_audit_logs_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gl_audit_logs_batch ON public.gl_audit_logs USING btree (batch_id);


--
-- Name: idx_gl_audit_logs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gl_audit_logs_tenant ON public.gl_audit_logs USING btree (tenant_id);


--
-- Name: idx_hr_audit_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hr_audit_tenant ON public.hr_role_audit USING btree (tenant_id, created_at DESC);


--
-- Name: idx_licenses_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_licenses_tenant ON public.licenses USING btree (tenant_id);


--
-- Name: idx_match_dec_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_match_dec_po ON public.procurement_match_decisions USING btree (po_id);


--
-- Name: idx_payroll_lines_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_lines_run ON public.payroll_lines USING btree (run_id);


--
-- Name: idx_payroll_runs_tenant_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_runs_tenant_period ON public.payroll_runs USING btree (tenant_id, period DESC);


--
-- Name: idx_proc_appr_doc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_proc_appr_doc ON public.procurement_approvals USING btree (doc_type, doc_id, level_order);


--
-- Name: idx_proc_appr_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_proc_appr_status ON public.procurement_approvals USING btree (tenant_id, status);


--
-- Name: idx_project_role_audit_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_role_audit_tenant ON public.project_role_audit USING btree (tenant_id, created_at DESC);


--
-- Name: idx_stock_mov_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stock_mov_date ON public.stock_movements USING btree (movement_date);


--
-- Name: idx_stock_mov_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stock_mov_item ON public.stock_movements USING btree (item_id);


--
-- Name: idx_stock_mov_wh; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stock_mov_wh ON public.stock_movements USING btree (warehouse_id);


--
-- Name: idx_tenant_modules_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_modules_tenant ON public.tenant_modules USING btree (tenant_id);


--
-- Name: idx_tpc_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tpc_status ON public.treasury_period_closes USING btree (tenant_id, status);


--
-- Name: idx_tpc_tenant_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tpc_tenant_period ON public.treasury_period_closes USING btree (tenant_id, period DESC);


--
-- Name: idx_workflow_instances_rule; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_instances_rule ON public.workflow_instances USING btree (rule_id);


--
-- Name: idx_workflow_instances_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_instances_status ON public.workflow_instances USING btree (status);


--
-- Name: idx_workflow_instances_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_instances_tenant ON public.workflow_instances USING btree (tenant_id);


--
-- Name: idx_workflow_rules_module; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_rules_module ON public.workflow_rules USING btree (module);


--
-- Name: idx_workflow_rules_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_rules_tenant ON public.workflow_rules USING btree (tenant_id);


--
--


