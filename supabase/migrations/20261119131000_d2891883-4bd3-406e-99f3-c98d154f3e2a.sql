-- V111 — Projets : projet = valeur analytique, budget par compte, réalisé et engagé lus dans la comptabilité.
--
-- Avant : tables sans règle (projets, coûts saisis à la main), politiques FOR ALL ouvertes à tout membre,
-- aucun lien avec la comptabilité ; écrans de démonstration. Aucun projet n'existait.
-- Références : SAP PS (le projet / l'élément d'OTP porte budget, engagements et coûts réels issus des
-- imputations des pièces), Sage X3 (affaires : section analytique dédiée, budget, réalisé par nature,
-- facturation), SYSCOHADA (comptabilité analytique de gestion, facultative et propre à l'entreprise).
--
-- Choix : un projet est une valeur de l'axe analytique « projets » choisi par la société (paramètre),
-- créée avec le projet. Ainsi tout ce qui sait porter une section — demandes et commandes d'achat,
-- factures fournisseurs et clients, écritures manuelles, budgets, et désormais les notes de frais —
-- s'impute au projet sans table de coûts parallèle : le réalisé est la somme des écritures
-- comptabilisées portant la valeur (charges en classe 6, produits en classe 7), l'engagé celle des
-- commandes en cours. L'ancienne table project_costs (saisie libre, jamais comptabilisée) n'est plus écrite.

-- ─── Droits du catalogue ───
INSERT INTO public.erp_permission_catalog (code, module, action, label) VALUES
  ('projects.manage', 'projects', 'manage', 'Créer et modifier les projets'),
  ('projects.budget', 'projects', 'budget', 'Établir le budget des projets'),
  ('projects.close', 'projects', 'close', 'Suspendre, clôturer ou rouvrir un projet'),
  ('projects.settings', 'projects', 'settings', 'Paramétrer le module Projets'),
  ('projects.export', 'projects', 'export', 'Exporter les données des projets')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
SELECT v.r, v.p FROM (VALUES
  ('admin', 'projects.manage'), ('admin', 'projects.budget'), ('admin', 'projects.close'), ('admin', 'projects.settings'), ('admin', 'projects.export'),
  ('project_admin', 'projects.manage'), ('project_admin', 'projects.budget'), ('project_admin', 'projects.close'), ('project_admin', 'projects.settings'), ('project_admin', 'projects.export'),
  ('project_planner', 'projects.manage'), ('project_planner', 'projects.budget'), ('project_planner', 'projects.export'),
  ('project_controller', 'projects.budget'), ('project_controller', 'projects.close'), ('project_controller', 'projects.export'),
  ('project_accountant', 'projects.export'), ('accountant', 'projects.export'), ('manager', 'projects.export')) AS v(r, p)
 WHERE EXISTS (SELECT 1 FROM public.erp_system_roles s WHERE s.code = v.r)
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, sp.permission_code
  FROM public.erp_roles r
  JOIN public.erp_system_role_permissions sp ON sp.role_code = r.code
 WHERE r.is_system AND sp.permission_code LIKE 'projects.%'
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

-- ─── Paramètres ───
CREATE TABLE public.project_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_axis_id uuid NOT NULL,
  include_requisitions_in_commitments boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT auth.uid(),
  FOREIGN KEY (project_axis_id) REFERENCES public.analytic_axes(id)
);
COMMENT ON COLUMN public.project_settings.project_axis_id IS 'Axe analytique dont chaque valeur est un projet (choisi par la société).';

-- ─── Projets ───
ALTER TABLE public.projects
  ADD COLUMN customer_id uuid,
  ADD COLUMN analytic_value_id uuid,
  ADD COLUMN description text,
  ADD COLUMN currency text NOT NULL DEFAULT 'XOF',
  ADD COLUMN closed_at timestamptz,
  ADD COLUMN status_reason text,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
UPDATE public.projects SET status = 'planned' WHERE status IS NULL OR status NOT IN ('planned', 'active', 'on_hold', 'closed', 'cancelled');
ALTER TABLE public.projects ALTER COLUMN status SET DEFAULT 'planned';
ALTER TABLE public.projects ADD CONSTRAINT projects_status_check CHECK (status IN ('planned', 'active', 'on_hold', 'closed', 'cancelled'));
ALTER TABLE public.projects ADD CONSTRAINT projects_dates_check CHECK (start_date IS NULL OR end_date IS NULL OR start_date <= end_date);
ALTER TABLE public.projects ADD CONSTRAINT projects_completion_check CHECK (completion_pct IS NULL OR completion_pct BETWEEN 0 AND 100);
ALTER TABLE public.projects ADD CONSTRAINT projects_code_check CHECK (project_code ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$') NOT VALID;
ALTER TABLE public.projects ADD CONSTRAINT projects_id_tenant_key UNIQUE (id, tenant_id);
CREATE UNIQUE INDEX projects_code_key ON public.projects (tenant_id, project_code);
CREATE UNIQUE INDEX projects_analytic_value_key ON public.projects (analytic_value_id) WHERE analytic_value_id IS NOT NULL;
ALTER TABLE public.projects ADD CONSTRAINT projects_customer_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);
ALTER TABLE public.projects ADD CONSTRAINT projects_analytic_value_fkey FOREIGN KEY (analytic_value_id) REFERENCES public.analytic_values(id);

CREATE TABLE public.project_budget_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  gl_account_id uuid NOT NULL,
  amount numeric(18, 2) NOT NULL CHECK (amount >= 0),
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, gl_account_id),
  FOREIGN KEY (project_id, tenant_id) REFERENCES public.projects(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (gl_account_id, tenant_id) REFERENCES public.gl_accounts(id, tenant_id)
);
COMMENT ON TABLE public.project_budget_lines IS 'Budget d''un projet par compte (un compte couvre ses sous-comptes) ; sur la durée du projet.';

-- Notes de frais imputables à un projet (ligne par ligne).
ALTER TABLE public.expense_lines ADD COLUMN project_id uuid;
ALTER TABLE public.expense_lines ADD CONSTRAINT expense_lines_project_fkey FOREIGN KEY (project_id, tenant_id) REFERENCES public.projects(id, tenant_id);

-- ─── Création de la valeur analytique et cycle de vie ───
-- Le projet crée sa valeur sur l'axe paramétré (la valeur suit le code et le libellé du projet).
CREATE FUNCTION public.project_analytic_value() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _axis uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT project_axis_id INTO _axis FROM public.project_settings WHERE tenant_id = NEW.tenant_id;
    IF _axis IS NULL THEN
      RAISE EXCEPTION 'Choisir d''abord l''axe analytique des projets (Projets → Paramètres)' USING ERRCODE = 'QG028';
    END IF;
    IF NEW.analytic_value_id IS NULL THEN
      INSERT INTO public.analytic_values (tenant_id, axis_id, code, name, valid_from, valid_to, is_active)
      VALUES (NEW.tenant_id, _axis, NEW.project_code, NEW.name, NEW.start_date, NEW.end_date, NEW.status NOT IN ('closed', 'cancelled'))
      RETURNING id INTO NEW.analytic_value_id;
    END IF;
  ELSIF NEW.analytic_value_id IS NOT NULL AND (NEW.name IS DISTINCT FROM OLD.name OR NEW.start_date IS DISTINCT FROM OLD.start_date
        OR NEW.end_date IS DISTINCT FROM OLD.end_date OR NEW.status IS DISTINCT FROM OLD.status) THEN
    -- Projet clôturé ou annulé : sa section n'accepte plus d'imputation ; rouvert : de nouveau.
    UPDATE public.analytic_values SET name = NEW.name, valid_from = NEW.start_date, valid_to = NEW.end_date,
           is_active = NEW.status NOT IN ('closed', 'cancelled') WHERE id = NEW.analytic_value_id;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER trg_project_analytic_value BEFORE INSERT OR UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.project_analytic_value();
REVOKE EXECUTE ON FUNCTION public.project_analytic_value() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.guard_project() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon', 'qerp_api') THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'planned' OR EXISTS (SELECT 1 FROM public.journal_line_analytics a WHERE a.value_id = OLD.analytic_value_id) THEN
      RAISE EXCEPTION 'Un projet démarré ou imputé ne se supprime pas : le clôturer ou l''annuler' USING ERRCODE = 'QG028';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('planned', 'active') THEN RAISE EXCEPTION 'Un projet se crée prévu ou actif' USING ERRCODE = 'QG028'; END IF;
    NEW.created_by := auth.uid(); NEW.closed_at := NULL;
    RETURN NEW;
  END IF;
  IF NEW.project_code IS DISTINCT FROM OLD.project_code OR NEW.analytic_value_id IS DISTINCT FROM OLD.analytic_value_id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'Le code d''un projet et sa section analytique ne changent pas' USING ERRCODE = 'QG028';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND current_setting('qerp.project_status', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Le statut d''un projet change par « Démarrer », « Suspendre », « Clôturer » ou « Rouvrir »' USING ERRCODE = 'QG028';
  END IF;
  IF OLD.status IN ('closed', 'cancelled') AND current_setting('qerp.project_status', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Projet % clôturé : le rouvrir pour le modifier', OLD.project_code USING ERRCODE = 'QG028';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_guard_project BEFORE INSERT OR UPDATE OR DELETE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.guard_project();

CREATE FUNCTION public.guard_project_budget_line() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _p record; _g record;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon', 'qerp_api') THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT status INTO _p FROM public.projects WHERE id = COALESCE(NEW.project_id, OLD.project_id);
  IF _p.status IN ('closed', 'cancelled') THEN RAISE EXCEPTION 'Budget d''un projet clôturé : figé' USING ERRCODE = 'QG028'; END IF;
  IF TG_OP <> 'DELETE' THEN
    SELECT account_type INTO _g FROM public.gl_accounts WHERE id = NEW.gl_account_id;
    IF _g.account_type NOT IN ('expense', 'revenue') THEN
      RAISE EXCEPTION 'Le budget d''un projet porte sur des comptes de charges ou de produits' USING ERRCODE = 'QG028';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER trg_guard_project_budget_line BEFORE INSERT OR UPDATE OR DELETE ON public.project_budget_lines
  FOR EACH ROW EXECUTE FUNCTION public.guard_project_budget_line();

CREATE FUNCTION public.project_set_status(_project uuid, _status text, _reason text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid()); _p public.projects%ROWTYPE;
BEGIN
  SELECT * INTO _p FROM public.projects WHERE id = _project AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Projet introuvable dans la société active' USING ERRCODE = 'QG028'; END IF;
  IF _status NOT IN ('active', 'on_hold', 'closed', 'cancelled') THEN RAISE EXCEPTION 'Statut inconnu : %', _status USING ERRCODE = 'QG028'; END IF;
  IF NOT public.has_permission(auth.uid(), CASE WHEN _status = 'active' AND _p.status = 'planned' THEN 'projects.manage' ELSE 'projects.close' END) THEN
    RAISE EXCEPTION 'Droit insuffisant pour changer le statut du projet' USING ERRCODE = '42501';
  END IF;
  IF _status = 'cancelled' AND EXISTS (SELECT 1 FROM public.journal_line_analytics a WHERE a.value_id = _p.analytic_value_id) THEN
    RAISE EXCEPTION 'Projet déjà imputé en comptabilité : le clôturer plutôt que l''annuler' USING ERRCODE = 'QG028';
  END IF;
  IF _status IN ('closed', 'cancelled', 'on_hold') AND btrim(COALESCE(_reason, '')) = '' THEN
    RAISE EXCEPTION 'Motif obligatoire' USING ERRCODE = 'QG028';
  END IF;
  IF _p.status = 'cancelled' THEN RAISE EXCEPTION 'Un projet annulé ne se rouvre pas' USING ERRCODE = 'QG028'; END IF;
  PERFORM set_config('qerp.project_status', 'on', true);
  UPDATE public.projects SET status = _status, status_reason = NULLIF(btrim(_reason), ''),
         closed_at = CASE WHEN _status IN ('closed', 'cancelled') THEN now() END WHERE id = _project;
  PERFORM set_config('qerp.project_status', 'off', true);
END $$;
REVOKE EXECUTE ON FUNCTION public.project_set_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.project_set_status(uuid, text, text) TO authenticated;

-- ─── Lecture : budget, réalisé, engagé (SECURITY INVOKER, RLS de l'appelant) ───
-- Réalisé = lignes comptabilisées portant la valeur du projet ou une de ses sous-valeurs ; charges
-- (débit − crédit) et produits (crédit − débit). Engagé = commandes approuvées non encore réceptionnées
-- (et, si paramétré, demandes approuvées non converties), pour leur part imputée au projet.
CREATE FUNCTION public.project_financials(_from date DEFAULT NULL, _to date DEFAULT NULL)
RETURNS TABLE (project_id uuid, budget_costs numeric, budget_revenue numeric, actual_costs numeric, actual_revenue numeric, committed numeric)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH t AS (SELECT public.get_user_tenant_id(auth.uid()) AS id),
  s AS (SELECT COALESCE((SELECT include_requisitions_in_commitments FROM public.project_settings, t WHERE tenant_id = t.id), false) AS pr),
  p AS (SELECT pr.id, pr.analytic_value_id FROM public.projects pr, t WHERE pr.tenant_id = t.id AND pr.analytic_value_id IS NOT NULL),
  act AS (
    SELECT p.id AS project_id,
      SUM(CASE WHEN g.account_type = 'expense' THEN l.debit - l.credit ELSE 0 END) AS costs,
      SUM(CASE WHEN g.account_type = 'revenue' THEN l.credit - l.debit ELSE 0 END) AS revenue
      FROM p
      JOIN public.journal_line_analytics a ON a.value_id = ANY (public.analytic_value_scope(p.analytic_value_id))
      JOIN public.journal_lines l ON l.id = a.line_id
      JOIN public.journal_entries e ON e.id = l.entry_id AND e.status IN ('posted', 'reversed')
      JOIN public.gl_accounts g ON g.id = l.account_id
     WHERE (_from IS NULL OR e.entry_date >= _from) AND (_to IS NULL OR e.entry_date <= _to)
     GROUP BY p.id
  ),
  com AS (
    SELECT p.id AS project_id, SUM(public.document_amount_in_scope('PO', po.id, p.analytic_value_id)) AS amount
      FROM p, t, public.purchase_orders po
     WHERE po.tenant_id = t.id AND po.status IN ('approved', 'ordered', 'partially_received')
     GROUP BY p.id
    UNION ALL
    SELECT p.id, SUM(public.document_amount_in_scope('PR', r.id, p.analytic_value_id))
      FROM p, t, s, public.purchase_requisitions r
     WHERE s.pr AND r.tenant_id = t.id AND r.status = 'approved' AND r.po_id IS NULL
     GROUP BY p.id
  ),
  bud AS (
    SELECT b.project_id,
      SUM(CASE WHEN g.account_type = 'expense' THEN b.amount ELSE 0 END) AS costs,
      SUM(CASE WHEN g.account_type = 'revenue' THEN b.amount ELSE 0 END) AS revenue
      FROM public.project_budget_lines b JOIN public.gl_accounts g ON g.id = b.gl_account_id, t
     WHERE b.tenant_id = t.id GROUP BY b.project_id
  )
  SELECT p.id, COALESCE(bud.costs, 0), COALESCE(bud.revenue, 0), COALESCE(act.costs, 0), COALESCE(act.revenue, 0),
         COALESCE((SELECT SUM(c.amount) FROM com c WHERE c.project_id = p.id), 0)
    FROM p LEFT JOIN act ON act.project_id = p.id LEFT JOIN bud ON bud.project_id = p.id
$$;

-- Détail des écritures d'un projet (grand livre du projet).
CREATE FUNCTION public.project_ledger(_project uuid)
RETURNS TABLE (entry_id uuid, piece_number text, entry_date date, journal_code text, source text, account_code text, account_name text,
               account_type text, description text, debit numeric, credit numeric)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT e.id, e.piece_number, e.entry_date, e.journal_code, e.source, g.code, g.name, g.account_type, COALESCE(l.description, e.description), l.debit, l.credit
    FROM public.projects pr
    JOIN public.journal_line_analytics a ON a.value_id = ANY (public.analytic_value_scope(pr.analytic_value_id))
    JOIN public.journal_lines l ON l.id = a.line_id
    JOIN public.journal_entries e ON e.id = l.entry_id AND e.status IN ('posted', 'reversed')
    JOIN public.gl_accounts g ON g.id = l.account_id
   WHERE pr.id = _project AND pr.tenant_id = public.get_user_tenant_id(auth.uid())
   ORDER BY e.entry_date DESC, e.piece_number DESC
$$;
GRANT EXECUTE ON FUNCTION public.project_financials(date, date), public.project_ledger(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.project_financials(date, date), public.project_ledger(uuid) FROM anon;

-- ─── Notes de frais : la ligne imputée à un projet porte sa section dans l'écriture ───
CREATE OR REPLACE FUNCTION public.expense_report_post(_id uuid, _date date DEFAULT CURRENT_DATE) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _r public.expense_reports%ROWTYPE; _entry uuid; _payable uuid; _g record; _who text; _line uuid;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'expenses.post') THEN RAISE EXCEPTION 'Droit insuffisant : « expenses.post » requis' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _r FROM public.expense_reports WHERE id = _id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Note de frais introuvable dans la société active' USING ERRCODE = 'QG027'; END IF;
  IF _r.status <> 'approved' THEN RAISE EXCEPTION 'Seule une note approuvée se comptabilise' USING ERRCODE = 'QG027'; END IF;
  PERFORM public.assert_fiscal_period_open(_tenant, _date, 'GL');
  _payable := public.require_posting_account(_tenant, 'EXPENSE_PAYABLE');
  SELECT e.first_name || ' ' || e.last_name INTO _who FROM public.employees e WHERE e.id = _r.employee_id;
  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES (_tenant, 'JE-NDF-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || substr(_id::text, 1, 8), _date,
          'Note de frais ' || _r.report_number || COALESCE(' — ' || _who, ''), 'expense_report', 'draft', auth.uid())
  RETURNING id INTO _entry;
  FOR _g IN SELECT c.gl_account_id AS acc, p.analytic_value_id AS val, p.project_code AS code, SUM(l.net_amount) AS amt
              FROM public.expense_lines l JOIN public.expense_categories c ON c.id = l.category_id
              LEFT JOIN public.projects p ON p.id = l.project_id
             WHERE l.report_id = _id GROUP BY c.gl_account_id, p.analytic_value_id, p.project_code LOOP
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry, _g.acc, _g.amt, 0, 'Frais ' || _r.report_number || COALESCE(' — projet ' || _g.code, ''))
    RETURNING id INTO _line;
    IF _g.val IS NOT NULL THEN PERFORM public.impute_line_analytics(_line, ARRAY[_g.val]); END IF;
  END LOOP;
  FOR _g IN SELECT COALESCE(t.gl_account_id, public.require_posting_account(_tenant, 'VAT_INPUT')) AS acc, SUM(l.tax_amount) AS amt
              FROM public.expense_lines l LEFT JOIN public.tax_codes t ON t.id = l.tax_code_id
             WHERE l.report_id = _id AND l.tax_amount > 0 GROUP BY 1 LOOP
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description) VALUES (_entry, _g.acc, _g.amt, 0, 'TVA récupérable ' || _r.report_number);
  END LOOP;
  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  VALUES (_entry, _payable, 0, _r.total, 'À rembourser' || COALESCE(' — ' || _who, ''));
  UPDATE public.journal_entries SET status = 'posted', posted_by = auth.uid(), posted_at = now() WHERE id = _entry;
  PERFORM set_config('qerp.expense_system', 'on', true);
  UPDATE public.expense_reports SET status = 'posted', posted_at = now(), journal_entry_id = _entry WHERE id = _id;
  PERFORM set_config('qerp.expense_system', 'off', true);
  RETURN _entry;
END $$;

-- Une ligne de note ne s'impute qu'à un projet actif.
CREATE OR REPLACE FUNCTION public.guard_expense_line() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _rep record;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon', 'qerp_api') THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT status, created_by INTO _rep FROM public.expense_reports WHERE id = COALESCE(NEW.report_id, OLD.report_id);
  IF _rep.status NOT IN ('draft', 'rejected') THEN
    RAISE EXCEPTION 'Lignes d''une note % : plus modifiables', _rep.status USING ERRCODE = 'QG027';
  END IF;
  IF _rep.created_by IS DISTINCT FROM auth.uid() AND NOT public.has_permission(auth.uid(), 'expenses.manage') THEN
    RAISE EXCEPTION 'Seul l''auteur (ou le droit « expenses.manage ») modifie les lignes de cette note' USING ERRCODE = '42501';
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.category_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.expense_categories c WHERE c.id = NEW.category_id AND c.is_active) THEN
    RAISE EXCEPTION 'Catégorie de frais inactive' USING ERRCODE = 'QG027';
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.project_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = NEW.project_id AND p.status = 'active') THEN
    RAISE EXCEPTION 'Une dépense ne s''impute qu''à un projet actif' USING ERRCODE = 'QG027';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

-- ─── RLS ───
DROP POLICY IF EXISTS "Tenant isolation" ON public.projects;
DROP POLICY IF EXISTS "Access via project" ON public.project_costs;
CREATE POLICY "Lecture société" ON public.projects FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Gestion habilitée" ON public.projects FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'projects.manage'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'projects.manage'));
-- Ancienne saisie libre des coûts : lecture seule (le réalisé vient de la comptabilité).
CREATE POLICY "Lecture avec le projet" ON public.project_costs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_costs.project_id));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.project_costs FROM anon, authenticated;

ALTER TABLE public.project_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_budget_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture société" ON public.project_settings FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Paramétrage habilité" ON public.project_settings FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'projects.settings'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'projects.settings'));
CREATE POLICY "Lecture société" ON public.project_budget_lines FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Budget habilité" ON public.project_budget_lines FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'projects.budget'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'projects.budget'));
REVOKE ALL ON public.project_settings, public.project_budget_lines FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_settings, public.project_budget_lines, public.projects TO authenticated;

SELECT public.install_tenant_isolation_triggers();
