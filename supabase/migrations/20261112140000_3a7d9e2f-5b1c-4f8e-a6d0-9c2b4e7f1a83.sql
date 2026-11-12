-- V18 — Paramétrage comptable : référentiels, rôles comptables, comptes par société.
-- Écrit à la main.
--
-- POURQUOI
-- Les déclencheurs de comptabilisation citaient des numéros de comptes en dur
-- (4110, 4000, 4310, 5210, 4010…). Trois défauts :
--   1. le cahier des charges l'interdit (AR-03 « conforme au paramétrage », §138
--      « aucun numéro de compte n'est contractuellement figé », GL-01 « mappings
--      des modules … par société ») ;
--   2. plusieurs ne sont pas SYSCOHADA : 4000 « Ventes » (la classe 40 désigne les
--      fournisseurs ; les ventes sont en 70), 4310 « TVA collectée » (431 =
--      sécurité sociale ; la TVA facturée est en 443) ;
--   3. un ERP destiné à l'Afrique puis au reste du monde ne peut pas figer un plan.
--
-- MODÈLE (détermination de compte, à la manière de SAP ; jeux de comptes Sage 300 ;
-- codes comptables Sage X3)
--   accounting_frameworks               référentiels (SYSCOHADA révisé, puis d'autres)
--   accounting_framework_accounts       comptes proposés par chaque référentiel
--   posting_roles                       rôles comptables, indépendants de tout plan
--                                       (« compte clients », « TVA collectée »…)
--   accounting_framework_role_defaults  compte proposé pour chaque rôle, par référentiel
--   tenant_accounting_settings          référentiel retenu par la société
--   tenant_posting_accounts             compte de LA société pour chaque rôle
--
-- Les fonctions de comptabilisation demandent un rôle, jamais un numéro. Ajouter un
-- pays = ajouter un référentiel (données), sans toucher au code. Un compte inactif
-- vaut un compte absent (compte bloqué, comme dans SAP) : refus QG001.
--
-- CONTINUITÉ
-- Les sociétés existantes gardent EXACTEMENT leur comportement : leurs comptes
-- historiques (4110, 4000, 4310, 5210, 4010, 4320, 6010) sont repris tels quels
-- comme comptes de leurs rôles. Ils ne sont pas « corrigés » en silence ; la
-- comptabilité doit les revoir (4000 et 4310 notamment). Les nouvelles sociétés
-- appliquent un référentiel par apply_accounting_framework().
--
-- Valeurs SYSCOHADA : marquées NON VALIDÉES (is_validated = false) tant qu'un
-- expert-comptable local ne les a pas relues (§138).
--
-- Jumelle : services/api/src/main/resources/db/migration/V18__parametrage_comptable.sql

-- ─── Référentiels (données de référence communes, lecture seule) ───

CREATE TABLE public.accounting_frameworks (
    code text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]*$'),
    name text NOT NULL,
    scope text NOT NULL,
    version text NOT NULL,
    is_validated boolean NOT NULL DEFAULT false,
    notes text
);

CREATE TABLE public.accounting_framework_accounts (
    framework_code text NOT NULL REFERENCES public.accounting_frameworks(code),
    code text NOT NULL CHECK (code ~ '^[0-9]+$'),
    name text NOT NULL,
    account_type text NOT NULL
      CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
    PRIMARY KEY (framework_code, code)
);

CREATE TABLE public.posting_roles (
    code text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]*$'),
    label text NOT NULL,
    module text NOT NULL,
    description text NOT NULL
);

CREATE TABLE public.accounting_framework_role_defaults (
    framework_code text NOT NULL,
    role_code text NOT NULL REFERENCES public.posting_roles(code),
    account_code text NOT NULL,
    PRIMARY KEY (framework_code, role_code),
    FOREIGN KEY (framework_code, account_code)
      REFERENCES public.accounting_framework_accounts(framework_code, code)
);

-- ─── Par société ───

CREATE TABLE public.tenant_accounting_settings (
    tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
    framework_code text NOT NULL REFERENCES public.accounting_frameworks(code),
    applied_at timestamptz NOT NULL DEFAULT now(),
    applied_by uuid
);

-- Clé composite : garantit, dans le schéma et pas dans le code, qu'une société ne
-- peut désigner qu'un compte de SON plan.
ALTER TABLE public.gl_accounts ADD CONSTRAINT gl_accounts_id_tenant_key UNIQUE (id, tenant_id);

CREATE TABLE public.tenant_posting_accounts (
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    role_code text NOT NULL REFERENCES public.posting_roles(code),
    gl_account_id uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by uuid,
    PRIMARY KEY (tenant_id, role_code),
    FOREIGN KEY (gl_account_id, tenant_id) REFERENCES public.gl_accounts(id, tenant_id)
);
-- Index de la clé étrangère : sans lui, supprimer un compte parcourt toute la table.
CREATE INDEX tenant_posting_accounts_gl_account_idx
    ON public.tenant_posting_accounts (gl_account_id, tenant_id);

-- ─── Données de référence ───

INSERT INTO public.posting_roles (code, label, module, description) VALUES
  ('AR_RECEIVABLE', 'Compte clients',          'AR', 'Débité à l''émission d''une facture client, crédité à l''encaissement'),
  ('SALES_REVENUE', 'Ventes',                  'AR', 'Crédité du montant HT des factures clients'),
  ('VAT_OUTPUT',    'TVA collectée',           'AR', 'Crédité de la TVA facturée aux clients'),
  ('BANK',          'Banque',                  'TRE','Débité des encaissements, crédité des paiements fournisseurs'),
  ('AP_PAYABLE',    'Compte fournisseurs',     'AP', 'Crédité à la réception d''une facture fournisseur, débité au paiement'),
  ('VAT_INPUT',     'TVA récupérable',         'AP', 'Débité de la TVA facturée par les fournisseurs'),
  ('PURCHASES',     'Achats',                  'AP', 'Débité du montant HT des factures fournisseurs');

INSERT INTO public.accounting_frameworks (code, name, scope, version, is_validated, notes) VALUES
  ('SYSCOHADA_REVISE',
   'SYSCOHADA révisé (Acte uniforme relatif au droit comptable et à l''information financière)',
   'États membres de l''OHADA, dont le Burkina Faso',
   'AUDCIF 2017',
   false,
   'Sous-ensemble nécessaire à la comptabilisation automatique. Numéros et intitulés à valider par un expert-comptable local avant recette réglementaire (cahier des charges §138).');

INSERT INTO public.accounting_framework_accounts (framework_code, code, name, account_type) VALUES
  ('SYSCOHADA_REVISE', '401',  'Fournisseurs, dettes en compte',      'liability'),
  ('SYSCOHADA_REVISE', '411',  'Clients',                              'asset'),
  ('SYSCOHADA_REVISE', '4431', 'État, TVA facturée sur ventes',        'liability'),
  ('SYSCOHADA_REVISE', '4452', 'État, TVA récupérable sur achats',     'asset'),
  ('SYSCOHADA_REVISE', '521',  'Banques',                              'asset'),
  ('SYSCOHADA_REVISE', '601',  'Achats de marchandises',               'expense'),
  ('SYSCOHADA_REVISE', '701',  'Ventes de marchandises',               'revenue'),
  ('SYSCOHADA_REVISE', '706',  'Services vendus',                      'revenue');

INSERT INTO public.accounting_framework_role_defaults (framework_code, role_code, account_code) VALUES
  ('SYSCOHADA_REVISE', 'AR_RECEIVABLE', '411'),
  ('SYSCOHADA_REVISE', 'SALES_REVENUE', '701'),
  ('SYSCOHADA_REVISE', 'VAT_OUTPUT',    '4431'),
  ('SYSCOHADA_REVISE', 'BANK',          '521'),
  ('SYSCOHADA_REVISE', 'AP_PAYABLE',    '401'),
  ('SYSCOHADA_REVISE', 'VAT_INPUT',     '4452'),
  ('SYSCOHADA_REVISE', 'PURCHASES',     '601');

-- Continuité : les sociétés existantes gardent leurs comptes historiques.
INSERT INTO public.tenant_posting_accounts (tenant_id, role_code, gl_account_id)
SELECT g.tenant_id, v.role_code, g.id
FROM (VALUES ('AR_RECEIVABLE', '4110'), ('SALES_REVENUE', '4000'), ('VAT_OUTPUT', '4310'),
             ('BANK', '5210'), ('AP_PAYABLE', '4010'), ('VAT_INPUT', '4320'),
             ('PURCHASES', '6010')) AS v(role_code, code)
JOIN public.gl_accounts g ON g.code = v.code
ON CONFLICT (tenant_id, role_code) DO NOTHING;

-- ─── Fonctions ───

-- Administrateur DANS la société courante (has_role() ignore user_roles.tenant_id).
CREATE FUNCTION public.is_tenant_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles r
    WHERE r.user_id = auth.uid()
      AND r.tenant_id = public.get_user_tenant_id(auth.uid())
      AND r.role = 'admin')
$$;

-- Compte de la société pour un rôle ; NULL si non paramétré ou compte inactif.
CREATE FUNCTION public.posting_account(_tenant uuid, _role text) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT p.gl_account_id
  FROM public.tenant_posting_accounts p
  JOIN public.gl_accounts g ON g.id = p.gl_account_id AND g.tenant_id = p.tenant_id
  WHERE p.tenant_id = _tenant AND p.role_code = _role AND g.is_active
$$;

-- « Compte clients (AR_RECEIVABLE), Ventes (SALES_REVENUE) » dans l'ordre donné.
CREATE FUNCTION public.posting_roles_label(_roles text[]) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT string_agg(COALESCE(r.label, x.code) || ' (' || x.code || ')', ', ' ORDER BY x.ord)
  FROM unnest(_roles) WITH ORDINALITY AS x(code, ord)
  LEFT JOIN public.posting_roles r ON r.code = x.code
$$;

-- Applique un référentiel à une société : crée les comptes absents du plan, associe
-- les rôles NON encore paramétrés. Ne modifie jamais un compte ni un choix existant.
-- Idempotent. Réservé au propriétaire : l'appel public passe par
-- apply_accounting_framework(), qui contrôle le rôle.
CREATE FUNCTION public.apply_accounting_framework_to(_tenant uuid, _framework text, _actor uuid)
    RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _actuel text;
  _comptes int;
  _roles int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.accounting_frameworks WHERE code = _framework) THEN
    RAISE EXCEPTION 'Référentiel comptable inconnu : %', _framework USING ERRCODE = '22023';
  END IF;
  SELECT framework_code INTO _actuel FROM public.tenant_accounting_settings WHERE tenant_id = _tenant;
  IF _actuel IS NOT NULL AND _actuel <> _framework THEN
    RAISE EXCEPTION 'La société applique déjà le référentiel % ; un changement de référentiel est une migration comptable, pas un paramètre', _actuel
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.gl_accounts (tenant_id, code, name, account_type)
  SELECT _tenant, a.code, a.name, a.account_type
  FROM public.accounting_framework_accounts a
  WHERE a.framework_code = _framework
  ON CONFLICT (tenant_id, code) DO NOTHING;
  GET DIAGNOSTICS _comptes = ROW_COUNT;

  INSERT INTO public.tenant_posting_accounts (tenant_id, role_code, gl_account_id, updated_by)
  SELECT _tenant, d.role_code, g.id, _actor
  FROM public.accounting_framework_role_defaults d
  JOIN public.gl_accounts g ON g.tenant_id = _tenant AND g.code = d.account_code
  WHERE d.framework_code = _framework
  ON CONFLICT (tenant_id, role_code) DO NOTHING;
  GET DIAGNOSTICS _roles = ROW_COUNT;

  INSERT INTO public.tenant_accounting_settings (tenant_id, framework_code, applied_by)
  VALUES (_tenant, _framework, _actor)
  ON CONFLICT (tenant_id) DO NOTHING;

  RETURN jsonb_build_object('referentiel', _framework, 'comptes_crees', _comptes,
                            'roles_parametres', _roles);
END; $$;

CREATE FUNCTION public.apply_accounting_framework(_framework text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'Aucune société associée à la session' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_tenant_admin() THEN
    RAISE EXCEPTION 'Rôle administrateur requis dans la société courante' USING ERRCODE = '42501';
  END IF;
  RETURN public.apply_accounting_framework_to(_tenant, _framework, auth.uid());
END; $$;

-- ─── Comptabilisation : rôles au lieu de numéros (remplace les versions de V17) ───

CREATE OR REPLACE FUNCTION public.on_ar_invoice_posted() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _entry_id uuid; _entry_number text;
  _ar uuid; _rev uuid; _vat uuid;
  _manquants text[] := '{}';
BEGIN
  IF NEW.journal_entry_id IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('sent','open','posted') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN RETURN NEW; END IF;

  _ar  := public.posting_account(NEW.tenant_id, 'AR_RECEIVABLE');
  _rev := public.posting_account(NEW.tenant_id, 'SALES_REVENUE');
  _vat := public.posting_account(NEW.tenant_id, 'VAT_OUTPUT');

  IF _ar  IS NULL THEN _manquants := _manquants || 'AR_RECEIVABLE'::text; END IF;
  IF _rev IS NULL THEN _manquants := _manquants || 'SALES_REVENUE'::text; END IF;
  IF COALESCE(NEW.tax_amount,0) > 0 AND _vat IS NULL THEN
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
  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  VALUES (_entry_id, _rev, 0, NEW.subtotal, 'CR Ventes HT');
  IF COALESCE(NEW.tax_amount,0) > 0 THEN
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _vat, 0, NEW.tax_amount, 'CR TVA collectée');
  END IF;

  UPDATE public.journal_entries
    SET status = 'posted', posted_by = NEW.created_by, posted_at = now()
    WHERE id = _entry_id;

  NEW.journal_entry_id := _entry_id;
  RETURN NEW;
END; $$;


CREATE OR REPLACE FUNCTION public.on_ap_payment_recorded() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _entry_id uuid; _entry_number text;
  _payable uuid; _bank uuid; _ar uuid;
  _manquants text[] := '{}';
BEGIN
  IF NEW.payment_type = 'ap_payment' AND NEW.ap_invoice_id IS NOT NULL THEN
    _payable := public.posting_account(NEW.tenant_id, 'AP_PAYABLE');
    _bank    := public.posting_account(NEW.tenant_id, 'BANK');

    IF _payable IS NULL THEN _manquants := _manquants || 'AP_PAYABLE'::text; END IF;
    IF _bank    IS NULL THEN _manquants := _manquants || 'BANK'::text; END IF;
    IF cardinality(_manquants) > 0 THEN
      RAISE EXCEPTION 'Paramétrage comptable incomplet : % ; le paiement fournisseur ne peut pas être enregistré',
        public.posting_roles_label(_manquants)
        USING ERRCODE = 'QG001',
              HINT = 'Associer un compte actif à chaque rôle dans le paramétrage comptable.';
    END IF;

    _entry_number := 'JE-PAY-AP-' || to_char(now(),'YYYYMMDD') || '-' || substr(NEW.id::text,1,8);
    INSERT INTO public.journal_entries (tenant_id, entry_number, description, source, status, created_by)
    VALUES (NEW.tenant_id, _entry_number, 'AP Payment: '||COALESCE(NEW.reference, NEW.id::text), 'ap_payment', 'draft', NEW.created_by)
    RETURNING id INTO _entry_id;
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _payable, NEW.amount, 0, 'DR Fournisseurs');
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _bank, 0, NEW.amount, 'CR Banque');
    UPDATE public.journal_entries SET status='posted', posted_by=NEW.created_by, posted_at=now() WHERE id=_entry_id;
  END IF;

  IF NEW.payment_type = 'ar_receipt' AND NEW.ar_invoice_id IS NOT NULL THEN
    _bank := public.posting_account(NEW.tenant_id, 'BANK');
    _ar   := public.posting_account(NEW.tenant_id, 'AR_RECEIVABLE');

    IF _bank IS NULL THEN _manquants := _manquants || 'BANK'::text; END IF;
    IF _ar   IS NULL THEN _manquants := _manquants || 'AR_RECEIVABLE'::text; END IF;
    IF cardinality(_manquants) > 0 THEN
      RAISE EXCEPTION 'Paramétrage comptable incomplet : % ; l''encaissement ne peut pas être enregistré',
        public.posting_roles_label(_manquants)
        USING ERRCODE = 'QG001',
              HINT = 'Associer un compte actif à chaque rôle dans le paramétrage comptable.';
    END IF;

    _entry_number := 'JE-REC-AR-' || to_char(now(),'YYYYMMDD') || '-' || substr(NEW.id::text,1,8);
    INSERT INTO public.journal_entries (tenant_id, entry_number, description, source, status, created_by)
    VALUES (NEW.tenant_id, _entry_number, 'AR Receipt: '||COALESCE(NEW.reference, NEW.id::text), 'ar_receipt', 'draft', NEW.created_by)
    RETURNING id INTO _entry_id;
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _bank, NEW.amount, 0, 'DR Banque');
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _ar, 0, NEW.amount, 'CR Clients');
    UPDATE public.journal_entries SET status='posted', posted_by=NEW.created_by, posted_at=now() WHERE id=_entry_id;
  END IF;

  RETURN NEW;
END; $$;

-- ─── Sécurité ───

-- Référentiels : lecture pour tous les utilisateurs authentifiés, écriture réservée au
-- propriétaire (migrations). Les droits par défaut de V15 accordent l'écriture aux
-- nouvelles tables : on la retire explicitement, la RLS n'étant qu'une seconde barrière.
ALTER TABLE public.accounting_frameworks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_framework_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posting_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_framework_role_defaults ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture du référentiel" ON public.accounting_frameworks FOR SELECT TO authenticated USING (true);
CREATE POLICY "Lecture du référentiel" ON public.accounting_framework_accounts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Lecture du référentiel" ON public.posting_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Lecture du référentiel" ON public.accounting_framework_role_defaults FOR SELECT TO authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE ON public.accounting_frameworks, public.accounting_framework_accounts,
  public.posting_roles, public.accounting_framework_role_defaults FROM authenticated;

-- Paramétrage de société : lecture dans la société, écriture par son administrateur.
ALTER TABLE public.tenant_accounting_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_posting_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON public.tenant_accounting_settings FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Tenant isolation" ON public.tenant_posting_accounts FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Administrateur de la société" ON public.tenant_posting_accounts FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.is_tenant_admin())
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.is_tenant_admin());
-- Le référentiel d'une société ne se pose que par apply_accounting_framework().
REVOKE INSERT, UPDATE, DELETE ON public.tenant_accounting_settings FROM authenticated;

-- PostgreSQL accorde EXECUTE à PUBLIC sur toute nouvelle fonction (V15 ne couvre
-- que les fonctions existantes) : on referme, puis on ouvre le strict nécessaire.
REVOKE ALL ON FUNCTION public.is_tenant_admin(), public.posting_account(uuid, text),
  public.posting_roles_label(text[]), public.apply_accounting_framework_to(uuid, text, uuid),
  public.apply_accounting_framework(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_tenant_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_accounting_framework(text) TO authenticated, service_role;
-- posting_account, posting_roles_label, apply_accounting_framework_to : propriétaire
-- seulement (appelées depuis des fonctions SECURITY DEFINER).

-- Supabase accorde par défaut tables et fonctions nouvelles au rôle `anon` (droits
-- explicites, que REVOKE ... FROM PUBLIC ne retire pas). Sans effet côté API, où
-- `anon` n'a aucun droit (V15) ; indispensable côté Supabase.
REVOKE ALL ON public.accounting_frameworks, public.accounting_framework_accounts,
  public.posting_roles, public.accounting_framework_role_defaults,
  public.tenant_accounting_settings, public.tenant_posting_accounts FROM anon;
REVOKE ALL ON FUNCTION public.is_tenant_admin(), public.posting_account(uuid, text),
  public.posting_roles_label(text[]), public.apply_accounting_framework_to(uuid, text, uuid),
  public.apply_accounting_framework(text) FROM anon;
