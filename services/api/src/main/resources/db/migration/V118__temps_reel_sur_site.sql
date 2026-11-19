-- V118 — Temps réel sur site.
--
-- Dans le nuage, Supabase Realtime diffuse les changements des tables suivies (publication supabase_realtime,
-- scripts/schema/supabase-platform.sql). Sur site, chaque changement d'une de ces tables émet une notification
-- PostgreSQL (canal qerp_changes, charge {"t": table, "s": société}) que l'API relaie par WebSocket aux seuls
-- navigateurs connectés à cette société. La notification ne porte aucune donnée : l'écran relit ce qui le
-- concerne, sous la RLS. PostgreSQL fusionne les notifications identiques d'une même transaction : une pièce de
-- cent lignes ne produit qu'un message par table. Dans le nuage, personne n'écoute le canal (coût négligeable).

CREATE FUNCTION public.realtime_notify_change()
RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  _tenant uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    _tenant := OLD.tenant_id;
  ELSE
    _tenant := NEW.tenant_id;
  END IF;
  IF _tenant IS NOT NULL THEN
    PERFORM pg_catalog.pg_notify('qerp_changes', pg_catalog.json_build_object('t', TG_TABLE_NAME, 's', _tenant)::text);
  END IF;
  RETURN NULL;
END;
$$;

DO $$
DECLARE
  _t text;
BEGIN
  FOREACH _t IN ARRAY ARRAY['ar_invoices', 'ap_invoices', 'payments', 'journal_entries', 'bank_accounts', 'bank_transactions',
    'bank_statements', 'bank_statement_lines', 'bank_reconciliations', 'cashflow_forecasts', 'treasury_role_audit', 'quotations',
    'sales_orders', 'delivery_notes', 'sales_role_audit', 'erp_alerts', 'ai_analysis_history'] LOOP
    EXECUTE format('CREATE TRIGGER trg_zz_realtime_notify AFTER INSERT OR UPDATE OR DELETE ON public.%I '
                   'FOR EACH ROW EXECUTE FUNCTION public.realtime_notify_change()', _t);
  END LOOP;
END;
$$;
