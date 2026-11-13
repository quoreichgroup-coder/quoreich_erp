-- V23 — Rôles centralisés : un seul modèle d'autorisations, lu partout. Écrit à la main.
--
-- POURQUOI
-- Trois systèmes coexistaient : user_roles (50 rôles d'un enum, seul système réellement
-- appliqué, par has_role() et 6 fonctions has_*_perm où la correspondance action → rôles était
-- écrite en dur), 11 fichiers *-roles.ts qui en recopiaient la logique côté écran, et la matrice
-- de /settings (erp_roles, erp_permissions, user_role_assignments) qui ne protégeait rien.
-- has_role() ignorait de plus la société : un rôle détenu ailleurs valait partout.
--
-- MODÈLE (rôles PFCG de SAP, profils fonctionnels de Sage X3)
--   erp_permission_catalog        droits fins « module.action » (global, lecture seule)
--   erp_system_role_permissions   droits des 50 rôles système (global, lecture seule)
--   erp_roles                     rôles de la société : les 50 rôles système (code = valeur de
--                                 l'enum, intouchables) et les rôles sur mesure
--   erp_role_permissions          droits d'un rôle (rôles sur mesure : administrateur)
--   user_role_assignments         qui a quel rôle, dans quelle société
--
-- CE QUI CHANGE, CE QUI NE CHANGE PAS
--   - has_role(), has_permission() et les 6 has_*_perm lisent désormais ce modèle, LIMITÉ À LA
--     SOCIÉTÉ de l'utilisateur. Les 157 politiques ne changent pas.
--   - Les droits d'aujourd'hui sont reproduits à l'identique : chaque affectation user_roles
--     est reprise, et les rôles système reçoivent exactement les actions que leur donnaient les
--     fonctions SQL (y compris les actions réservées de fait à admin : hr.manage_employees,
--     hr.run_payroll, hr.view_payroll, inventory.close). Les anciennes fonctions sont gardées
--     sous le nom legacy_* comme témoins : AutorisationsEquivalenceIT compare l'ancien et le
--     nouveau résultat pour chaque rôle et chaque action. Elles seront retirées avec user_roles.
--   - Deux resserrements voulus : un rôle ne vaut que dans sa société ; une action inconnue du
--     catalogue est refusée, y compris à admin (une faute de frappe ne donne plus tous les droits).
--   - Transition : les écrans de rôles actuels écrivent encore dans user_roles ; un déclencheur
--     recopie chaque écriture dans user_role_assignments.
--   - Les rôles sur mesure déjà créés dans la matrice gardent leurs affectations mais AUCUN droit
--     (needs_review) : leurs droits grossiers (« AR / Créer ») n'ont jamais rien protégé, les
--     activer d'office donnerait du jour au lendemain des droits que personne n'a vraiment accordés.
--   - erp_roles n'est plus modifiable que par l'administrateur de la société (sa politique
--     permettait à tout membre de la société d'écrire, sans conséquence tant que la matrice ne
--     protégeait rien).
--
-- Jumelle : supabase/migrations/20261113110000_2f8a6c4e-9b1d-4e3f-a7c5-6d0b8e2f4a91.sql

-- ─── Catalogue et rôles système (référentiel commun) ───

CREATE TABLE public.erp_permission_catalog (
    code text PRIMARY KEY CHECK (code ~ '^[a-z]+\.[a-z0-9_]+$'),
    module text NOT NULL,
    action text NOT NULL,
    label text NOT NULL,
    UNIQUE (module, action)
);

CREATE TABLE public.erp_system_roles (
    code text PRIMARY KEY,
    label text NOT NULL,
    module text NOT NULL
);

CREATE TABLE public.erp_system_role_permissions (
    role_code text NOT NULL REFERENCES public.erp_system_roles(code),
    permission_code text NOT NULL REFERENCES public.erp_permission_catalog(code),
    PRIMARY KEY (role_code, permission_code)
);

INSERT INTO public.erp_permission_catalog (code, module, action, label) VALUES
  ('crm.view', 'crm', 'view', 'Consulter le CRM'),
  ('crm.create', 'crm', 'create', 'Créer dans le CRM'),
  ('crm.edit', 'crm', 'edit', 'Modifier dans le CRM'),
  ('crm.delete', 'crm', 'delete', 'Supprimer dans le CRM'),
  ('crm.approve_discount', 'crm', 'approve_discount', 'Approuver une remise'),
  ('crm.convert', 'crm', 'convert', 'Convertir une opportunité'),
  ('crm.export', 'crm', 'export', 'Exporter le CRM'),
  ('crm.view_sensitive', 'crm', 'view_sensitive', 'Voir les données sensibles du CRM'),
  ('crm.audit', 'crm', 'audit', 'Auditer le CRM'),
  ('hr.create_payroll_run', 'hr', 'create_payroll_run', 'Créer un cycle de paie'),
  ('hr.approve_payroll_run', 'hr', 'approve_payroll_run', 'Approuver un cycle de paie'),
  ('hr.execute_payroll', 'hr', 'execute_payroll', 'Exécuter la paie'),
  ('hr.audit_payroll', 'hr', 'audit_payroll', 'Auditer la paie'),
  ('hr.export', 'hr', 'export', 'Exporter les données RH'),
  ('hr.view_sensitive', 'hr', 'view_sensitive', 'Voir les données RH sensibles'),
  ('hr.manage_employees', 'hr', 'manage_employees', 'Gérer les salariés'),
  ('hr.run_payroll', 'hr', 'run_payroll', 'Calculer la paie'),
  ('hr.view_payroll', 'hr', 'view_payroll', 'Consulter la paie'),
  ('inventory.move', 'inventory', 'move', 'Saisir un mouvement de stock'),
  ('inventory.adjust', 'inventory', 'adjust', 'Ajuster le stock'),
  ('inventory.transfer', 'inventory', 'transfer', 'Transférer du stock'),
  ('inventory.count', 'inventory', 'count', 'Saisir un inventaire'),
  ('inventory.post_count', 'inventory', 'post_count', 'Valider un inventaire'),
  ('inventory.close', 'inventory', 'close', 'Clôturer une période de stock'),
  ('procurement.approve_l1', 'procurement', 'approve_l1', 'Approuver un achat (niveau 1)'),
  ('procurement.approve_l2', 'procurement', 'approve_l2', 'Approuver un achat (niveau 2)'),
  ('procurement.approve_l3', 'procurement', 'approve_l3', 'Approuver un achat (niveau 3)'),
  ('procurement.convert', 'procurement', 'convert', 'Convertir une demande en commande'),
  ('procurement.3wm', 'procurement', '3wm', 'Valider le rapprochement à 3 voies'),
  ('sales.create', 'sales', 'create', 'Créer une commande de vente'),
  ('sales.confirm', 'sales', 'confirm', 'Confirmer une commande de vente'),
  ('sales.deliver', 'sales', 'deliver', 'Livrer une commande'),
  ('sales.invoice', 'sales', 'invoice', 'Facturer une commande'),
  ('treasury.create_txn', 'treasury', 'create_txn', 'Saisir une opération de trésorerie'),
  ('treasury.import_statement', 'treasury', 'import_statement', 'Importer un relevé bancaire'),
  ('treasury.match', 'treasury', 'match', 'Rapprocher des opérations'),
  ('treasury.validate_recon', 'treasury', 'validate_recon', 'Valider un rapprochement'),
  ('treasury.edit_forecast', 'treasury', 'edit_forecast', 'Modifier les prévisions'),
  ('treasury.manage_accounts', 'treasury', 'manage_accounts', 'Gérer les comptes bancaires'),
  ('treasury.export', 'treasury', 'export', 'Exporter la trésorerie'),
  ('treasury.view_sensitive', 'treasury', 'view_sensitive', 'Voir les données bancaires sensibles'),
  ('treasury.close_period', 'treasury', 'close_period', 'Clôturer une période de trésorerie'),
  ('treasury.audit', 'treasury', 'audit', 'Auditer la trésorerie');

INSERT INTO public.erp_system_roles (code, label, module) VALUES
  ('admin', 'Administrateur', 'general'),
  ('manager', 'Responsable', 'general'),
  ('accountant', 'Comptable', 'general'),
  ('viewer', 'Lecteur', 'general'),
  ('procurement_l1', 'Approbateur achats N1', 'procurement'),
  ('procurement_l2', 'Approbateur achats N2', 'procurement'),
  ('procurement_l3', 'Approbateur achats N3', 'procurement'),
  ('procurement_controller', 'Contrôleur achats', 'procurement'),
  ('procurement_3wm_approver', 'Approbateur rapprochement 3 voies', 'procurement'),
  ('sales_rep', 'Commercial', 'sales'),
  ('sales_manager', 'Responsable commercial', 'sales'),
  ('sales_controller', 'Contrôleur ventes', 'sales'),
  ('inventory_clerk', 'Magasinier', 'inventory'),
  ('inventory_manager', 'Responsable stock', 'inventory'),
  ('inventory_controller', 'Contrôleur stock', 'inventory'),
  ('treasury_clerk', 'Trésorier opérationnel', 'treasury'),
  ('treasury_manager', 'Responsable trésorerie', 'treasury'),
  ('treasury_controller', 'Contrôleur trésorerie', 'treasury'),
  ('cash_admin', 'Administrateur trésorerie', 'treasury'),
  ('asset_clerk', 'Gestionnaire immobilisations', 'assets'),
  ('asset_accountant', 'Comptable immobilisations', 'assets'),
  ('asset_controller', 'Contrôleur immobilisations', 'assets'),
  ('asset_admin', 'Administrateur immobilisations', 'assets'),
  ('budget_planner', 'Planificateur budgétaire', 'budget'),
  ('budget_approver', 'Approbateur budgétaire', 'budget'),
  ('budget_controller', 'Contrôleur budgétaire', 'budget'),
  ('budget_admin', 'Administrateur budget', 'budget'),
  ('project_planner', 'Planificateur projets', 'projects'),
  ('project_accountant', 'Comptable projets', 'projects'),
  ('project_controller', 'Contrôleur projets', 'projects'),
  ('project_admin', 'Administrateur projets', 'projects'),
  ('expense_clerk', 'Saisie notes de frais', 'expenses'),
  ('expense_approver', 'Approbateur notes de frais', 'expenses'),
  ('expense_controller', 'Contrôleur notes de frais', 'expenses'),
  ('expense_admin', 'Administrateur notes de frais', 'expenses'),
  ('compliance_officer', 'Responsable conformité', 'compliance'),
  ('compliance_auditor', 'Auditeur conformité', 'compliance'),
  ('compliance_admin', 'Administrateur conformité', 'compliance'),
  ('risk_owner', 'Propriétaire de risque', 'risk'),
  ('risk_assessor', 'Évaluateur de risques', 'risk'),
  ('risk_admin', 'Administrateur risques', 'risk'),
  ('hr_clerk', 'Gestionnaire RH', 'hr'),
  ('hr_approver', 'Approbateur RH', 'hr'),
  ('payroll_officer', 'Gestionnaire de paie', 'hr'),
  ('hr_auditor', 'Auditeur RH', 'hr'),
  ('hr_admin', 'Administrateur RH', 'hr'),
  ('crm_agent', 'Agent CRM', 'crm'),
  ('crm_manager', 'Responsable CRM', 'crm'),
  ('crm_admin', 'Administrateur CRM', 'crm'),
  ('crm_auditor', 'Auditeur CRM', 'crm');

-- Chaque rôle système doit exister dans l'enum : sinon has_role(uuid, app_role) ne pourrait pas
-- le désigner. Contrôle explicite plutôt que supposé.
DO $$
DECLARE _ecart text;
BEGIN
  SELECT string_agg(x, ', ') INTO _ecart FROM (
    SELECT e::text AS x FROM unnest(enum_range(NULL::public.app_role)) e
    EXCEPT SELECT code FROM public.erp_system_roles
    UNION ALL
    SELECT code FROM public.erp_system_roles
    EXCEPT SELECT e::text FROM unnest(enum_range(NULL::public.app_role)) e) d;
  IF _ecart IS NOT NULL THEN
    RAISE EXCEPTION 'Rôles système et enum app_role divergent : %', _ecart;
  END IF;
END $$;

-- Droits des rôles système : exactement ceux des fonctions has_*_perm du schéma d'origine.
INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
SELECT 'admin', code FROM public.erp_permission_catalog;   -- admin : tout
INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
SELECT r, code FROM public.erp_permission_catalog c
JOIN (VALUES ('crm_admin', 'crm'), ('hr_admin', 'hr'), ('cash_admin', 'treasury')) AS v(r, m) ON c.module = v.m;
INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
SELECT v.r, v.m || '.' || a FROM (VALUES
  ('crm_agent', 'crm', ARRAY['view','create','edit']),
  ('crm_manager', 'crm', ARRAY['view','create','edit','delete','approve_discount','convert','export','view_sensitive']),
  ('crm_auditor', 'crm', ARRAY['view','export','view_sensitive','audit']),
  ('hr_clerk', 'hr', ARRAY['create_payroll_run','view_sensitive']),
  ('hr_approver', 'hr', ARRAY['approve_payroll_run','export','view_sensitive']),
  ('payroll_officer', 'hr', ARRAY['execute_payroll','export','view_sensitive']),
  ('hr_auditor', 'hr', ARRAY['audit_payroll','export','view_sensitive']),
  ('inventory_clerk', 'inventory', ARRAY['move','transfer','count']),
  ('inventory_manager', 'inventory', ARRAY['move','adjust','transfer','count','post_count']),
  ('inventory_controller', 'inventory', ARRAY['move','adjust','transfer','count','post_count']),
  ('procurement_l1', 'procurement', ARRAY['approve_l1']),
  ('procurement_l2', 'procurement', ARRAY['approve_l1','approve_l2','convert']),
  ('procurement_l3', 'procurement', ARRAY['approve_l1','approve_l2','approve_l3','convert']),
  ('procurement_controller', 'procurement', ARRAY['convert','3wm']),
  ('procurement_3wm_approver', 'procurement', ARRAY['3wm']),
  ('sales_rep', 'sales', ARRAY['create','deliver']),
  ('sales_manager', 'sales', ARRAY['create','confirm','deliver','invoice']),
  ('sales_controller', 'sales', ARRAY['confirm','deliver','invoice']),
  ('treasury_clerk', 'treasury', ARRAY['create_txn','import_statement','match','view_sensitive']),
  ('treasury_manager', 'treasury', ARRAY['create_txn','import_statement','match','validate_recon','edit_forecast',
                                         'manage_accounts','export','view_sensitive','close_period','audit']),
  ('treasury_controller', 'treasury', ARRAY['validate_recon','edit_forecast','export','view_sensitive','close_period','audit'])
) AS v(r, m, actions), unnest(v.actions) AS a;

-- ─── Rôles de société ───

ALTER TABLE public.erp_roles ADD COLUMN code text REFERENCES public.erp_system_roles(code);
ALTER TABLE public.erp_roles ADD COLUMN needs_review boolean NOT NULL DEFAULT false;
-- Un rôle système par code et par société ; un rôle sur mesure n'a pas de code.
CREATE UNIQUE INDEX erp_roles_tenant_code_key ON public.erp_roles (tenant_id, code) WHERE code IS NOT NULL;
ALTER TABLE public.erp_roles ADD CONSTRAINT erp_roles_system_has_code CHECK (is_system = (code IS NOT NULL));

CREATE TABLE public.erp_role_permissions (
    role_id uuid NOT NULL REFERENCES public.erp_roles(id) ON DELETE CASCADE,
    permission_code text NOT NULL REFERENCES public.erp_permission_catalog(code),
    PRIMARY KEY (role_id, permission_code)
);
CREATE INDEX erp_role_permissions_code_idx ON public.erp_role_permissions (permission_code);
CREATE INDEX user_role_assignments_role_idx ON public.user_role_assignments (role_id);

-- Rôles sur mesure existants : gardés, sans droit actif, à revoir.
UPDATE public.erp_roles SET needs_review = true WHERE NOT is_system;

-- Les 50 rôles système d'une société, avec leurs droits. Idempotent. Un nom déjà pris par un
-- rôle sur mesure reçoit le suffixe « (système) » plutôt que d'écraser quoi que ce soit.
CREATE FUNCTION public.seed_tenant_system_roles(_tenant uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  -- Marqueur de session : la garde des rôles système laisse passer cette initialisation, et
  -- seulement elle (un BEFORE INSERT se déclenche même quand ON CONFLICT écartera la ligne).
  PERFORM set_config('qerp.system_roles_seed', 'on', true);

  INSERT INTO public.erp_roles (tenant_id, name, description, is_system, code)
  SELECT _tenant,
         CASE WHEN EXISTS (SELECT 1 FROM public.erp_roles x WHERE x.tenant_id = _tenant AND x.name = s.label AND x.code IS DISTINCT FROM s.code)
              THEN s.label || ' (système)' ELSE s.label END,
         'Rôle système', true, s.code
  FROM public.erp_system_roles s
  WHERE NOT EXISTS (SELECT 1 FROM public.erp_roles r WHERE r.tenant_id = _tenant AND r.code = s.code);

  INSERT INTO public.erp_role_permissions (role_id, permission_code)
  SELECT r.id, p.permission_code
  FROM public.erp_roles r JOIN public.erp_system_role_permissions p ON p.role_code = r.code
  WHERE r.tenant_id = _tenant
  ON CONFLICT DO NOTHING;

  PERFORM set_config('qerp.system_roles_seed', 'off', true);
END; $$;

CREATE FUNCTION public.on_tenant_seed_system_roles() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  PERFORM public.seed_tenant_system_roles(NEW.id);
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_seed_system_roles AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.on_tenant_seed_system_roles();

SELECT public.seed_tenant_system_roles(id) FROM public.tenants;

-- Reprise des affectations : chaque user_roles rattaché à une société devient une affectation
-- au rôle système de même code. (Un user_roles sans société ne donne plus aucun droit : il
-- n'en existe aucun dans les données du 9 novembre 2026.)
INSERT INTO public.user_role_assignments (user_id, role_id, tenant_id)
SELECT ur.user_id, r.id, ur.tenant_id
FROM public.user_roles ur
JOIN public.erp_roles r ON r.tenant_id = ur.tenant_id AND r.code = ur.role::text
ON CONFLICT (user_id, role_id) DO NOTHING;

-- Transition : les écrans de rôles actuels écrivent dans user_roles ; on recopie.
CREATE FUNCTION public.mirror_user_roles() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'UPDATE') AND OLD.tenant_id IS NOT NULL THEN
    DELETE FROM public.user_role_assignments a USING public.erp_roles r
     WHERE a.role_id = r.id AND a.user_id = OLD.user_id
       AND r.tenant_id = OLD.tenant_id AND r.code = OLD.role::text;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.tenant_id IS NOT NULL THEN
    PERFORM public.seed_tenant_system_roles(NEW.tenant_id);
    INSERT INTO public.user_role_assignments (user_id, role_id, tenant_id)
    SELECT NEW.user_id, r.id, NEW.tenant_id FROM public.erp_roles r
     WHERE r.tenant_id = NEW.tenant_id AND r.code = NEW.role::text
    ON CONFLICT (user_id, role_id) DO NOTHING;
  END IF;
  RETURN NULL;
END; $$;
CREATE TRIGGER trg_mirror_user_roles AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.mirror_user_roles();

-- Un rôle système ne se modifie pas et ne se supprime pas ; ses droits non plus.
CREATE FUNCTION public.guard_system_roles() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE _system boolean;
BEGIN
  IF current_setting('qerp.system_roles_seed', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_TABLE_NAME = 'erp_roles' THEN
    IF OLD.is_system AND (TG_OP = 'DELETE' OR NEW.code IS DISTINCT FROM OLD.code
         OR NEW.is_system IS DISTINCT FROM OLD.is_system OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id) THEN
      -- La suppression en cascade d'une société reste possible.
      IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = OLD.tenant_id) THEN RETURN OLD; END IF;
      RAISE EXCEPTION 'Un rôle système ne se modifie pas : créer un rôle sur mesure' USING ERRCODE = '23514';
    END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;
  -- erp_role_permissions : les droits d'un rôle système viennent du référentiel, et de lui seul.
  SELECT is_system INTO _system FROM public.erp_roles WHERE id = COALESCE(NEW.role_id, OLD.role_id);
  IF _system THEN
    -- Suppression en cascade du rôle (société supprimée) : laissée passer.
    IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.tenants t JOIN public.erp_roles r ON r.tenant_id = t.id
                                        WHERE r.id = OLD.role_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Les droits d''un rôle système ne se modifient pas : créer un rôle sur mesure' USING ERRCODE = '23514';
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$;
CREATE TRIGGER trg_guard_system_roles BEFORE UPDATE OR DELETE ON public.erp_roles
  FOR EACH ROW EXECUTE FUNCTION public.guard_system_roles();
CREATE TRIGGER trg_guard_system_role_permissions BEFORE INSERT OR UPDATE OR DELETE ON public.erp_role_permissions
  FOR EACH ROW EXECUTE FUNCTION public.guard_system_roles();

-- ─── Témoins de transition : les fonctions d'origine, à l'identique, sous un autre nom ───
-- Générées depuis V8 (seul has_role y est renommé en legacy_has_role). Utilisées uniquement par
-- AutorisationsEquivalenceIT ; aucun droit d'exécution pour les rôles applicatifs.

CREATE FUNCTION public.legacy_has_role(_user_id uuid, _role public.app_role) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE FUNCTION public.legacy_has_crm_perm(_user_id uuid, _action text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT CASE
    WHEN public.legacy_has_role(_user_id, 'admin'::public.app_role)
      OR public.legacy_has_role(_user_id, 'crm_admin'::public.app_role) THEN TRUE
    ELSE CASE _action
      WHEN 'view' THEN
        public.legacy_has_role(_user_id, 'crm_agent'::public.app_role)
        OR public.legacy_has_role(_user_id, 'crm_manager'::public.app_role)
        OR public.legacy_has_role(_user_id, 'crm_auditor'::public.app_role)
      WHEN 'create' THEN
        public.legacy_has_role(_user_id, 'crm_agent'::public.app_role)
        OR public.legacy_has_role(_user_id, 'crm_manager'::public.app_role)
      WHEN 'edit' THEN
        public.legacy_has_role(_user_id, 'crm_agent'::public.app_role)
        OR public.legacy_has_role(_user_id, 'crm_manager'::public.app_role)
      WHEN 'delete' THEN public.legacy_has_role(_user_id, 'crm_manager'::public.app_role)
      WHEN 'approve_discount' THEN public.legacy_has_role(_user_id, 'crm_manager'::public.app_role)
      WHEN 'convert' THEN public.legacy_has_role(_user_id, 'crm_manager'::public.app_role)
      WHEN 'export' THEN
        public.legacy_has_role(_user_id, 'crm_manager'::public.app_role)
        OR public.legacy_has_role(_user_id, 'crm_auditor'::public.app_role)
      WHEN 'view_sensitive' THEN
        public.legacy_has_role(_user_id, 'crm_manager'::public.app_role)
        OR public.legacy_has_role(_user_id, 'crm_auditor'::public.app_role)
      WHEN 'audit' THEN public.legacy_has_role(_user_id, 'crm_auditor'::public.app_role)
      ELSE FALSE
    END
  END;
$$;

CREATE FUNCTION public.legacy_has_hr_perm(_user_id uuid, _action text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    public.legacy_has_role(_user_id, 'admin'::public.app_role)
    OR public.legacy_has_role(_user_id, 'hr_admin'::public.app_role)
    OR CASE _action
      WHEN 'create_payroll_run'  THEN public.legacy_has_role(_user_id, 'hr_clerk'::public.app_role)
      WHEN 'approve_payroll_run' THEN public.legacy_has_role(_user_id, 'hr_approver'::public.app_role)
      WHEN 'execute_payroll'     THEN public.legacy_has_role(_user_id, 'payroll_officer'::public.app_role)
      WHEN 'audit_payroll'       THEN public.legacy_has_role(_user_id, 'hr_auditor'::public.app_role)
      WHEN 'export'              THEN public.legacy_has_role(_user_id, 'hr_approver'::public.app_role)
                                   OR public.legacy_has_role(_user_id, 'payroll_officer'::public.app_role)
                                   OR public.legacy_has_role(_user_id, 'hr_auditor'::public.app_role)
      WHEN 'view_sensitive'      THEN public.legacy_has_role(_user_id, 'hr_clerk'::public.app_role)
                                   OR public.legacy_has_role(_user_id, 'hr_approver'::public.app_role)
                                   OR public.legacy_has_role(_user_id, 'payroll_officer'::public.app_role)
                                   OR public.legacy_has_role(_user_id, 'hr_auditor'::public.app_role)
      ELSE false
    END
$$;

CREATE FUNCTION public.legacy_has_inventory_perm(_user_id uuid, _action text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    public.legacy_has_role(_user_id, 'admin'::public.app_role)
    OR CASE _action
      WHEN 'move'      THEN public.legacy_has_role(_user_id,'inventory_clerk'::public.app_role)
                         OR public.legacy_has_role(_user_id,'inventory_manager'::public.app_role)
                         OR public.legacy_has_role(_user_id,'inventory_controller'::public.app_role)
      WHEN 'adjust'    THEN public.legacy_has_role(_user_id,'inventory_manager'::public.app_role)
                         OR public.legacy_has_role(_user_id,'inventory_controller'::public.app_role)
      WHEN 'transfer'  THEN public.legacy_has_role(_user_id,'inventory_clerk'::public.app_role)
                         OR public.legacy_has_role(_user_id,'inventory_manager'::public.app_role)
                         OR public.legacy_has_role(_user_id,'inventory_controller'::public.app_role)
      WHEN 'count'     THEN public.legacy_has_role(_user_id,'inventory_clerk'::public.app_role)
                         OR public.legacy_has_role(_user_id,'inventory_manager'::public.app_role)
                         OR public.legacy_has_role(_user_id,'inventory_controller'::public.app_role)
      WHEN 'post_count' THEN public.legacy_has_role(_user_id,'inventory_manager'::public.app_role)
                          OR public.legacy_has_role(_user_id,'inventory_controller'::public.app_role)
      ELSE false
    END
$$;

CREATE FUNCTION public.legacy_has_procurement_perm(_user_id uuid, _action text, _level integer DEFAULT NULL::integer) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    public.legacy_has_role(_user_id, 'admin'::public.app_role)
    OR CASE _action
      WHEN 'approve_l1' THEN public.legacy_has_role(_user_id, 'procurement_l1'::public.app_role)
                          OR public.legacy_has_role(_user_id, 'procurement_l2'::public.app_role)
                          OR public.legacy_has_role(_user_id, 'procurement_l3'::public.app_role)
      WHEN 'approve_l2' THEN public.legacy_has_role(_user_id, 'procurement_l2'::public.app_role)
                          OR public.legacy_has_role(_user_id, 'procurement_l3'::public.app_role)
      WHEN 'approve_l3' THEN public.legacy_has_role(_user_id, 'procurement_l3'::public.app_role)
      WHEN 'convert'    THEN public.legacy_has_role(_user_id, 'procurement_controller'::public.app_role)
                          OR public.legacy_has_role(_user_id, 'procurement_l2'::public.app_role)
                          OR public.legacy_has_role(_user_id, 'procurement_l3'::public.app_role)
      WHEN '3wm'        THEN public.legacy_has_role(_user_id, 'procurement_3wm_approver'::public.app_role)
                          OR public.legacy_has_role(_user_id, 'procurement_controller'::public.app_role)
      ELSE false
    END
$$;

CREATE FUNCTION public.legacy_has_sales_perm(_user_id uuid, _action text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    public.legacy_has_role(_user_id,'admin'::public.app_role)
    OR CASE _action
      WHEN 'create'  THEN public.legacy_has_role(_user_id,'sales_rep'::public.app_role)
                       OR public.legacy_has_role(_user_id,'sales_manager'::public.app_role)
      WHEN 'confirm' THEN public.legacy_has_role(_user_id,'sales_manager'::public.app_role)
                       OR public.legacy_has_role(_user_id,'sales_controller'::public.app_role)
      WHEN 'deliver' THEN public.legacy_has_role(_user_id,'sales_rep'::public.app_role)
                       OR public.legacy_has_role(_user_id,'sales_manager'::public.app_role)
                       OR public.legacy_has_role(_user_id,'sales_controller'::public.app_role)
      WHEN 'invoice' THEN public.legacy_has_role(_user_id,'sales_manager'::public.app_role)
                       OR public.legacy_has_role(_user_id,'sales_controller'::public.app_role)
      ELSE false
    END
$$;

CREATE FUNCTION public.legacy_has_treasury_perm(_user_id uuid, _action text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    public.legacy_has_role(_user_id, 'admin'::public.app_role)
    OR public.legacy_has_role(_user_id, 'cash_admin'::public.app_role)
    OR CASE _action
      WHEN 'create_txn'       THEN public.legacy_has_role(_user_id,'treasury_clerk'::public.app_role)
                                OR public.legacy_has_role(_user_id,'treasury_manager'::public.app_role)
      WHEN 'import_statement' THEN public.legacy_has_role(_user_id,'treasury_clerk'::public.app_role)
                                OR public.legacy_has_role(_user_id,'treasury_manager'::public.app_role)
      WHEN 'match'            THEN public.legacy_has_role(_user_id,'treasury_clerk'::public.app_role)
                                OR public.legacy_has_role(_user_id,'treasury_manager'::public.app_role)
      WHEN 'validate_recon'   THEN public.legacy_has_role(_user_id,'treasury_manager'::public.app_role)
                                OR public.legacy_has_role(_user_id,'treasury_controller'::public.app_role)
      WHEN 'edit_forecast'    THEN public.legacy_has_role(_user_id,'treasury_manager'::public.app_role)
                                OR public.legacy_has_role(_user_id,'treasury_controller'::public.app_role)
      WHEN 'manage_accounts'  THEN public.legacy_has_role(_user_id,'treasury_manager'::public.app_role)
      WHEN 'export'           THEN public.legacy_has_role(_user_id,'treasury_manager'::public.app_role)
                                OR public.legacy_has_role(_user_id,'treasury_controller'::public.app_role)
      WHEN 'view_sensitive'   THEN public.legacy_has_role(_user_id,'treasury_clerk'::public.app_role)
                                OR public.legacy_has_role(_user_id,'treasury_manager'::public.app_role)
                                OR public.legacy_has_role(_user_id,'treasury_controller'::public.app_role)
      WHEN 'close_period'     THEN public.legacy_has_role(_user_id,'treasury_controller'::public.app_role)
                                OR public.legacy_has_role(_user_id,'treasury_manager'::public.app_role)
      WHEN 'audit'            THEN public.legacy_has_role(_user_id,'treasury_controller'::public.app_role)
                                OR public.legacy_has_role(_user_id,'treasury_manager'::public.app_role)
      ELSE false
    END
$$;

-- ─── Contrôles : un seul modèle, limité à la société de l'utilisateur ───

CREATE FUNCTION public.has_permission(_user_id uuid, _code text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_role_assignments a
    JOIN public.erp_roles r ON r.id = a.role_id AND r.tenant_id = a.tenant_id
    JOIN public.erp_role_permissions p ON p.role_id = r.id
    WHERE a.user_id = _user_id
      AND a.tenant_id = public.get_user_tenant_id(_user_id)
      AND NOT r.needs_review
      AND p.permission_code = _code)
$$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_role_assignments a
    JOIN public.erp_roles r ON r.id = a.role_id AND r.tenant_id = a.tenant_id
    WHERE a.user_id = _user_id
      AND a.tenant_id = public.get_user_tenant_id(_user_id)
      AND r.code = _role::text)
$$;

CREATE OR REPLACE FUNCTION public.has_crm_perm(_user_id uuid, _action text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
    AS $$ SELECT public.has_permission(_user_id, 'crm.' || _action) $$;
CREATE OR REPLACE FUNCTION public.has_hr_perm(_user_id uuid, _action text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
    AS $$ SELECT public.has_permission(_user_id, 'hr.' || _action) $$;
CREATE OR REPLACE FUNCTION public.has_inventory_perm(_user_id uuid, _action text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
    AS $$ SELECT public.has_permission(_user_id, 'inventory.' || _action) $$;
-- _level n'était pas lu par la fonction d'origine ; la signature est conservée.
CREATE OR REPLACE FUNCTION public.has_procurement_perm(_user_id uuid, _action text, _level integer DEFAULT NULL::integer) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
    AS $$ SELECT public.has_permission(_user_id, 'procurement.' || _action) $$;
CREATE OR REPLACE FUNCTION public.has_sales_perm(_user_id uuid, _action text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
    AS $$ SELECT public.has_permission(_user_id, 'sales.' || _action) $$;
CREATE OR REPLACE FUNCTION public.has_treasury_perm(_user_id uuid, _action text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
    AS $$ SELECT public.has_permission(_user_id, 'treasury.' || _action) $$;

-- Les contrôles de V18/V19 lisaient user_roles directement : ils passent par le modèle unique.
CREATE OR REPLACE FUNCTION public.is_tenant_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
    AS $$ SELECT public.has_role(auth.uid(), 'admin'::public.app_role) $$;
CREATE OR REPLACE FUNCTION public.tenant_has_any_role(_roles text[]) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_role_assignments a
    JOIN public.erp_roles r ON r.id = a.role_id AND r.tenant_id = a.tenant_id
    WHERE a.user_id = auth.uid()
      AND a.tenant_id = public.get_user_tenant_id(auth.uid())
      AND r.code = ANY (_roles))
$$;

-- ─── Sécurité ───

ALTER TABLE public.erp_permission_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_system_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_system_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_role_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture du référentiel" ON public.erp_permission_catalog FOR SELECT TO authenticated USING (true);
CREATE POLICY "Lecture du référentiel" ON public.erp_system_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Lecture du référentiel" ON public.erp_system_role_permissions FOR SELECT TO authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE ON public.erp_permission_catalog, public.erp_system_roles,
  public.erp_system_role_permissions FROM authenticated;

CREATE POLICY "Tenant isolation" ON public.erp_role_permissions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.erp_roles r WHERE r.id = erp_role_permissions.role_id
                 AND r.tenant_id = public.get_user_tenant_id(auth.uid())));
CREATE POLICY "Administrateur de la société" ON public.erp_role_permissions FOR ALL TO authenticated
  USING (public.is_tenant_admin() AND EXISTS (SELECT 1 FROM public.erp_roles r WHERE r.id = erp_role_permissions.role_id
                 AND r.tenant_id = public.get_user_tenant_id(auth.uid())))
  WITH CHECK (public.is_tenant_admin() AND EXISTS (SELECT 1 FROM public.erp_roles r WHERE r.id = erp_role_permissions.role_id
                 AND r.tenant_id = public.get_user_tenant_id(auth.uid())));

-- erp_roles : lecture dans la société, écriture par son administrateur (l'ancienne politique
-- « Tenant isolation » couvrait toutes les commandes pour tout membre de la société).
DROP POLICY "Tenant isolation" ON public.erp_roles;
CREATE POLICY "Tenant isolation" ON public.erp_roles FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Administrateur de la société" ON public.erp_roles FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.is_tenant_admin())
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.is_tenant_admin());

REVOKE ALL ON FUNCTION public.has_permission(uuid, text), public.seed_tenant_system_roles(uuid),
  public.on_tenant_seed_system_roles(), public.mirror_user_roles(), public.guard_system_roles(),
  public.legacy_has_role(uuid, public.app_role), public.legacy_has_crm_perm(uuid, text),
  public.legacy_has_hr_perm(uuid, text), public.legacy_has_inventory_perm(uuid, text),
  public.legacy_has_procurement_perm(uuid, text, integer), public.legacy_has_sales_perm(uuid, text),
  public.legacy_has_treasury_perm(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_permission(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.legacy_has_role(uuid, public.app_role), public.legacy_has_crm_perm(uuid, text),
  public.legacy_has_hr_perm(uuid, text), public.legacy_has_inventory_perm(uuid, text),
  public.legacy_has_procurement_perm(uuid, text, integer), public.legacy_has_sales_perm(uuid, text),
  public.legacy_has_treasury_perm(uuid, text) FROM authenticated;

REVOKE ALL ON public.erp_permission_catalog, public.erp_system_roles, public.erp_system_role_permissions,
  public.erp_role_permissions FROM anon;
REVOKE ALL ON FUNCTION public.has_permission(uuid, text), public.seed_tenant_system_roles(uuid),
  public.on_tenant_seed_system_roles(), public.mirror_user_roles(), public.guard_system_roles(),
  public.legacy_has_role(uuid, public.app_role), public.legacy_has_crm_perm(uuid, text),
  public.legacy_has_hr_perm(uuid, text), public.legacy_has_inventory_perm(uuid, text),
  public.legacy_has_procurement_perm(uuid, text, integer), public.legacy_has_sales_perm(uuid, text),
  public.legacy_has_treasury_perm(uuid, text) FROM anon;
