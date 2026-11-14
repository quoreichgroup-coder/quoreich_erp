-- V40 — Numérotation transactionnelle des devis, commandes et bons de livraison.
-- Les références sont attribuées par la base depuis une série par société.

-- La confirmation commerciale ne consomme pas de stock. Les mouvements réels sont postés
-- lors de la livraison ; l'ancien mouvement générique avec item_id NULL faisait échouer
-- toute commande de service (stock_movements.item_id est NOT NULL).
CREATE OR REPLACE FUNCTION public.on_so_confirmed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN NEW;
END;
$$;

-- Valide les lignes de livraison sur la commande source, empêche les surlivraisons
-- et termine le bon après insertion des lignes pour déclencher la facture automatique.
CREATE OR REPLACE FUNCTION public.post_delivery(_so_id uuid, _lines jsonb) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _s public.sales_orders%ROWTYPE;
  _dn_id uuid;
  _dn_number text;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _line jsonb;
  _so_line public.so_lines%ROWTYPE;
  _quantity numeric;
BEGIN
  IF NOT public.has_sales_perm(auth.uid(), 'deliver') THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _s FROM public.sales_orders
   WHERE id = _so_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commande introuvable dans la société active'; END IF;
  IF _s.status NOT IN ('confirmed', 'partially_delivered') THEN
    RAISE EXCEPTION 'La commande doit être confirmée avant livraison';
  END IF;
  IF jsonb_typeof(_lines) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Les lignes de livraison doivent être un tableau JSON';
  END IF;
  IF jsonb_array_length(_lines) = 0 THEN
    RAISE EXCEPTION 'Au moins une ligne de livraison est requise';
  END IF;

  INSERT INTO public.delivery_notes
    (tenant_id, dn_number, so_id, customer_id, delivery_date, status, created_by, delivered_by)
  VALUES (_tenant, '', _so_id, _s.customer_id, CURRENT_DATE, 'draft', auth.uid(), auth.uid())
  RETURNING id INTO _dn_id;
  SELECT dn_number INTO _dn_number FROM public.delivery_notes WHERE id = _dn_id;

  FOR _line IN SELECT value FROM jsonb_array_elements(_lines) AS lines(value) LOOP
    IF NULLIF(_line->>'so_line_id', '') IS NULL THEN
      RAISE EXCEPTION 'Identifiant de ligne de commande manquant';
    END IF;
    _quantity := NULLIF(_line->>'quantity', '')::numeric;
    IF _quantity IS NULL OR _quantity <= 0 THEN
      RAISE EXCEPTION 'La quantité livrée doit être positive';
    END IF;

    SELECT * INTO _so_line FROM public.so_lines
     WHERE id = (_line->>'so_line_id')::uuid AND so_id = _so_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'La ligne ne fait pas partie de cette commande'; END IF;
    IF _so_line.quantity_delivered + _quantity > _so_line.quantity THEN
      RAISE EXCEPTION 'La quantité livrée dépasse le reliquat de la ligne';
    END IF;
    IF _so_line.item_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.items WHERE id = _so_line.item_id AND tenant_id = _tenant
    ) THEN
      RAISE EXCEPTION 'Article de la ligne hors de la société active';
    END IF;

    INSERT INTO public.dn_lines(dn_id, so_line_id, item_id, description, quantity, unit_price)
    VALUES (_dn_id, _so_line.id, _so_line.item_id, _so_line.description, _quantity, _so_line.unit_price);
    UPDATE public.so_lines SET quantity_delivered = quantity_delivered + _quantity WHERE id = _so_line.id;

    IF _so_line.item_id IS NOT NULL THEN
      UPDATE public.items SET quantity_on_hand = quantity_on_hand - _quantity
       WHERE id = _so_line.item_id AND tenant_id = _tenant;
      INSERT INTO public.stock_movements
        (tenant_id, item_id, movement_type, quantity, reference_type, reference_id, created_by)
      VALUES (_tenant, _so_line.item_id, 'delivery', -_quantity, 'delivery_note', _dn_id, auth.uid());
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM public.so_lines WHERE so_id = _so_id AND quantity_delivered < quantity
  ) THEN
    UPDATE public.sales_orders SET status = 'delivered' WHERE id = _so_id;
  ELSE
    UPDATE public.sales_orders SET status = 'partially_delivered' WHERE id = _so_id;
  END IF;

  -- The existing BEFORE status trigger now sees dn_lines and can create the invoice.
  UPDATE public.delivery_notes SET status = 'completed' WHERE id = _dn_id;
  PERFORM public.notify_sales(_tenant, 'info', 'Livraison enregistrée', _dn_number || ' pour ' || _s.so_number, _dn_id::text);
  RETURN _dn_id;
END;
$$;

DO $$
DECLARE
  _duplicates text;
BEGIN
  SELECT string_agg(label, ', ') INTO _duplicates
  FROM (
    SELECT 'devis ' || quote_number AS label FROM public.quotations
      GROUP BY tenant_id, quote_number HAVING count(*) > 1
    UNION ALL
    SELECT 'commande ' || so_number FROM public.sales_orders
      GROUP BY tenant_id, so_number HAVING count(*) > 1
    UNION ALL
    SELECT 'livraison ' || dn_number FROM public.delivery_notes
      GROUP BY tenant_id, dn_number HAVING count(*) > 1
  ) duplicates;
  IF _duplicates IS NOT NULL THEN
    RAISE EXCEPTION 'Références commerciales en doublon : %', _duplicates;
  END IF;
END;
$$;

CREATE TABLE public.sales_numbering_series (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  doc_type text NOT NULL CHECK (doc_type IN ('quotation', 'sales_order', 'delivery_note')),
  prefix text NOT NULL,
  format text NOT NULL DEFAULT 'PREFIX-YYYY-####',
  next_number integer NOT NULL DEFAULT 1 CHECK (next_number > 0),
  reset_frequency text NOT NULL DEFAULT 'yearly' CHECK (reset_frequency IN ('yearly', 'never')),
  CHECK (format LIKE '%PREFIX%' AND format ~ '#+' AND (reset_frequency = 'never' OR format ~ 'YYYY|YY')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, doc_type)
);

ALTER TABLE public.quotations ALTER COLUMN quote_number DROP DEFAULT;
ALTER TABLE public.sales_orders ALTER COLUMN so_number DROP DEFAULT;

ALTER TABLE public.sales_numbering_series ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant read" ON public.sales_numbering_series FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Tenant admin update" ON public.sales_numbering_series FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'::public.app_role));
REVOKE ALL ON public.sales_numbering_series FROM authenticated;
GRANT SELECT, UPDATE ON public.sales_numbering_series TO authenticated;

-- Sales workflow and SLA parameters are company controls; only its administrator may edit them.
DROP POLICY IF EXISTS "tenant rw sales_settings" ON public.sales_settings;
CREATE POLICY "Tenant read" ON public.sales_settings FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Tenant admin update" ON public.sales_settings FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'::public.app_role));
REVOKE ALL ON public.sales_settings FROM authenticated;
GRANT SELECT, UPDATE ON public.sales_settings TO authenticated;

INSERT INTO public.sales_numbering_series (tenant_id, doc_type, prefix, format)
SELECT tenants.id, series.doc_type, series.prefix, 'PREFIX-YYYY-####'
FROM public.tenants
CROSS JOIN (VALUES ('quotation', 'QT'), ('sales_order', 'SO'), ('delivery_note', 'DN')) AS series(doc_type, prefix)
ON CONFLICT (tenant_id, doc_type) DO NOTHING;

CREATE FUNCTION public.next_sales_document_number(_tenant uuid, _doc_type text, _date date) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public'
  AS $$
DECLARE
  _series public.sales_numbering_series%ROWTYPE;
  _period text;
  _number integer;
  _result text;
  _width integer;
  _legacy_prefix text;
  _legacy_max integer := 0;
BEGIN
  SELECT * INTO _series
  FROM public.sales_numbering_series
  WHERE tenant_id = _tenant AND doc_type = _doc_type
  FOR UPDATE;
  IF NOT FOUND THEN
    -- Société créée après V40 (l'alimentation ci-dessus ne couvre que les sociétés existantes) :
    -- sa série par défaut est créée à sa première pièce, modifiable ensuite par l'administrateur.
    IF _doc_type NOT IN ('quotation', 'sales_order', 'delivery_note') THEN
      RAISE EXCEPTION 'Type de pièce de vente inconnu : %', _doc_type USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.sales_numbering_series (tenant_id, doc_type, prefix, format)
    VALUES (_tenant, _doc_type, CASE _doc_type WHEN 'quotation' THEN 'QT' WHEN 'sales_order' THEN 'SO' ELSE 'DN' END,
            'PREFIX-YYYY-####')
    ON CONFLICT (tenant_id, doc_type) DO NOTHING;
    SELECT * INTO _series
    FROM public.sales_numbering_series
    WHERE tenant_id = _tenant AND doc_type = _doc_type
    FOR UPDATE;
  END IF;

  _period := CASE WHEN _series.reset_frequency = 'yearly' THEN to_char(_date, 'YYYY') ELSE 'ALL' END;
  _legacy_prefix := rtrim(_series.prefix, '-') || '-' || to_char(_date, 'YYYY') || '-';
  CASE _doc_type
    WHEN 'quotation' THEN
      SELECT max(CASE WHEN suffix ~ '^[0-9]+$' THEN suffix::integer END) INTO _legacy_max FROM (
        SELECT substring(q.quote_number FROM length(_legacy_prefix) + 1) AS suffix
          FROM public.quotations q
         WHERE q.tenant_id = _tenant AND left(q.quote_number, length(_legacy_prefix)) = _legacy_prefix
      ) refs;
    WHEN 'sales_order' THEN
      SELECT max(CASE WHEN suffix ~ '^[0-9]+$' THEN suffix::integer END) INTO _legacy_max FROM (
        SELECT substring(s.so_number FROM length(_legacy_prefix) + 1) AS suffix
          FROM public.sales_orders s
         WHERE s.tenant_id = _tenant AND left(s.so_number, length(_legacy_prefix)) = _legacy_prefix
      ) refs;
    WHEN 'delivery_note' THEN
      SELECT max(CASE WHEN suffix ~ '^[0-9]+$' THEN suffix::integer END) INTO _legacy_max FROM (
        SELECT substring(d.dn_number FROM length(_legacy_prefix) + 1) AS suffix
          FROM public.delivery_notes d
         WHERE d.tenant_id = _tenant AND left(d.dn_number, length(_legacy_prefix)) = _legacy_prefix
      ) refs;
  END CASE;

  INSERT INTO public.document_counters (tenant_id, doc_type, period, next_number)
  VALUES (_tenant, 'sales:' || _doc_type, _period,
    GREATEST(_series.next_number, COALESCE(_legacy_max, 0) + 1, 1))
  ON CONFLICT (tenant_id, doc_type, period) DO NOTHING;

  UPDATE public.document_counters
  SET next_number = document_counters.next_number + 1
  WHERE tenant_id = _tenant AND doc_type = 'sales:' || _doc_type AND period = _period
  RETURNING document_counters.next_number - 1 INTO _number;

  _result := replace(_series.format, 'YYYY', to_char(_date, 'YYYY'));
  _result := replace(_result, 'YY', to_char(_date, 'YY'));
  _result := replace(_result, 'MM', to_char(_date, 'MM'));
  _result := replace(_result, 'PREFIX', rtrim(_series.prefix, '-'));
  _width := length(substring(_result FROM '#+'));
  IF _width IS NULL THEN
    _result := _result || _number::text;
  ELSE
    _result := regexp_replace(_result, '#+', lpad(_number::text, GREATEST(_width, length(_number::text)), '0'));
  END IF;
  RETURN _result;
END;
$$;

CREATE FUNCTION public.assign_sales_document_number() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public'
  AS $$
DECLARE
  _doc_type text;
  _doc_date date;
  _old_number text;
  _new_number text;
BEGIN
  IF TG_TABLE_NAME = 'quotations' THEN
    _doc_type := 'quotation';
    _doc_date := COALESCE(NEW.quote_date, CURRENT_DATE);
    IF TG_OP = 'UPDATE' THEN _old_number := OLD.quote_number; _new_number := NEW.quote_number; END IF;
  ELSIF TG_TABLE_NAME = 'sales_orders' THEN
    _doc_type := 'sales_order';
    _doc_date := COALESCE(NEW.order_date, CURRENT_DATE);
    IF TG_OP = 'UPDATE' THEN _old_number := OLD.so_number; _new_number := NEW.so_number; END IF;
  ELSE
    _doc_type := 'delivery_note';
    _doc_date := COALESCE(NEW.delivery_date, CURRENT_DATE);
    IF TG_OP = 'UPDATE' THEN _old_number := OLD.dn_number; _new_number := NEW.dn_number; END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Colonnes lues dans la branche de LEUR table (ci-dessus) : une expression qui nomme les
    -- colonnes des trois tables échoue sur chacune (« record "new" has no field », cf. V30).
    IF _new_number IS DISTINCT FROM _old_number THEN
      RAISE EXCEPTION 'La référence du document émis ne peut pas être modifiée (%)', _old_number
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF _doc_type = 'quotation' THEN
    NEW.quote_number := public.next_sales_document_number(NEW.tenant_id, _doc_type, _doc_date);
  ELSIF _doc_type = 'sales_order' THEN
    NEW.so_number := public.next_sales_document_number(NEW.tenant_id, _doc_type, _doc_date);
  ELSE
    NEW.dn_number := public.next_sales_document_number(NEW.tenant_id, _doc_type, _doc_date);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_assign_sales_document_number BEFORE INSERT OR UPDATE ON public.quotations
  FOR EACH ROW EXECUTE FUNCTION public.assign_sales_document_number();
CREATE TRIGGER trg_assign_sales_document_number BEFORE INSERT OR UPDATE ON public.sales_orders
  FOR EACH ROW EXECUTE FUNCTION public.assign_sales_document_number();
CREATE TRIGGER trg_assign_sales_document_number BEFORE INSERT OR UPDATE ON public.delivery_notes
  FOR EACH ROW EXECUTE FUNCTION public.assign_sales_document_number();

CREATE FUNCTION public.create_sales_quotation(
  _customer_id uuid, _quote_date date, _valid_until date, _lines jsonb
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _quote_id uuid;
  _line jsonb;
  _description text;
  _quantity numeric;
  _unit_price numeric;
  _item_id uuid;
  _total numeric := 0;
BEGIN
  IF NOT public.has_sales_perm(auth.uid(), 'create') THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = _customer_id AND tenant_id = _tenant) THEN
    RAISE EXCEPTION 'Client introuvable dans la société active';
  END IF;
  IF _quote_date IS NULL OR _valid_until IS NULL OR _valid_until < _quote_date THEN
    RAISE EXCEPTION 'La date de validité doit être égale ou postérieure à la date du devis';
  END IF;
  IF jsonb_typeof(_lines) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Les lignes du devis doivent être un tableau JSON';
  END IF;
  IF jsonb_array_length(_lines) = 0 THEN RAISE EXCEPTION 'Le devis doit contenir au moins une ligne'; END IF;

  FOR _line IN SELECT value FROM jsonb_array_elements(_lines) AS lines(value) LOOP
    _description := NULLIF(btrim(_line->>'description'), '');
    _quantity := NULLIF(_line->>'quantity', '')::numeric;
    _unit_price := NULLIF(_line->>'unit_price', '')::numeric;
    _item_id := NULLIF(_line->>'item_id', '')::uuid;
    IF _description IS NULL OR _quantity IS NULL OR _quantity <= 0 OR _unit_price IS NULL OR _unit_price < 0 THEN
      RAISE EXCEPTION 'Chaque ligne doit avoir une désignation, une quantité positive et un prix non négatif';
    END IF;
    IF _item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.items WHERE id = _item_id AND tenant_id = _tenant) THEN
      RAISE EXCEPTION 'Article introuvable dans la société active';
    END IF;
    _total := _total + round(_quantity * _unit_price, 2);
  END LOOP;

  INSERT INTO public.quotations
    (tenant_id, quote_number, customer_id, quote_date, valid_until, total, created_by)
  VALUES (_tenant, '', _customer_id, _quote_date, _valid_until, _total, auth.uid())
  RETURNING id INTO _quote_id;

  FOR _line IN SELECT value FROM jsonb_array_elements(_lines) AS lines(value) LOOP
    INSERT INTO public.quote_lines (quotation_id, item_id, description, quantity, unit_price)
    VALUES (_quote_id, NULLIF(_line->>'item_id', '')::uuid, btrim(_line->>'description'),
            (_line->>'quantity')::numeric, (_line->>'unit_price')::numeric);
  END LOOP;
  RETURN _quote_id;
END;
$$;

CREATE FUNCTION public.create_sales_order(
  _customer_id uuid, _order_date date, _lines jsonb
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _so_id uuid;
  _line jsonb;
  _description text;
  _quantity numeric;
  _unit_price numeric;
  _item_id uuid;
  _total numeric := 0;
BEGIN
  IF NOT public.has_sales_perm(auth.uid(), 'create') THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = _customer_id AND tenant_id = _tenant) THEN
    RAISE EXCEPTION 'Client introuvable dans la société active';
  END IF;
  IF _order_date IS NULL THEN RAISE EXCEPTION 'La date de commande est requise'; END IF;
  IF jsonb_typeof(_lines) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Les lignes de la commande doivent être un tableau JSON';
  END IF;
  IF jsonb_array_length(_lines) = 0 THEN RAISE EXCEPTION 'La commande doit contenir au moins une ligne'; END IF;

  FOR _line IN SELECT value FROM jsonb_array_elements(_lines) AS lines(value) LOOP
    _description := NULLIF(btrim(_line->>'description'), '');
    _quantity := NULLIF(_line->>'quantity', '')::numeric;
    _unit_price := NULLIF(_line->>'unit_price', '')::numeric;
    _item_id := NULLIF(_line->>'item_id', '')::uuid;
    IF _description IS NULL OR _quantity IS NULL OR _quantity <= 0 OR _unit_price IS NULL OR _unit_price < 0 THEN
      RAISE EXCEPTION 'Chaque ligne doit avoir une désignation, une quantité positive et un prix non négatif';
    END IF;
    IF _item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.items WHERE id = _item_id AND tenant_id = _tenant) THEN
      RAISE EXCEPTION 'Article introuvable dans la société active';
    END IF;
    _total := _total + round(_quantity * _unit_price, 2);
  END LOOP;

  INSERT INTO public.sales_orders
    (tenant_id, so_number, customer_id, order_date, total, status, created_by)
  VALUES (_tenant, '', _customer_id, _order_date, _total, 'draft', auth.uid())
  RETURNING id INTO _so_id;

  FOR _line IN SELECT value FROM jsonb_array_elements(_lines) AS lines(value) LOOP
    INSERT INTO public.so_lines (so_id, item_id, description, quantity, unit_price)
    VALUES (_so_id, NULLIF(_line->>'item_id', '')::uuid, btrim(_line->>'description'),
            (_line->>'quantity')::numeric, (_line->>'unit_price')::numeric);
  END LOOP;
  RETURN _so_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.convert_opportunity_to_quote(
  _opp_id uuid, _customer_id uuid DEFAULT NULL, _valid_until date DEFAULT NULL
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _opp public.crm_opportunities%ROWTYPE;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _customer uuid;
  _quote_id uuid;
  _quote_number text;
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'no_tenant'; END IF;
  SELECT * INTO _opp FROM public.crm_opportunities WHERE id = _opp_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'opportunity_not_found'; END IF;
  IF _opp.converted_quotation_id IS NOT NULL THEN RETURN _opp.converted_quotation_id; END IF;
  IF _opp.stage <> 'won' THEN RAISE EXCEPTION 'opportunity_not_won'; END IF;
  IF NOT public.has_permission(auth.uid(), 'crm.convert') THEN RAISE EXCEPTION 'insufficient_role'; END IF;

  _customer := COALESCE(_customer_id, _opp.customer_id);
  IF _customer IS NULL THEN RAISE EXCEPTION 'customer_required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = _customer AND tenant_id = _tenant) THEN
    RAISE EXCEPTION 'customer_invalid_tenant';
  END IF;
  IF COALESCE(_valid_until, CURRENT_DATE + 30) < CURRENT_DATE THEN
    RAISE EXCEPTION 'valid_until_in_past';
  END IF;

  INSERT INTO public.quotations
    (tenant_id, quote_number, customer_id, quote_date, valid_until, total, status, created_by)
  VALUES (_tenant, '', _customer, CURRENT_DATE, COALESCE(_valid_until, CURRENT_DATE + 30),
          COALESCE(_opp.amount, 0), 'draft', auth.uid())
  RETURNING id, quote_number INTO _quote_id, _quote_number;
  INSERT INTO public.quote_lines (quotation_id, description, quantity, unit_price)
  VALUES (_quote_id, _opp.name, 1, COALESCE(_opp.amount, 0));

  UPDATE public.crm_opportunities
     SET converted_quotation_id = _quote_id, customer_id = _customer, status = 'closed', updated_at = now()
   WHERE id = _opp_id;
  INSERT INTO public.crm_activities (tenant_id, opportunity_id, contact_id, type, subject, notes, created_by)
  VALUES (_tenant, _opp_id, _opp.contact_id, 'conversion', 'Converti en devis ' || _quote_number,
          'Quotation ' || _quote_id::text || ' · Montant ' || COALESCE(_opp.amount, 0)::text || ' ' || _opp.currency,
          auth.uid());
  RETURN _quote_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_quote_to_so(_quote_id uuid) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _q public.quotations%ROWTYPE;
  _so_id uuid;
  _so_number text;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF NOT public.has_sales_perm(auth.uid(), 'confirm') THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _q FROM public.quotations WHERE id = _quote_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quote not found'; END IF;
  IF _q.status NOT IN ('accepted', 'sent', 'draft') THEN
    RAISE EXCEPTION 'Quote status invalid: %', _q.status;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.quote_lines WHERE quotation_id = _quote_id) THEN
    RAISE EXCEPTION 'Quote has no lines';
  END IF;

  INSERT INTO public.sales_orders
    (tenant_id, so_number, quotation_id, customer_id, order_date, total, status, created_by)
  VALUES (_tenant, '', _q.id, _q.customer_id, CURRENT_DATE, COALESCE(_q.total, 0), 'draft', auth.uid())
  RETURNING id, so_number INTO _so_id, _so_number;
  INSERT INTO public.so_lines (so_id, item_id, description, quantity, unit_price, total)
  SELECT _so_id, ql.item_id, ql.description, ql.quantity, ql.unit_price, ql.total
    FROM public.quote_lines ql WHERE ql.quotation_id = _quote_id;
  UPDATE public.quotations SET status = 'converted' WHERE id = _quote_id;
  PERFORM public.notify_sales(_tenant, 'info', 'Devis converti en commande', _q.quote_number || ' → ' || _so_number, _so_id::text);
  RETURN _so_id;
END;
$$;

REVOKE ALL ON FUNCTION public.convert_opportunity_to_quote(uuid, uuid, date),
  public.confirm_quote_to_so(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.convert_opportunity_to_quote(uuid, uuid, date),
  public.confirm_quote_to_so(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.convert_quote_to_so(_quote_id uuid) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _so_id uuid;
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'no_tenant'; END IF;
  IF NOT public.has_sales_perm(auth.uid(), 'confirm') THEN RAISE EXCEPTION 'insufficient_role'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.quotations WHERE id = _quote_id AND tenant_id = _tenant) THEN
    RAISE EXCEPTION 'quote_not_found';
  END IF;

  SELECT id INTO _so_id FROM public.sales_orders
   WHERE quotation_id = _quote_id AND tenant_id = _tenant LIMIT 1;
  IF _so_id IS NULL THEN
    _so_id := public.confirm_quote_to_so(_quote_id);
    INSERT INTO public.crm_activities (tenant_id, opportunity_id, type, subject, notes, created_by, completed_at)
    SELECT _tenant, o.id, 'so_conversion', 'Devis converti en bon de commande',
           'quote_id=' || _quote_id::text || ' so_id=' || _so_id::text, auth.uid(), now()
      FROM public.crm_opportunities o
     WHERE o.converted_quotation_id = _quote_id AND o.tenant_id = _tenant;
  END IF;
  RETURN _so_id;
END;
$$;

REVOKE ALL ON FUNCTION public.convert_quote_to_so(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.convert_quote_to_so(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.create_sales_quotation(uuid, date, date, jsonb),
  public.create_sales_order(uuid, date, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sales_quotation(uuid, date, date, jsonb),
  public.create_sales_order(uuid, date, jsonb) TO authenticated;

-- Business state and line edits go through the permission-checked, atomic RPCs above.
REVOKE INSERT, UPDATE, DELETE ON public.quotations, public.quote_lines,
  public.sales_orders, public.so_lines, public.delivery_notes, public.dn_lines FROM authenticated;

CREATE UNIQUE INDEX quotations_tenant_number_key ON public.quotations (tenant_id, quote_number);
CREATE UNIQUE INDEX sales_orders_tenant_number_key ON public.sales_orders (tenant_id, so_number);
CREATE UNIQUE INDEX delivery_notes_tenant_number_key ON public.delivery_notes (tenant_id, dn_number);

REVOKE ALL ON FUNCTION public.next_sales_document_number(uuid, text, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assign_sales_document_number() FROM PUBLIC, anon, authenticated;
