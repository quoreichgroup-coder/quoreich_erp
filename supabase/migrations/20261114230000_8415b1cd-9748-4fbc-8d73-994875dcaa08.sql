-- V50 — Retour client sur livraison (inventaire docs/audit-erp/10 ; référence SAP : commande de
-- retour → entrée de retour → avoir ; Sage : « bon de retour » client lié au bon de livraison).
--
--   * create_customer_return(livraison, motif, date, lignes [{dn_line_id, quantity}], avoir) :
--     droit sales.deliver ; livraison validée de la société ; quantité ≤ livrée − déjà retournée ;
--     numéro légal (série « customer_return », RET-YYYY-####, créée si absente) ;
--     article stocké → mouvement d'entrée « customer_return » au coût de sa sortie (V42 : coût moyen
--     de la livraison), ce qui contre-passe le coût des ventes et non un compte fournisseur ;
--     facture de la livraison émise et avoir demandé → avoir lié (V45) sur les lignes de facture
--     correspondantes (droit ar.credit_note) ; sinon le retour reste « avoir à établir ».
--   * Livraison pas encore facturée : la facture brouillon préparée ensuite ne reprend que le livré
--     non retourné ; facture brouillon déjà préparée : retour refusé, corriger le brouillon d'abord.
--   * Lien ligne de facture → ligne de livraison (ar_invoice_lines.dn_line_id) posé par la
--     préparation de facture, et repris pour l'historique dans l'ordre des lignes.

ALTER TABLE public.dn_lines ADD COLUMN quantity_returned numeric NOT NULL DEFAULT 0 CHECK (quantity_returned >= 0);
ALTER TABLE public.ar_invoice_lines ADD COLUMN dn_line_id uuid REFERENCES public.dn_lines(id);
CREATE INDEX ar_invoice_lines_dn_line_idx ON public.ar_invoice_lines (dn_line_id) WHERE dn_line_id IS NOT NULL;

-- Historique : factures préparées depuis une livraison, lignes appariées dans leur ordre.
ALTER TABLE public.ar_invoice_lines DISABLE TRIGGER USER;
UPDATE public.ar_invoice_lines il SET dn_line_id = x.dn_line_id
  FROM (
    SELECT l.id AS invoice_line_id, d.id AS dn_line_id
      FROM (SELECT il2.id, il2.invoice_id, row_number() OVER (PARTITION BY il2.invoice_id ORDER BY il2.line_no) AS n
              FROM public.ar_invoice_lines il2) l
      JOIN public.ar_invoices i ON i.id = l.invoice_id AND i.dn_id IS NOT NULL
      JOIN (SELECT dl.id, dl.dn_id, row_number() OVER (PARTITION BY dl.dn_id ORDER BY dl.created_at, dl.id) AS n
              FROM public.dn_lines dl WHERE dl.quantity > 0) d ON d.dn_id = i.dn_id AND d.n = l.n
  ) x
 WHERE il.id = x.invoice_line_id AND il.dn_line_id IS NULL;
ALTER TABLE public.ar_invoice_lines ENABLE TRIGGER USER;

CREATE TABLE public.customer_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  return_number text NOT NULL,
  dn_id uuid NOT NULL REFERENCES public.delivery_notes(id),
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  return_date date NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  credit_note_id uuid REFERENCES public.ar_credit_notes(id),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_returns_tenant_number_key UNIQUE (tenant_id, return_number)
);
CREATE INDEX customer_returns_dn_idx ON public.customer_returns (dn_id);

CREATE TABLE public.customer_return_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  return_id uuid NOT NULL REFERENCES public.customer_returns(id) ON DELETE CASCADE,
  dn_line_id uuid NOT NULL REFERENCES public.dn_lines(id),
  item_id uuid REFERENCES public.items(id),
  description text NOT NULL,
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit_price numeric NOT NULL,
  unit_cost numeric NOT NULL DEFAULT 0
);
CREATE INDEX customer_return_lines_return_idx ON public.customer_return_lines (return_id);

ALTER TABLE public.customer_returns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON public.customer_returns FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
GRANT SELECT ON public.customer_returns TO authenticated;
ALTER TABLE public.customer_return_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON public.customer_return_lines FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
GRANT SELECT ON public.customer_return_lines TO authenticated;

-- Facture préparée depuis une livraison : livré non retourné, avec le lien vers la ligne livrée.
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
  INSERT INTO public.ar_invoice_lines (tenant_id, invoice_id, line_no, description, quantity, unit_price,
                                       discount_pct, tax_code_id, dn_line_id)
  SELECT _dn.tenant_id, _id, row_number() OVER (ORDER BY l.created_at, l.id),
         COALESCE(NULLIF(btrim(l.description), ''), 'Article livré'), l.quantity - l.quantity_returned, l.unit_price,
         l.discount_pct, CASE WHEN tc.is_active THEN l.tax_code_id END, l.id
    FROM public.dn_lines l LEFT JOIN public.tax_codes tc ON tc.id = l.tax_code_id
   WHERE l.dn_id = _dn.id AND l.quantity - l.quantity_returned > 0;
  RETURN _id;
END; $function$;

CREATE OR REPLACE FUNCTION public.create_customer_return(_dn_id uuid, _reason text, _return_date date, _lines jsonb,
                                                        _with_credit_note boolean DEFAULT true)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _dn public.delivery_notes%ROWTYPE;
  _inv public.ar_invoices%ROWTYPE;
  _id uuid := gen_random_uuid();
  _date date := COALESCE(_return_date, CURRENT_DATE);
  _number text;
  _line jsonb;
  _dl public.dn_lines%ROWTYPE;
  _qty numeric;
  _cost numeric;
  _credit jsonb := '[]'::jsonb;
  _il uuid;
  _cn uuid;
BEGIN
  IF NOT public.has_sales_perm(auth.uid(), 'deliver') THEN
    RAISE EXCEPTION 'Droit insuffisant : enregistrer un retour client' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Motif du retour obligatoire' USING ERRCODE = 'QG013';
  END IF;
  SELECT * INTO _dn FROM public.delivery_notes WHERE id = _dn_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Livraison introuvable dans la société active' USING ERRCODE = 'QG013'; END IF;
  IF _dn.status <> 'completed' THEN RAISE EXCEPTION 'Seule une livraison validée fait l''objet d''un retour' USING ERRCODE = 'QG013'; END IF;
  IF _date < _dn.delivery_date THEN
    RAISE EXCEPTION 'Le retour ne peut pas précéder la livraison (%)', _dn.delivery_date USING ERRCODE = 'QG013';
  END IF;
  IF jsonb_typeof(_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(_lines) = 0 THEN
    RAISE EXCEPTION 'Choisir au moins une ligne retournée' USING ERRCODE = 'QG013';
  END IF;
  IF _dn.ar_invoice_id IS NOT NULL THEN
    SELECT * INTO _inv FROM public.ar_invoices WHERE id = _dn.ar_invoice_id;
    IF _inv.status = 'draft' THEN
      RAISE EXCEPTION 'La facture % de cette livraison est encore en brouillon : supprimez-la, enregistrez le retour, puis refacturez la livraison', _inv.invoice_number
        USING ERRCODE = 'QG013';
    END IF;
  END IF;

  INSERT INTO public.ar_numbering_series (tenant_id, doc_type, prefix, format, next_number, reset_frequency)
  SELECT _tenant, 'customer_return', 'RET-', 'RET-YYYY-####', 1, 'yearly'
   WHERE NOT EXISTS (SELECT 1 FROM public.ar_numbering_series WHERE tenant_id = _tenant AND doc_type = 'customer_return');
  _number := public.next_document_number(_tenant, 'customer_return', _date);

  INSERT INTO public.customer_returns (id, tenant_id, return_number, dn_id, customer_id, return_date, reason, created_by)
  VALUES (_id, _tenant, _number, _dn.id, _dn.customer_id, _date, btrim(_reason), auth.uid());

  FOR _line IN SELECT value FROM jsonb_array_elements(_lines) WITH ORDINALITY AS t(value, k) ORDER BY k LOOP
    SELECT * INTO _dl FROM public.dn_lines WHERE id = NULLIF(_line->>'dn_line_id', '')::uuid AND dn_id = _dn.id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'La ligne ne fait pas partie de cette livraison' USING ERRCODE = 'QG013'; END IF;
    _qty := NULLIF(_line->>'quantity', '')::numeric;
    IF _qty IS NULL OR _qty <= 0 THEN RAISE EXCEPTION 'La quantité retournée doit être positive (%)', _dl.description USING ERRCODE = 'QG013'; END IF;
    IF _dl.quantity_returned + _qty > _dl.quantity THEN
      RAISE EXCEPTION 'Quantité supérieure au livré non encore retourné pour « % » (reste %)', _dl.description,
        _dl.quantity - _dl.quantity_returned USING ERRCODE = 'QG013';
    END IF;
    _cost := 0;
    IF _dl.item_id IS NOT NULL THEN
      -- Coût de la sortie d'origine (V42 : coût moyen au jour de la livraison).
      SELECT COALESCE(MAX(unit_cost), 0) INTO _cost FROM public.stock_movements
       WHERE reference_type = 'delivery_note' AND reference_id = _dn.id AND item_id = _dl.item_id;
      INSERT INTO public.stock_movements (tenant_id, item_id, movement_type, quantity, unit_cost, movement_date,
                                          reference_type, reference_id, created_by)
      VALUES (_tenant, _dl.item_id, 'customer_return', _qty, _cost, _date, 'customer_return', _id, auth.uid());
    END IF;
    INSERT INTO public.customer_return_lines (tenant_id, return_id, dn_line_id, item_id, description, quantity, unit_price, unit_cost)
    VALUES (_tenant, _id, _dl.id, _dl.item_id, COALESCE(_dl.description, 'Article'), _qty, _dl.unit_price, _cost);
    UPDATE public.dn_lines SET quantity_returned = quantity_returned + _qty WHERE id = _dl.id;

    IF _dn.ar_invoice_id IS NOT NULL THEN
      SELECT id INTO _il FROM public.ar_invoice_lines WHERE invoice_id = _dn.ar_invoice_id AND dn_line_id = _dl.id;
      IF _il IS NOT NULL THEN
        _credit := _credit || jsonb_build_array(jsonb_build_object('invoice_line_id', _il, 'quantity', _qty));
      END IF;
    END IF;
  END LOOP;

  -- Avoir lié, si la livraison est facturée et que l'utilisateur le demande (droit ar.credit_note).
  IF _with_credit_note AND _dn.ar_invoice_id IS NOT NULL AND jsonb_array_length(_credit) > 0 THEN
    _cn := public.create_ar_credit_note(_dn.ar_invoice_id, 'Retour ' || _number || ' — ' || btrim(_reason), _date, _credit);
    UPDATE public.customer_returns SET credit_note_id = _cn WHERE id = _id;
  END IF;
  PERFORM public.notify_sales(_tenant, 'info', 'Retour client enregistré', _number || ' sur ' || _dn.dn_number, _id::text);
  RETURN _id;
END; $function$;

REVOKE ALL ON FUNCTION public.create_customer_return(uuid, text, date, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_customer_return(uuid, text, date, jsonb, boolean) TO authenticated;

-- Avoir établi après coup pour un retour (par le comptable).
CREATE OR REPLACE FUNCTION public.credit_customer_return(_return_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _r public.customer_returns%ROWTYPE;
  _inv uuid;
  _credit jsonb;
  _cn uuid;
BEGIN
  SELECT * INTO _r FROM public.customer_returns WHERE id = _return_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Retour introuvable dans la société active' USING ERRCODE = 'QG013'; END IF;
  IF _r.credit_note_id IS NOT NULL THEN RAISE EXCEPTION 'Ce retour a déjà son avoir' USING ERRCODE = 'QG013'; END IF;
  SELECT ar_invoice_id INTO _inv FROM public.delivery_notes WHERE id = _r.dn_id;
  IF _inv IS NULL OR (SELECT status FROM public.ar_invoices WHERE id = _inv) = 'draft' THEN
    RAISE EXCEPTION 'La livraison n''est pas encore facturée : la facture ne reprendra pas le retourné' USING ERRCODE = 'QG013';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('invoice_line_id', il.id, 'quantity', rl.quantity))
    INTO _credit
    FROM public.customer_return_lines rl JOIN public.ar_invoice_lines il ON il.invoice_id = _inv AND il.dn_line_id = rl.dn_line_id
   WHERE rl.return_id = _r.id;
  IF _credit IS NULL THEN RAISE EXCEPTION 'Aucune ligne de facture ne correspond aux lignes retournées' USING ERRCODE = 'QG013'; END IF;
  _cn := public.create_ar_credit_note(_inv, 'Retour ' || _r.return_number || ' — ' || _r.reason, GREATEST(_r.return_date, CURRENT_DATE), _credit);
  UPDATE public.customer_returns SET credit_note_id = _cn WHERE id = _r.id;
  RETURN _cn;
END; $function$;

REVOKE ALL ON FUNCTION public.credit_customer_return(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.credit_customer_return(uuid) TO authenticated;

-- Suppression d'une facture brouillon préparée depuis une livraison : la livraison redevient
-- facturable (avant V50, la clé étrangère de la livraison bloquait la suppression du brouillon).
CREATE OR REPLACE FUNCTION public.release_delivery_on_draft_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.status = 'draft' THEN
    UPDATE public.delivery_notes SET ar_invoice_id = NULL WHERE ar_invoice_id = OLD.id;
  END IF;
  RETURN OLD;
END; $function$;

CREATE TRIGGER trg_release_delivery_on_draft_delete
  BEFORE DELETE ON public.ar_invoices
  FOR EACH ROW EXECUTE FUNCTION public.release_delivery_on_draft_delete();

-- Écriture de stock : un retour client contre-passe le coût des ventes (et non un compte fournisseur).
CREATE OR REPLACE FUNCTION public.on_stock_movement_je()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _settings public.inventory_settings%ROWTYPE;
  _entry_id uuid; _entry_number text;
  _stock_acc uuid; _other_acc uuid;
  _value numeric := COALESCE(NEW.total_value, 0);
  _is_in boolean := COALESCE(NEW.quantity,0) > 0;
BEGIN
  IF NEW.journal_entry_id IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.status <> 'posted' THEN RETURN NEW; END IF;
  IF _value <= 0 THEN RETURN NEW; END IF;

  SELECT * INTO _settings FROM public.inventory_settings WHERE tenant_id = NEW.tenant_id;
  IF NOT COALESCE(_settings.auto_je_on_movement, true) THEN RETURN NEW; END IF;

  SELECT id INTO _stock_acc FROM public.gl_accounts
    WHERE tenant_id = NEW.tenant_id AND code = COALESCE(_settings.stock_account_code,'3100') LIMIT 1;

  IF NEW.movement_type IN ('delivery','sale','issue','customer_return') OR (NEW.reference_type IN ('delivery_note','customer_return')) THEN
    SELECT id INTO _other_acc FROM public.gl_accounts
      WHERE tenant_id = NEW.tenant_id AND code = COALESCE(_settings.cogs_account_code,'6010') LIMIT 1;
  ELSIF NEW.movement_type = 'adjustment' THEN
    SELECT id INTO _other_acc FROM public.gl_accounts
      WHERE tenant_id = NEW.tenant_id AND code = COALESCE(_settings.variance_account_code,'6580') LIMIT 1;
  ELSE
    SELECT id INTO _other_acc FROM public.gl_accounts
      WHERE tenant_id = NEW.tenant_id AND code = '4010' LIMIT 1;
  END IF;

  IF _stock_acc IS NULL OR _other_acc IS NULL THEN RETURN NEW; END IF;

  _entry_number := 'JE-STK-' || to_char(now(),'YYYYMMDD') || '-' || substr(NEW.id::text,1,8);
  INSERT INTO public.journal_entries(tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES (NEW.tenant_id, _entry_number, COALESCE(NEW.movement_date, CURRENT_DATE),
          'Stock ' || NEW.movement_type || ' — ' || COALESCE(NEW.reference_type,''),
          'stock_movement', 'draft', NEW.created_by)
  RETURNING id INTO _entry_id;

  IF _is_in THEN
    INSERT INTO public.journal_lines(entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _stock_acc, _value, 0, 'DR Stock');
    INSERT INTO public.journal_lines(entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _other_acc, 0, _value, 'CR Contrepartie');
  ELSE
    INSERT INTO public.journal_lines(entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _other_acc, _value, 0, 'DR Contrepartie');
    INSERT INTO public.journal_lines(entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _stock_acc, 0, _value, 'CR Stock');
  END IF;

  UPDATE public.journal_entries SET status='posted', posted_by=NEW.created_by, posted_at=now() WHERE id=_entry_id;
  UPDATE public.stock_movements SET journal_entry_id = _entry_id WHERE id = NEW.id;
  RETURN NEW;
END $function$;
