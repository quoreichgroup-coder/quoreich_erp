-- V137 — Retenues à la source paramétrables (règle du propriétaire : aucune règle codée en dur).
--   ap_withholding_settings        par société : retenues actives ou non (enabled), pas d'arrondi (1 XOF par défaut) ;
--                                  écriture avec le droit ap.settings ;
--   ap_withholding_rates           min_base : base en dessous de laquelle la facture ne subit pas de retenue (NULL = aucun
--                                  seuil) ; valid_from / valid_to : période de validité du taux (un changement de loi = un
--                                  nouveau taux daté) — une facture soumise hors validité est refusée (QG034) ;
--   suppliers                      withholding_exempt_until / withholding_exempt_ref : attestation d'exonération ; aucune
--                                  retenue sur les factures datées jusqu'à cette date ; changement tracé dans
--                                  supplier_change_log.
-- Les retenues déjà figées sur des factures approuvées ne changent pas (obligation née à l'approbation).

CREATE TABLE public.ap_withholding_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants (id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  rounding_step numeric(10, 2) NOT NULL DEFAULT 1 CHECK (rounding_step > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT auth.uid()
);
ALTER TABLE public.ap_withholding_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture société" ON public.ap_withholding_settings FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Paramétrage habilité" ON public.ap_withholding_settings FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'ap.settings'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'ap.settings'));

CREATE FUNCTION public.withholding_setting(_tenant uuid)
RETURNS public.ap_withholding_settings LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT s FROM public.ap_withholding_settings s WHERE s.tenant_id = _tenant),
                  ROW(_tenant, true, 1, now(), NULL)::public.ap_withholding_settings)
$$;
REVOKE EXECUTE ON FUNCTION public.withholding_setting(uuid) FROM PUBLIC, anon, authenticated;

ALTER TABLE public.ap_withholding_rates
  ADD COLUMN min_base numeric(18, 2) CHECK (min_base IS NULL OR min_base >= 0),
  ADD COLUMN valid_from date,
  ADD COLUMN valid_to date,
  ADD CONSTRAINT ap_withholding_rates_validity CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_to >= valid_from);
-- Un taux daté remplace l'ancien sous le même libellé : l'unicité porte sur la catégorie et le début de validité.
DROP INDEX public.ap_withholding_rates_category_key;
CREATE UNIQUE INDEX ap_withholding_rates_category_key ON public.ap_withholding_rates
  (tenant_id, lower(btrim(category)), COALESCE(valid_from, DATE '0001-01-01'));

ALTER TABLE public.suppliers
  ADD COLUMN withholding_exempt_until date,
  ADD COLUMN withholding_exempt_ref text;

CREATE OR REPLACE FUNCTION public.ap_invoice_withholding()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _r public.ap_withholding_rates%ROWTYPE;
  _s public.ap_withholding_settings;
  _exempt date;
  _base numeric;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.withholding_rate_id IS NULL THEN
    SELECT s.withholding_rate_id INTO NEW.withholding_rate_id FROM public.suppliers s WHERE s.id = NEW.supplier_id;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.approval_status = 'approved' THEN
    NEW.withholding_rate_id := OLD.withholding_rate_id; NEW.withholding_rate_pct := OLD.withholding_rate_pct; NEW.withholding_amount := OLD.withholding_amount;
    RETURN NEW;
  END IF;
  NEW.withholding_rate_pct := NULL; NEW.withholding_amount := 0;
  IF NEW.withholding_rate_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO _r FROM public.ap_withholding_rates WHERE id = NEW.withholding_rate_id AND tenant_id = NEW.tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Catégorie de retenue inconnue dans la société' USING ERRCODE = 'QG034'; END IF;
  _s := public.withholding_setting(NEW.tenant_id);
  IF NOT _s.enabled OR NOT _r.is_active OR COALESCE(_r.rate_pct, 0) <= 0 THEN RETURN NEW; END IF;
  SELECT s.withholding_exempt_until INTO _exempt FROM public.suppliers s WHERE s.id = NEW.supplier_id;
  IF _exempt IS NOT NULL AND NEW.invoice_date <= _exempt THEN RETURN NEW; END IF;
  IF (_r.valid_from IS NOT NULL AND NEW.invoice_date < _r.valid_from) OR (_r.valid_to IS NOT NULL AND NEW.invoice_date > _r.valid_to) THEN
    -- Hors validité : la facture reste modifiable en brouillon, mais ne se soumet pas avec un taux périmé.
    IF NEW.approval_status NOT IN ('draft', 'rejected') THEN
      RAISE EXCEPTION 'Retenue « % » : taux non valable au % (validité % → %) ; choisissez la catégorie en vigueur',
        _r.category, NEW.invoice_date, COALESCE(_r.valid_from::text, '…'), COALESCE(_r.valid_to::text, '…') USING ERRCODE = 'QG034';
    END IF;
    RETURN NEW;
  END IF;
  _base := CASE _r.base WHEN 'gross' THEN COALESCE(NEW.subtotal, 0) + COALESCE(NEW.tax_amount, 0) ELSE COALESCE(NEW.subtotal, 0) END;
  IF _r.min_base IS NOT NULL AND _base < _r.min_base THEN RETURN NEW; END IF;
  NEW.withholding_rate_pct := _r.rate_pct;
  NEW.withholding_amount := round(_base * _r.rate_pct / 100 / _s.rounding_step) * _s.rounding_step;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.payment_withholding()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _inv public.ap_invoices%ROWTYPE; _taken numeric; _rest numeric; _out numeric; _step numeric;
BEGIN
  IF NEW.reversal_of IS NOT NULL THEN RETURN NEW; END IF;
  NEW.withholding_amount := 0;
  IF NEW.payment_type <> 'ap_payment' OR NEW.ap_invoice_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO _inv FROM public.ap_invoices WHERE id = NEW.ap_invoice_id;
  IF COALESCE(_inv.withholding_amount, 0) <= 0 THEN RETURN NEW; END IF;
  _step := (public.withholding_setting(_inv.tenant_id)).rounding_step;
  SELECT COALESCE(sum(p.withholding_amount), 0) INTO _taken FROM public.payments p WHERE p.ap_invoice_id = _inv.id AND p.payment_type = 'ap_payment';
  _rest := _inv.withholding_amount - _taken;
  _out := _inv.total - _inv.amount_paid;
  NEW.withholding_amount := least(greatest(CASE WHEN NEW.amount >= _out THEN _rest
                                                ELSE round(_inv.withholding_amount * NEW.amount / NULLIF(_inv.total, 0) / _step) * _step END, 0),
                                  _rest, NEW.amount);
  NEW.cash_amount := COALESCE(NEW.cash_amount, NEW.amount) - NEW.withholding_amount;
  RETURN NEW;
END $$;

-- Exonérations et catégorie de retenue tracées comme les autres champs sensibles.
CREATE OR REPLACE FUNCTION public.log_supplier_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _f text;
  _old jsonb := to_jsonb(OLD);
  _new jsonb := to_jsonb(NEW);
BEGIN
  FOREACH _f IN ARRAY ARRAY['name', 'legal_name', 'tax_id', 'rccm', 'bank_name', 'bank_account', 'bank_swift', 'bank_verified',
                         'withholding_rate_id', 'withholding_exempt_until', 'withholding_exempt_ref'] LOOP
    IF _old->>_f IS DISTINCT FROM _new->>_f THEN
      INSERT INTO public.supplier_change_log (tenant_id, supplier_id, field, old_value, new_value, changed_by)
      VALUES (NEW.tenant_id, NEW.id, _f, _old->>_f, _new->>_f, auth.uid());
    END IF;
  END LOOP;
  RETURN NEW;
END $function$;

SELECT public.install_tenant_isolation_triggers();
