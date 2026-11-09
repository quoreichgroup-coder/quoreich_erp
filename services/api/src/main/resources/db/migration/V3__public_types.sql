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
-- Name: app_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.app_role AS ENUM (
    'admin',
    'manager',
    'accountant',
    'viewer',
    'procurement_l1',
    'procurement_l2',
    'procurement_l3',
    'procurement_controller',
    'procurement_3wm_approver',
    'sales_rep',
    'sales_manager',
    'sales_controller',
    'inventory_clerk',
    'inventory_manager',
    'inventory_controller',
    'treasury_clerk',
    'treasury_manager',
    'treasury_controller',
    'cash_admin',
    'asset_clerk',
    'asset_accountant',
    'asset_controller',
    'asset_admin',
    'budget_planner',
    'budget_approver',
    'budget_controller',
    'budget_admin',
    'project_planner',
    'project_accountant',
    'project_controller',
    'project_admin',
    'expense_clerk',
    'expense_approver',
    'expense_controller',
    'expense_admin',
    'compliance_officer',
    'compliance_auditor',
    'compliance_admin',
    'risk_owner',
    'risk_assessor',
    'risk_admin',
    'hr_clerk',
    'hr_approver',
    'payroll_officer',
    'hr_auditor',
    'hr_admin',
    'crm_agent',
    'crm_manager',
    'crm_admin',
    'crm_auditor'
);


--
--


