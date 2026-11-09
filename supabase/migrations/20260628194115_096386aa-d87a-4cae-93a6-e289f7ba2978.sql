
CREATE OR REPLACE FUNCTION public.convert_quote_to_so(_quote_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _q public.quotations%ROWTYPE;
  _so_id uuid;
  _so_number text;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _opp_id uuid;
  _already boolean := false;
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'no_tenant'; END IF;
  IF NOT public.has_sales_perm(auth.uid(),'confirm') THEN RAISE EXCEPTION 'insufficient_role'; END IF;

  SELECT * INTO _q FROM public.quotations WHERE id=_quote_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'quote_not_found'; END IF;
  IF _q.tenant_id<>_tenant THEN RAISE EXCEPTION 'tenant_mismatch'; END IF;

  SELECT id INTO _so_id FROM public.sales_orders WHERE quotation_id=_quote_id LIMIT 1;
  IF _so_id IS NOT NULL THEN
    _already := true;
  ELSE
    IF _q.status NOT IN ('accepted','sent','draft') THEN
      RAISE EXCEPTION 'quote_status_invalid';
    END IF;
    _so_number := 'SO-'||to_char(now(),'YYYYMM')||'-'||substr(replace(_quote_id::text,'-',''),1,8);
    INSERT INTO public.sales_orders(tenant_id, so_number, quotation_id, customer_id, order_date, total, status, created_by)
    VALUES (_tenant, _so_number, _q.id, _q.customer_id, CURRENT_DATE, COALESCE(_q.total,0), 'draft', auth.uid())
    RETURNING id INTO _so_id;
    INSERT INTO public.so_lines(so_id, item_id, description, quantity, unit_price, total)
    SELECT _so_id, ql.item_id, ql.description, ql.quantity, ql.unit_price, ql.total
      FROM public.quote_lines ql WHERE ql.quotation_id=_quote_id;
    UPDATE public.quotations SET status='converted' WHERE id=_quote_id;
  END IF;

  SELECT id INTO _opp_id FROM public.crm_opportunities WHERE converted_quotation_id=_quote_id LIMIT 1;
  IF _opp_id IS NOT NULL AND NOT _already THEN
    INSERT INTO public.crm_activities(tenant_id, opportunity_id, type, subject, notes, created_by, completed_at)
    VALUES (_tenant, _opp_id, 'so_conversion',
            'Devis converti en bon de commande',
            'quote_id='||_quote_id::text||' so_id='||_so_id::text,
            auth.uid(), now());
  END IF;

  RETURN _so_id;
END $function$;

CREATE OR REPLACE FUNCTION public.log_crm_export(
  _opportunity_id uuid,
  _format text,
  _kind text,
  _record_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'no_tenant'; END IF;
  INSERT INTO public.crm_activities(tenant_id, opportunity_id, type, subject, notes, created_by, completed_at)
  VALUES (_tenant, _opportunity_id, 'export',
          'Export '||upper(_format)||' — '||_kind,
          CASE WHEN _record_id IS NOT NULL THEN 'record_id='||_record_id::text ELSE NULL END,
          auth.uid(), now());
END $$;

GRANT EXECUTE ON FUNCTION public.log_crm_export(uuid, text, text, uuid) TO authenticated;
