-- V105 — Jeux de comptes par client, fournisseur et article (comptabilisation paramétrable par module).
--
-- Jusqu'ici un seul niveau : un compte par rôle de comptabilisation et par société (V18). Les références
-- vont un niveau plus loin : SAP détermine le compte par opération puis par classe de valorisation de
-- l'article et par compte collectif du groupe de tiers ; Sage 300 pose un « jeu de comptes » sur chaque
-- client, fournisseur et article ; Sage X3 des « codes comptables ». On peut ainsi distinguer clients du
-- groupe (4111) et clients locaux (411), fournisseurs étrangers (4012) et locaux (401), ventes de
-- services (706) et de marchandises (701), familles de stock (311 / 321).
--
-- Résolution : la ligne du jeu de la fiche (tiers ou article), sinon le compte par défaut de la société.
-- Une ligne de jeu dont le compte est inactif rend le compte manquant (QG001), sans repli silencieux.
-- Garde-fous (paramètre « lock_control_accounts », actif par défaut, désactivable) : comme SAP refuse de
-- changer le compte collectif ou la classe de valorisation avec des postes ouverts, on ne change ni le
-- jeu d'un tiers qui a des postes ouverts, ni celui d'un article en stock, ni le compte d'un rôle de bilan
-- (créances, acomptes, dettes, factures non parvenues, stock) tant qu'un tiers ou article qui le résout a
-- des postes ouverts. Les fonctions de remplacement de compte et de migration du plan, qui reclassent le
-- solde par écriture, redirigent aussi les jeux. QG026.

-- ─── Référentiel : rôles qu'un jeu peut porter, par type ───
CREATE TABLE public.posting_role_set_kinds (
  kind text NOT NULL CHECK (kind IN ('customer', 'supplier', 'item')),
  role_code text NOT NULL REFERENCES public.posting_roles(code),
  control boolean NOT NULL DEFAULT false,
  PRIMARY KEY (kind, role_code)
);
COMMENT ON COLUMN public.posting_role_set_kinds.control IS 'Rôle de bilan : son compte ne change pas tant que des postes ouverts le résolvent.';
INSERT INTO public.posting_role_set_kinds (kind, role_code, control) VALUES
  ('customer', 'AR_RECEIVABLE', true), ('customer', 'CUSTOMER_ADVANCE', true), ('customer', 'SALES_REVENUE', false),
  ('supplier', 'AP_PAYABLE', true), ('supplier', 'PURCHASES', false), ('supplier', 'GRNI', true),
  ('item', 'INVENTORY', true), ('item', 'STOCK_VARIATION', false);
ALTER TABLE public.posting_role_set_kinds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture du référentiel" ON public.posting_role_set_kinds FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.posting_role_set_kinds FROM anon, authenticated;
GRANT SELECT ON public.posting_role_set_kinds TO authenticated;

-- ─── Jeux de comptes et leurs lignes ───
CREATE TABLE public.posting_account_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('customer', 'supplier', 'item')),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$'),
  name text NOT NULL CHECK (btrim(name) <> ''),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid(),
  UNIQUE (tenant_id, kind, code),
  UNIQUE (id, tenant_id),
  UNIQUE (id, tenant_id, kind)
);
CREATE TABLE public.posting_account_set_lines (
  set_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  kind text NOT NULL,
  role_code text NOT NULL,
  gl_account_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT auth.uid(),
  PRIMARY KEY (set_id, role_code),
  FOREIGN KEY (set_id, tenant_id, kind) REFERENCES public.posting_account_sets(id, tenant_id, kind) ON DELETE CASCADE,
  FOREIGN KEY (kind, role_code) REFERENCES public.posting_role_set_kinds(kind, role_code),
  FOREIGN KEY (gl_account_id, tenant_id) REFERENCES public.gl_accounts(id, tenant_id)
);
CREATE INDEX posting_account_set_lines_account_idx ON public.posting_account_set_lines (gl_account_id);

CREATE TABLE public.posting_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  lock_control_accounts boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT auth.uid()
);

ALTER TABLE public.customers ADD COLUMN account_set_id uuid;
ALTER TABLE public.customers ADD CONSTRAINT customers_account_set_fkey FOREIGN KEY (account_set_id, tenant_id) REFERENCES public.posting_account_sets(id, tenant_id);
ALTER TABLE public.suppliers ADD COLUMN account_set_id uuid;
ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_account_set_fkey FOREIGN KEY (account_set_id, tenant_id) REFERENCES public.posting_account_sets(id, tenant_id);
ALTER TABLE public.items ADD COLUMN account_set_id uuid;
ALTER TABLE public.items ADD CONSTRAINT items_account_set_fkey FOREIGN KEY (account_set_id, tenant_id) REFERENCES public.posting_account_sets(id, tenant_id);
CREATE INDEX customers_account_set_idx ON public.customers (account_set_id) WHERE account_set_id IS NOT NULL;
CREATE INDEX suppliers_account_set_idx ON public.suppliers (account_set_id) WHERE account_set_id IS NOT NULL;
CREATE INDEX items_account_set_idx ON public.items (account_set_id) WHERE account_set_id IS NOT NULL;

-- ─── Droit du catalogue ───
INSERT INTO public.erp_permission_catalog (code, module, action, label)
VALUES ('accounting.account_sets', 'accounting', 'account_sets', 'Gérer les jeux de comptes et la comptabilisation des modules')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
VALUES ('admin', 'accounting.account_sets'), ('accountant', 'accounting.account_sets')
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, sp.permission_code
  FROM public.erp_roles r
  JOIN public.erp_system_role_permissions sp ON sp.role_code = r.code
 WHERE r.is_system AND r.code IN ('admin', 'accountant') AND sp.permission_code = 'accounting.account_sets'
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

-- ─── RLS ───
ALTER TABLE public.posting_account_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posting_account_set_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posting_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture société" ON public.posting_account_sets FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Écriture habilitée" ON public.posting_account_sets FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'accounting.account_sets'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'accounting.account_sets'));
CREATE POLICY "Lecture société" ON public.posting_account_set_lines FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Écriture habilitée" ON public.posting_account_set_lines FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'accounting.account_sets'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'accounting.account_sets'));
CREATE POLICY "Lecture société" ON public.posting_settings FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Écriture habilitée" ON public.posting_settings FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'accounting.account_sets'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'accounting.account_sets'));
REVOKE ALL ON public.posting_account_sets, public.posting_account_set_lines, public.posting_settings FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.posting_account_sets, public.posting_account_set_lines, public.posting_settings TO authenticated;

-- ─── Résolution ───
CREATE FUNCTION public.posting_account_for(_tenant uuid, _role text, _set uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN l.role_code IS NOT NULL
              THEN (SELECT g.id FROM public.gl_accounts g WHERE g.id = l.gl_account_id AND g.tenant_id = _tenant AND g.is_active)
              ELSE public.posting_account(_tenant, _role) END
    FROM (SELECT 1) AS un
    LEFT JOIN public.posting_account_sets s ON s.id = _set AND s.tenant_id = _tenant AND s.is_active
    LEFT JOIN public.posting_account_set_lines l ON l.set_id = s.id AND l.role_code = _role
$$;

CREATE FUNCTION public.require_posting_account(_tenant uuid, _role text, _set uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _a uuid := public.posting_account_for(_tenant, _role, _set);
BEGIN
  IF _a IS NULL THEN
    RAISE EXCEPTION 'Paramétrage comptable incomplet : %', public.posting_roles_label(ARRAY[_role])
      USING ERRCODE = 'QG001', HINT = 'Associer un compte actif à ce rôle dans le paramétrage comptable (société ou jeu de comptes).';
  END IF;
  RETURN _a;
END $$;

CREATE FUNCTION public.customer_account_set(_customer uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT account_set_id FROM public.customers WHERE id = _customer $$;
CREATE FUNCTION public.supplier_account_set(_supplier uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT account_set_id FROM public.suppliers WHERE id = _supplier $$;
CREATE FUNCTION public.item_account_set(_item uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT account_set_id FROM public.items WHERE id = _item $$;

REVOKE EXECUTE ON FUNCTION public.posting_account_for(uuid, text, uuid), public.require_posting_account(uuid, text, uuid),
  public.customer_account_set(uuid), public.supplier_account_set(uuid), public.item_account_set(uuid) FROM PUBLIC, anon, authenticated;

-- ─── Postes ouverts (SECURITY INVOKER : la RLS limite à la société de l'appelant) ───
CREATE FUNCTION public.posting_member_has_open_items(_kind text, _id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE _kind
    WHEN 'customer' THEN
      EXISTS (SELECT 1 FROM public.ar_invoices i WHERE i.customer_id = _id AND i.status NOT IN ('draft', 'paid', 'cancelled')
                 AND i.total - COALESCE(i.amount_paid, 0) > 0.005)
      OR EXISTS (SELECT 1 FROM public.ar_customer_advances a WHERE a.customer_id = _id
                 AND a.amount - a.amount_applied - a.amount_refunded > 0.005)
      OR EXISTS (SELECT 1 FROM public.ar_credit_notes c WHERE c.customer_id = _id
                 AND c.total - c.amount_allocated - c.amount_refunded > 0.005)
    WHEN 'supplier' THEN
      EXISTS (SELECT 1 FROM public.ap_invoices i WHERE i.supplier_id = _id AND i.approval_status = 'approved' AND i.status <> 'paid'
                 AND i.total - COALESCE(i.amount_paid, 0) > 0.005)
      OR EXISTS (SELECT 1 FROM public.ap_credit_notes c WHERE c.supplier_id = _id AND c.total - c.amount_allocated > 0.005)
      OR COALESCE((SELECT SUM(g.amount) FROM public.grni_ledger g JOIN public.po_lines pl ON pl.id = g.po_line_id
                    JOIN public.purchase_orders po ON po.id = pl.po_id WHERE po.supplier_id = _id), 0) > 0.005
    WHEN 'item' THEN
      EXISTS (SELECT 1 FROM public.items it WHERE it.id = _id AND COALESCE(it.quantity_on_hand, 0) <> 0)
    ELSE false END
$$;

-- Nombre de fiches qui résolvent ce rôle par ce jeu (ou, _set NULL, par le compte par défaut) et ont des postes ouverts.
CREATE FUNCTION public.posting_role_open_members(_tenant uuid, _role text, _set uuid)
RETURNS integer LANGUAGE sql STABLE SET search_path = public AS $$
  WITH k AS (SELECT kind FROM public.posting_role_set_kinds WHERE role_code = _role AND control),
  m AS (
    SELECT 'customer'::text AS kind, c.id, c.account_set_id FROM public.customers c WHERE c.tenant_id = _tenant
    UNION ALL SELECT 'supplier', s.id, s.account_set_id FROM public.suppliers s WHERE s.tenant_id = _tenant
    UNION ALL SELECT 'item', i.id, i.account_set_id FROM public.items i WHERE i.tenant_id = _tenant
  )
  SELECT count(*)::integer FROM m JOIN k ON k.kind = m.kind
   WHERE (CASE WHEN _set IS NOT NULL THEN m.account_set_id = _set
               ELSE NOT EXISTS (SELECT 1 FROM public.posting_account_sets s JOIN public.posting_account_set_lines l ON l.set_id = s.id
                                 WHERE s.id = m.account_set_id AND s.is_active AND l.role_code = _role) END)
     AND public.posting_member_has_open_items(m.kind, m.id)
$$;

CREATE FUNCTION public.posting_lock_on(_tenant uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path = public
AS $$ SELECT COALESCE((SELECT lock_control_accounts FROM public.posting_settings WHERE tenant_id = _tenant), true) $$;

-- ─── Garde-fous (pas SECURITY DEFINER : ils voient le rôle de l'appelant) ───
CREATE FUNCTION public.guard_member_account_set() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _kind text := TG_ARGV[0]; _label text := CASE TG_ARGV[0] WHEN 'customer' THEN 'client' WHEN 'supplier' THEN 'fournisseur' ELSE 'article' END;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.account_set_id IS NOT DISTINCT FROM OLD.account_set_id THEN RETURN NEW; END IF;
  IF NEW.account_set_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.posting_account_sets s WHERE s.id = NEW.account_set_id AND s.tenant_id = NEW.tenant_id AND s.kind = _kind AND s.is_active) THEN
    RAISE EXCEPTION 'Jeu de comptes inconnu, inactif ou qui n''est pas un jeu « % »', _label USING ERRCODE = 'QG026';
  END IF;
  IF TG_OP = 'UPDATE' AND current_user IN ('authenticated', 'anon', 'qerp_api') AND public.posting_lock_on(NEW.tenant_id)
     AND public.posting_member_has_open_items(_kind, NEW.id) THEN
    RAISE EXCEPTION 'Jeu de comptes non modifiable : ce % a des postes ouverts (%)', _label,
      CASE _kind WHEN 'item' THEN 'stock non nul' ELSE 'factures, acomptes ou avoirs non soldés' END
      USING ERRCODE = 'QG026', HINT = 'Solder les postes ouverts, ou désactiver le verrouillage dans le paramétrage comptable.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_guard_customer_account_set BEFORE INSERT OR UPDATE OF account_set_id ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.guard_member_account_set('customer');
CREATE TRIGGER trg_guard_supplier_account_set BEFORE INSERT OR UPDATE OF account_set_id ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.guard_member_account_set('supplier');
CREATE TRIGGER trg_guard_item_account_set BEFORE INSERT OR UPDATE OF account_set_id ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.guard_member_account_set('item');

CREATE FUNCTION public.guard_posting_account_set_line() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _r record; _n integer;
BEGIN
  IF TG_OP = 'DELETE' THEN _r := OLD; ELSE _r := NEW; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.set_id <> OLD.set_id OR NEW.role_code <> OLD.role_code OR NEW.kind <> OLD.kind OR NEW.tenant_id <> OLD.tenant_id) THEN
    RAISE EXCEPTION 'Une ligne de jeu de comptes ne change pas de jeu ni de rôle : la supprimer et en créer une autre' USING ERRCODE = 'QG026';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.gl_account_id = OLD.gl_account_id THEN RETURN NEW; END IF;
  IF current_user IN ('authenticated', 'anon', 'qerp_api') AND public.posting_lock_on(_r.tenant_id) THEN
    _n := public.posting_role_open_members(_r.tenant_id, _r.role_code, _r.set_id);
    IF _n > 0 THEN
      RAISE EXCEPTION 'Compte de % non modifiable dans ce jeu : % fiche(s) ont des postes ouverts', (SELECT r.label FROM public.posting_roles r WHERE r.code = _r.role_code), _n
        USING ERRCODE = 'QG026', HINT = 'Solder les postes ouverts, reclasser le solde par le remplacement de compte, ou désactiver le verrouillage.';
    END IF;
  END IF;
  RETURN _r;
END $$;
CREATE TRIGGER trg_guard_posting_account_set_line BEFORE INSERT OR UPDATE OR DELETE ON public.posting_account_set_lines
  FOR EACH ROW EXECUTE FUNCTION public.guard_posting_account_set_line();

CREATE FUNCTION public.guard_posting_account_set() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _l record;
BEGIN
  IF NEW.kind <> OLD.kind OR NEW.tenant_id <> OLD.tenant_id THEN
    RAISE EXCEPTION 'Le type d''un jeu de comptes ne change pas' USING ERRCODE = 'QG026';
  END IF;
  IF NEW.is_active IS DISTINCT FROM OLD.is_active AND current_user IN ('authenticated', 'anon', 'qerp_api') AND public.posting_lock_on(NEW.tenant_id) THEN
    FOR _l IN SELECT role_code FROM public.posting_account_set_lines WHERE set_id = NEW.id LOOP
      IF public.posting_role_open_members(NEW.tenant_id, _l.role_code, NEW.id) > 0 THEN
        RAISE EXCEPTION 'Jeu de comptes % : activation ou désactivation impossible, des fiches ont des postes ouverts sur %', NEW.code,
          (SELECT r.label FROM public.posting_roles r WHERE r.code = _l.role_code) USING ERRCODE = 'QG026';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_guard_posting_account_set BEFORE UPDATE ON public.posting_account_sets
  FOR EACH ROW EXECUTE FUNCTION public.guard_posting_account_set();

-- Le compte par défaut d'un rôle de bilan est protégé de la même façon (écart antérieur à V105).
CREATE FUNCTION public.guard_tenant_posting_account() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _r record; _n integer;
BEGIN
  IF TG_OP = 'DELETE' THEN _r := OLD; ELSE _r := NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.gl_account_id = OLD.gl_account_id AND NEW.role_code = OLD.role_code THEN RETURN NEW; END IF;
  IF current_user IN ('authenticated', 'anon', 'qerp_api') AND public.posting_lock_on(_r.tenant_id) THEN
    _n := public.posting_role_open_members(_r.tenant_id, OLD.role_code, NULL);
    IF _n > 0 THEN
      RAISE EXCEPTION 'Compte de % non modifiable : % fiche(s) qui l''utilisent ont des postes ouverts', (SELECT r.label FROM public.posting_roles r WHERE r.code = OLD.role_code), _n
        USING ERRCODE = 'QG026', HINT = 'Solder les postes ouverts, reclasser le solde par le remplacement de compte, ou désactiver le verrouillage.';
    END IF;
  END IF;
  RETURN _r;
END $$;
CREATE TRIGGER trg_guard_tenant_posting_account BEFORE UPDATE OR DELETE ON public.tenant_posting_accounts
  FOR EACH ROW EXECUTE FUNCTION public.guard_tenant_posting_account();

-- ─── Fonctions de comptabilisation : rôles résolus par le jeu du tiers ou de l'article ───

-- on_ar_invoice_posted
CREATE OR REPLACE FUNCTION public.on_ar_invoice_posted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _entry_id uuid; _entry_number text; _line uuid;
  _ar uuid; _rev uuid; _vat uuid;
  _has_lines boolean;
  _manquants text[] := '{}';
  _g record;
BEGIN
  IF NEW.journal_entry_id IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('sent','open','posted') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN RETURN NEW; END IF;

  _has_lines := EXISTS (SELECT 1 FROM public.ar_invoice_lines WHERE invoice_id = NEW.id);
  _ar  := public.posting_account_for(NEW.tenant_id, 'AR_RECEIVABLE', public.customer_account_set(NEW.customer_id));
  _rev := public.posting_account_for(NEW.tenant_id, 'SALES_REVENUE', public.customer_account_set(NEW.customer_id));
  _vat := public.posting_account(NEW.tenant_id, 'VAT_OUTPUT');

  IF _ar IS NULL THEN _manquants := _manquants || 'AR_RECEIVABLE'::text; END IF;
  -- Le rôle Ventes n'est requis que si une ligne (ou l'en-tête) n'a pas son propre compte.
  IF _rev IS NULL AND (NOT _has_lines OR EXISTS (
       SELECT 1 FROM public.ar_invoice_lines WHERE invoice_id = NEW.id AND revenue_account_id IS NULL)) THEN
    _manquants := _manquants || 'SALES_REVENUE'::text;
  END IF;
  -- Même logique pour la TVA : requise si un montant de TVA n'a pas de compte propre.
  IF _vat IS NULL AND (
       (NOT _has_lines AND COALESCE(NEW.tax_amount,0) > 0)
    OR EXISTS (SELECT 1 FROM public.ar_invoice_lines l LEFT JOIN public.tax_codes t ON t.id = l.tax_code_id
               WHERE l.invoice_id = NEW.id AND l.tax_amount > 0 AND t.gl_account_id IS NULL)) THEN
    _manquants := _manquants || 'VAT_OUTPUT'::text;
  END IF;
  IF cardinality(_manquants) > 0 THEN
    RAISE EXCEPTION 'Paramétrage comptable incomplet : % ; la facture % ne peut pas être émise',
      public.posting_roles_label(_manquants), NEW.invoice_number
      USING ERRCODE = 'QG001',
            HINT = 'Associer un compte actif à chaque rôle dans le paramétrage comptable, ou enregistrer la facture en brouillon.';
  END IF;

  _entry_number := 'JE-AR-' || to_char(now(),'YYYYMMDD') || '-' || substr(NEW.id::text,1,8);
  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES (NEW.tenant_id, _entry_number, NEW.invoice_date, 'AR Invoice: '||NEW.invoice_number, 'ar_invoice', 'draft', NEW.created_by)
  RETURNING id INTO _entry_id;

  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  VALUES (_entry_id, _ar, NEW.total, 0, 'DR Clients');

  IF _has_lines THEN
    -- Produits : une ligne d'écriture par compte de vente.
    FOR _g IN
      SELECT COALESCE(l.revenue_account_id, _rev) AS account, SUM(l.net_amount) AS amount
      FROM public.ar_invoice_lines l WHERE l.invoice_id = NEW.id
      GROUP BY 1 HAVING SUM(l.net_amount) <> 0 ORDER BY 1
    LOOP
      INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
      VALUES (_entry_id, _g.account, 0, _g.amount, 'CR Ventes HT')
      RETURNING id INTO _line;
      PERFORM public.impute_ar_revenue_line(_line, NEW);
    END LOOP;
    -- TVA : une ligne d'écriture par compte de TVA.
    FOR _g IN
      SELECT COALESCE(t.gl_account_id, _vat) AS account, SUM(l.tax_amount) AS amount
      FROM public.ar_invoice_lines l LEFT JOIN public.tax_codes t ON t.id = l.tax_code_id
      WHERE l.invoice_id = NEW.id AND l.tax_amount > 0
      GROUP BY 1 ORDER BY 1
    LOOP
      INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
      VALUES (_entry_id, _g.account, 0, _g.amount, 'CR TVA collectée');
    END LOOP;
  ELSE
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _rev, 0, NEW.subtotal, 'CR Ventes HT')
    RETURNING id INTO _line;
    PERFORM public.impute_ar_revenue_line(_line, NEW);
    IF COALESCE(NEW.tax_amount,0) > 0 THEN
      INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
      VALUES (_entry_id, _vat, 0, NEW.tax_amount, 'CR TVA collectée');
    END IF;
  END IF;

  UPDATE public.journal_entries
    SET status = 'posted', posted_by = NEW.created_by, posted_at = now()
    WHERE id = _entry_id;

  NEW.journal_entry_id := _entry_id;
  RETURN NEW;
END; $function$;

-- create_ar_credit_note
CREATE OR REPLACE FUNCTION public.create_ar_credit_note(_invoice_id uuid, _reason text, _credit_date date DEFAULT CURRENT_DATE, _lines jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _inv public.ar_invoices%ROWTYPE;
  _id uuid := gen_random_uuid();
  _date date := COALESCE(_credit_date, CURRENT_DATE);
  _has_lines boolean;
  _line jsonb;
  _il public.ar_invoice_lines%ROWTYPE;
  _qty numeric; _credited numeric; _net numeric; _tax numeric; _rate numeric;
  _n integer := 0;
  _sub numeric; _vat_total numeric; _total numeric;
  _already numeric;
  _number text;
  _ar uuid; _rev uuid; _vat uuid;
  _entry uuid; _jl uuid;
  _g record;
  _alloc numeric;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'ar.credit_note') THEN
    RAISE EXCEPTION 'Droit insuffisant : émettre un avoir client' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Motif de l''avoir obligatoire' USING ERRCODE = 'QG011';
  END IF;
  SELECT * INTO _inv FROM public.ar_invoices WHERE id = _invoice_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Facture introuvable dans la société active' USING ERRCODE = 'QG011'; END IF;
  IF _inv.status IN ('draft', 'cancelled') THEN
    RAISE EXCEPTION 'Seule une facture émise se corrige par un avoir (un brouillon se modifie ou se supprime)'
      USING ERRCODE = 'QG011';
  END IF;
  IF _date < _inv.invoice_date THEN
    RAISE EXCEPTION 'L''avoir ne peut pas précéder la facture (%)', _inv.invoice_date USING ERRCODE = 'QG011';
  END IF;
  PERFORM public.assert_fiscal_period_open(_tenant, _date, 'AR');

  SELECT COALESCE(SUM(total), 0) INTO _already FROM public.ar_credit_notes WHERE invoice_id = _invoice_id;
  _has_lines := EXISTS (SELECT 1 FROM public.ar_invoice_lines WHERE invoice_id = _invoice_id);

  INSERT INTO public.ar_credit_notes (id, tenant_id, credit_note_number, invoice_id, customer_id, credit_date, reason, created_by)
  VALUES (_id, _tenant, 'AV-PROVISOIRE-' || _id::text, _invoice_id, _inv.customer_id, _date, btrim(_reason), auth.uid());

  IF _has_lines THEN
    -- Sans liste : tout ce qui reste à créditer, ligne par ligne.
    IF _lines IS NULL THEN
      SELECT jsonb_agg(jsonb_build_object('invoice_line_id', l.id, 'quantity', l.quantity - COALESCE(c.q, 0)) ORDER BY l.line_no)
        INTO _lines
        FROM public.ar_invoice_lines l
        LEFT JOIN (SELECT invoice_line_id, SUM(quantity) q FROM public.ar_credit_note_lines GROUP BY 1) c ON c.invoice_line_id = l.id
       WHERE l.invoice_id = _invoice_id AND l.quantity - COALESCE(c.q, 0) > 0;
    END IF;
    IF _lines IS NULL OR jsonb_typeof(_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(_lines) = 0 THEN
      RAISE EXCEPTION 'Rien à créditer sur cette facture' USING ERRCODE = 'QG011';
    END IF;
    FOR _line IN SELECT value FROM jsonb_array_elements(_lines) WITH ORDINALITY AS t(value, k) ORDER BY k LOOP
      SELECT * INTO _il FROM public.ar_invoice_lines
       WHERE id = NULLIF(_line->>'invoice_line_id', '')::uuid AND invoice_id = _invoice_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'La ligne ne fait pas partie de cette facture' USING ERRCODE = 'QG011'; END IF;
      _qty := NULLIF(_line->>'quantity', '')::numeric;
      IF _qty IS NULL OR _qty <= 0 THEN
        RAISE EXCEPTION 'La quantité créditée doit être positive (%)', _il.description USING ERRCODE = 'QG011';
      END IF;
      SELECT COALESCE(SUM(quantity), 0) INTO _credited FROM public.ar_credit_note_lines WHERE invoice_line_id = _il.id;
      IF _credited + _qty > _il.quantity THEN
        RAISE EXCEPTION 'Quantité supérieure au facturé non encore crédité pour « % » (reste %)', _il.description,
          _il.quantity - _credited USING ERRCODE = 'QG011';
      END IF;
      SELECT rate INTO _rate FROM public.tax_codes WHERE id = _il.tax_code_id;
      -- Totalité de la ligne : montants de la facture à l'identique ; sinon même formule (V21).
      IF _credited = 0 AND _qty = _il.quantity THEN
        _net := _il.net_amount; _tax := _il.tax_amount;
      ELSE
        _net := ROUND(_qty * _il.unit_price * (1 - _il.discount_pct / 100), 2);
        _tax := ROUND(_net * COALESCE(_rate, 0) / 100, 2);
      END IF;
      _n := _n + 1;
      INSERT INTO public.ar_credit_note_lines (tenant_id, credit_note_id, line_no, invoice_line_id, description, quantity,
                                              unit_price, discount_pct, tax_code_id, revenue_account_id, net_amount, tax_amount)
      VALUES (_tenant, _id, _n, _il.id, _il.description, _qty, _il.unit_price, _il.discount_pct, _il.tax_code_id,
              _il.revenue_account_id, _net, _tax);
    END LOOP;
  ELSE
    -- Facture d'en-tête : avoir total uniquement.
    IF _lines IS NOT NULL THEN
      RAISE EXCEPTION 'Facture sans lignes : seul un avoir total est possible' USING ERRCODE = 'QG011';
    END IF;
    IF _already > 0 THEN
      RAISE EXCEPTION 'Cette facture a déjà été créditée' USING ERRCODE = 'QG011';
    END IF;
    INSERT INTO public.ar_credit_note_lines (tenant_id, credit_note_id, line_no, description, quantity, unit_price,
                                            net_amount, tax_amount)
    VALUES (_tenant, _id, 1, 'Annulation de la facture ' || _inv.invoice_number, 1, _inv.subtotal, _inv.subtotal, _inv.tax_amount);
  END IF;

  SELECT COALESCE(SUM(net_amount), 0), COALESCE(SUM(tax_amount), 0) INTO _sub, _vat_total
    FROM public.ar_credit_note_lines WHERE credit_note_id = _id;
  _total := _sub + _vat_total;
  IF _total <= 0 THEN RAISE EXCEPTION 'Avoir de montant nul' USING ERRCODE = 'QG011'; END IF;
  IF _already + _total > _inv.total THEN
    RAISE EXCEPTION 'Le total des avoirs (%) dépasserait la facture (%)', _already + _total, _inv.total USING ERRCODE = 'QG011';
  END IF;

  -- Numéro légal (série « credit_note », créée par défaut si la société n'en a pas).
  INSERT INTO public.ar_numbering_series (tenant_id, doc_type, prefix, format, next_number, reset_frequency)
  SELECT _tenant, 'credit_note', 'AV-', 'AV-YYYY-####', 1, 'yearly'
   WHERE NOT EXISTS (SELECT 1 FROM public.ar_numbering_series WHERE tenant_id = _tenant AND doc_type = 'credit_note');
  _number := public.next_document_number(_tenant, 'credit_note', _date);

  -- Écriture miroir de la facture.
  _ar := public.posting_account_for(_tenant, 'AR_RECEIVABLE', public.customer_account_set(_inv.customer_id));
  _rev := public.posting_account_for(_tenant, 'SALES_REVENUE', public.customer_account_set(_inv.customer_id));
  _vat := public.posting_account(_tenant, 'VAT_OUTPUT');
  IF _ar IS NULL
     OR (_rev IS NULL AND EXISTS (SELECT 1 FROM public.ar_credit_note_lines WHERE credit_note_id = _id AND revenue_account_id IS NULL))
     OR (_vat IS NULL AND EXISTS (SELECT 1 FROM public.ar_credit_note_lines l LEFT JOIN public.tax_codes t ON t.id = l.tax_code_id
                                  WHERE l.credit_note_id = _id AND l.tax_amount > 0 AND t.gl_account_id IS NULL)) THEN
    RAISE EXCEPTION 'Paramétrage comptable incomplet : l''avoir ne peut pas être comptabilisé' USING ERRCODE = 'QG001',
      HINT = 'Associer un compte aux rôles Clients, Ventes et TVA collectée dans le paramétrage comptable.';
  END IF;
  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES (_tenant, 'JE-AV-' || to_char(now(), 'YYYYMMDD') || '-' || substr(_id::text, 1, 8), _date,
          'Avoir ' || _number || ' sur facture ' || _inv.invoice_number || ' — ' || btrim(_reason),
          'ar_credit_note', 'draft', auth.uid())
  RETURNING id INTO _entry;
  FOR _g IN
    SELECT COALESCE(revenue_account_id, _rev) AS account, SUM(net_amount) AS amount
      FROM public.ar_credit_note_lines WHERE credit_note_id = _id
     GROUP BY 1 HAVING SUM(net_amount) <> 0 ORDER BY 1
  LOOP
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry, _g.account, _g.amount, 0, 'DR Ventes (avoir)') RETURNING id INTO _jl;
    PERFORM public.impute_ar_revenue_line(_jl, _inv);
  END LOOP;
  FOR _g IN
    SELECT COALESCE(t.gl_account_id, _vat) AS account, SUM(l.tax_amount) AS amount
      FROM public.ar_credit_note_lines l LEFT JOIN public.tax_codes t ON t.id = l.tax_code_id
     WHERE l.credit_note_id = _id AND l.tax_amount > 0
     GROUP BY 1 ORDER BY 1
  LOOP
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry, _g.account, _g.amount, 0, 'DR TVA collectée (avoir)');
  END LOOP;
  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  VALUES (_entry, _ar, 0, _total, 'CR Clients (avoir)');
  UPDATE public.journal_entries SET status = 'posted', posted_by = auth.uid(), posted_at = now() WHERE id = _entry;

  -- Imputation sur le reste dû de la facture. L'avoir est complété AVANT la ligne de règlement :
  -- le lettrage automatique (V49) le lit quand la facture devient soldée.
  _alloc := LEAST(_total, GREATEST(_inv.total - _inv.amount_paid, 0));
  UPDATE public.ar_credit_notes
     SET credit_note_number = _number, subtotal = _sub, tax_amount = _vat_total, total = _total,
         amount_allocated = _alloc, journal_entry_id = _entry
   WHERE id = _id;
  IF _alloc > 0 THEN
    INSERT INTO public.payments (tenant_id, payment_type, ar_invoice_id, amount, payment_date, payment_method,
                                 reference, journal_entry_id, created_by, source_credit_note_id)
    VALUES (_tenant, 'ar_credit', _invoice_id, _alloc, _date, 'credit_note', _number, _entry, auth.uid(), _id);
  END IF;
  RETURN _id;
END; $function$;

-- letter_ar_invoice
CREATE OR REPLACE FUNCTION public.letter_ar_invoice(_invoice_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _inv public.ar_invoices%ROWTYPE;
  _ar uuid;
  _n integer;
  _code text;
  _entries uuid[];
  _debit numeric; _credit numeric;
  _gl boolean := false;
BEGIN
  SELECT * INTO _inv FROM public.ar_invoices WHERE id = _invoice_id;
  IF NOT FOUND OR _inv.status <> 'paid' OR EXISTS (SELECT 1 FROM public.ar_letterings WHERE invoice_id = _invoice_id) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.ar_lettering_counters (tenant_id) VALUES (_inv.tenant_id) ON CONFLICT DO NOTHING;
  UPDATE public.ar_lettering_counters SET next_number = next_number + 1 WHERE tenant_id = _inv.tenant_id
  RETURNING next_number - 1 INTO _n;
  _code := public.lettering_code_of(_n);

  -- Écritures concernées : la facture, ses encaissements (annulations comprises), ses imputations
  -- d'acompte, et l'avoir s'il est entièrement imputé sur cette facture.
  SELECT array_agg(DISTINCT e) INTO _entries FROM (
    SELECT _inv.journal_entry_id AS e
    UNION ALL SELECT p.journal_entry_id FROM public.payments p
     WHERE p.ar_invoice_id = _invoice_id AND p.payment_type IN ('ar_receipt', 'ar_advance') AND p.journal_entry_id IS NOT NULL
    UNION ALL SELECT c.journal_entry_id FROM public.payments p JOIN public.ar_credit_notes c ON c.id = p.source_credit_note_id
     WHERE p.ar_invoice_id = _invoice_id AND p.payment_type = 'ar_credit'
       AND c.amount_allocated = c.total AND c.amount_refunded = 0
       AND NOT EXISTS (SELECT 1 FROM public.payments q WHERE q.source_credit_note_id = c.id AND q.ar_invoice_id <> _invoice_id)
  ) x WHERE e IS NOT NULL;

  _ar := public.posting_account_for(_inv.tenant_id, 'AR_RECEIVABLE', public.customer_account_set(_inv.customer_id));
  IF _ar IS NOT NULL AND _entries IS NOT NULL THEN
    SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0) INTO _debit, _credit
      FROM public.journal_lines WHERE entry_id = ANY(_entries) AND account_id = _ar AND lettering_code IS NULL;
    -- Lettrage du grand livre seulement s'il est exact (sinon : livre auxiliaire seul, à revoir).
    IF _debit > 0 AND _debit = _credit THEN
      UPDATE public.journal_lines SET lettering_code = _code
       WHERE entry_id = ANY(_entries) AND account_id = _ar AND lettering_code IS NULL;
      _gl := true;
    END IF;
  END IF;
  INSERT INTO public.ar_letterings (tenant_id, customer_id, invoice_id, code, gl_lettered)
  VALUES (_inv.tenant_id, _inv.customer_id, _invoice_id, _code, _gl);
  RETURN _code;
END; $function$;

-- apply_customer_credit
CREATE OR REPLACE FUNCTION public.apply_customer_credit(_invoice_id uuid, _source_type text, _source_id uuid, _amount numeric, _apply_date date DEFAULT CURRENT_DATE)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _inv public.ar_invoices%ROWTYPE;
  _adv public.ar_customer_advances%ROWTYPE;
  _cn public.ar_credit_notes%ROWTYPE;
  _date date := COALESCE(_apply_date, CURRENT_DATE);
  _dispo numeric;
  _entry uuid;
  _pay uuid := gen_random_uuid();
BEGIN
  IF NOT public.has_permission(auth.uid(), 'ar.receipt') THEN
    RAISE EXCEPTION 'Droit insuffisant : enregistrer un encaissement client' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _inv FROM public.ar_invoices WHERE id = _invoice_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Facture introuvable dans la société active' USING ERRCODE = 'QG012'; END IF;
  IF _inv.status NOT IN ('sent', 'open', 'posted', 'partially_paid', 'overdue') THEN
    RAISE EXCEPTION 'La facture n''est pas ouverte (statut %)', _inv.status USING ERRCODE = 'QG012';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Le montant imputé doit être positif' USING ERRCODE = 'QG012'; END IF;
  IF _amount > _inv.total - _inv.amount_paid THEN
    RAISE EXCEPTION 'Montant (%) supérieur au reste dû de la facture (%)', _amount, _inv.total - _inv.amount_paid USING ERRCODE = 'QG012';
  END IF;
  PERFORM public.assert_fiscal_period_open(_tenant, _date, 'AR');

  IF _source_type = 'advance' THEN
    SELECT * INTO _adv FROM public.ar_customer_advances WHERE id = _source_id AND tenant_id = _tenant FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Acompte introuvable dans la société active' USING ERRCODE = 'QG012'; END IF;
    IF _adv.customer_id <> _inv.customer_id THEN RAISE EXCEPTION 'L''acompte appartient à un autre client' USING ERRCODE = 'QG012'; END IF;
    _dispo := _adv.amount - _adv.amount_applied - _adv.amount_refunded;
    IF _amount > _dispo THEN RAISE EXCEPTION 'Montant supérieur au disponible de l''acompte (%)', _dispo USING ERRCODE = 'QG012'; END IF;
    _entry := public.post_two_line_entry(_tenant, _date, 'ar_advance_application',
      'Imputation de l''acompte ' || _adv.advance_number || ' sur ' || _inv.invoice_number,
      public.require_posting_account(_tenant, 'CUSTOMER_ADVANCE', public.customer_account_set(_inv.customer_id)), public.require_posting_account(_tenant, 'AR_RECEIVABLE', public.customer_account_set(_inv.customer_id)), _amount);
    UPDATE public.ar_customer_advances SET amount_applied = amount_applied + _amount WHERE id = _adv.id;
    INSERT INTO public.payments (id, tenant_id, payment_type, ar_invoice_id, amount, payment_date, payment_method, reference,
                                 journal_entry_id, created_by, source_advance_id)
    VALUES (_pay, _tenant, 'ar_advance', _invoice_id, _amount, _date, 'advance', _adv.advance_number, _entry, auth.uid(), _adv.id);
  ELSIF _source_type = 'credit_note' THEN
    SELECT * INTO _cn FROM public.ar_credit_notes WHERE id = _source_id AND tenant_id = _tenant FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Avoir introuvable dans la société active' USING ERRCODE = 'QG012'; END IF;
    IF _cn.customer_id <> _inv.customer_id THEN RAISE EXCEPTION 'L''avoir appartient à un autre client' USING ERRCODE = 'QG012'; END IF;
    _dispo := _cn.total - _cn.amount_allocated - _cn.amount_refunded;
    IF _amount > _dispo THEN RAISE EXCEPTION 'Montant supérieur au crédit disponible de l''avoir (%)', _dispo USING ERRCODE = 'QG012'; END IF;
    -- L'avoir a déjà crédité le compte clients : l'imputation ne passe pas de nouvelle écriture.
    UPDATE public.ar_credit_notes SET amount_allocated = amount_allocated + _amount WHERE id = _cn.id;
    INSERT INTO public.payments (id, tenant_id, payment_type, ar_invoice_id, amount, payment_date, payment_method, reference,
                                 journal_entry_id, created_by, source_credit_note_id)
    VALUES (_pay, _tenant, 'ar_credit', _invoice_id, _amount, _date, 'credit_note', _cn.credit_note_number, _cn.journal_entry_id, auth.uid(), _cn.id);
  ELSE
    RAISE EXCEPTION 'Source de crédit inconnue : %', _source_type USING ERRCODE = 'QG012';
  END IF;
  RETURN _pay;
END; $function$;

-- record_customer_advance
CREATE OR REPLACE FUNCTION public.record_customer_advance(_customer_id uuid, _received_date date, _payment_method text, _reference text, _amount numeric, _sales_order_id uuid DEFAULT NULL::uuid, _bank_account_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _id uuid := gen_random_uuid();
  _date date := COALESCE(_received_date, CURRENT_DATE);
  _number text;
  _entry uuid;
  _client text;
  _treso uuid;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'ar.receipt') THEN
    RAISE EXCEPTION 'Droit insuffisant : enregistrer un encaissement client' USING ERRCODE = '42501';
  END IF;
  SELECT name INTO _client FROM public.customers WHERE id = _customer_id AND tenant_id = _tenant;
  IF _client IS NULL THEN RAISE EXCEPTION 'Client introuvable dans la société active' USING ERRCODE = 'QG012'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Le montant de l''acompte doit être positif' USING ERRCODE = 'QG012'; END IF;
  IF _sales_order_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.sales_orders WHERE id = _sales_order_id AND tenant_id = _tenant AND customer_id = _customer_id) THEN
    RAISE EXCEPTION 'La commande citée n''est pas une commande de ce client' USING ERRCODE = 'QG012';
  END IF;
  PERFORM public.assert_fiscal_period_open(_tenant, _date, 'AR');

  INSERT INTO public.ar_numbering_series (tenant_id, doc_type, prefix, format, next_number, reset_frequency)
  SELECT _tenant, 'advance', 'ACP-', 'ACP-YYYY-####', 1, 'yearly'
   WHERE NOT EXISTS (SELECT 1 FROM public.ar_numbering_series WHERE tenant_id = _tenant AND doc_type = 'advance');
  _number := public.next_document_number(_tenant, 'advance', _date);

  _treso := public.resolve_treasury_account(_tenant, _bank_account_id, _payment_method);
  _entry := public.post_two_line_entry(_tenant, _date, 'ar_advance', 'Acompte ' || _number || ' — ' || _client,
    public.treasury_gl_account(_tenant, _treso, _payment_method), public.require_posting_account(_tenant, 'CUSTOMER_ADVANCE', public.customer_account_set(_customer_id)), _amount);
  PERFORM public.record_treasury_line(_tenant, _treso, _date, _amount, 'advance', 'Acompte ' || _number || ' — ' || _client,
    COALESCE(NULLIF(btrim(_reference), ''), _number), _entry, NULL);

  INSERT INTO public.ar_customer_advances (id, tenant_id, advance_number, customer_id, sales_order_id, received_date, amount,
                                          payment_method, reference, journal_entry_id, created_by)
  VALUES (_id, _tenant, _number, _customer_id, _sales_order_id, _date, _amount, COALESCE(NULLIF(btrim(_payment_method), ''), 'bank_transfer'),
          NULLIF(btrim(_reference), ''), _entry, auth.uid());
  RETURN _id;
END; $function$;

-- refund_customer_credit
CREATE OR REPLACE FUNCTION public.refund_customer_credit(_source_type text, _source_id uuid, _amount numeric, _refund_date date DEFAULT CURRENT_DATE, _payment_method text DEFAULT 'bank_transfer'::text, _reference text DEFAULT NULL::text, _bank_account_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _adv public.ar_customer_advances%ROWTYPE;
  _cn public.ar_credit_notes%ROWTYPE;
  _date date := COALESCE(_refund_date, CURRENT_DATE);
  _dispo numeric;
  _entry uuid;
  _id uuid := gen_random_uuid();
  _treso uuid;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'ar.refund') THEN
    RAISE EXCEPTION 'Droit insuffisant : rembourser un crédit client' USING ERRCODE = '42501';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Le montant remboursé doit être positif' USING ERRCODE = 'QG012'; END IF;
  PERFORM public.assert_fiscal_period_open(_tenant, _date, 'AR');
  _treso := public.resolve_treasury_account(_tenant, _bank_account_id, _payment_method);
  IF _source_type = 'advance' THEN
    SELECT * INTO _adv FROM public.ar_customer_advances WHERE id = _source_id AND tenant_id = _tenant FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Acompte introuvable dans la société active' USING ERRCODE = 'QG012'; END IF;
    _dispo := _adv.amount - _adv.amount_applied - _adv.amount_refunded;
    IF _amount > _dispo THEN RAISE EXCEPTION 'Montant supérieur au disponible de l''acompte (%)', _dispo USING ERRCODE = 'QG012'; END IF;
    _entry := public.post_two_line_entry(_tenant, _date, 'ar_refund', 'Remboursement de l''acompte ' || _adv.advance_number,
      public.require_posting_account(_tenant, 'CUSTOMER_ADVANCE', public.customer_account_set(_adv.customer_id)), public.treasury_gl_account(_tenant, _treso, _payment_method), _amount);
    UPDATE public.ar_customer_advances SET amount_refunded = amount_refunded + _amount WHERE id = _adv.id;
    PERFORM public.record_treasury_line(_tenant, _treso, _date, -_amount, 'refund', 'Remboursement de l''acompte ' || _adv.advance_number,
      NULLIF(btrim(_reference), ''), _entry, NULL);
    INSERT INTO public.ar_customer_refunds (id, tenant_id, customer_id, source_type, advance_id, refund_date, amount,
                                           payment_method, reference, journal_entry_id, created_by)
    VALUES (_id, _tenant, _adv.customer_id, 'advance', _adv.id, _date, _amount, COALESCE(NULLIF(btrim(_payment_method), ''), 'bank_transfer'),
            NULLIF(btrim(_reference), ''), _entry, auth.uid());
  ELSIF _source_type = 'credit_note' THEN
    SELECT * INTO _cn FROM public.ar_credit_notes WHERE id = _source_id AND tenant_id = _tenant FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Avoir introuvable dans la société active' USING ERRCODE = 'QG012'; END IF;
    _dispo := _cn.total - _cn.amount_allocated - _cn.amount_refunded;
    IF _amount > _dispo THEN RAISE EXCEPTION 'Montant supérieur au crédit disponible de l''avoir (%)', _dispo USING ERRCODE = 'QG012'; END IF;
    _entry := public.post_two_line_entry(_tenant, _date, 'ar_refund', 'Remboursement de l''avoir ' || _cn.credit_note_number,
      public.require_posting_account(_tenant, 'AR_RECEIVABLE', public.customer_account_set(_cn.customer_id)), public.treasury_gl_account(_tenant, _treso, _payment_method), _amount);
    UPDATE public.ar_credit_notes SET amount_refunded = amount_refunded + _amount WHERE id = _cn.id;
    PERFORM public.record_treasury_line(_tenant, _treso, _date, -_amount, 'refund', 'Remboursement de l''avoir ' || _cn.credit_note_number,
      NULLIF(btrim(_reference), ''), _entry, NULL);
    INSERT INTO public.ar_customer_refunds (id, tenant_id, customer_id, source_type, credit_note_id, refund_date, amount,
                                           payment_method, reference, journal_entry_id, created_by)
    VALUES (_id, _tenant, _cn.customer_id, 'credit_note', _cn.id, _date, _amount, COALESCE(NULLIF(btrim(_payment_method), ''), 'bank_transfer'),
            NULLIF(btrim(_reference), ''), _entry, auth.uid());
  ELSE
    RAISE EXCEPTION 'Source de crédit inconnue : %', _source_type USING ERRCODE = 'QG012';
  END IF;
  RETURN _id;
END; $function$;

-- ap_invoice_journal_entry
CREATE OR REPLACE FUNCTION public.ap_invoice_journal_entry(_inv ap_invoices)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _entry_id uuid;
  _payable uuid := public.posting_account_for(_inv.tenant_id, 'AP_PAYABLE', public.supplier_account_set(_inv.supplier_id));
  _purchases uuid := public.posting_account_for(_inv.tenant_id, 'PURCHASES', public.supplier_account_set(_inv.supplier_id));
  _vat uuid := public.posting_account(_inv.tenant_id, 'VAT_INPUT');
  _grni uuid := public.posting_account_for(_inv.tenant_id, 'GRNI', public.supplier_account_set(_inv.supplier_id));
  _grni_on boolean := COALESCE((public.procurement_setting(_inv.tenant_id)).grni_on_receipt, false);
  _has_lines boolean := EXISTS (SELECT 1 FROM public.ap_invoice_lines WHERE invoice_id = _inv.id);
  _tax numeric := COALESCE(_inv.tax_amount, 0);
  _net numeric := COALESCE(_inv.subtotal, 0);
  _total numeric := round(COALESCE(_inv.subtotal, 0) + COALESCE(_inv.tax_amount, 0), 2);
  _manquants text[] := '{}';
  _l record; _clear numeric; _left numeric; _acc uuid[] := '{}'; _amt numeric[] := '{}'; _lbl text[] := '{}';
  _sec text[] := '{}'; _g record; _jl uuid; _hdr text := public.analytic_key(public.document_analytic_values('AP', _inv.id));
BEGIN
  IF _payable IS NULL THEN _manquants := _manquants || 'AP_PAYABLE'::text; END IF;
  IF _purchases IS NULL AND (NOT _has_lines OR EXISTS (SELECT 1 FROM public.ap_invoice_lines WHERE invoice_id = _inv.id AND expense_account_id IS NULL)) THEN
    _manquants := _manquants || 'PURCHASES'::text;
  END IF;
  IF _tax <> 0 AND _vat IS NULL AND (NOT _has_lines OR EXISTS (
       SELECT 1 FROM public.ap_invoice_lines l LEFT JOIN public.tax_codes t ON t.id = l.tax_code_id
        WHERE l.invoice_id = _inv.id AND l.tax_amount <> 0 AND t.gl_account_id IS NULL)) THEN
    _manquants := _manquants || 'VAT_INPUT'::text;
  END IF;
  IF _grni_on AND _grni IS NULL AND _inv.po_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.grni_ledger g JOIN public.po_lines pl ON pl.id = g.po_line_id WHERE pl.po_id = _inv.po_id) THEN
    _manquants := _manquants || 'GRNI'::text;
  END IF;
  IF cardinality(_manquants) > 0 THEN
    RAISE EXCEPTION 'Paramétrage comptable incomplet : % ; la facture fournisseur % ne peut pas être comptabilisée',
      public.posting_roles_label(_manquants), _inv.invoice_number
      USING ERRCODE = 'QG001', HINT = 'Associer un compte actif à chaque rôle dans le paramétrage comptable.';
  END IF;
  PERFORM set_config('qerp.ap_posting', 'on', true);

  IF _has_lines THEN
    FOR _l IN SELECT l.*, pl.unit_cost FROM public.ap_invoice_lines l LEFT JOIN public.po_lines pl ON pl.id = l.po_line_id
               WHERE l.invoice_id = _inv.id ORDER BY l.line_no LOOP
      _clear := 0;
      IF _grni_on AND _l.po_line_id IS NOT NULL THEN
        _clear := greatest(0, least(round(_l.quantity * COALESCE(_l.unit_cost, 0), 2), public.grni_open(_l.po_line_id)));
        IF _clear > 0 THEN
          INSERT INTO public.grni_ledger (tenant_id, po_line_id, source, source_id, amount) VALUES (_inv.tenant_id, _l.po_line_id, 'invoice', _inv.id, -_clear);
          UPDATE public.ap_invoice_lines SET grni_cleared = _clear WHERE id = _l.id;
          _acc := _acc || _grni; _amt := _amt || _clear; _lbl := _lbl || 'DR Factures non parvenues'::text; _sec := _sec || ''::text;
        END IF;
      END IF;
      IF _l.net_amount - _clear <> 0 THEN
        _acc := _acc || COALESCE(_l.expense_account_id, _purchases); _amt := _amt || (_l.net_amount - _clear);
        _lbl := _lbl || CASE WHEN _clear > 0 THEN 'Écart de prix / quantité' ELSE 'DR Achats HT' END;
        _sec := _sec || public.analytic_key(public.line_effective_analytics('AP', _l.id));
      END IF;
    END LOOP;
    FOR _l IN SELECT COALESCE(t.gl_account_id, _vat) AS acc, sum(l.tax_amount) AS tax FROM public.ap_invoice_lines l
                LEFT JOIN public.tax_codes t ON t.id = l.tax_code_id WHERE l.invoice_id = _inv.id AND l.tax_amount <> 0 GROUP BY 1 LOOP
      _acc := _acc || _l.acc; _amt := _amt || _l.tax; _lbl := _lbl || 'DR TVA déductible'::text; _sec := _sec || ''::text;
    END LOOP;
  ELSE
    _clear := 0;
    IF _grni_on AND _inv.po_id IS NOT NULL THEN
      _left := _net;
      FOR _l IN SELECT pl.id, public.grni_open(pl.id) AS open FROM public.po_lines pl WHERE pl.po_id = _inv.po_id ORDER BY pl.id LOOP
        EXIT WHEN _left <= 0;
        IF _l.open > 0 THEN
          INSERT INTO public.grni_ledger (tenant_id, po_line_id, source, source_id, amount) VALUES (_inv.tenant_id, _l.id, 'invoice', _inv.id, -least(_l.open, _left));
          _clear := _clear + least(_l.open, _left); _left := _left - least(_l.open, _left);
        END IF;
      END LOOP;
    END IF;
    IF _clear > 0 THEN _acc := _acc || _grni; _amt := _amt || _clear; _lbl := _lbl || 'DR Factures non parvenues'::text; _sec := _sec || ''::text; END IF;
    IF _net - _clear <> 0 THEN _acc := _acc || _purchases; _amt := _amt || (_net - _clear); _lbl := _lbl || 'DR Achats HT'::text; _sec := _sec || _hdr; END IF;
    IF _tax <> 0 THEN _acc := _acc || _vat; _amt := _amt || _tax; _lbl := _lbl || 'DR TVA déductible'::text; _sec := _sec || ''::text; END IF;
  END IF;

  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES (_inv.tenant_id, 'JE-AP-' || to_char(now(), 'YYYYMMDD') || '-' || substr(_inv.id::text, 1, 8),
          _inv.invoice_date, 'Facture fournisseur ' || _inv.invoice_number, 'ap_invoice', 'draft', _inv.created_by)
  RETURNING id INTO _entry_id;
  -- Une ligne d'écriture par compte × ensemble de sections (V78), imputée avant la comptabilisation.
  FOR _g IN SELECT x.a, x.s, sum(x.m) AS m, min(x.l) AS l FROM unnest(_acc, _amt, _lbl, _sec) AS x(a, m, l, s)
             GROUP BY x.a, x.s HAVING sum(x.m) <> 0 ORDER BY min(x.l), x.s LOOP
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _g.a, greatest(_g.m, 0), greatest(-_g.m, 0), _g.l) RETURNING id INTO _jl;
    IF _g.s <> '' THEN PERFORM public.impute_line_analytics(_jl, string_to_array(_g.s, ',')::uuid[]); END IF;
  END LOOP;
  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  VALUES (_entry_id, _payable, 0, _total, 'CR Fournisseurs');
  UPDATE public.grni_ledger SET journal_entry_id = _entry_id WHERE source = 'invoice' AND source_id = _inv.id AND journal_entry_id IS NULL;
  UPDATE public.journal_entries SET status = 'posted', posted_by = _inv.created_by, posted_at = now() WHERE id = _entry_id;
  PERFORM set_config('qerp.ap_posting', 'off', true);
  RETURN _entry_id;
END $function$;

-- create_ap_credit_note
CREATE OR REPLACE FUNCTION public.create_ap_credit_note(_invoice_id uuid, _reason text, _credit_date date, _subtotal numeric, _tax_amount numeric, _supplier_reference text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _inv public.ap_invoices%ROWTYPE;
  _date date := COALESCE(_credit_date, CURRENT_DATE);
  _sub numeric := ROUND(COALESCE(_subtotal, 0), 2);
  _tax numeric := ROUND(COALESCE(_tax_amount, 0), 2);
  _total numeric;
  _done_sub numeric; _done_tax numeric;
  _payable uuid; _purchases uuid; _vat uuid;
  _id uuid := gen_random_uuid();
  _number text; _entry uuid; _alloc numeric;
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Aucune société active' USING ERRCODE = '42501'; END IF;
  IF NOT public.has_permission(auth.uid(), 'ap.credit_note') THEN
    RAISE EXCEPTION 'Droit insuffisant : %', (SELECT label FROM public.erp_permission_catalog WHERE code = 'ap.credit_note')
      USING ERRCODE = '42501';
  END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'Motif de l''avoir obligatoire' USING ERRCODE = 'QG014';
  END IF;
  SELECT * INTO _inv FROM public.ap_invoices WHERE id = _invoice_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Facture fournisseur introuvable dans la société active' USING ERRCODE = 'QG014'; END IF;
  IF _inv.approval_status <> 'approved' OR _inv.status NOT IN ('open', 'partially_paid', 'overdue', 'paid') THEN
    RAISE EXCEPTION 'Seule une facture fournisseur approuvée se crédite (facture %)', _inv.invoice_number
      USING ERRCODE = 'QG014';
  END IF;
  IF _sub < 0 OR _tax < 0 OR _sub + _tax <= 0 THEN
    RAISE EXCEPTION 'Montants de l''avoir invalides (HT %, TVA %)', _sub, _tax USING ERRCODE = 'QG014';
  END IF;
  SELECT COALESCE(sum(subtotal), 0), COALESCE(sum(tax_amount), 0) INTO _done_sub, _done_tax
    FROM public.ap_credit_notes WHERE invoice_id = _invoice_id;
  IF _done_sub + _sub > _inv.subtotal THEN
    RAISE EXCEPTION 'HT des avoirs (%) supérieur au HT de la facture % (%)', _done_sub + _sub, _inv.invoice_number, _inv.subtotal
      USING ERRCODE = 'QG014';
  END IF;
  IF _done_tax + _tax > _inv.tax_amount THEN
    RAISE EXCEPTION 'TVA des avoirs (%) supérieure à la TVA de la facture % (%)', _done_tax + _tax, _inv.invoice_number, _inv.tax_amount
      USING ERRCODE = 'QG014';
  END IF;
  PERFORM public.assert_fiscal_period_open(_tenant, _date, 'AP');
  _total := _sub + _tax;

  _payable := public.require_posting_account(_tenant, 'AP_PAYABLE', public.supplier_account_set(_inv.supplier_id));
  IF _sub > 0 THEN _purchases := public.require_posting_account(_tenant, 'PURCHASES', public.supplier_account_set(_inv.supplier_id)); END IF;
  IF _tax > 0 THEN _vat := public.require_posting_account(_tenant, 'VAT_INPUT'); END IF;

  INSERT INTO public.ar_numbering_series (tenant_id, doc_type, prefix, format, next_number, reset_frequency)
  SELECT _tenant, 'ap_credit_note', 'AVF-', 'AVF-YYYY-####', 1, 'yearly'
   WHERE NOT EXISTS (SELECT 1 FROM public.ar_numbering_series WHERE tenant_id = _tenant AND doc_type = 'ap_credit_note');
  _number := public.next_document_number(_tenant, 'ap_credit_note', _date);

  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES (_tenant, 'JE-AVF-' || to_char(now(), 'YYYYMMDD') || '-' || substr(_id::text, 1, 8), _date,
          'Avoir fournisseur ' || _number || ' sur facture ' || _inv.invoice_number || ' — ' || btrim(_reason),
          'ap_credit_note', 'draft', auth.uid())
  RETURNING id INTO _entry;
  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  VALUES (_entry, _payable, _total, 0, 'DR Fournisseurs (avoir)');
  IF _sub > 0 THEN
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry, _purchases, 0, _sub, 'CR Achats (avoir)');
  END IF;
  IF _tax > 0 THEN
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry, _vat, 0, _tax, 'CR TVA récupérable (avoir)');
  END IF;
  PERFORM public.impute_entry_analytics(_entry, public.document_analytic_values('AP', _invoice_id));
  UPDATE public.journal_entries SET status = 'posted', posted_by = auth.uid(), posted_at = now() WHERE id = _entry;

  _alloc := LEAST(_total, GREATEST(_inv.total - _inv.amount_paid, 0));
  INSERT INTO public.ap_credit_notes (id, tenant_id, credit_note_number, invoice_id, supplier_id, supplier_reference, credit_date,
                                      reason, subtotal, tax_amount, total, amount_allocated, journal_entry_id, created_by)
  VALUES (_id, _tenant, _number, _invoice_id, _inv.supplier_id, NULLIF(btrim(COALESCE(_supplier_reference, '')), ''), _date,
          btrim(_reason), _sub, _tax, _total, _alloc, _entry, auth.uid());
  IF _alloc > 0 THEN
    INSERT INTO public.payments (tenant_id, payment_type, ap_invoice_id, amount, payment_date, payment_method,
                                 reference, journal_entry_id, created_by, source_ap_credit_note_id)
    VALUES (_tenant, 'ap_credit', _invoice_id, _alloc, _date, 'credit_note', _number, _entry, auth.uid(), _id);
  END IF;
  RETURN _id;
END; $function$;

-- on_ap_payment_recorded
CREATE OR REPLACE FUNCTION public.on_ap_payment_recorded()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _entry_id uuid; _entry_number text;
  _payable uuid; _bank uuid; _ar uuid;
  _manquants text[] := '{}';
  _date date := COALESCE(NEW.payment_date, CURRENT_DATE);
BEGIN
  IF NEW.reversal_of IS NOT NULL THEN RETURN NEW; END IF;

  IF NEW.payment_type = 'ap_payment' AND NEW.ap_invoice_id IS NOT NULL THEN
    _payable := public.posting_account_for(NEW.tenant_id, 'AP_PAYABLE', public.supplier_account_set((SELECT i.supplier_id FROM public.ap_invoices i WHERE i.id = NEW.ap_invoice_id)));
    _bank    := public.treasury_gl_account(NEW.tenant_id, NEW.bank_account_id, NEW.payment_method, false);

    IF _payable IS NULL THEN _manquants := _manquants || 'AP_PAYABLE'::text; END IF;
    IF _bank    IS NULL THEN _manquants := _manquants || public.treasury_role_for_method(NEW.payment_method); END IF;
    IF cardinality(_manquants) > 0 THEN
      RAISE EXCEPTION 'Paramétrage comptable incomplet : % ; le paiement fournisseur ne peut pas être enregistré',
        public.posting_roles_label(_manquants)
        USING ERRCODE = 'QG001',
              HINT = 'Associer un compte actif à chaque rôle dans le paramétrage comptable.';
    END IF;

    _entry_number := 'JE-PAY-AP-' || to_char(now(),'YYYYMMDD') || '-' || substr(NEW.id::text,1,8);
    INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
    VALUES (NEW.tenant_id, _entry_number, _date, 'AP Payment: '||COALESCE(NEW.reference, NEW.id::text), 'ap_payment', 'draft', NEW.created_by)
    RETURNING id INTO _entry_id;
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _payable, NEW.amount, 0, 'DR Fournisseurs');
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _bank, 0, NEW.amount, 'CR Trésorerie');
    UPDATE public.journal_entries SET status='posted', posted_by=NEW.created_by, posted_at=now() WHERE id=_entry_id;
  END IF;

  IF NEW.payment_type = 'ar_receipt' AND NEW.ar_invoice_id IS NOT NULL THEN
    _bank := public.treasury_gl_account(NEW.tenant_id, NEW.bank_account_id, NEW.payment_method, false);
    _ar   := public.posting_account_for(NEW.tenant_id, 'AR_RECEIVABLE', public.customer_account_set((SELECT i.customer_id FROM public.ar_invoices i WHERE i.id = NEW.ar_invoice_id)));

    IF _bank IS NULL THEN _manquants := _manquants || public.treasury_role_for_method(NEW.payment_method); END IF;
    IF _ar   IS NULL THEN _manquants := _manquants || 'AR_RECEIVABLE'::text; END IF;
    IF cardinality(_manquants) > 0 THEN
      RAISE EXCEPTION 'Paramétrage comptable incomplet : % ; l''encaissement ne peut pas être enregistré',
        public.posting_roles_label(_manquants)
        USING ERRCODE = 'QG001',
              HINT = 'Associer un compte actif à chaque rôle dans le paramétrage comptable.';
    END IF;

    _entry_number := 'JE-REC-AR-' || to_char(now(),'YYYYMMDD') || '-' || substr(NEW.id::text,1,8);
    INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
    VALUES (NEW.tenant_id, _entry_number, _date, 'AR Receipt: '||COALESCE(NEW.reference, NEW.id::text), 'ar_receipt', 'draft', NEW.created_by)
    RETURNING id INTO _entry_id;
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _bank, NEW.amount, 0, 'DR Trésorerie');
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _ar, 0, NEW.amount, 'CR Clients');
    UPDATE public.journal_entries SET status='posted', posted_by=NEW.created_by, posted_at=now() WHERE id=_entry_id;
  END IF;

  IF _entry_id IS NOT NULL THEN
    UPDATE public.payments SET journal_entry_id = _entry_id WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END; $function$;

-- on_gr_grni
CREATE OR REPLACE FUNCTION public.on_gr_grni()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _entry uuid; _who uuid; _g record; _jl uuid; _label text; _sum numeric := 0; _purchases uuid; _grni uuid;
BEGIN
  IF TG_OP <> 'UPDATE' OR NEW.status <> 'completed' OR OLD.status = 'completed' THEN RETURN NULL; END IF;
  IF NOT COALESCE((public.procurement_setting(NEW.tenant_id)).grni_on_receipt, false) THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gr_lines gl JOIN public.po_lines pl ON pl.id = gl.po_line_id
                  WHERE gl.gr_id = NEW.id AND gl.quantity_received > 0 AND COALESCE(pl.unit_cost, 0) > 0) THEN RETURN NULL; END IF;
  _purchases := public.require_posting_account(NEW.tenant_id, 'PURCHASES', public.supplier_account_set((SELECT po.supplier_id FROM public.purchase_orders po WHERE po.id = NEW.po_id)));
  _grni := public.require_posting_account(NEW.tenant_id, 'GRNI', public.supplier_account_set((SELECT po.supplier_id FROM public.purchase_orders po WHERE po.id = NEW.po_id)));
  _who := COALESCE(auth.uid(), NEW.received_by);
  _label := 'Réception ' || NEW.gr_number || ' — factures non parvenues';
  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES (NEW.tenant_id, 'JE-GOODS_-' || to_char(now(), 'YYYYMMDDHH24MISSMS') || '-' || substr(gen_random_uuid()::text, 1, 6),
          COALESCE(NEW.receipt_date, CURRENT_DATE), _label, 'goods_receipt', 'draft', _who)
  RETURNING id INTO _entry;
  FOR _g IN
    SELECT public.analytic_key(public.line_effective_analytics('PO', gl.po_line_id)) AS k, round(sum(gl.quantity_received * COALESCE(pl.unit_cost, 0)), 2) AS m
      FROM public.gr_lines gl JOIN public.po_lines pl ON pl.id = gl.po_line_id
     WHERE gl.gr_id = NEW.id AND gl.quantity_received > 0 GROUP BY 1
  LOOP
    CONTINUE WHEN _g.m = 0;
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description) VALUES (_entry, _purchases, _g.m, 0, _label) RETURNING id INTO _jl;
    IF _g.k <> '' THEN PERFORM public.impute_line_analytics(_jl, string_to_array(_g.k, ',')::uuid[]); END IF;
    _sum := _sum + _g.m;
  END LOOP;
  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description) VALUES (_entry, _grni, 0, _sum, _label);
  UPDATE public.journal_entries SET status = 'posted', posted_by = _who, posted_at = now() WHERE id = _entry;
  INSERT INTO public.grni_ledger (tenant_id, po_line_id, source, source_id, amount, journal_entry_id)
  SELECT NEW.tenant_id, gl.po_line_id, 'receipt', NEW.id, round(sum(gl.quantity_received * COALESCE(pl.unit_cost, 0)), 2), _entry
    FROM public.gr_lines gl JOIN public.po_lines pl ON pl.id = gl.po_line_id
   WHERE gl.gr_id = NEW.id AND gl.quantity_received > 0 GROUP BY gl.po_line_id;
  RETURN NULL;
END $function$;

-- on_supplier_return_grni
CREATE OR REPLACE FUNCTION public.on_supplier_return_grni()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _r public.supplier_returns%ROWTYPE; _amt numeric; _entry uuid;
BEGIN
  IF NEW.po_line_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO _r FROM public.supplier_returns WHERE id = NEW.return_id;
  IF NOT COALESCE((public.procurement_setting(_r.tenant_id)).grni_on_receipt, false) THEN RETURN NULL; END IF;
  _amt := least(round(NEW.quantity * COALESCE(NEW.unit_cost, 0), 2), public.grni_open(NEW.po_line_id));
  IF _amt <= 0 THEN RETURN NULL; END IF;
  _entry := public.post_two_line_entry_as(_r.tenant_id, COALESCE(_r.return_date, CURRENT_DATE), 'grni_return',
    'Retour ' || _r.return_number || ' — factures non parvenues',
    public.require_posting_account(_r.tenant_id, 'GRNI', public.supplier_account_set(_r.supplier_id)), public.require_posting_account(_r.tenant_id, 'PURCHASES', public.supplier_account_set(_r.supplier_id)), _amt, _r.created_by,
    public.line_effective_analytics('PO', NEW.po_line_id));
  INSERT INTO public.grni_ledger (tenant_id, po_line_id, source, source_id, amount, journal_entry_id)
  VALUES (_r.tenant_id, NEW.po_line_id, 'return', _r.id, -_amt, _entry);
  RETURN NULL;
END $function$;

-- on_stock_movement_je
CREATE OR REPLACE FUNCTION public.on_stock_movement_je()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _permanent boolean;
  _stock_acc uuid; _variation_acc uuid;
  _entry_id uuid;
  _value numeric := COALESCE(NEW.total_value, 0);
  _is_in boolean := COALESCE(NEW.quantity, 0) > 0;
  _label text;
BEGIN
  IF NEW.journal_entry_id IS NOT NULL OR NEW.status <> 'posted' OR _value <= 0 THEN RETURN NEW; END IF;
  -- Un transfert entre dépôts ne change pas la valeur du stock de la société.
  IF NEW.movement_type LIKE 'transfer%' THEN RETURN NEW; END IF;

  SELECT auto_je_on_movement INTO _permanent FROM public.inventory_settings WHERE tenant_id = NEW.tenant_id;
  IF NOT COALESCE(_permanent, true) THEN RETURN NEW; END IF;   -- inventaire intermittent

  _stock_acc := public.require_posting_account(NEW.tenant_id, 'INVENTORY', public.item_account_set(NEW.item_id));
  _variation_acc := public.require_posting_account(NEW.tenant_id, 'STOCK_VARIATION', public.item_account_set(NEW.item_id));

  _label := CASE NEW.movement_type
              WHEN 'receipt' THEN 'Entrée en stock — réception'
              WHEN 'customer_return' THEN 'Entrée en stock — retour client'
              WHEN 'delivery' THEN 'Sortie de stock — livraison'
              WHEN 'supplier_return' THEN 'Sortie de stock — retour fournisseur'
              WHEN 'adjustment' THEN CASE WHEN _is_in THEN 'Ajustement de stock (excédent)' ELSE 'Ajustement de stock (manquant)' END
              ELSE CASE WHEN _is_in THEN 'Entrée en stock' ELSE 'Sortie de stock' END || ' — ' || NEW.movement_type
            END;

  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES (NEW.tenant_id, 'JE-STK-' || to_char(now(), 'YYYYMMDD') || '-' || substr(NEW.id::text, 1, 8),
          COALESCE(NEW.movement_date, CURRENT_DATE), _label, 'stock_movement', 'draft', NEW.created_by)
  RETURNING id INTO _entry_id;

  IF _is_in THEN
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _stock_acc, _value, 0, _label), (_entry_id, _variation_acc, 0, _value, _label);
  ELSE
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _variation_acc, _value, 0, _label), (_entry_id, _stock_acc, 0, _value, _label);
  END IF;

  UPDATE public.journal_entries SET status = 'posted', posted_by = NEW.created_by, posted_at = now() WHERE id = _entry_id;
  UPDATE public.stock_movements SET journal_entry_id = _entry_id WHERE id = NEW.id;
  RETURN NEW;
END $function$;

-- budget_committed
CREATE OR REPLACE FUNCTION public.budget_committed(_tenant uuid, _code text, _from date, _to date, _except uuid DEFAULT NULL::uuid, _value uuid DEFAULT NULL::uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(sum(greatest(
           CASE WHEN _value IS NULL THEN po.total ELSE public.document_amount_in_scope('PO', po.id, _value) END
           - COALESCE((SELECT sum(CASE WHEN _value IS NULL THEN i.subtotal ELSE public.document_amount_in_scope('AP', i.id, _value) END)
                         FROM public.ap_invoices i WHERE i.po_id = po.id AND i.approval_status = 'approved'), 0), 0)), 0)
    FROM public.purchase_orders po
   WHERE po.tenant_id = _tenant AND po.status IN ('approved', 'ordered', 'partially_received', 'received')
     AND po.order_date BETWEEN _from AND _to AND (_except IS NULL OR po.id <> _except)
     AND EXISTS (SELECT 1 FROM public.gl_accounts g WHERE g.id = public.posting_account_for(_tenant, 'PURCHASES', public.supplier_account_set(po.supplier_id)) AND g.code LIKE _code || '%')
$function$;

-- check_budget_on_po
CREATE OR REPLACE FUNCTION public.check_budget_on_po()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _mode text := (public.budget_setting(NEW.tenant_id)).control_mode; _a record; _acc uuid; _w text[] := '{}'; _over record; _amt numeric; _over_amt numeric;
BEGIN
  IF _mode = 'off' OR NEW.status NOT IN ('pending_approval', 'approved') OR NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  _acc := public.posting_account_for(NEW.tenant_id, 'PURCHASES', public.supplier_account_set(NEW.supplier_id));
  IF _acc IS NULL THEN RETURN NEW; END IF;
  FOR _a IN SELECT * FROM public.budget_availability(NEW.tenant_id, _acc, NEW.order_date, NEW.id, NULL, public.document_all_values('PO', NEW.id)) LOOP
    _amt := CASE WHEN _a.analytic_value_id IS NULL THEN NEW.total ELSE public.document_amount_in_scope('PO', NEW.id, _a.analytic_value_id) END;
    IF _amt > 0 AND _amt > _a.available THEN
      _w := array_append(_w, format('budget %s%s : commande %s pour %s disponibles', _a.budget_code, COALESCE(' / ' || _a.analytic_label, ''), _amt, _a.available));
      IF _over IS NULL THEN _over := _a; _over_amt := _amt; END IF;
    END IF;
  END LOOP;
  IF cardinality(_w) = 0 THEN NEW.budget_warning := NULL; RETURN NEW; END IF;
  IF _mode = 'warn' OR NEW.budget_override_reason IS NOT NULL THEN
    NEW.budget_warning := 'Dépassement du ' || array_to_string(_w, ' ; ');
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Budget dépassé (compte %, du % au %) : commande % pour % disponibles (budget %, pré-engagé %, engagé %, réalisé %)',
    _over.budget_code || COALESCE(' / ' || _over.analytic_label, ''), _over.period_from, _over.period_to, _over_amt, _over.available,
    _over.planned, _over.precommitted, _over.committed, _over.actual
    USING ERRCODE = 'QG024', HINT = 'Réduire la commande, réviser le budget, ou faire autoriser le dépassement (droit « Autoriser un dépassement de budget »).';
END $function$;

-- check_budget_on_ap_invoice
CREATE OR REPLACE FUNCTION public.check_budget_on_ap_invoice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _mode text := (public.budget_setting(NEW.tenant_id)).control_mode; _r record; _a record; _v uuid[]; _amt numeric;
  _purchases uuid := public.posting_account_for(NEW.tenant_id, 'PURCHASES', public.supplier_account_set(NEW.supplier_id));
  _lines boolean := EXISTS (SELECT 1 FROM public.ap_invoice_lines WHERE invoice_id = NEW.id);
BEGIN
  IF _mode = 'off' OR NEW.po_id IS NOT NULL OR NEW.approval_status <> 'submitted' OR OLD.approval_status = 'submitted' THEN RETURN NEW; END IF;
  _v := public.document_all_values('AP', NEW.id);
  FOR _r IN
    SELECT COALESCE(l.expense_account_id, _purchases) AS acc, sum(l.net_amount) AS amount
      FROM public.ap_invoice_lines l WHERE l.invoice_id = NEW.id GROUP BY 1
    UNION ALL
    SELECT _purchases, NEW.subtotal WHERE NOT _lines
  LOOP
    CONTINUE WHEN _r.acc IS NULL;
    FOR _a IN SELECT * FROM public.budget_availability(NEW.tenant_id, _r.acc, NEW.invoice_date, NULL, NULL, _v) LOOP
      IF _a.analytic_value_id IS NULL THEN _amt := _r.amount;
      ELSIF _lines THEN
        SELECT COALESCE(sum(l.net_amount), 0) INTO _amt FROM public.ap_invoice_lines l
         WHERE l.invoice_id = NEW.id AND COALESCE(l.expense_account_id, _purchases) = _r.acc
           AND public.line_effective_analytics('AP', l.id) && public.analytic_value_scope(_a.analytic_value_id);
      ELSE _amt := public.document_amount_in_scope('AP', NEW.id, _a.analytic_value_id);
      END IF;
      IF _amt > 0 AND _amt > _a.available AND _mode = 'block' THEN
        RAISE EXCEPTION 'Budget dépassé (compte %, du % au %) : facture % pour % disponibles', _a.budget_code || COALESCE(' / ' || _a.analytic_label, ''),
          _a.period_from, _a.period_to, _amt, _a.available
          USING ERRCODE = 'QG024', HINT = 'Réviser le budget ou rattacher la facture à une commande autorisée.';
      END IF;
    END LOOP;
  END LOOP;
  RETURN NEW;
END $function$;

-- replace_gl_account
CREATE OR REPLACE FUNCTION public.replace_gl_account(_account_id uuid, _new_code text, _new_name text, _new_type text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.require_chart_right();
  _old public.gl_accounts%ROWTYPE;
  _new uuid;
  _fw text := public.chart_framework(_tenant);
  _pattern text;
BEGIN
  SELECT * INTO _old FROM public.gl_accounts WHERE id = _account_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compte introuvable dans la société active' USING ERRCODE = 'QG019'; END IF;
  IF public.quality_rule_severity(_tenant, _fw, 'CODE_FORMAT') = 'error' THEN
    SELECT r.params ->> 'pattern' INTO _pattern FROM public.framework_quality_rules r WHERE r.framework_code = _fw AND r.rule_code = 'CODE_FORMAT';
  END IF;
  IF COALESCE(btrim(_new_code), '') = '' OR (_pattern IS NOT NULL AND _new_code !~ _pattern) THEN
    RAISE EXCEPTION 'Code du compte de remplacement invalide' USING ERRCODE = 'QG019';
  END IF;
  IF _new_code = _old.code THEN RAISE EXCEPTION 'Le compte de remplacement doit avoir un autre code' USING ERRCODE = 'QG019'; END IF;
  SELECT id INTO _new FROM public.gl_accounts WHERE tenant_id = _tenant AND code = _new_code;
  IF _new IS NULL THEN
    IF _new_type IS NULL OR _new_type NOT IN ('asset', 'liability', 'equity', 'revenue', 'expense') THEN
      RAISE EXCEPTION 'Type du compte de remplacement requis' USING ERRCODE = 'QG019';
    END IF;
    INSERT INTO public.gl_accounts (tenant_id, code, name, account_type)
    VALUES (_tenant, _new_code, COALESCE(NULLIF(btrim(_new_name), ''), _old.name), _new_type) RETURNING id INTO _new;
  ELSE
    UPDATE public.gl_accounts SET is_active = true WHERE id = _new AND NOT is_active;
  END IF;
  UPDATE public.tenant_posting_accounts SET gl_account_id = _new, updated_at = now(), updated_by = auth.uid()
   WHERE tenant_id = _tenant AND gl_account_id = _old.id;
  -- V105 : les jeux de comptes suivent le compte remplacé.
  UPDATE public.posting_account_set_lines SET gl_account_id = _new, updated_at = now(), updated_by = auth.uid()
   WHERE tenant_id = _tenant AND gl_account_id = _old.id;
  UPDATE public.gl_accounts SET replaced_by = _new, is_active = false WHERE id = _old.id;
  RETURN _new;
END $function$;

-- apply_chart_migration
CREATE OR REPLACE FUNCTION public.apply_chart_migration(_migration uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _mig public.chart_migrations%ROWTYPE;
  _m public.chart_mappings%ROWTYPE;
  _p record; _entry uuid; _created int := 0; _replaced int := 0; _roles int := 0; _lines int := 0; _n int;
  _main uuid; _fw text;
BEGIN
  SELECT * INTO _mig FROM public.chart_migrations WHERE id = _migration AND tenant_id = public.get_user_tenant_id(auth.uid()) FOR UPDATE;
  IF _mig.id IS NULL THEN RAISE EXCEPTION 'Migration introuvable' USING ERRCODE = 'QG022'; END IF;
  _m := public.chart_migration_mapping(_mig.mapping_id);
  IF _mig.status <> 'simulated' THEN RAISE EXCEPTION 'Seule une simulation en cours s''applique (état : %)', _mig.status USING ERRCODE = 'QG022'; END IF;
  IF (public.chart_import_setting(_mig.tenant_id)).migration_second_person AND _mig.simulated_by = auth.uid() THEN
    RAISE EXCEPTION 'Séparation des tâches : la migration est appliquée par une autre personne que celle qui l''a simulée' USING ERRCODE = 'QG022';
  END IF;
  IF _mig.blocking > 0 THEN RAISE EXCEPTION 'Simulation avec % anomalie(s) bloquante(s) : corriger puis simuler à nouveau', _mig.blocking USING ERRCODE = 'QG022'; END IF;
  IF public.chart_migration_plan_json(_mig.mapping_id, _mig.migration_date) IS DISTINCT FROM _mig.plan THEN
    RAISE EXCEPTION 'Le plan ou les soldes ont changé depuis la simulation : simuler à nouveau' USING ERRCODE = 'QG022';
  END IF;
  PERFORM public.assert_fiscal_period_open(_mig.tenant_id, _mig.migration_date, 'GL');

  -- Comptes cibles.
  FOR _p IN SELECT DISTINCT target_code, target_name, target_type, source_code FROM public.chart_migration_plan(_mig.mapping_id, _mig.migration_date)
             WHERE action = 'create' LOOP
    IF NOT EXISTS (SELECT 1 FROM public.gl_accounts WHERE tenant_id = _mig.tenant_id AND code = _p.target_code) THEN
      INSERT INTO public.gl_accounts (tenant_id, code, name, account_type)
      VALUES (_mig.tenant_id, _p.target_code, _p.target_name,
              COALESCE(_p.target_type, (SELECT g.account_type FROM public.gl_accounts g WHERE g.tenant_id = _mig.tenant_id AND g.code = _p.source_code)));
      _created := _created + 1;
    END IF;
  END LOOP;
  UPDATE public.gl_accounts t SET is_active = true
   WHERE t.tenant_id = _mig.tenant_id AND NOT t.is_active AND t.replaced_by IS NULL
     AND t.code IN (SELECT p.target_code FROM public.chart_migration_plan(_mig.mapping_id, _mig.migration_date) p WHERE p.action = 'reuse');

  -- Écriture OD de reclassement (une seule, datée).
  IF EXISTS (SELECT 1 FROM public.chart_migration_plan(_mig.mapping_id, _mig.migration_date) WHERE action <> 'same' AND moved <> 0) THEN
    INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
    VALUES (_mig.tenant_id, 'JE-MIG-' || to_char(now(), 'YYYYMMDD') || '-' || substr(gen_random_uuid()::text, 1, 6), _mig.migration_date,
            'Migration du plan comptable — ' || _mig.reason, 'reclassification', 'draft', auth.uid())
    RETURNING id INTO _entry;
    FOR _p IN SELECT p.*, t.id AS tid FROM public.chart_migration_plan(_mig.mapping_id, _mig.migration_date) p
               JOIN public.gl_accounts t ON t.tenant_id = _mig.tenant_id AND t.code = p.target_code
              WHERE p.action <> 'same' AND p.moved <> 0 LOOP
      INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
      VALUES (_entry, _p.tid, GREATEST(_p.moved, 0), GREATEST(-_p.moved, 0), 'Migration depuis ' || _p.source_code),
             (_entry, _p.source_account_id, GREATEST(-_p.moved, 0), GREATEST(_p.moved, 0), 'Migration vers ' || _p.target_code);
      _lines := _lines + 2;
    END LOOP;
    UPDATE public.journal_entries SET status = 'posted', posted_by = auth.uid(), posted_at = now() WHERE id = _entry;
  END IF;

  -- Rôles redirigés, anciens comptes conservés, désactivés, reliés à la cible principale (clé la plus forte).
  FOR _p IN SELECT DISTINCT p.source_account_id FROM public.chart_migration_plan(_mig.mapping_id, _mig.migration_date) p WHERE p.action <> 'same' LOOP
    SELECT t.id INTO _main FROM public.chart_migration_plan(_mig.mapping_id, _mig.migration_date) p
      JOIN public.gl_accounts t ON t.tenant_id = _mig.tenant_id AND t.code = p.target_code
     WHERE p.source_account_id = _p.source_account_id ORDER BY p.ratio DESC, p.target_code LIMIT 1;
    UPDATE public.tenant_posting_accounts SET gl_account_id = _main, updated_at = now(), updated_by = auth.uid()
     WHERE tenant_id = _mig.tenant_id AND gl_account_id = _p.source_account_id;
    GET DIAGNOSTICS _n = ROW_COUNT; _roles := _roles + _n;
    -- V105 : les jeux de comptes suivent la migration du plan.
    UPDATE public.posting_account_set_lines SET gl_account_id = _main, updated_at = now(), updated_by = auth.uid()
     WHERE tenant_id = _mig.tenant_id AND gl_account_id = _p.source_account_id;
    GET DIAGNOSTICS _n = ROW_COUNT; _roles := _roles + _n;
    UPDATE public.gl_accounts SET replaced_by = _main, is_active = false WHERE id = _p.source_account_id;
    _replaced := _replaced + 1;
  END LOOP;

  -- Référentiel du plan opérationnel et de la société.
  _fw := COALESCE(_m.target_framework, (SELECT c.framework_code FROM public.charts c WHERE c.id = _m.target_chart_id));
  IF _fw IS NOT NULL THEN
    UPDATE public.charts SET framework_code = _fw, updated_at = now(),
           framework_version = (SELECT v.version FROM public.framework_versions v WHERE v.framework_code = _fw AND v.status = 'published' ORDER BY v.effective_from DESC LIMIT 1)
     WHERE id = public.operational_chart_id(_mig.tenant_id);
    INSERT INTO public.tenant_accounting_settings (tenant_id, framework_code, applied_by) VALUES (_mig.tenant_id, _fw, auth.uid())
    ON CONFLICT (tenant_id) DO UPDATE SET framework_code = EXCLUDED.framework_code, applied_at = now(), applied_by = EXCLUDED.applied_by;
  END IF;

  UPDATE public.chart_migrations SET status = 'applied', applied_by = auth.uid(), applied_at = now(), entry_id = _entry WHERE id = _migration;
  RETURN jsonb_build_object('comptes_crees', _created, 'comptes_remplaces', _replaced, 'roles_rediriges', _roles,
                            'lignes_reclassement', _lines, 'ecriture', _entry, 'referentiel', _fw);
END $function$;

-- Isolation : les nouvelles clés étrangères entre tables de société sont couvertes.
SELECT public.install_tenant_isolation_triggers();
