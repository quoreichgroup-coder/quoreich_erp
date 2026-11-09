
ALTER TABLE public.crm_opportunities
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.customers(id),
  ADD COLUMN IF NOT EXISTS converted_quotation_id UUID REFERENCES public.quotations(id);

CREATE INDEX IF NOT EXISTS idx_crm_opp_customer ON public.crm_opportunities(customer_id);

CREATE OR REPLACE FUNCTION public.convert_opportunity_to_quote(
  _opp_id UUID,
  _customer_id UUID DEFAULT NULL,
  _valid_until DATE DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _opp public.crm_opportunities%ROWTYPE;
  _tenant UUID := public.get_user_tenant_id(auth.uid());
  _customer UUID;
  _quote_id UUID;
  _qnum TEXT;
  _is_manager BOOLEAN;
BEGIN
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'no_tenant';
  END IF;

  SELECT * INTO _opp FROM public.crm_opportunities WHERE id = _opp_id AND tenant_id = _tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'opportunity_not_found';
  END IF;

  -- Idempotent: already converted
  IF _opp.converted_quotation_id IS NOT NULL THEN
    RETURN _opp.converted_quotation_id;
  END IF;

  IF _opp.stage <> 'won' THEN
    RAISE EXCEPTION 'opportunity_not_won';
  END IF;

  -- RBAC: require crm_manager or crm_admin
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.tenant_id = _tenant
      AND ur.role IN ('crm_manager','crm_admin')
  ) INTO _is_manager;
  IF NOT _is_manager THEN
    RAISE EXCEPTION 'insufficient_role';
  END IF;

  _customer := COALESCE(_customer_id, _opp.customer_id);
  IF _customer IS NULL THEN
    RAISE EXCEPTION 'customer_required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = _customer AND tenant_id = _tenant) THEN
    RAISE EXCEPTION 'customer_invalid_tenant';
  END IF;

  _qnum := 'Q-' || to_char(now(), 'YYYYMM') || '-' || substr(replace(_opp_id::text, '-', ''), 1, 8);

  INSERT INTO public.quotations (tenant_id, quote_number, customer_id, quote_date, valid_until, total, status, created_by)
  VALUES (_tenant, _qnum, _customer, CURRENT_DATE, COALESCE(_valid_until, CURRENT_DATE + INTERVAL '30 days'), COALESCE(_opp.amount, 0), 'draft', auth.uid())
  RETURNING id INTO _quote_id;

  UPDATE public.crm_opportunities
    SET converted_quotation_id = _quote_id,
        customer_id = _customer,
        status = 'closed',
        updated_at = now()
    WHERE id = _opp_id;

  INSERT INTO public.crm_activities (tenant_id, opportunity_id, contact_id, type, subject, notes, created_by)
  VALUES (_tenant, _opp_id, _opp.contact_id, 'conversion',
          'Converti en devis ' || _qnum,
          'Quotation ' || _quote_id::text || ' · Montant ' || COALESCE(_opp.amount,0)::text || ' ' || _opp.currency,
          auth.uid());

  RETURN _quote_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.convert_opportunity_to_quote(UUID, UUID, DATE) TO authenticated;
