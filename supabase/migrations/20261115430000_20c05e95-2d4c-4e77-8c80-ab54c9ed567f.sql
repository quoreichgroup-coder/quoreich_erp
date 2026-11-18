-- S3: operational catalogue, document references, and atomic bulk count entry.
ALTER TABLE public.inventory_settings
  ADD COLUMN default_warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE SET NULL,
  ADD COLUMN campaign_item_scope text NOT NULL DEFAULT 'warehouse'
    CHECK (campaign_item_scope IN ('warehouse','assigned','all_active')),
  ADD COLUMN campaign_document_prefix text,
  ADD COLUMN campaign_document_width integer,
  ADD CONSTRAINT inventory_campaign_document_series_valid CHECK (
    (campaign_document_prefix IS NULL AND campaign_document_width IS NULL)
    OR (campaign_document_prefix IS NOT NULL AND campaign_document_width IS NOT NULL
        AND campaign_document_prefix ~ '^[A-Z0-9][A-Z0-9_-]{0,14}$'
        AND campaign_document_width BETWEEN 1 AND 10));

CREATE UNIQUE INDEX inventory_campaign_document_reference ON public.inventory_campaigns(tenant_id,reference)
  WHERE reference IS NOT NULL;
CREATE INDEX inventory_campaign_catalog_order ON public.inventory_campaigns(tenant_id,opened_at DESC,id DESC);
CREATE UNIQUE INDEX inventory_campaign_single_movement_per_item
  ON public.stock_movements(tenant_id,reference_id,item_id) WHERE reference_type = 'inventory_count_campaign';

CREATE FUNCTION public.inventory_campaign_numbering(_action text,_prefix text DEFAULT NULL,
  _width integer DEFAULT NULL,_next integer DEFAULT NULL,_expected_tenant uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _actor uuid := auth.uid();
  _tenant uuid := public.get_user_tenant_id(_actor);
  _settings public.inventory_settings%ROWTYPE;
  _current integer;
  _normalized text := upper(btrim(_prefix));
BEGIN
  IF _actor IS NULL OR _tenant IS NULL OR (_expected_tenant IS NOT NULL AND _expected_tenant <> _tenant)
     OR public.has_permission(_actor,'inventory.settings') IS NOT TRUE THEN
    RAISE EXCEPTION 'Numérotation des inventaires non autorisée' USING ERRCODE = '42501';
  END IF;
  IF _action = 'save' THEN
    IF _normalized IS NULL OR _normalized !~ '^[A-Z0-9][A-Z0-9_-]{0,14}$'
       OR _width IS NULL OR _width NOT BETWEEN 1 AND 10 OR _next IS NULL OR _next NOT BETWEEN 1 AND 2147483646 THEN
      RAISE EXCEPTION 'Préfixe, longueur de séquence et prochain numéro invalides' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.inventory_settings(tenant_id,campaign_document_prefix,campaign_document_width)
    VALUES (_tenant,_normalized,_width)
    ON CONFLICT(tenant_id) DO UPDATE SET campaign_document_prefix = EXCLUDED.campaign_document_prefix,
      campaign_document_width = EXCLUDED.campaign_document_width,updated_at = now()
    RETURNING * INTO _settings;
    INSERT INTO public.document_counters(tenant_id,doc_type,period,next_number)
    VALUES (_tenant,'inventory_campaign','ALL',_next)
    ON CONFLICT(tenant_id,doc_type,period) DO UPDATE SET next_number = EXCLUDED.next_number
    WHERE public.document_counters.next_number <= EXCLUDED.next_number RETURNING next_number INTO _current;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Le prochain numéro ne peut pas revenir en arrière' USING ERRCODE = '22023';
    END IF;
  ELSIF _action = 'read' THEN
    SELECT s.* INTO _settings FROM public.inventory_settings s WHERE s.tenant_id = _tenant;
    SELECT c.next_number INTO _current FROM public.document_counters c
    WHERE c.tenant_id = _tenant AND c.doc_type = 'inventory_campaign' AND c.period = 'ALL';
  ELSE RAISE EXCEPTION 'Action de numérotation inconnue' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('prefix',_settings.campaign_document_prefix,'width',_settings.campaign_document_width,'next',_current);
END;
$$;
REVOKE ALL ON FUNCTION public.inventory_campaign_numbering(text,text,integer,integer,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_campaign_numbering(text,text,integer,integer,uuid) TO authenticated;

CREATE FUNCTION public.inventory_campaign_assign_reference() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  _prefix text;
  _width integer;
  _issued integer;
  _scope text;
BEGIN
  SELECT s.campaign_document_prefix,s.campaign_document_width,s.campaign_item_scope INTO _prefix,_width,_scope
    FROM public.inventory_settings s WHERE s.tenant_id = NEW.tenant_id FOR UPDATE;
  NEW.item_scope := coalesce(_scope,'warehouse');
  IF _prefix IS NULL THEN
    NEW.reference := NULL;
    RETURN NEW;
  END IF;
  UPDATE public.document_counters c SET next_number = c.next_number + 1
  WHERE c.tenant_id = NEW.tenant_id AND c.doc_type = 'inventory_campaign' AND c.period = 'ALL'
    AND c.next_number < 2147483647 RETURNING c.next_number - 1 INTO _issued;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La séquence des inventaires est absente ou épuisée' USING ERRCODE = '55000';
  END IF;
  NEW.reference := _prefix || lpad(_issued::text,greatest(_width,length(_issued::text)),'0');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.inventory_campaign_assign_reference() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER inventory_campaign_assign_reference
  BEFORE INSERT ON public.inventory_campaigns FOR EACH ROW EXECUTE FUNCTION public.inventory_campaign_assign_reference();

CREATE FUNCTION public.inventory_campaign_keep_reference() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.reference IS DISTINCT FROM OLD.reference OR NEW.item_scope IS DISTINCT FROM OLD.item_scope THEN
    RAISE EXCEPTION 'La référence et le périmètre d’une campagne ouverte ne peuvent pas être modifiés' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.inventory_campaign_keep_reference() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER inventory_campaign_keep_reference BEFORE UPDATE OF reference,item_scope ON public.inventory_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.inventory_campaign_keep_reference();

CREATE TABLE public.inventory_campaign_events (
  tenant_id uuid NOT NULL,
  campaign_id uuid NOT NULL REFERENCES public.inventory_campaigns(id),
  event_code text NOT NULL CHECK (event_code IN ('opened','submitted','validated','cancelled')),
  actor_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  reason text,
  PRIMARY KEY (campaign_id,event_code)
);
ALTER TABLE public.inventory_campaign_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inventory_campaign_events FROM PUBLIC,anon,authenticated;

INSERT INTO public.inventory_campaign_events(tenant_id,campaign_id,event_code,actor_id,occurred_at,reason)
SELECT c.tenant_id,c.id,e.code,e.actor,e.at,e.reason
FROM public.inventory_campaigns c CROSS JOIN LATERAL (VALUES
  ('opened',c.opened_by,c.opened_at,NULL::text),
  ('submitted',CASE WHEN c.state IN ('submitted','validated') THEN c.decided_by END,c.decided_at,NULL::text),
  ('validated',c.validated_by,c.validated_at,NULL::text),
  ('cancelled',CASE WHEN c.state = 'cancelled' THEN c.decided_by END,c.decided_at,c.cancel_reason)
) e(code,actor,at,reason)
WHERE e.actor IS NOT NULL AND e.at IS NOT NULL;

CREATE FUNCTION public.inventory_campaign_log_transition() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.inventory_campaign_events(tenant_id,campaign_id,event_code,actor_id,occurred_at)
    VALUES (NEW.tenant_id,NEW.id,'opened',NEW.opened_by,NEW.opened_at);
  ELSIF NEW.state IS DISTINCT FROM OLD.state AND NEW.state IN ('submitted','cancelled','validated') THEN
    INSERT INTO public.inventory_campaign_events(tenant_id,campaign_id,event_code,actor_id,occurred_at,reason)
    VALUES (NEW.tenant_id,NEW.id,NEW.state,
      CASE WHEN NEW.state = 'validated' THEN NEW.validated_by ELSE NEW.decided_by END,
      CASE WHEN NEW.state = 'validated' THEN NEW.validated_at ELSE NEW.decided_at END,
      CASE WHEN NEW.state = 'cancelled' THEN NEW.cancel_reason END);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.inventory_campaign_log_transition() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER inventory_campaign_log_transition AFTER INSERT OR UPDATE OF state ON public.inventory_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.inventory_campaign_log_transition();

CREATE FUNCTION public.inventory_campaign_timeline(_campaign uuid,_expected_tenant uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _actor uuid := auth.uid();
  _tenant uuid := public.get_user_tenant_id(_actor);
  _payload jsonb;
BEGIN
  IF _actor IS NULL OR _tenant IS NULL OR _tenant IS DISTINCT FROM _expected_tenant
     OR public.has_permission(_actor,'inventory.post_count') IS NOT TRUE THEN
    RAISE EXCEPTION 'Historique de campagne non autorisé' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.inventory_campaigns c WHERE c.id = _campaign AND c.tenant_id = _tenant) THEN
    RAISE EXCEPTION 'Campagne introuvable' USING ERRCODE = 'P0002';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('event',e.event_code,'date',e.occurred_at,
    'actor',coalesce(p.full_name,e.actor_id::text),'reason',e.reason)
    ORDER BY e.occurred_at,CASE e.event_code WHEN 'opened' THEN 0 WHEN 'submitted' THEN 1 ELSE 2 END),'[]'::jsonb)
    INTO _payload
  FROM public.inventory_campaign_events e
  LEFT JOIN public.profiles p ON p.id = e.actor_id AND p.tenant_id = _tenant
  WHERE e.tenant_id = _tenant AND e.campaign_id = _campaign;
  RETURN _payload;
END;
$$;
REVOKE ALL ON FUNCTION public.inventory_campaign_timeline(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_campaign_timeline(uuid,uuid) TO authenticated;

CREATE FUNCTION public.inventory_campaign_save_counts(_campaign uuid,_stage text,_entries jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _actor uuid := auth.uid();
  _tenant uuid := public.get_user_tenant_id(_actor);
  _state text;
  _size integer;
  _written integer;
BEGIN
  IF _actor IS NULL OR _tenant IS NULL OR public.has_permission(_actor,'inventory.count') IS NOT TRUE THEN
    RAISE EXCEPTION 'Comptage non autorisé' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(_entries) IS DISTINCT FROM 'array' OR _stage IS NULL OR _stage NOT IN ('first','recount') THEN
    RAISE EXCEPTION 'Données de comptage invalides' USING ERRCODE = '22023';
  END IF;
  _size := jsonb_array_length(_entries);
  IF _size NOT BETWEEN 1 AND 5000 THEN
    RAISE EXCEPTION 'Le lot doit contenir de 1 à 5 000 quantités' USING ERRCODE = '22023';
  END IF;
  SELECT c.state INTO _state FROM public.inventory_campaigns c WHERE c.id = _campaign AND c.tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Campagne introuvable' USING ERRCODE = 'P0002'; END IF;
  IF (_stage = 'first' AND _state <> 'counting') OR (_stage = 'recount' AND _state <> 'submitted') THEN
    RAISE EXCEPTION 'La campagne ne permet plus cette saisie' USING ERRCODE = '55000';
  END IF;
  IF (SELECT count(DISTINCT e.item_id) FROM jsonb_to_recordset(_entries) AS e(item_id uuid,quantity numeric)) <> _size
     OR EXISTS (SELECT 1 FROM jsonb_to_recordset(_entries) AS e(item_id uuid,quantity numeric)
       WHERE e.quantity IS NULL OR e.quantity < 0 OR e.quantity >= 10000000000000000 OR e.quantity <> trunc(e.quantity,2)) THEN
    RAISE EXCEPTION 'Articles en double ou quantités invalides dans le lot' USING ERRCODE = '22023';
  END IF;
  IF _stage = 'first' THEN
    IF EXISTS (SELECT 1 FROM jsonb_to_recordset(_entries) AS e(item_id uuid,quantity numeric)
      JOIN public.inventory_campaign_lines l ON l.campaign_id = _campaign AND l.tenant_id = _tenant AND l.item_id = e.item_id
      WHERE l.counted_by IS NOT NULL AND l.counted_by <> _actor) THEN
      RAISE EXCEPTION 'Un article du lot a déjà été saisi par un autre compteur ; aucune ligne enregistrée'
        USING ERRCODE = '42501';
    END IF;
    UPDATE public.inventory_campaign_lines l SET counted = e.quantity,counted_by = _actor
    FROM jsonb_to_recordset(_entries) AS e(item_id uuid,quantity numeric)
    WHERE l.tenant_id = _tenant AND l.campaign_id = _campaign AND l.item_id = e.item_id
      AND (l.counted_by IS NULL OR l.counted_by = _actor);
  ELSE
    IF EXISTS (SELECT 1 FROM jsonb_to_recordset(_entries) AS e(item_id uuid,quantity numeric)
      JOIN public.inventory_campaign_count_log a ON a.campaign_id = _campaign AND a.item_id = e.item_id
      WHERE a.tenant_id = _tenant AND a.count_round = 1 AND a.counted_by = _actor) THEN
      RAISE EXCEPTION 'Le premier compteur ne peut pas recompter le même article' USING ERRCODE = '42501';
    END IF;
    UPDATE public.inventory_campaign_recounts r SET counted = e.quantity,counted_by = _actor,counted_at = clock_timestamp()
    FROM jsonb_to_recordset(_entries) AS e(item_id uuid,quantity numeric)
    WHERE r.tenant_id = _tenant AND r.campaign_id = _campaign AND r.item_id = e.item_id AND r.counted IS NULL;
  END IF;
  GET DIAGNOSTICS _written = ROW_COUNT;
  IF _written <> _size THEN
    RAISE EXCEPTION 'Le lot contient des articles hors campagne ou déjà recomptés ; aucune ligne enregistrée'
      USING ERRCODE = 'P0002';
  END IF;
  IF _stage = 'first' THEN RETURN public.inventory_campaign('read',_campaign); END IF;
  RETURN public.inventory_campaign_control('recount_tasks',_campaign);
END;
$$;
REVOKE ALL ON FUNCTION public.inventory_campaign_save_counts(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_campaign_save_counts(uuid,text,jsonb) TO authenticated;

CREATE FUNCTION public.inventory_campaign_catalog(_warehouse uuid DEFAULT NULL,_state text DEFAULT NULL,
  _search text DEFAULT NULL,_before timestamptz DEFAULT NULL,_before_id uuid DEFAULT NULL,_export boolean DEFAULT false,
  _expected_tenant uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _actor uuid := auth.uid();
  _tenant uuid := public.get_user_tenant_id(_actor);
  _term text := lower(nullif(btrim(_search),''));
  _payload jsonb;
BEGIN
  IF _actor IS NULL OR _tenant IS NULL OR (_expected_tenant IS NOT NULL AND _expected_tenant <> _tenant) OR (
    public.has_permission(_actor,'inventory.count') IS NOT TRUE AND public.has_permission(_actor,'inventory.post_count') IS NOT TRUE
    AND public.has_permission(_actor,'inventory.export') IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'Catalogue des campagnes non autorisé' USING ERRCODE = '42501';
  END IF;
  IF _export IS TRUE AND public.has_permission(_actor,'inventory.export') IS NOT TRUE THEN
    RAISE EXCEPTION 'Export des inventaires non autorisé' USING ERRCODE = '42501';
  END IF;
  IF (_before IS NULL) <> (_before_id IS NULL)
    OR (_state IS NOT NULL AND _state NOT IN ('counting','submitted','validated','cancelled')) THEN
    RAISE EXCEPTION 'Filtres ou curseur du catalogue invalides' USING ERRCODE = '22023';
  END IF;

  WITH selected AS MATERIALIZED (
    SELECT c.id,c.reference,c.item_scope,c.warehouse_id,w.code AS warehouse_code,w.name AS warehouse_name,
      c.state,c.opened_at,greatest(c.opened_at,c.decided_at,c.validated_at) AS updated_at
    FROM public.inventory_campaigns c JOIN public.warehouses w ON w.id = c.warehouse_id AND w.tenant_id = c.tenant_id
    WHERE c.tenant_id = _tenant AND (_warehouse IS NULL OR c.warehouse_id = _warehouse)
      AND (_state IS NULL OR c.state = _state)
      AND (_before IS NULL OR (c.opened_at,c.id) < (_before,_before_id))
      AND (_term IS NULL OR strpos(lower(coalesce(c.reference,'')),_term) > 0 OR strpos(c.id::text,_term) > 0)
    ORDER BY c.opened_at DESC,c.id DESC LIMIT 51
  ), page AS (
    SELECT s.*,l.total_lines,l.counted_lines,r.recount_lines,r.recounted_lines,
      events.submitted_at,events.validated_at,events.cancelled_at
    FROM (SELECT p.* FROM selected p ORDER BY p.opened_at DESC,p.id DESC LIMIT 50) s
    CROSS JOIN LATERAL (SELECT count(*) AS total_lines,count(*) FILTER (WHERE x.counted IS NOT NULL) AS counted_lines
      FROM public.inventory_campaign_lines x WHERE x.campaign_id = s.id AND x.tenant_id = _tenant) l
    CROSS JOIN LATERAL (SELECT count(*) AS recount_lines,count(*) FILTER (WHERE x.counted IS NOT NULL) AS recounted_lines
      FROM public.inventory_campaign_recounts x WHERE x.campaign_id = s.id AND x.tenant_id = _tenant) r
    CROSS JOIN LATERAL (SELECT
      max(e.occurred_at) FILTER (WHERE e.event_code = 'submitted') AS submitted_at,
      max(e.occurred_at) FILTER (WHERE e.event_code = 'validated') AS validated_at,
      max(e.occurred_at) FILTER (WHERE e.event_code = 'cancelled') AS cancelled_at
      FROM public.inventory_campaign_events e WHERE e.campaign_id = s.id AND e.tenant_id = _tenant) events
  )
  SELECT jsonb_build_object(
    'campaigns',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.opened_at DESC,p.id DESC) FROM page p),'[]'::jsonb),
    'next',CASE WHEN (SELECT count(*) FROM selected) > 50 THEN (
      SELECT jsonb_build_object('opened_at',p.opened_at,'id',p.id) FROM page p ORDER BY p.opened_at,p.id LIMIT 1
    ) END
  ) INTO _payload;
  RETURN _payload;
END;
$$;
REVOKE ALL ON FUNCTION public.inventory_campaign_catalog(uuid,text,text,timestamptz,uuid,boolean,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_campaign_catalog(uuid,text,text,timestamptz,uuid,boolean,uuid) TO authenticated;

CREATE FUNCTION public.inventory_campaign_preview(_warehouse uuid,_expected_tenant uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _actor uuid := auth.uid();
  _tenant uuid := public.get_user_tenant_id(_actor);
  _scope text;
  _articles bigint;
BEGIN
  IF _actor IS NULL OR _tenant IS NULL OR _tenant IS DISTINCT FROM _expected_tenant
     OR public.has_permission(_actor,'inventory.count') IS NOT TRUE THEN
    RAISE EXCEPTION 'Préparation d’inventaire non autorisée' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.warehouses w WHERE w.id = _warehouse AND w.tenant_id = _tenant) THEN
    RAISE EXCEPTION 'Dépôt introuvable' USING ERRCODE = 'P0002';
  END IF;
  SELECT s.campaign_item_scope INTO _scope FROM public.inventory_settings s WHERE s.tenant_id = _tenant;
  _scope := coalesce(_scope,'warehouse');
  SELECT count(*) INTO _articles FROM public.inventory_campaign_open_items(_tenant,_warehouse,_scope);
  RETURN jsonb_build_object('item_scope',_scope,'articles',_articles);
END;
$$;
REVOKE ALL ON FUNCTION public.inventory_campaign_preview(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_campaign_preview(uuid,uuid) TO authenticated;

SELECT public.install_tenant_isolation_triggers();
