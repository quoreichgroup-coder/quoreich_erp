
-- ── Permission helper ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.has_procurement_perm(_user_id uuid, _action text, _level int DEFAULT NULL)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    public.has_role(_user_id, 'admin'::public.app_role)
    OR CASE _action
      WHEN 'approve_l1' THEN public.has_role(_user_id, 'procurement_l1'::public.app_role)
                          OR public.has_role(_user_id, 'procurement_l2'::public.app_role)
                          OR public.has_role(_user_id, 'procurement_l3'::public.app_role)
      WHEN 'approve_l2' THEN public.has_role(_user_id, 'procurement_l2'::public.app_role)
                          OR public.has_role(_user_id, 'procurement_l3'::public.app_role)
      WHEN 'approve_l3' THEN public.has_role(_user_id, 'procurement_l3'::public.app_role)
      WHEN 'convert'    THEN public.has_role(_user_id, 'procurement_controller'::public.app_role)
                          OR public.has_role(_user_id, 'procurement_l2'::public.app_role)
                          OR public.has_role(_user_id, 'procurement_l3'::public.app_role)
      WHEN '3wm'        THEN public.has_role(_user_id, 'procurement_3wm_approver'::public.app_role)
                          OR public.has_role(_user_id, 'procurement_controller'::public.app_role)
      ELSE false
    END
$$;

-- ── Guard: approve_procurement_step ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.approve_procurement_step(_approval_id uuid, _comment text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _a public.procurement_approvals%ROWTYPE;
  _remaining int;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _docnum text;
  _perm text;
BEGIN
  SELECT * INTO _a FROM public.procurement_approvals WHERE id = _approval_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Approval not found'; END IF;
  IF _a.tenant_id <> _tenant THEN RAISE EXCEPTION 'Tenant mismatch'; END IF;
  IF _a.status <> 'pending' THEN RAISE EXCEPTION 'Already decided'; END IF;

  _perm := 'approve_l' || _a.level_order::text;
  IF _a.level_order > 3 THEN _perm := 'approve_l3'; END IF;
  IF NOT public.has_procurement_perm(auth.uid(), _perm) THEN
    RAISE EXCEPTION 'Permission denied: requires role for %', _a.level_label;
  END IF;

  UPDATE public.procurement_approvals
     SET status='approved', decided_by=auth.uid(), decided_at=now(), comment=_comment
   WHERE id=_approval_id;

  SELECT count(*) INTO _remaining
    FROM public.procurement_approvals
   WHERE doc_type=_a.doc_type AND doc_id=_a.doc_id AND status='pending';

  IF _remaining = 0 THEN
    IF _a.doc_type='PR' THEN
      UPDATE public.purchase_requisitions
         SET status='approved', approved_by=auth.uid(), approved_at=now()
       WHERE id=_a.doc_id RETURNING pr_number INTO _docnum;
    ELSE
      UPDATE public.purchase_orders
         SET status='approved', approved_by=auth.uid()
       WHERE id=_a.doc_id RETURNING po_number INTO _docnum;
    END IF;
    PERFORM public.notify_procurement(_a.tenant_id, 'success',
      _a.doc_type || ' approuvée', 'Document ' || COALESCE(_docnum,'') || ' entièrement approuvé.',
      _a.doc_id::text);
  ELSE
    PERFORM public.notify_procurement(_a.tenant_id, 'info',
      _a.level_label || ' approuvé', 'Étape franchie pour ' || _a.doc_type, _a.doc_id::text);
  END IF;
END; $function$;

-- ── Guard: reject_procurement_step ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reject_procurement_step(_approval_id uuid, _comment text)
 RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _a public.procurement_approvals%ROWTYPE;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _perm text;
BEGIN
  SELECT * INTO _a FROM public.procurement_approvals WHERE id = _approval_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Approval not found'; END IF;
  IF _a.tenant_id <> _tenant THEN RAISE EXCEPTION 'Tenant mismatch'; END IF;
  IF _a.status <> 'pending' THEN RAISE EXCEPTION 'Already decided'; END IF;
  IF _comment IS NULL OR length(trim(_comment))=0 THEN RAISE EXCEPTION 'Comment required for rejection'; END IF;

  _perm := 'approve_l' || _a.level_order::text;
  IF _a.level_order > 3 THEN _perm := 'approve_l3'; END IF;
  IF NOT public.has_procurement_perm(auth.uid(), _perm) THEN
    RAISE EXCEPTION 'Permission denied: requires role for %', _a.level_label;
  END IF;

  UPDATE public.procurement_approvals
     SET status='rejected', decided_by=auth.uid(), decided_at=now(), comment=_comment
   WHERE id=_approval_id;

  UPDATE public.procurement_approvals
     SET status='skipped', decided_at=now()
   WHERE doc_type=_a.doc_type AND doc_id=_a.doc_id AND status='pending';

  IF _a.doc_type='PR' THEN
    UPDATE public.purchase_requisitions SET status='rejected' WHERE id=_a.doc_id;
  ELSE
    UPDATE public.purchase_orders SET status='rejected' WHERE id=_a.doc_id;
  END IF;

  PERFORM public.notify_procurement(_a.tenant_id, 'critical',
    _a.doc_type || ' rejetée', 'Motif: ' || _comment, _a.doc_id::text);
END; $function$;

-- ── Guard: convert_pr_to_po ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.convert_pr_to_po(_pr_id uuid, _supplier_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _pr public.purchase_requisitions%ROWTYPE;
  _po_id uuid;
  _po_number text;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF NOT public.has_procurement_perm(auth.uid(), 'convert') THEN
    RAISE EXCEPTION 'Permission denied: PR→PO conversion requires Controller or L2+ role';
  END IF;

  SELECT * INTO _pr FROM public.purchase_requisitions WHERE id=_pr_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PR not found'; END IF;
  IF _pr.tenant_id <> _tenant THEN RAISE EXCEPTION 'Tenant mismatch'; END IF;
  IF _pr.status NOT IN ('approved') THEN RAISE EXCEPTION 'PR must be approved (status=%)', _pr.status; END IF;
  IF _pr.po_id IS NOT NULL THEN RAISE EXCEPTION 'PR already converted to PO'; END IF;

  _po_number := 'PO-' || to_char(now(),'YYYY') || '-' || lpad((floor(random()*9999))::text, 4, '0');

  INSERT INTO public.purchase_orders (tenant_id, po_number, supplier_id, order_date, total, status, created_by)
  VALUES (_pr.tenant_id, _po_number, _supplier_id, CURRENT_DATE, COALESCE(_pr.estimated_total,0), 'draft', auth.uid())
  RETURNING id INTO _po_id;

  INSERT INTO public.po_lines (po_id, item_id, description, quantity, unit_cost, total)
  SELECT _po_id, rl.item_id, rl.description, rl.quantity, rl.estimated_unit_cost, rl.total
    FROM public.requisition_lines rl WHERE rl.requisition_id = _pr_id;

  UPDATE public.purchase_requisitions SET po_id=_po_id, status='converted' WHERE id=_pr_id;

  PERFORM public.notify_procurement(_pr.tenant_id, 'info',
    'PR → PO converti', _pr.pr_number || ' → ' || _po_number, _po_id::text);
  RETURN _po_id;
END; $function$;

-- ── Guard: record_match_decision ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_match_decision(_po_id uuid, _decision text, _reason text)
 RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _id uuid;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _po_tenant uuid;
  _po_number text;
BEGIN
  IF NOT public.has_procurement_perm(auth.uid(), '3wm') THEN
    RAISE EXCEPTION 'Permission denied: 3WM decisions require Controller or 3WM Approver role';
  END IF;
  IF _decision NOT IN ('accepted','revision_requested') THEN RAISE EXCEPTION 'Invalid decision'; END IF;
  IF _reason IS NULL OR length(trim(_reason))=0 THEN RAISE EXCEPTION 'Reason required'; END IF;

  SELECT tenant_id, po_number INTO _po_tenant, _po_number FROM public.purchase_orders WHERE id=_po_id;
  IF _po_tenant IS NULL THEN RAISE EXCEPTION 'PO not found'; END IF;
  IF _po_tenant <> _tenant THEN RAISE EXCEPTION 'Tenant mismatch'; END IF;

  INSERT INTO public.procurement_match_decisions (tenant_id, po_id, decision, reason, decided_by)
  VALUES (_tenant, _po_id, _decision, _reason, auth.uid())
  RETURNING id INTO _id;

  PERFORM public.notify_procurement(_tenant,
    CASE WHEN _decision='accepted' THEN 'success' ELSE 'warning' END,
    '3WM ' || _decision || ' — ' || _po_number, _reason, _po_id::text);
  RETURN _id;
END; $function$;

-- ── Audit view (approvals + 3WM decisions + PR→PO conversions) ───────────
CREATE OR REPLACE VIEW public.procurement_audit_view
WITH (security_invoker = true)
AS
  -- Approval steps
  SELECT
    a.id,
    a.tenant_id,
    COALESCE(a.decided_at, a.created_at) AS event_at,
    CASE a.status
      WHEN 'pending'  THEN 'approval_assigned'
      WHEN 'approved' THEN 'approval_approved'
      WHEN 'rejected' THEN 'approval_rejected'
      WHEN 'skipped'  THEN 'approval_skipped'
    END AS event_type,
    a.doc_type,
    a.doc_id,
    CASE WHEN a.doc_type='PR' THEN pr.pr_number ELSE po.po_number END AS doc_number,
    a.level_label,
    a.amount,
    COALESCE(a.decided_by::text, '') AS actor_id,
    COALESCE(p.full_name, a.approver_role) AS actor_name,
    a.comment AS comment
  FROM public.procurement_approvals a
  LEFT JOIN public.purchase_requisitions pr ON pr.id = a.doc_id AND a.doc_type='PR'
  LEFT JOIN public.purchase_orders po       ON po.id = a.doc_id AND a.doc_type='PO'
  LEFT JOIN public.profiles p               ON p.id = a.decided_by

  UNION ALL
  -- 3WM decisions
  SELECT
    d.id,
    d.tenant_id,
    d.created_at AS event_at,
    'match_' || d.decision AS event_type,
    'PO'::text AS doc_type,
    d.po_id AS doc_id,
    po.po_number AS doc_number,
    '3-Way Match'::text AS level_label,
    po.total AS amount,
    COALESCE(d.decided_by::text, '') AS actor_id,
    COALESCE(p.full_name, '—') AS actor_name,
    d.reason AS comment
  FROM public.procurement_match_decisions d
  JOIN public.purchase_orders po ON po.id = d.po_id
  LEFT JOIN public.profiles p ON p.id = d.decided_by

  UNION ALL
  -- PR → PO conversions
  SELECT
    pr.id,
    pr.tenant_id,
    COALESCE(pr.approved_at, pr.created_at) AS event_at,
    'pr_converted_to_po' AS event_type,
    'PR'::text AS doc_type,
    pr.id AS doc_id,
    pr.pr_number || ' → ' || COALESCE(po.po_number,'?') AS doc_number,
    'Conversion'::text AS level_label,
    COALESCE(pr.estimated_total, 0) AS amount,
    COALESCE(pr.approved_by::text, '') AS actor_id,
    COALESCE(p.full_name, '—') AS actor_name,
    NULL::text AS comment
  FROM public.purchase_requisitions pr
  LEFT JOIN public.purchase_orders po ON po.id = pr.po_id
  LEFT JOIN public.profiles p ON p.id = pr.approved_by
  WHERE pr.po_id IS NOT NULL;

GRANT SELECT ON public.procurement_audit_view TO authenticated;
