-- V70 — Trésorerie reliée aux règlements (lot T1, écarts G-16 et G-38 ; audit docs/audit-erp/13).
--
-- Constats (audit du 14 nov. 2026) : un règlement ne disait pas sur quel compte il passait (rôle BANK
-- unique, espèces comprises), aucun mouvement de trésorerie n'était créé (0 mouvement relié à un
-- paiement), le solde d'un compte bancaire était saisi à la main, un mouvement saisi n'avait pas
-- d'écriture, et les tables de banque étaient ouvertes en écriture à tout membre (FOR ALL).
--
-- Comme SAP (un compte général par compte bancaire « house bank », journal de caisse) et Sage (un
-- journal de banque par compte, caisse) :
-- 1. Comptes de trésorerie typés : banque (52), caisse (57), monnaie électronique (55, SYSCOHADA révisé
--    2017 : Orange Money, Wave, Moov…), chacun relié à SON compte général de classe 5, solde d'ouverture
--    daté, compte par défaut par type. Le solde est calculé (ouverture + mouvements), plus saisi.
-- 2. Règlement (clients, fournisseurs), acompte, remboursement : compte de trésorerie choisi, sinon le
--    compte par défaut du type correspondant au mode de paiement ; l'écriture passe sur SON compte
--    général et le mouvement de trésorerie est créé (rapprochable avec le relevé). Sans compte de
--    trésorerie : rôle selon le mode (CASH, MOBILE_MONEY, à défaut BANK), comme avant. Paramètre
--    « compte de trésorerie obligatoire » (désactivé par défaut). Une annulation reprend le compte.
-- 3. Mouvement manuel (frais, agios, intérêts) et virement entre comptes de la société : écriture BQ.
-- 4. Droits : treasury.manage_accounts (comptes), treasury.create_txn (mouvements), import_statement,
--    match, validate_recon (rapprochement validé figé), treasury.settings (nouveau, catalogue 84).
-- Erreurs métier : QG023.

-- ─── Droit ───
INSERT INTO public.erp_permission_catalog (code, module, action, label)
VALUES ('treasury.settings', 'treasury', 'settings', 'Modifier les paramètres de trésorerie')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
SELECT v.r, 'treasury.settings' FROM (VALUES ('admin'), ('treasury_manager')) AS v(r)
 WHERE EXISTS (SELECT 1 FROM public.erp_system_roles WHERE code = v.r)
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, sp.permission_code FROM public.erp_roles r JOIN public.erp_system_role_permissions sp ON sp.role_code = r.code
 WHERE sp.permission_code = 'treasury.settings' AND r.is_system
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

-- ─── Rôles CASH et MOBILE_MONEY ───
INSERT INTO public.posting_roles (code, label, module, description, expected_prefixes) VALUES
  ('CASH', 'Caisse', 'TRE', 'Encaissements et décaissements en espèces sans compte de caisse choisi', ARRAY['57']),
  ('MOBILE_MONEY', 'Monnaie électronique', 'TRE', 'Règlements par mobile money sans compte choisi (Orange Money, Wave, Moov…)', ARRAY['55'])
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.framework_reference_accounts (framework_code, code, name, account_type) VALUES
  ('SYSCOHADA_REVISE', '55', 'Instruments de monnaie électronique', 'asset'),
  ('SYSCOHADA_REVISE', '552', 'Monnaie électronique — téléphone portable', 'asset'),
  ('SYSCOHADA_REVISE', '585', 'Virements de fonds', 'asset'),
  ('PCG_FR', '517', 'Autres organismes financiers', 'asset')
ON CONFLICT (framework_code, code) DO NOTHING;
INSERT INTO public.framework_role_expectations (framework_code, role_code, prefixes) VALUES
  ('SYSCOHADA_REVISE', 'CASH', ARRAY['57']), ('SYSCOHADA_REVISE', 'MOBILE_MONEY', ARRAY['55']),
  ('PCG_FR', 'CASH', ARRAY['53']), ('PCG_FR', 'MOBILE_MONEY', ARRAY['51'])
ON CONFLICT (framework_code, role_code) DO NOTHING;
INSERT INTO public.accounting_framework_accounts (framework_code, code, name, account_type)
SELECT v.f, v.c, v.n, 'asset' FROM (VALUES ('SYSCOHADA_REVISE', '571', 'Caisse siège social'), ('SYSCOHADA_REVISE', '552', 'Monnaie électronique — téléphone portable'),
                                           ('PCG_FR', '530', 'Caisse'), ('PCG_FR', '517', 'Autres organismes financiers')) AS v(f, c, n)
 WHERE EXISTS (SELECT 1 FROM public.accounting_frameworks WHERE code = v.f)
   AND NOT EXISTS (SELECT 1 FROM public.accounting_framework_accounts a WHERE a.framework_code = v.f AND a.code = v.c);
INSERT INTO public.accounting_framework_role_defaults (framework_code, role_code, account_code)
SELECT v.f, v.r, v.c FROM (VALUES ('SYSCOHADA_REVISE', 'CASH', '571'), ('SYSCOHADA_REVISE', 'MOBILE_MONEY', '552'),
                                  ('PCG_FR', 'CASH', '530'), ('PCG_FR', 'MOBILE_MONEY', '517')) AS v(f, r, c)
 WHERE EXISTS (SELECT 1 FROM public.accounting_frameworks WHERE code = v.f)
   AND NOT EXISTS (SELECT 1 FROM public.accounting_framework_role_defaults d WHERE d.framework_code = v.f AND d.role_code = v.r);
-- Sociétés ayant appliqué un référentiel : comptes et rôles ajoutés (jamais de choix écrasé).
INSERT INTO public.gl_accounts (tenant_id, code, name, account_type)
SELECT s.tenant_id, a.code, a.name, a.account_type
  FROM public.tenant_accounting_settings s
  JOIN public.accounting_framework_role_defaults d ON d.framework_code = s.framework_code AND d.role_code IN ('CASH', 'MOBILE_MONEY')
  JOIN public.accounting_framework_accounts a ON a.framework_code = d.framework_code AND a.code = d.account_code
ON CONFLICT (tenant_id, code) DO NOTHING;
INSERT INTO public.tenant_posting_accounts (tenant_id, role_code, gl_account_id)
SELECT s.tenant_id, d.role_code, g.id
  FROM public.tenant_accounting_settings s
  JOIN public.accounting_framework_role_defaults d ON d.framework_code = s.framework_code AND d.role_code IN ('CASH', 'MOBILE_MONEY')
  JOIN public.gl_accounts g ON g.tenant_id = s.tenant_id AND g.code = d.account_code AND g.is_active
ON CONFLICT (tenant_id, role_code) DO NOTHING;

-- ─── Paramètre ───
ALTER TABLE public.treasury_settings ADD COLUMN require_treasury_account boolean NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION public.treasury_require_account(_tenant uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT s.require_treasury_account FROM public.treasury_settings s WHERE s.tenant_id = _tenant), false)
$function$;
REVOKE ALL ON FUNCTION public.treasury_require_account(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.treasury_require_account(uuid) TO authenticated;

-- ─── Comptes de trésorerie ───
UPDATE public.bank_accounts SET account_type = 'bank' WHERE account_type IS NULL OR account_type NOT IN ('bank', 'cash', 'mobile_money');
ALTER TABLE public.bank_accounts
  ALTER COLUMN account_type SET DEFAULT 'bank',
  ALTER COLUMN account_type SET NOT NULL,
  ADD CONSTRAINT bank_accounts_account_type_check CHECK (account_type IN ('bank', 'cash', 'mobile_money')),
  ADD COLUMN opening_balance numeric(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN opening_date date,
  ADD COLUMN is_default boolean NOT NULL DEFAULT false;
UPDATE public.bank_accounts b SET
  opening_balance = COALESCE(b.balance, 0) - COALESCE((SELECT sum(t.amount) FROM public.bank_transactions t WHERE t.bank_account_id = b.id), 0),
  opening_date = COALESCE((SELECT min(t.transaction_date) FROM public.bank_transactions t WHERE t.bank_account_id = b.id), b.created_at::date);
CREATE UNIQUE INDEX bank_accounts_one_default ON public.bank_accounts (tenant_id, account_type) WHERE is_default AND is_active;
CREATE UNIQUE INDEX bank_accounts_one_gl ON public.bank_accounts (tenant_id, gl_account_id) WHERE gl_account_id IS NOT NULL;

ALTER TABLE public.bank_transactions
  ADD COLUMN source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'payment', 'advance', 'refund', 'transfer', 'statement')),
  ADD COLUMN journal_entry_id uuid REFERENCES public.journal_entries(id),
  ADD COLUMN counterpart_account_id uuid REFERENCES public.gl_accounts(id),
  ADD COLUMN created_by uuid;
UPDATE public.bank_transactions SET source = 'payment' WHERE payment_id IS NOT NULL;
ALTER TABLE public.payments ADD COLUMN bank_account_id uuid REFERENCES public.bank_accounts(id);
CREATE INDEX payments_bank_account ON public.payments (bank_account_id) WHERE bank_account_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.treasury_kind_for_method(_method text)
 RETURNS text LANGUAGE sql IMMUTABLE
AS $function$ SELECT CASE _method WHEN 'cash' THEN 'cash' WHEN 'mobile_money' THEN 'mobile_money' ELSE 'bank' END $function$;
CREATE OR REPLACE FUNCTION public.treasury_role_for_method(_method text)
 RETURNS text LANGUAGE sql IMMUTABLE
AS $function$ SELECT CASE _method WHEN 'cash' THEN 'CASH' WHEN 'mobile_money' THEN 'MOBILE_MONEY' ELSE 'BANK' END $function$;

-- Compte de trésorerie d'un mouvement : celui donné (de la société, actif), sinon le compte par défaut
-- du type correspondant au mode de paiement ; NULL si aucun (refus si la société l'exige).
CREATE OR REPLACE FUNCTION public.resolve_treasury_account(_tenant uuid, _given uuid, _method text)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _id uuid;
BEGIN
  IF _given IS NOT NULL THEN
    SELECT id INTO _id FROM public.bank_accounts WHERE id = _given AND tenant_id = _tenant AND is_active;
    IF _id IS NULL THEN RAISE EXCEPTION 'Compte de trésorerie introuvable ou inactif dans la société' USING ERRCODE = 'QG023'; END IF;
    RETURN _id;
  END IF;
  SELECT id INTO _id FROM public.bank_accounts
   WHERE tenant_id = _tenant AND is_active AND is_default AND account_type = public.treasury_kind_for_method(_method);
  IF _id IS NULL AND public.treasury_require_account(_tenant) THEN
    RAISE EXCEPTION 'Compte de trésorerie obligatoire : choisir le compte (banque, caisse ou mobile money) du règlement'
      USING ERRCODE = 'QG023', HINT = 'Paramètre « Compte de trésorerie obligatoire » (Trésorerie → Paramètres), ou définir un compte par défaut.';
  END IF;
  RETURN _id;
END $function$;
REVOKE ALL ON FUNCTION public.resolve_treasury_account(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- Compte général d'un mouvement de trésorerie : celui du compte de trésorerie, sinon le rôle du mode
-- de paiement (CASH, MOBILE_MONEY), à défaut BANK. _strict : QG001 si rien n'est paramétré.
CREATE OR REPLACE FUNCTION public.treasury_gl_account(_tenant uuid, _account uuid, _method text, _strict boolean DEFAULT true)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _gl uuid; _role text := public.treasury_role_for_method(_method);
BEGIN
  IF _account IS NOT NULL THEN
    SELECT b.gl_account_id INTO _gl FROM public.bank_accounts b JOIN public.gl_accounts g ON g.id = b.gl_account_id AND g.is_active
     WHERE b.id = _account AND b.tenant_id = _tenant;
    IF _gl IS NULL THEN
      RAISE EXCEPTION 'Le compte de trésorerie n''est relié à aucun compte général actif' USING ERRCODE = 'QG023',
        HINT = 'Trésorerie → Données de base : renseigner son compte comptable.';
    END IF;
    RETURN _gl;
  END IF;
  _gl := COALESCE(public.posting_account(_tenant, _role), public.posting_account(_tenant, 'BANK'));
  IF _gl IS NULL AND _strict THEN RETURN public.require_posting_account(_tenant, _role); END IF;
  RETURN _gl;
END $function$;
REVOKE ALL ON FUNCTION public.treasury_gl_account(uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;

-- Mouvement de trésorerie (montant signé : + entrée, − sortie). Rien si aucun compte de trésorerie.
CREATE OR REPLACE FUNCTION public.record_treasury_line(_tenant uuid, _account uuid, _date date, _amount numeric, _source text,
                                                       _description text, _reference text, _entry uuid, _payment uuid, _counterpart uuid DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _id uuid;
BEGIN
  IF _account IS NULL OR _amount = 0 THEN RETURN NULL; END IF;
  INSERT INTO public.bank_transactions (tenant_id, bank_account_id, transaction_date, description, amount, transaction_type, reference,
                                        payment_id, source, journal_entry_id, counterpart_account_id, created_by)
  VALUES (_tenant, _account, _date, left(_description, 500), _amount, CASE WHEN _amount > 0 THEN 'credit' ELSE 'debit' END,
          NULLIF(btrim(_reference), ''), _payment, _source, _entry, _counterpart, auth.uid())
  RETURNING id INTO _id;
  RETURN _id;
END $function$;
REVOKE ALL ON FUNCTION public.record_treasury_line(uuid, uuid, date, numeric, text, text, text, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Solde = ouverture + mouvements (jamais saisi).
CREATE OR REPLACE FUNCTION public.refresh_bank_account_balance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _ids uuid[];
BEGIN
  _ids := ARRAY[CASE WHEN TG_OP <> 'INSERT' THEN OLD.bank_account_id END, CASE WHEN TG_OP <> 'DELETE' THEN NEW.bank_account_id END];
  UPDATE public.bank_accounts b SET balance = b.opening_balance + COALESCE((SELECT sum(t.amount) FROM public.bank_transactions t WHERE t.bank_account_id = b.id), 0)
   WHERE b.id = ANY (_ids);
  RETURN NULL;
END $function$;
CREATE TRIGGER trg_refresh_bank_account_balance AFTER INSERT OR UPDATE OR DELETE ON public.bank_transactions
  FOR EACH ROW EXECUTE FUNCTION public.refresh_bank_account_balance();

-- Garde des comptes de trésorerie (rôles applicatifs).
CREATE OR REPLACE FUNCTION public.guard_bank_account()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  _app boolean := current_user IN ('authenticated', 'anon', 'qerp_api');
  _g public.gl_accounts%ROWTYPE; _prefixes text[]; _moves boolean := false;
  _role text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.bank_transactions WHERE bank_account_id = OLD.id) OR EXISTS (SELECT 1 FROM public.payments WHERE bank_account_id = OLD.id) THEN
      RAISE EXCEPTION 'Compte de trésorerie mouvementé : il ne se supprime pas (le désactiver)' USING ERRCODE = 'QG023';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN _moves := EXISTS (SELECT 1 FROM public.bank_transactions WHERE bank_account_id = OLD.id); END IF;
  IF _app THEN
    IF NEW.gl_account_id IS NULL THEN
      RAISE EXCEPTION 'Compte comptable obligatoire : chaque compte de trésorerie a son compte général (classe 5)' USING ERRCODE = 'QG023';
    END IF;
    SELECT * INTO _g FROM public.gl_accounts WHERE id = NEW.gl_account_id AND tenant_id = NEW.tenant_id;
    IF _g.id IS NULL OR NOT _g.is_active OR _g.is_header THEN
      RAISE EXCEPTION 'Compte comptable invalide : compte actif et imputable de la société requis' USING ERRCODE = 'QG023';
    END IF;
    _role := CASE NEW.account_type WHEN 'cash' THEN 'CASH' WHEN 'mobile_money' THEN 'MOBILE_MONEY' ELSE 'BANK' END;
    SELECT x.prefixes INTO _prefixes FROM public.framework_role_expectations x
     WHERE x.framework_code = public.chart_framework(NEW.tenant_id) AND x.role_code = _role;
    IF _prefixes IS NOT NULL AND NOT EXISTS (SELECT 1 FROM unnest(_prefixes) p WHERE _g.code LIKE p || '%') THEN
      RAISE EXCEPTION 'Compte comptable % : un compte % attend un compte %x du référentiel', _g.code,
        CASE NEW.account_type WHEN 'cash' THEN 'de caisse' WHEN 'mobile_money' THEN 'de monnaie électronique' ELSE 'bancaire' END,
        array_to_string(_prefixes, 'x ou ') USING ERRCODE = 'QG023';
    END IF;
    IF NEW.currency IS NULL OR NEW.currency !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'Devise : code ISO à 3 lettres (XOF, EUR…)' USING ERRCODE = 'QG023'; END IF;
    IF _moves AND (NEW.gl_account_id IS DISTINCT FROM OLD.gl_account_id OR NEW.opening_balance IS DISTINCT FROM OLD.opening_balance
                   OR NEW.opening_date IS DISTINCT FROM OLD.opening_date OR NEW.currency IS DISTINCT FROM OLD.currency) THEN
      RAISE EXCEPTION 'Compte de trésorerie mouvementé : compte comptable, devise et solde d''ouverture sont figés' USING ERRCODE = 'QG023';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.is_active AND NOT EXISTS (
       SELECT 1 FROM public.bank_accounts WHERE tenant_id = NEW.tenant_id AND account_type = NEW.account_type AND is_default AND is_active) THEN
    NEW.is_default := true;
  END IF;
  IF NOT NEW.is_active THEN NEW.is_default := false; END IF;
  -- Solde calculé, jamais saisi.
  NEW.balance := NEW.opening_balance + COALESCE((SELECT sum(t.amount) FROM public.bank_transactions t WHERE t.bank_account_id = NEW.id), 0);
  RETURN NEW;
END $function$;
CREATE TRIGGER trg_guard_bank_account BEFORE INSERT OR UPDATE OR DELETE ON public.bank_accounts
  FOR EACH ROW EXECUTE FUNCTION public.guard_bank_account();

-- Désigner un compte par défaut (un seul par type).
CREATE OR REPLACE FUNCTION public.set_default_treasury_account(_account uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid()); _b public.bank_accounts%ROWTYPE;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'treasury.manage_accounts') THEN RAISE EXCEPTION 'Droit insuffisant : gérer les comptes de trésorerie' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _b FROM public.bank_accounts WHERE id = _account AND tenant_id = _tenant AND is_active;
  IF _b.id IS NULL THEN RAISE EXCEPTION 'Compte de trésorerie introuvable ou inactif' USING ERRCODE = 'QG023'; END IF;
  UPDATE public.bank_accounts SET is_default = false WHERE tenant_id = _tenant AND account_type = _b.account_type AND is_default AND id <> _account;
  UPDATE public.bank_accounts SET is_default = true WHERE id = _account;
END $function$;
REVOKE ALL ON FUNCTION public.set_default_treasury_account(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_default_treasury_account(uuid) TO authenticated;

-- ─── Règlements : compte de trésorerie et mouvement ───
CREATE OR REPLACE FUNCTION public.assign_payment_treasury()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.payment_type NOT IN ('ar_receipt', 'ap_payment') THEN
    NEW.bank_account_id := NULL;   -- imputations d'avoir ou d'acompte : aucun flux de trésorerie
  ELSIF NEW.reversal_of IS NOT NULL THEN
    SELECT p.bank_account_id INTO NEW.bank_account_id FROM public.payments p WHERE p.id = NEW.reversal_of;
  ELSE
    NEW.bank_account_id := public.resolve_treasury_account(NEW.tenant_id, NEW.bank_account_id, NEW.payment_method);
  END IF;
  RETURN NEW;
END $function$;
CREATE TRIGGER trg_assign_payment_treasury BEFORE INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.assign_payment_treasury();

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
    CASE WHEN NEW.payment_type = 'ar_receipt' THEN NEW.amount ELSE -NEW.amount END, 'payment',
    CASE WHEN NEW.reversal_of IS NOT NULL THEN 'Annulation — ' ELSE '' END || _label, NEW.reference, _entry, NEW.id);
  RETURN NULL;
END $function$;
CREATE TRIGGER trg_payment_treasury_line AFTER INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.payment_treasury_line();

-- ─── Sécurité des tables de trésorerie (G-38) ───
DROP POLICY "Tenant isolation" ON public.bank_accounts;
CREATE POLICY "Lecture société" ON public.bank_accounts FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Gestion habilitée" ON public.bank_accounts FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'treasury.manage_accounts'));
CREATE POLICY "Modification habilitée" ON public.bank_accounts FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'treasury.manage_accounts'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'treasury.manage_accounts'));
CREATE POLICY "Suppression habilitée" ON public.bank_accounts FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'treasury.manage_accounts'));

DROP POLICY "Tenant isolation" ON public.bank_transactions;
CREATE POLICY "Lecture société" ON public.bank_transactions FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON public.bank_transactions FROM authenticated, anon;

DROP POLICY tenant_bank_statements ON public.bank_statements;
CREATE POLICY "Lecture société" ON public.bank_statements FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Import habilité" ON public.bank_statements FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'treasury.import_statement'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'treasury.import_statement'));
DROP POLICY tenant_bank_statement_lines ON public.bank_statement_lines;
CREATE POLICY "Lecture société" ON public.bank_statement_lines FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Import habilité" ON public.bank_statement_lines FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'treasury.import_statement'));
CREATE POLICY "Rapprochement habilité" ON public.bank_statement_lines FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND (public.has_permission(auth.uid(), 'treasury.match') OR public.has_permission(auth.uid(), 'treasury.import_statement')))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND (public.has_permission(auth.uid(), 'treasury.match') OR public.has_permission(auth.uid(), 'treasury.import_statement')));
CREATE POLICY "Suppression habilitée" ON public.bank_statement_lines FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'treasury.import_statement') AND matched_transaction_id IS NULL);

-- Ligne de relevé : montant, date et libellé figés ; seul le rapprochement change, par un habilité.
CREATE OR REPLACE FUNCTION public.guard_bank_statement_line()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon', 'qerp_api') THEN
    IF NEW.amount IS DISTINCT FROM OLD.amount OR NEW.line_date IS DISTINCT FROM OLD.line_date OR NEW.description IS DISTINCT FROM OLD.description
       OR NEW.statement_id IS DISTINCT FROM OLD.statement_id THEN
      RAISE EXCEPTION 'Ligne de relevé : montant, date et libellé ne se modifient pas (réimporter le relevé)' USING ERRCODE = 'QG023';
    END IF;
    IF NEW.matched_transaction_id IS DISTINCT FROM OLD.matched_transaction_id AND NOT public.has_permission(auth.uid(), 'treasury.match') THEN
      RAISE EXCEPTION 'Droit insuffisant : rapprocher les relevés' USING ERRCODE = '42501';
    END IF;
    IF NEW.matched_transaction_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.bank_transactions t JOIN public.bank_statements s ON s.id = NEW.statement_id
          WHERE t.id = NEW.matched_transaction_id AND t.bank_account_id = s.bank_account_id) THEN
      RAISE EXCEPTION 'Rapprochement refusé : le mouvement n''appartient pas au compte du relevé' USING ERRCODE = 'QG023';
    END IF;
  END IF;
  RETURN NEW;
END $function$;
CREATE TRIGGER trg_guard_bank_statement_line BEFORE UPDATE ON public.bank_statement_lines
  FOR EACH ROW EXECUTE FUNCTION public.guard_bank_statement_line();
ALTER FUNCTION public.trg_bsl_match_sync() SECURITY DEFINER;
ALTER FUNCTION public.trg_bank_recon_validated() SECURITY DEFINER;

DROP POLICY tenant_bank_reconciliations ON public.bank_reconciliations;
CREATE POLICY "Lecture société" ON public.bank_reconciliations FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Rapprochement habilité" ON public.bank_reconciliations FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND (public.has_permission(auth.uid(), 'treasury.match') OR public.has_permission(auth.uid(), 'treasury.validate_recon')))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND (public.has_permission(auth.uid(), 'treasury.match') OR public.has_permission(auth.uid(), 'treasury.validate_recon')));
CREATE OR REPLACE FUNCTION public.guard_bank_reconciliation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon', 'qerp_api') THEN
    IF TG_OP <> 'INSERT' AND OLD.status = 'validated' THEN
      RAISE EXCEPTION 'Rapprochement validé : il est figé' USING ERRCODE = 'QG023';
    END IF;
    IF TG_OP <> 'DELETE' AND NEW.status = 'validated' THEN
      IF NOT public.has_permission(auth.uid(), 'treasury.validate_recon') THEN
        RAISE EXCEPTION 'Droit insuffisant : valider un rapprochement bancaire' USING ERRCODE = '42501';
      END IF;
      NEW.validated_by := auth.uid();
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $function$;
CREATE TRIGGER trg_guard_bank_reconciliation BEFORE INSERT OR UPDATE OR DELETE ON public.bank_reconciliations
  FOR EACH ROW EXECUTE FUNCTION public.guard_bank_reconciliation();

DROP POLICY tenant_treasury_settings ON public.treasury_settings;
CREATE POLICY "Lecture société" ON public.treasury_settings FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Paramétrage habilité" ON public.treasury_settings FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'treasury.settings'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'treasury.settings'));

-- ─── Règlements, acomptes, remboursements : compte de trésorerie ───
DROP FUNCTION public.record_settlement(text, uuid, date, text, text, jsonb);
CREATE OR REPLACE FUNCTION public.record_settlement(_kind text, _party_id uuid, _payment_date date, _payment_method text, _reference text, _allocations jsonb, _bank_account_id uuid DEFAULT NULL)
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

    IF _kind = 'ar' THEN
      SELECT invoice_number, customer_id, status, NULL, total - amount_paid
        INTO _number, _party, _status, _approval, _outstanding
        FROM public.ar_invoices WHERE id = _invoice AND tenant_id = _tenant FOR UPDATE;
    ELSE
      SELECT invoice_number, supplier_id, status, approval_status, total - amount_paid
        INTO _number, _party, _status, _approval, _outstanding
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
    IF _amount IS NULL OR _amount <= 0 THEN
      RAISE EXCEPTION 'Montant imputé invalide sur la facture %', _number USING ERRCODE = 'QG005';
    END IF;
    IF _amount > _outstanding THEN
      RAISE EXCEPTION 'Facture % : % imputé pour un restant dû de %', _number, _amount, _outstanding USING ERRCODE = 'QG005';
    END IF;

    INSERT INTO public.payments (tenant_id, payment_type, ar_invoice_id, ap_invoice_id, amount, payment_date,
                                 payment_method, reference, created_by, bank_account_id)
    VALUES (_tenant, CASE WHEN _kind = 'ar' THEN 'ar_receipt' ELSE 'ap_payment' END,
            CASE WHEN _kind = 'ar' THEN _invoice END, CASE WHEN _kind = 'ap' THEN _invoice END,
            _amount, COALESCE(_payment_date, CURRENT_DATE), COALESCE(NULLIF(_payment_method, ''), 'bank_transfer'),
            NULLIF(btrim(_reference), ''), auth.uid(), _bank_account_id)
    RETURNING id INTO _id;
    _ids := _ids || _id;
  END LOOP;
  RETURN _ids;
END $function$;
REVOKE ALL ON FUNCTION public.record_settlement(text, uuid, date, text, text, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_settlement(text, uuid, date, text, text, jsonb, uuid) TO authenticated;

DROP FUNCTION public.record_customer_advance(uuid, date, text, text, numeric, uuid);
CREATE OR REPLACE FUNCTION public.record_customer_advance(_customer_id uuid, _received_date date, _payment_method text, _reference text, _amount numeric, _sales_order_id uuid DEFAULT NULL::uuid, _bank_account_id uuid DEFAULT NULL)
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
    public.treasury_gl_account(_tenant, _treso, _payment_method), public.require_posting_account(_tenant, 'CUSTOMER_ADVANCE'), _amount);
  PERFORM public.record_treasury_line(_tenant, _treso, _date, _amount, 'advance', 'Acompte ' || _number || ' — ' || _client,
    COALESCE(NULLIF(btrim(_reference), ''), _number), _entry, NULL);

  INSERT INTO public.ar_customer_advances (id, tenant_id, advance_number, customer_id, sales_order_id, received_date, amount,
                                          payment_method, reference, journal_entry_id, created_by)
  VALUES (_id, _tenant, _number, _customer_id, _sales_order_id, _date, _amount, COALESCE(NULLIF(btrim(_payment_method), ''), 'bank_transfer'),
          NULLIF(btrim(_reference), ''), _entry, auth.uid());
  RETURN _id;
END; $function$;
REVOKE ALL ON FUNCTION public.record_customer_advance(uuid, date, text, text, numeric, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_customer_advance(uuid, date, text, text, numeric, uuid, uuid) TO authenticated;

DROP FUNCTION public.refund_customer_credit(text, uuid, numeric, date, text, text);
CREATE OR REPLACE FUNCTION public.refund_customer_credit(_source_type text, _source_id uuid, _amount numeric, _refund_date date DEFAULT CURRENT_DATE, _payment_method text DEFAULT 'bank_transfer'::text, _reference text DEFAULT NULL::text, _bank_account_id uuid DEFAULT NULL)
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
      public.require_posting_account(_tenant, 'CUSTOMER_ADVANCE'), public.treasury_gl_account(_tenant, _treso, _payment_method), _amount);
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
      public.require_posting_account(_tenant, 'AR_RECEIVABLE'), public.treasury_gl_account(_tenant, _treso, _payment_method), _amount);
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
REVOKE ALL ON FUNCTION public.refund_customer_credit(text, uuid, numeric, date, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refund_customer_credit(text, uuid, numeric, date, text, text, uuid) TO authenticated;

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
    _payable := public.posting_account(NEW.tenant_id, 'AP_PAYABLE');
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
    _ar   := public.posting_account(NEW.tenant_id, 'AR_RECEIVABLE');

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

-- ─── Mouvement manuel et virement interne ───
-- Mouvement hors règlement (frais et agios, intérêts, apport…) : écriture BQ entre le compte de
-- trésorerie et la contrepartie choisie (ex. 631 frais bancaires), plus le mouvement.
CREATE OR REPLACE FUNCTION public.record_treasury_movement(_account uuid, _date date, _amount numeric, _counter_account uuid,
                                                           _description text, _reference text DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _b public.bank_accounts%ROWTYPE; _c public.gl_accounts%ROWTYPE; _entry uuid; _bank_gl uuid; _d date := COALESCE(_date, CURRENT_DATE);
BEGIN
  IF NOT public.has_permission(auth.uid(), 'treasury.create_txn') THEN RAISE EXCEPTION 'Droit insuffisant : saisir un mouvement de trésorerie' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _b FROM public.bank_accounts WHERE id = _account AND tenant_id = _tenant AND is_active;
  IF _b.id IS NULL THEN RAISE EXCEPTION 'Compte de trésorerie introuvable ou inactif' USING ERRCODE = 'QG023'; END IF;
  SELECT * INTO _c FROM public.gl_accounts WHERE id = _counter_account AND tenant_id = _tenant AND is_active AND NOT is_header;
  IF _c.id IS NULL THEN RAISE EXCEPTION 'Contrepartie : compte général actif et imputable de la société requis' USING ERRCODE = 'QG023'; END IF;
  IF _amount IS NULL OR _amount = 0 THEN RAISE EXCEPTION 'Montant non nul requis (positif = entrée, négatif = sortie)' USING ERRCODE = 'QG023'; END IF;
  IF COALESCE(btrim(_description), '') = '' THEN RAISE EXCEPTION 'Libellé obligatoire' USING ERRCODE = 'QG023'; END IF;
  _bank_gl := public.treasury_gl_account(_tenant, _b.id, NULL);
  IF _c.id = _bank_gl THEN RAISE EXCEPTION 'La contrepartie ne peut pas être le compte de trésorerie lui-même' USING ERRCODE = 'QG023'; END IF;
  PERFORM public.assert_fiscal_period_open(_tenant, _d, 'TREASURY');
  _entry := public.post_two_line_entry(_tenant, _d, 'treasury', btrim(_description) || ' — ' || _b.name,
    CASE WHEN _amount > 0 THEN _bank_gl ELSE _c.id END, CASE WHEN _amount > 0 THEN _c.id ELSE _bank_gl END, abs(_amount));
  RETURN public.record_treasury_line(_tenant, _b.id, _d, round(_amount, 2), 'manual', btrim(_description), _reference, _entry, NULL, _c.id);
END $function$;
REVOKE ALL ON FUNCTION public.record_treasury_movement(uuid, date, numeric, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_treasury_movement(uuid, date, numeric, uuid, text, text) TO authenticated;

-- Virement entre deux comptes de trésorerie de la société (banque → caisse, alimentation mobile money…).
CREATE OR REPLACE FUNCTION public.transfer_between_treasury_accounts(_from uuid, _to uuid, _date date, _amount numeric,
                                                                     _description text DEFAULT NULL, _reference text DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _a public.bank_accounts%ROWTYPE; _b public.bank_accounts%ROWTYPE; _entry uuid; _d date := COALESCE(_date, CURRENT_DATE); _label text;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'treasury.create_txn') THEN RAISE EXCEPTION 'Droit insuffisant : saisir un mouvement de trésorerie' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _a FROM public.bank_accounts WHERE id = _from AND tenant_id = _tenant AND is_active;
  SELECT * INTO _b FROM public.bank_accounts WHERE id = _to AND tenant_id = _tenant AND is_active;
  IF _a.id IS NULL OR _b.id IS NULL THEN RAISE EXCEPTION 'Comptes de trésorerie introuvables ou inactifs dans la société' USING ERRCODE = 'QG023'; END IF;
  IF _a.id = _b.id THEN RAISE EXCEPTION 'Virement : choisir deux comptes différents' USING ERRCODE = 'QG023'; END IF;
  IF _a.currency <> _b.currency THEN RAISE EXCEPTION 'Virement entre devises différentes (% → %) : opération de change, non prise en charge ici', _a.currency, _b.currency USING ERRCODE = 'QG023'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Montant du virement positif requis' USING ERRCODE = 'QG023'; END IF;
  PERFORM public.assert_fiscal_period_open(_tenant, _d, 'TREASURY');
  _label := COALESCE(NULLIF(btrim(_description), ''), 'Virement ' || _a.name || ' → ' || _b.name);
  _entry := public.post_two_line_entry(_tenant, _d, 'treasury', _label,
    public.treasury_gl_account(_tenant, _b.id, NULL), public.treasury_gl_account(_tenant, _a.id, NULL), round(_amount, 2));
  PERFORM public.record_treasury_line(_tenant, _a.id, _d, -round(_amount, 2), 'transfer', _label || ' (sortie)', _reference, _entry, NULL);
  PERFORM public.record_treasury_line(_tenant, _b.id, _d, round(_amount, 2), 'transfer', _label || ' (entrée)', _reference, _entry, NULL);
  RETURN _entry;
END $function$;
REVOKE ALL ON FUNCTION public.transfer_between_treasury_accounts(uuid, uuid, date, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_between_treasury_accounts(uuid, uuid, date, numeric, text, text) TO authenticated;

SELECT public.install_tenant_isolation_triggers() AS tables_protegees;
