-- V33 — Calendrier fiscal central : exercices, périodes, statut par module. Écrit à la main.
--
-- Références : SAP (variante d'exercice par société ; ouverture/fermeture des périodes à un seul
-- endroit, par type de compte — OB52), Sage 300 (calendrier fiscal dans les services communs,
-- verrouillage par module, modules opérationnels avant les modules financiers), Sage X3
-- (exercice → périodes générées, statuts non ouvert / ouvert / clôturé, deux exercices ouverts au
-- plus), AUDCIF art. 7 (exercice de douze mois, année civile ; seul le premier peut différer).
--
-- Avant V33 (constaté sur la copie réelle) :
--   - aucune notion d'exercice ; chaque module tenait ses périodes à sa façon (period_locks avec
--     des noms de module disparates, treasury_period_closes, inventory_period_closes) ;
--   - period_locks n'avait qu'une politique « Tenant isolation » FOR ALL : un simple lecteur
--     clôturait ou rouvrait la comptabilité en écrivant dans la table, alors que close_gl_period
--     le lui refusait ; l'écran AR écrivait lui-même dans la table ;
--   - close_inventory_period écrivait des colonnes inexistantes (locked_by, locked_at) et
--     close_treasury_period lisait bank_reconciliations.ending_balance, qui n'existe pas (le solde
--     du relevé est bank_balance) : la clôture de stock et celle de trésorerie échouaient à
--     chaque fois.
--
-- Après V33 :
--   - fiscal_years (par société, statut not_open / open / closed — la clôture est définitive),
--     fiscal_periods (mois générés), fiscal_modules (référentiel des neuf modules) ;
--   - period_locks reste le registre du statut d'une période pour un module, mais ne s'écrit
--     plus que par les fonctions ci-dessous (politique en lecture seule, droits d'écriture
--     retirés) ; les noms de module sont normalisés (GL, AR, AP, SALES, PURCHASING, INVENTORY,
--     TREASURY, ASSETS, PAYROLL) ;
--   - une seule fonction de contrôle, assert_fiscal_period_open(), appelée par tous les
--     déclencheurs (SQLSTATE QG003) : une société qui a défini ses exercices ne saisit rien hors
--     d'un exercice ouvert ; une période close pour un module refuse les opérations de ce module ;
--   - ordre de clôture bloquant : le Grand livre ne se clôture qu'après tous les autres modules
--     de la période ; un module ne se rouvre que si le Grand livre est ouvert ;
--   - deux droits du catalogue : periods.close et periods.reopen (motif obligatoire), accordés à
--     admin ; la trésorerie et les stocks gardent aussi leurs droits de clôture propres ;
--   - fiscal_calendar_audit : chaque création, ouverture, clôture, réouverture, avec l'auteur et
--     le motif.
-- Une société sans exercice défini garde le comportement antérieur (seuls les verrous de
-- période s'appliquent) : elle définit son premier exercice dans Paramètres → Exercices et
-- périodes. Les sociétés existantes reçoivent des exercices civils ouverts couvrant leurs
-- données, de l'année de la plus ancienne à l'année prochaine.
--
-- Jumelle : supabase/migrations/20261113210000_4e8b2d6a-1c7f-4a3e-9b5d-6f0a2c8e1b94.sql

-- ─── Référentiel des modules ───
CREATE TABLE public.fiscal_modules (
    code text PRIMARY KEY,
    label text NOT NULL,
    sort_order integer NOT NULL UNIQUE,
    is_ledger boolean NOT NULL DEFAULT false
);
INSERT INTO public.fiscal_modules (code, label, sort_order, is_ledger) VALUES
  ('SALES', 'Ventes', 10, false),
  ('PURCHASING', 'Achats', 20, false),
  ('INVENTORY', 'Stocks', 30, false),
  ('AR', 'Comptes clients', 40, false),
  ('AP', 'Comptes fournisseurs', 50, false),
  ('TREASURY', 'Trésorerie', 60, false),
  ('ASSETS', 'Immobilisations', 70, false),
  ('PAYROLL', 'Paie', 80, false),
  ('GL', 'Grand livre', 90, true);
ALTER TABLE public.fiscal_modules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture du référentiel" ON public.fiscal_modules FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.fiscal_modules TO authenticated;

-- ─── Exercices et périodes ───
CREATE TABLE public.fiscal_years (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    code text NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    status text NOT NULL DEFAULT 'not_open' CHECK (status IN ('not_open', 'open', 'closed')),
    created_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    opened_at timestamptz,
    closed_by uuid,
    closed_at timestamptz,
    UNIQUE (tenant_id, code),
    CHECK (extract(day FROM start_date) = 1),
    CHECK (end_date = (date_trunc('month', end_date) + interval '1 month - 1 day')::date),
    CHECK (end_date > start_date)
);
CREATE INDEX fiscal_years_tenant_idx ON public.fiscal_years (tenant_id, start_date);

CREATE TABLE public.fiscal_periods (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    fiscal_year_id uuid NOT NULL REFERENCES public.fiscal_years(id) ON DELETE CASCADE,
    period_no integer NOT NULL CHECK (period_no BETWEEN 1 AND 18),
    code text NOT NULL CHECK (code ~ '^\d{4}-(0[1-9]|1[0-2])$'),
    start_date date NOT NULL,
    end_date date NOT NULL,
    UNIQUE (tenant_id, code),
    UNIQUE (fiscal_year_id, period_no)
);

CREATE TABLE public.fiscal_calendar_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
    tenant_id uuid NOT NULL,
    actor_id uuid,
    action text NOT NULL CHECK (action IN ('fiscal_year_created', 'fiscal_year_opened', 'fiscal_year_closed',
                                           'period_closed', 'period_reopened')),
    fiscal_year_code text,
    period text,
    module text,
    reason text,
    details jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fiscal_calendar_audit_tenant_idx ON public.fiscal_calendar_audit (tenant_id, seq DESC);

ALTER TABLE public.fiscal_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_calendar_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON public.fiscal_years FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Tenant isolation" ON public.fiscal_periods FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
GRANT SELECT ON public.fiscal_years, public.fiscal_periods, public.fiscal_calendar_audit TO authenticated;

-- ─── Droits du catalogue ───
INSERT INTO public.erp_permission_catalog (code, module, action, label) VALUES
  ('periods.close', 'periods', 'close', 'Clôturer une période ou un exercice'),
  ('periods.reopen', 'periods', 'reopen', 'Rouvrir une période (motif obligatoire)');
INSERT INTO public.erp_system_role_permissions (role_code, permission_code) VALUES
  ('admin', 'periods.close'),
  ('admin', 'periods.reopen');
DO $$
DECLARE _t uuid;
BEGIN
  FOR _t IN SELECT id FROM public.tenants LOOP
    PERFORM public.seed_tenant_system_roles(_t);
  END LOOP;
END $$;

-- Le journal se lit par qui peut clôturer ou rouvrir.
CREATE POLICY "Clôture des périodes" ON public.fiscal_calendar_audit FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid())
         AND (public.has_permission(auth.uid(), 'periods.close') OR public.has_permission(auth.uid(), 'periods.reopen')));

-- ─── period_locks : registre en lecture seule, modules normalisés ───
DO $$
DECLARE _inconnus text;
BEGIN
  SELECT string_agg(DISTINCT module, ', ') INTO _inconnus FROM public.period_locks
   WHERE lower(module) NOT IN ('gl', 'ar', 'ap', 'sales', 'purchasing', 'procurement', 'inventory', 'treasury',
                               'assets', 'fixed_assets', 'payroll', 'hr');
  IF _inconnus IS NOT NULL THEN
    RAISE EXCEPTION 'V33 interrompue : modules de période inconnus dans period_locks : %', _inconnus;
  END IF;
END $$;

-- Doublons après normalisation (« Inventory » et « inventory ») : on garde le plus contraignant.
WITH n AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY tenant_id, period,
             CASE lower(module) WHEN 'procurement' THEN 'purchasing' WHEN 'fixed_assets' THEN 'assets'
                                WHEN 'hr' THEN 'payroll' ELSE lower(module) END
           ORDER BY (status = 'closed') DESC, closed_at DESC NULLS LAST, created_at) AS rang
  FROM public.period_locks)
DELETE FROM public.period_locks p USING n WHERE p.id = n.id AND n.rang > 1;

UPDATE public.period_locks SET module = CASE lower(module)
    WHEN 'procurement' THEN 'PURCHASING' WHEN 'fixed_assets' THEN 'ASSETS' WHEN 'hr' THEN 'PAYROLL'
    ELSE upper(module) END;
UPDATE public.period_locks SET status = 'open' WHERE status NOT IN ('open', 'closed');

ALTER TABLE public.period_locks ADD COLUMN reason text;
ALTER TABLE public.period_locks
  ADD CONSTRAINT period_locks_module_fkey FOREIGN KEY (module) REFERENCES public.fiscal_modules(code),
  ADD CONSTRAINT period_locks_status_check CHECK (status IN ('open', 'closed')),
  ADD CONSTRAINT period_locks_period_check CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$');

DROP POLICY "Tenant isolation" ON public.period_locks;
CREATE POLICY "Tenant isolation" ON public.period_locks FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.period_locks FROM anon, authenticated;

-- ─── Contrôle central ───
CREATE FUNCTION public.fiscal_module_label(_module text) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ SELECT COALESCE((SELECT label FROM public.fiscal_modules WHERE code = _module), _module) $$;

-- Refuse (QG003) une opération datée hors d'un exercice ouvert, ou dans une période close pour ce
-- module. Une société sans exercice défini n'est soumise qu'aux verrous de période.
CREATE FUNCTION public.assert_fiscal_period_open(_tenant uuid, _date date, _module text) RETURNS void
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _fy public.fiscal_years%ROWTYPE;
  _code text;
BEGIN
  IF _tenant IS NULL OR _date IS NULL THEN RETURN; END IF;
  _code := to_char(_date, 'YYYY-MM');
  IF EXISTS (SELECT 1 FROM public.fiscal_years WHERE tenant_id = _tenant) THEN
    SELECT * INTO _fy FROM public.fiscal_years
     WHERE tenant_id = _tenant AND _date BETWEEN start_date AND end_date;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Aucun exercice ne couvre le % : créez-le dans Paramètres → Exercices et périodes',
        to_char(_date, 'DD/MM/YYYY') USING ERRCODE = 'QG003';
    ELSIF _fy.status = 'not_open' THEN
      RAISE EXCEPTION 'L''exercice % n''est pas encore ouvert : opération du % refusée', _fy.code,
        to_char(_date, 'DD/MM/YYYY') USING ERRCODE = 'QG003';
    ELSIF _fy.status = 'closed' THEN
      RAISE EXCEPTION 'L''exercice % est clôturé : opération du % refusée', _fy.code,
        to_char(_date, 'DD/MM/YYYY') USING ERRCODE = 'QG003';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.period_locks
              WHERE tenant_id = _tenant AND period = _code AND module = _module AND status = 'closed') THEN
    RAISE EXCEPTION 'Période % clôturée pour le module % : opération refusée', _code,
      public.fiscal_module_label(_module) USING ERRCODE = 'QG003';
  END IF;
END $$;

-- Grand livre : écritures validées ou contre-passées (corps V8, contrôle central).
CREATE OR REPLACE FUNCTION public.enforce_period_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Only check when the entry is or becomes posted
  IF NEW.status NOT IN ('posted','reversed') THEN RETURN NEW; END IF;
  PERFORM public.assert_fiscal_period_open(NEW.tenant_id, NEW.entry_date, 'GL');
  RETURN NEW;
END; $function$;

-- Ventes : devis, commandes, livraisons (corps V30, contrôle central).
CREATE OR REPLACE FUNCTION public.enforce_sales_period_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _date date;
BEGIN
  IF TG_TABLE_NAME = 'quotations' THEN
    _date := NEW.quote_date;
  ELSIF TG_TABLE_NAME = 'sales_orders' THEN
    _date := NEW.order_date;
  ELSIF TG_TABLE_NAME = 'delivery_notes' THEN
    _date := NEW.delivery_date;
  END IF;
  PERFORM public.assert_fiscal_period_open(NEW.tenant_id, _date, 'SALES');
  RETURN NEW;
END $function$;

-- Stocks : mouvements (corps V8, contrôle central).
CREATE OR REPLACE FUNCTION public.enforce_inventory_period_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assert_fiscal_period_open(NEW.tenant_id, COALESCE(NEW.movement_date, CURRENT_DATE), 'INVENTORY');
  RETURN NEW;
END $function$;

-- Les autres modules. Une branche IF par table : PL/pgSQL prépare chaque expression d'un bloc,
-- un champ NEW.x ne se lit que dans la branche de sa table (voir V30).
CREATE FUNCTION public.enforce_fiscal_period() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _tenant uuid;
BEGIN
  IF TG_TABLE_NAME = 'ar_invoices' THEN
    -- Émission (sortie du brouillon) ou changement de date d'une facture émise ; les mises à jour
    -- de règlement (montant payé, statut) d'une facture d'une période close restent possibles.
    IF NEW.status = 'draft' THEN RETURN NEW; END IF;
    IF TG_OP = 'INSERT' OR OLD.status = 'draft' OR OLD.invoice_date IS DISTINCT FROM NEW.invoice_date THEN
      PERFORM public.assert_fiscal_period_open(NEW.tenant_id, NEW.invoice_date, 'AR');
    END IF;
  ELSIF TG_TABLE_NAME = 'ap_invoices' THEN
    IF TG_OP = 'INSERT' OR OLD.invoice_date IS DISTINCT FROM NEW.invoice_date THEN
      PERFORM public.assert_fiscal_period_open(NEW.tenant_id, NEW.invoice_date, 'AP');
    END IF;
  ELSIF TG_TABLE_NAME = 'payments' THEN
    IF TG_OP = 'INSERT' OR OLD.payment_date IS DISTINCT FROM NEW.payment_date THEN
      IF NEW.payment_type = 'ar_receipt' THEN
        PERFORM public.assert_fiscal_period_open(NEW.tenant_id, NEW.payment_date, 'AR');
      ELSIF NEW.payment_type = 'ap_payment' THEN
        PERFORM public.assert_fiscal_period_open(NEW.tenant_id, NEW.payment_date, 'AP');
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'purchase_orders' THEN
    IF TG_OP = 'INSERT' OR OLD.order_date IS DISTINCT FROM NEW.order_date THEN
      PERFORM public.assert_fiscal_period_open(NEW.tenant_id, NEW.order_date, 'PURCHASING');
    END IF;
  ELSIF TG_TABLE_NAME = 'bank_transactions' THEN
    IF TG_OP = 'INSERT' OR OLD.transaction_date IS DISTINCT FROM NEW.transaction_date THEN
      PERFORM public.assert_fiscal_period_open(NEW.tenant_id, NEW.transaction_date, 'TREASURY');
    END IF;
  ELSIF TG_TABLE_NAME = 'payroll_runs' THEN
    IF TG_OP = 'INSERT' OR OLD.pay_date IS DISTINCT FROM NEW.pay_date OR OLD.status IS DISTINCT FROM NEW.status THEN
      PERFORM public.assert_fiscal_period_open(NEW.tenant_id, NEW.pay_date, 'PAYROLL');
    END IF;
  ELSIF TG_TABLE_NAME = 'depreciation_entries' THEN
    IF TG_OP = 'INSERT' OR OLD.period_date IS DISTINCT FROM NEW.period_date THEN
      SELECT tenant_id INTO _tenant FROM public.assets WHERE id = NEW.asset_id;
      PERFORM public.assert_fiscal_period_open(_tenant, NEW.period_date, 'ASSETS');
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_fiscal_period_ar_invoices BEFORE INSERT OR UPDATE ON public.ar_invoices
  FOR EACH ROW EXECUTE FUNCTION public.enforce_fiscal_period();
CREATE TRIGGER trg_fiscal_period_ap_invoices BEFORE INSERT OR UPDATE ON public.ap_invoices
  FOR EACH ROW EXECUTE FUNCTION public.enforce_fiscal_period();
CREATE TRIGGER trg_fiscal_period_payments BEFORE INSERT OR UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_fiscal_period();
CREATE TRIGGER trg_fiscal_period_purchase_orders BEFORE INSERT OR UPDATE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_fiscal_period();
CREATE TRIGGER trg_fiscal_period_bank_transactions BEFORE INSERT OR UPDATE ON public.bank_transactions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_fiscal_period();
CREATE TRIGGER trg_fiscal_period_payroll_runs BEFORE INSERT OR UPDATE ON public.payroll_runs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_fiscal_period();
CREATE TRIGGER trg_fiscal_period_depreciation_entries BEFORE INSERT OR UPDATE ON public.depreciation_entries
  FOR EACH ROW EXECUTE FUNCTION public.enforce_fiscal_period();

-- ─── Changement de statut : règles communes (sans contrôle de droit, interne) ───
CREATE FUNCTION public.fiscal_period_set(_tenant uuid, _period text, _module text, _close boolean,
                                         _reason text DEFAULT NULL, _details jsonb DEFAULT NULL) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _fy public.fiscal_years%ROWTYPE;
  _manquants text;
  _actuel text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.fiscal_modules WHERE code = _module) THEN
    RAISE EXCEPTION 'Module inconnu : %', _module USING ERRCODE = '22023';
  END IF;
  IF _period IS NULL OR _period !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'Période invalide : % (format AAAA-MM)', _period USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.fiscal_years WHERE tenant_id = _tenant) THEN
    SELECT y.* INTO _fy FROM public.fiscal_periods p JOIN public.fiscal_years y ON y.id = p.fiscal_year_id
     WHERE p.tenant_id = _tenant AND p.code = _period;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'La période % n''appartient à aucun exercice de la société', _period USING ERRCODE = 'QG003';
    ELSIF _fy.status <> 'open' THEN
      RAISE EXCEPTION 'L''exercice % n''est pas ouvert : le statut de ses périodes ne change plus', _fy.code
        USING ERRCODE = 'QG003';
    END IF;
  END IF;

  SELECT status INTO _actuel FROM public.period_locks WHERE tenant_id = _tenant AND period = _period AND module = _module;
  IF COALESCE(_actuel, 'open') = (CASE WHEN _close THEN 'closed' ELSE 'open' END) THEN
    RETURN;   -- déjà dans l'état demandé
  END IF;

  IF _close AND _module = 'GL' THEN
    -- Ordre de clôture : tous les autres modules d'abord.
    SELECT string_agg(m.label, ', ' ORDER BY m.sort_order) INTO _manquants
      FROM public.fiscal_modules m
     WHERE NOT m.is_ledger
       AND NOT EXISTS (SELECT 1 FROM public.period_locks l WHERE l.tenant_id = _tenant AND l.period = _period
                         AND l.module = m.code AND l.status = 'closed');
    IF _manquants IS NOT NULL THEN
      RAISE EXCEPTION 'Clôturez d''abord la période % pour : %', _period, _manquants USING ERRCODE = 'QG003';
    END IF;
  END IF;
  IF NOT _close THEN
    IF _reason IS NULL OR btrim(_reason) = '' THEN
      RAISE EXCEPTION 'Motif obligatoire pour rouvrir une période' USING ERRCODE = '22023';
    END IF;
    IF _module <> 'GL' AND EXISTS (SELECT 1 FROM public.period_locks WHERE tenant_id = _tenant AND period = _period
                                     AND module = 'GL' AND status = 'closed') THEN
      RAISE EXCEPTION 'Rouvrez d''abord le Grand livre pour la période %', _period USING ERRCODE = 'QG003';
    END IF;
  END IF;

  INSERT INTO public.period_locks (tenant_id, period, module, status, closed_by, closed_at, reason)
  VALUES (_tenant, _period, _module, CASE WHEN _close THEN 'closed' ELSE 'open' END,
          CASE WHEN _close THEN auth.uid() END, CASE WHEN _close THEN now() END, NULLIF(btrim(_reason), ''))
  ON CONFLICT (tenant_id, period, module) DO UPDATE
    SET status = EXCLUDED.status, closed_by = EXCLUDED.closed_by, closed_at = EXCLUDED.closed_at,
        reason = EXCLUDED.reason;

  INSERT INTO public.fiscal_calendar_audit (tenant_id, actor_id, action, fiscal_year_code, period, module, reason, details)
  VALUES (_tenant, auth.uid(), CASE WHEN _close THEN 'period_closed' ELSE 'period_reopened' END, _fy.code,
          _period, _module, NULLIF(btrim(_reason), ''), _details);
END $$;
REVOKE ALL ON FUNCTION public.fiscal_period_set(uuid, text, text, boolean, text, jsonb) FROM PUBLIC, anon, authenticated;

-- ─── Clôtures propres aux modules, rebranchées sur le calendrier ───
CREATE OR REPLACE FUNCTION public.close_gl_period(_period text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _unbalanced int;
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'No tenant'; END IF;
  IF NOT public.has_permission(auth.uid(), 'periods.close') THEN
    RAISE EXCEPTION 'Droit requis : clôturer une période (periods.close)' USING ERRCODE = '42501';
  END IF;

  -- Refuse close if draft/unbalanced entries exist in the period
  SELECT count(*) INTO _unbalanced
    FROM public.journal_entries je
   WHERE je.tenant_id = _tenant
     AND to_char(je.entry_date,'YYYY-MM') = _period
     AND je.status IN ('draft','validated');
  IF _unbalanced > 0 THEN
    RAISE EXCEPTION 'Cannot close % : % entries are still draft/validated', _period, _unbalanced;
  END IF;

  PERFORM public.fiscal_period_set(_tenant, _period, 'GL', true);
  RETURN (SELECT id FROM public.period_locks WHERE tenant_id = _tenant AND period = _period AND module = 'GL');
END; $function$;

-- Sans motif, une réouverture n'est plus admise : elle passe par set_period_status.
CREATE OR REPLACE FUNCTION public.reopen_gl_period(_period text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RAISE EXCEPTION 'Motif obligatoire : rouvrez la période dans Paramètres → Exercices et périodes'
    USING ERRCODE = '22023';
END; $function$;

CREATE OR REPLACE FUNCTION public.close_inventory_period(_period text)
 RETURNS inventory_period_closes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant UUID := public.get_user_tenant_id(auth.uid());
  _user UUID := auth.uid();
  _existing public.inventory_period_closes;
  _row public.inventory_period_closes;
  _snapshot JSONB;
  _total_value NUMERIC;
  _total_qty NUMERIC;
  _items_count INTEGER;
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'no tenant'; END IF;
  IF NOT (public.has_inventory_perm(_user, 'close') OR public.has_permission(_user, 'periods.close')) THEN
    RAISE EXCEPTION 'forbidden: requires inventory close permission';
  END IF;
  IF _period !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'invalid period format, expected YYYY-MM';
  END IF;

  SELECT * INTO _existing FROM public.inventory_period_closes
   WHERE tenant_id = _tenant AND period = _period;
  IF FOUND THEN
    INSERT INTO public.inventory_role_audit
      (tenant_id, target_user_id, role, action, performed_by, comment)
    VALUES (_tenant, _user, 'inventory_controller', 'period_close_idempotent', _user, _period);
    RETURN _existing;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'item_id', item_id, 'code', code, 'name', name, 'category', category,
            'qty', quantity_on_hand, 'unit_cost', unit_cost, 'value', stock_value)), '[]'::jsonb),
         COALESCE(SUM(stock_value), 0),
         COALESCE(SUM(quantity_on_hand), 0),
         COUNT(*)
    INTO _snapshot, _total_value, _total_qty, _items_count
    FROM public.inventory_slow_moving_view
   WHERE tenant_id = _tenant;

  INSERT INTO public.inventory_period_closes
    (tenant_id, period, closed_by, total_value, total_qty, items_count, snapshot)
  VALUES (_tenant, _period, _user, _total_value, _total_qty, _items_count, _snapshot)
  RETURNING * INTO _row;

  -- Écrivait period_locks(locked_by, locked_at), colonnes inexistantes : la clôture échouait.
  PERFORM public.fiscal_period_set(_tenant, _period, 'INVENTORY', true);

  INSERT INTO public.inventory_role_audit
    (tenant_id, target_user_id, role, action, performed_by, comment)
  VALUES (_tenant, _user, 'inventory_controller', 'period_close', _user, _period);

  RETURN _row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.close_treasury_period(_period text)
 RETURNS treasury_period_closes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _user uuid := auth.uid();
  _existing public.treasury_period_closes;
  _row public.treasury_period_closes;
  _snapshot jsonb;
  _total_balance numeric := 0;
  _accounts_count int := 0;
  _recon_count int := 0;
  _open_drafts int := 0;
  _period_start date;
  _period_end date;
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'no tenant'; END IF;
  IF NOT (public.has_treasury_perm(_user, 'close_period') OR public.has_permission(_user, 'periods.close')) THEN
    RAISE EXCEPTION 'forbidden: requires treasury close permission';
  END IF;
  IF _period !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'invalid period format, expected YYYY-MM';
  END IF;

  _period_start := to_date(_period || '-01','YYYY-MM-DD');
  _period_end := (_period_start + interval '1 month - 1 day')::date;

  SELECT * INTO _existing FROM public.treasury_period_closes
   WHERE tenant_id = _tenant AND period = _period;
  IF FOUND THEN
    INSERT INTO public.treasury_role_audit
      (tenant_id, actor_id, target_user_id, role, action, comment)
    VALUES (_tenant, _user, _user, 'treasury_controller'::public.app_role,
            'period_close_idempotent', _period);
    RETURN _existing;
  END IF;

  IF EXISTS (SELECT 1 FROM public.period_locks
              WHERE tenant_id = _tenant AND period = _period AND module = 'TREASURY'
                AND status = 'closed') THEN
    INSERT INTO public.treasury_role_audit
      (tenant_id, actor_id, target_user_id, role, action, comment)
    VALUES (_tenant, _user, _user, 'treasury_controller'::public.app_role,
            'period_close_failed', _period || ' | already_locked');
    RAISE EXCEPTION 'period already locked';
  END IF;

  SELECT COUNT(*) INTO _open_drafts
    FROM public.bank_reconciliations
   WHERE tenant_id = _tenant
     AND status = 'draft'
     AND period_end <= _period_end
     AND period_end >= _period_start;
  IF _open_drafts > 0 THEN
    INSERT INTO public.treasury_role_audit
      (tenant_id, actor_id, target_user_id, role, action, comment)
    VALUES (_tenant, _user, _user, 'treasury_controller'::public.app_role,
            'period_close_failed',
            _period || ' | unreconciled:' || _open_drafts);
    RAISE EXCEPTION 'unreconciled: % open reconciliation(s) in period', _open_drafts;
  END IF;

  INSERT INTO public.treasury_role_audit
    (tenant_id, actor_id, target_user_id, role, action, comment)
  VALUES (_tenant, _user, _user, 'treasury_controller'::public.app_role,
          'period_close_started', _period);

  SELECT COALESCE(jsonb_build_object(
      'accounts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', id, 'name', name, 'bank_name', bank_name, 'currency', currency,
          'balance', balance, 'last_reconciled_at', last_reconciled_at))
        FROM public.bank_accounts WHERE tenant_id = _tenant), '[]'::jsonb),
      'reconciliations', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', id, 'bank_account_id', bank_account_id, 'period_start', period_start,
          'period_end', period_end, 'status', status, 'ending_balance', bank_balance))
        FROM public.bank_reconciliations
        WHERE tenant_id = _tenant AND period_end >= _period_start AND period_end <= _period_end),
        '[]'::jsonb),
      'period_start', _period_start, 'period_end', _period_end
    ), '{}'::jsonb)
    INTO _snapshot;

  SELECT COALESCE(SUM(balance), 0), COUNT(*) INTO _total_balance, _accounts_count
    FROM public.bank_accounts WHERE tenant_id = _tenant;
  SELECT COUNT(*) INTO _recon_count
    FROM public.bank_reconciliations
   WHERE tenant_id = _tenant AND period_end >= _period_start AND period_end <= _period_end;

  INSERT INTO public.treasury_period_closes
    (tenant_id, period, status, total_balance, accounts_count, reconciliations_count,
     snapshot, closed_by)
  VALUES (_tenant, _period, 'completed', _total_balance, _accounts_count, _recon_count,
          _snapshot, _user)
  RETURNING * INTO _row;

  PERFORM public.fiscal_period_set(_tenant, _period, 'TREASURY', true);

  INSERT INTO public.treasury_role_audit
    (tenant_id, actor_id, target_user_id, role, action, comment)
  VALUES (_tenant, _user, _user, 'treasury_controller'::public.app_role,
          'period_close_completed', _period);

  RETURN _row;
END;
$function$;

-- ─── Point d'entrée unique de l'écran ───
CREATE FUNCTION public.set_period_status(_period text, _module text, _status text, _reason text DEFAULT NULL)
    RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _details jsonb;
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Aucune société rattachée à votre profil' USING ERRCODE = '42501'; END IF;
  IF _status NOT IN ('open', 'closed') THEN
    RAISE EXCEPTION 'Statut invalide : % (open ou closed)', _status USING ERRCODE = '22023';
  END IF;

  IF _status = 'closed' THEN
    -- Les clôtures qui ont leurs propres contrôles passent par leur fonction.
    IF _module = 'GL' THEN PERFORM public.close_gl_period(_period); RETURN; END IF;
    IF _module = 'TREASURY' THEN PERFORM public.close_treasury_period(_period); RETURN; END IF;
    IF _module = 'INVENTORY' THEN PERFORM public.close_inventory_period(_period); RETURN; END IF;
    IF NOT public.has_permission(auth.uid(), 'periods.close') THEN
      RAISE EXCEPTION 'Droit requis : clôturer une période (periods.close)' USING ERRCODE = '42501';
    END IF;
    PERFORM public.fiscal_period_set(_tenant, _period, _module, true, _reason);
    RETURN;
  END IF;

  IF NOT public.has_permission(auth.uid(), 'periods.reopen') THEN
    RAISE EXCEPTION 'Droit requis : rouvrir une période (periods.reopen)' USING ERRCODE = '42501';
  END IF;
  -- Rouvrir la trésorerie ou les stocks retire la photographie de clôture (gardée au journal) :
  -- la prochaine clôture en reprendra une à jour.
  IF _module = 'TREASURY' THEN
    SELECT to_jsonb(c) - 'snapshot' INTO _details FROM public.treasury_period_closes c WHERE tenant_id = _tenant AND period = _period;
  ELSIF _module = 'INVENTORY' THEN
    SELECT to_jsonb(c) - 'snapshot' INTO _details FROM public.inventory_period_closes c WHERE tenant_id = _tenant AND period = _period;
  END IF;
  PERFORM public.fiscal_period_set(_tenant, _period, _module, false, _reason, _details);
  IF _module = 'TREASURY' THEN
    DELETE FROM public.treasury_period_closes WHERE tenant_id = _tenant AND period = _period;
  ELSIF _module = 'INVENTORY' THEN
    DELETE FROM public.inventory_period_closes WHERE tenant_id = _tenant AND period = _period;
  END IF;
END $$;

-- ─── Exercices ───
CREATE FUNCTION public.fiscal_generate_periods(_fiscal_year_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _fy public.fiscal_years%ROWTYPE;
  _debut date;
  _n integer := 0;
BEGIN
  SELECT * INTO _fy FROM public.fiscal_years WHERE id = _fiscal_year_id;
  _debut := _fy.start_date;
  WHILE _debut <= _fy.end_date LOOP
    _n := _n + 1;
    INSERT INTO public.fiscal_periods (tenant_id, fiscal_year_id, period_no, code, start_date, end_date)
    VALUES (_fy.tenant_id, _fy.id, _n, to_char(_debut, 'YYYY-MM'), _debut, (_debut + interval '1 month - 1 day')::date);
    _debut := (_debut + interval '1 month')::date;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.fiscal_generate_periods(uuid) FROM PUBLIC, anon, authenticated;

-- Crée un exercice (statut « non ouvert ») et ses périodes. Le premier dure de 1 à 18 mois et
-- peut commencer n'importe quel mois (exercice décalé) ; les suivants durent 12 mois et
-- touchent l'ensemble existant, avant ou après.
CREATE FUNCTION public.create_fiscal_year(_start date, _end date DEFAULT NULL) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _fin date;
  _mois integer;
  _premier date;
  _dernier date;
  _code text;
  _id uuid;
BEGIN
  IF _tenant IS NULL OR NOT public.has_permission(auth.uid(), 'periods.close') THEN
    RAISE EXCEPTION 'Droit requis : gérer les exercices (periods.close)' USING ERRCODE = '42501';
  END IF;
  IF _start IS NULL OR extract(day FROM _start) <> 1 THEN
    RAISE EXCEPTION 'Un exercice commence le premier jour d''un mois' USING ERRCODE = '22023';
  END IF;
  _fin := COALESCE(_end, (_start + interval '12 months - 1 day')::date);
  IF _fin <> (date_trunc('month', _fin) + interval '1 month - 1 day')::date OR _fin <= _start THEN
    RAISE EXCEPTION 'Un exercice se termine le dernier jour d''un mois, après son début' USING ERRCODE = '22023';
  END IF;
  _mois := (extract(year FROM _fin)::int - extract(year FROM _start)::int) * 12
           + extract(month FROM _fin)::int - extract(month FROM _start)::int + 1;

  SELECT min(start_date), max(end_date) INTO _premier, _dernier FROM public.fiscal_years WHERE tenant_id = _tenant;
  IF _premier IS NULL THEN
    IF _mois > 18 THEN
      RAISE EXCEPTION 'Le premier exercice dure au plus 18 mois (AUDCIF, art. 7)' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF _mois <> 12 THEN
      RAISE EXCEPTION 'Un exercice dure 12 mois ; seul le premier peut différer' USING ERRCODE = '22023';
    END IF;
    IF _start <> _dernier + 1 AND _fin <> _premier - 1 THEN
      RAISE EXCEPTION 'Un nouvel exercice suit le dernier (début le %) ou précède le premier (fin le %)',
        to_char(_dernier + 1, 'DD/MM/YYYY'), to_char(_premier - 1, 'DD/MM/YYYY') USING ERRCODE = '22023';
    END IF;
  END IF;

  _code := CASE WHEN extract(year FROM _start) = extract(year FROM _fin) THEN to_char(_start, 'YYYY')
                ELSE to_char(_start, 'YYYY') || '-' || to_char(_fin, 'YYYY') END;
  INSERT INTO public.fiscal_years (tenant_id, code, start_date, end_date, status, created_by)
  VALUES (_tenant, _code, _start, _fin, 'not_open', auth.uid()) RETURNING id INTO _id;
  PERFORM public.fiscal_generate_periods(_id);
  INSERT INTO public.fiscal_calendar_audit (tenant_id, actor_id, action, fiscal_year_code, details)
  VALUES (_tenant, auth.uid(), 'fiscal_year_created', _code,
          jsonb_build_object('start_date', _start, 'end_date', _fin, 'months', _mois));
  RETURN _id;
END $$;

-- Deux exercices ouverts au plus (Sage X3).
CREATE FUNCTION public.open_fiscal_year(_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _fy public.fiscal_years%ROWTYPE;
BEGIN
  IF _tenant IS NULL OR NOT public.has_permission(auth.uid(), 'periods.close') THEN
    RAISE EXCEPTION 'Droit requis : gérer les exercices (periods.close)' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _fy FROM public.fiscal_years WHERE id = _id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Exercice introuvable' USING ERRCODE = '22023'; END IF;
  IF _fy.status <> 'not_open' THEN
    RAISE EXCEPTION 'L''exercice % est déjà ouvert ou clôturé', _fy.code USING ERRCODE = 'QG003';
  END IF;
  IF (SELECT count(*) FROM public.fiscal_years WHERE tenant_id = _tenant AND status = 'open') >= 2 THEN
    RAISE EXCEPTION 'Deux exercices sont déjà ouverts : clôturez le plus ancien avant d''en ouvrir un autre'
      USING ERRCODE = 'QG003';
  END IF;
  UPDATE public.fiscal_years SET status = 'open', opened_at = now() WHERE id = _id;
  INSERT INTO public.fiscal_calendar_audit (tenant_id, actor_id, action, fiscal_year_code)
  VALUES (_tenant, auth.uid(), 'fiscal_year_opened', _fy.code);
END $$;

-- Clôture définitive : toutes les périodes de tous les modules closes, exercices antérieurs
-- déjà clôturés.
CREATE FUNCTION public.close_fiscal_year(_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _fy public.fiscal_years%ROWTYPE;
  _ouvertes integer;
BEGIN
  IF _tenant IS NULL OR NOT public.has_permission(auth.uid(), 'periods.close') THEN
    RAISE EXCEPTION 'Droit requis : gérer les exercices (periods.close)' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _fy FROM public.fiscal_years WHERE id = _id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Exercice introuvable' USING ERRCODE = '22023'; END IF;
  IF _fy.status <> 'open' THEN
    RAISE EXCEPTION 'Seul un exercice ouvert se clôture (% est %)', _fy.code, _fy.status USING ERRCODE = 'QG003';
  END IF;
  IF EXISTS (SELECT 1 FROM public.fiscal_years WHERE tenant_id = _tenant AND start_date < _fy.start_date AND status <> 'closed') THEN
    RAISE EXCEPTION 'Clôturez d''abord les exercices antérieurs' USING ERRCODE = 'QG003';
  END IF;
  SELECT count(*) INTO _ouvertes
    FROM public.fiscal_periods p CROSS JOIN public.fiscal_modules m
   WHERE p.fiscal_year_id = _id
     AND NOT EXISTS (SELECT 1 FROM public.period_locks l WHERE l.tenant_id = _tenant AND l.period = p.code
                       AND l.module = m.code AND l.status = 'closed');
  IF _ouvertes > 0 THEN
    RAISE EXCEPTION 'L''exercice % a encore % période(s) ouverte(s), tous modules confondus', _fy.code, _ouvertes
      USING ERRCODE = 'QG003';
  END IF;
  UPDATE public.fiscal_years SET status = 'closed', closed_at = now(), closed_by = auth.uid() WHERE id = _id;
  INSERT INTO public.fiscal_calendar_audit (tenant_id, actor_id, action, fiscal_year_code)
  VALUES (_tenant, auth.uid(), 'fiscal_year_closed', _fy.code);
END $$;

REVOKE ALL ON FUNCTION public.set_period_status(text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_fiscal_year(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.open_fiscal_year(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_fiscal_year(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_period_status(text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_fiscal_year(date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.open_fiscal_year(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.close_fiscal_year(uuid) TO authenticated, service_role;

-- ─── Reprise : exercices civils ouverts pour les sociétés existantes ───
-- De l'année de la plus ancienne donnée datée (ou de la création de la société) à l'année
-- prochaine, pour ne rien refuser de ce qui s'acceptait hier.
DO $$
DECLARE
  _t record;
  _annee integer;
  _id uuid;
BEGIN
  FOR _t IN
    SELECT t.id,
           LEAST(extract(year FROM t.created_at)::int,
                 COALESCE((SELECT extract(year FROM min(d))::int FROM (
                   SELECT min(entry_date) d FROM public.journal_entries WHERE tenant_id = t.id
                   UNION ALL SELECT min(invoice_date) FROM public.ar_invoices WHERE tenant_id = t.id
                   UNION ALL SELECT min(invoice_date) FROM public.ap_invoices WHERE tenant_id = t.id
                   UNION ALL SELECT min(payment_date) FROM public.payments WHERE tenant_id = t.id
                   UNION ALL SELECT min(movement_date) FROM public.stock_movements WHERE tenant_id = t.id
                   UNION ALL SELECT min(transaction_date) FROM public.bank_transactions WHERE tenant_id = t.id
                   UNION ALL SELECT min(order_date) FROM public.purchase_orders WHERE tenant_id = t.id
                   UNION ALL SELECT min(pay_date) FROM public.payroll_runs WHERE tenant_id = t.id
                   UNION ALL SELECT min(quote_date) FROM public.quotations WHERE tenant_id = t.id
                   UNION ALL SELECT min(order_date) FROM public.sales_orders WHERE tenant_id = t.id
                   UNION ALL SELECT min(delivery_date) FROM public.delivery_notes WHERE tenant_id = t.id
                   UNION ALL SELECT min(to_date(period || '-01', 'YYYY-MM-DD')) FROM public.period_locks WHERE tenant_id = t.id
                 ) x), 9999)) AS premiere
    FROM public.tenants t
  LOOP
    FOR _annee IN _t.premiere .. extract(year FROM current_date)::int + 1 LOOP
      INSERT INTO public.fiscal_years (tenant_id, code, start_date, end_date, status, opened_at)
      VALUES (_t.id, _annee::text, make_date(_annee, 1, 1), make_date(_annee, 12, 31), 'open', now())
      RETURNING id INTO _id;
      PERFORM public.fiscal_generate_periods(_id);
    END LOOP;
  END LOOP;
END $$;
