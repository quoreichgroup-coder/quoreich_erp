-- V124 — Devises sur les achats : cours datés, factures fournisseurs et paiements en devise, écart de change réalisé
-- (écart G-25 / lot I1, première tranche ; décisions D-I1 de docs/audit-erp/11 §7).
--
-- Principe : tous les montants existants restent dans la devise de la société (XOF) — encours, échéancier, budgets,
-- cockpit, états continuent de s'additionner sans conversion. La devise s'ajoute par-dessus :
--   exchange_rates       cours datés (unités de devise de la société pour 1 unité de devise) ; lignes de référence
--                        sans société (BCEAO : EUR à parité fixe 655,957 XOF, idem XAF / BEAC), lignes propres à la
--                        société (cours BCEAO du jour, cours de la banque) qui priment ; droit currency.rates ;
--   exchange_rate_at     dernier cours connu à une date (société d'abord, puis référence) ; NULL si aucun ;
--   ap_invoices          currency (NULL = devise de la société), exchange_rate (cours de la facture, figé à
--                        l'approbation ; vide = cours du jour de la facture), fx_subtotal / fx_tax_amount / fx_total ;
--                        les lignes se saisissent en devise (fx_unit_price) et chaque ligne est convertie à ce cours ;
--   payments             currency, fx_amount (montant réglé en devise), exchange_rate (cours du paiement ; vide = cours
--                        du jour), cash_amount (contre-valeur décaissée) ; amount reste la part de facture soldée, au
--                        cours de la facture : la dette 401 est soldée à sa valeur d'origine, la trésorerie au cours du
--                        jour, la différence en perte (676, rôle FX_LOSS) ou gain de change (776, rôle FX_GAIN).
-- Hors de cette tranche : clients en devise, avance fournisseur, réévaluation de clôture (478 / 479).

-- ─── Rôles de comptabilisation : pertes et gains de change ───
INSERT INTO public.posting_roles (code, label, module, description, expected_prefixes) VALUES
  ('FX_LOSS', 'Pertes de change', 'TRE', 'Débité de l''écart défavorable entre le cours de la facture et celui du règlement', ARRAY['676', '666']),
  ('FX_GAIN', 'Gains de change', 'TRE', 'Crédité de l''écart favorable entre le cours de la facture et celui du règlement', ARRAY['776', '766'])
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.framework_role_expectations (framework_code, role_code, prefixes)
SELECT v.f, v.r, v.p FROM (VALUES
  ('SYSCOHADA_REVISE', 'FX_LOSS', ARRAY['676']), ('SYSCOHADA_REVISE', 'FX_GAIN', ARRAY['776']),
  ('PCG_FR', 'FX_LOSS', ARRAY['666']), ('PCG_FR', 'FX_GAIN', ARRAY['766'])) AS v(f, r, p)
 WHERE EXISTS (SELECT 1 FROM public.accounting_frameworks WHERE code = v.f)
ON CONFLICT (framework_code, role_code) DO NOTHING;
INSERT INTO public.framework_reference_accounts (framework_code, code, name, account_type)
SELECT v.f, v.c, v.n, v.t FROM (VALUES
  ('SYSCOHADA_REVISE', '676', 'Pertes de change financières', 'expense'), ('SYSCOHADA_REVISE', '776', 'Gains de change financiers', 'revenue'),
  ('PCG_FR', '666', 'Pertes de change financières', 'expense'), ('PCG_FR', '766', 'Gains de change financiers', 'revenue')) AS v(f, c, n, t)
 WHERE EXISTS (SELECT 1 FROM public.accounting_frameworks WHERE code = v.f)
ON CONFLICT (framework_code, code) DO NOTHING;
INSERT INTO public.accounting_framework_accounts (framework_code, code, name, account_type)
SELECT v.f, v.c, v.n, v.t FROM (VALUES
  ('SYSCOHADA_REVISE', '676', 'Pertes de change financières', 'expense'), ('SYSCOHADA_REVISE', '776', 'Gains de change financiers', 'revenue'),
  ('PCG_FR', '666', 'Pertes de change financières', 'expense'), ('PCG_FR', '766', 'Gains de change financiers', 'revenue')) AS v(f, c, n, t)
 WHERE EXISTS (SELECT 1 FROM public.accounting_frameworks WHERE code = v.f)
   AND NOT EXISTS (SELECT 1 FROM public.accounting_framework_accounts a WHERE a.framework_code = v.f AND a.code = v.c);
INSERT INTO public.accounting_framework_role_defaults (framework_code, role_code, account_code)
SELECT v.f, v.r, v.c FROM (VALUES
  ('SYSCOHADA_REVISE', 'FX_LOSS', '676'), ('SYSCOHADA_REVISE', 'FX_GAIN', '776'),
  ('PCG_FR', 'FX_LOSS', '666'), ('PCG_FR', 'FX_GAIN', '766')) AS v(f, r, c)
 WHERE EXISTS (SELECT 1 FROM public.accounting_frameworks WHERE code = v.f)
   AND NOT EXISTS (SELECT 1 FROM public.accounting_framework_role_defaults d WHERE d.framework_code = v.f AND d.role_code = v.r);
INSERT INTO public.gl_accounts (tenant_id, code, name, account_type)
SELECT s.tenant_id, a.code, a.name, a.account_type
  FROM public.tenant_accounting_settings s
  JOIN public.accounting_framework_role_defaults d ON d.framework_code = s.framework_code AND d.role_code IN ('FX_LOSS', 'FX_GAIN')
  JOIN public.accounting_framework_accounts a ON a.framework_code = d.framework_code AND a.code = d.account_code
ON CONFLICT (tenant_id, code) DO NOTHING;
INSERT INTO public.tenant_posting_accounts (tenant_id, role_code, gl_account_id)
SELECT s.tenant_id, d.role_code, g.id
  FROM public.tenant_accounting_settings s
  JOIN public.accounting_framework_role_defaults d ON d.framework_code = s.framework_code AND d.role_code IN ('FX_LOSS', 'FX_GAIN')
  JOIN public.gl_accounts g ON g.tenant_id = s.tenant_id AND g.code = d.account_code AND g.is_active
ON CONFLICT (tenant_id, role_code) DO NOTHING;

-- ─── Cours datés ───
CREATE TABLE public.exchange_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants (id) ON DELETE CASCADE,
  base_currency text NOT NULL CHECK (base_currency ~ '^[A-Z]{3}$'),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  rate_date date NOT NULL,
  rate numeric(20, 8) NOT NULL CHECK (rate > 0),
  source text NOT NULL DEFAULT 'Saisie' CHECK (length(source) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid(),
  CHECK (currency <> base_currency)
);
CREATE UNIQUE INDEX exchange_rates_unique ON public.exchange_rates
  (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), base_currency, currency, rate_date);
CREATE INDEX exchange_rates_lookup ON public.exchange_rates (currency, rate_date DESC);
ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture société et référence" ON public.exchange_rates FOR SELECT TO authenticated
  USING (tenant_id IS NULL OR tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Saisie des cours habilitée" ON public.exchange_rates FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'currency.rates'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'currency.rates')
              AND base_currency = (SELECT t.currency FROM public.tenants t WHERE t.id = tenant_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exchange_rates TO authenticated;

INSERT INTO public.exchange_rates (tenant_id, base_currency, currency, rate_date, rate, source, created_by) VALUES
  (NULL, 'XOF', 'EUR', '1999-01-01', 655.957, 'BCEAO — parité fixe', NULL),
  (NULL, 'XAF', 'EUR', '1999-01-01', 655.957, 'BEAC — parité fixe', NULL);

-- Dernier cours connu à une date : cours de la société, sinon cours de référence de sa devise ; 1 pour sa propre devise.
CREATE FUNCTION public.exchange_rate_at(_tenant uuid, _currency text, _date date)
RETURNS numeric LANGUAGE sql STABLE SET search_path = public AS $$
  WITH base AS (SELECT t.currency AS c FROM public.tenants t WHERE t.id = _tenant)
  SELECT CASE WHEN upper(_currency) = (SELECT c FROM base) THEN 1::numeric ELSE (
    SELECT r.rate FROM public.exchange_rates r
     WHERE r.currency = upper(_currency) AND r.base_currency = (SELECT c FROM base) AND r.rate_date <= _date
       AND (r.tenant_id = _tenant OR r.tenant_id IS NULL)
     ORDER BY r.rate_date DESC, (r.tenant_id IS NULL) ASC LIMIT 1) END
$$;
REVOKE EXECUTE ON FUNCTION public.exchange_rate_at(uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exchange_rate_at(uuid, text, date) TO authenticated;

-- ─── Factures fournisseurs en devise ───
ALTER TABLE public.ap_invoices
  ADD COLUMN currency text CHECK (currency ~ '^[A-Z]{3}$'),
  ADD COLUMN exchange_rate numeric(20, 8) CHECK (exchange_rate > 0),
  ADD COLUMN fx_subtotal numeric(18, 2),
  ADD COLUMN fx_tax_amount numeric(18, 2),
  ADD COLUMN fx_total numeric(18, 2);
ALTER TABLE public.ap_invoice_lines
  ADD COLUMN fx_unit_price numeric(18, 4),
  ADD COLUMN fx_net_amount numeric(18, 2),
  ADD COLUMN fx_tax_amount numeric(18, 2);

-- Devise et cours de la facture : vide ou devise de la société = pas de devise ; cours du jour de la facture si
-- aucun n'est saisi ; figés hors brouillon / rejet. Facture sans lignes : montants saisis en devise, convertis.
CREATE FUNCTION public.ap_invoice_currency()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _base text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.approval_status NOT IN ('draft', 'rejected') THEN
    NEW.currency := OLD.currency; NEW.exchange_rate := OLD.exchange_rate;
    NEW.fx_subtotal := OLD.fx_subtotal; NEW.fx_tax_amount := OLD.fx_tax_amount; NEW.fx_total := OLD.fx_total;
    RETURN NEW;
  END IF;
  SELECT t.currency INTO _base FROM public.tenants t WHERE t.id = NEW.tenant_id;
  NEW.currency := NULLIF(upper(btrim(NEW.currency)), '');
  IF NEW.currency IS NULL OR NEW.currency = _base THEN
    NEW.currency := NULL; NEW.exchange_rate := NULL; NEW.fx_subtotal := NULL; NEW.fx_tax_amount := NULL; NEW.fx_total := NULL;
    RETURN NEW;
  END IF;
  IF NEW.exchange_rate IS NULL
     OR (TG_OP = 'UPDATE' AND (NEW.currency IS DISTINCT FROM OLD.currency OR NEW.invoice_date IS DISTINCT FROM OLD.invoice_date)
         AND NEW.exchange_rate IS NOT DISTINCT FROM OLD.exchange_rate) THEN
    NEW.exchange_rate := public.exchange_rate_at(NEW.tenant_id, NEW.currency, NEW.invoice_date);
    IF NEW.exchange_rate IS NULL THEN
      RAISE EXCEPTION 'Aucun cours % / % au % : saisissez le cours de la facture ou enregistrez-le dans Paramètres → Devises et cours',
        NEW.currency, _base, to_char(NEW.invoice_date, 'DD/MM/YYYY') USING ERRCODE = 'QG030';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.ap_invoice_lines l WHERE l.invoice_id = NEW.id) THEN
    NEW.fx_total := COALESCE(NEW.fx_subtotal, 0) + COALESCE(NEW.fx_tax_amount, 0);
  ELSE
    NEW.fx_subtotal := round(COALESCE(NEW.fx_subtotal, 0), 2);
    NEW.fx_tax_amount := round(COALESCE(NEW.fx_tax_amount, 0), 2);
    NEW.fx_total := NEW.fx_subtotal + NEW.fx_tax_amount;
    NEW.subtotal := round(NEW.fx_subtotal * NEW.exchange_rate, 2);
    NEW.tax_amount := round(NEW.fx_tax_amount * NEW.exchange_rate, 2);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_ap_invoice_currency BEFORE INSERT OR UPDATE ON public.ap_invoices
  FOR EACH ROW EXECUTE FUNCTION public.ap_invoice_currency();

-- Changement de devise ou de cours d'un brouillon : les lignes sont reconverties.
CREATE FUNCTION public.ap_invoice_currency_lines()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.currency IS DISTINCT FROM OLD.currency OR NEW.exchange_rate IS DISTINCT FROM OLD.exchange_rate THEN
    UPDATE public.ap_invoice_lines SET fx_unit_price = fx_unit_price WHERE invoice_id = NEW.id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_ap_invoice_currency_lines AFTER UPDATE OF currency, exchange_rate ON public.ap_invoices
  FOR EACH ROW EXECUTE FUNCTION public.ap_invoice_currency_lines();

-- Encours d'une facture en devise (NULL pour une facture dans la devise de la société).
CREATE FUNCTION public.ap_invoice_fx_outstanding(_invoice uuid)
RETURNS numeric LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE WHEN i.currency IS NULL THEN NULL ELSE round((i.total - i.amount_paid) / i.exchange_rate, 2) END
    FROM public.ap_invoices i WHERE i.id = _invoice
$$;
REVOKE EXECUTE ON FUNCTION public.ap_invoice_fx_outstanding(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ap_invoice_fx_outstanding(uuid) TO authenticated;

-- ─── Paiements en devise ───
ALTER TABLE public.payments
  ADD COLUMN currency text CHECK (currency ~ '^[A-Z]{3}$'),
  ADD COLUMN fx_amount numeric(18, 2),
  ADD COLUMN exchange_rate numeric(20, 8) CHECK (exchange_rate > 0),
  ADD COLUMN cash_amount numeric(18, 2);

-- Avant tout autre contrôle : paiement d'une facture en devise = montant en devise obligatoire, cours du jour du
-- paiement par défaut, part de facture soldée au cours de la facture (le solde exact quand tout est réglé),
-- contre-valeur décaissée au cours du paiement. Pour toute autre pièce, les champs de devise sont vidés.
CREATE FUNCTION public.payment_currency()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _inv public.ap_invoices%ROWTYPE; _out numeric; _fx_out numeric;
BEGIN
  IF NEW.reversal_of IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.payment_type = 'ap_payment' AND NEW.ap_invoice_id IS NOT NULL THEN
    SELECT * INTO _inv FROM public.ap_invoices WHERE id = NEW.ap_invoice_id;
  END IF;
  IF _inv.id IS NULL OR _inv.currency IS NULL THEN
    NEW.currency := NULL; NEW.fx_amount := NULL; NEW.exchange_rate := NULL; NEW.cash_amount := NULL;
    RETURN NEW;
  END IF;
  IF NEW.fx_amount IS NULL OR NEW.fx_amount <= 0 THEN
    RAISE EXCEPTION 'Facture % en % : indiquez le montant réglé en devise', _inv.invoice_number, _inv.currency USING ERRCODE = 'QG030';
  END IF;
  NEW.fx_amount := round(NEW.fx_amount, 2);
  _out := _inv.total - _inv.amount_paid;
  _fx_out := round(_out / _inv.exchange_rate, 2);
  IF NEW.fx_amount > _fx_out THEN
    RAISE EXCEPTION 'Facture % : % % réglés pour un restant dû de % %', _inv.invoice_number, NEW.fx_amount, _inv.currency, _fx_out, _inv.currency
      USING ERRCODE = 'QG005';
  END IF;
  NEW.currency := _inv.currency;
  NEW.exchange_rate := COALESCE(NEW.exchange_rate, public.exchange_rate_at(NEW.tenant_id, _inv.currency, COALESCE(NEW.payment_date, CURRENT_DATE)));
  IF NEW.exchange_rate IS NULL THEN
    RAISE EXCEPTION 'Aucun cours % au % : saisissez le cours du paiement ou enregistrez-le dans Paramètres → Devises et cours',
      _inv.currency, to_char(COALESCE(NEW.payment_date, CURRENT_DATE), 'DD/MM/YYYY') USING ERRCODE = 'QG030';
  END IF;
  NEW.amount := CASE WHEN NEW.fx_amount = _fx_out THEN _out ELSE least(round(NEW.fx_amount * _inv.exchange_rate, 2), _out) END;
  NEW.cash_amount := round(NEW.fx_amount * NEW.exchange_rate, 2);
  RETURN NEW;
END $$;
CREATE TRIGGER trg_aa_payment_currency BEFORE INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.payment_currency();

-- ─── Droit de saisie des cours ───
INSERT INTO public.erp_permission_catalog (code, module, action, label) VALUES
  ('currency.rates', 'currency', 'rates', 'Saisir les cours de change de la société')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.erp_system_role_permissions (role_code, permission_code) VALUES
  ('admin', 'currency.rates'), ('accountant', 'currency.rates'), ('treasury_manager', 'currency.rates')
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, sp.permission_code
  FROM public.erp_roles r
  JOIN public.erp_system_role_permissions sp ON sp.role_code = r.code
 WHERE r.is_system AND sp.permission_code = 'currency.rates'
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

-- ─── Fonctions existantes étendues à la devise ───
CREATE OR REPLACE FUNCTION public.compute_ap_invoice_line()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _inv public.ap_invoices%ROWTYPE; _rate numeric; _active boolean; _po uuid;
BEGIN
  SELECT * INTO _inv FROM public.ap_invoices WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF TG_OP = 'DELETE' AND NOT FOUND THEN RETURN OLD; END IF;
  IF _inv.approval_status NOT IN ('draft', 'rejected', 'pending') AND current_setting('qerp.ap_posting', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Facture « % » : ses lignes ne se modifient qu''en brouillon ou après rejet', _inv.approval_status USING ERRCODE = 'QG008';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  NEW.tenant_id := _inv.tenant_id;
  IF NEW.po_line_id IS NOT NULL THEN
    SELECT pl.po_id INTO _po FROM public.po_lines pl WHERE pl.id = NEW.po_line_id;
    IF _inv.po_id IS NULL OR _po IS DISTINCT FROM _inv.po_id THEN
      RAISE EXCEPTION 'Une ligne de facture ne cite qu''une ligne de la commande de la facture' USING ERRCODE = 'QG008';
    END IF;
  END IF;
  IF NEW.tax_code_id IS NOT NULL THEN
    SELECT rate, is_active INTO _rate, _active FROM public.tax_codes WHERE id = NEW.tax_code_id AND tenant_id = _inv.tenant_id;
    IF NOT FOUND OR NOT _active THEN RAISE EXCEPTION 'Code TVA inconnu ou inactif' USING ERRCODE = 'QG008'; END IF;
  END IF;
  IF NEW.expense_account_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.gl_accounts g WHERE g.id = NEW.expense_account_id AND g.tenant_id = _inv.tenant_id AND g.is_active AND NOT g.is_header) THEN
    RAISE EXCEPTION 'Compte de charge : compte actif et imputable de la société requis' USING ERRCODE = 'QG008';
  END IF;
  IF current_setting('qerp.ap_posting', true) IS DISTINCT FROM 'on' THEN
    IF _inv.currency IS NOT NULL THEN
      -- Facture en devise (V124) : prix saisi en devise, chaque ligne convertie au cours de la facture.
      NEW.fx_unit_price := COALESCE(NEW.fx_unit_price, NEW.unit_price);
      NEW.fx_net_amount := round(NEW.quantity * NEW.fx_unit_price * (1 - NEW.discount_pct / 100), 2);
      NEW.fx_tax_amount := round(NEW.fx_net_amount * COALESCE(_rate, 0) / 100, 2);
      NEW.unit_price := round(NEW.fx_unit_price * _inv.exchange_rate, 2);
      NEW.net_amount := round(NEW.fx_net_amount * _inv.exchange_rate, 2);
      NEW.tax_amount := round(NEW.fx_tax_amount * _inv.exchange_rate, 2);
    ELSE
      NEW.fx_unit_price := NULL; NEW.fx_net_amount := NULL; NEW.fx_tax_amount := NULL;
      NEW.net_amount := round(NEW.quantity * NEW.unit_price * (1 - NEW.discount_pct / 100), 2);
      NEW.tax_amount := round(NEW.net_amount * COALESCE(_rate, 0) / 100, 2);
    END IF;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.sync_ap_invoice_totals()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _id uuid := COALESCE(NEW.invoice_id, OLD.invoice_id);
BEGIN
  IF current_setting('qerp.ap_posting', true) = 'on' THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ap_invoices WHERE id = _id) THEN RETURN NULL; END IF;
  UPDATE public.ap_invoices i SET
    subtotal = COALESCE((SELECT sum(l.net_amount) FROM public.ap_invoice_lines l WHERE l.invoice_id = _id), 0),
    tax_amount = COALESCE((SELECT sum(l.tax_amount) FROM public.ap_invoice_lines l WHERE l.invoice_id = _id), 0),
    fx_subtotal = (SELECT sum(l.fx_net_amount) FROM public.ap_invoice_lines l WHERE l.invoice_id = _id),
    fx_tax_amount = (SELECT sum(l.fx_tax_amount) FROM public.ap_invoice_lines l WHERE l.invoice_id = _id)
   WHERE i.id = _id AND EXISTS (SELECT 1 FROM public.ap_invoice_lines l WHERE l.invoice_id = _id);
  RETURN NULL;
END $function$;

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
    FOR _l IN SELECT l.*, pl.unit_cost, pl.description AS po_desc FROM public.ap_invoice_lines l JOIN public.po_lines pl ON pl.id = l.po_line_id
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
  _cash numeric := COALESCE(NEW.cash_amount, NEW.amount);
  _fx_account uuid;
BEGIN
  IF NEW.reversal_of IS NOT NULL THEN RETURN NEW; END IF;

  IF NEW.payment_type = 'ap_payment' AND NEW.ap_invoice_id IS NOT NULL THEN
    _payable := public.posting_account_for(NEW.tenant_id, 'AP_PAYABLE', public.supplier_account_set((SELECT i.supplier_id FROM public.ap_invoices i WHERE i.id = NEW.ap_invoice_id)));
    _bank    := public.treasury_gl_account(NEW.tenant_id, NEW.bank_account_id, NEW.payment_method, false);

    IF _payable IS NULL THEN _manquants := _manquants || 'AP_PAYABLE'::text; END IF;
    IF _bank    IS NULL THEN _manquants := _manquants || public.treasury_role_for_method(NEW.payment_method); END IF;
    -- Paiement en devise (V124) : écart entre la contre-valeur décaissée et la dette soldée au cours de la facture.
    IF _cash <> NEW.amount THEN
      _fx_account := public.posting_account_for(NEW.tenant_id, CASE WHEN _cash > NEW.amount THEN 'FX_LOSS' ELSE 'FX_GAIN' END, NULL);
      IF _fx_account IS NULL THEN _manquants := _manquants || CASE WHEN _cash > NEW.amount THEN 'FX_LOSS' ELSE 'FX_GAIN' END; END IF;
    END IF;
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
    VALUES (_entry_id, _bank, 0, _cash, 'CR Trésorerie');
    IF _cash > NEW.amount THEN
      INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
      VALUES (_entry_id, _fx_account, _cash - NEW.amount, 0, 'DR Perte de change ' || COALESCE(NEW.currency, ''));
    ELSIF _cash < NEW.amount THEN
      INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
      VALUES (_entry_id, _fx_account, 0, NEW.amount - _cash, 'CR Gain de change ' || COALESCE(NEW.currency, ''));
    END IF;
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

CREATE OR REPLACE FUNCTION public.payment_treasury_line()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _entry uuid; _label text;
BEGIN
  IF NEW.bank_account_id IS NULL OR NEW.payment_type NOT IN ('ar_receipt', 'ap_payment') THEN RETURN NULL; END IF;
  SELECT journal_entry_id INTO _entry FROM public.payments WHERE id = NEW.id;
  SELECT CASE WHEN NEW.payment_type = 'ar_receipt' THEN 'Encaissement ' || COALESCE(i.invoice_number, '') || ' — ' || COALESCE(c.name, '')
              ELSE 'Paiement ' || COALESCE(a.invoice_number, '') || ' — ' || COALESCE(s.name, '') END
    INTO _label
    FROM (SELECT 1) x
    LEFT JOIN public.ar_invoices i ON i.id = NEW.ar_invoice_id LEFT JOIN public.customers c ON c.id = i.customer_id
    LEFT JOIN public.ap_invoices a ON a.id = NEW.ap_invoice_id LEFT JOIN public.suppliers s ON s.id = a.supplier_id;
  PERFORM public.record_treasury_line(NEW.tenant_id, NEW.bank_account_id, NEW.payment_date,
    CASE WHEN NEW.payment_type = 'ar_receipt' THEN NEW.amount ELSE -COALESCE(NEW.cash_amount, NEW.amount) END, 'payment',
    CASE WHEN NEW.reversal_of IS NOT NULL THEN 'Annulation — ' ELSE '' END || _label, NEW.reference, _entry, NEW.id);
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.reverse_settlement(_payment_id uuid, _reason text, _reversal_date date DEFAULT CURRENT_DATE)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _p public.payments%ROWTYPE;
  _droit text;
  _entry uuid;
  _id uuid := gen_random_uuid();
BEGIN
  SELECT * INTO _p FROM public.payments WHERE id = _payment_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Règlement introuvable dans la société active' USING ERRCODE = 'QG005';
  END IF;
  IF _p.payment_type IN ('ar_credit', 'ar_advance', 'ap_credit') THEN
    RAISE EXCEPTION 'L''imputation d''un avoir ou d''un acompte ne s''annule pas par contre-passation de règlement' USING ERRCODE = 'QG005';
  END IF;
  _droit := CASE _p.payment_type WHEN 'ar_receipt' THEN 'ar.reverse_receipt' ELSE 'ap.reverse_payment' END;
  IF NOT public.has_permission(auth.uid(), _droit) THEN
    RAISE EXCEPTION 'Droit insuffisant : %', (SELECT label FROM public.erp_permission_catalog WHERE code = _droit)
      USING ERRCODE = '42501';
  END IF;
  IF _p.reversal_of IS NOT NULL THEN
    RAISE EXCEPTION 'Une annulation ne s''annule pas' USING ERRCODE = 'QG005';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payments WHERE reversal_of = _p.id) THEN
    RAISE EXCEPTION 'Ce règlement est déjà annulé' USING ERRCODE = 'QG005';
  END IF;
  IF NULLIF(btrim(_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Motif d''annulation obligatoire' USING ERRCODE = 'QG005';
  END IF;
  IF _reversal_date IS NULL OR _reversal_date < _p.payment_date THEN
    RAISE EXCEPTION 'La date d''annulation ne peut pas précéder celle du règlement (%)', _p.payment_date
      USING ERRCODE = 'QG005';
  END IF;
  IF _p.journal_entry_id IS NULL THEN
    RAISE EXCEPTION 'Écriture du règlement introuvable : annulation impossible sans contre-passation, voir le comptable'
      USING ERRCODE = 'QG005';
  END IF;

  _entry := public.reverse_journal_entry(_p.journal_entry_id, _reversal_date, btrim(_reason));

  INSERT INTO public.payments (id, tenant_id, payment_type, ar_invoice_id, ap_invoice_id, amount, payment_date,
                               payment_method, reference, journal_entry_id, created_by, reversal_of, reversal_reason,
                               bank_account_id, currency, fx_amount, exchange_rate, cash_amount)
  VALUES (_id, _p.tenant_id, _p.payment_type, _p.ar_invoice_id, _p.ap_invoice_id, -_p.amount, _reversal_date,
          _p.payment_method, left('ANNULATION ' || COALESCE(_p.reference, ''), 200), _entry, auth.uid(), _p.id, btrim(_reason),
          _p.bank_account_id, _p.currency, -_p.fx_amount, _p.exchange_rate, -_p.cash_amount);
  RETURN _id;
END; $function$;

DROP FUNCTION public.record_settlement(text, uuid, date, text, text, jsonb, uuid);
CREATE FUNCTION public.record_settlement(_kind text, _party_id uuid, _payment_date date, _payment_method text, _reference text, _allocations jsonb, _bank_account_id uuid DEFAULT NULL::uuid, _exchange_rate numeric DEFAULT NULL::numeric)
 RETURNS uuid[]
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _a jsonb;
  _invoice uuid;
  _amount numeric;
  _number text;
  _party uuid;
  _status text;
  _approval text;
  _outstanding numeric;
  _seen uuid[] := '{}';
  _ids uuid[] := '{}';
  _id uuid;
  _cur text;
  _irate numeric;
  _fx numeric;
  _fx_out numeric;
BEGIN
  IF auth.uid() IS NULL OR _tenant IS NULL THEN
    RAISE EXCEPTION 'Connexion et société requises' USING ERRCODE = '42501';
  END IF;
  IF _kind NOT IN ('ar', 'ap') THEN
    RAISE EXCEPTION 'Type de règlement inconnu : % (ar ou ap)', _kind USING ERRCODE = '22023';
  END IF;
  IF _party_id IS NULL THEN
    RAISE EXCEPTION 'Choisissez d''abord le %', CASE WHEN _kind = 'ar' THEN 'client' ELSE 'fournisseur' END
      USING ERRCODE = 'QG005';
  END IF;
  IF _allocations IS NULL OR jsonb_typeof(_allocations) <> 'array' OR jsonb_array_length(_allocations) = 0 THEN
    RAISE EXCEPTION 'Imputez le règlement sur au moins une facture' USING ERRCODE = 'QG005';
  END IF;

  FOR _a IN SELECT * FROM jsonb_array_elements(_allocations) LOOP
    _invoice := (_a ->> 'invoice_id')::uuid;
    _amount := round((_a ->> 'amount')::numeric, 2);
    IF _invoice = ANY (_seen) THEN
      RAISE EXCEPTION 'La même facture apparaît deux fois dans le règlement' USING ERRCODE = 'QG005';
    END IF;
    _seen := _seen || _invoice;

    _cur := NULL; _irate := NULL; _fx := NULL;
    IF _kind = 'ar' THEN
      SELECT invoice_number, customer_id, status, NULL, total - amount_paid
        INTO _number, _party, _status, _approval, _outstanding
        FROM public.ar_invoices WHERE id = _invoice AND tenant_id = _tenant FOR UPDATE;
    ELSE
      SELECT invoice_number, supplier_id, status, approval_status, total - amount_paid, currency, exchange_rate
        INTO _number, _party, _status, _approval, _outstanding, _cur, _irate
        FROM public.ap_invoices WHERE id = _invoice AND tenant_id = _tenant FOR UPDATE;
    END IF;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Facture introuvable dans la société' USING ERRCODE = 'QG005';
    END IF;
    IF _party IS DISTINCT FROM _party_id THEN
      RAISE EXCEPTION 'La facture % n''appartient pas au % choisi', _number,
        CASE WHEN _kind = 'ar' THEN 'client' ELSE 'fournisseur' END USING ERRCODE = 'QG005';
    END IF;
    IF _status IN ('draft', 'paid', 'cancelled', 'void') THEN
      RAISE EXCEPTION 'La facture % n''est pas ouverte au règlement (statut : %)', _number, _status USING ERRCODE = 'QG005';
    END IF;
    IF _kind = 'ap' AND _approval IS DISTINCT FROM 'approved' THEN
      RAISE EXCEPTION 'La facture fournisseur % n''est pas approuvée : paiement refusé', _number USING ERRCODE = 'QG005';
    END IF;
    -- Facture en devise (V124) : l'imputation se donne en devise ; la part de facture soldée est calculée au cours de
    -- la facture (le solde exact quand tout est réglé), comme le fait payment_currency pour tout paiement.
    IF _cur IS NOT NULL THEN
      _fx := round((_a ->> 'fx_amount')::numeric, 2);
      _fx_out := round(_outstanding / _irate, 2);
      IF _fx IS NULL OR _fx <= 0 THEN
        RAISE EXCEPTION 'Facture % en % : indiquez le montant réglé en devise', _number, _cur USING ERRCODE = 'QG030';
      END IF;
      IF _fx > _fx_out THEN
        RAISE EXCEPTION 'Facture % : % % réglés pour un restant dû de % %', _number, _fx, _cur, _fx_out, _cur USING ERRCODE = 'QG005';
      END IF;
      _amount := CASE WHEN _fx = _fx_out THEN _outstanding ELSE least(round(_fx * _irate, 2), _outstanding) END;
    END IF;
    IF _amount IS NULL OR _amount <= 0 THEN
      RAISE EXCEPTION 'Montant imputé invalide sur la facture %', _number USING ERRCODE = 'QG005';
    END IF;
    IF _amount > _outstanding THEN
      RAISE EXCEPTION 'Facture % : % imputé pour un restant dû de %', _number, _amount, _outstanding USING ERRCODE = 'QG005';
    END IF;

    INSERT INTO public.payments (tenant_id, payment_type, ar_invoice_id, ap_invoice_id, amount, payment_date,
                                 payment_method, reference, created_by, bank_account_id, fx_amount, exchange_rate)
    VALUES (_tenant, CASE WHEN _kind = 'ar' THEN 'ar_receipt' ELSE 'ap_payment' END,
            CASE WHEN _kind = 'ar' THEN _invoice END, CASE WHEN _kind = 'ap' THEN _invoice END,
            _amount, COALESCE(_payment_date, CURRENT_DATE), COALESCE(NULLIF(_payment_method, ''), 'bank_transfer'),
            NULLIF(btrim(_reference), ''), auth.uid(), _bank_account_id, _fx, CASE WHEN _cur IS NOT NULL THEN _exchange_rate END)
    RETURNING id INTO _id;
    _ids := _ids || _id;
  END LOOP;
  RETURN _ids;
END $function$;
REVOKE EXECUTE ON FUNCTION public.record_settlement(text, uuid, date, text, text, jsonb, uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_settlement(text, uuid, date, text, text, jsonb, uuid, numeric) TO authenticated;

SELECT public.install_tenant_isolation_triggers();
