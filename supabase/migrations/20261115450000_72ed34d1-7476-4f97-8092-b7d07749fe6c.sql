-- S3: ABC cycle planning from actual stock or valued outflows, with no default operating policy.
ALTER TABLE public.inventory_campaigns
  DROP CONSTRAINT inventory_campaigns_item_scope_check,
  ADD CONSTRAINT inventory_campaigns_item_scope_check CHECK (item_scope IN ('warehouse','assigned','all_active','cycle')),
  ADD COLUMN cycle_policy_snapshot jsonb;
ALTER TABLE public.inventory_campaign_lines
  ADD COLUMN cycle_class text CHECK (cycle_class IN ('A','B','C','N'));

CREATE TABLE public.inventory_cycle_policies (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),
  basis text NOT NULL CHECK (basis IN ('stock_value','outflow_value')),
  lookback_months integer,
  a_percent numeric NOT NULL,
  b_percent numeric NOT NULL,
  a_days integer NOT NULL CHECK (a_days BETWEEN 1 AND 36500),
  b_days integer NOT NULL CHECK (b_days BETWEEN 1 AND 36500),
  c_days integer NOT NULL CHECK (c_days BETWEEN 1 AND 36500),
  unvalued_days integer CHECK (unvalued_days BETWEEN 1 AND 36500),
  batch_size integer NOT NULL CHECK (batch_size BETWEEN 1 AND 5000),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (a_percent > 0 AND a_percent < b_percent AND b_percent < 100),
  CHECK ((basis = 'stock_value' AND lookback_months IS NULL)
    OR (basis = 'outflow_value' AND lookback_months IS NOT NULL AND lookback_months BETWEEN 1 AND 120))
);
ALTER TABLE public.inventory_cycle_policies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inventory_cycle_policies FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.inventory_cycle_policy(_action text,_expected_tenant uuid,_policy jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _actor uuid := auth.uid();
  _tenant uuid := public.get_user_tenant_id(_actor);
  _saved public.inventory_cycle_policies%ROWTYPE;
BEGIN
  IF _actor IS NULL OR _tenant IS NULL OR _tenant IS DISTINCT FROM _expected_tenant
     OR public.has_permission(_actor,'inventory.settings') IS NOT TRUE THEN
    RAISE EXCEPTION 'Paramétrage du tournant non autorisé' USING ERRCODE = '42501';
  END IF;
  IF _action = 'save' THEN
    IF jsonb_typeof(_policy) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Renseignez la règle complète du tournant' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.inventory_cycle_policies
      (tenant_id,basis,lookback_months,a_percent,b_percent,a_days,b_days,c_days,unvalued_days,batch_size,updated_by)
    VALUES (_tenant,_policy->>'basis',(_policy->>'lookback_months')::integer,(_policy->>'a_percent')::numeric,
      (_policy->>'b_percent')::numeric,(_policy->>'a_days')::integer,(_policy->>'b_days')::integer,
      (_policy->>'c_days')::integer,(_policy->>'unvalued_days')::integer,(_policy->>'batch_size')::integer,_actor)
    ON CONFLICT (tenant_id) DO UPDATE SET basis=EXCLUDED.basis,lookback_months=EXCLUDED.lookback_months,
      a_percent=EXCLUDED.a_percent,b_percent=EXCLUDED.b_percent,a_days=EXCLUDED.a_days,b_days=EXCLUDED.b_days,
      c_days=EXCLUDED.c_days,unvalued_days=EXCLUDED.unvalued_days,batch_size=EXCLUDED.batch_size,
      updated_by=_actor,updated_at=clock_timestamp()
    RETURNING * INTO _saved;
  ELSIF _action = 'read' THEN
    SELECT p.* INTO _saved FROM public.inventory_cycle_policies p WHERE p.tenant_id = _tenant;
  ELSE
    RAISE EXCEPTION 'Action de paramétrage inconnue' USING ERRCODE = '22023';
  END IF;
  IF _saved.tenant_id IS NULL THEN RETURN jsonb_build_object('configured',false); END IF;
  RETURN (to_jsonb(_saved) - 'tenant_id' - 'updated_by' - 'updated_at') || jsonb_build_object('configured',true);
EXCEPTION WHEN check_violation OR not_null_violation OR invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'Vérifiez la base, les seuils cumulés, les fréquences et la taille du lot' USING ERRCODE = '22023';
END;
$$;
REVOKE ALL ON FUNCTION public.inventory_cycle_policy(text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_cycle_policy(text,uuid,jsonb) TO authenticated;

CREATE FUNCTION public.inventory_cycle_ranked_items(_tenant uuid,_warehouse uuid,_policy public.inventory_cycle_policies)
RETURNS TABLE(item_id uuid,code text,name text,unit text,expected numeric,cycle_class text,
              last_validated date,due_date date,weight numeric,cumulative_percent numeric,is_due boolean)
LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH tracked AS MATERIALIZED (
    SELECT i.id,i.code,i.name,i.unit,p.expected,i.average_cost
    FROM public.inventory_campaign_open_items(_tenant,_warehouse,'warehouse') p
    JOIN public.items i ON i.id = p.item_id AND i.tenant_id = _tenant AND i.status = 'active'
  ), outflows AS (
    SELECT m.item_id,sum(greatest(m.total_value,0)) AS amount
    FROM public.stock_movements m JOIN tracked t ON t.id = m.item_id
    WHERE _policy.basis = 'outflow_value' AND m.tenant_id = _tenant AND m.warehouse_id = _warehouse
      AND m.status = 'posted' AND m.quantity < 0
      AND m.movement_type NOT LIKE 'transfer%' AND m.movement_type NOT IN ('adjustment','adjust_in','adjust_out')
      AND m.movement_date BETWEEN (CURRENT_DATE - make_interval(months => _policy.lookback_months))::date AND CURRENT_DATE
    GROUP BY m.item_id
  ), weighted AS (
    SELECT t.*,
      CASE WHEN _policy.basis = 'stock_value' THEN greatest(t.expected,0) * greatest(t.average_cost,0)
        ELSE coalesce(o.amount,0) END AS weight
    FROM tracked t LEFT JOIN outflows o ON o.item_id = t.id
  ), ranked AS (
    SELECT w.*,sum(w.weight) OVER () AS total,
      coalesce(sum(w.weight) OVER(ORDER BY w.weight DESC,w.code,w.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS previous
    FROM weighted w
  ), classified AS (
    SELECT r.*,CASE WHEN r.weight <= 0 THEN 'N'
      WHEN r.previous * 100 < r.total * _policy.a_percent THEN 'A'
      WHEN r.previous * 100 < r.total * _policy.b_percent THEN 'B' ELSE 'C' END AS cls
    FROM ranked r
  ), last_counts AS (
    SELECT l.item_id,max(c.validated_at)::date AS last_day
    FROM public.inventory_campaigns c JOIN public.inventory_campaign_lines l
      ON l.campaign_id = c.id AND l.tenant_id = c.tenant_id
    WHERE c.tenant_id = _tenant AND c.warehouse_id = _warehouse AND c.state = 'validated'
    GROUP BY l.item_id
  ), frequencies AS (
    SELECT a.id,a.code,a.name,a.unit,a.expected,a.cls,l.last_day,a.weight,a.total,a.previous,
      CASE a.cls WHEN 'A' THEN _policy.a_days WHEN 'B' THEN _policy.b_days
        WHEN 'C' THEN _policy.c_days ELSE _policy.unvalued_days END AS frequency
    FROM classified a LEFT JOIN last_counts l ON l.item_id = a.id
  )
  SELECT f.id,f.code,f.name,f.unit,f.expected,f.cls,f.last_day,f.last_day + f.frequency,f.weight,
    CASE WHEN f.total > 0 THEN round((f.previous + f.weight) * 100 / f.total,2) END,
    f.frequency IS NOT NULL AND (f.last_day IS NULL OR f.last_day + f.frequency <= CURRENT_DATE)
  FROM frequencies f
$$;
REVOKE ALL ON FUNCTION public.inventory_cycle_ranked_items(uuid,uuid,public.inventory_cycle_policies) FROM PUBLIC,anon,authenticated;

-- The normal numbering trigger must preserve a scope explicitly chosen by the cycle procedure.
CREATE OR REPLACE FUNCTION public.inventory_campaign_assign_reference() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  _prefix text;
  _width integer;
  _issued integer;
  _scope text;
BEGIN
  SELECT s.campaign_document_prefix,s.campaign_document_width,s.campaign_item_scope INTO _prefix,_width,_scope
    FROM public.inventory_settings s WHERE s.tenant_id = NEW.tenant_id FOR UPDATE;
  IF NEW.item_scope <> 'cycle' THEN NEW.item_scope := coalesce(_scope,'warehouse'); END IF;
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

CREATE FUNCTION public.inventory_cycle_prepare(_action text,_warehouse uuid,_expected_tenant uuid,_signature text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _actor uuid := auth.uid();
  _tenant uuid := public.get_user_tenant_id(_actor);
  _policy public.inventory_cycle_policies%ROWTYPE;
  _effective_policy jsonb;
  _active uuid;
  _due bigint;
  _visible jsonb;
  _opening jsonb;
  _current_signature text;
BEGIN
  IF _actor IS NULL OR _tenant IS NULL OR _tenant IS DISTINCT FROM _expected_tenant
     OR public.has_permission(_actor,'inventory.count') IS NOT TRUE THEN
    RAISE EXCEPTION 'Préparation du tournant non autorisée' USING ERRCODE = '42501';
  END IF;
  IF _action IS NULL OR _action NOT IN ('preview','open') THEN
    RAISE EXCEPTION 'Action de tournant inconnue' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.warehouses w WHERE w.id = _warehouse AND w.tenant_id = _tenant) THEN
    RAISE EXCEPTION 'Dépôt introuvable' USING ERRCODE = 'P0002';
  END IF;
  IF _action = 'open' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('inventory-campaign:' || _warehouse::text,0));
  END IF;
  SELECT c.id INTO _active FROM public.inventory_campaigns c
    WHERE c.tenant_id = _tenant AND c.warehouse_id = _warehouse AND c.state IN ('counting','submitted');
  IF _active IS NOT NULL THEN
    IF _action = 'open' THEN RAISE EXCEPTION 'Une campagne est déjà active pour ce dépôt' USING ERRCODE = '55000'; END IF;
    RETURN jsonb_build_object('active_campaign',_active,'lines','[]'::jsonb);
  END IF;
  IF _action = 'open' THEN
    SELECT p.* INTO _policy FROM public.inventory_cycle_policies p WHERE p.tenant_id = _tenant FOR SHARE;
  ELSE
    SELECT p.* INTO _policy FROM public.inventory_cycle_policies p WHERE p.tenant_id = _tenant;
  END IF;
  IF _policy.tenant_id IS NULL THEN
    RAISE EXCEPTION 'Configurez les règles du tournant dans Stocks → Paramètres → Inventaires' USING ERRCODE = '55000';
  END IF;
  _effective_policy := to_jsonb(_policy) - 'tenant_id' - 'updated_by' - 'updated_at';

  WITH due AS MATERIALIZED (
    SELECT v.* FROM public.inventory_cycle_ranked_items(_tenant,_warehouse,_policy) v WHERE v.is_due
  ), chosen AS (
    SELECT d.* FROM due d ORDER BY coalesce(d.due_date,CURRENT_DATE),d.cycle_class,d.code,d.item_id LIMIT _policy.batch_size
  )
  SELECT (SELECT count(*) FROM due),
    coalesce(jsonb_agg(jsonb_build_object('item_id',p.item_id,'code',p.code,'name',p.name,'unit',p.unit,
      'class',p.cycle_class,'last_validated',p.last_validated,'due_date',p.due_date) ORDER BY
      coalesce(p.due_date,CURRENT_DATE),p.cycle_class,p.code,p.item_id),'[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('item_id',p.item_id,'expected',p.expected,'cycle_class',p.cycle_class)),'[]'::jsonb)
    INTO _due,_visible,_opening FROM chosen p;
  _current_signature := md5(concat(_warehouse::text,'|',_effective_policy::text,'|',_visible::text));
  IF _action = 'preview' THEN
    RETURN jsonb_build_object('active_campaign',NULL,'signature',_current_signature,'lines',_visible,
      'due_total',_due,'basis',_policy.basis,'batch_size',_policy.batch_size);
  END IF;
  IF _signature IS DISTINCT FROM _current_signature THEN
    RAISE EXCEPTION 'La proposition a changé. Actualisez le plan avant d’ouvrir la campagne' USING ERRCODE = '55000';
  END IF;
  IF _due = 0 THEN RAISE EXCEPTION 'Aucun article n’est arrivé à échéance' USING ERRCODE = '55000'; END IF;

  INSERT INTO public.inventory_campaigns(tenant_id,warehouse_id,opened_by,item_scope,cycle_policy_snapshot)
    VALUES (_tenant,_warehouse,_actor,'cycle',_effective_policy) RETURNING id INTO _active;
  INSERT INTO public.inventory_campaign_lines(tenant_id,campaign_id,item_id,expected,cycle_class)
    SELECT _tenant,_active,l.item_id,l.expected,l.cycle_class
    FROM jsonb_to_recordset(_opening) AS l(item_id uuid,expected numeric,cycle_class text);
  RETURN public.inventory_campaign('read',_active);
END;
$$;
REVOKE ALL ON FUNCTION public.inventory_cycle_prepare(text,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_cycle_prepare(text,uuid,uuid,text) TO authenticated;

-- Reporting uses the exact same ranking and the same active company as the proposed count.
CREATE FUNCTION public.inventory_cycle_analysis(_warehouse uuid,_expected_tenant uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _actor uuid := auth.uid();
  _tenant uuid := public.get_user_tenant_id(_actor);
  _policy public.inventory_cycle_policies%ROWTYPE;
  _payload jsonb;
BEGIN
  IF _actor IS NULL OR _tenant IS NULL OR _tenant IS DISTINCT FROM _expected_tenant THEN
    RAISE EXCEPTION 'Analyse de cette société non autorisée' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.warehouses w WHERE w.id = _warehouse AND w.tenant_id = _tenant) THEN
    RAISE EXCEPTION 'Dépôt introuvable' USING ERRCODE = 'P0002';
  END IF;
  SELECT p.* INTO _policy FROM public.inventory_cycle_policies p WHERE p.tenant_id = _tenant;
  IF NOT FOUND THEN RETURN jsonb_build_object('configured',false); END IF;
  WITH summary AS MATERIALIZED (
    SELECT v.* FROM public.inventory_cycle_ranked_items(_tenant,_warehouse,_policy) v
  ), classes AS (
    SELECT s.cycle_class AS class,count(*) AS articles,count(*) FILTER (WHERE s.is_due) AS due,sum(s.weight) AS weight
    FROM summary s GROUP BY s.cycle_class
  ), top_items AS (
    SELECT d.item_id,d.code,d.name,d.cycle_class AS class,d.weight,d.cumulative_percent,d.is_due
    FROM summary d ORDER BY d.weight DESC,d.code,d.item_id LIMIT 15
  )
  SELECT jsonb_build_object('configured',true,'basis',_policy.basis,'lookback_months',_policy.lookback_months,
    'total_articles',count(*),'due_total',count(*) FILTER (WHERE a.is_due),'total_weight',coalesce(sum(a.weight),0),
    'classes',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.class) FROM classes c),'[]'::jsonb),
    'top',coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.weight DESC,i.code,i.item_id) FROM top_items i),'[]'::jsonb))
  INTO _payload FROM summary a;
  RETURN _payload;
END;
$$;
REVOKE ALL ON FUNCTION public.inventory_cycle_analysis(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_cycle_analysis(uuid,uuid) TO authenticated;

CREATE INDEX inventory_campaigns_validated_depot
  ON public.inventory_campaigns(tenant_id,warehouse_id,validated_at DESC) WHERE state = 'validated';
CREATE INDEX inventory_cycle_posted_outflows
  ON public.stock_movements(tenant_id,warehouse_id,movement_date,item_id) WHERE status = 'posted' AND quantity < 0;
CREATE INDEX inventory_cycle_depot_items ON public.item_locations(tenant_id,warehouse_id,item_id);
