-- V154 — Paie : paiement effectif des salaires (lots de virement, fichier bancaire paramétrable, retours bancaires,
-- comptabilisation 422 / banque) — audit docs/audit-erp/32-audit-rh-paie.md, P2 ; spécification « Lot 1 » de
-- docs/roadmap-paie-rh.md.
--
-- Constat : le net à payer restait au crédit du compte de rémunérations dues ; aucun lot, fichier ni retour bancaire.
-- Références : Odoo (lot de paiements regroupant les nets dans un fichier pour le portail bancaire, coordonnées
-- bancaires requises sur la fiche, rapprochement du relevé avec la référence du lot, lignes rejetées retirées) ;
-- Infor Anael (« virements paramétrables » : format de sortie décrit par des paramètres) ; zone UEMOA : aucun format
-- de fichier de virement standard n'a été trouvé, les banques fournissent leur gabarit — aucun format n'est présumé,
-- chaque société décrit celui de sa banque (colonnes, séparateur, encodage, dates, montants).
--
-- Règles :
--   * payroll_bank_file_profiles (droit hr.payroll_settings) : colonnes ordonnées (champ ou valeur fixe), en-tête,
--     séparateur, encodage, format de date, séparateur décimal, décimales ;
--   * lot (droit hr.payroll_payment) depuis un cycle comptabilisé : une ligne par salarié au net positif restant dû,
--     RIB obligatoire (refus nominatif), devise du cycle = devise du compte de trésorerie ; un salarié n'est jamais
--     dans deux lots actifs pour le même cycle (rejeté = repayable) ;
--   * approbation par une autre personne (hr.payroll_payment_approve), puis fichier généré une fois, conservé avec son
--     empreinte SHA-256 (réédition = même contenu) ;
--   * retours bancaires (payé / rejeté avec motif) : les lignes payées sont comptabilisées ensemble (DR rémunérations
--     dues / CR banque, journal BQ) avec un mouvement de trésorerie à la référence du lot (rapprochement du relevé) ;
--     le lot se clôt quand toutes les lignes sont décidées ; annulation possible tant que le fichier n'est pas émis.

-- 1. Droits.
INSERT INTO public.erp_permission_catalog (code, module, action, label) VALUES
  ('hr.payroll_payment', 'hr', 'payroll_payment', 'Préparer et émettre les virements de salaires'),
  ('hr.payroll_payment_approve', 'hr', 'payroll_payment_approve', 'Approuver les virements de salaires')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
SELECT v.r, v.p FROM (VALUES ('admin', 'hr.payroll_payment'), ('admin', 'hr.payroll_payment_approve'),
  ('hr_admin', 'hr.payroll_payment'), ('hr_approver', 'hr.payroll_payment_approve')) AS v(r, p)
WHERE EXISTS (SELECT 1 FROM public.erp_system_roles s WHERE s.code = v.r)
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, sp.permission_code FROM public.erp_roles r
JOIN public.erp_system_role_permissions sp ON sp.role_code = r.code
WHERE r.is_system AND sp.permission_code IN ('hr.payroll_payment', 'hr.payroll_payment_approve')
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

-- 2. Journal BQ et source de trésorerie pour le paiement de la paie.
CREATE OR REPLACE FUNCTION public.journal_for_source(_source text)
 RETURNS text LANGUAGE sql IMMUTABLE
AS $function$
  SELECT CASE _source
    WHEN 'ar_invoice' THEN 'VT'
    WHEN 'ar_credit_note' THEN 'VT'
    WHEN 'ap_invoice' THEN 'AC'
    WHEN 'ap_credit_note' THEN 'AC'
    WHEN 'goods_receipt' THEN 'AC'
    WHEN 'grni_return' THEN 'AC'
    WHEN 'ar_receipt' THEN 'BQ'
    WHEN 'ar_advance' THEN 'BQ'
    WHEN 'ar_refund' THEN 'BQ'
    WHEN 'ap_payment' THEN 'BQ'
    WHEN 'ap_advance' THEN 'BQ'
    WHEN 'treasury' THEN 'BQ'
    WHEN 'expense_payment' THEN 'BQ'
    WHEN 'expense_advance' THEN 'BQ'
    WHEN 'expense_advance_refund' THEN 'BQ'
    WHEN 'payroll_payment' THEN 'BQ'
    WHEN 'payroll' THEN 'PA'
    ELSE 'OD'
  END
$function$;
ALTER TABLE public.bank_transactions DROP CONSTRAINT bank_transactions_source_check;
ALTER TABLE public.bank_transactions ADD CONSTRAINT bank_transactions_source_check
  CHECK (source IN ('manual', 'payment', 'advance', 'refund', 'transfer', 'statement', 'expense', 'payroll'));

-- 3. Profils de fichier bancaire.
CREATE TABLE public.payroll_bank_file_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9._-]{0,39}$'),
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 120),
  bank_name text,
  format_version text,
  encoding text NOT NULL DEFAULT 'UTF-8' CHECK (encoding IN ('UTF-8', 'ISO-8859-1', 'WINDOWS-1252')),
  separator text NOT NULL DEFAULT ';' CHECK (separator IN (';', ',', '|', 'TAB')),
  header_row boolean NOT NULL DEFAULT true,
  date_format text NOT NULL DEFAULT 'DD/MM/YYYY' CHECK (date_format IN ('DD/MM/YYYY', 'YYYY-MM-DD', 'DDMMYYYY', 'YYYYMMDD')),
  decimal_separator text NOT NULL DEFAULT ',' CHECK (decimal_separator IN (',', '.')),
  amount_decimals integer NOT NULL DEFAULT 0 CHECK (amount_decimals BETWEEN 0 AND 3),
  columns jsonb NOT NULL CHECK (jsonb_typeof(columns) = 'array' AND jsonb_array_length(columns) BETWEEN 1 AND 40),
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code),
  CONSTRAINT payroll_bank_file_profiles_id_tenant UNIQUE (id, tenant_id)
);

-- 4. Lots et lignes.
CREATE TABLE public.payroll_payment_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  batch_number text NOT NULL,
  run_id uuid NOT NULL REFERENCES public.payroll_runs(id) ON DELETE RESTRICT,
  bank_account_id uuid NOT NULL REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,
  profile_id uuid NOT NULL,
  payment_date date NOT NULL,
  currency text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'sent', 'closed', 'cancelled')),
  total_amount numeric(18,2) NOT NULL DEFAULT 0,
  line_count integer NOT NULL DEFAULT 0,
  reference text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid,
  approved_at timestamptz,
  sent_by uuid,
  sent_at timestamptz,
  file_name text,
  file_encoding text,
  file_content text,
  file_sha256 text,
  cancelled_reason text,
  UNIQUE (tenant_id, batch_number),
  CONSTRAINT payroll_payment_batches_id_tenant UNIQUE (id, tenant_id),
  FOREIGN KEY (profile_id, tenant_id) REFERENCES public.payroll_bank_file_profiles (id, tenant_id) ON DELETE RESTRICT
);
CREATE TABLE public.payroll_payment_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL,
  run_id uuid NOT NULL REFERENCES public.payroll_runs(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  line_number integer NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  beneficiary_name text NOT NULL,
  bank_account_snapshot text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'rejected', 'cancelled')),
  result_date date,
  rejection_reason text,
  journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  bank_transaction_id uuid REFERENCES public.bank_transactions(id) ON DELETE SET NULL,
  decided_by uuid,
  decided_at timestamptz,
  UNIQUE (batch_id, employee_id),
  FOREIGN KEY (batch_id, tenant_id) REFERENCES public.payroll_payment_batches (id, tenant_id) ON DELETE CASCADE
);
-- Jamais deux paiements actifs (en cours ou payés) du même salarié pour le même cycle.
CREATE UNIQUE INDEX payroll_payment_lines_once_per_run
  ON public.payroll_payment_lines (tenant_id, run_id, employee_id) WHERE status IN ('pending', 'paid');

ALTER TABLE public.payroll_bank_file_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_payment_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_payment_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payroll_bank_file_profiles, public.payroll_payment_batches, public.payroll_payment_lines FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payroll_bank_file_profiles TO authenticated;
-- Lots et lignes : lus par les fonctions (les coordonnées bancaires sont masquées selon les droits) ; pas d'accès direct.
CREATE POLICY payroll_bank_file_profiles_read ON public.payroll_bank_file_profiles FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

-- 5. Profils : enregistrement contrôlé.
CREATE OR REPLACE FUNCTION public.save_payroll_bank_file_profile(_input jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _id uuid := NULLIF(_input ->> 'id', '')::uuid;
  _c jsonb;
  _fields text[] := ARRAY['line_number', 'matricule', 'employee_name', 'bank_account', 'amount', 'currency', 'payment_date',
    'reference', 'label', 'company_name', 'company_account', 'period'];
BEGIN
  IF _tenant IS NULL OR NOT public.has_permission(auth.uid(), 'hr.payroll_settings') THEN
    RAISE EXCEPTION 'Permission refusée : hr.payroll_settings' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(_input -> 'columns') <> 'array' OR jsonb_array_length(_input -> 'columns') = 0 THEN
    RAISE EXCEPTION 'Le format doit décrire au moins une colonne' USING ERRCODE = 'QG028';
  END IF;
  FOR _c IN SELECT value FROM jsonb_array_elements(_input -> 'columns') LOOP
    IF jsonb_typeof(_c) <> 'object' OR length(btrim(COALESCE(_c ->> 'header', ''))) NOT BETWEEN 1 AND 60
       OR ((_c ->> 'field') IS NULL) = ((_c ->> 'value') IS NULL)
       OR ((_c ->> 'field') IS NOT NULL AND NOT (_c ->> 'field') = ANY(_fields)) THEN
      RAISE EXCEPTION 'Colonne invalide : un en-tête et soit un champ (%), soit une valeur fixe', array_to_string(_fields, ', ')
        USING ERRCODE = 'QG028';
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_input -> 'columns') c WHERE c ->> 'field' = 'amount')
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_input -> 'columns') c WHERE c ->> 'field' = 'bank_account') THEN
    RAISE EXCEPTION 'Le format doit contenir au moins le montant et le compte bancaire du bénéficiaire' USING ERRCODE = 'QG028';
  END IF;
  IF _id IS NULL THEN
    INSERT INTO public.payroll_bank_file_profiles (tenant_id, code, label, bank_name, format_version, encoding, separator, header_row,
      date_format, decimal_separator, amount_decimals, columns, notes, active)
    VALUES (_tenant, lower(btrim(_input ->> 'code')), btrim(_input ->> 'label'), NULLIF(btrim(_input ->> 'bank_name'), ''),
      NULLIF(btrim(_input ->> 'format_version'), ''), COALESCE(NULLIF(_input ->> 'encoding', ''), 'UTF-8'),
      COALESCE(NULLIF(_input ->> 'separator', ''), ';'), COALESCE((_input ->> 'header_row')::boolean, true),
      COALESCE(NULLIF(_input ->> 'date_format', ''), 'DD/MM/YYYY'), COALESCE(NULLIF(_input ->> 'decimal_separator', ''), ','),
      COALESCE(NULLIF(_input ->> 'amount_decimals', '')::integer, 0), _input -> 'columns', NULLIF(btrim(_input ->> 'notes'), ''),
      COALESCE((_input ->> 'active')::boolean, true))
    RETURNING id INTO _id;
  ELSE
    UPDATE public.payroll_bank_file_profiles SET code = lower(btrim(_input ->> 'code')), label = btrim(_input ->> 'label'),
      bank_name = NULLIF(btrim(_input ->> 'bank_name'), ''), format_version = NULLIF(btrim(_input ->> 'format_version'), ''),
      encoding = COALESCE(NULLIF(_input ->> 'encoding', ''), 'UTF-8'), separator = COALESCE(NULLIF(_input ->> 'separator', ''), ';'),
      header_row = COALESCE((_input ->> 'header_row')::boolean, true), date_format = COALESCE(NULLIF(_input ->> 'date_format', ''), 'DD/MM/YYYY'),
      decimal_separator = COALESCE(NULLIF(_input ->> 'decimal_separator', ''), ','),
      amount_decimals = COALESCE(NULLIF(_input ->> 'amount_decimals', '')::integer, 0), columns = _input -> 'columns',
      notes = NULLIF(btrim(_input ->> 'notes'), ''), active = COALESCE((_input ->> 'active')::boolean, true), updated_at = now()
     WHERE id = _id AND tenant_id = _tenant;
    IF NOT FOUND THEN RAISE EXCEPTION 'Format introuvable dans la société courante' USING ERRCODE = '42501'; END IF;
  END IF;
  RETURN _id;
EXCEPTION
  WHEN unique_violation THEN RAISE EXCEPTION 'Code de format déjà utilisé' USING ERRCODE = 'QG028';
  WHEN check_violation THEN RAISE EXCEPTION 'Paramètre de format invalide : %', SQLERRM USING ERRCODE = 'QG028';
END $function$;
REVOKE ALL ON FUNCTION public.save_payroll_bank_file_profile(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_payroll_bank_file_profile(jsonb) TO authenticated;

-- 6. Préparation d'un lot.
CREATE OR REPLACE FUNCTION public.create_payroll_payment_batch(_run_id uuid, _bank_account_id uuid, _profile_id uuid,
  _payment_date date, _reference text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _run public.payroll_runs%ROWTYPE;
  _bank public.bank_accounts%ROWTYPE;
  _missing text;
  _id uuid;
  _n integer;
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'payroll_payment') THEN
    RAISE EXCEPTION 'Permission refusée : hr.payroll_payment' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _run FROM public.payroll_runs WHERE id = _run_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cycle introuvable dans la société courante' USING ERRCODE = '42501'; END IF;
  IF _run.status <> 'posted' THEN RAISE EXCEPTION 'Seul un cycle comptabilisé se paie' USING ERRCODE = 'QG028'; END IF;
  SELECT * INTO _bank FROM public.bank_accounts WHERE id = _bank_account_id AND tenant_id = _tenant AND is_active;
  IF NOT FOUND OR COALESCE(_bank.account_type, 'bank') <> 'bank' THEN
    RAISE EXCEPTION 'Compte bancaire de la société introuvable ou inactif' USING ERRCODE = 'QG028';
  END IF;
  IF upper(btrim(_bank.currency)) IS DISTINCT FROM upper(btrim(_run.payroll_currency_code)) THEN
    RAISE EXCEPTION 'Devise du compte (%) différente de celle de la paie (%)', _bank.currency, _run.payroll_currency_code USING ERRCODE = 'QG028';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.payroll_bank_file_profiles p WHERE p.id = _profile_id AND p.tenant_id = _tenant AND p.active) THEN
    RAISE EXCEPTION 'Format de fichier bancaire introuvable ou inactif' USING ERRCODE = 'QG028';
  END IF;
  IF _payment_date IS NULL THEN RAISE EXCEPTION 'Date de paiement obligatoire' USING ERRCODE = 'QG028'; END IF;
  SELECT string_agg(e.matricule || ' ' || e.first_name || ' ' || e.last_name, ', ' ORDER BY e.matricule) INTO _missing
    FROM public.payroll_lines l JOIN public.employees e ON e.id = l.employee_id
   WHERE l.run_id = _run_id AND l.net > 0 AND NULLIF(btrim(e.bank_account), '') IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.payroll_payment_lines p WHERE p.run_id = _run_id AND p.employee_id = l.employee_id
       AND p.status IN ('pending', 'paid'));
  IF _missing IS NOT NULL THEN
    RAISE EXCEPTION 'Coordonnées bancaires manquantes pour : %', _missing USING ERRCODE = 'QG028';
  END IF;
  INSERT INTO public.payroll_payment_batches (tenant_id, batch_number, run_id, bank_account_id, profile_id, payment_date, currency,
    reference, created_by)
  VALUES (_tenant, 'VIR-' || _run.period || '-' || lpad(((SELECT count(*) FROM public.payroll_payment_batches b
      WHERE b.tenant_id = _tenant AND b.run_id = _run_id) + 1)::text, 2, '0') || '-' || substr(_run_id::text, 1, 4),
    _run_id, _bank_account_id, _profile_id, _payment_date, upper(btrim(_bank.currency)), NULLIF(btrim(_reference), ''), auth.uid())
  RETURNING id INTO _id;
  INSERT INTO public.payroll_payment_lines (tenant_id, batch_id, run_id, employee_id, line_number, amount, beneficiary_name, bank_account_snapshot)
  SELECT _tenant, _id, _run_id, x.employee_id, row_number() OVER (ORDER BY x.matricule), x.net, x.name, x.rib
    FROM (SELECT l.employee_id, e.matricule, sum(l.net) net, e.last_name || ' ' || e.first_name name, btrim(e.bank_account) rib
            FROM public.payroll_lines l JOIN public.employees e ON e.id = l.employee_id
           WHERE l.run_id = _run_id
             AND NOT EXISTS (SELECT 1 FROM public.payroll_payment_lines p WHERE p.run_id = _run_id AND p.employee_id = l.employee_id
               AND p.status IN ('pending', 'paid'))
           GROUP BY l.employee_id, e.matricule, e.last_name, e.first_name, e.bank_account) x
   WHERE x.net > 0;
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n = 0 THEN RAISE EXCEPTION 'Aucun net restant à payer pour ce cycle' USING ERRCODE = 'QG028'; END IF;
  UPDATE public.payroll_payment_batches SET line_count = _n,
         total_amount = (SELECT sum(amount) FROM public.payroll_payment_lines WHERE batch_id = _id) WHERE id = _id;
  RETURN _id;
END $function$;
REVOKE ALL ON FUNCTION public.create_payroll_payment_batch(uuid, uuid, uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_payroll_payment_batch(uuid, uuid, uuid, date, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_payroll_payment_batch(_batch_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid()); _b public.payroll_payment_batches%ROWTYPE;
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'payroll_payment_approve') THEN
    RAISE EXCEPTION 'Permission refusée : hr.payroll_payment_approve' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _b FROM public.payroll_payment_batches WHERE id = _batch_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lot introuvable dans la société courante' USING ERRCODE = '42501'; END IF;
  IF _b.status <> 'draft' THEN RAISE EXCEPTION 'Seul un lot en préparation s''approuve' USING ERRCODE = 'QG028'; END IF;
  IF _b.created_by = auth.uid() THEN
    RAISE EXCEPTION 'Séparation des tâches : le préparateur du lot ne peut pas l''approuver' USING ERRCODE = '42501';
  END IF;
  UPDATE public.payroll_payment_batches SET status = 'approved', approved_by = auth.uid(), approved_at = now() WHERE id = _batch_id;
  RETURN _batch_id;
END $function$;
REVOKE ALL ON FUNCTION public.approve_payroll_payment_batch(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_payroll_payment_batch(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_payroll_payment_batch(_batch_id uuid, _reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid()); _b public.payroll_payment_batches%ROWTYPE;
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'payroll_payment') THEN
    RAISE EXCEPTION 'Permission refusée : hr.payroll_payment' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(_reason, ''))) < 3 THEN RAISE EXCEPTION 'Motif d''annulation obligatoire' USING ERRCODE = 'QG028'; END IF;
  SELECT * INTO _b FROM public.payroll_payment_batches WHERE id = _batch_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lot introuvable dans la société courante' USING ERRCODE = '42501'; END IF;
  IF _b.status NOT IN ('draft', 'approved') THEN
    RAISE EXCEPTION 'Un lot dont le fichier est émis ne s''annule plus : saisir les retours (rejet) ligne par ligne' USING ERRCODE = 'QG028';
  END IF;
  UPDATE public.payroll_payment_lines SET status = 'cancelled', decided_by = auth.uid(), decided_at = now() WHERE batch_id = _batch_id;
  UPDATE public.payroll_payment_batches SET status = 'cancelled', cancelled_reason = btrim(_reason) WHERE id = _batch_id;
  RETURN _batch_id;
END $function$;
REVOKE ALL ON FUNCTION public.cancel_payroll_payment_batch(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_payroll_payment_batch(uuid, text) TO authenticated;

-- 7. Fichier bancaire selon le profil (généré une fois, conservé avec son empreinte).
CREATE OR REPLACE FUNCTION public.payroll_file_value(_value text, _sep text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
  SELECT CASE WHEN _value IS NULL THEN ''
    WHEN position(_sep IN _value) > 0 OR position('"' IN _value) > 0 OR _value ~ '[\r\n]'
      THEN '"' || replace(_value, '"', '""') || '"'
    ELSE _value END
$function$;

CREATE OR REPLACE FUNCTION public.generate_payroll_payment_file(_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _b public.payroll_payment_batches%ROWTYPE;
  _p public.payroll_bank_file_profiles%ROWTYPE;
  _company text;
  _company_account text;
  _period text;
  _sep text;
  _lines text[] := '{}';
  _l record;
  _c jsonb;
  _cells text[];
  _v text;
  _content text;
  _name text;
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'payroll_payment') THEN
    RAISE EXCEPTION 'Permission refusée : hr.payroll_payment' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _b FROM public.payroll_payment_batches WHERE id = _batch_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lot introuvable dans la société courante' USING ERRCODE = '42501'; END IF;
  IF _b.file_content IS NOT NULL THEN
    RETURN jsonb_build_object('file_name', _b.file_name, 'encoding', _b.file_encoding, 'content', _b.file_content, 'sha256', _b.file_sha256);
  END IF;
  IF _b.status <> 'approved' THEN RAISE EXCEPTION 'Le fichier se génère sur un lot approuvé' USING ERRCODE = 'QG028'; END IF;
  SELECT * INTO _p FROM public.payroll_bank_file_profiles WHERE id = _b.profile_id;
  SELECT COALESCE(t.legal_name, t.name) INTO _company FROM public.tenants t WHERE t.id = _tenant;
  SELECT a.account_number INTO _company_account FROM public.bank_accounts a WHERE a.id = _b.bank_account_id;
  SELECT r.period INTO _period FROM public.payroll_runs r WHERE r.id = _b.run_id;
  _sep := CASE _p.separator WHEN 'TAB' THEN E'\t' ELSE _p.separator END;
  IF _p.header_row THEN
    SELECT array_agg(public.payroll_file_value(c ->> 'header', _sep) ORDER BY o) INTO _cells
      FROM jsonb_array_elements(_p.columns) WITH ORDINALITY AS t(c, o);
    _lines := _lines || array_to_string(_cells, _sep);
  END IF;
  FOR _l IN SELECT pl.*, e.matricule FROM public.payroll_payment_lines pl JOIN public.employees e ON e.id = pl.employee_id
     WHERE pl.batch_id = _batch_id AND pl.status = 'pending' ORDER BY pl.line_number LOOP
    _cells := '{}';
    FOR _c IN SELECT c FROM jsonb_array_elements(_p.columns) WITH ORDINALITY AS t(c, o) ORDER BY o LOOP
      _v := CASE WHEN _c ? 'value' THEN _c ->> 'value' ELSE CASE _c ->> 'field'
        WHEN 'line_number' THEN _l.line_number::text
        WHEN 'matricule' THEN _l.matricule
        WHEN 'employee_name' THEN _l.beneficiary_name
        WHEN 'bank_account' THEN _l.bank_account_snapshot
        WHEN 'amount' THEN replace(to_char(round(_l.amount, _p.amount_decimals),
            'FM9999999999990' || CASE WHEN _p.amount_decimals > 0 THEN '.' || repeat('0', _p.amount_decimals) ELSE '' END), '.', _p.decimal_separator)
        WHEN 'currency' THEN _b.currency
        WHEN 'payment_date' THEN to_char(_b.payment_date, CASE _p.date_format WHEN 'YYYY-MM-DD' THEN 'YYYY-MM-DD'
            WHEN 'DDMMYYYY' THEN 'DDMMYYYY' WHEN 'YYYYMMDD' THEN 'YYYYMMDD' ELSE 'DD/MM/YYYY' END)
        WHEN 'reference' THEN COALESCE(_b.reference, _b.batch_number)
        WHEN 'label' THEN 'Salaire ' || _period
        WHEN 'company_name' THEN _company
        WHEN 'company_account' THEN _company_account
        WHEN 'period' THEN _period
      END END;
      _cells := _cells || public.payroll_file_value(_v, _sep);
    END LOOP;
    _lines := _lines || array_to_string(_cells, _sep);
  END LOOP;
  _content := array_to_string(_lines, E'\r\n') || E'\r\n';
  _name := _b.batch_number || '.' || CASE WHEN _p.separator = 'TAB' THEN 'txt' ELSE 'csv' END;
  UPDATE public.payroll_payment_batches SET status = 'sent', sent_by = auth.uid(), sent_at = now(), file_name = _name,
         file_encoding = _p.encoding, file_content = _content, file_sha256 = encode(sha256(convert_to(_content, 'UTF8')), 'hex')
   WHERE id = _batch_id;
  RETURN jsonb_build_object('file_name', _name, 'encoding', _p.encoding, 'content', _content,
    'sha256', encode(sha256(convert_to(_content, 'UTF8')), 'hex'));
END $function$;
REVOKE ALL ON FUNCTION public.generate_payroll_payment_file(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_payroll_payment_file(uuid) TO authenticated;

-- 8. Retours bancaires : payé / rejeté ; les lignes payées sont comptabilisées ensemble.
CREATE OR REPLACE FUNCTION public.record_payroll_payment_results(_batch_id uuid, _results jsonb, _result_date date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _b public.payroll_payment_batches%ROWTYPE;
  _r jsonb;
  _line public.payroll_payment_lines%ROWTYPE;
  _paid numeric := 0;
  _paid_count integer := 0;
  _rejected integer := 0;
  _ids uuid[] := '{}';
  _entry uuid;
  _txn uuid;
  _bank_gl uuid;
BEGIN
  IF _tenant IS NULL OR NOT public.has_hr_perm(auth.uid(), 'payroll_payment') THEN
    RAISE EXCEPTION 'Permission refusée : hr.payroll_payment' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _b FROM public.payroll_payment_batches WHERE id = _batch_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lot introuvable dans la société courante' USING ERRCODE = '42501'; END IF;
  IF _b.status <> 'sent' THEN RAISE EXCEPTION 'Les retours se saisissent sur un lot émis à la banque' USING ERRCODE = 'QG028'; END IF;
  IF _result_date IS NULL OR jsonb_typeof(_results) <> 'array' OR jsonb_array_length(_results) = 0 THEN
    RAISE EXCEPTION 'Date et liste des retours obligatoires' USING ERRCODE = 'QG028';
  END IF;
  FOR _r IN SELECT value FROM jsonb_array_elements(_results) LOOP
    SELECT * INTO _line FROM public.payroll_payment_lines
     WHERE batch_id = _batch_id AND (id = NULLIF(_r ->> 'line_id', '')::uuid
        OR employee_id = (SELECT e.id FROM public.employees e WHERE e.tenant_id = _tenant AND e.matricule = _r ->> 'matricule'))
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ligne de retour inconnue dans le lot : %', COALESCE(_r ->> 'matricule', _r ->> 'line_id') USING ERRCODE = 'QG028'; END IF;
    IF _line.status <> 'pending' THEN
      RAISE EXCEPTION 'Ligne % déjà décidée (%)', _line.line_number, _line.status USING ERRCODE = 'QG028';
    END IF;
    IF _r ->> 'status' = 'paid' THEN
      _paid := _paid + _line.amount; _paid_count := _paid_count + 1; _ids := _ids || _line.id;
    ELSIF _r ->> 'status' = 'rejected' THEN
      IF length(btrim(COALESCE(_r ->> 'reason', ''))) < 3 THEN
        RAISE EXCEPTION 'Motif de rejet obligatoire (ligne %)', _line.line_number USING ERRCODE = 'QG028';
      END IF;
      UPDATE public.payroll_payment_lines SET status = 'rejected', result_date = _result_date, rejection_reason = btrim(_r ->> 'reason'),
             decided_by = auth.uid(), decided_at = now() WHERE id = _line.id;
      _rejected := _rejected + 1;
    ELSE
      RAISE EXCEPTION 'Statut de retour inconnu (payé ou rejeté attendu)' USING ERRCODE = 'QG028';
    END IF;
  END LOOP;
  IF _paid > 0 THEN
    PERFORM public.assert_fiscal_period_open(_tenant, _result_date, 'TREASURY');
    _bank_gl := public.treasury_gl_account(_tenant, _b.bank_account_id, NULL);
    _entry := public.post_two_line_entry(_tenant, _result_date, 'payroll_payment', 'Virement des salaires ' || _b.batch_number,
      public.require_posting_account(_tenant, 'PAYROLL_NET_PAYABLE'), _bank_gl, _paid);
    _txn := public.record_treasury_line(_tenant, _b.bank_account_id, _result_date, -_paid, 'payroll',
      'Virement des salaires ' || _b.batch_number || ' (' || _paid_count || ' salarié(s))', _b.batch_number, _entry, NULL,
      public.require_posting_account(_tenant, 'PAYROLL_NET_PAYABLE'));
    UPDATE public.payroll_payment_lines SET status = 'paid', result_date = _result_date, journal_entry_id = _entry,
           bank_transaction_id = _txn, decided_by = auth.uid(), decided_at = now() WHERE id = ANY(_ids);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.payroll_payment_lines WHERE batch_id = _batch_id AND status = 'pending') THEN
    UPDATE public.payroll_payment_batches SET status = 'closed' WHERE id = _batch_id;
  END IF;
  RETURN jsonb_build_object('paid_count', _paid_count, 'paid_amount', _paid, 'rejected_count', _rejected, 'journal_entry_id', _entry);
END $function$;
REVOKE ALL ON FUNCTION public.record_payroll_payment_results(uuid, jsonb, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_payroll_payment_results(uuid, jsonb, date) TO authenticated;

-- 9. Lecture : lots et lignes (RIB masqué sans droit sensible), et reste à payer par cycle.
CREATE OR REPLACE FUNCTION public.list_payroll_payment_batches(_run_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _sensitive boolean := public.has_hr_perm(auth.uid(), 'view_sensitive') OR public.has_hr_perm(auth.uid(), 'payroll_payment');
BEGIN
  IF _tenant IS NULL OR NOT (public.has_hr_perm(auth.uid(), 'payroll_payment') OR public.has_hr_perm(auth.uid(), 'payroll_payment_approve')
      OR public.has_hr_perm(auth.uid(), 'view_payroll')) THEN
    RAISE EXCEPTION 'Permission refusée : hr.payroll_payment' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(b) - 'tenant_id' - 'file_content' || jsonb_build_object(
      'period', r.period, 'bank_account_name', a.name, 'profile_label', p.label,
      'lines', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', l.id, 'line_number', l.line_number, 'employee_id', l.employee_id,
          'matricule', e.matricule, 'beneficiary_name', l.beneficiary_name, 'amount', l.amount, 'status', l.status,
          'bank_account', CASE WHEN _sensitive THEN l.bank_account_snapshot ELSE '•••• ' || right(l.bank_account_snapshot, 4) END,
          'rejection_reason', l.rejection_reason, 'result_date', l.result_date) ORDER BY l.line_number)
        FROM public.payroll_payment_lines l JOIN public.employees e ON e.id = l.employee_id WHERE l.batch_id = b.id), '[]'::jsonb))
      ORDER BY b.created_at DESC)
    FROM public.payroll_payment_batches b
    JOIN public.payroll_runs r ON r.id = b.run_id
    JOIN public.bank_accounts a ON a.id = b.bank_account_id
    JOIN public.payroll_bank_file_profiles p ON p.id = b.profile_id
   WHERE b.tenant_id = _tenant AND (_run_id IS NULL OR b.run_id = _run_id)), '[]'::jsonb);
END $function$;
REVOKE ALL ON FUNCTION public.list_payroll_payment_batches(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_payroll_payment_batches(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.payroll_run_payment_status(_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF _tenant IS NULL OR NOT (public.has_hr_perm(auth.uid(), 'payroll_payment') OR public.has_hr_perm(auth.uid(), 'view_payroll')) THEN
    RAISE EXCEPTION 'Permission refusée : hr.payroll_payment' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT jsonb_build_object(
      'net_total', COALESCE(sum(l.net) FILTER (WHERE l.net > 0), 0),
      'paid', COALESCE((SELECT sum(p.amount) FROM public.payroll_payment_lines p WHERE p.run_id = _run_id AND p.status = 'paid'), 0),
      'in_progress', COALESCE((SELECT sum(p.amount) FROM public.payroll_payment_lines p WHERE p.run_id = _run_id AND p.status = 'pending'), 0),
      'rejected_open', COALESCE((SELECT count(*) FROM public.payroll_payment_lines p WHERE p.run_id = _run_id AND p.status = 'rejected'
          AND NOT EXISTS (SELECT 1 FROM public.payroll_payment_lines q WHERE q.run_id = _run_id AND q.employee_id = p.employee_id
            AND q.status IN ('pending', 'paid'))), 0))
    FROM public.payroll_lines l JOIN public.payroll_runs r ON r.id = l.run_id
   WHERE l.run_id = _run_id AND r.tenant_id = _tenant);
END $function$;
REVOKE ALL ON FUNCTION public.payroll_run_payment_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payroll_run_payment_status(uuid) TO authenticated;

SELECT public.install_tenant_isolation_triggers();
