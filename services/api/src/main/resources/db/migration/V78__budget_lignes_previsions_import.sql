-- V78 — Budget, fin du module (audit docs/audit-erp/15 §5) :
--   1. section analytique par LIGNE de demande, de commande et de facture fournisseur (la section de la ligne
--      l'emporte, axe par axe, sur celle de l'en-tête) ; reprise ligne de demande → ligne de commande → ligne de
--      facture ; écriture d'achat ventilée par compte × section ; pré-engagé, engagé et contrôles calculés ligne
--      à ligne ;
--   2. versions de prévision saisies (brouillon → publiée, figée), droit budget.forecast ;
--   3. préparation par fichier : import d'un budget en brouillon et d'une prévision (tout ou rien, anomalies
--      listées) ;
--   5. droits du catalogue budget.forecast et budget.export : les écrans du module ne lisent plus de listes de rôles ;
--   4. approbation des révisions paramétrable : directe par un approbateur, ou demande validée par une autre
--      personne au-delà d'un seuil.
-- Références : SAP (imputation par poste de commande, FM, versions de planification), Sage X3 (ventilation
-- analytique par ligne, budgets par version), import de budget par tableur dans les deux.

-- ───────────────────────── Droit ─────────────────────────
INSERT INTO public.erp_permission_catalog (code, module, action, label) VALUES
  ('budget.forecast', 'budget', 'forecast', 'Saisir et publier les prévisions budgétaires'),
  ('budget.export', 'budget', 'export', 'Exporter les budgets, le suivi et les prévisions')
ON CONFLICT (code) DO NOTHING;
-- budget.export reprend exactement les rôles qui exportaient avant (budget-roles.ts : approbateur, contrôleur,
-- administrateurs) ; budget.forecast va au préparateur, qui établit les prévisions, et aux administrateurs.
INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
SELECT v.r, v.p FROM (VALUES ('admin', 'budget.forecast'), ('budget_admin', 'budget.forecast'), ('budget_planner', 'budget.forecast'),
  ('admin', 'budget.export'), ('budget_admin', 'budget.export'), ('budget_approver', 'budget.export'), ('budget_controller', 'budget.export')) AS v(r, p)
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, sp.permission_code FROM public.erp_roles r JOIN public.erp_system_role_permissions sp ON sp.role_code = r.code
 WHERE sp.permission_code IN ('budget.forecast', 'budget.export') AND r.is_system
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

-- ───────────────────────── Paramètres ─────────────────────────
ALTER TABLE public.budget_settings
  ADD COLUMN revision_second_person boolean NOT NULL DEFAULT false,
  ADD COLUMN revision_threshold_pct numeric(6,2) NOT NULL DEFAULT 0 CHECK (revision_threshold_pct >= 0);

CREATE OR REPLACE FUNCTION public.budget_setting(_tenant uuid)
 RETURNS budget_settings
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT s FROM public.budget_settings s WHERE s.tenant_id = _tenant),
                  ROW(_tenant, 'off', 'year', now(), true, true, true, 90, false, 0)::public.budget_settings)
$function$;

-- ───────────────────────── 1. Sections par ligne ─────────────────────────
ALTER TABLE public.po_lines ADD COLUMN requisition_line_id uuid REFERENCES public.requisition_lines(id) ON DELETE SET NULL;
CREATE INDEX po_lines_requisition_line_idx ON public.po_lines (requisition_line_id);

CREATE TABLE public.requisition_line_analytics (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  line_id uuid NOT NULL REFERENCES public.requisition_lines(id) ON DELETE CASCADE,
  axis_id uuid NOT NULL REFERENCES public.analytic_axes(id),
  value_id uuid NOT NULL,
  PRIMARY KEY (line_id, axis_id),
  FOREIGN KEY (value_id, axis_id) REFERENCES public.analytic_values(id, axis_id));
CREATE TABLE public.po_line_analytics (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  line_id uuid NOT NULL REFERENCES public.po_lines(id) ON DELETE CASCADE,
  axis_id uuid NOT NULL REFERENCES public.analytic_axes(id),
  value_id uuid NOT NULL,
  PRIMARY KEY (line_id, axis_id),
  FOREIGN KEY (value_id, axis_id) REFERENCES public.analytic_values(id, axis_id));
CREATE TABLE public.ap_invoice_line_analytics (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  line_id uuid NOT NULL REFERENCES public.ap_invoice_lines(id) ON DELETE CASCADE,
  axis_id uuid NOT NULL REFERENCES public.analytic_axes(id),
  value_id uuid NOT NULL,
  PRIMARY KEY (line_id, axis_id),
  FOREIGN KEY (value_id, axis_id) REFERENCES public.analytic_values(id, axis_id));
CREATE INDEX requisition_line_analytics_value_idx ON public.requisition_line_analytics (value_id);
CREATE INDEX po_line_analytics_value_idx ON public.po_line_analytics (value_id);
CREATE INDEX ap_invoice_line_analytics_value_idx ON public.ap_invoice_line_analytics (value_id);

-- Garde commune (pas SECURITY DEFINER ; colonnes lues par to_jsonb, piège V30).
CREATE OR REPLACE FUNCTION public.guard_line_analytics()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  _line uuid := (to_jsonb(COALESCE(NEW, OLD)) ->> 'line_id')::uuid;
  _tenant uuid; _state text; _editable boolean; _label text;
BEGIN
  IF TG_TABLE_NAME = 'requisition_line_analytics' THEN
    SELECT d.tenant_id, d.status, d.status IN ('draft', 'rejected'), d.pr_number INTO _tenant, _state, _editable, _label
      FROM public.requisition_lines l JOIN public.purchase_requisitions d ON d.id = l.requisition_id WHERE l.id = _line;
  ELSIF TG_TABLE_NAME = 'po_line_analytics' THEN
    SELECT d.tenant_id, d.status, d.status IN ('draft', 'rejected'), d.po_number INTO _tenant, _state, _editable, _label
      FROM public.po_lines l JOIN public.purchase_orders d ON d.id = l.po_id WHERE l.id = _line;
  ELSE
    SELECT d.tenant_id, d.approval_status, d.approval_status IN ('draft', 'rejected'), d.invoice_number INTO _tenant, _state, _editable, _label
      FROM public.ap_invoice_lines l JOIN public.ap_invoices d ON d.id = l.invoice_id WHERE l.id = _line;
  END IF;
  IF _tenant IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;   -- ligne supprimée (cascade)
  IF current_user IN ('authenticated', 'anon', 'qerp_api') AND NOT _editable THEN
    RAISE EXCEPTION 'Imputation analytique figée : la pièce % est « % »', _label, _state USING ERRCODE = 'QG002';
  END IF;
  IF TG_OP <> 'DELETE' THEN
    IF NEW.tenant_id IS DISTINCT FROM _tenant THEN
      RAISE EXCEPTION 'Imputation analytique : société différente de celle de la pièce %', _label USING ERRCODE = 'QG017';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.analytic_values v JOIN public.analytic_axes a ON a.id = v.axis_id
                    WHERE v.id = NEW.value_id AND v.axis_id = NEW.axis_id AND v.tenant_id = _tenant AND v.is_active AND a.is_active) THEN
      RAISE EXCEPTION 'Section analytique inactive ou inconnue dans la société (pièce %)', _label USING ERRCODE = 'QG002';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $function$;
CREATE TRIGGER trg_guard_line_analytics BEFORE INSERT OR UPDATE OR DELETE ON public.requisition_line_analytics FOR EACH ROW EXECUTE FUNCTION public.guard_line_analytics();
CREATE TRIGGER trg_guard_line_analytics BEFORE INSERT OR UPDATE OR DELETE ON public.po_line_analytics FOR EACH ROW EXECUTE FUNCTION public.guard_line_analytics();
CREATE TRIGGER trg_guard_line_analytics BEFORE INSERT OR UPDATE OR DELETE ON public.ap_invoice_line_analytics FOR EACH ROW EXECUTE FUNCTION public.guard_line_analytics();

ALTER TABLE public.requisition_line_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.po_line_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ap_invoice_line_analytics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture société" ON public.requisition_line_analytics FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Écriture avec la pièce" ON public.requisition_line_analytics FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND EXISTS (SELECT 1 FROM public.requisition_lines l JOIN public.purchase_requisitions d ON d.id = l.requisition_id WHERE l.id = line_id))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND EXISTS (SELECT 1 FROM public.requisition_lines l JOIN public.purchase_requisitions d ON d.id = l.requisition_id WHERE l.id = line_id));
CREATE POLICY "Lecture société" ON public.po_line_analytics FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Écriture avec la pièce" ON public.po_line_analytics FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND EXISTS (SELECT 1 FROM public.po_lines l JOIN public.purchase_orders d ON d.id = l.po_id WHERE l.id = line_id))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND EXISTS (SELECT 1 FROM public.po_lines l JOIN public.purchase_orders d ON d.id = l.po_id WHERE l.id = line_id));
CREATE POLICY "Lecture société" ON public.ap_invoice_line_analytics FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Écriture factures habilitée" ON public.ap_invoice_line_analytics FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'ap.invoice'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'ap.invoice'));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.requisition_line_analytics, public.po_line_analytics, public.ap_invoice_line_analytics TO authenticated;

-- Clé stable d'un ensemble de sections (regroupement des lignes d'écriture).
CREATE OR REPLACE FUNCTION public.analytic_key(_values uuid[])
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$ SELECT COALESCE((SELECT string_agg(DISTINCT x::text, ',' ORDER BY x::text) FROM unnest(_values) x), '') $function$;

-- Sections effectives d'une ligne : les siennes, et pour les autres axes celles de l'en-tête.
CREATE OR REPLACE FUNCTION public.line_effective_analytics(_kind text, _line uuid)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH own AS (
    SELECT axis_id, value_id FROM public.requisition_line_analytics WHERE _kind = 'PR' AND line_id = _line
    UNION ALL SELECT axis_id, value_id FROM public.po_line_analytics WHERE _kind = 'PO' AND line_id = _line
    UNION ALL SELECT axis_id, value_id FROM public.ap_invoice_line_analytics WHERE _kind = 'AP' AND line_id = _line),
  hdr AS (
    SELECT h.axis_id, h.value_id FROM public.requisition_lines l JOIN public.purchase_requisition_analytics h ON h.document_id = l.requisition_id WHERE _kind = 'PR' AND l.id = _line
    UNION ALL SELECT h.axis_id, h.value_id FROM public.po_lines l JOIN public.purchase_order_analytics h ON h.document_id = l.po_id WHERE _kind = 'PO' AND l.id = _line
    UNION ALL SELECT h.axis_id, h.value_id FROM public.ap_invoice_lines l JOIN public.ap_invoice_analytics h ON h.document_id = l.invoice_id WHERE _kind = 'AP' AND l.id = _line)
  SELECT COALESCE(array_agg(x.value_id ORDER BY x.value_id), '{}') FROM (
    SELECT value_id FROM own UNION ALL SELECT value_id FROM hdr WHERE axis_id NOT IN (SELECT axis_id FROM own)) x
$function$;

-- Toutes les sections d'une pièce (en-tête et lignes) : ce qui détermine les lignes de budget concernées.
CREATE OR REPLACE FUNCTION public.document_all_values(_kind text, _doc uuid)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(array_agg(DISTINCT v), '{}') FROM (
    SELECT unnest(public.document_analytic_values(_kind, _doc)) AS v
    UNION ALL SELECT a.value_id FROM public.requisition_line_analytics a JOIN public.requisition_lines l ON l.id = a.line_id WHERE _kind = 'PR' AND l.requisition_id = _doc
    UNION ALL SELECT a.value_id FROM public.po_line_analytics a JOIN public.po_lines l ON l.id = a.line_id WHERE _kind = 'PO' AND l.po_id = _doc
    UNION ALL SELECT a.value_id FROM public.ap_invoice_line_analytics a JOIN public.ap_invoice_lines l ON l.id = a.line_id WHERE _kind = 'AP' AND l.invoice_id = _doc) x
$function$;

-- Montant d'une pièce qui relève d'une section (et de ses sous-sections) : lignes dont une section effective
-- est dans le périmètre ; une pièce sans lignes compte entière si son en-tête y est.
CREATE OR REPLACE FUNCTION public.document_amount_in_scope(_kind text, _doc uuid, _value uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _scope uuid[] := public.analytic_value_scope(_value); _r numeric;
BEGIN
  IF _kind = 'PR' THEN
    IF EXISTS (SELECT 1 FROM public.requisition_lines WHERE requisition_id = _doc) THEN
      SELECT COALESCE(sum(l.total), 0) INTO _r FROM public.requisition_lines l WHERE l.requisition_id = _doc AND public.line_effective_analytics('PR', l.id) && _scope;
    ELSE
      SELECT CASE WHEN public.document_analytic_values('PR', _doc) && _scope THEN estimated_total ELSE 0 END INTO _r FROM public.purchase_requisitions WHERE id = _doc;
    END IF;
  ELSIF _kind = 'PO' THEN
    IF EXISTS (SELECT 1 FROM public.po_lines WHERE po_id = _doc) THEN
      SELECT COALESCE(sum(l.total), 0) INTO _r FROM public.po_lines l WHERE l.po_id = _doc AND public.line_effective_analytics('PO', l.id) && _scope;
    ELSE
      SELECT CASE WHEN public.document_analytic_values('PO', _doc) && _scope THEN total ELSE 0 END INTO _r FROM public.purchase_orders WHERE id = _doc;
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM public.ap_invoice_lines WHERE invoice_id = _doc) THEN
      SELECT COALESCE(sum(l.net_amount), 0) INTO _r FROM public.ap_invoice_lines l WHERE l.invoice_id = _doc AND public.line_effective_analytics('AP', l.id) && _scope;
    ELSE
      SELECT CASE WHEN public.document_analytic_values('AP', _doc) && _scope THEN subtotal ELSE 0 END INTO _r FROM public.ap_invoices WHERE id = _doc;
    END IF;
  END IF;
  RETURN COALESCE(_r, 0);
END $function$;
REVOKE EXECUTE ON FUNCTION public.line_effective_analytics(text, uuid), public.document_all_values(text, uuid), public.document_amount_in_scope(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.line_effective_analytics(text, uuid), public.document_all_values(text, uuid), public.document_amount_in_scope(text, uuid, uuid), public.analytic_key(uuid[]) TO authenticated;

-- Imputation d'une ligne d'écriture en brouillon (lignes de charges, sauf axe interdit).
CREATE OR REPLACE FUNCTION public.impute_line_analytics(_line uuid, _values uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF _values IS NULL OR cardinality(_values) = 0 THEN RETURN; END IF;
  INSERT INTO public.journal_line_analytics (line_id, axis_id, value_id)
  SELECT l.id, v.axis_id, v.id
    FROM public.journal_lines l
    JOIN public.journal_entries e ON e.id = l.entry_id
    JOIN public.gl_accounts g ON g.id = l.account_id
    JOIN public.analytic_values v ON v.id = ANY (_values) AND v.tenant_id = e.tenant_id
   WHERE l.id = _line AND g.account_type = 'expense'
     AND g.analytic_policy IS DISTINCT FROM 'forbidden'
     AND (g.analytic_policy = 'required' OR COALESCE((SELECT r.requirement FROM public.analytic_rules r
           WHERE r.axis_id = v.axis_id AND g.code LIKE r.account_prefix || '%' ORDER BY length(r.account_prefix) DESC LIMIT 1), 'optional') <> 'forbidden')
  ON CONFLICT DO NOTHING;
END $function$;

CREATE OR REPLACE FUNCTION public.impute_entry_analytics(_entry uuid, _values uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _l uuid;
BEGIN
  IF _values IS NULL OR cardinality(_values) = 0 THEN RETURN; END IF;
  FOR _l IN SELECT id FROM public.journal_lines WHERE entry_id = _entry LOOP
    PERFORM public.impute_line_analytics(_l, _values);
  END LOOP;
END $function$;
REVOKE EXECUTE ON FUNCTION public.impute_line_analytics(uuid, uuid[]) FROM PUBLIC, anon, authenticated;

-- Reprises : ligne de demande → ligne de commande (conversion), ligne de commande → ligne de facture.
CREATE OR REPLACE FUNCTION public.copy_requisition_analytics()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.po_id IS NOT NULL AND NEW.status = 'converted' AND (OLD.status IS DISTINCT FROM 'converted' OR OLD.po_id IS DISTINCT FROM NEW.po_id) THEN
    INSERT INTO public.purchase_order_analytics (tenant_id, document_id, axis_id, value_id)
    SELECT a.tenant_id, NEW.po_id, a.axis_id, a.value_id FROM public.purchase_requisition_analytics a WHERE a.document_id = NEW.id
    ON CONFLICT (document_id, axis_id) DO NOTHING;
    INSERT INTO public.po_line_analytics (tenant_id, line_id, axis_id, value_id)
    SELECT a.tenant_id, pl.id, a.axis_id, a.value_id
      FROM public.po_lines pl JOIN public.requisition_line_analytics a ON a.line_id = pl.requisition_line_id
     WHERE pl.po_id = NEW.po_id
    ON CONFLICT (line_id, axis_id) DO NOTHING;
  END IF;
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.copy_po_line_analytics_to_ap_line()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.po_line_id IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.po_line_id IS DISTINCT FROM NEW.po_line_id) THEN
    INSERT INTO public.ap_invoice_line_analytics (tenant_id, line_id, axis_id, value_id)
    SELECT a.tenant_id, NEW.id, a.axis_id, a.value_id FROM public.po_line_analytics a WHERE a.line_id = NEW.po_line_id
    ON CONFLICT (line_id, axis_id) DO NOTHING;
  END IF;
  RETURN NULL;
END $function$;
CREATE TRIGGER trg_copy_po_line_analytics_to_ap_line AFTER INSERT OR UPDATE OF po_line_id ON public.ap_invoice_lines FOR EACH ROW EXECUTE FUNCTION public.copy_po_line_analytics_to_ap_line();

-- Pré-engagé et engagé calculés ligne à ligne pour une section.
CREATE OR REPLACE FUNCTION public.budget_precommitted(_tenant uuid, _code text, _from date, _to date, _except uuid DEFAULT NULL, _value uuid DEFAULT NULL)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(sum(CASE WHEN _value IS NULL THEN pr.estimated_total ELSE public.document_amount_in_scope('PR', pr.id, _value) END), 0)
    FROM public.purchase_requisitions pr
   WHERE pr.tenant_id = _tenant AND (public.budget_setting(_tenant)).precommit_requisitions
     AND pr.status IN ('pending_approval', 'approved') AND pr.po_id IS NULL
     AND pr.request_date BETWEEN _from AND _to AND (_except IS NULL OR pr.id <> _except)
     AND EXISTS (SELECT 1 FROM public.gl_accounts g WHERE g.id = public.posting_account(_tenant, 'PURCHASES') AND g.code LIKE _code || '%')
$function$;

CREATE OR REPLACE FUNCTION public.budget_committed(_tenant uuid, _code text, _from date, _to date, _except uuid DEFAULT NULL, _value uuid DEFAULT NULL)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(sum(greatest(
           CASE WHEN _value IS NULL THEN po.total ELSE public.document_amount_in_scope('PO', po.id, _value) END
           - COALESCE((SELECT sum(CASE WHEN _value IS NULL THEN i.subtotal ELSE public.document_amount_in_scope('AP', i.id, _value) END)
                         FROM public.ap_invoices i WHERE i.po_id = po.id AND i.approval_status = 'approved'), 0), 0)), 0)
    FROM public.purchase_orders po
   WHERE po.tenant_id = _tenant AND po.status IN ('approved', 'ordered', 'partially_received', 'received')
     AND po.order_date BETWEEN _from AND _to AND (_except IS NULL OR po.id <> _except)
     AND EXISTS (SELECT 1 FROM public.gl_accounts g WHERE g.id = public.posting_account(_tenant, 'PURCHASES') AND g.code LIKE _code || '%')
$function$;

-- Contrôles : la ligne générale contre le total de la pièce, chaque ligne de section contre la part de la
-- pièce qui relève de cette section.
CREATE OR REPLACE FUNCTION public.check_budget_on_po()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _mode text := (public.budget_setting(NEW.tenant_id)).control_mode; _a record; _acc uuid; _w text[] := '{}'; _over record; _amt numeric; _over_amt numeric;
BEGIN
  IF _mode = 'off' OR NEW.status NOT IN ('pending_approval', 'approved') OR NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  _acc := public.posting_account(NEW.tenant_id, 'PURCHASES');
  IF _acc IS NULL THEN RETURN NEW; END IF;
  FOR _a IN SELECT * FROM public.budget_availability(NEW.tenant_id, _acc, NEW.order_date, NEW.id, NULL, public.document_all_values('PO', NEW.id)) LOOP
    _amt := CASE WHEN _a.analytic_value_id IS NULL THEN NEW.total ELSE public.document_amount_in_scope('PO', NEW.id, _a.analytic_value_id) END;
    IF _amt > 0 AND _amt > _a.available THEN
      _w := array_append(_w, format('budget %s%s : commande %s pour %s disponibles', _a.budget_code, COALESCE(' / ' || _a.analytic_label, ''), _amt, _a.available));
      IF _over IS NULL THEN _over := _a; _over_amt := _amt; END IF;
    END IF;
  END LOOP;
  IF cardinality(_w) = 0 THEN NEW.budget_warning := NULL; RETURN NEW; END IF;
  IF _mode = 'warn' OR NEW.budget_override_reason IS NOT NULL THEN
    NEW.budget_warning := 'Dépassement du ' || array_to_string(_w, ' ; ');
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Budget dépassé (compte %, du % au %) : commande % pour % disponibles (budget %, pré-engagé %, engagé %, réalisé %)',
    _over.budget_code || COALESCE(' / ' || _over.analytic_label, ''), _over.period_from, _over.period_to, _over_amt, _over.available,
    _over.planned, _over.precommitted, _over.committed, _over.actual
    USING ERRCODE = 'QG024', HINT = 'Réduire la commande, réviser le budget, ou faire autoriser le dépassement (droit « Autoriser un dépassement de budget »).';
END $function$;

CREATE OR REPLACE FUNCTION public.check_budget_on_pr()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _s public.budget_settings := public.budget_setting(NEW.tenant_id); _a record; _acc uuid; _w text[] := '{}'; _over record; _amt numeric; _over_amt numeric;
BEGIN
  IF _s.control_mode = 'off' OR NOT _s.control_requisitions OR NOT _s.precommit_requisitions
     OR NEW.status NOT IN ('pending_approval', 'approved') OR NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  _acc := public.posting_account(NEW.tenant_id, 'PURCHASES');
  IF _acc IS NULL THEN RETURN NEW; END IF;
  FOR _a IN SELECT * FROM public.budget_availability(NEW.tenant_id, _acc, NEW.request_date, NULL, NEW.id, public.document_all_values('PR', NEW.id)) LOOP
    _amt := CASE WHEN _a.analytic_value_id IS NULL THEN NEW.estimated_total ELSE public.document_amount_in_scope('PR', NEW.id, _a.analytic_value_id) END;
    IF _amt > 0 AND _amt > _a.available THEN
      _w := array_append(_w, format('budget %s%s : demande %s pour %s disponibles', _a.budget_code, COALESCE(' / ' || _a.analytic_label, ''), _amt, _a.available));
      IF _over IS NULL THEN _over := _a; _over_amt := _amt; END IF;
    END IF;
  END LOOP;
  IF cardinality(_w) = 0 THEN NEW.budget_warning := NULL; RETURN NEW; END IF;
  IF _s.control_mode = 'warn' OR NEW.budget_override_reason IS NOT NULL THEN
    NEW.budget_warning := 'Dépassement du ' || array_to_string(_w, ' ; ');
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Budget dépassé (compte %, du % au %) : demande % pour % disponibles (budget %, pré-engagé %, engagé %, réalisé %)',
    _over.budget_code || COALESCE(' / ' || _over.analytic_label, ''), _over.period_from, _over.period_to, _over_amt, _over.available,
    _over.planned, _over.precommitted, _over.committed, _over.actual
    USING ERRCODE = 'QG024', HINT = 'Réduire la demande, réviser le budget, ou faire autoriser le dépassement (droit « Autoriser un dépassement de budget »).';
END $function$;

CREATE OR REPLACE FUNCTION public.check_budget_on_ap_invoice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _mode text := (public.budget_setting(NEW.tenant_id)).control_mode; _r record; _a record; _v uuid[]; _amt numeric;
  _purchases uuid := public.posting_account(NEW.tenant_id, 'PURCHASES');
  _lines boolean := EXISTS (SELECT 1 FROM public.ap_invoice_lines WHERE invoice_id = NEW.id);
BEGIN
  IF _mode = 'off' OR NEW.po_id IS NOT NULL OR NEW.approval_status <> 'submitted' OR OLD.approval_status = 'submitted' THEN RETURN NEW; END IF;
  _v := public.document_all_values('AP', NEW.id);
  FOR _r IN
    SELECT COALESCE(l.expense_account_id, _purchases) AS acc, sum(l.net_amount) AS amount
      FROM public.ap_invoice_lines l WHERE l.invoice_id = NEW.id GROUP BY 1
    UNION ALL
    SELECT _purchases, NEW.subtotal WHERE NOT _lines
  LOOP
    CONTINUE WHEN _r.acc IS NULL;
    FOR _a IN SELECT * FROM public.budget_availability(NEW.tenant_id, _r.acc, NEW.invoice_date, NULL, NULL, _v) LOOP
      IF _a.analytic_value_id IS NULL THEN _amt := _r.amount;
      ELSIF _lines THEN
        SELECT COALESCE(sum(l.net_amount), 0) INTO _amt FROM public.ap_invoice_lines l
         WHERE l.invoice_id = NEW.id AND COALESCE(l.expense_account_id, _purchases) = _r.acc
           AND public.line_effective_analytics('AP', l.id) && public.analytic_value_scope(_a.analytic_value_id);
      ELSE _amt := public.document_amount_in_scope('AP', NEW.id, _a.analytic_value_id);
      END IF;
      IF _amt > 0 AND _amt > _a.available AND _mode = 'block' THEN
        RAISE EXCEPTION 'Budget dépassé (compte %, du % au %) : facture % pour % disponibles', _a.budget_code || COALESCE(' / ' || _a.analytic_label, ''),
          _a.period_from, _a.period_to, _amt, _a.available
          USING ERRCODE = 'QG024', HINT = 'Réviser le budget ou rattacher la facture à une commande autorisée.';
      END IF;
    END LOOP;
  END LOOP;
  RETURN NEW;
END $function$;

-- Factures non parvenues à la réception : une ligne de charge par ensemble de sections des lignes de commande.
CREATE OR REPLACE FUNCTION public.on_gr_grni()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _entry uuid; _who uuid; _g record; _jl uuid; _label text; _sum numeric := 0; _purchases uuid; _grni uuid;
BEGIN
  IF TG_OP <> 'UPDATE' OR NEW.status <> 'completed' OR OLD.status = 'completed' THEN RETURN NULL; END IF;
  IF NOT COALESCE((public.procurement_setting(NEW.tenant_id)).grni_on_receipt, false) THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gr_lines gl JOIN public.po_lines pl ON pl.id = gl.po_line_id
                  WHERE gl.gr_id = NEW.id AND gl.quantity_received > 0 AND COALESCE(pl.unit_cost, 0) > 0) THEN RETURN NULL; END IF;
  _purchases := public.require_posting_account(NEW.tenant_id, 'PURCHASES');
  _grni := public.require_posting_account(NEW.tenant_id, 'GRNI');
  _who := COALESCE(auth.uid(), NEW.received_by);
  _label := 'Réception ' || NEW.gr_number || ' — factures non parvenues';
  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES (NEW.tenant_id, 'JE-GOODS_-' || to_char(now(), 'YYYYMMDDHH24MISSMS') || '-' || substr(gen_random_uuid()::text, 1, 6),
          COALESCE(NEW.receipt_date, CURRENT_DATE), _label, 'goods_receipt', 'draft', _who)
  RETURNING id INTO _entry;
  FOR _g IN
    SELECT public.analytic_key(public.line_effective_analytics('PO', gl.po_line_id)) AS k, round(sum(gl.quantity_received * COALESCE(pl.unit_cost, 0)), 2) AS m
      FROM public.gr_lines gl JOIN public.po_lines pl ON pl.id = gl.po_line_id
     WHERE gl.gr_id = NEW.id AND gl.quantity_received > 0 GROUP BY 1
  LOOP
    CONTINUE WHEN _g.m = 0;
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description) VALUES (_entry, _purchases, _g.m, 0, _label) RETURNING id INTO _jl;
    IF _g.k <> '' THEN PERFORM public.impute_line_analytics(_jl, string_to_array(_g.k, ',')::uuid[]); END IF;
    _sum := _sum + _g.m;
  END LOOP;
  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description) VALUES (_entry, _grni, 0, _sum, _label);
  UPDATE public.journal_entries SET status = 'posted', posted_by = _who, posted_at = now() WHERE id = _entry;
  INSERT INTO public.grni_ledger (tenant_id, po_line_id, source, source_id, amount, journal_entry_id)
  SELECT NEW.tenant_id, gl.po_line_id, 'receipt', NEW.id, round(sum(gl.quantity_received * COALESCE(pl.unit_cost, 0)), 2), _entry
    FROM public.gr_lines gl JOIN public.po_lines pl ON pl.id = gl.po_line_id
   WHERE gl.gr_id = NEW.id AND gl.quantity_received > 0 GROUP BY gl.po_line_id;
  RETURN NULL;
END $function$;

-- ───────────────────────── 2. Prévisions saisies ─────────────────────────
CREATE TABLE public.budget_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  fiscal_year text NOT NULL CHECK (fiscal_year ~ '^\d{4}$'),
  name text NOT NULL CHECK (btrim(name) <> ''),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  notes text,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid,
  published_at timestamptz,
  UNIQUE (tenant_id, fiscal_year, name));
CREATE TABLE public.budget_forecast_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  forecast_id uuid NOT NULL REFERENCES public.budget_forecasts(id) ON DELETE CASCADE,
  gl_account_id uuid NOT NULL REFERENCES public.gl_accounts(id),
  analytic_value_id uuid REFERENCES public.analytic_values(id),
  amount numeric(18,2) NOT NULL CHECK (amount >= 0),
  comment text);
CREATE UNIQUE INDEX budget_forecast_lines_unique ON public.budget_forecast_lines (forecast_id, gl_account_id, COALESCE(analytic_value_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX budget_forecasts_year_idx ON public.budget_forecasts (tenant_id, fiscal_year);

CREATE OR REPLACE FUNCTION public.guard_budget_forecast()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon', 'qerp_api') THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'draft'; NEW.created_by := auth.uid(); NEW.published_by := NULL; NEW.published_at := NULL;
    RETURN NEW;
  END IF;
  IF OLD.status = 'published' THEN
    RAISE EXCEPTION 'Prévision « % » publiée : figée (en créer une nouvelle version)', OLD.name USING ERRCODE = 'QG024';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.status, NEW.published_by, NEW.tenant_id, NEW.fiscal_year) IS DISTINCT FROM (OLD.status, OLD.published_by, OLD.tenant_id, OLD.fiscal_year) THEN
    RAISE EXCEPTION 'Le statut, la société et l''exercice d''une prévision ne se modifient pas (publier par la fonction prévue)' USING ERRCODE = 'QG024';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $function$;
CREATE TRIGGER trg_guard_budget_forecast BEFORE INSERT OR UPDATE OR DELETE ON public.budget_forecasts FOR EACH ROW EXECUTE FUNCTION public.guard_budget_forecast();

CREATE OR REPLACE FUNCTION public.guard_budget_forecast_line()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE _f public.budget_forecasts%ROWTYPE;
BEGIN
  SELECT * INTO _f FROM public.budget_forecasts WHERE id = COALESCE(NEW.forecast_id, OLD.forecast_id);
  IF _f.id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  IF current_user IN ('authenticated', 'anon', 'qerp_api') AND _f.status = 'published' THEN
    RAISE EXCEPTION 'Prévision « % » publiée : ses lignes sont figées', _f.name USING ERRCODE = 'QG024';
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.tenant_id IS DISTINCT FROM _f.tenant_id THEN
    RAISE EXCEPTION 'Ligne de prévision : société différente de celle de la prévision' USING ERRCODE = 'QG017';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $function$;
CREATE TRIGGER trg_guard_budget_forecast_line BEFORE INSERT OR UPDATE OR DELETE ON public.budget_forecast_lines FOR EACH ROW EXECUTE FUNCTION public.guard_budget_forecast_line();

ALTER TABLE public.budget_forecasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_forecast_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture société" ON public.budget_forecasts FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Prévision habilitée" ON public.budget_forecasts FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'budget.forecast'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'budget.forecast'));
CREATE POLICY "Lecture société" ON public.budget_forecast_lines FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Prévision habilitée" ON public.budget_forecast_lines FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'budget.forecast'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'budget.forecast'));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.budget_forecasts, public.budget_forecast_lines TO authenticated;

CREATE OR REPLACE FUNCTION public.budget_forecast_publish(_forecast uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _f public.budget_forecasts%ROWTYPE;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'budget.forecast') THEN RAISE EXCEPTION 'Droit insuffisant : saisir et publier les prévisions budgétaires' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _f FROM public.budget_forecasts WHERE id = _forecast AND tenant_id = public.get_user_tenant_id(auth.uid()) FOR UPDATE;
  IF _f.id IS NULL THEN RAISE EXCEPTION 'Prévision introuvable' USING ERRCODE = 'QG024'; END IF;
  IF _f.status <> 'draft' THEN RAISE EXCEPTION 'Prévision déjà publiée' USING ERRCODE = 'QG024'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.budget_forecast_lines WHERE forecast_id = _forecast) THEN
    RAISE EXCEPTION 'Prévision sans ligne : rien à publier' USING ERRCODE = 'QG024';
  END IF;
  UPDATE public.budget_forecasts SET status = 'published', published_by = auth.uid(), published_at = now() WHERE id = _forecast;
END $function$;
REVOKE EXECUTE ON FUNCTION public.budget_forecast_publish(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.budget_forecast_publish(uuid) TO authenticated;

-- ───────────────────────── 3. Préparation par fichier ─────────────────────────
-- Résolution commune : compte (code, actif, charges ou produits), section (code, ou AXE/CODE si ambiguë).
CREATE OR REPLACE FUNCTION public.budget_import_resolve(_tenant uuid, _rows jsonb, _with_period boolean, _year text)
 RETURNS TABLE(line_no int, gl_account_id uuid, analytic_value_id uuid, period text, amount numeric, comment text, error text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _r jsonb; _n int := 0; _code text; _sec text; _per text; _amt numeric; _acc uuid; _val uuid; _cnt int; _e text[];
BEGIN
  IF jsonb_typeof(_rows) <> 'array' OR jsonb_array_length(_rows) = 0 THEN RAISE EXCEPTION 'Fichier vide' USING ERRCODE = 'QG024'; END IF;
  IF jsonb_array_length(_rows) > 20000 THEN RAISE EXCEPTION 'Fichier trop volumineux (20 000 lignes au plus)' USING ERRCODE = 'QG024'; END IF;
  FOR _r IN SELECT * FROM jsonb_array_elements(_rows) LOOP
    _n := _n + 1; _e := '{}'; _acc := NULL; _val := NULL;
    line_no := COALESCE((_r ->> 'line')::int, _n + 1);
    _code := NULLIF(regexp_replace(COALESCE(_r ->> 'account', ''), '\s', '', 'g'), '');
    _sec := NULLIF(btrim(COALESCE(_r ->> 'section', '')), '');
    _per := NULLIF(btrim(COALESCE(_r ->> 'period', '')), '');
    BEGIN _amt := round((_r ->> 'amount')::numeric, 2); EXCEPTION WHEN others THEN _amt := NULL; END;
    IF _code IS NULL THEN _e := array_append(_e, 'compte manquant');
    ELSE
      SELECT g.id INTO _acc FROM public.gl_accounts g WHERE g.tenant_id = _tenant AND g.code = _code AND g.is_active AND g.account_type IN ('expense', 'revenue');
      IF _acc IS NULL THEN _e := array_append(_e, 'compte ' || _code || ' inconnu, inactif ou hors charges et produits'); END IF;
    END IF;
    IF _sec IS NOT NULL AND lower(_sec) NOT IN ('toutes', 'toutes les sections') THEN
      IF position('/' IN _sec) > 0 THEN
        SELECT v.id INTO _val FROM public.analytic_values v JOIN public.analytic_axes a ON a.id = v.axis_id
         WHERE v.tenant_id = _tenant AND v.is_active AND a.is_active AND upper(a.code) = upper(split_part(_sec, '/', 1)) AND upper(v.code) = upper(split_part(_sec, '/', 2));
        IF _val IS NULL THEN _e := array_append(_e, 'section ' || _sec || ' inconnue ou inactive'); END IF;
      ELSE
        SELECT count(*), min(v.id::text)::uuid INTO _cnt, _val FROM public.analytic_values v JOIN public.analytic_axes a ON a.id = v.axis_id
         WHERE v.tenant_id = _tenant AND v.is_active AND a.is_active AND upper(v.code) = upper(split_part(_sec, ' ', 1));
        IF _cnt = 0 THEN _e := array_append(_e, 'section ' || _sec || ' inconnue ou inactive'); _val := NULL;
        ELSIF _cnt > 1 THEN _e := array_append(_e, 'section ' || _sec || ' présente sur plusieurs axes : écrire AXE/CODE'); _val := NULL;
        END IF;
      END IF;
    END IF;
    IF _with_period THEN
      _per := COALESCE(_per, _year);
      IF _per !~ '^\d{4}(-(0[1-9]|1[0-2]))?$' OR left(_per, 4) <> _year THEN _e := array_append(_e, 'période ' || _per || ' hors exercice ' || _year || ' (AAAA ou AAAA-MM)'); END IF;
    END IF;
    IF _amt IS NULL OR _amt < 0 THEN _e := array_append(_e, 'montant invalide'); END IF;
    gl_account_id := _acc; analytic_value_id := _val; period := CASE WHEN _with_period THEN _per END; amount := _amt;
    comment := NULLIF(btrim(COALESCE(_r ->> 'comment', '')), '');
    error := CASE WHEN cardinality(_e) > 0 THEN 'ligne ' || line_no || ' : ' || array_to_string(_e, ', ') END;
    RETURN NEXT;
  END LOOP;
END $function$;
REVOKE EXECUTE ON FUNCTION public.budget_import_resolve(uuid, jsonb, boolean, text) FROM PUBLIC, anon, authenticated;

-- Budget en brouillon : les lignes du fichier remplacent celles du budget, tout ou rien.
CREATE OR REPLACE FUNCTION public.import_budget_lines(_budget uuid, _rows jsonb)
 RETURNS int
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _b public.budgets%ROWTYPE; _errors text[]; _dup text[]; _n int;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'budget.manage') THEN RAISE EXCEPTION 'Droit insuffisant : préparer les budgets' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _b FROM public.budgets WHERE id = _budget AND tenant_id = public.get_user_tenant_id(auth.uid()) FOR UPDATE;
  IF _b.id IS NULL THEN RAISE EXCEPTION 'Budget introuvable' USING ERRCODE = 'QG024'; END IF;
  IF _b.status <> 'draft' THEN RAISE EXCEPTION 'Seul un budget en brouillon s''importe (approuvé : réviser ses lignes)' USING ERRCODE = 'QG024'; END IF;
  CREATE TEMP TABLE import_budget ON COMMIT DROP AS SELECT * FROM public.budget_import_resolve(_b.tenant_id, _rows, true, _b.fiscal_year);
  SELECT array_agg(error ORDER BY line_no) INTO _errors FROM import_budget WHERE error IS NOT NULL;
  SELECT array_agg(format('lignes %s : même compte, section et période', l)) INTO _dup FROM (
    SELECT string_agg(line_no::text, ', ' ORDER BY line_no) AS l FROM import_budget WHERE error IS NULL
     GROUP BY gl_account_id, analytic_value_id, period HAVING count(*) > 1) d;
  _errors := COALESCE(_errors, '{}') || COALESCE(_dup, '{}');
  IF cardinality(_errors) > 0 THEN
    RAISE EXCEPTION 'Import refusé, rien n''a été modifié (% anomalie(s)) : %', cardinality(_errors), array_to_string(_errors[1:20], ' ; ') USING ERRCODE = 'QG024';
  END IF;
  DELETE FROM public.budget_lines WHERE budget_id = _budget;
  INSERT INTO public.budget_lines (tenant_id, budget_id, gl_account_id, period, planned_amount, actual_amount, analytic_value_id)
  SELECT _b.tenant_id, _budget, gl_account_id, period, amount, 0, analytic_value_id FROM import_budget;
  GET DIAGNOSTICS _n = ROW_COUNT;
  DROP TABLE import_budget;
  RETURN _n;
END $function$;

-- Prévision en brouillon : idem, sans période (montant de l'exercice).
CREATE OR REPLACE FUNCTION public.import_budget_forecast_lines(_forecast uuid, _rows jsonb)
 RETURNS int
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _f public.budget_forecasts%ROWTYPE; _errors text[]; _dup text[]; _n int;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'budget.forecast') THEN RAISE EXCEPTION 'Droit insuffisant : saisir et publier les prévisions budgétaires' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _f FROM public.budget_forecasts WHERE id = _forecast AND tenant_id = public.get_user_tenant_id(auth.uid()) FOR UPDATE;
  IF _f.id IS NULL THEN RAISE EXCEPTION 'Prévision introuvable' USING ERRCODE = 'QG024'; END IF;
  IF _f.status <> 'draft' THEN RAISE EXCEPTION 'Prévision publiée : figée (en créer une nouvelle version)' USING ERRCODE = 'QG024'; END IF;
  CREATE TEMP TABLE import_forecast ON COMMIT DROP AS SELECT * FROM public.budget_import_resolve(_f.tenant_id, _rows, false, _f.fiscal_year);
  SELECT array_agg(error ORDER BY line_no) INTO _errors FROM import_forecast WHERE error IS NOT NULL;
  SELECT array_agg(format('lignes %s : même compte et section', l)) INTO _dup FROM (
    SELECT string_agg(line_no::text, ', ' ORDER BY line_no) AS l FROM import_forecast WHERE error IS NULL
     GROUP BY gl_account_id, analytic_value_id HAVING count(*) > 1) d;
  _errors := COALESCE(_errors, '{}') || COALESCE(_dup, '{}');
  IF cardinality(_errors) > 0 THEN
    RAISE EXCEPTION 'Import refusé, rien n''a été modifié (% anomalie(s)) : %', cardinality(_errors), array_to_string(_errors[1:20], ' ; ') USING ERRCODE = 'QG024';
  END IF;
  DELETE FROM public.budget_forecast_lines WHERE forecast_id = _forecast;
  INSERT INTO public.budget_forecast_lines (tenant_id, forecast_id, gl_account_id, analytic_value_id, amount, comment)
  SELECT _f.tenant_id, _forecast, gl_account_id, analytic_value_id, amount, comment FROM import_forecast;
  GET DIAGNOSTICS _n = ROW_COUNT;
  DROP TABLE import_forecast;
  RETURN _n;
END $function$;
REVOKE EXECUTE ON FUNCTION public.import_budget_lines(uuid, jsonb), public.import_budget_forecast_lines(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_budget_lines(uuid, jsonb), public.import_budget_forecast_lines(uuid, jsonb) TO authenticated;

-- ───────────────────────── 4. Approbation des révisions ─────────────────────────
ALTER TABLE public.budget_revisions
  ADD COLUMN status text NOT NULL DEFAULT 'applied' CHECK (status IN ('pending', 'applied', 'rejected')),
  ADD COLUMN decided_by uuid,
  ADD COLUMN decided_at timestamptz,
  ADD COLUMN decision_comment text;
CREATE UNIQUE INDEX budget_revisions_one_pending ON public.budget_revisions (budget_line_id) WHERE status = 'pending';

DROP FUNCTION public.budget_revise_line(uuid, numeric, text);
-- Révision : directe par un approbateur ; si le paramètre l'exige et que l'écart dépasse le seuil, demande
-- (préparateur ou approbateur) validée par une autre personne. Retourne « applied » ou « pending ».
CREATE FUNCTION public.budget_revise_line(_line uuid, _amount numeric, _reason text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _l public.budget_lines%ROWTYPE; _b public.budgets%ROWTYPE; _s public.budget_settings; _new numeric := round(_amount, 2); _pct numeric;
BEGIN
  SELECT * INTO _l FROM public.budget_lines WHERE id = _line FOR UPDATE;
  SELECT * INTO _b FROM public.budgets WHERE id = _l.budget_id AND tenant_id = public.get_user_tenant_id(auth.uid());
  IF _l.id IS NULL OR _b.id IS NULL THEN RAISE EXCEPTION 'Ligne de budget introuvable' USING ERRCODE = 'QG024'; END IF;
  IF _b.status <> 'approved' THEN RAISE EXCEPTION 'Seule une ligne d''un budget approuvé se révise (brouillon : modifier la ligne)' USING ERRCODE = 'QG024'; END IF;
  IF _amount IS NULL OR _amount < 0 THEN RAISE EXCEPTION 'Montant révisé positif ou nul requis' USING ERRCODE = 'QG024'; END IF;
  IF COALESCE(btrim(_reason), '') = '' THEN RAISE EXCEPTION 'Motif de la révision obligatoire' USING ERRCODE = 'QG024'; END IF;
  _s := public.budget_setting(_b.tenant_id);
  _pct := CASE WHEN _l.planned_amount = 0 THEN 100 ELSE abs(_new - _l.planned_amount) / _l.planned_amount * 100 END;
  IF _s.revision_second_person AND _pct > _s.revision_threshold_pct THEN
    IF NOT (public.has_permission(auth.uid(), 'budget.manage') OR public.has_permission(auth.uid(), 'budget.approve')) THEN
      RAISE EXCEPTION 'Droit insuffisant : préparer ou approuver les budgets' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM public.budget_revisions WHERE budget_line_id = _line AND status = 'pending') THEN
      RAISE EXCEPTION 'Une demande de révision est déjà en attente sur cette ligne' USING ERRCODE = 'QG024';
    END IF;
    INSERT INTO public.budget_revisions (tenant_id, budget_line_id, old_amount, new_amount, reason, created_by, status)
    VALUES (_l.tenant_id, _l.id, _l.planned_amount, _new, btrim(_reason), auth.uid(), 'pending');
    RETURN 'pending';
  END IF;
  IF NOT public.has_permission(auth.uid(), 'budget.approve') THEN
    RAISE EXCEPTION 'Droit insuffisant : approuver et réviser les budgets' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.budget_revisions (tenant_id, budget_line_id, old_amount, new_amount, reason, created_by, status, decided_by, decided_at)
  VALUES (_l.tenant_id, _l.id, _l.planned_amount, _new, btrim(_reason), auth.uid(), 'applied', auth.uid(), now());
  UPDATE public.budget_lines SET planned_amount = _new WHERE id = _line;
  RETURN 'applied';
END $function$;

CREATE OR REPLACE FUNCTION public.budget_revision_decide(_revision uuid, _approve boolean, _comment text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _r public.budget_revisions%ROWTYPE; _l public.budget_lines%ROWTYPE;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'budget.approve') THEN RAISE EXCEPTION 'Droit insuffisant : approuver et réviser les budgets' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _r FROM public.budget_revisions WHERE id = _revision AND tenant_id = public.get_user_tenant_id(auth.uid()) FOR UPDATE;
  IF _r.id IS NULL THEN RAISE EXCEPTION 'Demande de révision introuvable' USING ERRCODE = 'QG024'; END IF;
  IF _r.status <> 'pending' THEN RAISE EXCEPTION 'Demande déjà traitée' USING ERRCODE = 'QG024'; END IF;
  IF _r.created_by = auth.uid() THEN
    RAISE EXCEPTION 'Séparation des tâches : une demande de révision est validée par une autre personne que son auteur' USING ERRCODE = 'QG024';
  END IF;
  IF NOT _approve THEN
    IF COALESCE(btrim(_comment), '') = '' THEN RAISE EXCEPTION 'Motif du refus obligatoire' USING ERRCODE = 'QG024'; END IF;
    UPDATE public.budget_revisions SET status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_comment = btrim(_comment) WHERE id = _revision;
    RETURN;
  END IF;
  SELECT * INTO _l FROM public.budget_lines WHERE id = _r.budget_line_id FOR UPDATE;
  IF _l.planned_amount IS DISTINCT FROM _r.old_amount THEN
    RAISE EXCEPTION 'La ligne a changé depuis la demande (% au lieu de %) : refuser et redemander', _l.planned_amount, _r.old_amount USING ERRCODE = 'QG024';
  END IF;
  UPDATE public.budget_lines SET planned_amount = _r.new_amount WHERE id = _l.id;
  UPDATE public.budget_revisions SET status = 'applied', decided_by = auth.uid(), decided_at = now(), decision_comment = NULLIF(btrim(COALESCE(_comment, '')), '') WHERE id = _revision;
END $function$;
REVOKE EXECUTE ON FUNCTION public.budget_revise_line(uuid, numeric, text), public.budget_revision_decide(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.budget_revise_line(uuid, numeric, text), public.budget_revision_decide(uuid, boolean, text) TO authenticated;

-- ───────────────────────── Fonctions reprises ─────────────────────────
CREATE OR REPLACE FUNCTION public.ap_invoice_journal_entry(_inv ap_invoices)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _entry_id uuid;
  _payable uuid := public.posting_account(_inv.tenant_id, 'AP_PAYABLE');
  _purchases uuid := public.posting_account(_inv.tenant_id, 'PURCHASES');
  _vat uuid := public.posting_account(_inv.tenant_id, 'VAT_INPUT');
  _grni uuid := public.posting_account(_inv.tenant_id, 'GRNI');
  _grni_on boolean := COALESCE((public.procurement_setting(_inv.tenant_id)).grni_on_receipt, false);
  _has_lines boolean := EXISTS (SELECT 1 FROM public.ap_invoice_lines WHERE invoice_id = _inv.id);
  _tax numeric := COALESCE(_inv.tax_amount, 0);
  _net numeric := COALESCE(_inv.subtotal, 0);
  _total numeric := round(COALESCE(_inv.subtotal, 0) + COALESCE(_inv.tax_amount, 0), 2);
  _manquants text[] := '{}';
  _l record; _clear numeric; _left numeric; _acc uuid[] := '{}'; _amt numeric[] := '{}'; _lbl text[] := '{}';
  _sec text[] := '{}'; _g record; _jl uuid; _hdr text := public.analytic_key(public.document_analytic_values('AP', _inv.id));
BEGIN
  IF _payable IS NULL THEN _manquants := _manquants || 'AP_PAYABLE'::text; END IF;
  IF _purchases IS NULL AND (NOT _has_lines OR EXISTS (SELECT 1 FROM public.ap_invoice_lines WHERE invoice_id = _inv.id AND expense_account_id IS NULL)) THEN
    _manquants := _manquants || 'PURCHASES'::text;
  END IF;
  IF _tax <> 0 AND _vat IS NULL AND (NOT _has_lines OR EXISTS (
       SELECT 1 FROM public.ap_invoice_lines l LEFT JOIN public.tax_codes t ON t.id = l.tax_code_id
        WHERE l.invoice_id = _inv.id AND l.tax_amount <> 0 AND t.gl_account_id IS NULL)) THEN
    _manquants := _manquants || 'VAT_INPUT'::text;
  END IF;
  IF _grni_on AND _grni IS NULL AND _inv.po_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.grni_ledger g JOIN public.po_lines pl ON pl.id = g.po_line_id WHERE pl.po_id = _inv.po_id) THEN
    _manquants := _manquants || 'GRNI'::text;
  END IF;
  IF cardinality(_manquants) > 0 THEN
    RAISE EXCEPTION 'Paramétrage comptable incomplet : % ; la facture fournisseur % ne peut pas être comptabilisée',
      public.posting_roles_label(_manquants), _inv.invoice_number
      USING ERRCODE = 'QG001', HINT = 'Associer un compte actif à chaque rôle dans le paramétrage comptable.';
  END IF;
  PERFORM set_config('qerp.ap_posting', 'on', true);

  IF _has_lines THEN
    FOR _l IN SELECT l.*, pl.unit_cost FROM public.ap_invoice_lines l LEFT JOIN public.po_lines pl ON pl.id = l.po_line_id
               WHERE l.invoice_id = _inv.id ORDER BY l.line_no LOOP
      _clear := 0;
      IF _grni_on AND _l.po_line_id IS NOT NULL THEN
        _clear := greatest(0, least(round(_l.quantity * COALESCE(_l.unit_cost, 0), 2), public.grni_open(_l.po_line_id)));
        IF _clear > 0 THEN
          INSERT INTO public.grni_ledger (tenant_id, po_line_id, source, source_id, amount) VALUES (_inv.tenant_id, _l.po_line_id, 'invoice', _inv.id, -_clear);
          UPDATE public.ap_invoice_lines SET grni_cleared = _clear WHERE id = _l.id;
          _acc := _acc || _grni; _amt := _amt || _clear; _lbl := _lbl || 'DR Factures non parvenues'::text; _sec := _sec || ''::text;
        END IF;
      END IF;
      IF _l.net_amount - _clear <> 0 THEN
        _acc := _acc || COALESCE(_l.expense_account_id, _purchases); _amt := _amt || (_l.net_amount - _clear);
        _lbl := _lbl || CASE WHEN _clear > 0 THEN 'Écart de prix / quantité' ELSE 'DR Achats HT' END;
        _sec := _sec || public.analytic_key(public.line_effective_analytics('AP', _l.id));
      END IF;
    END LOOP;
    FOR _l IN SELECT COALESCE(t.gl_account_id, _vat) AS acc, sum(l.tax_amount) AS tax FROM public.ap_invoice_lines l
                LEFT JOIN public.tax_codes t ON t.id = l.tax_code_id WHERE l.invoice_id = _inv.id AND l.tax_amount <> 0 GROUP BY 1 LOOP
      _acc := _acc || _l.acc; _amt := _amt || _l.tax; _lbl := _lbl || 'DR TVA déductible'::text; _sec := _sec || ''::text;
    END LOOP;
  ELSE
    _clear := 0;
    IF _grni_on AND _inv.po_id IS NOT NULL THEN
      _left := _net;
      FOR _l IN SELECT pl.id, public.grni_open(pl.id) AS open FROM public.po_lines pl WHERE pl.po_id = _inv.po_id ORDER BY pl.id LOOP
        EXIT WHEN _left <= 0;
        IF _l.open > 0 THEN
          INSERT INTO public.grni_ledger (tenant_id, po_line_id, source, source_id, amount) VALUES (_inv.tenant_id, _l.id, 'invoice', _inv.id, -least(_l.open, _left));
          _clear := _clear + least(_l.open, _left); _left := _left - least(_l.open, _left);
        END IF;
      END LOOP;
    END IF;
    IF _clear > 0 THEN _acc := _acc || _grni; _amt := _amt || _clear; _lbl := _lbl || 'DR Factures non parvenues'::text; _sec := _sec || ''::text; END IF;
    IF _net - _clear <> 0 THEN _acc := _acc || _purchases; _amt := _amt || (_net - _clear); _lbl := _lbl || 'DR Achats HT'::text; _sec := _sec || _hdr; END IF;
    IF _tax <> 0 THEN _acc := _acc || _vat; _amt := _amt || _tax; _lbl := _lbl || 'DR TVA déductible'::text; _sec := _sec || ''::text; END IF;
  END IF;

  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES (_inv.tenant_id, 'JE-AP-' || to_char(now(), 'YYYYMMDD') || '-' || substr(_inv.id::text, 1, 8),
          _inv.invoice_date, 'Facture fournisseur ' || _inv.invoice_number, 'ap_invoice', 'draft', _inv.created_by)
  RETURNING id INTO _entry_id;
  -- Une ligne d'écriture par compte × ensemble de sections (V78), imputée avant la comptabilisation.
  FOR _g IN SELECT x.a, x.s, sum(x.m) AS m, min(x.l) AS l FROM unnest(_acc, _amt, _lbl, _sec) AS x(a, m, l, s)
             GROUP BY x.a, x.s HAVING sum(x.m) <> 0 ORDER BY min(x.l), x.s LOOP
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _g.a, greatest(_g.m, 0), greatest(-_g.m, 0), _g.l) RETURNING id INTO _jl;
    IF _g.s <> '' THEN PERFORM public.impute_line_analytics(_jl, string_to_array(_g.s, ',')::uuid[]); END IF;
  END LOOP;
  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  VALUES (_entry_id, _payable, 0, _total, 'CR Fournisseurs');
  UPDATE public.grni_ledger SET journal_entry_id = _entry_id WHERE source = 'invoice' AND source_id = _inv.id AND journal_entry_id IS NULL;
  UPDATE public.journal_entries SET status = 'posted', posted_by = _inv.created_by, posted_at = now() WHERE id = _entry_id;
  PERFORM set_config('qerp.ap_posting', 'off', true);
  RETURN _entry_id;
END $function$;

CREATE OR REPLACE FUNCTION public.convert_pr_to_po(_pr_id uuid, _supplier_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _pr public.purchase_requisitions%ROWTYPE;
  _po_id uuid;
  _po_number text;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF NOT public.has_procurement_perm(auth.uid(), 'convert') THEN
    RAISE EXCEPTION 'Droit insuffisant : la conversion d''une demande en commande est réservée au contrôleur des achats ou à un approbateur de niveau 2 et plus'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _pr FROM public.purchase_requisitions WHERE id = _pr_id FOR UPDATE;
  IF NOT FOUND OR _pr.tenant_id IS DISTINCT FROM _tenant THEN
    RAISE EXCEPTION 'Demande d''achat introuvable' USING ERRCODE = '22023';
  END IF;
  IF _pr.status <> 'approved' THEN
    RAISE EXCEPTION 'La demande % doit être approuvée pour être convertie (statut : %)', _pr.pr_number, _pr.status
      USING ERRCODE = '23514';
  END IF;
  IF _pr.po_id IS NOT NULL THEN
    RAISE EXCEPTION 'La demande % est déjà convertie en commande', _pr.pr_number USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.suppliers s WHERE s.id = _supplier_id AND s.tenant_id = _tenant) THEN
    RAISE EXCEPTION 'Fournisseur introuvable dans la société' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.requisition_lines rl WHERE rl.requisition_id = _pr_id) THEN
    RAISE EXCEPTION 'La demande % n''a aucune ligne : rien à commander', _pr.pr_number USING ERRCODE = '23514';
  END IF;

  -- Numéro : séquence de la table (valeur par défaut de po_number).
  INSERT INTO public.purchase_orders (tenant_id, supplier_id, order_date, total, status, created_by)
  VALUES (_pr.tenant_id, _supplier_id, CURRENT_DATE, COALESCE(_pr.estimated_total, 0), 'draft', auth.uid())
  RETURNING id, po_number INTO _po_id, _po_number;

  -- total : colonne calculée par la base ; le total de la commande est recalculé par recompute_po_total.
  INSERT INTO public.po_lines (po_id, item_id, description, quantity, unit_cost, requisition_line_id)
  SELECT _po_id, rl.item_id, rl.description, rl.quantity, rl.estimated_unit_cost, rl.id
    FROM public.requisition_lines rl WHERE rl.requisition_id = _pr_id;

  UPDATE public.purchase_requisitions SET po_id = _po_id, status = 'converted' WHERE id = _pr_id;

  PERFORM public.notify_procurement(_pr.tenant_id, 'info',
    'Demande convertie en commande', _pr.pr_number || ' → ' || _po_number, _po_id::text);
  RETURN _po_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.on_supplier_return_grni()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _r public.supplier_returns%ROWTYPE; _amt numeric; _entry uuid;
BEGIN
  IF NEW.po_line_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO _r FROM public.supplier_returns WHERE id = NEW.return_id;
  IF NOT COALESCE((public.procurement_setting(_r.tenant_id)).grni_on_receipt, false) THEN RETURN NULL; END IF;
  _amt := least(round(NEW.quantity * COALESCE(NEW.unit_cost, 0), 2), public.grni_open(NEW.po_line_id));
  IF _amt <= 0 THEN RETURN NULL; END IF;
  _entry := public.post_two_line_entry_as(_r.tenant_id, COALESCE(_r.return_date, CURRENT_DATE), 'grni_return',
    'Retour ' || _r.return_number || ' — factures non parvenues',
    public.require_posting_account(_r.tenant_id, 'GRNI'), public.require_posting_account(_r.tenant_id, 'PURCHASES'), _amt, _r.created_by,
    public.line_effective_analytics('PO', NEW.po_line_id));
  INSERT INTO public.grni_ledger (tenant_id, po_line_id, source, source_id, amount, journal_entry_id)
  VALUES (_r.tenant_id, NEW.po_line_id, 'return', _r.id, -_amt, _entry);
  RETURN NULL;
END $function$;

SELECT public.install_tenant_isolation_triggers();
