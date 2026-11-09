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
-- Name: treasury_cash_position_view _RETURN; Type: RULE; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.treasury_cash_position_view WITH (security_invoker='on') AS
 SELECT a.tenant_id,
    a.id AS bank_account_id,
    a.name,
    a.bank_name,
    a.currency,
    a.balance AS current_balance,
    COALESCE(sum(
        CASE
            WHEN (t.transaction_date >= (CURRENT_DATE - 7)) THEN t.amount
            ELSE NULL::numeric
        END), (0)::numeric) AS net_7d,
    COALESCE(sum(
        CASE
            WHEN (t.transaction_date >= (CURRENT_DATE - 30)) THEN t.amount
            ELSE NULL::numeric
        END), (0)::numeric) AS net_30d,
    a.last_reconciled_at
   FROM (public.bank_accounts a
     LEFT JOIN public.bank_transactions t ON ((t.bank_account_id = a.id)))
  WHERE (a.is_active = true)
  GROUP BY a.id;


--
-- Name: treasury_reconciliation_status_view _RETURN; Type: RULE; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.treasury_reconciliation_status_view WITH (security_invoker='on') AS
 SELECT a.tenant_id,
    a.id AS bank_account_id,
    a.name,
    count(t.id) FILTER (WHERE (t.is_reconciled = false)) AS unreconciled_count,
    count(t.id) AS total_count,
        CASE
            WHEN (count(t.id) > 0) THEN round(((100.0 * (count(t.id) FILTER (WHERE t.is_reconciled))::numeric) / (count(t.id))::numeric), 1)
            ELSE (100)::numeric
        END AS reconciled_pct,
    max(
        CASE
            WHEN (t.is_reconciled = false) THEN (CURRENT_DATE - t.transaction_date)
            ELSE NULL::integer
        END) AS oldest_unreconciled_days,
    a.last_reconciled_at
   FROM (public.bank_accounts a
     LEFT JOIN public.bank_transactions t ON ((t.bank_account_id = a.id)))
  GROUP BY a.id;


--
--


