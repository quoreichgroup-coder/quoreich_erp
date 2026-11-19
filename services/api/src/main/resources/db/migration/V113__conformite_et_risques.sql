-- V113 — Conformité et risques (lot 4, modules 3 et 4).
--
-- Avant : tables sans règle (référentiels, contrôles, journal de tests ; registre et évaluations des risques),
-- politiques FOR ALL ouvertes à tout membre, aucun calcul ; écrans de démonstration. Aucune donnée.
-- Références : COSO (contrôle interne : contrôles, tests d'efficacité, déficiences et plans de remédiation),
-- ISO 31000 / COSO ERM (identification, évaluation probabilité × impact, risque inhérent puis résiduel après
-- contrôles, traitement : éviter, réduire, transférer, accepter ; appétence), SAP GRC (Process Control :
-- tests et constats ; Risk Management : registre, évaluations datées, actions), AUDCIF (contrôle interne et
-- piste d'audit). Tout est paramétré par la société : échelle de cotation, seuils, appétence, fréquences ;
-- aucun référentiel ni risque n'est pré-rempli.

-- ─── Droits du catalogue ───
INSERT INTO public.erp_permission_catalog (code, module, action, label) VALUES
  ('compliance.manage', 'compliance', 'manage', 'Gérer les référentiels et les contrôles'),
  ('compliance.test', 'compliance', 'test', 'Réaliser et enregistrer les tests de contrôles'),
  ('compliance.close_issue', 'compliance', 'close_issue', 'Clôturer les constats de conformité'),
  ('compliance.settings', 'compliance', 'settings', 'Paramétrer la conformité'),
  ('compliance.export', 'compliance', 'export', 'Exporter les données de conformité'),
  ('risks.manage', 'risks', 'manage', 'Gérer le registre des risques et les actions'),
  ('risks.assess', 'risks', 'assess', 'Évaluer les risques'),
  ('risks.settings', 'risks', 'settings', 'Paramétrer la gestion des risques (échelle, seuils, catégories)'),
  ('risks.export', 'risks', 'export', 'Exporter les données des risques')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
SELECT v.r, v.p FROM (VALUES
  ('admin', 'compliance.manage'), ('admin', 'compliance.test'), ('admin', 'compliance.close_issue'), ('admin', 'compliance.settings'), ('admin', 'compliance.export'),
  ('admin', 'risks.manage'), ('admin', 'risks.assess'), ('admin', 'risks.settings'), ('admin', 'risks.export'),
  ('compliance_admin', 'compliance.manage'), ('compliance_admin', 'compliance.test'), ('compliance_admin', 'compliance.close_issue'),
  ('compliance_admin', 'compliance.settings'), ('compliance_admin', 'compliance.export'),
  ('compliance_officer', 'compliance.manage'), ('compliance_officer', 'compliance.test'), ('compliance_officer', 'compliance.export'),
  ('compliance_auditor', 'compliance.test'), ('compliance_auditor', 'compliance.close_issue'), ('compliance_auditor', 'compliance.export'),
  ('risk_admin', 'risks.manage'), ('risk_admin', 'risks.assess'), ('risk_admin', 'risks.settings'), ('risk_admin', 'risks.export'),
  ('risk_owner', 'risks.manage'), ('risk_owner', 'risks.export'),
  ('risk_assessor', 'risks.assess'), ('risk_assessor', 'risks.export')) AS v(r, p)
 WHERE EXISTS (SELECT 1 FROM public.erp_system_roles s WHERE s.code = v.r)
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, sp.permission_code
  FROM public.erp_roles r
  JOIN public.erp_system_role_permissions sp ON sp.role_code = r.code
 WHERE r.is_system AND (sp.permission_code LIKE 'compliance.%' OR sp.permission_code LIKE 'risks.%')
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

-- ═══════════════════════════════ RISQUES ═══════════════════════════════

CREATE TABLE public.risk_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  scale_max integer NOT NULL DEFAULT 5 CHECK (scale_max BETWEEN 3 AND 10),
  medium_from integer NOT NULL DEFAULT 5,
  high_from integer NOT NULL DEFAULT 10,
  critical_from integer NOT NULL DEFAULT 15,
  appetite_score integer,
  review_days integer CHECK (review_days IS NULL OR review_days BETWEEN 1 AND 730),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT auth.uid(),
  CHECK (1 <= medium_from AND medium_from <= high_from AND high_from <= critical_from AND critical_from <= scale_max * scale_max),
  CHECK (appetite_score IS NULL OR appetite_score BETWEEN 1 AND scale_max * scale_max)
);
COMMENT ON TABLE public.risk_settings IS 'Échelle de cotation (probabilité et impact de 1 à N), seuils de criticité, appétence (score au-delà duquel le risque doit être traité), revue périodique ; une société sans ligne utilise les valeurs par défaut des colonnes.';

CREATE TABLE public.risk_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$'),
  name text NOT NULL CHECK (btrim(name) <> ''),
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, code), UNIQUE (id, tenant_id)
);

UPDATE public.risk_register SET status = 'identified' WHERE status IS NULL OR status NOT IN ('identified', 'assessed', 'treating', 'accepted', 'closed');
ALTER TABLE public.risk_register ALTER COLUMN status SET DEFAULT 'identified';
ALTER TABLE public.risk_register
  ADD COLUMN category_id uuid,
  ADD COLUMN treatment text CHECK (treatment IS NULL OR treatment IN ('avoid', 'reduce', 'transfer', 'accept')),
  ADD COLUMN project_id uuid,
  ADD COLUMN residual_score integer GENERATED ALWAYS AS (residual_likelihood * residual_impact) STORED,
  ADD COLUMN last_assessed_at timestamptz,
  ADD COLUMN status_reason text,
  ADD COLUMN closed_at timestamptz,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.risk_register ADD CONSTRAINT risk_register_status_check CHECK (status IN ('identified', 'assessed', 'treating', 'accepted', 'closed'));
ALTER TABLE public.risk_register ADD CONSTRAINT risk_register_id_tenant_key UNIQUE (id, tenant_id);
CREATE UNIQUE INDEX risk_register_code_key ON public.risk_register (tenant_id, risk_code);
ALTER TABLE public.risk_register ADD CONSTRAINT risk_register_category_fkey FOREIGN KEY (category_id, tenant_id) REFERENCES public.risk_categories(id, tenant_id);
ALTER TABLE public.risk_register ADD CONSTRAINT risk_register_project_fkey FOREIGN KEY (project_id, tenant_id) REFERENCES public.projects(id, tenant_id);

ALTER TABLE public.risk_assessments
  ADD COLUMN tenant_id uuid,
  ADD COLUMN residual_likelihood integer,
  ADD COLUMN residual_impact integer,
  ADD COLUMN assessed_by uuid;
UPDATE public.risk_assessments a SET tenant_id = r.tenant_id FROM public.risk_register r WHERE r.id = a.risk_id;
ALTER TABLE public.risk_assessments ALTER COLUMN tenant_id SET NOT NULL;

CREATE TABLE public.risk_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  risk_id uuid NOT NULL,
  title text NOT NULL CHECK (btrim(title) <> ''),
  owner text,
  due_date date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'cancelled')),
  done_at timestamptz,
  notes text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (risk_id, tenant_id) REFERENCES public.risk_register(id, tenant_id) ON DELETE CASCADE
);

-- Échelle effective de la société (valeurs par défaut des colonnes si aucune ligne).
CREATE FUNCTION public.risk_setting(_tenant uuid) RETURNS public.risk_settings LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE((SELECT s FROM public.risk_settings s WHERE s.tenant_id = _tenant),
                  ROW(_tenant, 5, 5, 10, 15, NULL, NULL, now(), NULL)::public.risk_settings)
$$;

CREATE FUNCTION public.guard_risk() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _max integer := (public.risk_setting(NEW.tenant_id)).scale_max;
BEGIN
  IF NEW.likelihood NOT BETWEEN 1 AND _max OR NEW.impact NOT BETWEEN 1 AND _max
     OR (NEW.residual_likelihood IS NOT NULL AND NEW.residual_likelihood NOT BETWEEN 1 AND _max)
     OR (NEW.residual_impact IS NOT NULL AND NEW.residual_impact NOT BETWEEN 1 AND _max) THEN
    RAISE EXCEPTION 'Cotation hors de l''échelle de la société (1 à %)', _max USING ERRCODE = 'QG029';
  END IF;
  IF current_user IN ('authenticated', 'anon', 'qerp_api') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.created_by := auth.uid(); NEW.status := 'identified'; NEW.residual_likelihood := NULL; NEW.residual_impact := NULL; NEW.last_assessed_at := NULL;
    ELSIF current_setting('qerp.risk_system', true) IS DISTINCT FROM 'on' AND (
          NEW.likelihood IS DISTINCT FROM OLD.likelihood OR NEW.impact IS DISTINCT FROM OLD.impact
       OR NEW.residual_likelihood IS DISTINCT FROM OLD.residual_likelihood OR NEW.residual_impact IS DISTINCT FROM OLD.residual_impact
       OR NEW.status IS DISTINCT FROM OLD.status OR NEW.last_assessed_at IS DISTINCT FROM OLD.last_assessed_at
       OR NEW.risk_code IS DISTINCT FROM OLD.risk_code OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id) THEN
      RAISE EXCEPTION 'Cotation et statut d''un risque changent par « Évaluer » et « Changer le statut » (historique tracé) ; le code ne change pas'
        USING ERRCODE = 'QG029';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER trg_guard_risk BEFORE INSERT OR UPDATE ON public.risk_register FOR EACH ROW EXECUTE FUNCTION public.guard_risk();

-- Évaluation datée : risque inhérent et résiduel (après contrôles), historisée ; prochaine revue si paramétrée.
CREATE FUNCTION public.risk_assess(_risk uuid, _likelihood integer, _impact integer, _residual_likelihood integer, _residual_impact integer, _notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid()); _r public.risk_register%ROWTYPE; _s public.risk_settings; _id uuid;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'risks.assess') THEN RAISE EXCEPTION 'Droit insuffisant : « risks.assess » requis' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _r FROM public.risk_register WHERE id = _risk AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Risque introuvable dans la société active' USING ERRCODE = 'QG029'; END IF;
  IF _r.status = 'closed' THEN RAISE EXCEPTION 'Risque clôturé : le rouvrir avant de l''évaluer' USING ERRCODE = 'QG029'; END IF;
  _s := public.risk_setting(_tenant);
  IF _residual_likelihood IS NOT NULL AND _residual_impact IS NOT NULL AND _residual_likelihood * _residual_impact > _likelihood * _impact THEN
    RAISE EXCEPTION 'Le risque résiduel ne dépasse pas le risque inhérent' USING ERRCODE = 'QG029';
  END IF;
  INSERT INTO public.risk_assessments (tenant_id, risk_id, assessment_date, assessor, likelihood, impact, residual_likelihood, residual_impact, notes, assessed_by)
  VALUES (_tenant, _risk, CURRENT_DATE, COALESCE((SELECT full_name FROM public.profiles WHERE id = auth.uid()), ''), _likelihood, _impact,
          _residual_likelihood, _residual_impact, NULLIF(btrim(_notes), ''), auth.uid())
  RETURNING id INTO _id;
  PERFORM set_config('qerp.risk_system', 'on', true);
  UPDATE public.risk_register SET likelihood = _likelihood, impact = _impact, residual_likelihood = _residual_likelihood, residual_impact = _residual_impact,
         last_assessed_at = now(), status = CASE WHEN status = 'identified' THEN 'assessed' ELSE status END,
         review_date = CASE WHEN _s.review_days IS NOT NULL THEN CURRENT_DATE + _s.review_days ELSE review_date END
   WHERE id = _risk;
  PERFORM set_config('qerp.risk_system', 'off', true);
  RETURN _id;
END $$;

CREATE FUNCTION public.risk_set_status(_risk uuid, _status text, _treatment text DEFAULT NULL, _reason text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid()); _r public.risk_register%ROWTYPE;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'risks.manage') THEN RAISE EXCEPTION 'Droit insuffisant : « risks.manage » requis' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _r FROM public.risk_register WHERE id = _risk AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Risque introuvable dans la société active' USING ERRCODE = 'QG029'; END IF;
  IF _status NOT IN ('assessed', 'treating', 'accepted', 'closed') THEN RAISE EXCEPTION 'Statut inconnu : %', _status USING ERRCODE = 'QG029'; END IF;
  IF _status IN ('treating', 'accepted', 'closed') AND _r.last_assessed_at IS NULL THEN
    RAISE EXCEPTION 'Évaluer le risque avant de décider de son traitement' USING ERRCODE = 'QG029';
  END IF;
  IF _status IN ('accepted', 'closed') AND btrim(COALESCE(_reason, '')) = '' THEN RAISE EXCEPTION 'Motif obligatoire' USING ERRCODE = 'QG029'; END IF;
  IF _status = 'closed' AND EXISTS (SELECT 1 FROM public.risk_actions WHERE risk_id = _risk AND status = 'open') THEN
    RAISE EXCEPTION 'Des actions de traitement sont encore ouvertes' USING ERRCODE = 'QG029';
  END IF;
  PERFORM set_config('qerp.risk_system', 'on', true);
  UPDATE public.risk_register SET status = _status, status_reason = NULLIF(btrim(_reason), ''),
         treatment = CASE WHEN _status = 'accepted' THEN 'accept' ELSE COALESCE(_treatment, treatment) END,
         closed_at = CASE WHEN _status = 'closed' THEN now() END WHERE id = _risk;
  PERFORM set_config('qerp.risk_system', 'off', true);
END $$;

-- ═══════════════════════════════ CONFORMITÉ ═══════════════════════════════

CREATE TABLE public.compliance_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  issue_second_person boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT auth.uid()
);
COMMENT ON COLUMN public.compliance_settings.issue_second_person IS 'Un constat est clôturé par une autre personne que celle qui l''a relevé.';

ALTER TABLE public.compliance_frameworks ADD COLUMN description text;
ALTER TABLE public.compliance_frameworks ADD CONSTRAINT compliance_frameworks_status_check CHECK (status IN ('active', 'archived')) NOT VALID;
ALTER TABLE public.compliance_frameworks ADD CONSTRAINT compliance_frameworks_id_tenant_key UNIQUE (id, tenant_id);

UPDATE public.compliance_controls SET status = 'not_tested' WHERE status NOT IN ('not_tested', 'effective', 'partially_effective', 'deficient', 'not_applicable');
ALTER TABLE public.compliance_controls
  ADD COLUMN tenant_id uuid,
  ADD COLUMN frequency text CHECK (frequency IS NULL OR frequency IN ('monthly', 'quarterly', 'semiannual', 'annual')),
  ADD COLUMN test_procedure text,
  ADD COLUMN is_active boolean NOT NULL DEFAULT true;
UPDATE public.compliance_controls c SET tenant_id = f.tenant_id FROM public.compliance_frameworks f WHERE f.id = c.framework_id;
ALTER TABLE public.compliance_controls ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.compliance_controls ADD CONSTRAINT compliance_controls_status_check CHECK (status IN ('not_tested', 'effective', 'partially_effective', 'deficient', 'not_applicable'));
ALTER TABLE public.compliance_controls ADD CONSTRAINT compliance_controls_risk_level_check CHECK (risk_level IS NULL OR risk_level IN ('low', 'medium', 'high', 'critical'));
ALTER TABLE public.compliance_controls ADD CONSTRAINT compliance_controls_id_tenant_key UNIQUE (id, tenant_id);
ALTER TABLE public.compliance_controls ADD CONSTRAINT compliance_controls_framework_tenant_fkey FOREIGN KEY (framework_id, tenant_id) REFERENCES public.compliance_frameworks(id, tenant_id) ON DELETE CASCADE;
CREATE UNIQUE INDEX compliance_controls_code_key ON public.compliance_controls (framework_id, control_code);

ALTER TABLE public.compliance_test_logs ADD COLUMN tenant_id uuid, ADD COLUMN tested_by uuid;
UPDATE public.compliance_test_logs t SET tenant_id = c.tenant_id FROM public.compliance_controls c WHERE c.id = t.control_id;
ALTER TABLE public.compliance_test_logs ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.compliance_test_logs ADD CONSTRAINT compliance_test_logs_result_check CHECK (result IN ('pass', 'partial', 'fail', 'not_applicable')) NOT VALID;

CREATE TABLE public.compliance_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  control_id uuid NOT NULL,
  test_id uuid REFERENCES public.compliance_test_logs(id),
  title text NOT NULL CHECK (btrim(title) <> ''),
  description text,
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  owner text,
  due_date date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'closed')),
  raised_by uuid DEFAULT auth.uid(),
  closed_by uuid,
  closed_at timestamptz,
  closure_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (control_id, tenant_id) REFERENCES public.compliance_controls(id, tenant_id) ON DELETE CASCADE
);

-- Risques couverts par des contrôles (la maîtrise qui justifie le risque résiduel).
CREATE TABLE public.risk_control_links (
  tenant_id uuid NOT NULL,
  risk_id uuid NOT NULL,
  control_id uuid NOT NULL,
  PRIMARY KEY (risk_id, control_id),
  FOREIGN KEY (risk_id, tenant_id) REFERENCES public.risk_register(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (control_id, tenant_id) REFERENCES public.compliance_controls(id, tenant_id) ON DELETE CASCADE
);

-- Compteurs du référentiel recalculés (contrôles actifs ; conformes = efficaces).
CREATE FUNCTION public.sync_framework_counts() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _f uuid := COALESCE(NEW.framework_id, OLD.framework_id);
BEGIN
  UPDATE public.compliance_frameworks SET
    total_controls = (SELECT count(*) FROM public.compliance_controls WHERE framework_id = _f AND is_active AND status <> 'not_applicable'),
    compliant_controls = (SELECT count(*) FROM public.compliance_controls WHERE framework_id = _f AND is_active AND status = 'effective')
   WHERE id = _f;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_sync_framework_counts AFTER INSERT OR UPDATE OR DELETE ON public.compliance_controls FOR EACH ROW EXECUTE FUNCTION public.sync_framework_counts();
REVOKE EXECUTE ON FUNCTION public.sync_framework_counts() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.guard_compliance_control() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon', 'qerp_api') THEN RETURN NEW; END IF;
  SELECT tenant_id INTO NEW.tenant_id FROM public.compliance_frameworks WHERE id = NEW.framework_id;
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'not_tested'; NEW.last_tested_at := NULL;
  ELSIF current_setting('qerp.compliance_system', true) IS DISTINCT FROM 'on'
        AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.last_tested_at IS DISTINCT FROM OLD.last_tested_at
             OR NEW.framework_id IS DISTINCT FROM OLD.framework_id) THEN
    RAISE EXCEPTION 'L''état d''un contrôle vient de ses tests (« Enregistrer un test ») ; il ne change pas de référentiel' USING ERRCODE = 'QG029';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_guard_compliance_control BEFORE INSERT OR UPDATE ON public.compliance_controls FOR EACH ROW EXECUTE FUNCTION public.guard_compliance_control();

-- Test d'un contrôle : résultat → état du contrôle, prochaine revue selon sa fréquence ; constat facultatif.
CREATE FUNCTION public.compliance_record_test(_control uuid, _date date, _result text, _findings integer DEFAULT 0, _notes text DEFAULT NULL,
  _issue_title text DEFAULT NULL, _issue_severity text DEFAULT 'medium', _issue_due date DEFAULT NULL, _issue_owner text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid()); _c public.compliance_controls%ROWTYPE; _id uuid;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'compliance.test') THEN RAISE EXCEPTION 'Droit insuffisant : « compliance.test » requis' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _c FROM public.compliance_controls WHERE id = _control AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contrôle introuvable dans la société active' USING ERRCODE = 'QG029'; END IF;
  IF NOT _c.is_active THEN RAISE EXCEPTION 'Contrôle inactif' USING ERRCODE = 'QG029'; END IF;
  IF _result NOT IN ('pass', 'partial', 'fail', 'not_applicable') THEN RAISE EXCEPTION 'Résultat inconnu : %', _result USING ERRCODE = 'QG029'; END IF;
  IF _date > CURRENT_DATE THEN RAISE EXCEPTION 'Un test ne se date pas dans le futur' USING ERRCODE = 'QG029'; END IF;
  IF _result IN ('partial', 'fail') AND btrim(COALESCE(_notes, '')) = '' THEN
    RAISE EXCEPTION 'Décrire les anomalies d''un test non concluant' USING ERRCODE = 'QG029';
  END IF;
  INSERT INTO public.compliance_test_logs (tenant_id, control_id, test_date, tester, result, findings, notes, tested_by)
  VALUES (_tenant, _control, _date, COALESCE((SELECT full_name FROM public.profiles WHERE id = auth.uid()), ''), _result, GREATEST(COALESCE(_findings, 0), 0),
          NULLIF(btrim(_notes), ''), auth.uid())
  RETURNING id INTO _id;
  PERFORM set_config('qerp.compliance_system', 'on', true);
  UPDATE public.compliance_controls SET
    status = CASE _result WHEN 'pass' THEN 'effective' WHEN 'partial' THEN 'partially_effective' WHEN 'fail' THEN 'deficient' ELSE 'not_applicable' END,
    last_tested_at = _date::timestamptz,
    next_review_at = CASE frequency WHEN 'monthly' THEN _date + interval '1 month' WHEN 'quarterly' THEN _date + interval '3 months'
                       WHEN 'semiannual' THEN _date + interval '6 months' WHEN 'annual' THEN _date + interval '1 year' ELSE next_review_at END
   WHERE id = _control;
  PERFORM set_config('qerp.compliance_system', 'off', true);
  IF btrim(COALESCE(_issue_title, '')) <> '' THEN
    INSERT INTO public.compliance_issues (tenant_id, control_id, test_id, title, description, severity, owner, due_date, raised_by)
    VALUES (_tenant, _control, _id, btrim(_issue_title), NULLIF(btrim(_notes), ''), COALESCE(_issue_severity, 'medium'), NULLIF(btrim(_issue_owner), ''), _issue_due, auth.uid());
  END IF;
  RETURN _id;
END $$;

CREATE FUNCTION public.compliance_issue_update(_issue uuid, _status text, _notes text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid()); _i public.compliance_issues%ROWTYPE;
BEGIN
  SELECT * INTO _i FROM public.compliance_issues WHERE id = _issue AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Constat introuvable dans la société active' USING ERRCODE = 'QG029'; END IF;
  IF _i.status = 'closed' THEN RAISE EXCEPTION 'Constat déjà clôturé' USING ERRCODE = 'QG029'; END IF;
  IF _status = 'in_progress' THEN
    IF NOT (public.has_permission(auth.uid(), 'compliance.manage') OR public.has_permission(auth.uid(), 'compliance.test')) THEN
      RAISE EXCEPTION 'Droit insuffisant' USING ERRCODE = '42501';
    END IF;
    UPDATE public.compliance_issues SET status = 'in_progress', closure_notes = COALESCE(NULLIF(btrim(_notes), ''), closure_notes) WHERE id = _issue;
  ELSIF _status = 'closed' THEN
    IF NOT public.has_permission(auth.uid(), 'compliance.close_issue') THEN RAISE EXCEPTION 'Droit insuffisant : « compliance.close_issue » requis' USING ERRCODE = '42501'; END IF;
    IF btrim(COALESCE(_notes, '')) = '' THEN RAISE EXCEPTION 'Décrire la remédiation pour clôturer' USING ERRCODE = 'QG029'; END IF;
    IF COALESCE((SELECT issue_second_person FROM public.compliance_settings WHERE tenant_id = _tenant), true) AND _i.raised_by = auth.uid() THEN
      RAISE EXCEPTION 'Un constat est clôturé par une autre personne que celle qui l''a relevé' USING ERRCODE = '42501';
    END IF;
    UPDATE public.compliance_issues SET status = 'closed', closed_by = auth.uid(), closed_at = now(), closure_notes = btrim(_notes) WHERE id = _issue;
  ELSE
    RAISE EXCEPTION 'Statut inconnu : %', _status USING ERRCODE = 'QG029';
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public.risk_assess(uuid, integer, integer, integer, integer, text), public.risk_set_status(uuid, text, text, text),
  public.compliance_record_test(uuid, date, text, integer, text, text, text, date, text), public.compliance_issue_update(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.risk_assess(uuid, integer, integer, integer, integer, text), public.risk_set_status(uuid, text, text, text),
  public.compliance_record_test(uuid, date, text, integer, text, text, text, date, text), public.compliance_issue_update(uuid, text, text),
  public.risk_setting(uuid) TO authenticated;

-- ═══════════════════════════════ RLS ═══════════════════════════════
DROP POLICY IF EXISTS "Tenant isolation" ON public.risk_register;
DROP POLICY IF EXISTS "Access via risk" ON public.risk_assessments;
DROP POLICY IF EXISTS "Tenant isolation" ON public.compliance_frameworks;
DROP POLICY IF EXISTS "Access via framework" ON public.compliance_controls;
DROP POLICY IF EXISTS "Access via control" ON public.compliance_test_logs;

ALTER TABLE public.risk_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.risk_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.risk_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.risk_control_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_issues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Lecture société" ON public.risk_register FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Gestion habilitée" ON public.risk_register FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'risks.manage'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'risks.manage'));
CREATE POLICY "Lecture société" ON public.risk_assessments FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Lecture société" ON public.risk_actions FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Gestion habilitée" ON public.risk_actions FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'risks.manage'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'risks.manage'));
CREATE POLICY "Lecture société" ON public.risk_control_links FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Gestion habilitée" ON public.risk_control_links FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'risks.manage'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'risks.manage'));
CREATE POLICY "Lecture société" ON public.risk_categories FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Paramétrage habilité" ON public.risk_categories FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'risks.settings'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'risks.settings'));
CREATE POLICY "Lecture société" ON public.risk_settings FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Paramétrage habilité" ON public.risk_settings FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'risks.settings'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'risks.settings'));

CREATE POLICY "Lecture société" ON public.compliance_frameworks FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Gestion habilitée" ON public.compliance_frameworks FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'compliance.manage'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'compliance.manage'));
CREATE POLICY "Lecture société" ON public.compliance_controls FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Gestion habilitée" ON public.compliance_controls FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'compliance.manage'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.compliance_frameworks f WHERE f.id = compliance_controls.framework_id
                       AND f.tenant_id = public.get_user_tenant_id(auth.uid())) AND public.has_permission(auth.uid(), 'compliance.manage'));
CREATE POLICY "Lecture société" ON public.compliance_test_logs FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Lecture société" ON public.compliance_issues FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Lecture société" ON public.compliance_settings FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Paramétrage habilité" ON public.compliance_settings FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'compliance.settings'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'compliance.settings'));

REVOKE ALL ON public.risk_settings, public.risk_categories, public.risk_actions, public.risk_control_links, public.compliance_settings, public.compliance_issues FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.risk_settings, public.risk_categories, public.risk_actions, public.risk_control_links,
  public.compliance_settings, public.risk_register, public.compliance_frameworks, public.compliance_controls TO authenticated;
-- Évaluations, tests et constats : écrits par les fonctions seulement (historique non modifiable).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.risk_assessments, public.compliance_test_logs, public.compliance_issues FROM authenticated;
GRANT SELECT ON public.risk_assessments, public.compliance_test_logs, public.compliance_issues TO authenticated;

SELECT public.install_tenant_isolation_triggers();
