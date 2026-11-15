-- V77 — Contrôle budgétaire, lot B2 (audit docs/audit-erp/15, « Restant ») :
--   1. pré-engagement des demandes d'achat : une demande soumise ou approuvée, non encore convertie,
--      réserve le budget ; contrôlée à la soumission comme une commande (paramétrable, dérogation motivée) ;
--   2. budgets par axe analytique : demandes, commandes et factures fournisseurs portent une section par axe
--      (reprise demande → commande → facture), l'écriture d'achat l'impute aux lignes de charges ; une ligne
--      de budget sur une section contrôle les pièces de cette section et de ses sous-sections ;
--   3. lectures pour les écrans Contrôle et Prévisions (réalisé mensuel par ligne, seuil d'alerte).
-- Références : SAP Funds Management (pré-engagement = earmarked funds / demandes d'achat, engagement =
-- commandes, contrôle de disponibilité AVC par centre financier), Sage X3 (engagements et pré-engagements
-- budgétaires par axe analytique), SYSCOHADA (comptabilité analytique libre, hors plan).

-- ───────────────────────── Paramètres ─────────────────────────
ALTER TABLE public.budget_settings
  ADD COLUMN precommit_requisitions boolean NOT NULL DEFAULT true,
  ADD COLUMN control_requisitions boolean NOT NULL DEFAULT true,
  ADD COLUMN analytic_control boolean NOT NULL DEFAULT true,
  ADD COLUMN alert_threshold_pct numeric(5,2) NOT NULL DEFAULT 90 CHECK (alert_threshold_pct > 0 AND alert_threshold_pct <= 100);

CREATE OR REPLACE FUNCTION public.budget_setting(_tenant uuid)
 RETURNS budget_settings
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT s FROM public.budget_settings s WHERE s.tenant_id = _tenant),
                  ROW(_tenant, 'off', 'year', now(), true, true, true, 90)::public.budget_settings)
$function$;

-- ───────────────────────── Demandes : alerte et dérogation ─────────────────────────
ALTER TABLE public.purchase_requisitions
  ADD COLUMN budget_warning text,
  ADD COLUMN budget_override_reason text,
  ADD COLUMN budget_override_by uuid,
  ADD COLUMN budget_override_at timestamptz;

-- ───────────────────────── Imputation analytique des pièces d'achat ─────────────────────────
CREATE TABLE public.purchase_requisition_analytics (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.purchase_requisitions(id) ON DELETE CASCADE,
  axis_id uuid NOT NULL REFERENCES public.analytic_axes(id),
  value_id uuid NOT NULL,
  PRIMARY KEY (document_id, axis_id),
  FOREIGN KEY (value_id, axis_id) REFERENCES public.analytic_values(id, axis_id));
CREATE TABLE public.purchase_order_analytics (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  axis_id uuid NOT NULL REFERENCES public.analytic_axes(id),
  value_id uuid NOT NULL,
  PRIMARY KEY (document_id, axis_id),
  FOREIGN KEY (value_id, axis_id) REFERENCES public.analytic_values(id, axis_id));
CREATE TABLE public.ap_invoice_analytics (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.ap_invoices(id) ON DELETE CASCADE,
  axis_id uuid NOT NULL REFERENCES public.analytic_axes(id),
  value_id uuid NOT NULL,
  PRIMARY KEY (document_id, axis_id),
  FOREIGN KEY (value_id, axis_id) REFERENCES public.analytic_values(id, axis_id));
CREATE INDEX purchase_requisition_analytics_value_idx ON public.purchase_requisition_analytics (value_id);
CREATE INDEX purchase_order_analytics_value_idx ON public.purchase_order_analytics (value_id);
CREATE INDEX ap_invoice_analytics_value_idx ON public.ap_invoice_analytics (value_id);

-- Garde commune (pas SECURITY DEFINER : elle regarde current_user). Lecture des colonnes par to_jsonb
-- (piège V30 : une fonction attachée à plusieurs tables ne nomme pas les colonnes d'une seule).
CREATE OR REPLACE FUNCTION public.guard_document_analytics()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  _r jsonb := to_jsonb(COALESCE(NEW, OLD));
  _doc uuid := (_r ->> 'document_id')::uuid;
  _tenant uuid; _state text; _editable boolean; _label text;
BEGIN
  IF TG_TABLE_NAME = 'purchase_requisition_analytics' THEN
    SELECT tenant_id, status, status IN ('draft', 'rejected'), pr_number INTO _tenant, _state, _editable, _label FROM public.purchase_requisitions WHERE id = _doc;
  ELSIF TG_TABLE_NAME = 'purchase_order_analytics' THEN
    SELECT tenant_id, status, status IN ('draft', 'rejected'), po_number INTO _tenant, _state, _editable, _label FROM public.purchase_orders WHERE id = _doc;
  ELSE
    SELECT tenant_id, approval_status, approval_status IN ('draft', 'rejected'), invoice_number INTO _tenant, _state, _editable, _label FROM public.ap_invoices WHERE id = _doc;
  END IF;
  IF _tenant IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;   -- pièce supprimée (cascade)
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

CREATE TRIGGER trg_guard_document_analytics BEFORE INSERT OR UPDATE OR DELETE ON public.purchase_requisition_analytics FOR EACH ROW EXECUTE FUNCTION public.guard_document_analytics();
CREATE TRIGGER trg_guard_document_analytics BEFORE INSERT OR UPDATE OR DELETE ON public.purchase_order_analytics FOR EACH ROW EXECUTE FUNCTION public.guard_document_analytics();
CREATE TRIGGER trg_guard_document_analytics BEFORE INSERT OR UPDATE OR DELETE ON public.ap_invoice_analytics FOR EACH ROW EXECUTE FUNCTION public.guard_document_analytics();

ALTER TABLE public.purchase_requisition_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ap_invoice_analytics ENABLE ROW LEVEL SECURITY;
-- Lecture : la société. Écriture : qui peut modifier la pièce elle-même (la politique de la pièce s'applique
-- dans la sous-requête) ; la garde exige en plus une pièce modifiable.
CREATE POLICY "Lecture société" ON public.purchase_requisition_analytics FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Écriture avec la pièce" ON public.purchase_requisition_analytics FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND EXISTS (SELECT 1 FROM public.purchase_requisitions d WHERE d.id = document_id))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND EXISTS (SELECT 1 FROM public.purchase_requisitions d WHERE d.id = document_id));
CREATE POLICY "Lecture société" ON public.purchase_order_analytics FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Écriture avec la pièce" ON public.purchase_order_analytics FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND EXISTS (SELECT 1 FROM public.purchase_orders d WHERE d.id = document_id))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND EXISTS (SELECT 1 FROM public.purchase_orders d WHERE d.id = document_id));
CREATE POLICY "Lecture société" ON public.ap_invoice_analytics FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Écriture factures habilitée" ON public.ap_invoice_analytics FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'ap.invoice'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'ap.invoice'));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_requisition_analytics, public.purchase_order_analytics, public.ap_invoice_analytics TO authenticated;

-- Sections d'une pièce.
CREATE OR REPLACE FUNCTION public.document_analytic_values(_kind text, _id uuid)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(array_agg(value_id ORDER BY axis_id), '{}') FROM (
    SELECT value_id, axis_id FROM public.purchase_requisition_analytics WHERE _kind = 'PR' AND document_id = _id
    UNION ALL SELECT value_id, axis_id FROM public.purchase_order_analytics WHERE _kind = 'PO' AND document_id = _id
    UNION ALL SELECT value_id, axis_id FROM public.ap_invoice_analytics WHERE _kind = 'AP' AND document_id = _id) x
$function$;

-- Reprise : demande convertie → commande ; commande citée par une facture → facture (si rien de saisi).
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
  END IF;
  RETURN NULL;
END $function$;
CREATE TRIGGER trg_copy_requisition_analytics AFTER UPDATE OF status, po_id ON public.purchase_requisitions FOR EACH ROW EXECUTE FUNCTION public.copy_requisition_analytics();

CREATE OR REPLACE FUNCTION public.copy_po_analytics_to_ap_invoice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.po_id IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.po_id IS DISTINCT FROM NEW.po_id)
     AND NOT EXISTS (SELECT 1 FROM public.ap_invoice_analytics WHERE document_id = NEW.id) THEN
    INSERT INTO public.ap_invoice_analytics (tenant_id, document_id, axis_id, value_id)
    SELECT a.tenant_id, NEW.id, a.axis_id, a.value_id FROM public.purchase_order_analytics a WHERE a.document_id = NEW.po_id
    ON CONFLICT (document_id, axis_id) DO NOTHING;
  END IF;
  RETURN NULL;
END $function$;
CREATE TRIGGER trg_copy_po_analytics_to_ap_invoice AFTER INSERT OR UPDATE OF po_id ON public.ap_invoices FOR EACH ROW EXECUTE FUNCTION public.copy_po_analytics_to_ap_invoice();

-- Imputation d'une écriture d'achat encore en brouillon : sections de la pièce sur ses lignes de charges
-- (type « charges »), sauf compte ou règle qui interdit l'axe. Appelée avant la comptabilisation (V19 : figée ensuite).
CREATE OR REPLACE FUNCTION public.impute_entry_analytics(_entry uuid, _values uuid[])
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
   WHERE l.entry_id = _entry AND g.account_type = 'expense'
     AND g.analytic_policy IS DISTINCT FROM 'forbidden'
     AND (g.analytic_policy = 'required' OR COALESCE((SELECT r.requirement FROM public.analytic_rules r
           WHERE r.axis_id = v.axis_id AND g.code LIKE r.account_prefix || '%' ORDER BY length(r.account_prefix) DESC LIMIT 1), 'optional') <> 'forbidden')
  ON CONFLICT DO NOTHING;
END $function$;

CREATE OR REPLACE FUNCTION public.post_two_line_entry_as(_tenant uuid, _date date, _source text, _label text, _debit_account uuid, _credit_account uuid, _amount numeric, _actor uuid, _values uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _id uuid; _who uuid := COALESCE(auth.uid(), _actor);
BEGIN
  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES (_tenant, 'JE-' || upper(left(_source, 6)) || '-' || to_char(now(), 'YYYYMMDDHH24MISSMS') || '-' || substr(gen_random_uuid()::text, 1, 6),
          _date, _label, _source, 'draft', _who)
  RETURNING id INTO _id;
  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  VALUES (_id, _debit_account, _amount, 0, _label), (_id, _credit_account, 0, _amount, _label);
  PERFORM public.impute_entry_analytics(_id, _values);
  UPDATE public.journal_entries SET status = 'posted', posted_by = _who, posted_at = now() WHERE id = _id;
  RETURN _id;
END $function$;

REVOKE EXECUTE ON FUNCTION public.impute_entry_analytics(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.post_two_line_entry_as(uuid, date, text, text, uuid, uuid, numeric, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.document_analytic_values(text, uuid) FROM PUBLIC, anon;

-- ───────────────────────── Calculs ─────────────────────────
-- Une section budgétée couvre ses sous-sections.
CREATE OR REPLACE FUNCTION public.analytic_value_scope(_value uuid)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH RECURSIVE t AS (SELECT id FROM public.analytic_values WHERE id = _value
                       UNION SELECT v.id FROM public.analytic_values v JOIN t ON v.parent_id = t.id)
  SELECT COALESCE(array_agg(id), '{}') FROM t
$function$;

DROP FUNCTION public.budget_status(text);
DROP FUNCTION public.budget_availability(uuid, uuid, date, uuid);
DROP FUNCTION public.budget_committed(uuid, text, date, date, uuid);
DROP FUNCTION public.budget_actual(uuid, text, date, date);

-- Engagé : commandes approuvées et suivantes, nettes des factures approuvées qui les citent.
CREATE FUNCTION public.budget_committed(_tenant uuid, _code text, _from date, _to date, _except uuid DEFAULT NULL, _value uuid DEFAULT NULL)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(sum(greatest(po.total - COALESCE((SELECT sum(i.subtotal) FROM public.ap_invoices i
                                                       WHERE i.po_id = po.id AND i.approval_status = 'approved'), 0), 0)), 0)
    FROM public.purchase_orders po
   WHERE po.tenant_id = _tenant AND po.status IN ('approved', 'ordered', 'partially_received', 'received')
     AND po.order_date BETWEEN _from AND _to AND (_except IS NULL OR po.id <> _except)
     AND EXISTS (SELECT 1 FROM public.gl_accounts g WHERE g.id = public.posting_account(_tenant, 'PURCHASES') AND g.code LIKE _code || '%')
     AND (_value IS NULL OR EXISTS (SELECT 1 FROM public.purchase_order_analytics a WHERE a.document_id = po.id AND a.value_id = ANY (public.analytic_value_scope(_value))))
$function$;

-- Pré-engagé : demandes soumises ou approuvées, pas encore converties (la conversion libère la demande,
-- la commande prend le relais à son approbation).
CREATE FUNCTION public.budget_precommitted(_tenant uuid, _code text, _from date, _to date, _except uuid DEFAULT NULL, _value uuid DEFAULT NULL)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(sum(pr.estimated_total), 0)
    FROM public.purchase_requisitions pr
   WHERE pr.tenant_id = _tenant AND (public.budget_setting(_tenant)).precommit_requisitions
     AND pr.status IN ('pending_approval', 'approved') AND pr.po_id IS NULL
     AND pr.request_date BETWEEN _from AND _to AND (_except IS NULL OR pr.id <> _except)
     AND EXISTS (SELECT 1 FROM public.gl_accounts g WHERE g.id = public.posting_account(_tenant, 'PURCHASES') AND g.code LIKE _code || '%')
     AND (_value IS NULL OR EXISTS (SELECT 1 FROM public.purchase_requisition_analytics a WHERE a.document_id = pr.id AND a.value_id = ANY (public.analytic_value_scope(_value))))
$function$;

-- Réalisé : lignes comptabilisées ; avec une section, seulement les lignes imputées à elle ou à ses sous-sections.
CREATE FUNCTION public.budget_actual(_tenant uuid, _code text, _from date, _to date, _value uuid DEFAULT NULL)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(sum(l.debit - l.credit), 0) FROM public.journal_lines l JOIN public.journal_entries e ON e.id = l.entry_id
    JOIN public.gl_accounts g ON g.id = l.account_id
   WHERE e.tenant_id = _tenant AND e.status IN ('posted', 'reversed') AND e.entry_date BETWEEN _from AND _to AND g.code LIKE _code || '%'
     AND (_value IS NULL OR EXISTS (SELECT 1 FROM public.journal_line_analytics la WHERE la.line_id = l.id AND la.value_id = ANY (public.analytic_value_scope(_value))))
$function$;

-- Disponible pour une pièce : une ligne par budget qui la couvre — la ligne sans section au compte le plus
-- précis, et pour chaque section de la pièce (si le contrôle analytique est actif) la ligne de la section ou
-- d'une section parente, au compte le plus précis. La pièce doit tenir dans chacune.
CREATE FUNCTION public.budget_availability(_tenant uuid, _account uuid, _date date, _except_po uuid DEFAULT NULL, _except_pr uuid DEFAULT NULL, _values uuid[] DEFAULT '{}')
 RETURNS TABLE(budget_code text, analytic_value_id uuid, analytic_label text, period_from date, period_to date, planned numeric, precommitted numeric, committed numeric, actual numeric, available numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _s public.budget_settings := public.budget_setting(_tenant); _code text; _y text := to_char(_date, 'YYYY'); _f date; _t date; _r record;
BEGIN
  SELECT g.code INTO _code FROM public.gl_accounts g WHERE g.id = _account AND g.tenant_id = _tenant;
  IF _code IS NULL THEN RETURN; END IF;
  IF _s.control_level = 'year' THEN _f := make_date(_y::int, 1, 1); _t := make_date(_y::int, 12, 31);
  ELSE _f := date_trunc('month', _date)::date; _t := (date_trunc('month', _date) + interval '1 month - 1 day')::date; END IF;
  FOR _r IN
    SELECT DISTINCT ON (l.analytic_value_id) g.code, l.analytic_value_id, v.code || ' ' || v.name AS label
      FROM public.budget_lines l JOIN public.budgets b ON b.id = l.budget_id AND b.is_control AND b.status = 'approved' AND b.fiscal_year = _y
      JOIN public.gl_accounts g ON g.id = l.gl_account_id
      LEFT JOIN public.analytic_values v ON v.id = l.analytic_value_id
     WHERE b.tenant_id = _tenant AND _code LIKE g.code || '%' AND (_s.control_level = 'year' OR l.period = to_char(_date, 'YYYY-MM'))
       AND (l.analytic_value_id IS NULL
            OR (_s.analytic_control AND EXISTS (SELECT 1 FROM unnest(_values) x WHERE x = ANY (public.analytic_value_scope(l.analytic_value_id)))))
     ORDER BY l.analytic_value_id NULLS FIRST, length(g.code) DESC
  LOOP
    budget_code := _r.code; analytic_value_id := _r.analytic_value_id; analytic_label := _r.label; period_from := _f; period_to := _t;
    SELECT COALESCE(sum(l.planned_amount), 0) INTO planned FROM public.budget_lines l
      JOIN public.budgets b ON b.id = l.budget_id AND b.is_control AND b.status = 'approved' AND b.fiscal_year = _y
      JOIN public.gl_accounts g ON g.id = l.gl_account_id
     WHERE b.tenant_id = _tenant AND g.code = _r.code AND l.analytic_value_id IS NOT DISTINCT FROM _r.analytic_value_id
       AND (_s.control_level = 'year' OR l.period = to_char(_date, 'YYYY-MM'));
    precommitted := public.budget_precommitted(_tenant, _r.code, _f, _t, _except_pr, _r.analytic_value_id);
    committed := public.budget_committed(_tenant, _r.code, _f, _t, _except_po, _r.analytic_value_id);
    actual := public.budget_actual(_tenant, _r.code, _f, _t, _r.analytic_value_id);
    available := planned - precommitted - committed - actual;
    RETURN NEXT;
  END LOOP;
END $function$;

-- Situation du budget de contrôle d'un exercice, ligne à ligne.
CREATE FUNCTION public.budget_status(_fiscal_year text)
 RETURNS TABLE(line_id uuid, account_id uuid, account_code text, account_name text, period text, analytic_value_id uuid, analytic_code text, analytic_name text,
               planned numeric, precommitted numeric, committed numeric, actual numeric, available numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH b AS (SELECT * FROM public.budgets WHERE tenant_id = public.get_user_tenant_id(auth.uid()) AND fiscal_year = _fiscal_year AND is_control AND status = 'approved'),
  r AS (
    SELECT l.id, g.id AS gid, g.code, g.name, l.period, l.planned_amount, l.analytic_value_id, v.code AS vcode, v.name AS vname, b.tenant_id,
           CASE WHEN length(l.period) = 4 THEN make_date(l.period::int, 1, 1) ELSE to_date(l.period || '-01', 'YYYY-MM-DD') END AS f,
           CASE WHEN length(l.period) = 4 THEN make_date(l.period::int, 12, 31) ELSE (to_date(l.period || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date END AS t
      FROM b JOIN public.budget_lines l ON l.budget_id = b.id JOIN public.gl_accounts g ON g.id = l.gl_account_id
      LEFT JOIN public.analytic_values v ON v.id = l.analytic_value_id),
  c AS (
    SELECT r.*, public.budget_precommitted(r.tenant_id, r.code, r.f, r.t, NULL, r.analytic_value_id) AS pre,
           public.budget_committed(r.tenant_id, r.code, r.f, r.t, NULL, r.analytic_value_id) AS com,
           public.budget_actual(r.tenant_id, r.code, r.f, r.t, r.analytic_value_id) AS act FROM r)
  SELECT c.id, c.gid, c.code, c.name, c.period, c.analytic_value_id, c.vcode, c.vname, c.planned_amount, c.pre, c.com, c.act,
         c.planned_amount - c.pre - c.com - c.act
    FROM c ORDER BY c.code, c.vcode NULLS FIRST, c.period
$function$;

-- Réalisé mensuel de chaque ligne du budget de contrôle (écran Prévisions).
CREATE FUNCTION public.budget_monthly_actual(_fiscal_year text)
 RETURNS TABLE(line_id uuid, month int, actual numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT l.id, m.m, public.budget_actual(b.tenant_id, g.code, make_date(_fiscal_year::int, m.m, 1),
                                         (make_date(_fiscal_year::int, m.m, 1) + interval '1 month - 1 day')::date, l.analytic_value_id)
    FROM public.budgets b JOIN public.budget_lines l ON l.budget_id = b.id JOIN public.gl_accounts g ON g.id = l.gl_account_id
    CROSS JOIN generate_series(1, 12) AS m(m)
   WHERE b.tenant_id = public.get_user_tenant_id(auth.uid()) AND b.fiscal_year = _fiscal_year AND b.is_control AND b.status = 'approved'
     AND _fiscal_year ~ '^\d{4}$' AND (length(l.period) = 4 OR l.period = _fiscal_year || '-' || lpad(m.m::text, 2, '0'))
   ORDER BY 1, 2
$function$;

REVOKE EXECUTE ON FUNCTION public.budget_committed(uuid, text, date, date, uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.budget_precommitted(uuid, text, date, date, uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.budget_actual(uuid, text, date, date, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.budget_availability(uuid, uuid, date, uuid, uuid, uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.budget_status(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.budget_monthly_actual(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.budget_committed(uuid, text, date, date, uuid, uuid), public.budget_precommitted(uuid, text, date, date, uuid, uuid),
  public.budget_actual(uuid, text, date, date, uuid), public.budget_availability(uuid, uuid, date, uuid, uuid, uuid[]), public.budget_status(text),
  public.budget_monthly_actual(text), public.analytic_value_scope(uuid) TO authenticated;

-- ───────────────────────── Contrôles ─────────────────────────
CREATE OR REPLACE FUNCTION public.check_budget_on_po()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _mode text := (public.budget_setting(NEW.tenant_id)).control_mode; _a record; _acc uuid; _w text[] := '{}'; _over record;
BEGIN
  IF _mode = 'off' OR NEW.status NOT IN ('pending_approval', 'approved') OR NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  _acc := public.posting_account(NEW.tenant_id, 'PURCHASES');
  IF _acc IS NULL THEN RETURN NEW; END IF;
  FOR _a IN SELECT * FROM public.budget_availability(NEW.tenant_id, _acc, NEW.order_date, NEW.id, NULL, public.document_analytic_values('PO', NEW.id)) LOOP
    IF NEW.total > _a.available THEN
      _w := array_append(_w, format('budget %s%s : commande %s pour %s disponibles', _a.budget_code,
              COALESCE(' / ' || _a.analytic_label, ''), NEW.total, _a.available));
      IF _over IS NULL THEN _over := _a; END IF;
    END IF;
  END LOOP;
  IF cardinality(_w) = 0 THEN NEW.budget_warning := NULL; RETURN NEW; END IF;
  IF _mode = 'warn' OR NEW.budget_override_reason IS NOT NULL THEN
    NEW.budget_warning := 'Dépassement du ' || array_to_string(_w, ' ; ');
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Budget dépassé (compte %, du % au %) : commande % pour % disponibles (budget %, pré-engagé %, engagé %, réalisé %)',
    _over.budget_code || COALESCE(' / ' || _over.analytic_label, ''), _over.period_from, _over.period_to, NEW.total, _over.available,
    _over.planned, _over.precommitted, _over.committed, _over.actual
    USING ERRCODE = 'QG024', HINT = 'Réduire la commande, réviser le budget, ou faire autoriser le dépassement (droit « Autoriser un dépassement de budget »).';
END $function$;

CREATE OR REPLACE FUNCTION public.check_budget_on_pr()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _s public.budget_settings := public.budget_setting(NEW.tenant_id); _a record; _acc uuid; _w text[] := '{}'; _over record;
BEGIN
  IF _s.control_mode = 'off' OR NOT _s.control_requisitions OR NOT _s.precommit_requisitions
     OR NEW.status NOT IN ('pending_approval', 'approved') OR NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  _acc := public.posting_account(NEW.tenant_id, 'PURCHASES');
  IF _acc IS NULL THEN RETURN NEW; END IF;
  FOR _a IN SELECT * FROM public.budget_availability(NEW.tenant_id, _acc, NEW.request_date, NULL, NEW.id, public.document_analytic_values('PR', NEW.id)) LOOP
    IF NEW.estimated_total > _a.available THEN
      _w := array_append(_w, format('budget %s%s : demande %s pour %s disponibles', _a.budget_code,
              COALESCE(' / ' || _a.analytic_label, ''), NEW.estimated_total, _a.available));
      IF _over IS NULL THEN _over := _a; END IF;
    END IF;
  END LOOP;
  IF cardinality(_w) = 0 THEN NEW.budget_warning := NULL; RETURN NEW; END IF;
  IF _s.control_mode = 'warn' OR NEW.budget_override_reason IS NOT NULL THEN
    NEW.budget_warning := 'Dépassement du ' || array_to_string(_w, ' ; ');
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Budget dépassé (compte %, du % au %) : demande % pour % disponibles (budget %, pré-engagé %, engagé %, réalisé %)',
    _over.budget_code || COALESCE(' / ' || _over.analytic_label, ''), _over.period_from, _over.period_to, NEW.estimated_total, _over.available,
    _over.planned, _over.precommitted, _over.committed, _over.actual
    USING ERRCODE = 'QG024', HINT = 'Réduire la demande, réviser le budget, ou faire autoriser le dépassement (droit « Autoriser un dépassement de budget »).';
END $function$;
CREATE TRIGGER trg_check_budget_on_pr BEFORE UPDATE OF status ON public.purchase_requisitions FOR EACH ROW EXECUTE FUNCTION public.check_budget_on_pr();

CREATE OR REPLACE FUNCTION public.check_budget_on_ap_invoice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _mode text := (public.budget_setting(NEW.tenant_id)).control_mode; _r record; _a record; _v uuid[];
BEGIN
  IF _mode = 'off' OR NEW.po_id IS NOT NULL OR NEW.approval_status <> 'submitted' OR OLD.approval_status = 'submitted' THEN RETURN NEW; END IF;
  _v := public.document_analytic_values('AP', NEW.id);
  FOR _r IN
    SELECT COALESCE(l.expense_account_id, public.posting_account(NEW.tenant_id, 'PURCHASES')) AS acc, sum(l.net_amount) AS amount
      FROM public.ap_invoice_lines l WHERE l.invoice_id = NEW.id GROUP BY 1
    UNION ALL
    SELECT public.posting_account(NEW.tenant_id, 'PURCHASES'), NEW.subtotal WHERE NOT EXISTS (SELECT 1 FROM public.ap_invoice_lines WHERE invoice_id = NEW.id)
  LOOP
    CONTINUE WHEN _r.acc IS NULL;
    FOR _a IN SELECT * FROM public.budget_availability(NEW.tenant_id, _r.acc, NEW.invoice_date, NULL, NULL, _v) LOOP
      IF _r.amount > _a.available AND _mode = 'block' THEN
        RAISE EXCEPTION 'Budget dépassé (compte %, du % au %) : facture % pour % disponibles', _a.budget_code || COALESCE(' / ' || _a.analytic_label, ''),
          _a.period_from, _a.period_to, _r.amount, _a.available
          USING ERRCODE = 'QG024', HINT = 'Réviser le budget ou rattacher la facture à une commande autorisée.';
      END IF;
    END LOOP;
  END LOOP;
  RETURN NEW;
END $function$;

-- Dérogation motivée, demande ou commande (avant approbation).
CREATE OR REPLACE FUNCTION public.budget_override_document(_doc_type text, _id uuid, _reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF NOT public.has_permission(auth.uid(), 'budget.override') THEN RAISE EXCEPTION 'Droit insuffisant : autoriser un dépassement de budget' USING ERRCODE = '42501'; END IF;
  IF COALESCE(btrim(_reason), '') = '' THEN RAISE EXCEPTION 'Motif obligatoire' USING ERRCODE = 'QG024'; END IF;
  IF _doc_type = 'PO' THEN
    UPDATE public.purchase_orders SET budget_override_reason = btrim(_reason), budget_override_by = auth.uid(), budget_override_at = now()
     WHERE id = _id AND tenant_id = _tenant AND status IN ('draft', 'rejected', 'pending_approval');
  ELSIF _doc_type = 'PR' THEN
    UPDATE public.purchase_requisitions SET budget_override_reason = btrim(_reason), budget_override_by = auth.uid(), budget_override_at = now()
     WHERE id = _id AND tenant_id = _tenant AND status IN ('draft', 'rejected', 'pending_approval');
  ELSE
    RAISE EXCEPTION 'Type de pièce inconnu : %', _doc_type USING ERRCODE = '22023';
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pièce introuvable ou déjà approuvée' USING ERRCODE = 'QG024'; END IF;
END $function$;
REVOKE EXECUTE ON FUNCTION public.budget_override_document(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.budget_override_document(text, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.budget_override_po(_po uuid, _reason text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ SELECT public.budget_override_document('PO', _po, _reason) $function$;

-- ───────────────────────── Comptabilisation : sections des pièces sur les lignes de charges ─────────────────────────
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
          _acc := _acc || _grni; _amt := _amt || _clear; _lbl := _lbl || 'DR Factures non parvenues'::text;
        END IF;
      END IF;
      IF _l.net_amount - _clear <> 0 THEN
        _acc := _acc || COALESCE(_l.expense_account_id, _purchases); _amt := _amt || (_l.net_amount - _clear);
        _lbl := _lbl || CASE WHEN _clear > 0 THEN 'Écart de prix / quantité' ELSE 'DR Achats HT' END;
      END IF;
    END LOOP;
    FOR _l IN SELECT COALESCE(t.gl_account_id, _vat) AS acc, sum(l.tax_amount) AS tax FROM public.ap_invoice_lines l
                LEFT JOIN public.tax_codes t ON t.id = l.tax_code_id WHERE l.invoice_id = _inv.id AND l.tax_amount <> 0 GROUP BY 1 LOOP
      _acc := _acc || _l.acc; _amt := _amt || _l.tax; _lbl := _lbl || 'DR TVA déductible'::text;
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
    IF _clear > 0 THEN _acc := _acc || _grni; _amt := _amt || _clear; _lbl := _lbl || 'DR Factures non parvenues'::text; END IF;
    IF _net - _clear <> 0 THEN _acc := _acc || _purchases; _amt := _amt || (_net - _clear); _lbl := _lbl || 'DR Achats HT'::text; END IF;
    IF _tax <> 0 THEN _acc := _acc || _vat; _amt := _amt || _tax; _lbl := _lbl || 'DR TVA déductible'::text; END IF;
  END IF;

  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES (_inv.tenant_id, 'JE-AP-' || to_char(now(), 'YYYYMMDD') || '-' || substr(_inv.id::text, 1, 8),
          _inv.invoice_date, 'Facture fournisseur ' || _inv.invoice_number, 'ap_invoice', 'draft', _inv.created_by)
  RETURNING id INTO _entry_id;
  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  SELECT _entry_id, x.a, greatest(sum(x.m), 0), greatest(-sum(x.m), 0), min(x.l)
    FROM unnest(_acc, _amt, _lbl) AS x(a, m, l) GROUP BY x.a HAVING sum(x.m) <> 0;
  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  VALUES (_entry_id, _payable, 0, _total, 'CR Fournisseurs');
  UPDATE public.grni_ledger SET journal_entry_id = _entry_id WHERE source = 'invoice' AND source_id = _inv.id AND journal_entry_id IS NULL;
  PERFORM public.impute_entry_analytics(_entry_id, public.document_analytic_values('AP', _inv.id));
  UPDATE public.journal_entries SET status = 'posted', posted_by = _inv.created_by, posted_at = now() WHERE id = _entry_id;
  PERFORM set_config('qerp.ap_posting', 'off', true);
  RETURN _entry_id;
END $function$;

CREATE OR REPLACE FUNCTION public.on_gr_grni()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _total numeric; _entry uuid;
BEGIN
  IF TG_OP <> 'UPDATE' OR NEW.status <> 'completed' OR OLD.status = 'completed' THEN RETURN NULL; END IF;
  IF NOT COALESCE((public.procurement_setting(NEW.tenant_id)).grni_on_receipt, false) THEN RETURN NULL; END IF;
  SELECT round(sum(gl.quantity_received * COALESCE(pl.unit_cost, 0)), 2) INTO _total
    FROM public.gr_lines gl JOIN public.po_lines pl ON pl.id = gl.po_line_id WHERE gl.gr_id = NEW.id AND gl.quantity_received > 0;
  IF COALESCE(_total, 0) <= 0 THEN RETURN NULL; END IF;
  _entry := public.post_two_line_entry_as(NEW.tenant_id, COALESCE(NEW.receipt_date, CURRENT_DATE), 'goods_receipt',
    'Réception ' || NEW.gr_number || ' — factures non parvenues',
    public.require_posting_account(NEW.tenant_id, 'PURCHASES'), public.require_posting_account(NEW.tenant_id, 'GRNI'), _total, NEW.received_by,
    public.document_analytic_values('PO', NEW.po_id));
  INSERT INTO public.grni_ledger (tenant_id, po_line_id, source, source_id, amount, journal_entry_id)
  SELECT NEW.tenant_id, gl.po_line_id, 'receipt', NEW.id, round(sum(gl.quantity_received * COALESCE(pl.unit_cost, 0)), 2), _entry
    FROM public.gr_lines gl JOIN public.po_lines pl ON pl.id = gl.po_line_id
   WHERE gl.gr_id = NEW.id AND gl.quantity_received > 0 GROUP BY gl.po_line_id;
  RETURN NULL;
END $function$;

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
    public.document_analytic_values('PO', _r.po_id));
  INSERT INTO public.grni_ledger (tenant_id, po_line_id, source, source_id, amount, journal_entry_id)
  VALUES (_r.tenant_id, NEW.po_line_id, 'return', _r.id, -_amt, _entry);
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.create_ap_credit_note(_invoice_id uuid, _reason text, _credit_date date, _subtotal numeric, _tax_amount numeric, _supplier_reference text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _inv public.ap_invoices%ROWTYPE;
  _date date := COALESCE(_credit_date, CURRENT_DATE);
  _sub numeric := ROUND(COALESCE(_subtotal, 0), 2);
  _tax numeric := ROUND(COALESCE(_tax_amount, 0), 2);
  _total numeric;
  _done_sub numeric; _done_tax numeric;
  _payable uuid; _purchases uuid; _vat uuid;
  _id uuid := gen_random_uuid();
  _number text; _entry uuid; _alloc numeric;
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Aucune société active' USING ERRCODE = '42501'; END IF;
  IF NOT public.has_permission(auth.uid(), 'ap.credit_note') THEN
    RAISE EXCEPTION 'Droit insuffisant : %', (SELECT label FROM public.erp_permission_catalog WHERE code = 'ap.credit_note')
      USING ERRCODE = '42501';
  END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'Motif de l''avoir obligatoire' USING ERRCODE = 'QG014';
  END IF;
  SELECT * INTO _inv FROM public.ap_invoices WHERE id = _invoice_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Facture fournisseur introuvable dans la société active' USING ERRCODE = 'QG014'; END IF;
  IF _inv.approval_status <> 'approved' OR _inv.status NOT IN ('open', 'partially_paid', 'overdue', 'paid') THEN
    RAISE EXCEPTION 'Seule une facture fournisseur approuvée se crédite (facture %)', _inv.invoice_number
      USING ERRCODE = 'QG014';
  END IF;
  IF _sub < 0 OR _tax < 0 OR _sub + _tax <= 0 THEN
    RAISE EXCEPTION 'Montants de l''avoir invalides (HT %, TVA %)', _sub, _tax USING ERRCODE = 'QG014';
  END IF;
  SELECT COALESCE(sum(subtotal), 0), COALESCE(sum(tax_amount), 0) INTO _done_sub, _done_tax
    FROM public.ap_credit_notes WHERE invoice_id = _invoice_id;
  IF _done_sub + _sub > _inv.subtotal THEN
    RAISE EXCEPTION 'HT des avoirs (%) supérieur au HT de la facture % (%)', _done_sub + _sub, _inv.invoice_number, _inv.subtotal
      USING ERRCODE = 'QG014';
  END IF;
  IF _done_tax + _tax > _inv.tax_amount THEN
    RAISE EXCEPTION 'TVA des avoirs (%) supérieure à la TVA de la facture % (%)', _done_tax + _tax, _inv.invoice_number, _inv.tax_amount
      USING ERRCODE = 'QG014';
  END IF;
  PERFORM public.assert_fiscal_period_open(_tenant, _date, 'AP');
  _total := _sub + _tax;

  _payable := public.require_posting_account(_tenant, 'AP_PAYABLE');
  IF _sub > 0 THEN _purchases := public.require_posting_account(_tenant, 'PURCHASES'); END IF;
  IF _tax > 0 THEN _vat := public.require_posting_account(_tenant, 'VAT_INPUT'); END IF;

  INSERT INTO public.ar_numbering_series (tenant_id, doc_type, prefix, format, next_number, reset_frequency)
  SELECT _tenant, 'ap_credit_note', 'AVF-', 'AVF-YYYY-####', 1, 'yearly'
   WHERE NOT EXISTS (SELECT 1 FROM public.ar_numbering_series WHERE tenant_id = _tenant AND doc_type = 'ap_credit_note');
  _number := public.next_document_number(_tenant, 'ap_credit_note', _date);

  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES (_tenant, 'JE-AVF-' || to_char(now(), 'YYYYMMDD') || '-' || substr(_id::text, 1, 8), _date,
          'Avoir fournisseur ' || _number || ' sur facture ' || _inv.invoice_number || ' — ' || btrim(_reason),
          'ap_credit_note', 'draft', auth.uid())
  RETURNING id INTO _entry;
  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  VALUES (_entry, _payable, _total, 0, 'DR Fournisseurs (avoir)');
  IF _sub > 0 THEN
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry, _purchases, 0, _sub, 'CR Achats (avoir)');
  END IF;
  IF _tax > 0 THEN
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry, _vat, 0, _tax, 'CR TVA récupérable (avoir)');
  END IF;
  PERFORM public.impute_entry_analytics(_entry, public.document_analytic_values('AP', _invoice_id));
  UPDATE public.journal_entries SET status = 'posted', posted_by = auth.uid(), posted_at = now() WHERE id = _entry;

  _alloc := LEAST(_total, GREATEST(_inv.total - _inv.amount_paid, 0));
  INSERT INTO public.ap_credit_notes (id, tenant_id, credit_note_number, invoice_id, supplier_id, supplier_reference, credit_date,
                                      reason, subtotal, tax_amount, total, amount_allocated, journal_entry_id, created_by)
  VALUES (_id, _tenant, _number, _invoice_id, _inv.supplier_id, NULLIF(btrim(COALESCE(_supplier_reference, '')), ''), _date,
          btrim(_reason), _sub, _tax, _total, _alloc, _entry, auth.uid());
  IF _alloc > 0 THEN
    INSERT INTO public.payments (tenant_id, payment_type, ap_invoice_id, amount, payment_date, payment_method,
                                 reference, journal_entry_id, created_by, source_ap_credit_note_id)
    VALUES (_tenant, 'ap_credit', _invoice_id, _alloc, _date, 'credit_note', _number, _entry, auth.uid(), _id);
  END IF;
  RETURN _id;
END; $function$;

SELECT public.install_tenant_isolation_triggers();
