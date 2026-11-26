-- V142 — Relances clients manuelles par courriel, avec journal idempotent (G-32).
CREATE TABLE public.ar_dunning_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  invoice_id uuid NOT NULL REFERENCES public.ar_invoices(id),
  rule_id uuid NOT NULL REFERENCES public.ar_dunning_rules(id),
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  customer_name text NOT NULL,
  invoice_number text NOT NULL,
  recipient text NOT NULL,
  subject text NOT NULL,
  message text NOT NULL,
  balance numeric(18,2) NOT NULL CHECK (balance > 0),
  currency text NOT NULL,
  days_overdue integer NOT NULL CHECK (days_overdue >= 0),
  rule_level integer NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','uncertain','failed')),
  error_detail text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE (tenant_id, invoice_id, rule_id)
);
CREATE INDEX ar_dunning_events_tenant_created ON public.ar_dunning_events(tenant_id, created_at DESC);
ALTER TABLE public.ar_dunning_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY ar_dunning_events_read ON public.ar_dunning_events FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'ar.invoice'));
GRANT SELECT ON public.ar_dunning_events TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ar_dunning_events FROM authenticated;

CREATE FUNCTION public.guard_ar_dunning_event_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF (NEW.id, NEW.tenant_id, NEW.invoice_id, NEW.rule_id, NEW.customer_id, NEW.customer_name,
      NEW.invoice_number, NEW.recipient, NEW.subject, NEW.message, NEW.balance, NEW.currency,
      NEW.days_overdue, NEW.rule_level, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.tenant_id, OLD.invoice_id, OLD.rule_id, OLD.customer_id, OLD.customer_name,
      OLD.invoice_number, OLD.recipient, OLD.subject, OLD.message, OLD.balance, OLD.currency,
      OLD.days_overdue, OLD.rule_level, OLD.created_by, OLD.created_at)
     OR OLD.status NOT IN ('pending','sending') OR NEW.status NOT IN ('sending','sent','uncertain','failed')
     OR (OLD.status='pending' AND NEW.status NOT IN ('sending','failed'))
     OR (OLD.status='sending' AND NEW.status NOT IN ('sent','uncertain','failed')) THEN
    RAISE EXCEPTION 'Historique de relance immuable' USING ERRCODE = 'QG032';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_guard_ar_dunning_event_update BEFORE UPDATE ON public.ar_dunning_events
  FOR EACH ROW EXECUTE FUNCTION public.guard_ar_dunning_event_update();

CREATE FUNCTION public.ar_dunning_candidates()
RETURNS TABLE(invoice_id uuid, invoice_number text, customer_id uuid, customer_name text, recipient text,
  due_date date, balance numeric, currency text, days_overdue integer, rule_id uuid, rule_level integer,
  action text, subject text, message text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF _tenant IS NULL OR NOT public.has_permission(auth.uid(), 'ar.invoice') THEN
    RAISE EXCEPTION 'Droit de consulter les relances requis' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH eligible AS (
    SELECT i.id AS invoice_id, i.invoice_number, c.id AS customer_id, c.name AS customer_name,
      c.email AS recipient, i.due_date, (i.total-i.amount_paid)::numeric AS balance,
      COALESCE(i.currency,t.currency) AS currency, (CURRENT_DATE-i.due_date)::integer AS days_overdue,
      r.id AS rule_id, r.level AS rule_level, r.action, COALESCE(NULLIF(btrim(r.template),''),
        'Bonjour {{customer_name}}, la facture {{invoice_number}} arrivée à échéance le {{due_date}} présente un solde de {{balance}} {{currency}} depuis {{days_overdue}} jour(s). Merci de procéder à son règlement.') AS body,
      row_number() OVER (PARTITION BY i.id ORDER BY r.level) AS rn
    FROM public.ar_invoices i
    JOIN public.customers c ON c.id=i.customer_id AND c.tenant_id=i.tenant_id
    JOIN public.tenants t ON t.id=i.tenant_id
    JOIN public.ar_dunning_rules r ON r.tenant_id=i.tenant_id AND r.is_active AND r.days_overdue <= CURRENT_DATE-i.due_date
      AND (r.action ILIKE '%email%' OR r.action ILIKE '%e-mail%' OR r.action ILIKE '%courriel%')
    WHERE i.tenant_id=_tenant AND i.status IN ('sent','open','posted','partial','partially_paid','overdue')
      AND i.due_date <= CURRENT_DATE AND i.total-i.amount_paid > 0
      AND c.email IS NOT NULL AND btrim(c.email) <> ''
      AND NOT EXISTS (SELECT 1 FROM public.ar_dunning_events e WHERE e.tenant_id=i.tenant_id AND e.invoice_id=i.id AND e.rule_id=r.id)
  )
  SELECT e.invoice_id,e.invoice_number,e.customer_id,e.customer_name,e.recipient,e.due_date,e.balance,e.currency,
    e.days_overdue,e.rule_id,e.rule_level,e.action,
    ('Relance client - niveau '||e.rule_level)::text,
    replace(replace(replace(replace(replace(replace(replace(e.body,
      '{{customer_name}}',e.customer_name), '{{invoice_number}}',e.invoice_number), '{{due_date}}',to_char(e.due_date,'DD/MM/YYYY')),
      '{{balance}}',to_char(e.balance,'FM999999999999990D00')), '{{currency}}',e.currency),
      '{{days_overdue}}',e.days_overdue::text), '{{company_name}}', (SELECT name FROM public.tenants WHERE id=_tenant))
  FROM eligible e WHERE e.rn=1 ORDER BY e.due_date, e.invoice_number;
END $$;

CREATE FUNCTION public.prepare_ar_dunning_event(_invoice_id uuid, _rule_id uuid)
RETURNS public.ar_dunning_events
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid()); _c record; _event public.ar_dunning_events;
BEGIN
  IF _tenant IS NULL OR NOT public.has_permission(auth.uid(), 'ar.invoice') THEN
    RAISE EXCEPTION 'Droit d’envoyer les relances requis' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _event FROM public.ar_dunning_events WHERE tenant_id=_tenant AND invoice_id=_invoice_id AND rule_id=_rule_id;
  IF FOUND THEN RETURN _event; END IF;
  SELECT * INTO _c FROM public.ar_dunning_candidates() c WHERE c.invoice_id=_invoice_id AND c.rule_id=_rule_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cette relance n’est plus éligible' USING ERRCODE = 'QG032'; END IF;
  INSERT INTO public.ar_dunning_events(tenant_id,invoice_id,rule_id,customer_id,customer_name,invoice_number,recipient,
      subject,message,balance,currency,days_overdue,rule_level,status,created_by)
    VALUES (_tenant,_c.invoice_id,_c.rule_id,_c.customer_id,_c.customer_name,_c.invoice_number,_c.recipient,
      _c.subject,_c.message,_c.balance,_c.currency,_c.days_overdue,_c.rule_level,'pending',auth.uid())
    ON CONFLICT (tenant_id,invoice_id,rule_id) DO NOTHING;
  SELECT * INTO _event FROM public.ar_dunning_events WHERE tenant_id=_tenant AND invoice_id=_invoice_id AND rule_id=_rule_id;
  RETURN _event;
END $$;

CREATE FUNCTION public.claim_ar_dunning_event(_event_id uuid)
RETURNS public.ar_dunning_events
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _event public.ar_dunning_events;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ar_dunning_events e WHERE e.id=_event_id AND e.tenant_id=public.get_user_tenant_id(auth.uid()))
     OR (auth.uid() IS NOT NULL AND NOT public.has_permission(auth.uid(), 'ar.invoice')) THEN
    RAISE EXCEPTION 'Relance introuvable ou non autorisée' USING ERRCODE='42501';
  END IF;
  UPDATE public.ar_dunning_events SET status='sending' WHERE id=_event_id AND status='pending' RETURNING * INTO _event;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN _event;
END $$;

CREATE FUNCTION public.finish_ar_dunning_event(_event_id uuid, _outcome text, _error text DEFAULT NULL)
RETURNS public.ar_dunning_events
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _event public.ar_dunning_events;
BEGIN
  IF _outcome NOT IN ('sent','uncertain','failed') THEN RAISE EXCEPTION 'Résultat SMTP invalide' USING ERRCODE='QG032'; END IF;
  UPDATE public.ar_dunning_events SET status=_outcome,
      error_detail=CASE WHEN _outcome IN ('uncertain','failed') THEN left(regexp_replace(coalesce(_error,'Échec du traitement de la relance'), '[[:cntrl:]]', ' ', 'g'), 400) ELSE NULL END,
      sent_at=CASE WHEN _outcome='sent' THEN now() ELSE NULL END
    WHERE id=_event_id AND status='sending' RETURNING * INTO _event;
  IF NOT FOUND THEN RAISE EXCEPTION 'Relance introuvable ou déjà finalisée' USING ERRCODE='QG032'; END IF;
  RETURN _event;
END $$;

REVOKE ALL ON FUNCTION public.ar_dunning_candidates() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prepare_ar_dunning_event(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_ar_dunning_event(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_ar_dunning_event(uuid,text,text) FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='qerp_api') THEN
    GRANT EXECUTE ON FUNCTION public.ar_dunning_candidates() TO qerp_api;
    GRANT EXECUTE ON FUNCTION public.prepare_ar_dunning_event(uuid,uuid) TO qerp_api;
    GRANT EXECUTE ON FUNCTION public.claim_ar_dunning_event(uuid) TO qerp_api;
    GRANT EXECUTE ON FUNCTION public.finish_ar_dunning_event(uuid,text,text) TO qerp_api;
    GRANT SELECT ON public.ar_dunning_events TO qerp_api;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    GRANT EXECUTE ON FUNCTION public.ar_dunning_candidates() TO service_role;
    GRANT EXECUTE ON FUNCTION public.prepare_ar_dunning_event(uuid,uuid) TO service_role;
    GRANT EXECUTE ON FUNCTION public.claim_ar_dunning_event(uuid) TO service_role;
    GRANT EXECUTE ON FUNCTION public.finish_ar_dunning_event(uuid,text,text) TO service_role;
    GRANT SELECT ON public.ar_dunning_events TO service_role;
  END IF;
END $$;

SELECT public.install_tenant_isolation_triggers();
