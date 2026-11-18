-- A positive depot count cannot also increase a quantity already recorded globally.
CREATE FUNCTION public.guard_unallocated_campaign_gain()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _code text;
  _global numeric;
  _located numeric;
BEGIN
  -- Serialize against movements that change this article and its depot quantities.
  SELECT i.code, i.quantity_on_hand INTO _code, _global
  FROM public.items i
  WHERE i.id = NEW.item_id AND i.tenant_id = NEW.tenant_id
  FOR UPDATE;

  SELECT coalesce(sum(l.quantity_on_hand), 0) INTO _located
  FROM public.item_locations l
  WHERE l.item_id = NEW.item_id AND l.tenant_id = NEW.tenant_id;

  IF _global > _located THEN
    RAISE EXCEPTION 'Le stock global de l’article % n’est pas entièrement affecté aux dépôts. Rapprochez le stock déjà enregistré avant de valider l’inventaire.', _code
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_unallocated_campaign_gain() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_guard_unallocated_campaign_gain
BEFORE INSERT ON public.stock_movements FOR EACH ROW
WHEN (NEW.reference_type = 'inventory_count_campaign' AND NEW.status = 'posted' AND NEW.quantity > 0)
EXECUTE FUNCTION public.guard_unallocated_campaign_gain();
