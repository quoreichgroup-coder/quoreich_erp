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
-- Name: crm_contacts crm_contacts_set_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_contacts_set_updated BEFORE UPDATE ON public.crm_contacts FOR EACH ROW EXECUTE FUNCTION public.crm_set_updated_at();


--
-- Name: crm_opportunities crm_opportunities_audit_stage; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_opportunities_audit_stage AFTER UPDATE ON public.crm_opportunities FOR EACH ROW EXECUTE FUNCTION public.crm_audit_stage_change();


--
-- Name: crm_opportunities crm_opportunities_set_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_opportunities_set_updated BEFORE UPDATE ON public.crm_opportunities FOR EACH ROW EXECUTE FUNCTION public.crm_set_updated_at();


--
-- Name: stock_movements trg_apply_stock_mov; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_apply_stock_mov AFTER INSERT ON public.stock_movements FOR EACH ROW EXECUTE FUNCTION public.apply_stock_movement();


--
-- Name: delivery_notes trg_auto_invoice_on_delivery; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auto_invoice_on_delivery BEFORE INSERT OR UPDATE OF status ON public.delivery_notes FOR EACH ROW EXECUTE FUNCTION public.auto_invoice_on_delivery();


--
-- Name: bank_reconciliations trg_bank_recon_validated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bank_recon_validated BEFORE UPDATE ON public.bank_reconciliations FOR EACH ROW EXECUTE FUNCTION public.trg_bank_recon_validated();


--
-- Name: bank_statement_lines trg_bsl_match_sync; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bsl_match_sync BEFORE UPDATE ON public.bank_statement_lines FOR EACH ROW EXECUTE FUNCTION public.trg_bsl_match_sync();


--
-- Name: purchase_orders trg_commit_budget_on_po; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_commit_budget_on_po AFTER INSERT OR UPDATE ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION public.commit_budget_on_po();


--
-- Name: po_lines trg_compute_po_line_total; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_compute_po_line_total BEFORE INSERT OR UPDATE ON public.po_lines FOR EACH ROW EXECUTE FUNCTION public.compute_po_line_total();


--
-- Name: requisition_lines trg_compute_req_line_total; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_compute_req_line_total BEFORE INSERT OR UPDATE ON public.requisition_lines FOR EACH ROW EXECUTE FUNCTION public.compute_req_line_total();


--
-- Name: dn_lines trg_dn_line_total; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_dn_line_total BEFORE INSERT OR UPDATE ON public.dn_lines FOR EACH ROW EXECUTE FUNCTION public.compute_dn_line_total();


--
-- Name: delivery_notes trg_dn_period_lock; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_dn_period_lock BEFORE INSERT OR UPDATE ON public.delivery_notes FOR EACH ROW EXECUTE FUNCTION public.enforce_sales_period_lock();


--
-- Name: employees trg_employees_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_employees_updated_at BEFORE UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: journal_entries trg_enforce_balanced_entry; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_enforce_balanced_entry BEFORE INSERT OR UPDATE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.enforce_balanced_entry();


--
-- Name: journal_entries trg_enforce_period_lock; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_enforce_period_lock BEFORE INSERT OR UPDATE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock();


--
-- Name: goods_receipts trg_gr_completed; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_gr_completed AFTER INSERT OR UPDATE ON public.goods_receipts FOR EACH ROW EXECUTE FUNCTION public.on_gr_completed();


--
-- Name: payments trg_guard_ap_payment; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_guard_ap_payment BEFORE INSERT ON public.payments FOR EACH ROW EXECUTE FUNCTION public.guard_ap_payment();


--
-- Name: purchase_orders trg_guard_po_approval; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_guard_po_approval BEFORE INSERT OR UPDATE OF status ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION public.guard_po_approval();


--
-- Name: inventory_counts trg_inv_counts_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_inv_counts_touch BEFORE UPDATE ON public.inventory_counts FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: stock_movements trg_inv_period_lock; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_inv_period_lock BEFORE INSERT ON public.stock_movements FOR EACH ROW EXECUTE FUNCTION public.enforce_inventory_period_lock();


--
-- Name: inventory_settings trg_inv_settings_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_inv_settings_touch BEFORE UPDATE ON public.inventory_settings FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: item_locations trg_item_loc_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_item_loc_touch BEFORE UPDATE ON public.item_locations FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: journal_entries trg_journal_entry_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_journal_entry_audit AFTER INSERT OR UPDATE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.log_journal_entry_audit();


--
-- Name: journal_entries trg_log_journal_entry_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_log_journal_entry_audit AFTER INSERT OR UPDATE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.log_journal_entry_audit();


--
-- Name: ap_invoices trg_on_ap_invoice_posted; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_on_ap_invoice_posted BEFORE INSERT OR UPDATE ON public.ap_invoices FOR EACH ROW EXECUTE FUNCTION public.on_ap_invoice_posted();


--
-- Name: ar_invoices trg_on_ar_invoice_posted; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_on_ar_invoice_posted BEFORE INSERT OR UPDATE ON public.ar_invoices FOR EACH ROW EXECUTE FUNCTION public.on_ar_invoice_posted();


--
-- Name: goods_receipts trg_on_gr_completed; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_on_gr_completed AFTER INSERT OR UPDATE ON public.goods_receipts FOR EACH ROW EXECUTE FUNCTION public.on_gr_completed();


--
-- Name: payments trg_on_payment_recorded; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_on_payment_recorded AFTER INSERT ON public.payments FOR EACH ROW EXECUTE FUNCTION public.on_ap_payment_recorded();


--
-- Name: sales_orders trg_on_so_confirmed; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_on_so_confirmed AFTER INSERT OR UPDATE ON public.sales_orders FOR EACH ROW EXECUTE FUNCTION public.on_so_confirmed();


--
-- Name: payments trg_payment_gl; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_payment_gl AFTER INSERT ON public.payments FOR EACH ROW EXECUTE FUNCTION public.on_ap_payment_recorded();


--
-- Name: payments trg_payment_gl_posting; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_payment_gl_posting AFTER INSERT ON public.payments FOR EACH ROW EXECUTE FUNCTION public.on_ap_payment_recorded();


--
-- Name: payroll_runs trg_payroll_runs_lock; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_payroll_runs_lock BEFORE DELETE OR UPDATE ON public.payroll_runs FOR EACH ROW EXECUTE FUNCTION public.guard_payroll_run_lock();


--
-- Name: payroll_runs trg_payroll_runs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_payroll_runs_updated_at BEFORE UPDATE ON public.payroll_runs FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: purchase_requisitions trg_pr_converted; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_pr_converted BEFORE INSERT OR UPDATE OF po_id ON public.purchase_requisitions FOR EACH ROW EXECUTE FUNCTION public.on_pr_converted_to_po();


--
-- Name: journal_entries trg_protect_posted_entry; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_protect_posted_entry BEFORE DELETE OR UPDATE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.protect_posted_entry();


--
-- Name: journal_lines trg_protect_posted_lines; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_protect_posted_lines BEFORE DELETE OR UPDATE ON public.journal_lines FOR EACH ROW EXECUTE FUNCTION public.protect_posted_lines();


--
-- Name: quotations trg_quotations_period_lock; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_quotations_period_lock BEFORE INSERT OR UPDATE ON public.quotations FOR EACH ROW EXECUTE FUNCTION public.enforce_sales_period_lock();


--
-- Name: quote_lines trg_quote_line_total; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_quote_line_total BEFORE INSERT OR UPDATE ON public.quote_lines FOR EACH ROW EXECUTE FUNCTION public.compute_quote_line_total();


--
-- Name: quote_lines trg_quote_recompute; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_quote_recompute AFTER INSERT OR DELETE OR UPDATE ON public.quote_lines FOR EACH ROW EXECUTE FUNCTION public.recompute_quote_total();


--
-- Name: payments trg_recompute_ap_invoice; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_recompute_ap_invoice AFTER INSERT OR DELETE OR UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.recompute_ap_invoice_from_payment();


--
-- Name: payments trg_recompute_ar_invoice; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_recompute_ar_invoice AFTER INSERT OR DELETE OR UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.recompute_ar_invoice_from_payment();


--
-- Name: po_lines trg_recompute_po_total; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_recompute_po_total AFTER INSERT OR DELETE OR UPDATE ON public.po_lines FOR EACH ROW EXECUTE FUNCTION public.recompute_po_total();


--
-- Name: requisition_lines trg_recompute_pr_total; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_recompute_pr_total AFTER INSERT OR DELETE OR UPDATE ON public.requisition_lines FOR EACH ROW EXECUTE FUNCTION public.recompute_pr_total();


--
-- Name: tenants trg_seed_ar_defaults; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_seed_ar_defaults AFTER INSERT ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.seed_ar_defaults();


--
-- Name: tenants trg_seed_inv_defaults; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_seed_inv_defaults AFTER INSERT ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.seed_inventory_defaults();


--
-- Name: purchase_orders trg_seed_po_approvals; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_seed_po_approvals AFTER INSERT OR UPDATE OF status ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION public.seed_procurement_approval_queue();


--
-- Name: purchase_requisitions trg_seed_pr_approvals; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_seed_pr_approvals AFTER INSERT OR UPDATE OF status ON public.purchase_requisitions FOR EACH ROW EXECUTE FUNCTION public.seed_procurement_approval_queue();


--
-- Name: tenants trg_seed_procurement_defaults; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_seed_procurement_defaults AFTER INSERT ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.seed_procurement_defaults();


--
-- Name: tenants trg_seed_sales; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_seed_sales AFTER INSERT ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.seed_sales_defaults();


--
-- Name: sales_orders trg_so_credit_check; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_so_credit_check AFTER INSERT OR UPDATE OF status ON public.sales_orders FOR EACH ROW EXECUTE FUNCTION public.check_customer_credit_on_so();


--
-- Name: so_lines trg_so_line_total; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_so_line_total BEFORE INSERT OR UPDATE ON public.so_lines FOR EACH ROW EXECUTE FUNCTION public.compute_so_line_total();


--
-- Name: sales_orders trg_so_period_lock; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_so_period_lock BEFORE INSERT OR UPDATE ON public.sales_orders FOR EACH ROW EXECUTE FUNCTION public.enforce_sales_period_lock();


--
-- Name: so_lines trg_so_recompute; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_so_recompute AFTER INSERT OR DELETE OR UPDATE ON public.so_lines FOR EACH ROW EXECUTE FUNCTION public.recompute_so_total();


--
-- Name: stock_movements trg_stock_mov_je; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_stock_mov_je AFTER INSERT ON public.stock_movements FOR EACH ROW EXECUTE FUNCTION public.on_stock_movement_je();


--
-- Name: stock_movements trg_stock_mov_value; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_stock_mov_value BEFORE INSERT OR UPDATE ON public.stock_movements FOR EACH ROW EXECUTE FUNCTION public.compute_stock_movement_value();


--
-- Name: ai_analysis_schedules trg_touch_ai_schedules; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_touch_ai_schedules BEFORE UPDATE ON public.ai_analysis_schedules FOR EACH ROW EXECUTE FUNCTION public.touch_ai_schedules_updated_at();


--
-- Name: notification_preferences trg_touch_notification_prefs; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_touch_notification_prefs BEFORE UPDATE ON public.notification_preferences FOR EACH ROW EXECUTE FUNCTION public.touch_notification_preferences();


--
-- Name: ap_invoices trg_validate_ap_invoice; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_ap_invoice BEFORE INSERT OR UPDATE ON public.ap_invoices FOR EACH ROW EXECUTE FUNCTION public.validate_ap_invoice();


--
-- Name: ar_invoices trg_validate_ar_invoice; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_ar_invoice BEFORE INSERT OR UPDATE ON public.ar_invoices FOR EACH ROW EXECUTE FUNCTION public.validate_ar_invoice();


--
-- Name: warehouses trg_warehouses_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_warehouses_touch BEFORE UPDATE ON public.warehouses FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
--


