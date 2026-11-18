-- S3: company policy, blind recount, independent approval and stock posting.
ALTER TABLE public.inventory_settings
  ADD COLUMN campaign_tolerance_percent numeric CHECK (campaign_tolerance_percent >= 0 AND campaign_tolerance_percent < 'Infinity'::numeric),
  ADD COLUMN campaign_tolerance_value numeric CHECK (campaign_tolerance_value >= 0 AND campaign_tolerance_value < 'Infinity'::numeric);

ALTER TABLE public.inventory_campaigns
  DROP CONSTRAINT inventory_campaigns_state_check,
  ADD CONSTRAINT inventory_campaigns_state_check CHECK (state IN ('counting','submitted','cancelled','validated')),
  ADD COLUMN tolerance_percent numeric,
  ADD COLUMN tolerance_value numeric,
  ADD COLUMN policy_frozen_at timestamptz,
  ADD COLUMN validated_by uuid,
  ADD COLUMN validated_at timestamptz;
ALTER TABLE public.inventory_campaign_lines ADD COLUMN opening_unit_cost numeric;

CREATE TABLE public.inventory_campaign_recounts (
  tenant_id uuid NOT NULL,
  campaign_id uuid NOT NULL REFERENCES public.inventory_campaigns(id),
  item_id uuid NOT NULL REFERENCES public.items(id),
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  counted numeric CHECK (counted >= 0 AND counted < 10000000000000000 AND counted = trunc(counted,2)),
  counted_by uuid,
  counted_at timestamptz,
  PRIMARY KEY (campaign_id,item_id),
  FOREIGN KEY (campaign_id,item_id) REFERENCES public.inventory_campaign_lines(campaign_id,item_id)
);
CREATE TABLE public.inventory_campaign_count_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  campaign_id uuid NOT NULL REFERENCES public.inventory_campaigns(id),
  item_id uuid NOT NULL REFERENCES public.items(id),
  counted numeric NOT NULL,
  counted_by uuid NOT NULL,
  counted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  count_round smallint NOT NULL CHECK (count_round IN (1,2)),
  FOREIGN KEY (campaign_id,item_id) REFERENCES public.inventory_campaign_lines(campaign_id,item_id)
);
CREATE INDEX inventory_campaign_count_log_actor ON public.inventory_campaign_count_log(campaign_id,counted_by,item_id);
ALTER TABLE public.inventory_campaign_recounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_campaign_count_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inventory_campaign_recounts,public.inventory_campaign_count_log FROM PUBLIC,anon,authenticated;

-- Keep the latest available initial count if a V91 campaign already exists.
INSERT INTO public.inventory_campaign_count_log(tenant_id,campaign_id,item_id,counted,counted_by,count_round)
SELECT l.tenant_id,l.campaign_id,l.item_id,l.counted,l.counted_by,1
FROM public.inventory_campaign_lines l WHERE l.counted IS NOT NULL AND l.counted_by IS NOT NULL;

CREATE FUNCTION public.inventory_campaign_capture_cost() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  SELECT i.average_cost,i.code,i.name,i.unit
    INTO NEW.opening_unit_cost,NEW.opening_code,NEW.opening_name,NEW.opening_unit FROM public.items i
    WHERE i.id = NEW.item_id AND i.tenant_id = NEW.tenant_id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.inventory_campaign_capture_cost() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER inventory_campaign_capture_cost
  BEFORE INSERT ON public.inventory_campaign_lines
  FOR EACH ROW EXECUTE FUNCTION public.inventory_campaign_capture_cost();

CREATE FUNCTION public.inventory_campaign_log_count() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  INSERT INTO public.inventory_campaign_count_log(tenant_id,campaign_id,item_id,counted,counted_by,count_round)
  VALUES (NEW.tenant_id,NEW.campaign_id,NEW.item_id,NEW.counted,NEW.counted_by,TG_ARGV[0]::smallint);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.inventory_campaign_log_count() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER inventory_campaign_log_first
  AFTER UPDATE OF counted ON public.inventory_campaign_lines
  FOR EACH ROW WHEN (NEW.counted IS NOT NULL) EXECUTE FUNCTION public.inventory_campaign_log_count('1');
CREATE TRIGGER inventory_campaign_log_second
  AFTER UPDATE OF counted ON public.inventory_campaign_recounts
  FOR EACH ROW WHEN (NEW.counted IS NOT NULL) EXECUTE FUNCTION public.inventory_campaign_log_count('2');

CREATE FUNCTION public.inventory_campaign_policy(_action text,_percent numeric DEFAULT NULL,_value numeric DEFAULT NULL,
  _expected_tenant uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _actor uuid := auth.uid();
  _tenant uuid := public.get_user_tenant_id(_actor);
  _settings public.inventory_settings%ROWTYPE;
BEGIN
  IF _actor IS NULL OR _tenant IS NULL OR (_expected_tenant IS NOT NULL AND _expected_tenant <> _tenant) OR (
    public.has_permission(_actor,'inventory.settings') IS NOT TRUE
    AND (_action IS DISTINCT FROM 'read' OR public.has_permission(_actor,'inventory.post_count') IS NOT TRUE)
  ) THEN
    RAISE EXCEPTION 'Paramétrage des inventaires non autorisé' USING ERRCODE = '42501';
  END IF;
  IF _action = 'save' THEN
    IF (_percent IS NULL AND _value IS NULL)
       OR _percent < 0 OR _percent >= 'Infinity'::numeric OR _value < 0 OR _value >= 'Infinity'::numeric THEN
      RAISE EXCEPTION 'Renseignez au moins un seuil positif ou nul' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.inventory_settings(tenant_id,campaign_tolerance_percent,campaign_tolerance_value)
    VALUES (_tenant,_percent,_value)
    ON CONFLICT(tenant_id) DO UPDATE SET campaign_tolerance_percent = EXCLUDED.campaign_tolerance_percent,
      campaign_tolerance_value = EXCLUDED.campaign_tolerance_value, updated_at = now()
    RETURNING * INTO _settings;
  ELSIF _action = 'read' THEN
    SELECT s.* INTO _settings FROM public.inventory_settings s WHERE s.tenant_id = _tenant;
  ELSE RAISE EXCEPTION 'Action de paramétrage inconnue' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('percent',_settings.campaign_tolerance_percent,'value',_settings.campaign_tolerance_value);
END;
$$;
REVOKE ALL ON FUNCTION public.inventory_campaign_policy(text,numeric,numeric,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_campaign_policy(text,numeric,numeric,uuid) TO authenticated;

CREATE FUNCTION public.inventory_campaign_variances(_campaign uuid,_tenant uuid)
RETURNS TABLE(item_id uuid,code text,name text,unit text,expected numeric,first_count numeric,second_count numeric,
              effective_count numeric,variance numeric,requires_recount boolean,recount_requested boolean,
              opening_unit_cost numeric)
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT l.item_id,coalesce(l.opening_code,i.code),coalesce(l.opening_name,i.name),coalesce(l.opening_unit,i.unit),
         l.expected,l.counted,r.counted,
         coalesce(r.counted,l.counted),coalesce(r.counted,l.counted) - l.expected,
         (coalesce(c.tolerance_percent IS NOT NULL AND abs(l.counted - l.expected) >
                   abs(l.expected) * c.tolerance_percent / 100, false)
          OR coalesce(c.tolerance_value IS NOT NULL AND
                   abs(l.counted - l.expected) * l.opening_unit_cost > c.tolerance_value, false)),
         r.item_id IS NOT NULL,l.opening_unit_cost
  FROM public.inventory_campaign_lines l
  JOIN public.inventory_campaigns c ON c.id = l.campaign_id AND c.tenant_id = l.tenant_id
  JOIN public.items i ON i.id = l.item_id AND i.tenant_id = l.tenant_id
  LEFT JOIN public.inventory_campaign_recounts r ON r.campaign_id = l.campaign_id AND r.item_id = l.item_id
    AND r.tenant_id = l.tenant_id
  WHERE l.campaign_id = _campaign AND l.tenant_id = _tenant
$$;
REVOKE ALL ON FUNCTION public.inventory_campaign_variances(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.inventory_campaign_control(_action text,_id uuid,_item uuid DEFAULT NULL,_quantity numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _actor uuid := auth.uid();
  _tenant uuid := public.get_user_tenant_id(_actor);
  _campaign public.inventory_campaigns%ROWTYPE;
  _policy public.inventory_settings%ROWTYPE;
  _result jsonb;
BEGIN
  IF _actor IS NULL OR _tenant IS NULL THEN
    RAISE EXCEPTION 'Aucune société active' USING ERRCODE = '42501';
  END IF;

  IF _action IN ('recount_tasks','count_again') THEN
    IF public.has_permission(_actor,'inventory.count') IS NOT TRUE THEN
      RAISE EXCEPTION 'Recomptage non autorisé' USING ERRCODE = '42501';
    END IF;
    SELECT c.* INTO _campaign FROM public.inventory_campaigns c WHERE c.id = _id AND c.tenant_id = _tenant FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Campagne introuvable' USING ERRCODE = 'P0002'; END IF;
    IF _action = 'count_again' THEN
      IF _campaign.state <> 'submitted' THEN RAISE EXCEPTION 'Campagne non soumise' USING ERRCODE = '55000'; END IF;
      IF EXISTS (SELECT 1 FROM public.inventory_campaign_count_log a WHERE a.campaign_id = _id
           AND a.item_id = _item AND a.count_round = 1 AND a.counted_by = _actor) THEN
        RAISE EXCEPTION 'Le premier compteur ne peut pas recompter ce même article' USING ERRCODE = '42501';
      END IF;
      IF _quantity IS NULL OR _quantity < 0 OR _quantity >= 10000000000000000 OR _quantity <> trunc(_quantity,2) THEN
        RAISE EXCEPTION 'Saisissez une quantité positive ou nulle, avec au plus deux décimales' USING ERRCODE = '22023';
      END IF;
      UPDATE public.inventory_campaign_recounts r SET counted = _quantity,counted_by = _actor,counted_at = clock_timestamp()
      WHERE r.tenant_id = _tenant AND r.campaign_id = _id AND r.item_id = _item AND r.counted IS NULL;
      IF NOT FOUND THEN RAISE EXCEPTION 'Aucun recomptage en attente pour cet article' USING ERRCODE = '55000'; END IF;
    END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object('item_id',i.id,'code',coalesce(l.opening_code,i.code),
      'name',coalesce(l.opening_name,i.name),'unit',coalesce(l.opening_unit,i.unit))
      ORDER BY coalesce(l.opening_code,i.code),i.id), '[]'::jsonb) INTO _result
    FROM public.inventory_campaign_recounts r JOIN public.items i ON i.id = r.item_id AND i.tenant_id = r.tenant_id
    JOIN public.inventory_campaign_lines l ON l.campaign_id = r.campaign_id AND l.item_id = r.item_id AND l.tenant_id = r.tenant_id
    WHERE _campaign.state = 'submitted' AND r.tenant_id = _tenant AND r.campaign_id = _id AND r.counted IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.inventory_campaign_count_log a WHERE a.campaign_id = _id
        AND a.item_id = r.item_id AND a.count_round = 1 AND a.counted_by = _actor);
    RETURN jsonb_build_object('id',_id,'state',_campaign.state,'lines',_result);
  END IF;

  IF public.has_permission(_actor,'inventory.post_count') IS NOT TRUE THEN
    RAISE EXCEPTION 'Contrôle des inventaires non autorisé' USING ERRCODE = '42501';
  END IF;
  IF _action = 'active_review' THEN
    SELECT c.* INTO _campaign FROM public.inventory_campaigns c
    WHERE c.warehouse_id = _id AND c.tenant_id = _tenant AND c.state = 'submitted';
    IF NOT FOUND THEN RETURN NULL; END IF;
    RETURN jsonb_build_object('id',_campaign.id,'state',_campaign.state,'reference',_campaign.reference);
  END IF;
  IF _action IS NULL OR _action NOT IN ('review','request_recount','validate') THEN
    RAISE EXCEPTION 'Action de contrôle inconnue' USING ERRCODE = '22023';
  END IF;
  SELECT c.* INTO _campaign FROM public.inventory_campaigns c WHERE c.id = _id AND c.tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Campagne introuvable' USING ERRCODE = 'P0002'; END IF;
  IF _campaign.state <> 'submitted' AND NOT (_action = 'review' AND _campaign.state = 'validated') THEN
    RAISE EXCEPTION 'Cette campagne n’est pas en attente de validation' USING ERRCODE = '55000';
  END IF;
  IF _campaign.state = 'submitted' AND EXISTS (SELECT 1 FROM public.inventory_campaign_count_log a
    WHERE a.campaign_id = _id AND a.counted_by = _actor) THEN
    RAISE EXCEPTION 'Le contrôle et la validation doivent être effectués par une personne qui n’a pas compté'
      USING ERRCODE = '42501';
  END IF;

  IF _campaign.policy_frozen_at IS NULL THEN
    SELECT s.* INTO _policy FROM public.inventory_settings s WHERE s.tenant_id = _tenant;
    IF _policy.campaign_tolerance_percent IS NULL AND _policy.campaign_tolerance_value IS NULL THEN
      RAISE EXCEPTION 'Configurez les seuils de recomptage dans Stocks → Paramètres avant le contrôle' USING ERRCODE = '55000';
    END IF;
    IF _policy.campaign_tolerance_value IS NOT NULL AND EXISTS (SELECT 1 FROM public.inventory_campaign_lines l
      WHERE l.tenant_id = _tenant AND l.campaign_id = _id AND l.opening_unit_cost IS NULL) THEN
      RAISE EXCEPTION 'Coût d’ouverture indisponible pour cette campagne : le seuil en valeur ne peut pas être appliqué'
        USING ERRCODE = '55000';
    END IF;
    UPDATE public.inventory_campaigns c SET tolerance_percent = _policy.campaign_tolerance_percent,
      tolerance_value = _policy.campaign_tolerance_value,policy_frozen_at = clock_timestamp()
    WHERE c.id = _id RETURNING * INTO _campaign;
  END IF;

  IF _action = 'request_recount' THEN
    INSERT INTO public.inventory_campaign_recounts(tenant_id,campaign_id,item_id,requested_by)
    SELECT _tenant,_id,v.item_id,_actor FROM public.inventory_campaign_variances(_id,_tenant) v WHERE v.requires_recount
    ON CONFLICT(campaign_id,item_id) DO NOTHING;
  ELSIF _action = 'validate' THEN
    IF EXISTS (SELECT 1 FROM public.inventory_campaign_variances(_id,_tenant) v
      WHERE v.requires_recount AND v.second_count IS NULL) THEN
      RAISE EXCEPTION 'Les recomptages requis doivent être terminés avant de valider' USING ERRCODE = '55000';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('inventory-campaign:' || _campaign.warehouse_id::text,0));
    IF EXISTS (SELECT 1 FROM public.inventory_campaign_lines l
      WHERE l.campaign_id = _id AND l.tenant_id = _tenant AND l.expected IS DISTINCT FROM (
        SELECT coalesce(sum(loc.quantity_on_hand),0) FROM public.item_locations loc
        WHERE loc.warehouse_id = _campaign.warehouse_id AND loc.item_id = l.item_id AND loc.tenant_id = _tenant)) THEN
      RAISE EXCEPTION 'Le stock du dépôt a changé depuis l’ouverture : annulez et ouvrez une nouvelle campagne' USING ERRCODE = '55000';
    END IF;
    PERFORM i.id FROM public.items i JOIN public.inventory_campaign_lines l ON l.item_id = i.id AND l.tenant_id = i.tenant_id
    WHERE l.campaign_id = _id AND i.tenant_id = _tenant ORDER BY i.id FOR UPDATE OF i;
    IF EXISTS (SELECT 1 FROM public.inventory_campaign_lines l JOIN public.items i
      ON i.id = l.item_id AND i.tenant_id = l.tenant_id
      WHERE l.campaign_id = _id AND l.tenant_id = _tenant AND l.opening_unit IS NOT NULL
        AND i.unit IS DISTINCT FROM l.opening_unit) THEN
      RAISE EXCEPTION 'Une unité d’article a changé depuis l’ouverture : rétablissez-la ou annulez la campagne'
        USING ERRCODE = '55000';
    END IF;
    UPDATE public.inventory_campaigns c SET state = 'validated',validated_at = clock_timestamp(),validated_by = _actor
      WHERE c.id = _id RETURNING * INTO _campaign;
    INSERT INTO public.stock_movements (tenant_id,item_id,warehouse_id,movement_type,quantity,unit_cost,reference_type,
                                        reference_id,created_by,status,reason)
    SELECT _tenant,v.item_id,_campaign.warehouse_id,'adjustment',v.variance,coalesce(i.average_cost,0),
           'inventory_count_campaign',_id,_actor,'posted',
           concat('Écart de campagne d’inventaire ',coalesce(_campaign.reference,_campaign.id::text))
    FROM public.inventory_campaign_variances(_id,_tenant) v
    JOIN public.items i ON i.id = v.item_id AND i.tenant_id = _tenant WHERE v.variance <> 0
    ORDER BY v.item_id;
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(v) || jsonb_build_object(
    'movement_id',m.id,'journal_piece_number',j.piece_number,'posted_unit_cost',m.unit_cost,
    'posted_value',m.total_value) ORDER BY v.code,v.item_id),'[]'::jsonb) INTO _result
  FROM public.inventory_campaign_variances(_id,_tenant) v
  LEFT JOIN public.stock_movements m ON _campaign.state = 'validated' AND m.tenant_id = _tenant
    AND m.reference_type = 'inventory_count_campaign' AND m.reference_id = _id AND m.item_id = v.item_id
  LEFT JOIN public.journal_entries j ON j.id = m.journal_entry_id AND j.tenant_id = _tenant;
  RETURN jsonb_build_object('id',_id,'state',_campaign.state,'reference',_campaign.reference,'lines',_result,
    'percent',_campaign.tolerance_percent,'value',_campaign.tolerance_value);
END;
$$;
REVOKE ALL ON FUNCTION public.inventory_campaign_control(text,uuid,uuid,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_campaign_control(text,uuid,uuid,numeric) TO authenticated;

SELECT public.install_tenant_isolation_triggers();
