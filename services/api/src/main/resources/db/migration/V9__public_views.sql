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
-- Name: abc_analysis_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.abc_analysis_view WITH (security_invoker='on') AS
 WITH sales AS (
         SELECT dn.tenant_id,
            dnl.item_id,
            sum(dnl.total) AS revenue_12m
           FROM (public.dn_lines dnl
             JOIN public.delivery_notes dn ON ((dn.id = dnl.dn_id)))
          WHERE (dn.delivery_date >= (CURRENT_DATE - '1 year'::interval))
          GROUP BY dn.tenant_id, dnl.item_id
        ), ranked AS (
         SELECT s.tenant_id,
            s.item_id,
            s.revenue_12m,
            sum(s.revenue_12m) OVER (PARTITION BY s.tenant_id) AS total_rev,
            sum(s.revenue_12m) OVER (PARTITION BY s.tenant_id ORDER BY s.revenue_12m DESC) AS cum_rev
           FROM sales s
        )
 SELECT tenant_id,
    item_id,
    revenue_12m,
        CASE
            WHEN (cum_rev <= (total_rev * 0.8)) THEN 'A'::text
            WHEN (cum_rev <= (total_rev * 0.95)) THEN 'B'::text
            ELSE 'C'::text
        END AS abc_class
   FROM ranked;


--
-- Name: ap_aging_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.ap_aging_view WITH (security_invoker='true') AS
 SELECT i.tenant_id,
    i.id AS invoice_id,
    i.invoice_number,
    i.supplier_id,
    s.name AS supplier_name,
    i.invoice_date,
    i.due_date,
    i.total,
    i.amount_paid,
    GREATEST((i.total - i.amount_paid), (0)::numeric) AS outstanding,
    GREATEST((CURRENT_DATE - i.due_date), 0) AS days_overdue,
        CASE
            WHEN (i.due_date >= CURRENT_DATE) THEN 'current'::text
            WHEN ((CURRENT_DATE - i.due_date) <= 30) THEN '1-30'::text
            WHEN ((CURRENT_DATE - i.due_date) <= 60) THEN '31-60'::text
            WHEN ((CURRENT_DATE - i.due_date) <= 90) THEN '61-90'::text
            ELSE '90+'::text
        END AS bucket,
    i.status,
    i.approval_status
   FROM (public.ap_invoices i
     LEFT JOIN public.suppliers s ON ((s.id = i.supplier_id)))
  WHERE ((i.status <> 'paid'::text) AND (i.total > i.amount_paid));


--
-- Name: ar_aging_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.ar_aging_view WITH (security_invoker='true') AS
 SELECT i.tenant_id,
    i.id AS invoice_id,
    i.invoice_number,
    i.customer_id,
    c.name AS customer_name,
    i.invoice_date,
    i.due_date,
    i.total,
    i.amount_paid,
    GREATEST((i.total - i.amount_paid), (0)::numeric) AS outstanding,
    GREATEST((CURRENT_DATE - i.due_date), 0) AS days_overdue,
        CASE
            WHEN (i.due_date >= CURRENT_DATE) THEN 'current'::text
            WHEN ((CURRENT_DATE - i.due_date) <= 30) THEN '1-30'::text
            WHEN ((CURRENT_DATE - i.due_date) <= 60) THEN '31-60'::text
            WHEN ((CURRENT_DATE - i.due_date) <= 90) THEN '61-90'::text
            ELSE '90+'::text
        END AS bucket,
    i.status
   FROM (public.ar_invoices i
     LEFT JOIN public.customers c ON ((c.id = i.customer_id)))
  WHERE ((i.status <> 'paid'::text) AND (i.total > i.amount_paid));


--
-- Name: ar_credit_exposure_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.ar_credit_exposure_view WITH (security_invoker='true') AS
 SELECT c.tenant_id,
    c.id AS customer_id,
    c.name AS customer_name,
    COALESCE(c.credit_limit, (0)::numeric) AS credit_limit,
    COALESCE(sum(
        CASE
            WHEN (i.status <> ALL (ARRAY['paid'::text, 'cancelled'::text])) THEN (i.total - i.amount_paid)
            ELSE (0)::numeric
        END), (0)::numeric) AS outstanding,
    COALESCE(sum(
        CASE
            WHEN ((i.status <> ALL (ARRAY['paid'::text, 'cancelled'::text])) AND (i.due_date < CURRENT_DATE)) THEN (i.total - i.amount_paid)
            ELSE (0)::numeric
        END), (0)::numeric) AS overdue,
    COALESCE((round(avg(
        CASE
            WHEN (i.status <> ALL (ARRAY['paid'::text, 'cancelled'::text])) THEN (CURRENT_DATE - i.invoice_date)
            ELSE NULL::integer
        END)))::integer, 0) AS dso,
        CASE
            WHEN ((COALESCE(c.credit_limit, (0)::numeric) > (0)::numeric) AND (COALESCE(sum(
            CASE
                WHEN (i.status <> ALL (ARRAY['paid'::text, 'cancelled'::text])) THEN (i.total - i.amount_paid)
                ELSE (0)::numeric
            END), (0)::numeric) > c.credit_limit)) THEN 95
            WHEN (COALESCE(sum(
            CASE
                WHEN ((i.status <> ALL (ARRAY['paid'::text, 'cancelled'::text])) AND (i.due_date < (CURRENT_DATE - 60))) THEN 1
                ELSE 0
            END), (0)::bigint) > 0) THEN 80
            WHEN (COALESCE(sum(
            CASE
                WHEN ((i.status <> ALL (ARRAY['paid'::text, 'cancelled'::text])) AND (i.due_date < (CURRENT_DATE - 30))) THEN 1
                ELSE 0
            END), (0)::bigint) > 0) THEN 60
            WHEN (COALESCE(sum(
            CASE
                WHEN ((i.status <> ALL (ARRAY['paid'::text, 'cancelled'::text])) AND (i.due_date < CURRENT_DATE)) THEN 1
                ELSE 0
            END), (0)::bigint) > 0) THEN 40
            ELSE 15
        END AS risk_score
   FROM (public.customers c
     LEFT JOIN public.ar_invoices i ON ((i.customer_id = c.id)))
  GROUP BY c.tenant_id, c.id, c.name, c.credit_limit;


--
-- Name: asset_kpis_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.asset_kpis_view WITH (security_invoker='true') AS
 SELECT tenant_id,
    count(*) FILTER (WHERE (status = 'in_service'::text)) AS active_count,
    count(*) FILTER (WHERE (status = 'disposed'::text)) AS disposed_count,
    COALESCE(sum(acquisition_cost) FILTER (WHERE (status = 'in_service'::text)), (0)::numeric) AS gross_value,
    COALESCE(sum(accumulated_depreciation) FILTER (WHERE (status = 'in_service'::text)), (0)::numeric) AS accumulated,
    COALESCE(sum(net_book_value) FILTER (WHERE (status = 'in_service'::text)), (0)::numeric) AS net_book_value,
    COALESCE(( SELECT sum(d.amount) AS sum
           FROM (public.depreciation_entries d
             JOIN public.assets a2 ON ((a2.id = d.asset_id)))
          WHERE ((a2.tenant_id = assets.tenant_id) AND (d.period_date >= (date_trunc('year'::text, (CURRENT_DATE)::timestamp with time zone))::date))), (0)::numeric) AS depreciation_ytd
   FROM public.assets
  GROUP BY tenant_id;


--
-- Name: fixed_assets_register_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.fixed_assets_register_view WITH (security_invoker='true') AS
 SELECT a.tenant_id,
    a.id AS asset_id,
    a.asset_code,
    a.name,
    c.name AS category_name,
    a.acquisition_date,
    a.acquisition_cost,
    a.accumulated_depreciation,
    a.net_book_value,
    a.salvage_value,
    a.depreciation_method,
    a.useful_life_months,
    a.status,
    a.location,
    a.assigned_to
   FROM (public.assets a
     LEFT JOIN public.asset_categories c ON ((c.id = a.category_id)));


--
-- Name: gl_ledger_detail; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.gl_ledger_detail WITH (security_invoker='true') AS
 SELECT a.tenant_id,
    a.id AS account_id,
    a.code AS account_code,
    a.name AS account_name,
    e.id AS entry_id,
    e.entry_number,
    e.entry_date,
    e.description AS entry_description,
    e.source,
    l.id AS line_id,
    l.debit,
    l.credit,
    l.description AS line_description,
    sum((l.debit - l.credit)) OVER (PARTITION BY a.id ORDER BY e.entry_date, e.entry_number, l.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_balance
   FROM ((public.journal_lines l
     JOIN public.journal_entries e ON ((e.id = l.entry_id)))
     JOIN public.gl_accounts a ON ((a.id = l.account_id)))
  WHERE (e.status = 'posted'::text);


--
-- Name: gl_periods_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.gl_periods_view WITH (security_invoker='true') AS
 SELECT je.tenant_id,
    to_char((je.entry_date)::timestamp with time zone, 'YYYY-MM'::text) AS period,
    COALESCE(pl.status, 'open'::text) AS status,
    pl.closed_by,
    pl.closed_at,
    count(*) FILTER (WHERE (je.status = 'posted'::text)) AS posted_count,
    count(*) FILTER (WHERE (je.status = 'draft'::text)) AS draft_count,
    count(*) FILTER (WHERE (je.status = 'reversed'::text)) AS reversed_count,
    COALESCE(sum(jl.debit) FILTER (WHERE (je.status = 'posted'::text)), (0)::numeric) AS total_debit,
    COALESCE(sum(jl.credit) FILTER (WHERE (je.status = 'posted'::text)), (0)::numeric) AS total_credit
   FROM ((public.journal_entries je
     LEFT JOIN public.journal_lines jl ON ((jl.entry_id = je.id)))
     LEFT JOIN public.period_locks pl ON (((pl.tenant_id = je.tenant_id) AND (pl.module = 'GL'::text) AND (pl.period = to_char((je.entry_date)::timestamp with time zone, 'YYYY-MM'::text)))))
  GROUP BY je.tenant_id, (to_char((je.entry_date)::timestamp with time zone, 'YYYY-MM'::text)), pl.status, pl.closed_by, pl.closed_at;


--
-- Name: gl_sig_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.gl_sig_view WITH (security_invoker='true') AS
 WITH base AS (
         SELECT je.tenant_id,
            to_char((je.entry_date)::timestamp with time zone, 'YYYY-MM'::text) AS period,
            "left"(a.code, 2) AS class2,
            "left"(a.code, 1) AS class1,
            sum(jl.debit) AS dr,
            sum(jl.credit) AS cr
           FROM ((public.journal_entries je
             JOIN public.journal_lines jl ON ((jl.entry_id = je.id)))
             JOIN public.gl_accounts a ON ((a.id = jl.account_id)))
          WHERE (je.status = 'posted'::text)
          GROUP BY je.tenant_id, (to_char((je.entry_date)::timestamp with time zone, 'YYYY-MM'::text)), ("left"(a.code, 2)), ("left"(a.code, 1))
        ), agg AS (
         SELECT base.tenant_id,
            base.period,
            sum(
                CASE
                    WHEN (base.class2 = '70'::text) THEN (base.cr - base.dr)
                    ELSE (0)::numeric
                END) AS ventes,
            sum(
                CASE
                    WHEN (base.class2 = ANY (ARRAY['71'::text, '72'::text])) THEN (base.cr - base.dr)
                    ELSE (0)::numeric
                END) AS production_stockee,
            sum(
                CASE
                    WHEN (base.class2 = '60'::text) THEN (base.dr - base.cr)
                    ELSE (0)::numeric
                END) AS achats_consommes,
            sum(
                CASE
                    WHEN (base.class2 = ANY (ARRAY['61'::text, '62'::text])) THEN (base.dr - base.cr)
                    ELSE (0)::numeric
                END) AS services_ext,
            sum(
                CASE
                    WHEN (base.class2 = '63'::text) THEN (base.dr - base.cr)
                    ELSE (0)::numeric
                END) AS impots_taxes,
            sum(
                CASE
                    WHEN (base.class2 = '64'::text) THEN (base.dr - base.cr)
                    ELSE (0)::numeric
                END) AS charges_personnel,
            sum(
                CASE
                    WHEN (base.class2 = '68'::text) THEN (base.dr - base.cr)
                    ELSE (0)::numeric
                END) AS dotations,
            sum(
                CASE
                    WHEN (base.class2 = ANY (ARRAY['65'::text, '75'::text])) THEN
                    CASE
                        WHEN (base.class2 = '65'::text) THEN (base.dr - base.cr)
                        ELSE (- (base.cr - base.dr))
                    END
                    ELSE (0)::numeric
                END) AS autres_net,
            sum(
                CASE
                    WHEN (base.class2 = ANY (ARRAY['66'::text, '67'::text])) THEN (base.dr - base.cr)
                    ELSE (0)::numeric
                END) AS charges_fin_hao,
            sum(
                CASE
                    WHEN (base.class2 = ANY (ARRAY['77'::text, '78'::text])) THEN (base.cr - base.dr)
                    ELSE (0)::numeric
                END) AS produits_fin_reprises
           FROM base
          GROUP BY base.tenant_id, base.period
        )
 SELECT tenant_id,
    period,
    ventes,
    production_stockee,
    achats_consommes,
    services_ext,
    impots_taxes,
    charges_personnel,
    dotations,
    (ventes - achats_consommes) AS marge_commerciale,
    (ventes + production_stockee) AS chiffre_affaires,
    (((ventes + production_stockee) - achats_consommes) - services_ext) AS valeur_ajoutee,
    (((((ventes + production_stockee) - achats_consommes) - services_ext) - impots_taxes) - charges_personnel) AS ebe,
    (((((((ventes + production_stockee) - achats_consommes) - services_ext) - impots_taxes) - charges_personnel) - dotations) - autres_net) AS resultat_exploitation,
    (((((((((ventes + production_stockee) - achats_consommes) - services_ext) - impots_taxes) - charges_personnel) - dotations) - autres_net) - charges_fin_hao) + produits_fin_reprises) AS resultat_net
   FROM agg;


--
-- Name: gl_trial_balance; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.gl_trial_balance WITH (security_invoker='true') AS
 SELECT a.tenant_id,
    a.id AS account_id,
    a.code,
    a.name,
    a.account_type,
    COALESCE(sum(l.debit), (0)::numeric) AS total_debit,
    COALESCE(sum(l.credit), (0)::numeric) AS total_credit,
    COALESCE(sum((l.debit - l.credit)), (0)::numeric) AS balance
   FROM ((public.gl_accounts a
     LEFT JOIN public.journal_lines l ON ((l.account_id = a.id)))
     LEFT JOIN public.journal_entries e ON (((e.id = l.entry_id) AND (e.status = 'posted'::text))))
  GROUP BY a.tenant_id, a.id, a.code, a.name, a.account_type;


--
-- Name: inventory_abc_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.inventory_abc_view WITH (security_invoker='on') AS
 WITH outbound AS (
         SELECT sm.tenant_id,
            sm.item_id,
            sum((abs(sm.quantity) * COALESCE(sm.unit_cost, i.unit_cost, (0)::numeric))) AS revenue_12m,
            sum(abs(sm.quantity)) AS qty_12m
           FROM (public.stock_movements sm
             JOIN public.items i ON ((i.id = sm.item_id)))
          WHERE ((sm.movement_date >= (CURRENT_DATE - '1 year'::interval)) AND (sm.quantity < (0)::numeric) AND (sm.movement_type <> ALL (ARRAY['transfer_in'::text, 'transfer_out'::text, 'transfer'::text, 'adjust_in'::text, 'adjust_out'::text])))
          GROUP BY sm.tenant_id, sm.item_id
        ), ranked AS (
         SELECT o.tenant_id,
            o.item_id,
            o.revenue_12m,
            o.qty_12m,
            i.code,
            i.name,
            i.category,
            sum(o.revenue_12m) OVER (PARTITION BY o.tenant_id) AS total_rev,
            sum(o.revenue_12m) OVER (PARTITION BY o.tenant_id ORDER BY o.revenue_12m DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_rev
           FROM (outbound o
             JOIN public.items i ON ((i.id = o.item_id)))
        )
 SELECT tenant_id,
    item_id,
    code,
    name,
    category,
    revenue_12m,
    qty_12m,
        CASE
            WHEN (total_rev = (0)::numeric) THEN (0)::numeric
            ELSE round(((cum_rev / total_rev) * (100)::numeric), 2)
        END AS cum_pct,
        CASE
            WHEN (total_rev = (0)::numeric) THEN 'C'::text
            WHEN ((cum_rev / total_rev) <= 0.80) THEN 'A'::text
            WHEN ((cum_rev / total_rev) <= 0.95) THEN 'B'::text
            ELSE 'C'::text
        END AS abc_class
   FROM ranked;


--
-- Name: inventory_kpis_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.inventory_kpis_view WITH (security_invoker='on') AS
 SELECT tenant_id,
    count(*) FILTER (WHERE (status = 'active'::text)) AS active_items,
    count(*) FILTER (WHERE ((quantity_on_hand <= COALESCE(NULLIF(safety_stock, (0)::numeric), reorder_level, (0)::numeric)) AND (COALESCE(NULLIF(safety_stock, (0)::numeric), reorder_level, (0)::numeric) > (0)::numeric))) AS low_stock_items,
    count(*) FILTER (WHERE (quantity_on_hand <= (0)::numeric)) AS out_of_stock_items,
    round(COALESCE(sum((quantity_on_hand * average_cost)), (0)::numeric), 2) AS total_stock_value
   FROM public.items i
  GROUP BY tenant_id;


--
-- Name: inventory_slow_moving_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.inventory_slow_moving_view WITH (security_invoker='on') AS
 SELECT tenant_id,
    id AS item_id,
    code,
    name,
    category,
    quantity_on_hand,
    COALESCE(average_cost, unit_cost, (0)::numeric) AS unit_cost,
    (quantity_on_hand * COALESCE(average_cost, unit_cost, (0)::numeric)) AS stock_value,
    ( SELECT max(sm.movement_date) AS max
           FROM public.stock_movements sm
          WHERE ((sm.item_id = i.id) AND (sm.quantity < (0)::numeric) AND (sm.movement_type <> ALL (ARRAY['transfer_in'::text, 'transfer_out'::text, 'transfer'::text, 'adjust_in'::text, 'adjust_out'::text])))) AS last_outbound_date,
        CASE
            WHEN (( SELECT max(sm.movement_date) AS max
               FROM public.stock_movements sm
              WHERE ((sm.item_id = i.id) AND (sm.quantity < (0)::numeric))) IS NULL) THEN 'Dormant'::text
            WHEN (( SELECT max(sm.movement_date) AS max
               FROM public.stock_movements sm
              WHERE ((sm.item_id = i.id) AND (sm.quantity < (0)::numeric))) < (CURRENT_DATE - '180 days'::interval)) THEN 'Mort'::text
            WHEN (( SELECT max(sm.movement_date) AS max
               FROM public.stock_movements sm
              WHERE ((sm.item_id = i.id) AND (sm.quantity < (0)::numeric))) < (CURRENT_DATE - '90 days'::interval)) THEN 'Lent'::text
            ELSE 'Actif'::text
        END AS movement_class
   FROM public.items i
  WHERE ((quantity_on_hand > (0)::numeric) AND (status = 'active'::text));


--
-- Name: inventory_turnover_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.inventory_turnover_view WITH (security_invoker='on') AS
 WITH cogs AS (
         SELECT i.tenant_id,
            COALESCE(NULLIF(i.category, ''::text), 'Sans catégorie'::text) AS category,
            sum((abs(m.quantity) * COALESCE(m.unit_cost, i.average_cost, i.unit_cost, (0)::numeric))) AS cogs_12m
           FROM (public.stock_movements m
             JOIN public.items i ON ((i.id = m.item_id)))
          WHERE ((m.quantity < (0)::numeric) AND (m.movement_date >= (CURRENT_DATE - '365 days'::interval)) AND (m.movement_type <> ALL (ARRAY['transfer_in'::text, 'transfer_out'::text, 'transfer'::text])))
          GROUP BY i.tenant_id, COALESCE(NULLIF(i.category, ''::text), 'Sans catégorie'::text)
        ), inv AS (
         SELECT items.tenant_id,
            COALESCE(NULLIF(items.category, ''::text), 'Sans catégorie'::text) AS category,
            sum((items.quantity_on_hand * COALESCE(items.average_cost, items.unit_cost, (0)::numeric))) AS inv_value
           FROM public.items
          WHERE (items.status = 'active'::text)
          GROUP BY items.tenant_id, COALESCE(NULLIF(items.category, ''::text), 'Sans catégorie'::text)
        )
 SELECT inv.tenant_id,
    inv.category,
    inv.inv_value,
    COALESCE(c.cogs_12m, (0)::numeric) AS cogs_12m,
        CASE
            WHEN (inv.inv_value > (0)::numeric) THEN round((COALESCE(c.cogs_12m, (0)::numeric) / inv.inv_value), 2)
            ELSE (0)::numeric
        END AS turnover_ratio,
        CASE
            WHEN (COALESCE(c.cogs_12m, (0)::numeric) > (0)::numeric) THEN round(((365.0 * inv.inv_value) / c.cogs_12m), 0)
            ELSE NULL::numeric
        END AS days_on_hand
   FROM (inv
     LEFT JOIN cogs c ON (((c.tenant_id = inv.tenant_id) AND (c.category = inv.category))));


--
-- Name: inventory_valuation_by_category_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.inventory_valuation_by_category_view WITH (security_invoker='on') AS
 WITH fifo AS (
         SELECT i.tenant_id,
            COALESCE(NULLIF(i.category, ''::text), 'Sans catégorie'::text) AS category,
            sum((l.qty_remaining * l.cost_in)) AS fifo_value
           FROM (public.items i
             LEFT JOIN public.stock_valuation_layers l ON ((l.item_id = i.id)))
          GROUP BY i.tenant_id, COALESCE(NULLIF(i.category, ''::text), 'Sans catégorie'::text)
        ), avgc AS (
         SELECT i.tenant_id,
            COALESCE(NULLIF(i.category, ''::text), 'Sans catégorie'::text) AS category,
            count(*) AS items_count,
            sum(i.quantity_on_hand) AS total_qty,
            sum((i.quantity_on_hand * COALESCE(i.average_cost, i.unit_cost, (0)::numeric))) AS avg_cost_value
           FROM public.items i
          WHERE (i.status = 'active'::text)
          GROUP BY i.tenant_id, COALESCE(NULLIF(i.category, ''::text), 'Sans catégorie'::text)
        )
 SELECT a.tenant_id,
    a.category,
    a.items_count,
    a.total_qty,
    COALESCE(f.fifo_value, (0)::numeric) AS fifo_value,
    a.avg_cost_value,
    (COALESCE(f.fifo_value, (0)::numeric) - a.avg_cost_value) AS variance
   FROM (avgc a
     LEFT JOIN fifo f ON (((f.tenant_id = a.tenant_id) AND (f.category = a.category))));


--
-- Name: inventory_variance_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.inventory_variance_view WITH (security_invoker='on') AS
 SELECT c.id AS count_id,
    c.tenant_id,
    c.count_number,
    c.count_date,
    c.status,
    w.code AS warehouse_code,
    w.name AS warehouse_name,
    count(l.id) AS items_checked,
    count(*) FILTER (WHERE (COALESCE(l.variance, (0)::numeric) = (0)::numeric)) AS items_matched,
    count(*) FILTER (WHERE (COALESCE(l.variance, (0)::numeric) <> (0)::numeric)) AS items_variance,
    COALESCE(sum(l.variance_value), (0)::numeric) AS total_value_diff
   FROM ((public.inventory_counts c
     LEFT JOIN public.warehouses w ON ((w.id = c.warehouse_id)))
     LEFT JOIN public.inventory_count_lines l ON ((l.count_id = c.id)))
  GROUP BY c.id, c.tenant_id, c.count_number, c.count_date, c.status, w.code, w.name;


--
-- Name: low_stock_alerts_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.low_stock_alerts_view WITH (security_invoker='on') AS
 SELECT tenant_id,
    id AS item_id,
    code,
    name,
    unit,
    quantity_on_hand,
    COALESCE(NULLIF(safety_stock, (0)::numeric), reorder_level, (0)::numeric) AS threshold,
    (COALESCE(NULLIF(safety_stock, (0)::numeric), reorder_level, (0)::numeric) - quantity_on_hand) AS gap
   FROM public.items i
  WHERE ((COALESCE(NULLIF(safety_stock, (0)::numeric), reorder_level, (0)::numeric) > (0)::numeric) AND (quantity_on_hand <= COALESCE(NULLIF(safety_stock, (0)::numeric), reorder_level, (0)::numeric)));


--
-- Name: payroll_kpis_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.payroll_kpis_view WITH (security_invoker='true') AS
 SELECT tenant_id,
    to_char((CURRENT_DATE)::timestamp with time zone, 'YYYY'::text) AS fiscal_year,
    COALESCE(sum(gross_total) FILTER (WHERE ((period ~~ (to_char((CURRENT_DATE)::timestamp with time zone, 'YYYY'::text) || '%'::text)) AND (status = 'posted'::text))), (0)::numeric) AS gross_ytd,
    COALESCE(sum(net_total) FILTER (WHERE ((period ~~ (to_char((CURRENT_DATE)::timestamp with time zone, 'YYYY'::text) || '%'::text)) AND (status = 'posted'::text))), (0)::numeric) AS net_ytd,
    count(*) FILTER (WHERE (status = 'posted'::text)) AS posted_runs,
    count(*) FILTER (WHERE (status = 'draft'::text)) AS draft_runs,
    count(*) FILTER (WHERE (status = 'approved'::text)) AS approved_runs,
    ( SELECT count(*) AS count
           FROM public.employees e
          WHERE ((e.tenant_id = pr.tenant_id) AND (e.status = 'active'::text))) AS active_employees
   FROM public.payroll_runs pr
  GROUP BY tenant_id;


--
-- Name: payroll_register_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.payroll_register_view WITH (security_invoker='true') AS
 SELECT pl.tenant_id,
    pr.period,
    pr.pay_date,
    pr.status,
    e.matricule,
    e.first_name,
    e.last_name,
    e.department,
    e.job_title,
    pl.gross,
    pl.deductions,
    pl.taxes,
    pl.net
   FROM ((public.payroll_lines pl
     JOIN public.payroll_runs pr ON ((pr.id = pl.run_id)))
     JOIN public.employees e ON ((e.id = pl.employee_id)));


--
-- Name: po_three_way_match; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.po_three_way_match WITH (security_invoker='true') AS
 SELECT tenant_id,
    id AS po_id,
    po_number,
    status AS po_status,
    total AS po_total,
    COALESCE(( SELECT sum((grl.quantity_received * pl.unit_cost)) AS sum
           FROM ((public.goods_receipts gr
             JOIN public.gr_lines grl ON ((grl.gr_id = gr.id)))
             LEFT JOIN public.po_lines pl ON ((pl.id = grl.po_line_id)))
          WHERE ((gr.po_id = po.id) AND (gr.status = 'completed'::text))), (0)::numeric) AS gr_total,
    COALESCE(( SELECT sum(api.total) AS sum
           FROM public.ap_invoices api
          WHERE ((api.supplier_id = po.supplier_id) AND (api.invoice_date >= po.order_date) AND (api.invoice_date <= (po.order_date + '90 days'::interval)))), (0)::numeric) AS ap_total_window,
        CASE
            WHEN (total = (0)::numeric) THEN 'no_po'::text
            WHEN (abs((total - COALESCE(( SELECT sum((grl.quantity_received * pl.unit_cost)) AS sum
               FROM ((public.goods_receipts gr
                 JOIN public.gr_lines grl ON ((grl.gr_id = gr.id)))
                 LEFT JOIN public.po_lines pl ON ((pl.id = grl.po_line_id)))
              WHERE ((gr.po_id = po.id) AND (gr.status = 'completed'::text))), (0)::numeric))) < (1)::numeric) THEN 'matched'::text
            ELSE 'variance'::text
        END AS match_status
   FROM public.purchase_orders po;


--
-- Name: procurement_audit_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.procurement_audit_view WITH (security_invoker='true') AS
 SELECT a.id,
    a.tenant_id,
    COALESCE(a.decided_at, a.created_at) AS event_at,
        CASE a.status
            WHEN 'pending'::text THEN 'approval_assigned'::text
            WHEN 'approved'::text THEN 'approval_approved'::text
            WHEN 'rejected'::text THEN 'approval_rejected'::text
            WHEN 'skipped'::text THEN 'approval_skipped'::text
            ELSE NULL::text
        END AS event_type,
    a.doc_type,
    a.doc_id,
        CASE
            WHEN (a.doc_type = 'PR'::text) THEN pr.pr_number
            ELSE po.po_number
        END AS doc_number,
    a.level_label,
    a.amount,
    COALESCE((a.decided_by)::text, ''::text) AS actor_id,
    COALESCE(p.full_name, a.approver_role) AS actor_name,
    a.comment
   FROM (((public.procurement_approvals a
     LEFT JOIN public.purchase_requisitions pr ON (((pr.id = a.doc_id) AND (a.doc_type = 'PR'::text))))
     LEFT JOIN public.purchase_orders po ON (((po.id = a.doc_id) AND (a.doc_type = 'PO'::text))))
     LEFT JOIN public.profiles p ON ((p.id = a.decided_by)))
UNION ALL
 SELECT d.id,
    d.tenant_id,
    d.created_at AS event_at,
    ('match_'::text || d.decision) AS event_type,
    'PO'::text AS doc_type,
    d.po_id AS doc_id,
    po.po_number AS doc_number,
    '3-Way Match'::text AS level_label,
    po.total AS amount,
    COALESCE((d.decided_by)::text, ''::text) AS actor_id,
    COALESCE(p.full_name, '—'::text) AS actor_name,
    d.reason AS comment
   FROM ((public.procurement_match_decisions d
     JOIN public.purchase_orders po ON ((po.id = d.po_id)))
     LEFT JOIN public.profiles p ON ((p.id = d.decided_by)))
UNION ALL
 SELECT pr.id,
    pr.tenant_id,
    COALESCE(pr.approved_at, pr.created_at) AS event_at,
    'pr_converted_to_po'::text AS event_type,
    'PR'::text AS doc_type,
    pr.id AS doc_id,
    ((pr.pr_number || ' → '::text) || COALESCE(po.po_number, '?'::text)) AS doc_number,
    'Conversion'::text AS level_label,
    COALESCE(pr.estimated_total, (0)::numeric) AS amount,
    COALESCE((pr.approved_by)::text, ''::text) AS actor_id,
    COALESCE(p.full_name, '—'::text) AS actor_name,
    NULL::text AS comment
   FROM ((public.purchase_requisitions pr
     LEFT JOIN public.purchase_orders po ON ((po.id = pr.po_id)))
     LEFT JOIN public.profiles p ON ((p.id = pr.approved_by)))
  WHERE (pr.po_id IS NOT NULL);


--
-- Name: three_way_match_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.three_way_match_view WITH (security_invoker='true') AS
 WITH gr_agg AS (
         SELECT gr.po_id,
            gr.tenant_id,
            COALESCE(sum((grl.quantity_received * pol.unit_cost)), (0)::numeric) AS received_value,
            COALESCE(sum(grl.quantity_received), (0)::numeric) AS qty_received
           FROM ((public.goods_receipts gr
             JOIN public.gr_lines grl ON ((grl.gr_id = gr.id)))
             LEFT JOIN public.po_lines pol ON ((pol.id = grl.po_line_id)))
          WHERE (gr.status = 'completed'::text)
          GROUP BY gr.po_id, gr.tenant_id
        ), ap_agg AS (
         SELECT ap_invoices.po_id,
            ap_invoices.tenant_id,
            COALESCE(sum(ap_invoices.subtotal), (0)::numeric) AS invoiced_value,
            count(*) AS invoice_count
           FROM public.ap_invoices
          WHERE (ap_invoices.po_id IS NOT NULL)
          GROUP BY ap_invoices.po_id, ap_invoices.tenant_id
        )
 SELECT po.id AS po_id,
    po.tenant_id,
    po.po_number,
    po.order_date,
    po.status AS po_status,
    s.name AS supplier_name,
    po.total AS po_total,
    COALESCE(g.received_value, (0)::numeric) AS gr_value,
    COALESCE(g.qty_received, (0)::numeric) AS gr_qty,
    COALESCE(a.invoiced_value, (0)::numeric) AS ap_value,
    COALESCE(a.invoice_count, (0)::bigint) AS ap_invoice_count,
    (po.total - COALESCE(g.received_value, (0)::numeric)) AS po_vs_gr_diff,
    (COALESCE(g.received_value, (0)::numeric) - COALESCE(a.invoiced_value, (0)::numeric)) AS gr_vs_ap_diff,
        CASE
            WHEN ((COALESCE(g.received_value, (0)::numeric) = (0)::numeric) AND (COALESCE(a.invoiced_value, (0)::numeric) = (0)::numeric)) THEN 'pending'::text
            WHEN ((abs((po.total - COALESCE(g.received_value, (0)::numeric))) <= GREATEST(ps.three_way_tolerance_amount, ((po.total * ps.three_way_tolerance_pct) / (100)::numeric))) AND (abs((COALESCE(g.received_value, (0)::numeric) - COALESCE(a.invoiced_value, (0)::numeric))) <= GREATEST(ps.three_way_tolerance_amount, ((po.total * ps.three_way_tolerance_pct) / (100)::numeric)))) THEN 'matched'::text
            ELSE 'discrepancy'::text
        END AS match_status
   FROM ((((public.purchase_orders po
     LEFT JOIN public.suppliers s ON ((s.id = po.supplier_id)))
     LEFT JOIN gr_agg g ON ((g.po_id = po.id)))
     LEFT JOIN ap_agg a ON ((a.po_id = po.id)))
     LEFT JOIN public.procurement_settings ps ON ((ps.tenant_id = po.tenant_id)));


--
-- Name: procurement_kpis_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.procurement_kpis_view WITH (security_invoker='true') AS
 SELECT id AS tenant_id,
    ( SELECT count(*) AS count
           FROM public.purchase_requisitions
          WHERE ((purchase_requisitions.tenant_id = t.id) AND (purchase_requisitions.status = ANY (ARRAY['draft'::text, 'pending_approval'::text])))) AS pr_open,
    ( SELECT count(*) AS count
           FROM public.purchase_orders
          WHERE ((purchase_orders.tenant_id = t.id) AND (purchase_orders.status = ANY (ARRAY['draft'::text, 'pending_approval'::text])))) AS po_pending,
    ( SELECT count(*) AS count
           FROM public.goods_receipts
          WHERE ((goods_receipts.tenant_id = t.id) AND (goods_receipts.receipt_date = CURRENT_DATE))) AS gr_today,
    ( SELECT count(*) AS count
           FROM public.three_way_match_view
          WHERE ((three_way_match_view.tenant_id = t.id) AND (three_way_match_view.match_status = 'discrepancy'::text))) AS tw_discrepancies,
    ( SELECT COALESCE(sum(purchase_orders.total), (0)::numeric) AS "coalesce"
           FROM public.purchase_orders
          WHERE ((purchase_orders.tenant_id = t.id) AND (purchase_orders.status = 'approved'::text) AND (purchase_orders.order_date >= date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone)))) AS po_value_mtd
   FROM public.tenants t;


--
-- Name: procurement_sla_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.procurement_sla_view WITH (security_invoker='true') AS
 SELECT po.id AS po_id,
    po.tenant_id,
    po.po_number,
    pr.pr_number,
    pr.request_date AS pr_date,
    pr.approved_at AS pr_approved_at,
    po.order_date AS po_date,
    ( SELECT min(gr.receipt_date) AS min
           FROM public.goods_receipts gr
          WHERE ((gr.po_id = po.id) AND (gr.status = 'completed'::text))) AS gr_date,
    ( SELECT min(ap.invoice_date) AS min
           FROM public.ap_invoices ap
          WHERE (ap.po_id = po.id)) AS ap_date,
    (EXTRACT(epoch FROM (pr.approved_at - ((pr.request_date)::timestamp without time zone)::timestamp with time zone)) / (3600)::numeric) AS pr_cycle_hours,
    (EXTRACT(epoch FROM (((po.order_date)::timestamp without time zone)::timestamp with time zone - pr.approved_at)) / (3600)::numeric) AS pr_to_po_hours,
    (EXTRACT(epoch FROM ((( SELECT min(gr.receipt_date) AS min
           FROM public.goods_receipts gr
          WHERE ((gr.po_id = po.id) AND (gr.status = 'completed'::text))))::timestamp without time zone - (po.order_date)::timestamp without time zone)) / (24)::numeric) AS po_to_gr_days,
    (EXTRACT(epoch FROM ((( SELECT min(ap.invoice_date) AS min
           FROM public.ap_invoices ap
          WHERE (ap.po_id = po.id)))::timestamp without time zone - (( SELECT min(gr.receipt_date) AS min
           FROM public.goods_receipts gr
          WHERE ((gr.po_id = po.id) AND (gr.status = 'completed'::text))))::timestamp without time zone)) / (24)::numeric) AS gr_to_ap_days,
    po.status AS po_status,
    pr.status AS pr_status
   FROM (public.purchase_orders po
     LEFT JOIN public.purchase_requisitions pr ON ((pr.po_id = po.id)));


--
-- Name: sales_audit_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.sales_audit_view WITH (security_invoker='true') AS
 SELECT tenant_id,
    created_at,
    'role_change'::text AS event_type,
    action,
    (role)::text AS detail,
    performed_by AS actor,
    (target_user_id)::text AS target,
    comment
   FROM public.sales_role_audit;


--
-- Name: sales_cycle_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.sales_cycle_view WITH (security_invoker='true') AS
 SELECT so.tenant_id,
    q.id AS quote_id,
    q.quote_number,
    q.status AS quote_status,
    q.total AS quote_total,
    so.id AS so_id,
    so.so_number,
    so.status AS so_status,
    so.total AS so_total,
    so.customer_id,
    c.name AS customer_name,
    ari.id AS ar_invoice_id,
    ari.invoice_number,
    ari.total AS invoice_total,
    ari.status AS invoice_status
   FROM (((public.sales_orders so
     LEFT JOIN public.quotations q ON ((q.id = so.quotation_id)))
     LEFT JOIN public.customers c ON ((c.id = so.customer_id)))
     LEFT JOIN public.ar_invoices ari ON (((ari.customer_id = so.customer_id) AND (ari.invoice_date >= so.order_date) AND (ari.invoice_date <= (so.order_date + '30 days'::interval)))));


--
-- Name: sales_kpis_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.sales_kpis_view WITH (security_invoker='true') AS
 SELECT id AS tenant_id,
    ( SELECT COALESCE(sum(a.total), (0)::numeric) AS "coalesce"
           FROM public.ar_invoices a
          WHERE ((a.tenant_id = t.id) AND (a.invoice_date >= date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone)))) AS revenue_mtd,
    ( SELECT COALESCE(sum(s.total), (0)::numeric) AS "coalesce"
           FROM public.sales_orders s
          WHERE ((s.tenant_id = t.id) AND (s.status = ANY (ARRAY['confirmed'::text, 'partially_delivered'::text])))) AS backlog,
    ( SELECT count(*) AS count
           FROM public.quotations q
          WHERE ((q.tenant_id = t.id) AND (q.status = 'sent'::text))) AS open_quotes,
    ( SELECT count(*) AS count
           FROM public.sales_orders s
          WHERE ((s.tenant_id = t.id) AND (s.status = 'confirmed'::text))) AS open_sos
   FROM public.tenants t;


--
-- Name: sales_pipeline_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.sales_pipeline_view WITH (security_invoker='true') AS
 SELECT quotations.tenant_id,
    'quote'::text AS stage,
    count(*) AS docs,
    COALESCE(sum(quotations.total), (0)::numeric) AS amount
   FROM public.quotations
  WHERE (quotations.status <> ALL (ARRAY['converted'::text, 'rejected'::text, 'expired'::text]))
  GROUP BY quotations.tenant_id
UNION ALL
 SELECT sales_orders.tenant_id,
    'sales_order'::text AS stage,
    count(*) AS docs,
    COALESCE(sum(sales_orders.total), (0)::numeric) AS amount
   FROM public.sales_orders
  WHERE (sales_orders.status = ANY (ARRAY['draft'::text, 'confirmed'::text, 'partially_delivered'::text]))
  GROUP BY sales_orders.tenant_id
UNION ALL
 SELECT delivery_notes.tenant_id,
    'delivered'::text AS stage,
    count(*) AS docs,
    (0)::numeric AS amount
   FROM public.delivery_notes
  WHERE (delivery_notes.status = 'completed'::text)
  GROUP BY delivery_notes.tenant_id
UNION ALL
 SELECT ar_invoices.tenant_id,
    'invoiced'::text AS stage,
    count(*) AS docs,
    COALESCE(sum(ar_invoices.total), (0)::numeric) AS amount
   FROM public.ar_invoices
  WHERE (ar_invoices.so_id IS NOT NULL)
  GROUP BY ar_invoices.tenant_id;


--
-- Name: sales_sla_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.sales_sla_view WITH (security_invoker='true') AS
 SELECT s.tenant_id,
    s.id AS so_id,
    s.so_number,
    s.customer_id,
    s.order_date,
    q.quote_date,
    (EXTRACT(epoch FROM (s.created_at - q.created_at)) / (3600)::numeric) AS quote_to_so_hours,
    ( SELECT (min(dn.delivery_date) - s.order_date)
           FROM public.delivery_notes dn
          WHERE (dn.so_id = s.id)) AS so_to_dn_days,
    ( SELECT (min(ar.invoice_date) - min(dn.delivery_date))
           FROM (public.delivery_notes dn
             LEFT JOIN public.ar_invoices ar ON ((ar.dn_id = dn.id)))
          WHERE (dn.so_id = s.id)) AS dn_to_invoice_days,
    s.status
   FROM (public.sales_orders s
     LEFT JOIN public.quotations q ON ((q.id = s.quotation_id)));


--
-- Name: stock_aging_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.stock_aging_view WITH (security_invoker='on') AS
 SELECT tenant_id,
        CASE
            WHEN ((CURRENT_DATE - layer_date) <= 30) THEN '0-30 jours'::text
            WHEN ((CURRENT_DATE - layer_date) <= 60) THEN '31-60 jours'::text
            WHEN ((CURRENT_DATE - layer_date) <= 90) THEN '61-90 jours'::text
            ELSE '90+ jours'::text
        END AS age_bucket,
    sum((qty_remaining * cost_in)) AS stock_value,
    sum(qty_remaining) AS qty_remaining,
    count(DISTINCT item_id) AS items_count
   FROM public.stock_valuation_layers l
  WHERE (qty_remaining > (0)::numeric)
  GROUP BY tenant_id,
        CASE
            WHEN ((CURRENT_DATE - layer_date) <= 30) THEN '0-30 jours'::text
            WHEN ((CURRENT_DATE - layer_date) <= 60) THEN '31-60 jours'::text
            WHEN ((CURRENT_DATE - layer_date) <= 90) THEN '61-90 jours'::text
            ELSE '90+ jours'::text
        END;


--
-- Name: stock_movements_audit_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.stock_movements_audit_view WITH (security_invoker='on') AS
 SELECT sm.id,
    sm.tenant_id,
    sm.movement_date,
    sm.movement_type,
    sm.quantity,
    sm.unit_cost,
    sm.total_value,
    sm.reference_type,
    sm.reference_id,
    sm.warehouse_id,
    w.code AS warehouse_code,
    sm.item_id,
    i.code AS item_code,
    i.name AS item_name,
    sm.journal_entry_id,
    je.entry_number,
    sm.created_by,
    sm.created_at,
    sm.status
   FROM (((public.stock_movements sm
     LEFT JOIN public.items i ON ((i.id = sm.item_id)))
     LEFT JOIN public.warehouses w ON ((w.id = sm.warehouse_id)))
     LEFT JOIN public.journal_entries je ON ((je.id = sm.journal_entry_id)));


--
-- Name: stock_valuation_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.stock_valuation_view WITH (security_invoker='on') AS
 SELECT i.tenant_id,
    i.id AS item_id,
    i.code,
    i.name,
    i.unit,
    COALESCE(il.warehouse_id, i.default_warehouse_id) AS warehouse_id,
    w.code AS warehouse_code,
    w.name AS warehouse_name,
    COALESCE(il.quantity_on_hand, i.quantity_on_hand) AS quantity_on_hand,
    i.average_cost,
    round((COALESCE(il.quantity_on_hand, i.quantity_on_hand) * COALESCE(i.average_cost, (0)::numeric)), 2) AS stock_value
   FROM ((public.items i
     LEFT JOIN public.item_locations il ON ((il.item_id = i.id)))
     LEFT JOIN public.warehouses w ON ((w.id = COALESCE(il.warehouse_id, i.default_warehouse_id))));


--
-- Name: treasury_13w_forecast_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.treasury_13w_forecast_view WITH (security_invoker='on') AS
 WITH weeks AS (
         SELECT ((date_trunc('week'::text, (CURRENT_DATE)::timestamp with time zone))::date + (w_1.w * 7)) AS week_start,
            w_1.w AS week_index
           FROM generate_series(0, 12) w_1(w)
        ), ar AS (
         SELECT (date_trunc('week'::text, (i.due_date)::timestamp with time zone))::date AS week_start,
            i.tenant_id,
            sum((i.total - COALESCE(i.amount_paid, (0)::numeric))) AS amount
           FROM public.ar_invoices i
          WHERE ((i.status = ANY (ARRAY['open'::text, 'overdue'::text, 'sent'::text, 'partial'::text])) AND ((i.due_date >= CURRENT_DATE) AND (i.due_date <= (CURRENT_DATE + 91))))
          GROUP BY ((date_trunc('week'::text, (i.due_date)::timestamp with time zone))::date), i.tenant_id
        ), ap AS (
         SELECT (date_trunc('week'::text, (i.due_date)::timestamp with time zone))::date AS week_start,
            i.tenant_id,
            sum((i.total - COALESCE(i.amount_paid, (0)::numeric))) AS amount
           FROM public.ap_invoices i
          WHERE ((i.status = ANY (ARRAY['open'::text, 'overdue'::text, 'approved'::text, 'partial'::text])) AND ((i.due_date >= CURRENT_DATE) AND (i.due_date <= (CURRENT_DATE + 91))))
          GROUP BY ((date_trunc('week'::text, (i.due_date)::timestamp with time zone))::date), i.tenant_id
        ), manual_in AS (
         SELECT f.week_start,
            f.tenant_id,
            sum(f.amount_forecast) AS amount
           FROM public.cashflow_forecasts f
          WHERE (f.direction = 'inflow'::text)
          GROUP BY f.week_start, f.tenant_id
        ), manual_out AS (
         SELECT f.week_start,
            f.tenant_id,
            sum(f.amount_forecast) AS amount
           FROM public.cashflow_forecasts f
          WHERE (f.direction = 'outflow'::text)
          GROUP BY f.week_start, f.tenant_id
        ), tenants AS (
         SELECT DISTINCT bank_accounts.tenant_id
           FROM public.bank_accounts
        )
 SELECT t.tenant_id,
    w.week_start,
    w.week_index,
    COALESCE(ar.amount, (0)::numeric) AS inflow_ar,
    COALESCE(mi.amount, (0)::numeric) AS inflow_manual,
    COALESCE(ap.amount, (0)::numeric) AS outflow_ap,
    COALESCE(mo.amount, (0)::numeric) AS outflow_manual,
    ((COALESCE(ar.amount, (0)::numeric) + COALESCE(mi.amount, (0)::numeric)) - (COALESCE(ap.amount, (0)::numeric) + COALESCE(mo.amount, (0)::numeric))) AS net_flow
   FROM (((((tenants t
     CROSS JOIN weeks w)
     LEFT JOIN ar ON (((ar.week_start = w.week_start) AND (ar.tenant_id = t.tenant_id))))
     LEFT JOIN ap ON (((ap.week_start = w.week_start) AND (ap.tenant_id = t.tenant_id))))
     LEFT JOIN manual_in mi ON (((mi.week_start = w.week_start) AND (mi.tenant_id = t.tenant_id))))
     LEFT JOIN manual_out mo ON (((mo.week_start = w.week_start) AND (mo.tenant_id = t.tenant_id))));


--
-- Name: treasury_cash_position_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.treasury_cash_position_view AS
SELECT
    NULL::uuid AS tenant_id,
    NULL::uuid AS bank_account_id,
    NULL::text AS name,
    NULL::text AS bank_name,
    NULL::text AS currency,
    NULL::numeric AS current_balance,
    NULL::numeric AS net_7d,
    NULL::numeric AS net_30d,
    NULL::date AS last_reconciled_at;


--
-- Name: treasury_close_history_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.treasury_close_history_view WITH (security_invoker='on') AS
 SELECT c.id,
    c.tenant_id,
    c.period,
    c.status,
    c.attempt,
    c.total_balance,
    c.accounts_count,
    c.reconciliations_count,
    c.error_message,
    c.closed_by,
    c.closed_at,
    c.created_at,
    p.full_name AS closed_by_name
   FROM (public.treasury_period_closes c
     LEFT JOIN public.profiles p ON ((p.id = c.closed_by)));


--
-- Name: treasury_reconciliation_status_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.treasury_reconciliation_status_view AS
SELECT
    NULL::uuid AS tenant_id,
    NULL::uuid AS bank_account_id,
    NULL::text AS name,
    NULL::bigint AS unreconciled_count,
    NULL::bigint AS total_count,
    NULL::numeric AS reconciled_pct,
    NULL::integer AS oldest_unreconciled_days,
    NULL::date AS last_reconciled_at;


--
--


