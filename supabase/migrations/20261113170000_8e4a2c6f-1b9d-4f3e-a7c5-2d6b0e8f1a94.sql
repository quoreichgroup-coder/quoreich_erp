-- V29 — Conversion d'une opportunité en devis : le droit est celui du catalogue. Écrit à la main.
--
-- convert_opportunity_to_quote (V8, schéma de production) vérifiait le rôle dans user_roles,
-- table de transition, et n'acceptait que crm_manager et crm_admin. L'écran, lui, active le
-- bouton selon le droit crm.convert lu par my_access() (V27), que le catalogue accorde aussi à
-- admin et que peut accorder un rôle sur mesure de la matrice. Un administrateur voyait donc le
-- bouton « Convertir en devis » actif puis recevait « insufficient_role ».
--
-- Seule la vérification change : has_permission(auth.uid(), 'crm.convert'), comme les autres
-- droits du catalogue. Le reste du corps est celui de V8, inchangé. Ce changement retire aussi la
-- dernière LECTURE de user_roles par une fonction de contrôle.
--
-- Jumelle : services/api/src/main/resources/db/migration/V29__conversion_opportunite_droit_du_catalogue.sql

CREATE OR REPLACE FUNCTION public.convert_opportunity_to_quote(_opp_id uuid, _customer_id uuid DEFAULT NULL::uuid, _valid_until date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Droit du catalogue (V23), comme l'écran : admin, crm_admin, crm_manager et tout rôle sur
  -- mesure qui l'accorde. has_permission() lit la matrice dans la société de l'utilisateur.
  _is_manager := public.has_permission(auth.uid(), 'crm.convert');
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
$function$;
