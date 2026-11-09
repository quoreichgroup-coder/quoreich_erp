
-- Quote lines
CREATE TABLE IF NOT EXISTS public.quote_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES public.quotations(id) ON DELETE CASCADE,
  item_id uuid REFERENCES public.items(id),
  description text,
  quantity numeric NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quote_lines TO authenticated;
GRANT ALL ON public.quote_lines TO service_role;
ALTER TABLE public.quote_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant rw quote_lines" ON public.quote_lines;
CREATE POLICY "tenant rw quote_lines" ON public.quote_lines FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.quotations q WHERE q.id=quote_lines.quotation_id AND q.tenant_id=public.get_user_tenant_id(auth.uid())))
WITH CHECK (EXISTS (SELECT 1 FROM public.quotations q WHERE q.id=quote_lines.quotation_id AND q.tenant_id=public.get_user_tenant_id(auth.uid())));

-- SO lines
CREATE TABLE IF NOT EXISTS public.so_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  so_id uuid NOT NULL REFERENCES public.sales_orders(id) ON DELETE CASCADE,
  item_id uuid REFERENCES public.items(id),
  description text,
  quantity numeric NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  quantity_delivered numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.so_lines TO authenticated;
GRANT ALL ON public.so_lines TO service_role;
ALTER TABLE public.so_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant rw so_lines" ON public.so_lines;
CREATE POLICY "tenant rw so_lines" ON public.so_lines FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.sales_orders s WHERE s.id=so_lines.so_id AND s.tenant_id=public.get_user_tenant_id(auth.uid())))
WITH CHECK (EXISTS (SELECT 1 FROM public.sales_orders s WHERE s.id=so_lines.so_id AND s.tenant_id=public.get_user_tenant_id(auth.uid())));

-- Delivery notes
CREATE TABLE IF NOT EXISTS public.delivery_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  dn_number text NOT NULL,
  so_id uuid NOT NULL REFERENCES public.sales_orders(id),
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  delivery_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'draft',
  ar_invoice_id uuid REFERENCES public.ar_invoices(id),
  notes text,
  created_by uuid NOT NULL,
  delivered_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_notes TO authenticated;
GRANT ALL ON public.delivery_notes TO service_role;
ALTER TABLE public.delivery_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant rw dn" ON public.delivery_notes;
CREATE POLICY "tenant rw dn" ON public.delivery_notes FOR ALL TO authenticated
USING (tenant_id=public.get_user_tenant_id(auth.uid()))
WITH CHECK (tenant_id=public.get_user_tenant_id(auth.uid()));

CREATE TABLE IF NOT EXISTS public.dn_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dn_id uuid NOT NULL REFERENCES public.delivery_notes(id) ON DELETE CASCADE,
  so_line_id uuid REFERENCES public.so_lines(id),
  item_id uuid REFERENCES public.items(id),
  description text,
  quantity numeric NOT NULL DEFAULT 0,
  unit_price numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dn_lines TO authenticated;
GRANT ALL ON public.dn_lines TO service_role;
ALTER TABLE public.dn_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant rw dn_lines" ON public.dn_lines;
CREATE POLICY "tenant rw dn_lines" ON public.dn_lines FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.delivery_notes d WHERE d.id=dn_lines.dn_id AND d.tenant_id=public.get_user_tenant_id(auth.uid())))
WITH CHECK (EXISTS (SELECT 1 FROM public.delivery_notes d WHERE d.id=dn_lines.dn_id AND d.tenant_id=public.get_user_tenant_id(auth.uid())));

-- Link AR invoice to SO/DN
ALTER TABLE public.ar_invoices ADD COLUMN IF NOT EXISTS so_id uuid REFERENCES public.sales_orders(id);
ALTER TABLE public.ar_invoices ADD COLUMN IF NOT EXISTS dn_id uuid REFERENCES public.delivery_notes(id);

-- Sales settings
CREATE TABLE IF NOT EXISTS public.sales_settings (
  tenant_id uuid PRIMARY KEY,
  auto_invoice_on_delivery boolean NOT NULL DEFAULT true,
  reserve_stock_on_confirm boolean NOT NULL DEFAULT true,
  sla_quote_hours int NOT NULL DEFAULT 48,
  sla_quote_to_so_hours int NOT NULL DEFAULT 72,
  sla_so_to_dn_days int NOT NULL DEFAULT 7,
  sla_dn_to_invoice_days int NOT NULL DEFAULT 2,
  sla_warning_pct int NOT NULL DEFAULT 75,
  sla_critical_pct int NOT NULL DEFAULT 100,
  color_ok text NOT NULL DEFAULT '#16a34a',
  color_warning text NOT NULL DEFAULT '#f59e0b',
  color_critical text NOT NULL DEFAULT '#dc2626',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_settings TO authenticated;
GRANT ALL ON public.sales_settings TO service_role;
ALTER TABLE public.sales_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant rw sales_settings" ON public.sales_settings;
CREATE POLICY "tenant rw sales_settings" ON public.sales_settings FOR ALL TO authenticated
USING (tenant_id=public.get_user_tenant_id(auth.uid()))
WITH CHECK (tenant_id=public.get_user_tenant_id(auth.uid()));

-- Sales role audit
CREATE TABLE IF NOT EXISTS public.sales_role_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  target_user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  action text NOT NULL,
  performed_by uuid NOT NULL,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.sales_role_audit TO authenticated;
GRANT ALL ON public.sales_role_audit TO service_role;
ALTER TABLE public.sales_role_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant read sales_role_audit" ON public.sales_role_audit;
CREATE POLICY "tenant read sales_role_audit" ON public.sales_role_audit FOR SELECT TO authenticated
USING (tenant_id=public.get_user_tenant_id(auth.uid()));
DROP POLICY IF EXISTS "tenant insert sales_role_audit" ON public.sales_role_audit;
CREATE POLICY "tenant insert sales_role_audit" ON public.sales_role_audit FOR INSERT TO authenticated
WITH CHECK (tenant_id=public.get_user_tenant_id(auth.uid()));

-- TRIGGERS
CREATE OR REPLACE FUNCTION public.compute_quote_line_total()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  NEW.total := ROUND((COALESCE(NEW.quantity,0)*COALESCE(NEW.unit_price,0))::numeric,2);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_quote_line_total ON public.quote_lines;
CREATE TRIGGER trg_quote_line_total BEFORE INSERT OR UPDATE ON public.quote_lines
FOR EACH ROW EXECUTE FUNCTION public.compute_quote_line_total();

CREATE OR REPLACE FUNCTION public.recompute_quote_total()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _q uuid;
BEGIN
  _q := COALESCE(NEW.quotation_id, OLD.quotation_id);
  UPDATE public.quotations SET total=(SELECT COALESCE(SUM(total),0) FROM public.quote_lines WHERE quotation_id=_q) WHERE id=_q;
  RETURN COALESCE(NEW,OLD);
END $$;
DROP TRIGGER IF EXISTS trg_quote_recompute ON public.quote_lines;
CREATE TRIGGER trg_quote_recompute AFTER INSERT OR UPDATE OR DELETE ON public.quote_lines
FOR EACH ROW EXECUTE FUNCTION public.recompute_quote_total();

CREATE OR REPLACE FUNCTION public.compute_so_line_total()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  NEW.total := ROUND((COALESCE(NEW.quantity,0)*COALESCE(NEW.unit_price,0))::numeric,2);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_so_line_total ON public.so_lines;
CREATE TRIGGER trg_so_line_total BEFORE INSERT OR UPDATE ON public.so_lines
FOR EACH ROW EXECUTE FUNCTION public.compute_so_line_total();

CREATE OR REPLACE FUNCTION public.recompute_so_total()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _s uuid;
BEGIN
  _s := COALESCE(NEW.so_id, OLD.so_id);
  UPDATE public.sales_orders SET total=(SELECT COALESCE(SUM(total),0) FROM public.so_lines WHERE so_id=_s) WHERE id=_s;
  RETURN COALESCE(NEW,OLD);
END $$;
DROP TRIGGER IF EXISTS trg_so_recompute ON public.so_lines;
CREATE TRIGGER trg_so_recompute AFTER INSERT OR UPDATE OR DELETE ON public.so_lines
FOR EACH ROW EXECUTE FUNCTION public.recompute_so_total();

CREATE OR REPLACE FUNCTION public.compute_dn_line_total()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  NEW.total := ROUND((COALESCE(NEW.quantity,0)*COALESCE(NEW.unit_price,0))::numeric,2);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_dn_line_total ON public.dn_lines;
CREATE TRIGGER trg_dn_line_total BEFORE INSERT OR UPDATE ON public.dn_lines
FOR EACH ROW EXECUTE FUNCTION public.compute_dn_line_total();

CREATE OR REPLACE FUNCTION public.notify_sales(_tenant_id uuid, _severity text, _title text, _message text, _ref text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO public.erp_alerts (tenant_id, severity, alert_type, title, message, ref_type, ref_id, module, status)
  VALUES (_tenant_id, _severity, 'sales', _title, _message, 'sales', _ref, 'Sales', 'active');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.has_sales_perm(_user_id uuid, _action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT
    public.has_role(_user_id,'admin'::public.app_role)
    OR CASE _action
      WHEN 'create'  THEN public.has_role(_user_id,'sales_rep'::public.app_role)
                       OR public.has_role(_user_id,'sales_manager'::public.app_role)
      WHEN 'confirm' THEN public.has_role(_user_id,'sales_manager'::public.app_role)
                       OR public.has_role(_user_id,'sales_controller'::public.app_role)
      WHEN 'deliver' THEN public.has_role(_user_id,'sales_rep'::public.app_role)
                       OR public.has_role(_user_id,'sales_manager'::public.app_role)
                       OR public.has_role(_user_id,'sales_controller'::public.app_role)
      WHEN 'invoice' THEN public.has_role(_user_id,'sales_manager'::public.app_role)
                       OR public.has_role(_user_id,'sales_controller'::public.app_role)
      ELSE false
    END
$$;

CREATE OR REPLACE FUNCTION public.seed_sales_defaults()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO public.sales_settings(tenant_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_seed_sales ON public.tenants;
CREATE TRIGGER trg_seed_sales AFTER INSERT ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.seed_sales_defaults();
INSERT INTO public.sales_settings(tenant_id) SELECT id FROM public.tenants ON CONFLICT DO NOTHING;

-- RPCs
CREATE OR REPLACE FUNCTION public.confirm_quote_to_so(_quote_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  _q public.quotations%ROWTYPE;
  _so_id uuid; _so_number text;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF NOT public.has_sales_perm(auth.uid(),'confirm') THEN RAISE EXCEPTION 'Permission denied'; END IF;
  SELECT * INTO _q FROM public.quotations WHERE id=_quote_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quote not found'; END IF;
  IF _q.tenant_id<>_tenant THEN RAISE EXCEPTION 'Tenant mismatch'; END IF;
  IF _q.status NOT IN ('accepted','sent','draft') THEN RAISE EXCEPTION 'Quote status invalid: %', _q.status; END IF;

  _so_number := 'SO-'||to_char(now(),'YYYY')||'-'||lpad((floor(random()*9999))::text,4,'0');
  INSERT INTO public.sales_orders(tenant_id, so_number, quotation_id, customer_id, order_date, total, status, created_by)
  VALUES (_q.tenant_id, _so_number, _q.id, _q.customer_id, CURRENT_DATE, COALESCE(_q.total,0), 'draft', auth.uid())
  RETURNING id INTO _so_id;

  INSERT INTO public.so_lines(so_id, item_id, description, quantity, unit_price, total)
  SELECT _so_id, ql.item_id, ql.description, ql.quantity, ql.unit_price, ql.total
    FROM public.quote_lines ql WHERE ql.quotation_id=_quote_id;

  UPDATE public.quotations SET status='converted' WHERE id=_quote_id;
  PERFORM public.notify_sales(_q.tenant_id,'info','Quote → SO',_q.quote_number||' → '||_so_number,_so_id::text);
  RETURN _so_id;
END $$;

CREATE OR REPLACE FUNCTION public.confirm_so(_so_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _s public.sales_orders%ROWTYPE; _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF NOT public.has_sales_perm(auth.uid(),'confirm') THEN RAISE EXCEPTION 'Permission denied'; END IF;
  SELECT * INTO _s FROM public.sales_orders WHERE id=_so_id;
  IF _s.tenant_id<>_tenant THEN RAISE EXCEPTION 'Tenant mismatch'; END IF;
  UPDATE public.sales_orders SET status='confirmed' WHERE id=_so_id;
  PERFORM public.notify_sales(_s.tenant_id,'success','SO confirmé',_s.so_number,_so_id::text);
END $$;

CREATE OR REPLACE FUNCTION public.post_delivery(_so_id uuid, _lines jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  _s public.sales_orders%ROWTYPE;
  _dn_id uuid; _dn_number text;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _line jsonb; _so_line public.so_lines%ROWTYPE;
BEGIN
  IF NOT public.has_sales_perm(auth.uid(),'deliver') THEN RAISE EXCEPTION 'Permission denied'; END IF;
  SELECT * INTO _s FROM public.sales_orders WHERE id=_so_id;
  IF _s.tenant_id<>_tenant THEN RAISE EXCEPTION 'Tenant mismatch'; END IF;
  IF _s.status NOT IN ('confirmed','partially_delivered') THEN RAISE EXCEPTION 'SO must be confirmed'; END IF;

  _dn_number := 'DN-'||to_char(now(),'YYYY')||'-'||lpad((floor(random()*9999))::text,4,'0');
  INSERT INTO public.delivery_notes(tenant_id, dn_number, so_id, customer_id, delivery_date, status, created_by, delivered_by)
  VALUES (_tenant, _dn_number, _so_id, _s.customer_id, CURRENT_DATE, 'completed', auth.uid(), auth.uid())
  RETURNING id INTO _dn_id;

  FOR _line IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    SELECT * INTO _so_line FROM public.so_lines WHERE id=(_line->>'so_line_id')::uuid;
    INSERT INTO public.dn_lines(dn_id, so_line_id, item_id, description, quantity, unit_price)
    VALUES (_dn_id, _so_line.id, _so_line.item_id, _so_line.description, (_line->>'quantity')::numeric, _so_line.unit_price);

    UPDATE public.so_lines SET quantity_delivered = COALESCE(quantity_delivered,0)+(_line->>'quantity')::numeric WHERE id=_so_line.id;

    IF _so_line.item_id IS NOT NULL THEN
      UPDATE public.items SET quantity_on_hand = quantity_on_hand - (_line->>'quantity')::numeric WHERE id=_so_line.item_id;
      INSERT INTO public.stock_movements(tenant_id,item_id,movement_type,quantity,reference_type,reference_id,created_by)
      VALUES (_tenant,_so_line.item_id,'delivery',-(_line->>'quantity')::numeric,'delivery_note',_dn_id,auth.uid());
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM public.so_lines WHERE so_id=_so_id AND quantity_delivered < quantity) THEN
    UPDATE public.sales_orders SET status='delivered' WHERE id=_so_id;
  ELSE
    UPDATE public.sales_orders SET status='partially_delivered' WHERE id=_so_id;
  END IF;

  PERFORM public.notify_sales(_tenant,'info','Livraison enregistrée',_dn_number||' pour '||_s.so_number,_dn_id::text);
  RETURN _dn_id;
END $$;

CREATE OR REPLACE FUNCTION public.invoice_from_delivery(_dn_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  _dn public.delivery_notes%ROWTYPE;
  _inv_id uuid; _inv_number text;
  _subtotal numeric; _tax numeric := 0;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF NOT public.has_sales_perm(auth.uid(),'invoice') THEN RAISE EXCEPTION 'Permission denied'; END IF;
  SELECT * INTO _dn FROM public.delivery_notes WHERE id=_dn_id;
  IF _dn.tenant_id<>_tenant THEN RAISE EXCEPTION 'Tenant mismatch'; END IF;
  IF _dn.ar_invoice_id IS NOT NULL THEN RAISE EXCEPTION 'Already invoiced'; END IF;
  IF _dn.status<>'completed' THEN RAISE EXCEPTION 'DN not completed'; END IF;

  SELECT COALESCE(SUM(total),0) INTO _subtotal FROM public.dn_lines WHERE dn_id=_dn_id;
  _inv_number := 'INV-'||to_char(now(),'YYYY')||'-'||lpad((floor(random()*9999))::text,4,'0');

  INSERT INTO public.ar_invoices(tenant_id, invoice_number, customer_id, invoice_date, due_date,
    subtotal, tax_amount, total, amount_paid, status, so_id, dn_id, created_by)
  VALUES (_tenant, _inv_number, _dn.customer_id, CURRENT_DATE, CURRENT_DATE+30,
    _subtotal, _tax, _subtotal+_tax, 0, 'sent', _dn.so_id, _dn_id, auth.uid())
  RETURNING id INTO _inv_id;

  UPDATE public.delivery_notes SET ar_invoice_id=_inv_id WHERE id=_dn_id;
  PERFORM public.notify_sales(_tenant,'success','Facture créée',_inv_number||' depuis '||_dn.dn_number,_inv_id::text);
  RETURN _inv_id;
END $$;

CREATE OR REPLACE FUNCTION public.assign_sales_role(_target_user uuid, _role public.app_role, _action text, _comment text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid()); _t uuid;
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'No tenant'; END IF;
  IF NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN RAISE EXCEPTION 'Admin only'; END IF;
  IF _action NOT IN ('assign','revoke') THEN RAISE EXCEPTION 'Invalid action'; END IF;
  IF _role::text NOT IN ('sales_rep','sales_manager','sales_controller') THEN RAISE EXCEPTION 'Not a sales role'; END IF;
  SELECT tenant_id INTO _t FROM public.profiles WHERE id=_target_user;
  IF _t IS NULL OR _t<>_tenant THEN RAISE EXCEPTION 'Target user not in your tenant'; END IF;

  IF _action='assign' THEN
    INSERT INTO public.user_roles(user_id,role,tenant_id) VALUES (_target_user,_role,_tenant)
    ON CONFLICT (user_id,role) DO NOTHING;
  ELSE
    DELETE FROM public.user_roles WHERE user_id=_target_user AND role=_role AND tenant_id=_tenant;
  END IF;

  INSERT INTO public.sales_role_audit(tenant_id,target_user_id,role,action,performed_by,comment)
  VALUES (_tenant,_target_user,_role,_action,auth.uid(),_comment);
END $$;

-- VIEWS
CREATE OR REPLACE VIEW public.sales_pipeline_view AS
SELECT tenant_id, 'quote'::text AS stage, count(*)::bigint AS docs, COALESCE(SUM(total),0)::numeric AS amount
  FROM public.quotations WHERE status NOT IN ('converted','rejected','expired') GROUP BY tenant_id
UNION ALL
SELECT tenant_id, 'sales_order', count(*), COALESCE(SUM(total),0)
  FROM public.sales_orders WHERE status IN ('draft','confirmed','partially_delivered') GROUP BY tenant_id
UNION ALL
SELECT tenant_id, 'delivered', count(*), 0::numeric
  FROM public.delivery_notes WHERE status='completed' GROUP BY tenant_id
UNION ALL
SELECT tenant_id, 'invoiced', count(*), COALESCE(SUM(total),0)
  FROM public.ar_invoices WHERE so_id IS NOT NULL GROUP BY tenant_id;
GRANT SELECT ON public.sales_pipeline_view TO authenticated;

CREATE OR REPLACE VIEW public.sales_sla_view AS
SELECT
  s.tenant_id, s.id AS so_id, s.so_number, s.customer_id, s.order_date,
  q.quote_date,
  EXTRACT(EPOCH FROM (s.created_at - q.created_at))/3600 AS quote_to_so_hours,
  (SELECT MIN(dn.delivery_date) - s.order_date FROM public.delivery_notes dn WHERE dn.so_id=s.id) AS so_to_dn_days,
  (SELECT MIN(ar.invoice_date) - MIN(dn.delivery_date)
     FROM public.delivery_notes dn LEFT JOIN public.ar_invoices ar ON ar.dn_id=dn.id
     WHERE dn.so_id=s.id) AS dn_to_invoice_days,
  s.status
FROM public.sales_orders s
LEFT JOIN public.quotations q ON q.id=s.quotation_id;
GRANT SELECT ON public.sales_sla_view TO authenticated;

CREATE OR REPLACE VIEW public.sales_kpis_view AS
SELECT
  t.id AS tenant_id,
  (SELECT COALESCE(SUM(total),0) FROM public.ar_invoices a WHERE a.tenant_id=t.id
     AND a.invoice_date >= date_trunc('month',CURRENT_DATE)) AS revenue_mtd,
  (SELECT COALESCE(SUM(total),0) FROM public.sales_orders s WHERE s.tenant_id=t.id
     AND s.status IN ('confirmed','partially_delivered')) AS backlog,
  (SELECT count(*) FROM public.quotations q WHERE q.tenant_id=t.id AND q.status='sent') AS open_quotes,
  (SELECT count(*) FROM public.sales_orders s WHERE s.tenant_id=t.id AND s.status='confirmed') AS open_sos
FROM public.tenants t;
GRANT SELECT ON public.sales_kpis_view TO authenticated;

CREATE OR REPLACE VIEW public.sales_audit_view AS
SELECT tenant_id, created_at, 'role_change'::text AS event_type, action,
  role::text AS detail, performed_by AS actor, target_user_id::text AS target, comment
FROM public.sales_role_audit;
GRANT SELECT ON public.sales_audit_view TO authenticated;
