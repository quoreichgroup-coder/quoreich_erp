-- V145 — façade réservée au rôle de service pour la fonction Edge de relance.
-- L'identité est validée par Supabase Auth dans la fonction avant tout appel RPC.
CREATE FUNCTION public.dunning_actor_tenant(_actor uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE _tenant uuid;
BEGIN
  IF _actor IS NULL OR public.has_permission(_actor,'ar.invoice') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Droit de consulter et envoyer les relances requis' USING ERRCODE='42501';
  END IF;
  _tenant := public.get_user_tenant_id(_actor);
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Société de l''utilisateur introuvable' USING ERRCODE='42501'; END IF;
  RETURN _tenant;
END $$;

CREATE FUNCTION public.ar_dunning_candidates_actor(_actor uuid)
RETURNS TABLE(invoice_id uuid, invoice_number text, customer_id uuid, customer_name text, recipient text,
  due_date date, balance numeric, currency text, days_overdue integer, rule_id uuid, rule_level integer,
  action text, subject text, message text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM public.dunning_actor_tenant(_actor);
  PERFORM set_config('request.jwt.claim.sub',_actor::text,true);
  RETURN QUERY SELECT * FROM public.ar_dunning_candidates();
END $$;

CREATE FUNCTION public.ar_dunning_history_actor(_actor uuid)
RETURNS SETOF public.ar_dunning_events
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE _tenant uuid := public.dunning_actor_tenant(_actor);
BEGIN
  RETURN QUERY SELECT e.* FROM public.ar_dunning_events e WHERE e.tenant_id=_tenant ORDER BY e.created_at DESC LIMIT 200;
END $$;

CREATE FUNCTION public.prepare_ar_dunning_event_actor(_actor uuid,_invoice_id uuid,_rule_id uuid)
RETURNS public.ar_dunning_events LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM public.dunning_actor_tenant(_actor);
  PERFORM set_config('request.jwt.claim.sub',_actor::text,true);
  RETURN public.prepare_ar_dunning_event(_invoice_id,_rule_id);
END $$;

CREATE FUNCTION public.claim_ar_dunning_event_actor(_actor uuid,_event_id uuid)
RETURNS public.ar_dunning_events LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM public.dunning_actor_tenant(_actor);
  PERFORM set_config('request.jwt.claim.sub',_actor::text,true);
  RETURN public.claim_ar_dunning_event(_event_id);
END $$;

CREATE FUNCTION public.finish_ar_dunning_event_actor(_actor uuid,_event_id uuid,_outcome text,_error text DEFAULT NULL)
RETURNS public.ar_dunning_events LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE _tenant uuid := public.dunning_actor_tenant(_actor);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ar_dunning_events e WHERE e.id=_event_id AND e.tenant_id=_tenant AND e.status='sending') THEN
    RAISE EXCEPTION 'Relance introuvable ou déjà finalisée' USING ERRCODE='42501';
  END IF;
  PERFORM set_config('request.jwt.claim.sub',_actor::text,true);
  RETURN public.finish_ar_dunning_event(_event_id,_outcome,_error);
END $$;

REVOKE ALL ON FUNCTION public.dunning_actor_tenant(uuid),public.ar_dunning_candidates_actor(uuid),
  public.ar_dunning_history_actor(uuid),public.prepare_ar_dunning_event_actor(uuid,uuid,uuid),
  public.claim_ar_dunning_event_actor(uuid,uuid),public.finish_ar_dunning_event_actor(uuid,uuid,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dunning_actor_tenant(uuid),public.ar_dunning_candidates_actor(uuid),
  public.ar_dunning_history_actor(uuid),public.prepare_ar_dunning_event_actor(uuid,uuid,uuid),
  public.claim_ar_dunning_event_actor(uuid,uuid),public.finish_ar_dunning_event_actor(uuid,uuid,text,text)
  TO service_role;
NOTIFY pgrst,'reload schema';
