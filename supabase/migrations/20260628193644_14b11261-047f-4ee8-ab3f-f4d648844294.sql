
CREATE OR REPLACE FUNCTION public.convert_quote_to_so(_quote_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  _q public.quotations%ROWTYPE;
  _so_id uuid;
  _so_number text;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'no_tenant'; END IF;
  IF NOT public.has_sales_perm(auth.uid(),'confirm') THEN RAISE EXCEPTION 'insufficient_role'; END IF;

  SELECT * INTO _q FROM public.quotations WHERE id=_quote_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'quote_not_found'; END IF;
  IF _q.tenant_id<>_tenant THEN RAISE EXCEPTION 'tenant_mismatch'; END IF;

  -- Idempotent: return existing SO if quote already linked
  SELECT id INTO _so_id FROM public.sales_orders WHERE quotation_id=_quote_id LIMIT 1;
  IF _so_id IS NOT NULL THEN RETURN _so_id; END IF;

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
  RETURN _so_id;
END $$;

REVOKE ALL ON FUNCTION public.convert_quote_to_so(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.convert_quote_to_so(uuid) TO authenticated;
