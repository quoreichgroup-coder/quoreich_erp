-- V21 — Lignes de facture client et codes TVA. Écrit à la main.
--
-- POURQUOI
-- Une facture ne portait qu'un montant HT et un montant de TVA saisis à la main :
-- ni lignes, ni quantité, ni prix, ni taux. Le cahier des charges demande de
-- « créer et contrôler une facture et ses lignes ; totaux cohérents » (AR-02), et
-- l'imputation des produits (compte de vente, analytique) se fait à la ligne.
--
-- MODÈLE (codes TVA de SAP, classes de taxe Sage 300, codes taxe Sage X3)
--   tax_codes          codes TVA de la société : taux, compte de TVA facultatif
--                      (sinon le rôle VAT_OUTPUT). Le taux d'un code est FIGÉ à la
--                      création : un changement de taux légal se traite par un
--                      nouveau code, pour que les factures passées gardent le leur.
--                      Aucun code n'est créé d'office : un taux légal dépend du pays
--                      et se valide localement (§138).
--   ar_invoice_lines   quantité, prix unitaire, remise, code TVA, compte de vente
--                      facultatif (sinon le rôle SALES_REVENUE). Montants HT et TVA
--                      CALCULÉS par la base, arrondis à la ligne ; l'en-tête de la
--                      facture devient la somme de ses lignes.
--
-- COMPTABILISATION (remplace on_ar_invoice_posted de V19)
--   Facture avec lignes : DR clients du TTC ; CR un compte de vente par compte
--   (lignes regroupées), chacune portant l'analytique de la facture ou du client ;
--   CR la TVA par compte de TVA. Facture sans ligne : comportement inchangé
--   (montants d'en-tête), pour les factures existantes et le chemin historique.
--
-- Les lignes ne se modifient que tant que la facture est en brouillon.
--
-- Jumelle : supabase/migrations/20261113090000_4b8e2d6f-1c3a-4e7b-9f5d-8a2c6e1b3d70.sql

CREATE TABLE public.tax_codes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    code text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]*$'),
    name text NOT NULL CHECK (length(btrim(name)) > 0),
    rate numeric(5,2) NOT NULL CHECK (rate >= 0 AND rate <= 100),
    gl_account_id uuid,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, code),
    UNIQUE (id, tenant_id),
    FOREIGN KEY (gl_account_id, tenant_id) REFERENCES public.gl_accounts(id, tenant_id)
);
CREATE INDEX tax_codes_gl_account_idx ON public.tax_codes (gl_account_id, tenant_id);

CREATE TABLE public.ar_invoice_lines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    invoice_id uuid NOT NULL,
    line_no integer NOT NULL CHECK (line_no > 0),
    description text NOT NULL CHECK (length(btrim(description)) > 0),
    quantity numeric(18,4) NOT NULL CHECK (quantity > 0),
    unit_price numeric(18,2) NOT NULL CHECK (unit_price >= 0),
    discount_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct >= 0 AND discount_pct <= 100),
    tax_code_id uuid,
    revenue_account_id uuid,
    net_amount numeric(18,2) NOT NULL DEFAULT 0,
    tax_amount numeric(18,2) NOT NULL DEFAULT 0,
    UNIQUE (invoice_id, line_no),
    FOREIGN KEY (invoice_id, tenant_id) REFERENCES public.ar_invoices(id, tenant_id) ON DELETE CASCADE,
    FOREIGN KEY (tax_code_id, tenant_id) REFERENCES public.tax_codes(id, tenant_id),
    FOREIGN KEY (revenue_account_id, tenant_id) REFERENCES public.gl_accounts(id, tenant_id)
);
CREATE INDEX ar_invoice_lines_tax_code_idx ON public.ar_invoice_lines (tax_code_id, tenant_id);
CREATE INDEX ar_invoice_lines_revenue_account_idx ON public.ar_invoice_lines (revenue_account_id, tenant_id);

-- ─── Fonctions ───

-- Le taux d'un code TVA ne change pas après création (voir en-tête).
CREATE FUNCTION public.guard_tax_code() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.rate IS DISTINCT FROM OLD.rate OR NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'Le code et le taux d''un code TVA sont figés : créer un nouveau code pour un nouveau taux'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;

-- Montants de ligne calculés, facture en brouillon seulement.
CREATE FUNCTION public.compute_ar_invoice_line() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _status text;
  _rate numeric;
  _active boolean;
BEGIN
  SELECT status INTO _status FROM public.ar_invoices
   WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  -- Suppression en cascade de la facture elle-même : elle n'est déjà plus visible.
  IF TG_OP = 'DELETE' AND NOT FOUND THEN RETURN OLD; END IF;
  IF _status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Les lignes d''une facture émise sont figées (créer un avoir pour corriger)'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  IF NEW.tax_code_id IS NOT NULL THEN
    SELECT rate, is_active INTO _rate, _active FROM public.tax_codes WHERE id = NEW.tax_code_id;
    IF NOT _active THEN
      RAISE EXCEPTION 'Code TVA inactif : il ne peut plus être utilisé sur une facture' USING ERRCODE = '23514';
    END IF;
  END IF;
  NEW.net_amount := ROUND(NEW.quantity * NEW.unit_price * (1 - NEW.discount_pct / 100), 2);
  NEW.tax_amount := ROUND(NEW.net_amount * COALESCE(_rate, 0) / 100, 2);
  RETURN NEW;
END; $$;

-- L'en-tête d'une facture à lignes est la somme de ses lignes.
CREATE FUNCTION public.sum_ar_invoice_lines() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _invoice uuid := COALESCE(NEW.invoice_id, OLD.invoice_id);
BEGIN
  UPDATE public.ar_invoices i
     SET subtotal = s.net, tax_amount = s.tax
    FROM (SELECT COALESCE(SUM(net_amount), 0) AS net, COALESCE(SUM(tax_amount), 0) AS tax
            FROM public.ar_invoice_lines WHERE invoice_id = _invoice) s
   WHERE i.id = _invoice;
  RETURN NULL;
END; $$;

CREATE OR REPLACE FUNCTION public.on_ar_invoice_posted() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
  _ar  := public.posting_account(NEW.tenant_id, 'AR_RECEIVABLE');
  _rev := public.posting_account(NEW.tenant_id, 'SALES_REVENUE');
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
END; $$;

-- Analytique d'une ligne de produit : section de la facture, sinon défaut du client (V19).
CREATE FUNCTION public.impute_ar_revenue_line(_line uuid, _invoice public.ar_invoices) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  INSERT INTO public.journal_line_analytics (line_id, axis_id, value_id)
  SELECT _line, a.id, COALESCE(ia.value_id, d.value_id)
  FROM public.analytic_axes a
  LEFT JOIN public.ar_invoice_analytics ia ON ia.invoice_id = _invoice.id AND ia.axis_id = a.id
  LEFT JOIN public.analytic_defaults d ON d.customer_id = _invoice.customer_id AND d.axis_id = a.id
  WHERE a.tenant_id = _invoice.tenant_id AND a.is_active
    AND COALESCE(ia.value_id, d.value_id) IS NOT NULL
$$;

-- ─── Déclencheurs ───

CREATE TRIGGER trg_guard_tax_code BEFORE UPDATE ON public.tax_codes
  FOR EACH ROW EXECUTE FUNCTION public.guard_tax_code();
CREATE TRIGGER trg_compute_ar_invoice_line BEFORE INSERT OR UPDATE OR DELETE ON public.ar_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION public.compute_ar_invoice_line();
CREATE TRIGGER trg_sum_ar_invoice_lines AFTER INSERT OR UPDATE OR DELETE ON public.ar_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION public.sum_ar_invoice_lines();

-- ─── Sécurité ───

ALTER TABLE public.tax_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ar_invoice_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation" ON public.tax_codes FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Administrateur de la société" ON public.tax_codes FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.is_tenant_admin())
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.is_tenant_admin());

CREATE POLICY "Tenant isolation" ON public.ar_invoice_lines FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Gestion comptable" ON public.ar_invoice_lines FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.tenant_has_any_role(ARRAY['admin', 'accountant']))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.tenant_has_any_role(ARRAY['admin', 'accountant']));

REVOKE ALL ON FUNCTION public.guard_tax_code(), public.compute_ar_invoice_line(),
  public.sum_ar_invoice_lines(), public.impute_ar_revenue_line(uuid, public.ar_invoices) FROM PUBLIC;
REVOKE ALL ON public.tax_codes, public.ar_invoice_lines FROM anon;
REVOKE ALL ON FUNCTION public.guard_tax_code(), public.compute_ar_invoice_line(),
  public.sum_ar_invoice_lines(), public.impute_ar_revenue_line(uuid, public.ar_invoices) FROM anon;
