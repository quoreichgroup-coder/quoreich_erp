-- V126 — Devise des clients, des devis, des commandes de vente et des commandes fournisseurs (écart G-25, troisième
-- tranche). Même principe que V124 / V125 : les montants existants restent dans la devise de la société (tableaux de
-- bord, exposition client, contrôle budgétaire, valorisation des réceptions) ; la pièce porte sa devise, son cours et
-- ses montants en devise, les prix se saisissent en devise et chaque ligne est convertie.
--   customers.currency     devise par défaut du client (vide = devise de la société) ;
--   quotations / sales_orders   devise du client par défaut à la création (les pièces de vente ne se créent que par les
--                          fonctions de vente), cours du jour de la pièce ; le devis transmet sa devise à la commande,
--                          la commande à la facture brouillon issue de la livraison (prix en devise repris) ;
--   purchase_orders        devise choisie à l'écran (celle du fournisseur est proposée) : une commande issue d'une
--                          demande d'achat reste dans la devise de la société, la demande étant une estimation en XOF ;
--                          la réception est valorisée au coût converti ; à la facture dans la même devise, le
--                          rapprochement compare les prix en devise (l'écart de cours n'est pas un écart de prix).

ALTER TABLE public.customers ADD COLUMN currency text CHECK (currency ~ '^[A-Z]{3}$');

ALTER TABLE public.quotations
  ADD COLUMN currency text CHECK (currency ~ '^[A-Z]{3}$'),
  ADD COLUMN exchange_rate numeric(20, 8) CHECK (exchange_rate > 0),
  ADD COLUMN fx_total numeric(18, 2),
  ADD COLUMN fx_tax_amount numeric(18, 2);
ALTER TABLE public.sales_orders
  ADD COLUMN currency text CHECK (currency ~ '^[A-Z]{3}$'),
  ADD COLUMN exchange_rate numeric(20, 8) CHECK (exchange_rate > 0),
  ADD COLUMN fx_total numeric(18, 2),
  ADD COLUMN fx_tax_amount numeric(18, 2);
ALTER TABLE public.purchase_orders
  ADD COLUMN currency text CHECK (currency ~ '^[A-Z]{3}$'),
  ADD COLUMN exchange_rate numeric(20, 8) CHECK (exchange_rate > 0),
  ADD COLUMN fx_total numeric(18, 2);
ALTER TABLE public.quote_lines
  ADD COLUMN fx_unit_price numeric(18, 4), ADD COLUMN fx_total numeric(18, 2), ADD COLUMN fx_tax_amount numeric(18, 2);
ALTER TABLE public.so_lines
  ADD COLUMN fx_unit_price numeric(18, 4), ADD COLUMN fx_total numeric(18, 2), ADD COLUMN fx_tax_amount numeric(18, 2);
ALTER TABLE public.po_lines
  ADD COLUMN fx_unit_cost numeric(18, 4), ADD COLUMN fx_total numeric(18, 2);

-- Devise et cours d'une pièce commerciale. Les branches IF séparent les colonnes propres à chaque table (piège V30).
CREATE FUNCTION public.commercial_document_currency()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _base text; _date date;
BEGIN
  SELECT t.currency INTO _base FROM public.tenants t WHERE t.id = NEW.tenant_id;
  IF TG_OP = 'INSERT' AND NEW.currency IS NULL AND TG_TABLE_NAME IN ('quotations', 'sales_orders') THEN
    SELECT c.currency INTO NEW.currency FROM public.customers c WHERE c.id = NEW.customer_id;
  END IF;
  NEW.currency := NULLIF(upper(btrim(NEW.currency)), '');
  IF NEW.currency IS NULL OR NEW.currency = _base THEN
    NEW.currency := NULL; NEW.exchange_rate := NULL; NEW.fx_total := NULL;
    IF TG_TABLE_NAME IN ('quotations', 'sales_orders') THEN NEW.fx_tax_amount := NULL; END IF;
    RETURN NEW;
  END IF;
  IF NEW.exchange_rate IS NULL THEN
    IF TG_TABLE_NAME = 'quotations' THEN _date := NEW.quote_date;
    ELSE _date := NEW.order_date; END IF;
    NEW.exchange_rate := public.exchange_rate_at(NEW.tenant_id, NEW.currency, COALESCE(_date, CURRENT_DATE));
    IF NEW.exchange_rate IS NULL THEN
      RAISE EXCEPTION 'Aucun cours % / % au % : enregistrez-le dans Paramètres → Devises et cours',
        NEW.currency, _base, to_char(COALESCE(_date, CURRENT_DATE), 'DD/MM/YYYY') USING ERRCODE = 'QG030';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_aa_quotation_currency BEFORE INSERT OR UPDATE ON public.quotations
  FOR EACH ROW EXECUTE FUNCTION public.commercial_document_currency();
CREATE TRIGGER trg_aa_sales_order_currency BEFORE INSERT OR UPDATE ON public.sales_orders
  FOR EACH ROW EXECUTE FUNCTION public.commercial_document_currency();
CREATE TRIGGER trg_aa_purchase_order_currency BEFORE INSERT OR UPDATE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.commercial_document_currency();

-- Changement de devise ou de cours d'une pièce : ses lignes sont reconverties.
CREATE FUNCTION public.commercial_document_currency_lines()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.currency IS DISTINCT FROM OLD.currency OR NEW.exchange_rate IS DISTINCT FROM OLD.exchange_rate THEN
    IF TG_TABLE_NAME = 'quotations' THEN
      UPDATE public.quote_lines SET fx_unit_price = fx_unit_price WHERE quotation_id = NEW.id;
    ELSIF TG_TABLE_NAME = 'sales_orders' THEN
      UPDATE public.so_lines SET fx_unit_price = fx_unit_price WHERE so_id = NEW.id;
    ELSE
      UPDATE public.po_lines SET fx_unit_cost = fx_unit_cost WHERE po_id = NEW.id;
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_quotation_currency_lines AFTER UPDATE OF currency, exchange_rate ON public.quotations
  FOR EACH ROW EXECUTE FUNCTION public.commercial_document_currency_lines();
CREATE TRIGGER trg_sales_order_currency_lines AFTER UPDATE OF currency, exchange_rate ON public.sales_orders
  FOR EACH ROW EXECUTE FUNCTION public.commercial_document_currency_lines();
CREATE TRIGGER trg_purchase_order_currency_lines AFTER UPDATE OF currency, exchange_rate ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.commercial_document_currency_lines();
REVOKE EXECUTE ON FUNCTION public.commercial_document_currency_lines() FROM PUBLIC, anon;

-- ─── Fonctions existantes étendues à la devise des pièces commerciales ───
CREATE OR REPLACE FUNCTION public.compute_quote_line_total()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  _rate numeric := public.sales_line_tax_rate(NEW.tax_code_id,
    (SELECT tenant_id FROM public.quotations WHERE id = NEW.quotation_id),
    TG_OP = 'INSERT' OR NEW.tax_code_id IS DISTINCT FROM OLD.tax_code_id);
  _cur text;
  _xr numeric;
BEGIN
  SELECT currency, exchange_rate INTO _cur, _xr FROM public.quotations WHERE id = NEW.quotation_id;
  NEW.discount_pct := COALESCE(NEW.discount_pct, 0);
  IF _cur IS NOT NULL THEN
    -- Pièce en devise (V126) : prix en devise, ligne convertie au cours de la pièce.
    NEW.fx_unit_price := COALESCE(NEW.fx_unit_price, NEW.unit_price);
    NEW.fx_total := ROUND((COALESCE(NEW.quantity, 0) * COALESCE(NEW.fx_unit_price, 0) * (1 - NEW.discount_pct / 100))::numeric, 2);
    NEW.fx_tax_amount := ROUND((NEW.fx_total * _rate / 100)::numeric, 2);
    NEW.unit_price := ROUND(NEW.fx_unit_price * _xr, 2);
    NEW.total := ROUND(NEW.fx_total * _xr, 2);
    NEW.tax_amount := ROUND(NEW.fx_tax_amount * _xr, 2);
  ELSE
    NEW.fx_unit_price := NULL; NEW.fx_total := NULL; NEW.fx_tax_amount := NULL;
    NEW.total := ROUND((COALESCE(NEW.quantity, 0) * COALESCE(NEW.unit_price, 0) * (1 - NEW.discount_pct / 100))::numeric, 2);
    NEW.tax_amount := ROUND((NEW.total * _rate / 100)::numeric, 2);
  END IF;
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
  _cur text;
  _xr numeric;
BEGIN
  SELECT currency, exchange_rate INTO _cur, _xr FROM public.sales_orders WHERE id = NEW.so_id;
  NEW.discount_pct := COALESCE(NEW.discount_pct, 0);
  IF _cur IS NOT NULL THEN
    -- Pièce en devise (V126) : prix en devise, ligne convertie au cours de la pièce.
    NEW.fx_unit_price := COALESCE(NEW.fx_unit_price, NEW.unit_price);
    NEW.fx_total := ROUND((COALESCE(NEW.quantity, 0) * COALESCE(NEW.fx_unit_price, 0) * (1 - NEW.discount_pct / 100))::numeric, 2);
    NEW.fx_tax_amount := ROUND((NEW.fx_total * _rate / 100)::numeric, 2);
    NEW.unit_price := ROUND(NEW.fx_unit_price * _xr, 2);
    NEW.total := ROUND(NEW.fx_total * _xr, 2);
    NEW.tax_amount := ROUND(NEW.fx_tax_amount * _xr, 2);
  ELSE
    NEW.fx_unit_price := NULL; NEW.fx_total := NULL; NEW.fx_tax_amount := NULL;
    NEW.total := ROUND((COALESCE(NEW.quantity, 0) * COALESCE(NEW.unit_price, 0) * (1 - NEW.discount_pct / 100))::numeric, 2);
    NEW.tax_amount := ROUND((NEW.total * _rate / 100)::numeric, 2);
  END IF;
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
     SET total = s.net, tax_amount = s.tax, fx_total = s.fx_net, fx_tax_amount = s.fx_tax
    FROM (SELECT COALESCE(SUM(total), 0) AS net, COALESCE(SUM(tax_amount), 0) AS tax, SUM(fx_total) AS fx_net, SUM(fx_tax_amount) AS fx_tax
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
     SET total = s.net, tax_amount = s.tax, fx_total = s.fx_net, fx_tax_amount = s.fx_tax
    FROM (SELECT COALESCE(SUM(total), 0) AS net, COALESCE(SUM(tax_amount), 0) AS tax, SUM(fx_total) AS fx_net, SUM(fx_tax_amount) AS fx_tax
            FROM public.so_lines WHERE so_id = _s) s
   WHERE o.id = _s;
  RETURN COALESCE(NEW, OLD);
END $function$;

CREATE OR REPLACE FUNCTION public.compute_po_line_total()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE _cur text; _xr numeric;
BEGIN
  SELECT currency, exchange_rate INTO _cur, _xr FROM public.purchase_orders WHERE id = NEW.po_id;
  IF _cur IS NOT NULL THEN
    -- Commande en devise (V126) : coût saisi en devise, converti au cours de la commande (valorisation des réceptions).
    NEW.fx_unit_cost := COALESCE(NEW.fx_unit_cost, NEW.unit_cost);
    NEW.fx_total := ROUND((COALESCE(NEW.quantity, 0) * NEW.fx_unit_cost)::numeric, 2);
    NEW.unit_cost := ROUND(NEW.fx_unit_cost * _xr, 4);
  ELSE
    NEW.fx_unit_cost := NULL; NEW.fx_total := NULL;
  END IF;
  NEW.total := ROUND((COALESCE(NEW.quantity,0) * COALESCE(NEW.unit_cost,0))::numeric, 2);
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.recompute_po_total()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _po uuid;
BEGIN
  _po := COALESCE(NEW.po_id, OLD.po_id);
  UPDATE public.purchase_orders
    SET total = (SELECT COALESCE(SUM(total),0) FROM public.po_lines WHERE po_id = _po),
        fx_total = (SELECT SUM(fx_total) FROM public.po_lines WHERE po_id = _po)
    WHERE id = _po;
  RETURN COALESCE(NEW, OLD);
END; $function$;

CREATE OR REPLACE FUNCTION public.create_sales_order_from_quote(_quote_id uuid, _lines jsonb, _order_date date DEFAULT CURRENT_DATE)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _q public.quotations%ROWTYPE;
  _so_id uuid;
  _so_number text;
  _line jsonb;
  _ql public.quote_lines%ROWTYPE;
  _qty numeric;
BEGIN
  IF NOT public.has_sales_perm(auth.uid(), 'create') AND NOT public.has_sales_perm(auth.uid(), 'confirm') THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _q FROM public.quotations WHERE id = _quote_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Devis introuvable dans la société active'; END IF;
  IF _q.status NOT IN ('draft', 'sent', 'accepted', 'partially_converted') THEN
    RAISE EXCEPTION 'Ce devis ne peut plus être transformé en commande (statut %)', _q.status USING ERRCODE = 'QG010';
  END IF;
  IF _q.valid_until IS NOT NULL AND _q.valid_until < CURRENT_DATE AND (public.sales_setting(_q.tenant_id)).block_expired_quotations THEN
    RAISE EXCEPTION 'Devis % expiré le % : établir un nouveau devis', _q.quote_number, to_char(_q.valid_until, 'DD/MM/YYYY')
      USING ERRCODE = 'QG010';
  END IF;
  IF jsonb_typeof(_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(_lines) = 0 THEN
    RAISE EXCEPTION 'Choisir au moins une ligne du devis' USING ERRCODE = 'QG010';
  END IF;

  INSERT INTO public.sales_orders (tenant_id, so_number, quotation_id, customer_id, order_date, total, status, created_by, currency)
  VALUES (_tenant, '', _q.id, _q.customer_id, COALESCE(_order_date, CURRENT_DATE), 0, 'draft', auth.uid(),
          COALESCE(_q.currency, (SELECT t.currency FROM public.tenants t WHERE t.id = _tenant)))
  RETURNING id, so_number INTO _so_id, _so_number;

  FOR _line IN SELECT value FROM jsonb_array_elements(_lines) WITH ORDINALITY AS t(value, n) ORDER BY n LOOP
    SELECT * INTO _ql FROM public.quote_lines
     WHERE id = NULLIF(_line->>'quote_line_id', '')::uuid AND quotation_id = _quote_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'La ligne ne fait pas partie de ce devis' USING ERRCODE = 'QG010'; END IF;
    _qty := NULLIF(_line->>'quantity', '')::numeric;
    IF _qty IS NULL OR _qty <= 0 THEN
      RAISE EXCEPTION 'La quantité commandée doit être positive (%)', _ql.description USING ERRCODE = 'QG010';
    END IF;
    IF _ql.quantity_ordered + _qty > _ql.quantity THEN
      RAISE EXCEPTION 'Quantité supérieure au reste à commander pour « % » (reste %)', _ql.description,
        _ql.quantity - _ql.quantity_ordered USING ERRCODE = 'QG010';
    END IF;
    INSERT INTO public.so_lines (so_id, item_id, description, quantity, unit_price, discount_pct, tax_code_id, quote_line_id)
    VALUES (_so_id, _ql.item_id, _ql.description, _qty, COALESCE(_ql.fx_unit_price, _ql.unit_price), _ql.discount_pct,
            (SELECT id FROM public.tax_codes WHERE id = _ql.tax_code_id AND is_active), _ql.id);
    UPDATE public.quote_lines SET quantity_ordered = quantity_ordered + _qty WHERE id = _ql.id;
  END LOOP;

  UPDATE public.quotations
     SET status = CASE WHEN EXISTS (SELECT 1 FROM public.quote_lines WHERE quotation_id = _quote_id AND quantity_ordered < quantity)
                       THEN 'partially_converted' ELSE 'converted' END
   WHERE id = _quote_id;
  PERFORM public.notify_sales(_tenant, 'info', 'Commande créée depuis le devis', _q.quote_number || ' → ' || _so_number, _so_id::text);
  RETURN _so_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.draft_invoice_from_delivery(_dn delivery_notes, _created_by uuid)
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
                                  subtotal, tax_amount, amount_paid, status, so_id, dn_id, created_by, currency)
  VALUES (_id, _dn.tenant_id, 'BROUILLON-' || upper(substr(_id::text, 1, 8)), _dn.customer_id, _date,
          _date + COALESCE(_terms, 30), 0, 0, 0, 'draft', _dn.so_id, _dn.id, _created_by,
          (SELECT so.currency FROM public.sales_orders so WHERE so.id = _dn.so_id));
  INSERT INTO public.ar_invoice_lines (tenant_id, invoice_id, line_no, description, quantity, unit_price,
                                       discount_pct, tax_code_id, dn_line_id)
  SELECT _dn.tenant_id, _id, row_number() OVER (ORDER BY l.created_at, l.id),
         COALESCE(NULLIF(btrim(l.description), ''), 'Article livré'), l.quantity - l.quantity_returned, COALESCE(sol.fx_unit_price, l.unit_price),
         l.discount_pct, CASE WHEN tc.is_active THEN l.tax_code_id END, l.id
    FROM public.dn_lines l LEFT JOIN public.tax_codes tc ON tc.id = l.tax_code_id
    LEFT JOIN public.so_lines sol ON sol.id = l.so_line_id
     AND (SELECT so.currency FROM public.sales_orders so WHERE so.id = _dn.so_id) IS NOT NULL
   WHERE l.dn_id = _dn.id AND l.quantity - l.quantity_returned > 0;
  RETURN _id;
END; $function$;

DROP FUNCTION public.ap_po_lines_to_invoice(uuid, uuid);
CREATE FUNCTION public.ap_po_lines_to_invoice(_po uuid, _except uuid DEFAULT NULL::uuid)
 RETURNS TABLE(po_line_id uuid, description text, unit_cost numeric, ordered numeric, received numeric, invoiced numeric, remaining numeric, fx_unit_cost numeric, currency text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT pl.id, COALESCE(pl.description, i.name, 'Ligne'), pl.unit_cost, pl.quantity, public.po_line_received(pl.id), public.po_line_invoiced(pl.id, _except),
         greatest(public.po_line_received(pl.id) - public.po_line_invoiced(pl.id, _except), 0), pl.fx_unit_cost, po.currency
    FROM public.po_lines pl JOIN public.purchase_orders po ON po.id = pl.po_id
    LEFT JOIN public.items i ON i.id = pl.item_id
   WHERE pl.po_id = _po AND po.tenant_id = public.get_user_tenant_id(auth.uid())
   ORDER BY pl.id
$function$;
REVOKE EXECUTE ON FUNCTION public.ap_po_lines_to_invoice(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ap_po_lines_to_invoice(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.ap_invoice_submit(_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _inv public.ap_invoices%ROWTYPE := public.ap_invoice_for_caller(_id);
  _po_required text;
  _three_way boolean;
  _gr_required boolean;
  _tol_pct numeric;
  _tol_amount numeric;
  _recu numeric;
  _deja numeric;
  _reste numeric;
  _tol numeric;
  _t record;
  _n integer := 0;
  _lines_po boolean;
  _l record;
  _recu_q numeric;
  _fact_q numeric;
  _ecart numeric;
BEGIN
  IF _inv.approval_status NOT IN ('draft', 'rejected', 'pending') THEN
    RAISE EXCEPTION 'La facture % est « % » : seule une facture en brouillon ou rejetée se soumet',
      _inv.invoice_number, _inv.approval_status USING ERRCODE = 'QG008';
  END IF;
  IF COALESCE(_inv.subtotal, 0) <= 0 THEN
    RAISE EXCEPTION 'La facture % n''a pas de montant HT', _inv.invoice_number USING ERRCODE = 'QG008';
  END IF;

  IF _inv.control_total IS NOT NULL AND round(_inv.control_total, 2) <> round(COALESCE(_inv.fx_total, _inv.total), 2) THEN
    RAISE EXCEPTION 'Facture % : montant TTC de contrôle % différent du total des lignes %', _inv.invoice_number, _inv.control_total, COALESCE(_inv.fx_total, _inv.total)
      USING ERRCODE = 'QG008', HINT = 'Corriger les lignes ou le montant TTC de la facture papier.';
  END IF;
  _lines_po := EXISTS (SELECT 1 FROM public.ap_invoice_lines WHERE invoice_id = _id AND po_line_id IS NOT NULL);

  SELECT g.po_required, g.three_way_match INTO _po_required, _three_way
    FROM public.ap_general_settings g WHERE g.tenant_id = _inv.tenant_id;
  SELECT s.require_gr_before_ap, s.three_way_tolerance_pct, s.three_way_tolerance_amount
    INTO _gr_required, _tol_pct, _tol_amount
    FROM public.procurement_settings s WHERE s.tenant_id = _inv.tenant_id;

  IF COALESCE(_po_required, 'optional') = 'mandatory' AND _inv.po_id IS NULL THEN
    RAISE EXCEPTION 'La société exige un bon de commande : la facture % doit citer la commande du fournisseur', _inv.invoice_number
      USING ERRCODE = 'QG008', HINT = 'Paramètres fournisseurs : « bon de commande requis ».';
  END IF;

  IF _inv.po_id IS NOT NULL THEN
    -- Reçu facturable : net de tous les retours fournisseurs (V52).
    SELECT COALESCE(sum(gl.quantity_received * pl.unit_cost), 0)
           - COALESCE((SELECT sum(rl.quantity * rl.unit_cost) FROM public.supplier_return_lines rl
                         JOIN public.supplier_returns sr ON sr.id = rl.return_id WHERE sr.po_id = _inv.po_id), 0) INTO _recu
      FROM public.gr_lines gl
      JOIN public.goods_receipts g ON g.id = gl.gr_id AND g.status = 'completed'
      JOIN public.po_lines pl ON pl.id = gl.po_line_id
     WHERE g.po_id = _inv.po_id;
    IF COALESCE(_gr_required, false) AND _recu = 0 THEN
      RAISE EXCEPTION 'La société exige une réception avant la facture : la commande citée par % n''a aucune réception validée',
        _inv.invoice_number USING ERRCODE = 'QG008', HINT = 'Paramètres des achats : « réception avant facture ».';
    END IF;
    IF COALESCE(_three_way, false) AND NOT _lines_po THEN
      SELECT COALESCE(sum(a.subtotal), 0) INTO _deja FROM public.ap_invoices a
       WHERE a.po_id = _inv.po_id AND a.id <> _inv.id AND a.approval_status IN ('submitted', 'approved');
      _reste := _recu - _deja;
      _tol := greatest(COALESCE(_tol_amount, 0), _reste * COALESCE(_tol_pct, 0) / 100);
      IF _inv.subtotal > _reste + _tol THEN
        RAISE EXCEPTION 'Rapprochement à 3 voies : % HT facturé pour % reçu non encore facturé (tolérance %) sur la commande',
          _inv.subtotal, _reste, round(_tol, 2) USING ERRCODE = 'QG008',
          HINT = 'Facturer au plus la valeur reçue, ou réceptionner le reste de la commande.';
      END IF;
    END IF;
  END IF;

  -- Rapprochement à 3 voies ligne à ligne (lignes rattachées à la commande) : quantité et prix.
  IF _lines_po THEN
    FOR _l IN SELECT l.*, CASE WHEN po.currency IS NOT NULL AND po.currency = _inv.currency AND pl.fx_unit_cost IS NOT NULL
                                 THEN round(pl.fx_unit_cost * _inv.exchange_rate, 4) ELSE pl.unit_cost END AS unit_cost,
                      pl.description AS po_desc
                 FROM public.ap_invoice_lines l JOIN public.po_lines pl ON pl.id = l.po_line_id JOIN public.purchase_orders po ON po.id = pl.po_id
               WHERE l.invoice_id = _id ORDER BY l.line_no LOOP
      _recu_q := public.po_line_received(_l.po_line_id);
      IF COALESCE(_gr_required, false) AND _recu_q <= 0 THEN
        RAISE EXCEPTION 'Ligne % (« % ») : aucune réception validée, la société exige la réception avant la facture', _l.line_no, _l.description
          USING ERRCODE = 'QG008', HINT = 'Paramètres des achats : « réception avant facture ».';
      END IF;
      IF COALESCE(_three_way, false) THEN
        _fact_q := public.po_line_invoiced(_l.po_line_id, _id);
        IF _l.quantity > (_recu_q - _fact_q) * (1 + COALESCE(_tol_pct, 0) / 100) THEN
          RAISE EXCEPTION 'Rapprochement à 3 voies, ligne % (« % ») : % facturé pour % reçu non encore facturé', _l.line_no, _l.description,
            _l.quantity, greatest(_recu_q - _fact_q, 0) USING ERRCODE = 'QG008', HINT = 'Facturer au plus la quantité reçue, ou réceptionner le reste.';
        END IF;
        _ecart := round((_l.unit_price * (1 - _l.discount_pct / 100) - COALESCE(_l.unit_cost, 0)) * _l.quantity, 2);
        IF _ecart > greatest(COALESCE(_tol_amount, 0), round(COALESCE(_l.unit_cost, 0) * _l.quantity * COALESCE(_tol_pct, 0) / 100, 2)) THEN
          RAISE EXCEPTION 'Rapprochement à 3 voies, ligne % (« % ») : prix % au-dessus du prix commandé % (écart % hors tolérance)', _l.line_no, _l.description,
            round(_l.unit_price * (1 - _l.discount_pct / 100), 2), _l.unit_cost, _ecart USING ERRCODE = 'QG008',
            HINT = 'Corriger le prix, ou faire modifier la commande.';
        END IF;
      END IF;
    END LOOP;
  END IF;

  DELETE FROM public.ap_invoice_approvals WHERE invoice_id = _id;
  FOR _t IN
    SELECT * FROM public.ap_approval_thresholds
     WHERE tenant_id = _inv.tenant_id AND (doc_types ILIKE '%facture%' OR doc_types ILIKE '%tous%')
     ORDER BY max_amount NULLS LAST, level
  LOOP
    _n := _n + 1;
    INSERT INTO public.ap_invoice_approvals (tenant_id, invoice_id, level_order, level_label, approver_label, amount)
    VALUES (_inv.tenant_id, _id, _n, _t.level, _t.approver, _inv.total);
    EXIT WHEN _t.max_amount IS NULL OR _inv.total <= _t.max_amount OR _n = 9;
  END LOOP;
  IF _n = 0 THEN
    INSERT INTO public.ap_invoice_approvals (tenant_id, invoice_id, level_order, level_label, approver_label, amount)
    VALUES (_inv.tenant_id, _id, 1, 'L1', 'Approbateur niveau 1', _inv.total);
    _n := 1;
  END IF;

  UPDATE public.ap_invoices SET approval_status = 'submitted' WHERE id = _id;
  RETURN _n;
END $function$;

SELECT public.install_tenant_isolation_triggers();
