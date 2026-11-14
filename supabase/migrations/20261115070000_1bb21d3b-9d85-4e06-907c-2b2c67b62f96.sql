-- V58 — Ventes et comptes clients paramétrables (écart G-51 ; règle du propriétaire : aucun
-- paramètre codé en dur, tout paramétrable et désactivable ; même méthode que V57).
--
-- 1. Droits du catalogue au lieu de listes de rôles, attribuables à tout rôle (personnalisé compris),
--    accordés par défaut aux rôles d'avant :
--      customers.manage (créer / modifier un client), customers.delete, ar.invoice (saisir, émettre
--      et modifier les factures clients, leurs lignes et imputations analytiques), ar.settings
--      (paramètres des comptes clients : conditions de paiement, relances, notifications,
--      numérotation, paramètres généraux), sales.settings (paramètres et numérotation des ventes),
--      taxes.manage (codes TVA), sales.export (exports CSV des ventes, réservés jusqu'ici à des rôles
--      écrits dans l'écran).
--    Avant : ar_general_settings, ar_numbering_series et ar_notification_log étaient modifiables par
--    tout membre (« FOR ALL »).
-- 2. Règles métier paramétrables par société (défaut = comportement livré) :
--      sales_settings.credit_control_mode : 'block' (refus sans motif de dépassement), 'warn'
--        (confirmation possible, alerte), 'off' (pas de contrôle) ;
--      sales_settings.block_expired_quotations : devis expiré non transformable en commande (oui) ;
--      ar_general_settings.auto_lettering : lettrage automatique des factures soldées (oui).

-- ─── 1. Droits ───
INSERT INTO public.erp_permission_catalog (code, module, action, label) VALUES
  ('customers.manage', 'customers', 'manage', 'Créer et modifier les fiches clients'),
  ('customers.delete', 'customers', 'delete', 'Supprimer une fiche client'),
  ('ar.invoice', 'ar', 'invoice', 'Saisir, émettre et modifier les factures clients'),
  ('ar.settings', 'ar', 'settings', 'Modifier les paramètres des comptes clients'),
  ('sales.settings', 'sales', 'settings', 'Modifier les paramètres des ventes'),
  ('taxes.manage', 'taxes', 'manage', 'Gérer les codes TVA'),
  ('sales.export', 'sales', 'export', 'Exporter les données des ventes')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
SELECT v.r, v.p FROM (VALUES
  ('admin', 'customers.manage'), ('accountant', 'customers.manage'), ('sales_manager', 'customers.manage'),
  ('sales_rep', 'customers.manage'), ('sales_controller', 'customers.manage'), ('crm_admin', 'customers.manage'),
  ('crm_manager', 'customers.manage'),
  ('admin', 'customers.delete'), ('accountant', 'customers.delete'),
  ('admin', 'ar.invoice'), ('accountant', 'ar.invoice'),
  ('admin', 'ar.settings'), ('accountant', 'ar.settings'),
  ('admin', 'sales.settings'),
  ('admin', 'taxes.manage'),
  ('admin', 'sales.export'), ('sales_manager', 'sales.export'), ('sales_controller', 'sales.export')) AS v(r, p)
 WHERE EXISTS (SELECT 1 FROM public.erp_system_roles s WHERE s.code = v.r)
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, sp.permission_code
  FROM public.erp_roles r JOIN public.erp_system_role_permissions sp ON sp.role_code = r.code
 WHERE sp.permission_code IN ('customers.manage', 'customers.delete', 'ar.invoice', 'ar.settings', 'sales.settings', 'taxes.manage', 'sales.export')
   AND r.is_system
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

-- Clients
DROP POLICY "Création habilitée" ON public.customers;
DROP POLICY "Modification habilitée" ON public.customers;
DROP POLICY "Suppression comptable" ON public.customers;
CREATE POLICY "Création habilitée" ON public.customers FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'customers.manage'));
CREATE POLICY "Modification habilitée" ON public.customers FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'customers.manage'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Suppression habilitée" ON public.customers FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'customers.delete'));

-- Factures clients : lignes et imputations analytiques
DROP POLICY "Gestion comptable" ON public.ar_invoice_lines;
CREATE POLICY "Saisie habilitée" ON public.ar_invoice_lines FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'ar.invoice'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'ar.invoice'));
DROP POLICY "Gestion comptable" ON public.ar_invoice_analytics;
CREATE POLICY "Saisie habilitée" ON public.ar_invoice_analytics FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'ar.invoice'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'ar.invoice'));

-- Paramètres des comptes clients
DROP POLICY "Gestion comptable" ON public.ar_payment_terms;
CREATE POLICY "Paramétrage habilité" ON public.ar_payment_terms FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'ar.settings'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'ar.settings'));
DROP POLICY "Gestion comptable" ON public.ar_dunning_rules;
CREATE POLICY "Paramétrage habilité" ON public.ar_dunning_rules FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'ar.settings'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'ar.settings'));
DROP POLICY "Gestion comptable" ON public.ar_notification_rules;
CREATE POLICY "Paramétrage habilité" ON public.ar_notification_rules FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'ar.settings'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'ar.settings'));
DROP POLICY "Tenant isolation" ON public.ar_general_settings;
CREATE POLICY "Lecture société" ON public.ar_general_settings FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Paramétrage habilité" ON public.ar_general_settings FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'ar.settings'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'ar.settings'));
DROP POLICY "Tenant isolation" ON public.ar_numbering_series;
CREATE POLICY "Lecture société" ON public.ar_numbering_series FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Paramétrage habilité" ON public.ar_numbering_series FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'ar.settings'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'ar.settings'));
-- Journal des notifications : lecture pour la société, écrit par les fonctions.
DROP POLICY "Tenant isolation" ON public.ar_notification_log;
CREATE POLICY "Lecture société" ON public.ar_notification_log FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

-- Paramètres et numérotation des ventes, codes TVA
DROP POLICY "Tenant admin update" ON public.sales_settings;
CREATE POLICY "Paramétrage habilité" ON public.sales_settings FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'sales.settings'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Création habilitée" ON public.sales_settings FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'sales.settings'));
DROP POLICY "Tenant admin update" ON public.sales_numbering_series;
CREATE POLICY "Paramétrage habilité" ON public.sales_numbering_series FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'sales.settings'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));
DROP POLICY "Administrateur de la société" ON public.tax_codes;
CREATE POLICY "Gestion habilitée" ON public.tax_codes FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'taxes.manage'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'taxes.manage'));

-- ─── 2. Règles paramétrables ───
ALTER TABLE public.sales_settings
  ADD COLUMN credit_control_mode text NOT NULL DEFAULT 'block' CHECK (credit_control_mode IN ('block', 'warn', 'off')),
  ADD COLUMN block_expired_quotations boolean NOT NULL DEFAULT true;
ALTER TABLE public.ar_general_settings
  ADD COLUMN auto_lettering boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.sales_setting(_tenant uuid)
 RETURNS public.sales_settings
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _s public.sales_settings%ROWTYPE;
BEGIN
  SELECT * INTO _s FROM public.sales_settings WHERE tenant_id = _tenant;
  IF NOT FOUND THEN
    _s.tenant_id := _tenant; _s.credit_control_mode := 'block'; _s.block_expired_quotations := true;
  END IF;
  RETURN _s;
END $function$;
REVOKE ALL ON FUNCTION public.sales_setting(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_setting(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.ar_setting(_tenant uuid)
 RETURNS public.ar_general_settings
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _s public.ar_general_settings%ROWTYPE;
BEGIN
  SELECT * INTO _s FROM public.ar_general_settings WHERE tenant_id = _tenant;
  IF NOT FOUND THEN
    _s.tenant_id := _tenant; _s.auto_numbering := true; _s.auto_lettering := true;
  END IF;
  RETURN _s;
END $function$;
REVOKE ALL ON FUNCTION public.ar_setting(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ar_setting(uuid) TO authenticated;

-- Facture client : droit ar.invoice
CREATE OR REPLACE FUNCTION public.guard_ar_invoice_lifecycle()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon', 'qerp_api') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF NOT public.has_permission(auth.uid(), 'ar.invoice') THEN
    RAISE EXCEPTION 'Droit insuffisant : %', (SELECT label FROM public.erp_permission_catalog WHERE code = 'ar.invoice')
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('draft', 'sent') THEN
      RAISE EXCEPTION 'Une facture client se crée en brouillon ou émise (statut demandé : %)', NEW.status
        USING ERRCODE = 'QG009';
    END IF;
    IF COALESCE(NEW.amount_paid, 0) <> 0 OR NEW.journal_entry_id IS NOT NULL THEN
      RAISE EXCEPTION 'Le réglé et l''écriture d''une facture sont calculés par la base' USING ERRCODE = 'QG009';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'La facture % est émise : elle ne se modifie plus et ne se supprime pas ; la corriger par un avoir',
      OLD.invoice_number USING ERRCODE = 'QG009';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF NEW.status NOT IN ('draft', 'sent') THEN
    RAISE EXCEPTION 'Une facture en brouillon ne peut qu''être émise (statut demandé : %)', NEW.status
      USING ERRCODE = 'QG009';
  END IF;
  IF NEW.amount_paid IS DISTINCT FROM OLD.amount_paid OR NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'Le réglé, l''écriture et la société d''une facture ne se saisissent pas' USING ERRCODE = 'QG009';
  END IF;
  RETURN NEW;
END; $function$;

-- Limite de crédit : bloquer, avertir ou ne pas contrôler
CREATE OR REPLACE FUNCTION public.check_customer_credit_on_so()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _limit numeric; _outstanding numeric; _name text; _order numeric;
  _mode text := (public.sales_setting(NEW.tenant_id)).credit_control_mode;
BEGIN
  IF _mode = 'off' THEN RETURN NEW; END IF;
  IF NEW.status <> 'confirmed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'confirmed' THEN RETURN NEW; END IF;
  SELECT credit_limit, name INTO _limit, _name FROM public.customers WHERE id = NEW.customer_id;
  IF _limit IS NULL OR _limit <= 0 THEN RETURN NEW; END IF;
  _outstanding := public.customer_credit_exposure(NEW.customer_id);
  _order := COALESCE(NEW.total, 0) + COALESCE(NEW.tax_amount, 0);
  IF _outstanding + _order > _limit THEN
    IF NEW.credit_override_by IS NULL AND _mode = 'block' THEN
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

-- Devis expiré : refus paramétrable
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

  INSERT INTO public.sales_orders (tenant_id, so_number, quotation_id, customer_id, order_date, total, status, created_by)
  VALUES (_tenant, '', _q.id, _q.customer_id, COALESCE(_order_date, CURRENT_DATE), 0, 'draft', auth.uid())
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
    VALUES (_so_id, _ql.item_id, _ql.description, _qty, _ql.unit_price, _ql.discount_pct,
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

-- Lettrage automatique paramétrable
CREATE OR REPLACE FUNCTION public.on_ar_invoice_lettering()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _code text;
BEGIN
  IF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' AND (public.ar_setting(NEW.tenant_id)).auto_lettering THEN
    PERFORM public.letter_ar_invoice(NEW.id);
  ELSIF OLD.status = 'paid' AND NEW.status IS DISTINCT FROM 'paid' THEN
    -- Délettrage : la facture redevient due (annulation d'encaissement).
    DELETE FROM public.ar_letterings WHERE invoice_id = NEW.id RETURNING code INTO _code;
    IF _code IS NOT NULL THEN
      UPDATE public.journal_lines l SET lettering_code = NULL
        FROM public.journal_entries e
       WHERE e.id = l.entry_id AND e.tenant_id = NEW.tenant_id AND l.lettering_code = _code;
    END IF;
  END IF;
  RETURN NEW;
END; $function$;

SELECT public.install_tenant_isolation_triggers() AS tables_protegees;
