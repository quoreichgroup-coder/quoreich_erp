-- V43 — Ventes : pièces commerciales complètes (audit docs/audit-erp : R-O2C-02, R-O2C-04 / G-24,
-- R-O2C-06, reste de G-07).
--
-- Avant V43 : les lignes de devis, de commande et de livraison n'avaient ni remise ni code TVA, les
-- en-têtes ne portaient qu'un total hors taxe ; la facture préparée depuis une livraison (V42)
-- devait donc recevoir ses codes TVA à la main ; un devis expiré se convertissait ; la limite de
-- crédit du client ne faisait qu'émettre une notification.
--
-- Règles posées :
--   1. Chaque ligne de devis, commande ou livraison porte une remise (0–100 %) et un code TVA de la
--      société ; la base calcule HT = ROUND(qté × prix × (1 − remise/100), 2) et TVA = ROUND(HT ×
--      taux/100, 2), comme la facture (V21). `total` reste le HT (les vues de pilotage en dépendent) ;
--      l'en-tête gagne `tax_amount` et `total_ttc` (calculé).
--   2. Devis → commande → livraison → facture brouillon : remise et code TVA suivent la pièce ; la
--      facture issue de la livraison arrive avec sa TVA (un code devenu inactif est laissé vide).
--   3. Un devis dont la date de validité est passée ne se convertit pas (QG010).
--   4. Confirmation d'une commande : si encours client (factures émises non soldées) + TTC de la
--      commande > limite de crédit, refus QG010 ; levée possible seulement avec le droit
--      sales.credit_override et un motif, tracés sur la commande. Une commande se confirme une fois,
--      depuis le brouillon.

-- ─── 1. Droit de levée du blocage crédit ───
INSERT INTO public.erp_permission_catalog (code, module, action, label)
VALUES ('sales.credit_override', 'sales', 'credit_override', 'Confirmer une commande au-delà de la limite de crédit du client')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
SELECT r, 'sales.credit_override' FROM (VALUES ('admin'), ('sales_manager')) AS v(r)
WHERE EXISTS (SELECT 1 FROM public.erp_system_roles s WHERE s.code = v.r)
ON CONFLICT DO NOTHING;

SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, sp.permission_code
  FROM public.erp_roles r
  JOIN public.erp_system_role_permissions sp ON sp.role_code = r.code
 WHERE sp.permission_code = 'sales.credit_override' AND r.is_system
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

-- ─── 2. Colonnes ───
ALTER TABLE public.quote_lines
  ADD COLUMN discount_pct numeric(5,2) NOT NULL DEFAULT 0 CONSTRAINT quote_lines_discount_pct_check CHECK (discount_pct BETWEEN 0 AND 100),
  ADD COLUMN tax_code_id uuid REFERENCES public.tax_codes(id),
  ADD COLUMN tax_amount numeric(18,2) NOT NULL DEFAULT 0;
ALTER TABLE public.so_lines
  ADD COLUMN discount_pct numeric(5,2) NOT NULL DEFAULT 0 CONSTRAINT so_lines_discount_pct_check CHECK (discount_pct BETWEEN 0 AND 100),
  ADD COLUMN tax_code_id uuid REFERENCES public.tax_codes(id),
  ADD COLUMN tax_amount numeric(18,2) NOT NULL DEFAULT 0;
ALTER TABLE public.dn_lines
  ADD COLUMN discount_pct numeric(5,2) NOT NULL DEFAULT 0 CONSTRAINT dn_lines_discount_pct_check CHECK (discount_pct BETWEEN 0 AND 100),
  ADD COLUMN tax_code_id uuid REFERENCES public.tax_codes(id),
  ADD COLUMN tax_amount numeric(18,2) NOT NULL DEFAULT 0;
CREATE INDEX quote_lines_tax_code_id_idx ON public.quote_lines (tax_code_id);
CREATE INDEX so_lines_tax_code_id_idx ON public.so_lines (tax_code_id);
CREATE INDEX dn_lines_tax_code_id_idx ON public.dn_lines (tax_code_id);

ALTER TABLE public.quotations
  ADD COLUMN tax_amount numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN total_ttc numeric(18,2) GENERATED ALWAYS AS (COALESCE(total, 0) + tax_amount) STORED;
ALTER TABLE public.sales_orders
  ADD COLUMN tax_amount numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN total_ttc numeric(18,2) GENERATED ALWAYS AS (COALESCE(total, 0) + tax_amount) STORED,
  ADD COLUMN credit_override_by uuid,
  ADD COLUMN credit_override_reason text,
  ADD COLUMN credit_override_at timestamptz;

-- ─── 3. Calcul des lignes (une fonction par table : pas de lecture croisée de NEW, cf. V30) ───
CREATE OR REPLACE FUNCTION public.sales_line_tax_rate(_tax_code_id uuid, _tenant uuid, _changed boolean)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  _rate numeric; _active boolean; _code_tenant uuid;
BEGIN
  IF _tax_code_id IS NULL THEN RETURN 0; END IF;
  SELECT rate, is_active, tenant_id INTO _rate, _active, _code_tenant FROM public.tax_codes WHERE id = _tax_code_id;
  IF _code_tenant IS DISTINCT FROM _tenant THEN
    RAISE EXCEPTION 'Code TVA inconnu dans la société' USING ERRCODE = '23514';
  END IF;
  IF _changed AND NOT _active THEN
    RAISE EXCEPTION 'Code TVA inactif : il ne peut plus être utilisé' USING ERRCODE = '23514';
  END IF;
  RETURN COALESCE(_rate, 0);
END; $function$;

REVOKE ALL ON FUNCTION public.sales_line_tax_rate(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.compute_quote_line_total()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  _rate numeric := public.sales_line_tax_rate(NEW.tax_code_id,
    (SELECT tenant_id FROM public.quotations WHERE id = NEW.quotation_id),
    TG_OP = 'INSERT' OR NEW.tax_code_id IS DISTINCT FROM OLD.tax_code_id);
BEGIN
  NEW.discount_pct := COALESCE(NEW.discount_pct, 0);
  NEW.total := ROUND((COALESCE(NEW.quantity, 0) * COALESCE(NEW.unit_price, 0) * (1 - NEW.discount_pct / 100))::numeric, 2);
  NEW.tax_amount := ROUND((NEW.total * _rate / 100)::numeric, 2);
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.compute_so_line_total()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  _rate numeric := public.sales_line_tax_rate(NEW.tax_code_id,
    (SELECT tenant_id FROM public.sales_orders WHERE id = NEW.so_id),
    TG_OP = 'INSERT' OR NEW.tax_code_id IS DISTINCT FROM OLD.tax_code_id);
BEGIN
  NEW.discount_pct := COALESCE(NEW.discount_pct, 0);
  NEW.total := ROUND((COALESCE(NEW.quantity, 0) * COALESCE(NEW.unit_price, 0) * (1 - NEW.discount_pct / 100))::numeric, 2);
  NEW.tax_amount := ROUND((NEW.total * _rate / 100)::numeric, 2);
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.compute_dn_line_total()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  _rate numeric := public.sales_line_tax_rate(NEW.tax_code_id,
    (SELECT tenant_id FROM public.delivery_notes WHERE id = NEW.dn_id),
    TG_OP = 'INSERT' OR NEW.tax_code_id IS DISTINCT FROM OLD.tax_code_id);
BEGIN
  NEW.discount_pct := COALESCE(NEW.discount_pct, 0);
  NEW.total := ROUND((COALESCE(NEW.quantity, 0) * COALESCE(NEW.unit_price, 0) * (1 - NEW.discount_pct / 100))::numeric, 2);
  NEW.tax_amount := ROUND((NEW.total * _rate / 100)::numeric, 2);
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.recompute_quote_total()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _q uuid;
BEGIN
  _q := COALESCE(NEW.quotation_id, OLD.quotation_id);
  UPDATE public.quotations q
     SET total = s.net, tax_amount = s.tax
    FROM (SELECT COALESCE(SUM(total), 0) AS net, COALESCE(SUM(tax_amount), 0) AS tax
            FROM public.quote_lines WHERE quotation_id = _q) s
   WHERE q.id = _q;
  RETURN COALESCE(NEW, OLD);
END $function$;

CREATE OR REPLACE FUNCTION public.recompute_so_total()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _s uuid;
BEGIN
  _s := COALESCE(NEW.so_id, OLD.so_id);
  UPDATE public.sales_orders o
     SET total = s.net, tax_amount = s.tax
    FROM (SELECT COALESCE(SUM(total), 0) AS net, COALESCE(SUM(tax_amount), 0) AS tax
            FROM public.so_lines WHERE so_id = _s) s
   WHERE o.id = _s;
  RETURN COALESCE(NEW, OLD);
END $function$;

-- ─── 4. Création des pièces : remise et code TVA par ligne ───
CREATE OR REPLACE FUNCTION public.sales_check_lines(_tenant uuid, _lines jsonb, _what text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  _line jsonb;
  _quantity numeric; _unit_price numeric; _discount numeric; _item_id uuid; _tax uuid;
BEGIN
  IF jsonb_typeof(_lines) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Les lignes % doivent être un tableau JSON', _what;
  END IF;
  IF jsonb_array_length(_lines) = 0 THEN
    RAISE EXCEPTION 'La pièce (%) doit contenir au moins une ligne', _what;
  END IF;
  FOR _line IN SELECT value FROM jsonb_array_elements(_lines) AS lines(value) LOOP
    _quantity := NULLIF(_line->>'quantity', '')::numeric;
    _unit_price := NULLIF(_line->>'unit_price', '')::numeric;
    _discount := COALESCE(NULLIF(_line->>'discount_pct', '')::numeric, 0);
    _item_id := NULLIF(_line->>'item_id', '')::uuid;
    _tax := NULLIF(_line->>'tax_code_id', '')::uuid;
    IF NULLIF(btrim(_line->>'description'), '') IS NULL OR _quantity IS NULL OR _quantity <= 0
       OR _unit_price IS NULL OR _unit_price < 0 THEN
      RAISE EXCEPTION 'Chaque ligne doit avoir une désignation, une quantité positive et un prix non négatif';
    END IF;
    IF _discount < 0 OR _discount > 100 THEN
      RAISE EXCEPTION 'La remise d''une ligne est comprise entre 0 et 100 %%';
    END IF;
    IF _item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.items WHERE id = _item_id AND tenant_id = _tenant) THEN
      RAISE EXCEPTION 'Article introuvable dans la société active';
    END IF;
    IF _tax IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.tax_codes WHERE id = _tax AND tenant_id = _tenant AND is_active) THEN
      RAISE EXCEPTION 'Code TVA inconnu ou inactif dans la société active';
    END IF;
  END LOOP;
END; $function$;

REVOKE ALL ON FUNCTION public.sales_check_lines(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_sales_quotation(_customer_id uuid, _quote_date date, _valid_until date, _lines jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _quote_id uuid;
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
  PERFORM public.sales_check_lines(_tenant, _lines, 'du devis');
  INSERT INTO public.quotations (tenant_id, quote_number, customer_id, quote_date, valid_until, total, created_by)
  VALUES (_tenant, '', _customer_id, _quote_date, _valid_until, 0, auth.uid())
  RETURNING id INTO _quote_id;
  INSERT INTO public.quote_lines (quotation_id, item_id, description, quantity, unit_price, discount_pct, tax_code_id)
  SELECT _quote_id, NULLIF(l->>'item_id', '')::uuid, btrim(l->>'description'), (l->>'quantity')::numeric,
         (l->>'unit_price')::numeric, COALESCE(NULLIF(l->>'discount_pct', '')::numeric, 0), NULLIF(l->>'tax_code_id', '')::uuid
    FROM jsonb_array_elements(_lines) WITH ORDINALITY AS t(l, n) ORDER BY n;
  RETURN _quote_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_sales_order(_customer_id uuid, _order_date date, _lines jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _so_id uuid;
BEGIN
  IF NOT public.has_sales_perm(auth.uid(), 'create') THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = _customer_id AND tenant_id = _tenant) THEN
    RAISE EXCEPTION 'Client introuvable dans la société active';
  END IF;
  IF _order_date IS NULL THEN RAISE EXCEPTION 'La date de commande est requise'; END IF;
  PERFORM public.sales_check_lines(_tenant, _lines, 'de la commande');
  INSERT INTO public.sales_orders (tenant_id, so_number, customer_id, order_date, total, status, created_by)
  VALUES (_tenant, '', _customer_id, _order_date, 0, 'draft', auth.uid())
  RETURNING id INTO _so_id;
  INSERT INTO public.so_lines (so_id, item_id, description, quantity, unit_price, discount_pct, tax_code_id)
  SELECT _so_id, NULLIF(l->>'item_id', '')::uuid, btrim(l->>'description'), (l->>'quantity')::numeric,
         (l->>'unit_price')::numeric, COALESCE(NULLIF(l->>'discount_pct', '')::numeric, 0), NULLIF(l->>'tax_code_id', '')::uuid
    FROM jsonb_array_elements(_lines) WITH ORDINALITY AS t(l, n) ORDER BY n;
  RETURN _so_id;
END;
$function$;

-- ─── 5. Devis → commande : validité, remise et TVA reprises ───
CREATE OR REPLACE FUNCTION public.confirm_quote_to_so(_quote_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  IF NOT FOUND THEN RAISE EXCEPTION 'Devis introuvable dans la société active'; END IF;
  IF _q.status NOT IN ('accepted', 'sent', 'draft') THEN
    RAISE EXCEPTION 'Ce devis ne peut plus être converti (statut %)', _q.status;
  END IF;
  IF _q.valid_until IS NOT NULL AND _q.valid_until < CURRENT_DATE THEN
    RAISE EXCEPTION 'Devis % expiré le % : établir un nouveau devis', _q.quote_number, to_char(_q.valid_until, 'DD/MM/YYYY')
      USING ERRCODE = 'QG010';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.quote_lines WHERE quotation_id = _quote_id) THEN
    RAISE EXCEPTION 'Le devis n''a aucune ligne';
  END IF;
  INSERT INTO public.sales_orders
    (tenant_id, so_number, quotation_id, customer_id, order_date, total, status, created_by)
  VALUES (_tenant, '', _q.id, _q.customer_id, CURRENT_DATE, 0, 'draft', auth.uid())
  RETURNING id, so_number INTO _so_id, _so_number;
  INSERT INTO public.so_lines (so_id, item_id, description, quantity, unit_price, discount_pct, tax_code_id)
  SELECT _so_id, ql.item_id, ql.description, ql.quantity, ql.unit_price, ql.discount_pct,
         CASE WHEN tc.is_active THEN ql.tax_code_id END
    FROM public.quote_lines ql LEFT JOIN public.tax_codes tc ON tc.id = ql.tax_code_id
   WHERE ql.quotation_id = _quote_id
   ORDER BY ql.created_at, ql.id;
  UPDATE public.quotations SET status = 'converted' WHERE id = _quote_id;
  PERFORM public.notify_sales(_tenant, 'info', 'Devis converti en commande', _q.quote_number || ' → ' || _so_number, _so_id::text);
  RETURN _so_id;
END;
$function$;

-- ─── 6. Limite de crédit bloquante ───
CREATE OR REPLACE FUNCTION public.customer_credit_exposure(_customer_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(total - amount_paid), 0)
    FROM public.ar_invoices
   WHERE customer_id = _customer_id
     AND status NOT IN ('draft', 'paid', 'cancelled');
$function$;

REVOKE ALL ON FUNCTION public.customer_credit_exposure(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.check_customer_credit_on_so()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _limit numeric; _outstanding numeric; _name text; _order numeric;
BEGIN
  IF NEW.status <> 'confirmed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'confirmed' THEN RETURN NEW; END IF;
  SELECT credit_limit, name INTO _limit, _name FROM public.customers WHERE id = NEW.customer_id;
  IF _limit IS NULL OR _limit <= 0 THEN RETURN NEW; END IF;
  _outstanding := public.customer_credit_exposure(NEW.customer_id);
  _order := COALESCE(NEW.total, 0) + COALESCE(NEW.tax_amount, 0);
  IF _outstanding + _order > _limit THEN
    IF NEW.credit_override_by IS NULL THEN
      RAISE EXCEPTION 'Limite de crédit dépassée pour % : encours % + commande % > limite %',
        COALESCE(_name, 'le client'), _outstanding, _order, _limit
        USING ERRCODE = 'QG010',
              HINT = 'Un utilisateur habilité peut confirmer en donnant un motif de dépassement.';
    END IF;
    PERFORM public.notify_sales(NEW.tenant_id, 'warning',
      'Limite de crédit levée — ' || COALESCE(_name, ''),
      'Encours ' || _outstanding::text || ' + commande ' || _order::text || ' > limite ' || _limit::text
        || ' ; motif : ' || COALESCE(NEW.credit_override_reason, ''), NEW.id::text);
  END IF;
  RETURN NEW;
END $function$;

DROP FUNCTION public.confirm_so(uuid);
CREATE FUNCTION public.confirm_so(_so_id uuid, _override_reason text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _s public.sales_orders%ROWTYPE;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _limit numeric;
  _depasse boolean := false;
BEGIN
  IF NOT public.has_sales_perm(auth.uid(), 'confirm') THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _s FROM public.sales_orders WHERE id = _so_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commande introuvable dans la société active'; END IF;
  IF _s.status <> 'draft' THEN
    RAISE EXCEPTION 'Seule une commande en brouillon se confirme (statut %)', _s.status USING ERRCODE = 'QG010';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.so_lines WHERE so_id = _so_id) THEN
    RAISE EXCEPTION 'La commande n''a aucune ligne' USING ERRCODE = 'QG010';
  END IF;

  SELECT credit_limit INTO _limit FROM public.customers WHERE id = _s.customer_id;
  IF COALESCE(_limit, 0) > 0 THEN
    _depasse := public.customer_credit_exposure(_s.customer_id) + COALESCE(_s.total, 0) + COALESCE(_s.tax_amount, 0) > _limit;
  END IF;

  IF _depasse AND NULLIF(btrim(_override_reason), '') IS NOT NULL THEN
    IF NOT public.has_permission(auth.uid(), 'sales.credit_override') THEN
      RAISE EXCEPTION 'Droit insuffisant : confirmer au-delà de la limite de crédit' USING ERRCODE = '42501';
    END IF;
    UPDATE public.sales_orders
       SET status = 'confirmed', credit_override_by = auth.uid(),
           credit_override_reason = btrim(_override_reason), credit_override_at = now()
     WHERE id = _so_id;
  ELSE
    -- Sans motif, le contrôle du déclencheur refuse le dépassement (QG010).
    UPDATE public.sales_orders SET status = 'confirmed' WHERE id = _so_id;
  END IF;
  PERFORM public.notify_sales(_s.tenant_id, 'success', 'Commande confirmée', _s.so_number, _so_id::text);
END $function$;

REVOKE ALL ON FUNCTION public.confirm_so(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_so(uuid, text) TO authenticated;

-- ─── 7. Livraison et facture : remise et TVA suivent la pièce ───
CREATE OR REPLACE FUNCTION public.post_delivery(_so_id uuid, _lines jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _s public.sales_orders%ROWTYPE;
  _dn_id uuid;
  _dn_number text;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _line jsonb;
  _so_line public.so_lines%ROWTYPE;
  _quantity numeric;
  _cost numeric;
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

    INSERT INTO public.dn_lines(dn_id, so_line_id, item_id, description, quantity, unit_price, discount_pct, tax_code_id)
    VALUES (_dn_id, _so_line.id, _so_line.item_id, _so_line.description, _quantity, _so_line.unit_price,
            _so_line.discount_pct,
            (SELECT id FROM public.tax_codes WHERE id = _so_line.tax_code_id AND is_active));
    UPDATE public.so_lines SET quantity_delivered = quantity_delivered + _quantity WHERE id = _so_line.id;

    IF _so_line.item_id IS NOT NULL THEN
      SELECT COALESCE(average_cost, 0) INTO _cost FROM public.items WHERE id = _so_line.item_id;
      INSERT INTO public.stock_movements
        (tenant_id, item_id, movement_type, quantity, unit_cost, movement_date, reference_type, reference_id, created_by)
      VALUES (_tenant, _so_line.item_id, 'delivery', -_quantity, _cost, CURRENT_DATE, 'delivery_note', _dn_id, auth.uid());
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM public.so_lines WHERE so_id = _so_id AND quantity_delivered < quantity
  ) THEN
    UPDATE public.sales_orders SET status = 'delivered' WHERE id = _so_id;
  ELSE
    UPDATE public.sales_orders SET status = 'partially_delivered' WHERE id = _so_id;
  END IF;

  UPDATE public.delivery_notes SET status = 'completed' WHERE id = _dn_id;
  PERFORM public.notify_sales(_tenant, 'info', 'Livraison enregistrée', _dn_number || ' pour ' || _s.so_number, _dn_id::text);
  RETURN _dn_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.draft_invoice_from_delivery(_dn public.delivery_notes, _created_by uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _id uuid := gen_random_uuid();
  _date date := COALESCE(_dn.delivery_date, CURRENT_DATE);
  _terms integer;
BEGIN
  SELECT payment_terms INTO _terms FROM public.customers WHERE id = _dn.customer_id AND tenant_id = _dn.tenant_id;
  INSERT INTO public.ar_invoices (id, tenant_id, invoice_number, customer_id, invoice_date, due_date,
                                  subtotal, tax_amount, amount_paid, status, so_id, dn_id, created_by)
  VALUES (_id, _dn.tenant_id, 'BROUILLON-' || upper(substr(_id::text, 1, 8)), _dn.customer_id, _date,
          _date + COALESCE(_terms, 30), 0, 0, 0, 'draft', _dn.so_id, _dn.id, _created_by);
  -- Remise et code TVA de la commande ; un code devenu inactif est laissé vide (le comptable choisit).
  INSERT INTO public.ar_invoice_lines (tenant_id, invoice_id, line_no, description, quantity, unit_price,
                                       discount_pct, tax_code_id)
  SELECT _dn.tenant_id, _id, row_number() OVER (ORDER BY l.created_at, l.id),
         COALESCE(NULLIF(btrim(l.description), ''), 'Article livré'), l.quantity, l.unit_price,
         l.discount_pct, CASE WHEN tc.is_active THEN l.tax_code_id END
    FROM public.dn_lines l LEFT JOIN public.tax_codes tc ON tc.id = l.tax_code_id
   WHERE l.dn_id = _dn.id AND l.quantity > 0;
  RETURN _id;
END; $function$;
