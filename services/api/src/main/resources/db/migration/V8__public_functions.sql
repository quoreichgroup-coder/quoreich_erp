--
-- PostgreSQL database dump
--


-- Dumped from database version 18.6
-- Dumped by pg_dump version 18.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: apply_stock_movement(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_stock_movement() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _settings public.inventory_settings%ROWTYPE;
  _item public.items%ROWTYPE;
  _qty numeric := COALESCE(NEW.quantity, 0);
  _abs numeric := ABS(_qty);
  _is_in boolean := _qty > 0;
  _new_qty numeric;
  _new_avg numeric;
  _wh uuid := NEW.warehouse_id;
  _remaining numeric;
  _layer record;
BEGIN
  IF NEW.status <> 'posted' THEN RETURN NEW; END IF;
  IF _qty = 0 THEN RETURN NEW; END IF;

  SELECT * INTO _settings FROM public.inventory_settings WHERE tenant_id = NEW.tenant_id;
  SELECT * INTO _item FROM public.items WHERE id = NEW.item_id;
  IF _item.id IS NULL THEN RETURN NEW; END IF;

  IF NOT _is_in AND NOT COALESCE(_settings.negative_stock_allowed, false) THEN
    IF COALESCE(_item.quantity_on_hand,0) < _abs THEN
      RAISE EXCEPTION 'Stock insuffisant pour % (dispo=%, demandé=%)', _item.code, _item.quantity_on_hand, _abs;
    END IF;
  END IF;

  IF _is_in AND COALESCE(NEW.unit_cost,0) > 0 THEN
    _new_qty := COALESCE(_item.quantity_on_hand,0) + _abs;
    IF _new_qty > 0 THEN
      _new_avg := ((COALESCE(_item.quantity_on_hand,0) * COALESCE(_item.average_cost,0))
                   + (_abs * NEW.unit_cost)) / _new_qty;
      UPDATE public.items SET average_cost = ROUND(_new_avg::numeric, 4) WHERE id = NEW.item_id;
    END IF;
    INSERT INTO public.stock_valuation_layers(tenant_id, item_id, warehouse_id, layer_date, qty_in, cost_in, qty_remaining, source_type, source_id)
    VALUES (NEW.tenant_id, NEW.item_id, _wh, COALESCE(NEW.movement_date, CURRENT_DATE),
            _abs, NEW.unit_cost, _abs, NEW.reference_type, NEW.reference_id);
  ELSIF NOT _is_in THEN
    _remaining := _abs;
    FOR _layer IN SELECT * FROM public.stock_valuation_layers
                   WHERE item_id = NEW.item_id AND qty_remaining > 0
                     AND (_wh IS NULL OR warehouse_id IS NOT DISTINCT FROM _wh)
                   ORDER BY layer_date, created_at
    LOOP
      EXIT WHEN _remaining <= 0;
      IF _layer.qty_remaining >= _remaining THEN
        UPDATE public.stock_valuation_layers SET qty_remaining = qty_remaining - _remaining WHERE id = _layer.id;
        _remaining := 0;
      ELSE
        _remaining := _remaining - _layer.qty_remaining;
        UPDATE public.stock_valuation_layers SET qty_remaining = 0 WHERE id = _layer.id;
      END IF;
    END LOOP;
  END IF;

  UPDATE public.items SET quantity_on_hand = COALESCE(quantity_on_hand,0) + _qty WHERE id = NEW.item_id;

  IF _wh IS NOT NULL THEN
    INSERT INTO public.item_locations(tenant_id, item_id, warehouse_id, quantity_on_hand)
    VALUES (NEW.tenant_id, NEW.item_id, _wh, _qty)
    ON CONFLICT (item_id, warehouse_id)
    DO UPDATE SET quantity_on_hand = public.item_locations.quantity_on_hand + EXCLUDED.quantity_on_hand,
                  updated_at = now();
  END IF;

  IF COALESCE(_settings.low_stock_alerts_enabled, true) THEN
    PERFORM 1 FROM public.items WHERE id = NEW.item_id
      AND quantity_on_hand <= COALESCE(NULLIF(safety_stock,0), reorder_level, 0)
      AND COALESCE(NULLIF(safety_stock,0), reorder_level, 0) > 0;
    IF FOUND THEN
      PERFORM public.notify_inventory(NEW.tenant_id, 'warning',
        'Stock bas — ' || _item.code,
        'Article ' || _item.name || ' sous le seuil de réapprovisionnement.',
        NEW.item_id::text);
    END IF;
  END IF;
  RETURN NEW;
END $$;


--
-- Name: approve_payroll_run(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.approve_payroll_run(_run_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE _r public.payroll_runs%ROWTYPE;
        _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF NOT public.has_hr_perm(auth.uid(), 'approve_payroll_run') THEN
    RAISE EXCEPTION 'Permission refusée: rôle Approbateur Paie requis';
  END IF;
  SELECT * INTO _r FROM public.payroll_runs WHERE id = _run_id;
  IF _r.tenant_id IS NULL OR _r.tenant_id <> _tenant THEN RAISE EXCEPTION 'Cycle introuvable'; END IF;
  IF _r.status <> 'draft' THEN RAISE EXCEPTION 'Seuls les cycles draft peuvent être approuvés'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.payroll_lines WHERE run_id = _run_id) THEN
    RAISE EXCEPTION 'Aucune ligne de paie — générez-les d''abord';
  END IF;
  UPDATE public.payroll_runs SET status='approved', approved_by=auth.uid(), approved_at=now()
    WHERE id=_run_id;
END $$;


--
-- Name: approve_procurement_step(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.approve_procurement_step(_approval_id uuid, _comment text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
END; $$;


--
-- Name: assign_budget_role(uuid, public.app_role, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assign_budget_role(p_target_user uuid, p_role public.app_role, p_action text, p_comment text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _target_tenant uuid;
  _has_planner boolean;
  _has_approver boolean;
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'No tenant'; END IF;
  IF NOT (public.has_role(auth.uid(),'admin'::public.app_role)
       OR public.has_role(auth.uid(),'budget_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Seuls les administrateurs peuvent assigner les rôles Budget';
  END IF;
  IF p_action NOT IN ('assign','revoke') THEN
    RAISE EXCEPTION 'Action invalide: %', p_action;
  END IF;
  IF p_role::text NOT IN ('budget_planner','budget_approver','budget_controller','budget_admin') THEN
    RAISE EXCEPTION 'Rôle % n''est pas un rôle Budget', p_role;
  END IF;

  SELECT tenant_id INTO _target_tenant FROM public.profiles WHERE id = p_target_user;
  IF _target_tenant IS NULL OR _target_tenant <> _tenant THEN
    RAISE EXCEPTION 'Utilisateur cible non rattaché à votre tenant';
  END IF;

  IF p_action = 'assign' THEN
    -- SoD: planner XOR approver
    SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_target_user AND role = 'budget_planner'::public.app_role AND tenant_id = _tenant)
      INTO _has_planner;
    SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_target_user AND role = 'budget_approver'::public.app_role AND tenant_id = _tenant)
      INTO _has_approver;

    IF p_role = 'budget_approver'::public.app_role AND _has_planner THEN
      RAISE EXCEPTION 'SoD: l''utilisateur est déjà Planificateur — incompatible avec Approbateur';
    END IF;
    IF p_role = 'budget_planner'::public.app_role AND _has_approver THEN
      RAISE EXCEPTION 'SoD: l''utilisateur est déjà Approbateur — incompatible avec Planificateur';
    END IF;

    INSERT INTO public.user_roles (user_id, role, tenant_id)
    VALUES (p_target_user, p_role, _tenant)
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    DELETE FROM public.user_roles
      WHERE user_id = p_target_user AND role = p_role AND tenant_id = _tenant;
  END IF;

  INSERT INTO public.budget_role_audit (tenant_id, actor_user_id, target_user_id, role, action, details)
  VALUES (_tenant, auth.uid(), p_target_user, p_role, p_action,
          jsonb_build_object('comment', COALESCE(p_comment,'')));
END;
$$;


--
-- Name: assign_compliance_role(uuid, public.app_role, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assign_compliance_role(_target_user uuid, _role public.app_role, _action text, _reason text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE _tenant uuid; _actor uuid := auth.uid(); _conflict public.app_role;
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT (public.has_role(_actor,'admin') OR public.has_role(_actor,'compliance_admin')) THEN
    RAISE EXCEPTION 'forbidden: compliance_admin required';
  END IF;
  IF _role NOT IN ('compliance_officer','compliance_auditor','compliance_admin') THEN
    RAISE EXCEPTION 'invalid compliance role: %', _role;
  END IF;
  IF _action NOT IN ('grant','revoke') THEN RAISE EXCEPTION 'invalid action'; END IF;

  SELECT tenant_id INTO _tenant FROM public.profiles WHERE id = _target_user;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'target user not found'; END IF;

  IF _action = 'grant' THEN
    _conflict := CASE _role
      WHEN 'compliance_officer' THEN 'compliance_auditor'::public.app_role
      WHEN 'compliance_auditor' THEN 'compliance_officer'::public.app_role
      ELSE NULL END;
    IF _conflict IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = _target_user AND role = _conflict
    ) THEN
      RAISE EXCEPTION 'SoD violation: user already has conflicting role %', _conflict;
    END IF;
    INSERT INTO public.user_roles(user_id, role) VALUES (_target_user, _role)
      ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.user_roles WHERE user_id = _target_user AND role = _role;
  END IF;

  INSERT INTO public.compliance_role_audit(tenant_id, actor_user_id, target_user_id, role, action, reason)
  VALUES (_tenant, _actor, _target_user, _role, _action, _reason);
END $$;


--
-- Name: assign_crm_role(uuid, public.app_role, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assign_crm_role(p_target_user uuid, p_role public.app_role, p_action text, p_reason text DEFAULT NULL::text, p_tenant uuid DEFAULT NULL::uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _tenant UUID; _has_agent BOOLEAN; _has_manager BOOLEAN;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin'::public.app_role)
       OR public.has_role(auth.uid(),'crm_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'CRM_FORBIDDEN';
  END IF;
  IF p_role NOT IN ('crm_agent','crm_manager','crm_admin','crm_auditor') THEN
    RAISE EXCEPTION 'CRM_INVALID_ROLE: %', p_role;
  END IF;
  _tenant := COALESCE(p_tenant, public.get_user_tenant_id(auth.uid()));
  IF _tenant IS NULL THEN RAISE EXCEPTION 'CRM_TENANT_REQUIRED'; END IF;

  IF p_action = 'grant' THEN
    SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=p_target_user AND role='crm_agent'::public.app_role AND tenant_id=_tenant) INTO _has_agent;
    SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=p_target_user AND role='crm_manager'::public.app_role AND tenant_id=_tenant) INTO _has_manager;
    IF p_role='crm_manager'::public.app_role AND _has_agent THEN RAISE EXCEPTION 'CRM_SOD_CONFLICT'; END IF;
    IF p_role='crm_agent'::public.app_role AND _has_manager THEN RAISE EXCEPTION 'CRM_SOD_CONFLICT'; END IF;
    INSERT INTO public.user_roles(user_id, role, tenant_id) VALUES (p_target_user, p_role, _tenant) ON CONFLICT DO NOTHING;
  ELSIF p_action = 'revoke' THEN
    DELETE FROM public.user_roles WHERE user_id=p_target_user AND role=p_role AND tenant_id=_tenant;
  ELSE RAISE EXCEPTION 'CRM_INVALID_ACTION: %', p_action; END IF;

  INSERT INTO public.crm_role_audit(tenant_id, target_user_id, role, action, performed_by, reason)
  VALUES (_tenant, p_target_user, p_role, p_action, auth.uid(), p_reason);
END; $$;


--
-- Name: assign_expense_role(uuid, public.app_role, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assign_expense_role(_target_user uuid, _role public.app_role, _action text, _reason text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _actor uuid := auth.uid();
  _tenant uuid;
  _conflict public.app_role;
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF _action NOT IN ('grant','revoke') THEN RAISE EXCEPTION 'invalid_action'; END IF;
  IF _role NOT IN ('expense_clerk','expense_approver','expense_controller','expense_admin') THEN
    RAISE EXCEPTION 'invalid_role';
  END IF;

  SELECT tenant_id INTO _tenant
  FROM public.user_role_assignments
  WHERE user_id = _actor AND role = 'expense_admin'
  LIMIT 1;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'forbidden: expense_admin required'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_role_assignments
    WHERE user_id = _target_user AND tenant_id = _tenant
  ) THEN
    RAISE EXCEPTION 'target_user_not_in_tenant';
  END IF;

  IF _action = 'grant' THEN
    -- SoD: clerk ⊕ approver mutually exclusive
    IF _role = 'expense_clerk' THEN _conflict := 'expense_approver';
    ELSIF _role = 'expense_approver' THEN _conflict := 'expense_clerk';
    ELSE _conflict := NULL; END IF;

    IF _conflict IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = _target_user AND role = _conflict
    ) THEN
      RAISE EXCEPTION 'sod_violation: % conflicts with %', _role, _conflict;
    END IF;

    INSERT INTO public.user_roles (user_id, role)
    VALUES (_target_user, _role)
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    DELETE FROM public.user_roles
    WHERE user_id = _target_user AND role = _role;
  END IF;

  INSERT INTO public.expense_role_audit (tenant_id, actor_user_id, target_user_id, action, role, reason)
  VALUES (_tenant, _actor, _target_user, _action, _role, _reason);

  RETURN jsonb_build_object('ok', true, 'action', _action, 'role', _role);
END;
$$;


--
-- Name: assign_fixed_asset_role(uuid, public.app_role, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assign_fixed_asset_role(p_target_user uuid, p_role public.app_role, p_action text, p_comment text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'no_tenant'; END IF;
  IF NOT (public.has_role(auth.uid(), 'asset_admin') OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;
  IF p_role::text NOT IN ('asset_clerk','asset_accountant','asset_controller','asset_admin') THEN
    RAISE EXCEPTION 'invalid_role';
  END IF;
  IF p_action = 'assign' THEN
    INSERT INTO public.user_roles(user_id, role) VALUES (p_target_user, p_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSIF p_action = 'revoke' THEN
    DELETE FROM public.user_roles WHERE user_id = p_target_user AND role = p_role;
  ELSE
    RAISE EXCEPTION 'invalid_action';
  END IF;
  INSERT INTO public.fixed_asset_role_audit(tenant_id, actor_user_id, target_user_id, role, action, details)
  VALUES (v_tenant, auth.uid(), p_target_user, p_role::text, p_action,
          CASE WHEN p_comment IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('comment', p_comment) END);
END $$;


--
-- Name: assign_hr_role(uuid, public.app_role, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assign_hr_role(p_target_user uuid, p_role public.app_role, p_action text, p_reason text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _target_tenant uuid;
  _has_clerk boolean;
  _has_approver boolean;
  _has_officer boolean;
  _has_auditor boolean;
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'No tenant'; END IF;
  IF NOT (public.has_role(auth.uid(),'admin'::public.app_role)
       OR public.has_role(auth.uid(),'hr_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Seuls les administrateurs peuvent assigner les rôles RH';
  END IF;
  IF p_action NOT IN ('assign','revoke') THEN
    RAISE EXCEPTION 'Action invalide: %', p_action;
  END IF;
  IF p_role::text NOT IN ('hr_clerk','hr_approver','payroll_officer','hr_auditor','hr_admin') THEN
    RAISE EXCEPTION 'Rôle % n''est pas un rôle RH', p_role;
  END IF;

  SELECT tenant_id INTO _target_tenant FROM public.profiles WHERE id = p_target_user;
  IF _target_tenant IS NULL OR _target_tenant <> _tenant THEN
    RAISE EXCEPTION 'Utilisateur cible non rattaché à votre tenant';
  END IF;

  IF p_action = 'assign' THEN
    SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=p_target_user AND role='hr_clerk'::public.app_role AND tenant_id=_tenant) INTO _has_clerk;
    SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=p_target_user AND role='hr_approver'::public.app_role AND tenant_id=_tenant) INTO _has_approver;
    SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=p_target_user AND role='payroll_officer'::public.app_role AND tenant_id=_tenant) INTO _has_officer;
    SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=p_target_user AND role='hr_auditor'::public.app_role AND tenant_id=_tenant) INTO _has_auditor;

    IF p_role='hr_approver'::public.app_role AND _has_clerk THEN
      RAISE EXCEPTION 'SoD: utilisateur déjà Saisie RH — incompatible avec Approbateur Paie';
    END IF;
    IF p_role='hr_clerk'::public.app_role AND _has_approver THEN
      RAISE EXCEPTION 'SoD: utilisateur déjà Approbateur Paie — incompatible avec Saisie RH';
    END IF;
    IF p_role='hr_auditor'::public.app_role AND _has_officer THEN
      RAISE EXCEPTION 'SoD: utilisateur déjà Officier de Paie — incompatible avec Auditeur RH';
    END IF;
    IF p_role='payroll_officer'::public.app_role AND _has_auditor THEN
      RAISE EXCEPTION 'SoD: utilisateur déjà Auditeur RH — incompatible avec Officier de Paie';
    END IF;

    INSERT INTO public.user_roles (user_id, role, tenant_id)
    VALUES (p_target_user, p_role, _tenant)
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    DELETE FROM public.user_roles
      WHERE user_id=p_target_user AND role=p_role AND tenant_id=_tenant;
  END IF;

  INSERT INTO public.hr_role_audit (tenant_id, performed_by, target_user_id, role, action, reason)
  VALUES (_tenant, auth.uid(), p_target_user, p_role::text, p_action::text, p_reason);
END $$;


--
-- Name: assign_inventory_role(uuid, public.app_role, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assign_inventory_role(_target_user uuid, _role public.app_role, _action text, _comment text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid()); _t uuid;
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'No tenant'; END IF;
  IF NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN RAISE EXCEPTION 'Admin only'; END IF;
  IF _action NOT IN ('assign','revoke') THEN RAISE EXCEPTION 'Invalid action'; END IF;
  IF _role::text NOT IN ('inventory_clerk','inventory_manager','inventory_controller') THEN
    RAISE EXCEPTION 'Not an inventory role';
  END IF;
  SELECT tenant_id INTO _t FROM public.profiles WHERE id = _target_user;
  IF _t IS NULL OR _t <> _tenant THEN RAISE EXCEPTION 'Target user not in your tenant'; END IF;

  IF _action = 'assign' THEN
    INSERT INTO public.user_roles(user_id, role, tenant_id) VALUES (_target_user, _role, _tenant)
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    DELETE FROM public.user_roles WHERE user_id = _target_user AND role = _role AND tenant_id = _tenant;
  END IF;

  INSERT INTO public.inventory_role_audit(tenant_id, target_user_id, role, action, performed_by, comment)
  VALUES (_tenant, _target_user, _role, _action, auth.uid(), _comment);
END $$;


--
-- Name: assign_procurement_role(uuid, public.app_role, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assign_procurement_role(_target_user uuid, _role public.app_role, _action text, _comment text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _target_tenant uuid;
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'No tenant'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only administrators can assign procurement roles';
  END IF;
  IF _action NOT IN ('assign','revoke') THEN
    RAISE EXCEPTION 'Invalid action %', _action;
  END IF;
  IF _role::text NOT IN ('procurement_l1','procurement_l2','procurement_l3','procurement_controller','procurement_3wm_approver') THEN
    RAISE EXCEPTION 'Role % is not a procurement role', _role;
  END IF;

  SELECT tenant_id INTO _target_tenant FROM public.profiles WHERE id = _target_user;
  IF _target_tenant IS NULL OR _target_tenant <> _tenant THEN
    RAISE EXCEPTION 'Target user not in your tenant';
  END IF;

  IF _action = 'assign' THEN
    INSERT INTO public.user_roles (user_id, role, tenant_id)
    VALUES (_target_user, _role, _tenant)
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    DELETE FROM public.user_roles
     WHERE user_id = _target_user AND role = _role AND tenant_id = _tenant;
  END IF;

  INSERT INTO public.procurement_role_audit (tenant_id, target_user_id, role, action, performed_by, comment)
  VALUES (_tenant, _target_user, _role, _action, auth.uid(), _comment);
END; $$;


--
-- Name: assign_project_role(uuid, uuid, public.app_role, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assign_project_role(_tenant_id uuid, _target_user_id uuid, _role public.app_role, _action text, _reason text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _caller uuid := auth.uid();
  _conflict app_role;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;

  IF NOT (public.has_role(_caller, 'project_admin') OR public.has_role(_caller, 'admin')) THEN
    RAISE EXCEPTION 'FORBIDDEN: project_admin role required' USING ERRCODE = '42501';
  END IF;

  IF _role NOT IN ('project_planner','project_accountant','project_controller','project_admin') THEN
    RAISE EXCEPTION 'INVALID_ROLE: %', _role USING ERRCODE = '22023';
  END IF;

  IF _action NOT IN ('grant','revoke') THEN
    RAISE EXCEPTION 'INVALID_ACTION: %', _action USING ERRCODE = '22023';
  END IF;

  -- Segregation of Duties: planner and controller are mutually exclusive
  IF _action = 'grant' THEN
    IF _role = 'project_planner' THEN
      _conflict := 'project_controller';
    ELSIF _role = 'project_controller' THEN
      _conflict := 'project_planner';
    END IF;

    IF _conflict IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = _target_user_id AND role = _conflict
    ) THEN
      RAISE EXCEPTION 'SOD_VIOLATION: user already has conflicting role %', _conflict USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.user_roles(user_id, role)
    VALUES (_target_user_id, _role)
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    DELETE FROM public.user_roles
    WHERE user_id = _target_user_id AND role = _role;
  END IF;

  INSERT INTO public.project_role_audit(tenant_id, target_user_id, role, action, performed_by, reason)
  VALUES (_tenant_id, _target_user_id, _role, _action, _caller, _reason);

  RETURN jsonb_build_object('ok', true, 'role', _role, 'action', _action);
END;
$$;


--
-- Name: assign_risk_role(uuid, public.app_role, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assign_risk_role(_target_user uuid, _role public.app_role, _action text, _reason text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE _tenant uuid; _actor uuid := auth.uid(); _conflict public.app_role;
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT (public.has_role(_actor,'admin') OR public.has_role(_actor,'risk_admin')) THEN
    RAISE EXCEPTION 'forbidden: risk_admin required';
  END IF;
  IF _role NOT IN ('risk_owner','risk_assessor','risk_admin') THEN
    RAISE EXCEPTION 'invalid risk role: %', _role;
  END IF;
  IF _action NOT IN ('grant','revoke') THEN RAISE EXCEPTION 'invalid action'; END IF;

  SELECT tenant_id INTO _tenant FROM public.profiles WHERE id = _target_user;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'target user not found'; END IF;

  IF _action = 'grant' THEN
    _conflict := CASE _role
      WHEN 'risk_owner' THEN 'risk_assessor'::public.app_role
      WHEN 'risk_assessor' THEN 'risk_owner'::public.app_role
      ELSE NULL END;
    IF _conflict IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = _target_user AND role = _conflict
    ) THEN
      RAISE EXCEPTION 'SoD violation: user already has conflicting role %', _conflict;
    END IF;
    INSERT INTO public.user_roles(user_id, role) VALUES (_target_user, _role)
      ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.user_roles WHERE user_id = _target_user AND role = _role;
  END IF;

  INSERT INTO public.risk_role_audit(tenant_id, actor_user_id, target_user_id, role, action, reason)
  VALUES (_tenant, _actor, _target_user, _role, _action, _reason);
END $$;


--
-- Name: assign_sales_role(uuid, public.app_role, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assign_sales_role(_target_user uuid, _role public.app_role, _action text, _comment text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid()); _t uuid;
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'No tenant'; END IF;
  IF NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN RAISE EXCEPTION 'Admin only'; END IF;
  IF _action NOT IN ('assign','revoke') THEN RAISE EXCEPTION 'Invalid action'; END IF;
  IF _role::text NOT IN ('sales_rep','sales_manager','sales_controller') THEN RAISE EXCEPTION 'Not a sales role'; END IF;
  SELECT tenant_id INTO _t FROM public.profiles WHERE id=_target_user;
  IF _t IS NULL OR _t<>_tenant THEN RAISE EXCEPTION 'Target user not in your tenant'; END IF;

  IF _action='assign' THEN
    INSERT INTO public.user_roles(user_id,role,tenant_id) VALUES (_target_user,_role,_tenant)
    ON CONFLICT (user_id,role) DO NOTHING;
  ELSE
    DELETE FROM public.user_roles WHERE user_id=_target_user AND role=_role AND tenant_id=_tenant;
  END IF;

  INSERT INTO public.sales_role_audit(tenant_id,target_user_id,role,action,performed_by,comment)
  VALUES (_tenant,_target_user,_role,_action,auth.uid(),_comment);
END $$;


--
-- Name: assign_treasury_role(uuid, public.app_role, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assign_treasury_role(p_target_user uuid, p_role public.app_role, p_action text, p_comment text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'no_tenant'; END IF;
  IF NOT (public.has_role(auth.uid(), 'cash_admin') OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;
  IF p_role NOT IN ('treasury_clerk','treasury_manager','treasury_controller','cash_admin') THEN
    RAISE EXCEPTION 'invalid_role';
  END IF;
  IF p_action = 'assign' THEN
    INSERT INTO public.user_roles(user_id, role) VALUES (p_target_user, p_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSIF p_action = 'revoke' THEN
    DELETE FROM public.user_roles WHERE user_id = p_target_user AND role = p_role;
  ELSE
    RAISE EXCEPTION 'invalid_action';
  END IF;
  INSERT INTO public.treasury_role_audit(tenant_id, actor_id, target_user_id, role, action, comment)
  VALUES (v_tenant, auth.uid(), p_target_user, p_role, p_action, p_comment);
END $$;


--
-- Name: auto_invoice_on_delivery(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.auto_invoice_on_delivery() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _auto boolean;
  _inv_id uuid; _inv_number text;
  _subtotal numeric;
BEGIN
  IF NEW.status <> 'completed' THEN RETURN NEW; END IF;
  IF (TG_OP='UPDATE' AND OLD.status = 'completed') THEN RETURN NEW; END IF;
  IF NEW.ar_invoice_id IS NOT NULL THEN RETURN NEW; END IF;

  SELECT auto_invoice_on_delivery INTO _auto FROM public.sales_settings WHERE tenant_id = NEW.tenant_id;
  IF NOT COALESCE(_auto, false) THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(total),0) INTO _subtotal FROM public.dn_lines WHERE dn_id = NEW.id;
  IF _subtotal <= 0 THEN RETURN NEW; END IF;

  _inv_number := 'INV-'||to_char(now(),'YYYY')||'-'||lpad((floor(random()*99999))::text,5,'0');

  INSERT INTO public.ar_invoices(tenant_id, invoice_number, customer_id, invoice_date, due_date,
    subtotal, tax_amount, total, amount_paid, status, so_id, dn_id, created_by)
  VALUES (NEW.tenant_id, _inv_number, NEW.customer_id, CURRENT_DATE, CURRENT_DATE+30,
    _subtotal, 0, _subtotal, 0, 'sent', NEW.so_id, NEW.id, NEW.created_by)
  RETURNING id INTO _inv_id;

  NEW.ar_invoice_id := _inv_id;

  PERFORM public.notify_sales(NEW.tenant_id, 'success',
    'Facture auto-générée', _inv_number || ' depuis ' || NEW.dn_number, _inv_id::text);
  RETURN NEW;
END $$;


--
-- Name: check_customer_credit_on_so(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_customer_credit_on_so() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _limit numeric; _outstanding numeric; _name text;
BEGIN
  IF NEW.status <> 'confirmed' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.status = 'confirmed' THEN RETURN NEW; END IF;

  SELECT credit_limit, name INTO _limit, _name FROM public.customers WHERE id = NEW.customer_id;
  IF _limit IS NULL OR _limit <= 0 THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(total - amount_paid),0) INTO _outstanding
    FROM public.ar_invoices
   WHERE customer_id = NEW.customer_id
     AND status NOT IN ('paid','cancelled');

  IF (_outstanding + NEW.total) > _limit THEN
    PERFORM public.notify_sales(NEW.tenant_id, 'critical',
      'Limite de crédit dépassée — ' || COALESCE(_name,''),
      'Encours ' || _outstanding::text || ' + commande ' || NEW.total::text ||
      ' > limite ' || _limit::text, NEW.id::text);
  END IF;
  RETURN NEW;
END $$;


--
-- Name: close_gl_period(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.close_gl_period(_period text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _id uuid;
  _unbalanced int;
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'No tenant'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators can close GL periods';
  END IF;

  -- Refuse close if draft/unbalanced entries exist in the period
  SELECT count(*) INTO _unbalanced
    FROM public.journal_entries je
   WHERE je.tenant_id = _tenant
     AND to_char(je.entry_date,'YYYY-MM') = _period
     AND je.status IN ('draft','validated');
  IF _unbalanced > 0 THEN
    RAISE EXCEPTION 'Cannot close % : % entries are still draft/validated', _period, _unbalanced;
  END IF;

  INSERT INTO public.period_locks (tenant_id, period, module, status, closed_by, closed_at)
  VALUES (_tenant, _period, 'GL', 'closed', auth.uid(), now())
  ON CONFLICT (tenant_id, period, module)
  DO UPDATE SET status = 'closed', closed_by = auth.uid(), closed_at = now()
  RETURNING id INTO _id;

  RETURN _id;
END; $$;


--
-- Name: close_inventory_period(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.close_inventory_period(_period text) RETURNS public.inventory_period_closes
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
DECLARE
  _tenant UUID := public.get_user_tenant_id(auth.uid());
  _user UUID := auth.uid();
  _existing public.inventory_period_closes;
  _row public.inventory_period_closes;
  _snapshot JSONB;
  _total_value NUMERIC;
  _total_qty NUMERIC;
  _items_count INTEGER;
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'no tenant'; END IF;
  IF NOT public.has_inventory_perm(_user, 'close') THEN
    RAISE EXCEPTION 'forbidden: requires inventory close permission';
  END IF;
  IF _period !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'invalid period format, expected YYYY-MM';
  END IF;

  SELECT * INTO _existing FROM public.inventory_period_closes
   WHERE tenant_id = _tenant AND period = _period;
  IF FOUND THEN
    INSERT INTO public.inventory_role_audit
      (tenant_id, target_user_id, role, action, performed_by, comment)
    VALUES (_tenant, _user, 'inventory_controller', 'period_close_idempotent', _user, _period);
    RETURN _existing;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'item_id', item_id, 'code', code, 'name', name, 'category', category,
            'qty', quantity_on_hand, 'unit_cost', unit_cost, 'value', stock_value)), '[]'::jsonb),
         COALESCE(SUM(stock_value), 0),
         COALESCE(SUM(quantity_on_hand), 0),
         COUNT(*)
    INTO _snapshot, _total_value, _total_qty, _items_count
    FROM public.inventory_slow_moving_view
   WHERE tenant_id = _tenant;

  INSERT INTO public.inventory_period_closes
    (tenant_id, period, closed_by, total_value, total_qty, items_count, snapshot)
  VALUES (_tenant, _period, _user, _total_value, _total_qty, _items_count, _snapshot)
  RETURNING * INTO _row;

  INSERT INTO public.period_locks (tenant_id, period, module, locked_by, locked_at)
  VALUES (_tenant, _period, 'inventory', _user, now())
  ON CONFLICT DO NOTHING;

  INSERT INTO public.inventory_role_audit
    (tenant_id, target_user_id, role, action, performed_by, comment)
  VALUES (_tenant, _user, 'inventory_controller', 'period_close', _user, _period);

  RETURN _row;
END;
$_$;


--
-- Name: close_treasury_period(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.close_treasury_period(_period text) RETURNS public.treasury_period_closes
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _user uuid := auth.uid();
  _existing public.treasury_period_closes;
  _row public.treasury_period_closes;
  _snapshot jsonb;
  _total_balance numeric := 0;
  _accounts_count int := 0;
  _recon_count int := 0;
  _open_drafts int := 0;
  _period_start date;
  _period_end date;
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'no tenant'; END IF;
  IF NOT public.has_treasury_perm(_user, 'close_period') THEN
    RAISE EXCEPTION 'forbidden: requires treasury close permission';
  END IF;
  IF _period !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'invalid period format, expected YYYY-MM';
  END IF;

  _period_start := to_date(_period || '-01','YYYY-MM-DD');
  _period_end := (_period_start + interval '1 month - 1 day')::date;

  SELECT * INTO _existing FROM public.treasury_period_closes
   WHERE tenant_id = _tenant AND period = _period;
  IF FOUND THEN
    INSERT INTO public.treasury_role_audit
      (tenant_id, actor_id, target_user_id, role, action, comment)
    VALUES (_tenant, _user, _user, 'treasury_controller'::public.app_role,
            'period_close_idempotent', _period);
    RETURN _existing;
  END IF;

  IF EXISTS (SELECT 1 FROM public.period_locks
              WHERE tenant_id = _tenant AND period = _period AND module = 'treasury'
                AND status = 'closed') THEN
    INSERT INTO public.treasury_role_audit
      (tenant_id, actor_id, target_user_id, role, action, comment)
    VALUES (_tenant, _user, _user, 'treasury_controller'::public.app_role,
            'period_close_failed', _period || ' | already_locked');
    RAISE EXCEPTION 'period already locked';
  END IF;

  SELECT COUNT(*) INTO _open_drafts
    FROM public.bank_reconciliations
   WHERE tenant_id = _tenant
     AND status = 'draft'
     AND period_end <= _period_end
     AND period_end >= _period_start;
  IF _open_drafts > 0 THEN
    INSERT INTO public.treasury_role_audit
      (tenant_id, actor_id, target_user_id, role, action, comment)
    VALUES (_tenant, _user, _user, 'treasury_controller'::public.app_role,
            'period_close_failed',
            _period || ' | unreconciled:' || _open_drafts);
    RAISE EXCEPTION 'unreconciled: % open reconciliation(s) in period', _open_drafts;
  END IF;

  INSERT INTO public.treasury_role_audit
    (tenant_id, actor_id, target_user_id, role, action, comment)
  VALUES (_tenant, _user, _user, 'treasury_controller'::public.app_role,
          'period_close_started', _period);

  SELECT COALESCE(jsonb_build_object(
      'accounts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', id, 'name', name, 'bank_name', bank_name, 'currency', currency,
          'balance', balance, 'last_reconciled_at', last_reconciled_at))
        FROM public.bank_accounts WHERE tenant_id = _tenant), '[]'::jsonb),
      'reconciliations', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', id, 'bank_account_id', bank_account_id, 'period_start', period_start,
          'period_end', period_end, 'status', status, 'ending_balance', ending_balance))
        FROM public.bank_reconciliations
        WHERE tenant_id = _tenant AND period_end >= _period_start AND period_end <= _period_end),
        '[]'::jsonb),
      'period_start', _period_start, 'period_end', _period_end
    ), '{}'::jsonb)
    INTO _snapshot;

  SELECT COALESCE(SUM(balance), 0), COUNT(*) INTO _total_balance, _accounts_count
    FROM public.bank_accounts WHERE tenant_id = _tenant;
  SELECT COUNT(*) INTO _recon_count
    FROM public.bank_reconciliations
   WHERE tenant_id = _tenant AND period_end >= _period_start AND period_end <= _period_end;

  INSERT INTO public.treasury_period_closes
    (tenant_id, period, status, total_balance, accounts_count, reconciliations_count,
     snapshot, closed_by)
  VALUES (_tenant, _period, 'completed', _total_balance, _accounts_count, _recon_count,
          _snapshot, _user)
  RETURNING * INTO _row;

  INSERT INTO public.period_locks (tenant_id, period, module, status, closed_by, closed_at)
  VALUES (_tenant, _period, 'treasury', 'closed', _user, now())
  ON CONFLICT (tenant_id, period, module) DO UPDATE
    SET status='closed', closed_by = EXCLUDED.closed_by, closed_at = EXCLUDED.closed_at;

  INSERT INTO public.treasury_role_audit
    (tenant_id, actor_id, target_user_id, role, action, comment)
  VALUES (_tenant, _user, _user, 'treasury_controller'::public.app_role,
          'period_close_completed', _period);

  RETURN _row;
END;
$_$;


--
-- Name: commit_budget_on_po(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.commit_budget_on_po() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _budget_id uuid;
  _period text;
BEGIN
  IF NEW.status NOT IN ('approved','ordered') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN RETURN NEW; END IF;

  _period := to_char(NEW.order_date, 'YYYY-MM');
  SELECT id INTO _budget_id FROM public.budgets
   WHERE tenant_id = NEW.tenant_id AND status = 'approved'
     AND fiscal_year = to_char(NEW.order_date, 'YYYY')
   LIMIT 1;

  IF _budget_id IS NOT NULL THEN
    UPDATE public.budget_lines
      SET actual_amount = COALESCE(actual_amount,0) + NEW.total
     WHERE budget_id = _budget_id AND period = _period;
  END IF;
  RETURN NEW;
END; $$;


--
-- Name: compute_dn_line_total(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.compute_dn_line_total() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.total := ROUND((COALESCE(NEW.quantity,0)*COALESCE(NEW.unit_price,0))::numeric,2);
  RETURN NEW;
END $$;


--
-- Name: compute_payroll_line(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.compute_payroll_line(_employee_id uuid) RETURNS TABLE(gross numeric, deductions numeric, taxes numeric, net numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE _base numeric;
BEGIN
  SELECT base_salary INTO _base FROM public.employees WHERE id = _employee_id;
  IF _base IS NULL THEN _base := 0; END IF;
  gross      := ROUND(_base, 2);
  deductions := ROUND(_base * 0.063, 2);
  taxes      := ROUND((_base - (_base * 0.063)) * 0.10, 2);
  net        := ROUND(gross - deductions - taxes, 2);
  RETURN NEXT;
END $$;


--
-- Name: compute_po_line_total(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.compute_po_line_total() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.total := ROUND((COALESCE(NEW.quantity,0) * COALESCE(NEW.unit_cost,0))::numeric, 2);
  RETURN NEW;
END; $$;


--
-- Name: compute_quote_line_total(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.compute_quote_line_total() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.total := ROUND((COALESCE(NEW.quantity,0)*COALESCE(NEW.unit_price,0))::numeric,2);
  RETURN NEW;
END $$;


--
-- Name: compute_req_line_total(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.compute_req_line_total() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.total := ROUND((COALESCE(NEW.quantity,0) * COALESCE(NEW.estimated_unit_cost,0))::numeric, 2);
  RETURN NEW;
END; $$;


--
-- Name: compute_so_line_total(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.compute_so_line_total() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.total := ROUND((COALESCE(NEW.quantity,0)*COALESCE(NEW.unit_price,0))::numeric,2);
  RETURN NEW;
END $$;


--
-- Name: compute_stock_movement_value(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.compute_stock_movement_value() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.unit_cost IS NULL THEN NEW.unit_cost := 0; END IF;
  NEW.total_value := ROUND((ABS(COALESCE(NEW.quantity,0)) * COALESCE(NEW.unit_cost,0))::numeric, 2);
  RETURN NEW;
END $$;


--
-- Name: confirm_quote_to_so(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.confirm_quote_to_so(_quote_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _q public.quotations%ROWTYPE;
  _so_id uuid; _so_number text;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF NOT public.has_sales_perm(auth.uid(),'confirm') THEN RAISE EXCEPTION 'Permission denied'; END IF;
  SELECT * INTO _q FROM public.quotations WHERE id=_quote_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quote not found'; END IF;
  IF _q.tenant_id<>_tenant THEN RAISE EXCEPTION 'Tenant mismatch'; END IF;
  IF _q.status NOT IN ('accepted','sent','draft') THEN RAISE EXCEPTION 'Quote status invalid: %', _q.status; END IF;

  _so_number := 'SO-'||to_char(now(),'YYYY')||'-'||lpad((floor(random()*9999))::text,4,'0');
  INSERT INTO public.sales_orders(tenant_id, so_number, quotation_id, customer_id, order_date, total, status, created_by)
  VALUES (_q.tenant_id, _so_number, _q.id, _q.customer_id, CURRENT_DATE, COALESCE(_q.total,0), 'draft', auth.uid())
  RETURNING id INTO _so_id;

  INSERT INTO public.so_lines(so_id, item_id, description, quantity, unit_price, total)
  SELECT _so_id, ql.item_id, ql.description, ql.quantity, ql.unit_price, ql.total
    FROM public.quote_lines ql WHERE ql.quotation_id=_quote_id;

  UPDATE public.quotations SET status='converted' WHERE id=_quote_id;
  PERFORM public.notify_sales(_q.tenant_id,'info','Quote → SO',_q.quote_number||' → '||_so_number,_so_id::text);
  RETURN _so_id;
END $$;


--
-- Name: confirm_so(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.confirm_so(_so_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE _s public.sales_orders%ROWTYPE; _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF NOT public.has_sales_perm(auth.uid(),'confirm') THEN RAISE EXCEPTION 'Permission denied'; END IF;
  SELECT * INTO _s FROM public.sales_orders WHERE id=_so_id;
  IF _s.tenant_id<>_tenant THEN RAISE EXCEPTION 'Tenant mismatch'; END IF;
  UPDATE public.sales_orders SET status='confirmed' WHERE id=_so_id;
  PERFORM public.notify_sales(_s.tenant_id,'success','SO confirmé',_s.so_number,_so_id::text);
END $$;


--
-- Name: convert_opportunity_to_quote(uuid, uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.convert_opportunity_to_quote(_opp_id uuid, _customer_id uuid DEFAULT NULL::uuid, _valid_until date DEFAULT NULL::date) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _opp public.crm_opportunities%ROWTYPE;
  _tenant UUID := public.get_user_tenant_id(auth.uid());
  _customer UUID;
  _quote_id UUID;
  _qnum TEXT;
  _is_manager BOOLEAN;
BEGIN
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'no_tenant';
  END IF;

  SELECT * INTO _opp FROM public.crm_opportunities WHERE id = _opp_id AND tenant_id = _tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'opportunity_not_found';
  END IF;

  -- Idempotent: already converted
  IF _opp.converted_quotation_id IS NOT NULL THEN
    RETURN _opp.converted_quotation_id;
  END IF;

  IF _opp.stage <> 'won' THEN
    RAISE EXCEPTION 'opportunity_not_won';
  END IF;

  -- RBAC: require crm_manager or crm_admin
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.tenant_id = _tenant
      AND ur.role IN ('crm_manager','crm_admin')
  ) INTO _is_manager;
  IF NOT _is_manager THEN
    RAISE EXCEPTION 'insufficient_role';
  END IF;

  _customer := COALESCE(_customer_id, _opp.customer_id);
  IF _customer IS NULL THEN
    RAISE EXCEPTION 'customer_required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = _customer AND tenant_id = _tenant) THEN
    RAISE EXCEPTION 'customer_invalid_tenant';
  END IF;

  _qnum := 'Q-' || to_char(now(), 'YYYYMM') || '-' || substr(replace(_opp_id::text, '-', ''), 1, 8);

  INSERT INTO public.quotations (tenant_id, quote_number, customer_id, quote_date, valid_until, total, status, created_by)
  VALUES (_tenant, _qnum, _customer, CURRENT_DATE, COALESCE(_valid_until, CURRENT_DATE + INTERVAL '30 days'), COALESCE(_opp.amount, 0), 'draft', auth.uid())
  RETURNING id INTO _quote_id;

  UPDATE public.crm_opportunities
    SET converted_quotation_id = _quote_id,
        customer_id = _customer,
        status = 'closed',
        updated_at = now()
    WHERE id = _opp_id;

  INSERT INTO public.crm_activities (tenant_id, opportunity_id, contact_id, type, subject, notes, created_by)
  VALUES (_tenant, _opp_id, _opp.contact_id, 'conversion',
          'Converti en devis ' || _qnum,
          'Quotation ' || _quote_id::text || ' · Montant ' || COALESCE(_opp.amount,0)::text || ' ' || _opp.currency,
          auth.uid());

  RETURN _quote_id;
END;
$$;


--
-- Name: convert_pr_to_po(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.convert_pr_to_po(_pr_id uuid, _supplier_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
END; $$;


--
-- Name: convert_quote_to_so(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.convert_quote_to_so(_quote_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _q public.quotations%ROWTYPE;
  _so_id uuid;
  _so_number text;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _opp_id uuid;
  _already boolean := false;
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'no_tenant'; END IF;
  IF NOT public.has_sales_perm(auth.uid(),'confirm') THEN RAISE EXCEPTION 'insufficient_role'; END IF;

  SELECT * INTO _q FROM public.quotations WHERE id=_quote_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'quote_not_found'; END IF;
  IF _q.tenant_id<>_tenant THEN RAISE EXCEPTION 'tenant_mismatch'; END IF;

  SELECT id INTO _so_id FROM public.sales_orders WHERE quotation_id=_quote_id LIMIT 1;
  IF _so_id IS NOT NULL THEN
    _already := true;
  ELSE
    IF _q.status NOT IN ('accepted','sent','draft') THEN
      RAISE EXCEPTION 'quote_status_invalid';
    END IF;
    _so_number := 'SO-'||to_char(now(),'YYYYMM')||'-'||substr(replace(_quote_id::text,'-',''),1,8);
    INSERT INTO public.sales_orders(tenant_id, so_number, quotation_id, customer_id, order_date, total, status, created_by)
    VALUES (_tenant, _so_number, _q.id, _q.customer_id, CURRENT_DATE, COALESCE(_q.total,0), 'draft', auth.uid())
    RETURNING id INTO _so_id;
    INSERT INTO public.so_lines(so_id, item_id, description, quantity, unit_price, total)
    SELECT _so_id, ql.item_id, ql.description, ql.quantity, ql.unit_price, ql.total
      FROM public.quote_lines ql WHERE ql.quotation_id=_quote_id;
    UPDATE public.quotations SET status='converted' WHERE id=_quote_id;
  END IF;

  SELECT id INTO _opp_id FROM public.crm_opportunities WHERE converted_quotation_id=_quote_id LIMIT 1;
  IF _opp_id IS NOT NULL AND NOT _already THEN
    INSERT INTO public.crm_activities(tenant_id, opportunity_id, type, subject, notes, created_by, completed_at)
    VALUES (_tenant, _opp_id, 'so_conversion',
            'Devis converti en bon de commande',
            'quote_id='||_quote_id::text||' so_id='||_so_id::text,
            auth.uid(), now());
  END IF;

  RETURN _so_id;
END $$;


--
-- Name: create_tenant_for_user(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_tenant_for_user(_tenant_name text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _tenant_id uuid;
  _user_id uuid := auth.uid();
BEGIN
  -- Create tenant
  INSERT INTO public.tenants (name)
  VALUES (_tenant_name)
  RETURNING id INTO _tenant_id;

  -- Link profile to tenant
  UPDATE public.profiles
  SET tenant_id = _tenant_id
  WHERE id = _user_id;

  -- Assign admin role
  INSERT INTO public.user_roles (user_id, role, tenant_id)
  VALUES (_user_id, 'admin', _tenant_id);

  RETURN _tenant_id;
END;
$$;


--
-- Name: crm_audit_stage_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.crm_audit_stage_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.stage IS DISTINCT FROM OLD.stage THEN
    INSERT INTO public.crm_activities(tenant_id, opportunity_id, contact_id, type, subject, completed_at, created_by)
    VALUES (NEW.tenant_id, NEW.id, NEW.contact_id, 'stage_change',
            'Étape : ' || OLD.stage || ' → ' || NEW.stage, now(), auth.uid());
  END IF;
  RETURN NEW;
END; $$;


--
-- Name: crm_set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.crm_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;


--
-- Name: enforce_balanced_entry(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_balanced_entry() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  _dr numeric; _cr numeric; _cnt int;
BEGIN
  IF NEW.status <> 'posted' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'posted' THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0), COUNT(*)
    INTO _dr, _cr, _cnt
    FROM public.journal_lines WHERE entry_id = NEW.id;

  IF _cnt = 0 THEN
    RAISE EXCEPTION 'JE %: cannot post empty entry', NEW.entry_number;
  END IF;
  IF ROUND(_dr,2) <> ROUND(_cr,2) THEN
    RAISE EXCEPTION 'JE %: unbalanced (DR=% CR=%)', NEW.entry_number, _dr, _cr;
  END IF;
  RETURN NEW;
END; $$;


--
-- Name: enforce_inventory_period_lock(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_inventory_period_lock() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE _period text; _date date; _locked boolean;
BEGIN
  _date := COALESCE(NEW.movement_date, CURRENT_DATE);
  _period := to_char(_date, 'YYYY-MM');
  SELECT (status='closed') INTO _locked FROM public.period_locks
    WHERE tenant_id = NEW.tenant_id AND module = 'Inventory' AND period = _period LIMIT 1;
  IF COALESCE(_locked,false) THEN
    RAISE EXCEPTION 'Période stock % verrouillée', _period;
  END IF;
  RETURN NEW;
END $$;


--
-- Name: enforce_period_lock(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_period_lock() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _period text;
  _locked boolean;
BEGIN
  -- Only check when the entry is or becomes posted
  IF NEW.status NOT IN ('posted','reversed') THEN RETURN NEW; END IF;

  _period := to_char(NEW.entry_date, 'YYYY-MM');
  SELECT (status = 'closed') INTO _locked
    FROM public.period_locks
   WHERE tenant_id = NEW.tenant_id
     AND module = 'GL'
     AND period = _period
   LIMIT 1;

  IF COALESCE(_locked, false) THEN
    RAISE EXCEPTION 'GL period % is closed — entry % cannot be posted/modified', _period, NEW.entry_number;
  END IF;

  RETURN NEW;
END; $$;


--
-- Name: enforce_sales_period_lock(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_sales_period_lock() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _period text;
  _date date;
  _locked boolean;
BEGIN
  _date := CASE TG_TABLE_NAME
    WHEN 'quotations' THEN NEW.quote_date
    WHEN 'sales_orders' THEN NEW.order_date
    WHEN 'delivery_notes' THEN NEW.delivery_date
  END;
  IF _date IS NULL THEN RETURN NEW; END IF;

  _period := to_char(_date, 'YYYY-MM');
  SELECT (status='closed') INTO _locked
    FROM public.period_locks
   WHERE tenant_id = NEW.tenant_id AND module = 'Sales' AND period = _period
   LIMIT 1;

  IF COALESCE(_locked, false) THEN
    RAISE EXCEPTION 'Sales period % is closed — operation refused on %', _period, TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END $$;


--
-- Name: generate_payroll_lines(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_payroll_lines(_run_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _run public.payroll_runs%ROWTYPE;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _count integer := 0;
BEGIN
  IF NOT public.has_hr_perm(auth.uid(), 'create_payroll_run') THEN
    RAISE EXCEPTION 'Permission refusée: rôle Saisie RH requis';
  END IF;
  SELECT * INTO _run FROM public.payroll_runs WHERE id = _run_id;
  IF _run.tenant_id IS NULL OR _run.tenant_id <> _tenant THEN RAISE EXCEPTION 'Cycle introuvable'; END IF;
  IF _run.status <> 'draft' THEN RAISE EXCEPTION 'Cycle non modifiable (statut %)', _run.status; END IF;

  DELETE FROM public.payroll_lines WHERE run_id = _run_id;
  INSERT INTO public.payroll_lines (tenant_id, run_id, employee_id, gross, deductions, taxes, net)
  SELECT _run.tenant_id, _run_id, e.id, c.gross, c.deductions, c.taxes, c.net
    FROM public.employees e
    CROSS JOIN LATERAL public.compute_payroll_line(e.id) c
   WHERE e.tenant_id = _run.tenant_id AND e.status = 'active';
  GET DIAGNOSTICS _count = ROW_COUNT;

  UPDATE public.payroll_runs
     SET gross_total = COALESCE((SELECT SUM(gross) FROM public.payroll_lines WHERE run_id = _run_id),0),
         net_total   = COALESCE((SELECT SUM(net)   FROM public.payroll_lines WHERE run_id = _run_id),0),
         employee_count = _count
   WHERE id = _run_id;
  RETURN _count;
END $$;


--
-- Name: get_accessible_tenants(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_accessible_tenants() RETURNS TABLE(id uuid, name text, currency text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT DISTINCT t.id, t.name, t.currency
  FROM public.tenants t
  WHERE t.id IN (
    SELECT tenant_id FROM public.user_role_assignments WHERE user_id = auth.uid()
    UNION
    SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
  )
  ORDER BY t.name;
$$;


--
-- Name: get_consolidated_cfo_kpis(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_consolidated_cfo_kpis(_tenant_ids uuid[]) RETURNS TABLE(tenant_id uuid, tenant_name text, currency text, cash_on_hand numeric, ar_outstanding numeric, ap_outstanding numeric, ar_overdue numeric, ap_overdue numeric, ar_overdue_count integer, ap_overdue_count integer, open_projects integer, open_risks_high integer, unmatched_recon_count integer)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_allowed uuid[];
BEGIN
  SELECT array_agg(t.id) INTO v_allowed FROM public.get_accessible_tenants() t WHERE t.id = ANY (_tenant_ids);
  IF v_allowed IS NULL OR array_length(v_allowed, 1) = 0 THEN RETURN; END IF;
  RETURN QUERY
  WITH base AS (
    SELECT t.id AS tid, t.name AS tname, t.currency AS tcur FROM public.tenants t WHERE t.id = ANY (v_allowed)
  ), ar AS (
    SELECT i.tenant_id AS tid,
      COALESCE(SUM(CASE WHEN i.status <> 'paid' THEN i.total - i.amount_paid END), 0) AS outstanding,
      COALESCE(SUM(CASE WHEN i.status <> 'paid' AND i.due_date < CURRENT_DATE THEN i.total - i.amount_paid END), 0) AS overdue,
      COUNT(*) FILTER (WHERE i.status <> 'paid' AND i.due_date < CURRENT_DATE) AS overdue_count
    FROM public.ar_invoices i WHERE i.tenant_id = ANY (v_allowed) GROUP BY i.tenant_id
  ), ap AS (
    SELECT i.tenant_id AS tid,
      COALESCE(SUM(CASE WHEN i.status <> 'paid' THEN i.total - i.amount_paid END), 0) AS outstanding,
      COALESCE(SUM(CASE WHEN i.status <> 'paid' AND i.due_date < CURRENT_DATE THEN i.total - i.amount_paid END), 0) AS overdue,
      COUNT(*) FILTER (WHERE i.status <> 'paid' AND i.due_date < CURRENT_DATE) AS overdue_count
    FROM public.ap_invoices i WHERE i.tenant_id = ANY (v_allowed) GROUP BY i.tenant_id
  ), cash AS (
    SELECT a.tenant_id AS tid, COALESCE(SUM(a.balance), 0) AS bal FROM public.bank_accounts a WHERE a.tenant_id = ANY (v_allowed) GROUP BY a.tenant_id
  ), proj AS (
    SELECT p.tenant_id AS tid, COUNT(*)::int AS n FROM public.projects p WHERE p.tenant_id = ANY (v_allowed) AND p.status = 'active' GROUP BY p.tenant_id
  ), rsk AS (
    SELECT r.tenant_id AS tid, COUNT(*)::int AS n FROM public.risk_register r WHERE r.tenant_id = ANY (v_allowed) AND r.risk_score >= 9 AND r.status <> 'closed' GROUP BY r.tenant_id
  ), rec AS (
    SELECT r.tenant_id AS tid, COUNT(*)::int AS n FROM public.bank_reconciliations r WHERE r.tenant_id = ANY (v_allowed) AND r.status = 'draft' GROUP BY r.tenant_id
  )
  SELECT b.tid, b.tname, b.tcur, COALESCE(cash.bal, 0), COALESCE(ar.outstanding, 0), COALESCE(ap.outstanding, 0), COALESCE(ar.overdue, 0), COALESCE(ap.overdue, 0), COALESCE(ar.overdue_count, 0)::int, COALESCE(ap.overdue_count, 0)::int, COALESCE(proj.n, 0), COALESCE(rsk.n, 0), COALESCE(rec.n, 0)
  FROM base b LEFT JOIN cash ON cash.tid=b.tid LEFT JOIN ar ON ar.tid=b.tid LEFT JOIN ap ON ap.tid=b.tid LEFT JOIN proj ON proj.tid=b.tid LEFT JOIN rsk ON rsk.tid=b.tid LEFT JOIN rec ON rec.tid=b.tid ORDER BY b.tname;
END;
$$;


--
-- Name: get_consolidated_cfo_trends(uuid[], integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_consolidated_cfo_trends(_tenant_ids uuid[], _months integer DEFAULT 12) RETURNS TABLE(month text, revenue numeric, expenses numeric, net_profit numeric, cash_balance numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF _months IS NULL OR _months NOT IN (3, 6, 12) THEN RAISE EXCEPTION 'Period must be 3, 6 or 12 months' USING ERRCODE = '22023'; END IF;
  RETURN QUERY
  WITH allowed AS (
    SELECT a.id FROM public.get_accessible_tenants() a WHERE a.id = ANY(_tenant_ids)
  ), periods AS (
    SELECT s::date AS start_date, LEAST((s + interval '1 month - 1 day')::date, CURRENT_DATE) AS end_date
    FROM generate_series(date_trunc('month', CURRENT_DATE) - make_interval(months => _months - 1), date_trunc('month', CURRENT_DATE), interval '1 month') s
    WHERE EXISTS (SELECT 1 FROM allowed)
  ), receipts AS (
    SELECT to_char(p.payment_date, 'YYYY-MM') AS key,
      COALESCE(sum(p.amount) FILTER (WHERE p.payment_type = 'ar_receipt'), 0) AS income,
      COALESCE(sum(p.amount) FILTER (WHERE p.payment_type = 'ap_payment'), 0) AS spending
    FROM public.payments p JOIN allowed a ON a.id = p.tenant_id
    WHERE p.payment_date >= (date_trunc('month', CURRENT_DATE) - make_interval(months => _months - 1))::date AND p.payment_date <= CURRENT_DATE
    GROUP BY to_char(p.payment_date, 'YYYY-MM')
  )
  SELECT to_char(m.start_date, 'YYYY-MM'), COALESCE(r.income, 0), COALESCE(r.spending, 0),
    COALESCE(r.income, 0) - COALESCE(r.spending, 0),
    CASE WHEN count(b.id) = 0 THEN NULL
      WHEN m.start_date = date_trunc('month', CURRENT_DATE)::date THEN sum(b.balance)
      WHEN count(h.closing_balance) = count(b.id) THEN sum(h.closing_balance)
      ELSE NULL END
  FROM periods m
  LEFT JOIN receipts r ON r.key = to_char(m.start_date, 'YYYY-MM')
  LEFT JOIN public.bank_accounts b ON b.tenant_id IN (SELECT a.id FROM allowed a)
    AND b.is_active = true AND b.currency = 'XOF' AND b.created_at::date <= m.end_date
  LEFT JOIN LATERAL (
    SELECT bs.closing_balance FROM public.bank_statements bs
    WHERE bs.tenant_id = b.tenant_id AND bs.bank_account_id = b.id AND bs.period_end = m.end_date
      AND bs.period_start <= m.start_date AND bs.status = 'imported'
    ORDER BY bs.created_at DESC, bs.id DESC LIMIT 1
  ) h ON true
  GROUP BY m.start_date, r.income, r.spending ORDER BY m.start_date;
END;
$$;


--
-- Name: get_user_tenant_id(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_user_tenant_id(_user_id uuid) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT tenant_id FROM public.profiles WHERE id = _user_id
$$;


--
-- Name: guard_ap_payment(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_ap_payment() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _approval text;
BEGIN
  IF NEW.payment_type <> 'ap_payment' OR NEW.ap_invoice_id IS NULL THEN RETURN NEW; END IF;
  SELECT approval_status INTO _approval FROM public.ap_invoices WHERE id = NEW.ap_invoice_id;
  IF _approval IS NULL OR _approval <> 'approved' THEN
    RAISE EXCEPTION 'Cannot pay AP invoice %: approval_status must be approved (got %)', NEW.ap_invoice_id, _approval;
  END IF;
  RETURN NEW;
END; $$;


--
-- Name: guard_payroll_run_lock(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_payroll_run_lock() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status='posted' AND NEW.status <> 'posted' THEN
    RAISE EXCEPTION 'Un cycle comptabilisé ne peut être modifié';
  END IF;
  IF TG_OP = 'DELETE' AND OLD.status='posted' THEN
    RAISE EXCEPTION 'Un cycle comptabilisé ne peut être supprimé';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;


--
-- Name: guard_po_approval(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_po_approval() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE _pr_status text;
BEGIN
  IF NEW.status IN ('approved','ordered') AND (TG_OP='INSERT' OR OLD.status <> NEW.status) THEN
    SELECT status INTO _pr_status FROM public.purchase_requisitions WHERE po_id = NEW.id LIMIT 1;
    IF _pr_status IS NOT NULL AND _pr_status NOT IN ('approved','converted') THEN
      RAISE EXCEPTION 'PO %: linked PR must be approved first (current: %)', NEW.po_number, _pr_status;
    END IF;
  END IF;
  RETURN NEW;
END; $$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''));
  RETURN NEW;
END;
$$;


--
-- Name: has_crm_perm(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_crm_perm(_user_id uuid, _action text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT CASE
    WHEN public.has_role(_user_id, 'admin'::public.app_role)
      OR public.has_role(_user_id, 'crm_admin'::public.app_role) THEN TRUE
    ELSE CASE _action
      WHEN 'view' THEN
        public.has_role(_user_id, 'crm_agent'::public.app_role)
        OR public.has_role(_user_id, 'crm_manager'::public.app_role)
        OR public.has_role(_user_id, 'crm_auditor'::public.app_role)
      WHEN 'create' THEN
        public.has_role(_user_id, 'crm_agent'::public.app_role)
        OR public.has_role(_user_id, 'crm_manager'::public.app_role)
      WHEN 'edit' THEN
        public.has_role(_user_id, 'crm_agent'::public.app_role)
        OR public.has_role(_user_id, 'crm_manager'::public.app_role)
      WHEN 'delete' THEN public.has_role(_user_id, 'crm_manager'::public.app_role)
      WHEN 'approve_discount' THEN public.has_role(_user_id, 'crm_manager'::public.app_role)
      WHEN 'convert' THEN public.has_role(_user_id, 'crm_manager'::public.app_role)
      WHEN 'export' THEN
        public.has_role(_user_id, 'crm_manager'::public.app_role)
        OR public.has_role(_user_id, 'crm_auditor'::public.app_role)
      WHEN 'view_sensitive' THEN
        public.has_role(_user_id, 'crm_manager'::public.app_role)
        OR public.has_role(_user_id, 'crm_auditor'::public.app_role)
      WHEN 'audit' THEN public.has_role(_user_id, 'crm_auditor'::public.app_role)
      ELSE FALSE
    END
  END;
$$;


--
-- Name: has_hr_perm(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_hr_perm(_user_id uuid, _action text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    public.has_role(_user_id, 'admin'::public.app_role)
    OR public.has_role(_user_id, 'hr_admin'::public.app_role)
    OR CASE _action
      WHEN 'create_payroll_run'  THEN public.has_role(_user_id, 'hr_clerk'::public.app_role)
      WHEN 'approve_payroll_run' THEN public.has_role(_user_id, 'hr_approver'::public.app_role)
      WHEN 'execute_payroll'     THEN public.has_role(_user_id, 'payroll_officer'::public.app_role)
      WHEN 'audit_payroll'       THEN public.has_role(_user_id, 'hr_auditor'::public.app_role)
      WHEN 'export'              THEN public.has_role(_user_id, 'hr_approver'::public.app_role)
                                   OR public.has_role(_user_id, 'payroll_officer'::public.app_role)
                                   OR public.has_role(_user_id, 'hr_auditor'::public.app_role)
      WHEN 'view_sensitive'      THEN public.has_role(_user_id, 'hr_clerk'::public.app_role)
                                   OR public.has_role(_user_id, 'hr_approver'::public.app_role)
                                   OR public.has_role(_user_id, 'payroll_officer'::public.app_role)
                                   OR public.has_role(_user_id, 'hr_auditor'::public.app_role)
      ELSE false
    END
$$;


--
-- Name: has_inventory_perm(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_inventory_perm(_user_id uuid, _action text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    public.has_role(_user_id, 'admin'::public.app_role)
    OR CASE _action
      WHEN 'move'      THEN public.has_role(_user_id,'inventory_clerk'::public.app_role)
                         OR public.has_role(_user_id,'inventory_manager'::public.app_role)
                         OR public.has_role(_user_id,'inventory_controller'::public.app_role)
      WHEN 'adjust'    THEN public.has_role(_user_id,'inventory_manager'::public.app_role)
                         OR public.has_role(_user_id,'inventory_controller'::public.app_role)
      WHEN 'transfer'  THEN public.has_role(_user_id,'inventory_clerk'::public.app_role)
                         OR public.has_role(_user_id,'inventory_manager'::public.app_role)
                         OR public.has_role(_user_id,'inventory_controller'::public.app_role)
      WHEN 'count'     THEN public.has_role(_user_id,'inventory_clerk'::public.app_role)
                         OR public.has_role(_user_id,'inventory_manager'::public.app_role)
                         OR public.has_role(_user_id,'inventory_controller'::public.app_role)
      WHEN 'post_count' THEN public.has_role(_user_id,'inventory_manager'::public.app_role)
                          OR public.has_role(_user_id,'inventory_controller'::public.app_role)
      ELSE false
    END
$$;


--
-- Name: has_procurement_perm(uuid, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_procurement_perm(_user_id uuid, _action text, _level integer DEFAULT NULL::integer) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: has_role(uuid, public.app_role); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;


--
-- Name: has_sales_perm(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_sales_perm(_user_id uuid, _action text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    public.has_role(_user_id,'admin'::public.app_role)
    OR CASE _action
      WHEN 'create'  THEN public.has_role(_user_id,'sales_rep'::public.app_role)
                       OR public.has_role(_user_id,'sales_manager'::public.app_role)
      WHEN 'confirm' THEN public.has_role(_user_id,'sales_manager'::public.app_role)
                       OR public.has_role(_user_id,'sales_controller'::public.app_role)
      WHEN 'deliver' THEN public.has_role(_user_id,'sales_rep'::public.app_role)
                       OR public.has_role(_user_id,'sales_manager'::public.app_role)
                       OR public.has_role(_user_id,'sales_controller'::public.app_role)
      WHEN 'invoice' THEN public.has_role(_user_id,'sales_manager'::public.app_role)
                       OR public.has_role(_user_id,'sales_controller'::public.app_role)
      ELSE false
    END
$$;


--
-- Name: has_treasury_perm(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_treasury_perm(_user_id uuid, _action text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    public.has_role(_user_id, 'admin'::public.app_role)
    OR public.has_role(_user_id, 'cash_admin'::public.app_role)
    OR CASE _action
      WHEN 'create_txn'       THEN public.has_role(_user_id,'treasury_clerk'::public.app_role)
                                OR public.has_role(_user_id,'treasury_manager'::public.app_role)
      WHEN 'import_statement' THEN public.has_role(_user_id,'treasury_clerk'::public.app_role)
                                OR public.has_role(_user_id,'treasury_manager'::public.app_role)
      WHEN 'match'            THEN public.has_role(_user_id,'treasury_clerk'::public.app_role)
                                OR public.has_role(_user_id,'treasury_manager'::public.app_role)
      WHEN 'validate_recon'   THEN public.has_role(_user_id,'treasury_manager'::public.app_role)
                                OR public.has_role(_user_id,'treasury_controller'::public.app_role)
      WHEN 'edit_forecast'    THEN public.has_role(_user_id,'treasury_manager'::public.app_role)
                                OR public.has_role(_user_id,'treasury_controller'::public.app_role)
      WHEN 'manage_accounts'  THEN public.has_role(_user_id,'treasury_manager'::public.app_role)
      WHEN 'export'           THEN public.has_role(_user_id,'treasury_manager'::public.app_role)
                                OR public.has_role(_user_id,'treasury_controller'::public.app_role)
      WHEN 'view_sensitive'   THEN public.has_role(_user_id,'treasury_clerk'::public.app_role)
                                OR public.has_role(_user_id,'treasury_manager'::public.app_role)
                                OR public.has_role(_user_id,'treasury_controller'::public.app_role)
      WHEN 'close_period'     THEN public.has_role(_user_id,'treasury_controller'::public.app_role)
                                OR public.has_role(_user_id,'treasury_manager'::public.app_role)
      WHEN 'audit'            THEN public.has_role(_user_id,'treasury_controller'::public.app_role)
                                OR public.has_role(_user_id,'treasury_manager'::public.app_role)
      ELSE false
    END
$$;


--
-- Name: invoice_from_delivery(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.invoice_from_delivery(_dn_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _dn public.delivery_notes%ROWTYPE;
  _inv_id uuid; _inv_number text;
  _subtotal numeric; _tax numeric := 0;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF NOT public.has_sales_perm(auth.uid(),'invoice') THEN RAISE EXCEPTION 'Permission denied'; END IF;
  SELECT * INTO _dn FROM public.delivery_notes WHERE id=_dn_id;
  IF _dn.tenant_id<>_tenant THEN RAISE EXCEPTION 'Tenant mismatch'; END IF;
  IF _dn.ar_invoice_id IS NOT NULL THEN RAISE EXCEPTION 'Already invoiced'; END IF;
  IF _dn.status<>'completed' THEN RAISE EXCEPTION 'DN not completed'; END IF;

  SELECT COALESCE(SUM(total),0) INTO _subtotal FROM public.dn_lines WHERE dn_id=_dn_id;
  _inv_number := 'INV-'||to_char(now(),'YYYY')||'-'||lpad((floor(random()*9999))::text,4,'0');

  INSERT INTO public.ar_invoices(tenant_id, invoice_number, customer_id, invoice_date, due_date,
    subtotal, tax_amount, total, amount_paid, status, so_id, dn_id, created_by)
  VALUES (_tenant, _inv_number, _dn.customer_id, CURRENT_DATE, CURRENT_DATE+30,
    _subtotal, _tax, _subtotal+_tax, 0, 'sent', _dn.so_id, _dn_id, auth.uid())
  RETURNING id INTO _inv_id;

  UPDATE public.delivery_notes SET ar_invoice_id=_inv_id WHERE id=_dn_id;
  PERFORM public.notify_sales(_tenant,'success','Facture créée',_inv_number||' depuis '||_dn.dn_number,_inv_id::text);
  RETURN _inv_id;
END $$;


--
-- Name: join_tenant(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.join_tenant(_tenant_name text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _tenant_id uuid;
  _user_id uuid := auth.uid();
BEGIN
  -- Find tenant by name (case insensitive)
  SELECT id INTO _tenant_id
  FROM public.tenants
  WHERE lower(name) = lower(_tenant_name)
  LIMIT 1;

  IF _tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant not found';
  END IF;

  -- Link profile to tenant
  UPDATE public.profiles
  SET tenant_id = _tenant_id
  WHERE id = _user_id;

  -- Assign viewer role
  INSERT INTO public.user_roles (user_id, role, tenant_id)
  VALUES (_user_id, 'viewer', _tenant_id);

  RETURN _tenant_id;
END;
$$;


--
-- Name: log_crm_export(uuid, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_crm_export(_opportunity_id uuid, _format text, _kind text, _record_id uuid DEFAULT NULL::uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'no_tenant'; END IF;
  INSERT INTO public.crm_activities(tenant_id, opportunity_id, type, subject, notes, created_by, completed_at)
  VALUES (_tenant, _opportunity_id, 'export',
          'Export '||upper(_format)||' — '||_kind,
          CASE WHEN _record_id IS NOT NULL THEN 'record_id='||_record_id::text ELSE NULL END,
          auth.uid(), now());
END $$;


--
-- Name: log_journal_entry_audit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_journal_entry_audit() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _action text;
  _details text;
  _batch_id text;
  _prev_hash text;
  _new_hash text;
BEGIN
  -- Determine action
  IF TG_OP = 'INSERT' THEN
    _action := 'Created';
    _details := 'Journal entry created: ' || NEW.entry_number || COALESCE(' — ' || NEW.description, '');
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status <> NEW.status THEN
      CASE NEW.status
        WHEN 'posted' THEN _action := 'Posted'; _details := 'Posted to GL by ' || COALESCE(NEW.posted_by::text, 'System');
        WHEN 'validated' THEN _action := 'Approved'; _details := 'Approved for posting';
        WHEN 'rejected' THEN _action := 'Rejected'; _details := 'Entry rejected';
        WHEN 'cancelled' THEN _action := 'Cancelled'; _details := 'Entry cancelled';
        WHEN 'reversed' THEN _action := 'Reversed'; _details := 'Entry reversed — compensating entry created';
        ELSE _action := 'Updated'; _details := 'Status changed from ' || OLD.status || ' to ' || NEW.status;
      END CASE;
    ELSE
      _action := 'Updated';
      _details := 'Entry modified: ' || NEW.entry_number;
    END IF;
  END IF;

  -- Build batch ID from source + date
  _batch_id := 'GLB-' || UPPER(COALESCE(
    CASE NEW.source
      WHEN 'ar_receipt' THEN 'AR'
      WHEN 'ar_invoice' THEN 'AR'
      WHEN 'ap_payment' THEN 'AP'
      WHEN 'ap_invoice' THEN 'AP'
      WHEN 'manual' THEN 'GL'
      ELSE UPPER(LEFT(NEW.source, 4))
    END, 'GL')) || '-' || to_char(NEW.entry_date, 'YYYYMMDD');

  -- Get previous hash for chain integrity
  SELECT COALESCE(hash, '00000000') INTO _prev_hash
  FROM public.gl_audit_logs
  WHERE tenant_id = NEW.tenant_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF _prev_hash IS NULL THEN _prev_hash := '00000000'; END IF;

  -- Simple hash (MD5 truncated)
  _new_hash := UPPER(LEFT(md5(_prev_hash || _action || NEW.id::text || now()::text), 8));

  INSERT INTO public.gl_audit_logs (tenant_id, batch_id, entry_id, action, user_name, details, hash, prev_hash)
  VALUES (NEW.tenant_id, _batch_id, NEW.id, _action, COALESCE(NEW.created_by::text, 'System'), _details, _new_hash, _prev_hash);

  RETURN NEW;
END;
$$;


--
-- Name: mark_all_erp_alerts_read(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_all_erp_alerts_read() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_tenant uuid;
  v_count integer;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = auth.uid();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No tenant'; END IF;

  UPDATE public.erp_alerts
     SET read_at = now()
   WHERE tenant_id = v_tenant
     AND read_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END; $$;


--
-- Name: notify_inventory(uuid, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_inventory(_tenant_id uuid, _severity text, _title text, _message text, _ref text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.erp_alerts (tenant_id, severity, alert_type, title, message, ref_type, ref_id, module, status)
  VALUES (_tenant_id, _severity, 'inventory', _title, _message, 'inventory', _ref, 'Inventory', 'active');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;


--
-- Name: notify_procurement(uuid, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_procurement(_tenant_id uuid, _severity text, _title text, _message text, _ref text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.erp_alerts (tenant_id, severity, alert_type, title, message, ref_type, ref_id, module, status)
  VALUES (_tenant_id, _severity, 'procurement', _title, _message, 'procurement', _ref, 'Procurement', 'active');
EXCEPTION WHEN OTHERS THEN
  -- ignore if schema differs
  NULL;
END; $$;


--
-- Name: notify_sales(uuid, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_sales(_tenant_id uuid, _severity text, _title text, _message text, _ref text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.erp_alerts (tenant_id, severity, alert_type, title, message, ref_type, ref_id, module, status)
  VALUES (_tenant_id, _severity, 'sales', _title, _message, 'sales', _ref, 'Sales', 'active');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;


--
-- Name: on_ap_invoice_posted(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.on_ap_invoice_posted() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _entry_id uuid; _entry_number text;
  _ap uuid; _exp uuid; _vat uuid;
BEGIN
  IF NEW.journal_entry_id IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.approval_status <> 'approved' THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('approved','open','posted') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status AND OLD.approval_status = NEW.approval_status THEN RETURN NEW; END IF;

  SELECT id INTO _ap  FROM public.gl_accounts WHERE tenant_id = NEW.tenant_id AND code = '4010' LIMIT 1;
  SELECT id INTO _exp FROM public.gl_accounts WHERE tenant_id = NEW.tenant_id AND code = '6010' LIMIT 1;
  SELECT id INTO _vat FROM public.gl_accounts WHERE tenant_id = NEW.tenant_id AND code = '4320' LIMIT 1;

  IF _ap IS NULL OR _exp IS NULL THEN
    RAISE WARNING 'AP Invoice %: missing GL accounts', NEW.invoice_number;
    RETURN NEW;
  END IF;

  _entry_number := 'JE-AP-' || to_char(now(),'YYYYMMDD') || '-' || substr(NEW.id::text,1,8);

  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES (NEW.tenant_id, _entry_number, NEW.invoice_date, 'AP Invoice: '||NEW.invoice_number, 'ap_invoice', 'draft', NEW.created_by)
  RETURNING id INTO _entry_id;

  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  VALUES (_entry_id, _exp, NEW.subtotal, 0, 'DR Achats HT');
  IF COALESCE(NEW.tax_amount,0) > 0 AND _vat IS NOT NULL THEN
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _vat, NEW.tax_amount, 0, 'DR TVA déductible');
  END IF;
  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  VALUES (_entry_id, _ap, 0, NEW.total, 'CR Fournisseurs');

  UPDATE public.journal_entries
    SET status = 'posted', posted_by = NEW.created_by, posted_at = now()
    WHERE id = _entry_id;

  NEW.journal_entry_id := _entry_id;
  RETURN NEW;
END; $$;


--
-- Name: on_ap_payment_recorded(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.on_ap_payment_recorded() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _entry_id uuid; _entry_number text;
  _payable uuid; _bank uuid; _ar uuid;
BEGIN
  IF NEW.payment_type = 'ap_payment' AND NEW.ap_invoice_id IS NOT NULL THEN
    SELECT id INTO _payable FROM public.gl_accounts WHERE tenant_id = NEW.tenant_id AND code = '4010' LIMIT 1;
    SELECT id INTO _bank    FROM public.gl_accounts WHERE tenant_id = NEW.tenant_id AND code = '5210' LIMIT 1;

    IF _payable IS NOT NULL AND _bank IS NOT NULL THEN
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
  END IF;

  IF NEW.payment_type = 'ar_receipt' AND NEW.ar_invoice_id IS NOT NULL THEN
    SELECT id INTO _bank FROM public.gl_accounts WHERE tenant_id = NEW.tenant_id AND code = '5210' LIMIT 1;
    SELECT id INTO _ar   FROM public.gl_accounts WHERE tenant_id = NEW.tenant_id AND code = '4110' LIMIT 1;

    IF _ar IS NOT NULL AND _bank IS NOT NULL THEN
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
  END IF;

  RETURN NEW;
END; $$;


--
-- Name: on_ar_invoice_posted(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.on_ar_invoice_posted() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _entry_id uuid; _entry_number text;
  _ar uuid; _rev uuid; _vat uuid;
BEGIN
  IF NEW.journal_entry_id IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('sent','open','posted') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN RETURN NEW; END IF;

  SELECT id INTO _ar  FROM public.gl_accounts WHERE tenant_id = NEW.tenant_id AND code = '4110' LIMIT 1;
  SELECT id INTO _rev FROM public.gl_accounts WHERE tenant_id = NEW.tenant_id AND code = '4000' LIMIT 1;
  SELECT id INTO _vat FROM public.gl_accounts WHERE tenant_id = NEW.tenant_id AND code = '4310' LIMIT 1;

  IF _ar IS NULL OR _rev IS NULL THEN
    RAISE WARNING 'AR Invoice %: missing GL accounts', NEW.invoice_number;
    RETURN NEW;
  END IF;

  _entry_number := 'JE-AR-' || to_char(now(),'YYYYMMDD') || '-' || substr(NEW.id::text,1,8);

  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES (NEW.tenant_id, _entry_number, NEW.invoice_date, 'AR Invoice: '||NEW.invoice_number, 'ar_invoice', 'draft', NEW.created_by)
  RETURNING id INTO _entry_id;

  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  VALUES (_entry_id, _ar, NEW.total, 0, 'DR Clients');
  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  VALUES (_entry_id, _rev, 0, NEW.subtotal, 'CR Ventes HT');
  IF COALESCE(NEW.tax_amount,0) > 0 AND _vat IS NOT NULL THEN
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _vat, 0, NEW.tax_amount, 'CR TVA collectée');
  END IF;

  UPDATE public.journal_entries
    SET status = 'posted', posted_by = NEW.created_by, posted_at = now()
    WHERE id = _entry_id;

  NEW.journal_entry_id := _entry_id;
  RETURN NEW;
END; $$;


--
-- Name: on_gr_completed(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.on_gr_completed() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status <> 'completed') THEN
    -- Update PO status to received
    UPDATE public.purchase_orders
    SET status = 'received'
    WHERE id = NEW.po_id AND status = 'approved';
    
    -- Update stock quantities for received items
    INSERT INTO public.stock_movements (tenant_id, item_id, movement_type, quantity, reference_type, reference_id, created_by)
    SELECT NEW.tenant_id, gl.item_id, 'receipt', gl.quantity_received, 'goods_receipt', NEW.id, NEW.received_by
    FROM public.gr_lines gl
    WHERE gl.gr_id = NEW.id AND gl.item_id IS NOT NULL;
    
    -- Update item quantities
    UPDATE public.items i
    SET quantity_on_hand = i.quantity_on_hand + gl.quantity_received
    FROM public.gr_lines gl
    WHERE gl.gr_id = NEW.id AND gl.item_id = i.id;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: on_pr_converted_to_po(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.on_pr_converted_to_po() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.po_id IS NOT NULL AND (TG_OP='INSERT' OR OLD.po_id IS DISTINCT FROM NEW.po_id) THEN
    NEW.status := 'converted';
  END IF;
  RETURN NEW;
END; $$;


--
-- Name: on_so_confirmed(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.on_so_confirmed() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.status = 'confirmed' AND (OLD.status IS NULL OR OLD.status <> 'confirmed') THEN
    -- placeholder traceability event; concrete stock decrement to be wired when so_lines exist
    INSERT INTO public.stock_movements (tenant_id, item_id, movement_type, quantity, reference_type, reference_id, created_by)
    SELECT NEW.tenant_id, NULL, 'sale_confirmation', 0, 'sales_order', NEW.id, NEW.created_by
    WHERE NOT EXISTS (
      SELECT 1 FROM public.stock_movements
      WHERE reference_type = 'sales_order' AND reference_id = NEW.id
    );
  END IF;
  RETURN NEW;
END; $$;


--
-- Name: on_stock_movement_je(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.on_stock_movement_je() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _settings public.inventory_settings%ROWTYPE;
  _entry_id uuid; _entry_number text;
  _stock_acc uuid; _other_acc uuid;
  _value numeric := COALESCE(NEW.total_value, 0);
  _is_in boolean := COALESCE(NEW.quantity,0) > 0;
BEGIN
  IF NEW.journal_entry_id IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.status <> 'posted' THEN RETURN NEW; END IF;
  IF _value <= 0 THEN RETURN NEW; END IF;

  SELECT * INTO _settings FROM public.inventory_settings WHERE tenant_id = NEW.tenant_id;
  IF NOT COALESCE(_settings.auto_je_on_movement, true) THEN RETURN NEW; END IF;

  SELECT id INTO _stock_acc FROM public.gl_accounts
    WHERE tenant_id = NEW.tenant_id AND code = COALESCE(_settings.stock_account_code,'3100') LIMIT 1;

  IF NEW.movement_type IN ('delivery','sale','issue') OR (NEW.reference_type = 'delivery_note') THEN
    SELECT id INTO _other_acc FROM public.gl_accounts
      WHERE tenant_id = NEW.tenant_id AND code = COALESCE(_settings.cogs_account_code,'6010') LIMIT 1;
  ELSIF NEW.movement_type = 'adjustment' THEN
    SELECT id INTO _other_acc FROM public.gl_accounts
      WHERE tenant_id = NEW.tenant_id AND code = COALESCE(_settings.variance_account_code,'6580') LIMIT 1;
  ELSE
    SELECT id INTO _other_acc FROM public.gl_accounts
      WHERE tenant_id = NEW.tenant_id AND code = '4010' LIMIT 1;
  END IF;

  IF _stock_acc IS NULL OR _other_acc IS NULL THEN RETURN NEW; END IF;

  _entry_number := 'JE-STK-' || to_char(now(),'YYYYMMDD') || '-' || substr(NEW.id::text,1,8);
  INSERT INTO public.journal_entries(tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES (NEW.tenant_id, _entry_number, COALESCE(NEW.movement_date, CURRENT_DATE),
          'Stock ' || NEW.movement_type || ' — ' || COALESCE(NEW.reference_type,''),
          'stock_movement', 'draft', NEW.created_by)
  RETURNING id INTO _entry_id;

  IF _is_in THEN
    INSERT INTO public.journal_lines(entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _stock_acc, _value, 0, 'DR Stock');
    INSERT INTO public.journal_lines(entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _other_acc, 0, _value, 'CR Contrepartie');
  ELSE
    INSERT INTO public.journal_lines(entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _other_acc, _value, 0, 'DR Contrepartie');
    INSERT INTO public.journal_lines(entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _stock_acc, 0, _value, 'CR Stock');
  END IF;

  UPDATE public.journal_entries SET status='posted', posted_by=NEW.created_by, posted_at=now() WHERE id=_entry_id;
  UPDATE public.stock_movements SET journal_entry_id = _entry_id WHERE id = NEW.id;
  RETURN NEW;
END $$;


--
-- Name: post_asset_disposal(uuid, date, text, numeric, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.post_asset_disposal(_asset_id uuid, _disposal_date date, _disposal_type text, _sale_price numeric, _notes text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_asset RECORD;
  v_cat RECORD;
  v_disposal_id uuid;
  v_je_id uuid;
  v_gain_loss numeric;
  v_tenant uuid;
BEGIN
  SELECT * INTO v_asset FROM public.assets WHERE id = _asset_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Asset not found'; END IF;
  v_tenant := v_asset.tenant_id;

  IF v_asset.status = 'disposed' THEN
    RAISE EXCEPTION 'Asset already disposed';
  END IF;

  SELECT * INTO v_cat FROM public.asset_categories WHERE id = v_asset.category_id;
  v_gain_loss := _sale_price - v_asset.net_book_value;

  -- JE: DR cash _sale_price, DR accumulated_depreciation, CR asset gross, CR/DR gain/loss
  INSERT INTO public.journal_entries (tenant_id, entry_date, reference, description, status, created_by)
  VALUES (v_tenant, _disposal_date, 'DISP-' || v_asset.asset_code,
          'Cession ' || v_asset.name, 'posted', auth.uid())
  RETURNING id INTO v_je_id;

  INSERT INTO public.asset_disposals (tenant_id, asset_id, disposal_date, disposal_type,
    sale_price, net_book_value_at_disposal, gain_loss, journal_entry_id, notes)
  VALUES (v_tenant, _asset_id, _disposal_date, _disposal_type, _sale_price,
          v_asset.net_book_value, v_gain_loss, v_je_id, _notes)
  RETURNING id INTO v_disposal_id;

  UPDATE public.assets
  SET status = 'disposed',
      disposal_date = _disposal_date,
      disposal_amount = _sale_price
  WHERE id = _asset_id;

  RETURN v_disposal_id;
END;
$$;


--
-- Name: post_delivery(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.post_delivery(_so_id uuid, _lines jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _s public.sales_orders%ROWTYPE;
  _dn_id uuid; _dn_number text;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _line jsonb; _so_line public.so_lines%ROWTYPE;
BEGIN
  IF NOT public.has_sales_perm(auth.uid(),'deliver') THEN RAISE EXCEPTION 'Permission denied'; END IF;
  SELECT * INTO _s FROM public.sales_orders WHERE id=_so_id;
  IF _s.tenant_id<>_tenant THEN RAISE EXCEPTION 'Tenant mismatch'; END IF;
  IF _s.status NOT IN ('confirmed','partially_delivered') THEN RAISE EXCEPTION 'SO must be confirmed'; END IF;

  _dn_number := 'DN-'||to_char(now(),'YYYY')||'-'||lpad((floor(random()*9999))::text,4,'0');
  INSERT INTO public.delivery_notes(tenant_id, dn_number, so_id, customer_id, delivery_date, status, created_by, delivered_by)
  VALUES (_tenant, _dn_number, _so_id, _s.customer_id, CURRENT_DATE, 'completed', auth.uid(), auth.uid())
  RETURNING id INTO _dn_id;

  FOR _line IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    SELECT * INTO _so_line FROM public.so_lines WHERE id=(_line->>'so_line_id')::uuid;
    INSERT INTO public.dn_lines(dn_id, so_line_id, item_id, description, quantity, unit_price)
    VALUES (_dn_id, _so_line.id, _so_line.item_id, _so_line.description, (_line->>'quantity')::numeric, _so_line.unit_price);

    UPDATE public.so_lines SET quantity_delivered = COALESCE(quantity_delivered,0)+(_line->>'quantity')::numeric WHERE id=_so_line.id;

    IF _so_line.item_id IS NOT NULL THEN
      UPDATE public.items SET quantity_on_hand = quantity_on_hand - (_line->>'quantity')::numeric WHERE id=_so_line.item_id;
      INSERT INTO public.stock_movements(tenant_id,item_id,movement_type,quantity,reference_type,reference_id,created_by)
      VALUES (_tenant,_so_line.item_id,'delivery',-(_line->>'quantity')::numeric,'delivery_note',_dn_id,auth.uid());
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM public.so_lines WHERE so_id=_so_id AND quantity_delivered < quantity) THEN
    UPDATE public.sales_orders SET status='delivered' WHERE id=_so_id;
  ELSE
    UPDATE public.sales_orders SET status='partially_delivered' WHERE id=_so_id;
  END IF;

  PERFORM public.notify_sales(_tenant,'info','Livraison enregistrée',_dn_number||' pour '||_s.so_number,_dn_id::text);
  RETURN _dn_id;
END $$;


--
-- Name: post_inventory_count(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.post_inventory_count(_count_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _c public.inventory_counts%ROWTYPE;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _line record;
BEGIN
  IF NOT public.has_inventory_perm(auth.uid(), 'post_count') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  SELECT * INTO _c FROM public.inventory_counts WHERE id = _count_id;
  IF _c.tenant_id <> _tenant THEN RAISE EXCEPTION 'Tenant mismatch'; END IF;
  IF _c.status = 'posted' THEN RAISE EXCEPTION 'Inventaire déjà validé'; END IF;

  FOR _line IN SELECT l.*, i.average_cost FROM public.inventory_count_lines l
                 JOIN public.items i ON i.id = l.item_id
                 WHERE l.count_id = _count_id AND l.counted_qty <> l.expected_qty
  LOOP
    INSERT INTO public.stock_movements(tenant_id, item_id, movement_type, quantity, unit_cost, warehouse_id, reference_type, reference_id, created_by, status)
    VALUES (_tenant, _line.item_id, 'adjustment', _line.counted_qty - _line.expected_qty,
            COALESCE(_line.unit_cost, _line.average_cost, 0), _c.warehouse_id, 'inventory_count', _count_id, auth.uid(), 'posted');
  END LOOP;

  UPDATE public.inventory_counts SET status='posted', posted_by=auth.uid(), posted_at=now() WHERE id=_count_id;
  PERFORM public.notify_inventory(_tenant, 'success', 'Inventaire validé', _c.count_number, _count_id::text);
END $$;


--
-- Name: post_monthly_depreciation(uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.post_monthly_depreciation(_tenant_id uuid, _period date) RETURNS TABLE(asset_id uuid, amount numeric, journal_entry_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  r RECORD;
  v_monthly numeric;
  v_remaining numeric;
  v_je_id uuid;
  v_period date := date_trunc('month', _period)::date;
BEGIN
  -- Reject if period locked
  IF EXISTS (
    SELECT 1 FROM public.period_locks
    WHERE tenant_id = _tenant_id
      AND period_date = v_period
      AND module IN ('GL','FIXED_ASSETS')
      AND is_locked = true
  ) THEN
    RAISE EXCEPTION 'Period % is locked for tenant %', v_period, _tenant_id;
  END IF;

  FOR r IN
    SELECT a.*, c.gl_depreciation_account_id, c.gl_expense_account_id
    FROM public.assets a
    LEFT JOIN public.asset_categories c ON c.id = a.category_id
    WHERE a.tenant_id = _tenant_id
      AND a.status = 'in_service'
      AND a.acquisition_date <= v_period
      AND a.net_book_value > a.salvage_value
      AND NOT EXISTS (
        SELECT 1 FROM public.depreciation_entries d
        WHERE d.asset_id = a.id AND d.period_date = v_period
      )
  LOOP
    -- Linear monthly depreciation
    v_monthly := round((r.acquisition_cost - r.salvage_value) / GREATEST(r.useful_life_months,1), 2);
    v_remaining := r.net_book_value - r.salvage_value;
    IF v_monthly > v_remaining THEN v_monthly := v_remaining; END IF;
    IF v_monthly <= 0 THEN CONTINUE; END IF;

    -- Create journal entry (header)
    INSERT INTO public.journal_entries (tenant_id, entry_date, reference, description, status, created_by)
    VALUES (_tenant_id, v_period, 'DEP-' || to_char(v_period,'YYYYMM') || '-' || r.asset_code,
            'Dotation amortissement ' || r.name, 'posted', auth.uid())
    RETURNING id INTO v_je_id;

    -- DR expense / CR accumulated depreciation
    IF r.gl_expense_account_id IS NOT NULL AND r.gl_depreciation_account_id IS NOT NULL THEN
      INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, description)
      VALUES
        (v_je_id, r.gl_expense_account_id, v_monthly, 0, 'Dotation ' || r.asset_code),
        (v_je_id, r.gl_depreciation_account_id, 0, v_monthly, 'Cumul amort ' || r.asset_code);
    END IF;

    -- Update asset
    UPDATE public.assets
    SET accumulated_depreciation = accumulated_depreciation + v_monthly,
        net_book_value = net_book_value - v_monthly
    WHERE id = r.id;

    -- Insert depreciation entry
    INSERT INTO public.depreciation_entries (asset_id, period_date, amount, accumulated, net_book_value, journal_entry_id)
    VALUES (r.id, v_period, v_monthly, r.accumulated_depreciation + v_monthly, r.net_book_value - v_monthly, v_je_id);

    asset_id := r.id;
    amount := v_monthly;
    journal_entry_id := v_je_id;
    RETURN NEXT;
  END LOOP;
END;
$$;


--
-- Name: post_payroll_run(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.post_payroll_run(_run_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _r public.payroll_runs%ROWTYPE;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _entry_id uuid; _entry_number text;
  _acc_salaires uuid; _acc_charges uuid;
  _acc_personnel uuid; _acc_cnps uuid; _acc_etat uuid;
  _gross numeric; _ded numeric; _tax numeric; _net numeric; _patronal numeric;
BEGIN
  IF NOT public.has_hr_perm(auth.uid(), 'execute_payroll') THEN
    RAISE EXCEPTION 'Permission refusée: rôle Officier de Paie requis';
  END IF;
  SELECT * INTO _r FROM public.payroll_runs WHERE id=_run_id;
  IF _r.tenant_id IS NULL OR _r.tenant_id <> _tenant THEN RAISE EXCEPTION 'Cycle introuvable'; END IF;
  IF _r.status = 'posted' THEN RAISE EXCEPTION 'Cycle déjà comptabilisé'; END IF;
  IF _r.status <> 'approved' THEN RAISE EXCEPTION 'Le cycle doit être approuvé avant comptabilisation'; END IF;

  SELECT COALESCE(SUM(gross),0), COALESCE(SUM(deductions),0),
         COALESCE(SUM(taxes),0), COALESCE(SUM(net),0)
    INTO _gross, _ded, _tax, _net FROM public.payroll_lines WHERE run_id=_run_id;
  IF _gross <= 0 THEN RAISE EXCEPTION 'Cycle vide — aucune ligne à comptabiliser'; END IF;
  _patronal := ROUND(_gross * 0.164, 2);

  SELECT id INTO _acc_salaires  FROM public.gl_accounts WHERE tenant_id=_tenant AND code='6610' LIMIT 1;
  SELECT id INTO _acc_charges   FROM public.gl_accounts WHERE tenant_id=_tenant AND code='6630' LIMIT 1;
  SELECT id INTO _acc_personnel FROM public.gl_accounts WHERE tenant_id=_tenant AND code='4210' LIMIT 1;
  SELECT id INTO _acc_cnps      FROM public.gl_accounts WHERE tenant_id=_tenant AND code='4310' LIMIT 1;
  SELECT id INTO _acc_etat      FROM public.gl_accounts WHERE tenant_id=_tenant AND code='4470' LIMIT 1;

  IF _acc_salaires IS NULL OR _acc_personnel IS NULL THEN
    RAISE EXCEPTION 'Comptes GL paie manquants (6610 Salaires / 4210 Personnel). Configurez le plan SYSCOHADA.';
  END IF;

  _entry_number := 'JE-PAY-'||_r.period||'-'||substr(_run_id::text,1,8);

  INSERT INTO public.journal_entries(tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES (_tenant, _entry_number, _r.pay_date, 'Paie '||_r.period, 'payroll', 'draft', auth.uid())
  RETURNING id INTO _entry_id;

  -- DR
  INSERT INTO public.journal_lines(entry_id, account_id, debit, credit, description)
  VALUES (_entry_id, _acc_salaires, _gross + CASE WHEN _acc_charges IS NULL THEN _patronal ELSE 0 END, 0, 'DR Salaires bruts');

  IF _acc_charges IS NOT NULL AND _patronal > 0 THEN
    INSERT INTO public.journal_lines(entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _acc_charges, _patronal, 0, 'DR Charges patronales');
  END IF;

  -- CR Personnel
  INSERT INTO public.journal_lines(entry_id, account_id, debit, credit, description)
  VALUES (_entry_id, _acc_personnel, 0, _net, 'CR Personnel — rémunérations dues');

  -- CR CNPS — fallback vers Personnel si compte absent
  IF (_ded + _patronal) > 0 THEN
    IF _acc_cnps IS NOT NULL THEN
      INSERT INTO public.journal_lines(entry_id, account_id, debit, credit, description)
      VALUES (_entry_id, _acc_cnps, 0, _ded + _patronal, 'CR Organismes sociaux (CNPS)');
    ELSE
      UPDATE public.journal_lines SET credit = credit + (_ded + _patronal)
        WHERE entry_id=_entry_id AND account_id=_acc_personnel;
    END IF;
  END IF;

  -- CR État — fallback vers Personnel si compte absent
  IF _tax > 0 THEN
    IF _acc_etat IS NOT NULL THEN
      INSERT INTO public.journal_lines(entry_id, account_id, debit, credit, description)
      VALUES (_entry_id, _acc_etat, 0, _tax, 'CR État — impôt sur salaires');
    ELSE
      UPDATE public.journal_lines SET credit = credit + _tax
        WHERE entry_id=_entry_id AND account_id=_acc_personnel;
    END IF;
  END IF;

  UPDATE public.journal_entries SET status='posted', posted_by=auth.uid(), posted_at=now()
    WHERE id=_entry_id;

  UPDATE public.payroll_runs
     SET status='posted', executed_by=auth.uid(), executed_at=now(),
         notes = COALESCE(notes,'')||' | JE='||_entry_number
   WHERE id=_run_id;

  RETURN _entry_id;
END $$;


--
-- Name: protect_posted_entry(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_posted_entry() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'posted'
     AND NEW.status NOT IN ('posted','reversed','cancelled') THEN
    RAISE EXCEPTION 'JE %: a posted entry can only be reversed or cancelled', OLD.entry_number;
  END IF;
  IF TG_OP = 'DELETE' AND OLD.status = 'posted' THEN
    RAISE EXCEPTION 'JE %: posted entries cannot be deleted (use reversal)', OLD.entry_number;
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$;


--
-- Name: protect_posted_lines(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_posted_lines() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  _status text;
BEGIN
  SELECT status INTO _status FROM public.journal_entries
   WHERE id = COALESCE(NEW.entry_id, OLD.entry_id);
  IF _status = 'posted' THEN
    RAISE EXCEPTION 'Cannot modify lines of a posted journal entry';
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$;


--
-- Name: recompute_ap_invoice_from_payment(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recompute_ap_invoice_from_payment() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _inv_id uuid; _total numeric; _paid numeric; _due date;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.payment_type <> 'ap_payment' OR OLD.ap_invoice_id IS NULL THEN RETURN OLD; END IF;
    _inv_id := OLD.ap_invoice_id;
  ELSE
    IF NEW.payment_type <> 'ap_payment' OR NEW.ap_invoice_id IS NULL THEN RETURN NEW; END IF;
    _inv_id := NEW.ap_invoice_id;
  END IF;

  SELECT total, due_date INTO _total, _due FROM public.ap_invoices WHERE id = _inv_id;
  SELECT COALESCE(SUM(amount),0) INTO _paid FROM public.payments
   WHERE ap_invoice_id = _inv_id AND payment_type = 'ap_payment';

  UPDATE public.ap_invoices
  SET amount_paid = _paid,
      status = CASE
        WHEN _paid >= _total THEN 'paid'
        WHEN _paid > 0 THEN 'partially_paid'
        WHEN _due IS NOT NULL AND _due < CURRENT_DATE THEN 'overdue'
        ELSE status
      END
  WHERE id = _inv_id;

  RETURN COALESCE(NEW, OLD);
END; $$;


--
-- Name: recompute_ar_invoice_from_payment(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recompute_ar_invoice_from_payment() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _inv_id uuid; _total numeric; _paid numeric; _due date;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.payment_type <> 'ar_receipt' OR OLD.ar_invoice_id IS NULL THEN RETURN OLD; END IF;
    _inv_id := OLD.ar_invoice_id;
  ELSE
    IF NEW.payment_type <> 'ar_receipt' OR NEW.ar_invoice_id IS NULL THEN RETURN NEW; END IF;
    _inv_id := NEW.ar_invoice_id;
  END IF;

  SELECT total, due_date INTO _total, _due FROM public.ar_invoices WHERE id = _inv_id;
  SELECT COALESCE(SUM(amount),0) INTO _paid FROM public.payments
   WHERE ar_invoice_id = _inv_id AND payment_type = 'ar_receipt';

  UPDATE public.ar_invoices
  SET amount_paid = _paid,
      status = CASE
        WHEN _paid >= _total THEN 'paid'
        WHEN _paid > 0 THEN 'partially_paid'
        WHEN _due IS NOT NULL AND _due < CURRENT_DATE THEN 'overdue'
        ELSE status
      END
  WHERE id = _inv_id;

  RETURN COALESCE(NEW, OLD);
END; $$;


--
-- Name: recompute_po_total(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recompute_po_total() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE _po uuid;
BEGIN
  _po := COALESCE(NEW.po_id, OLD.po_id);
  UPDATE public.purchase_orders
    SET total = (SELECT COALESCE(SUM(total),0) FROM public.po_lines WHERE po_id = _po)
    WHERE id = _po;
  RETURN COALESCE(NEW, OLD);
END; $$;


--
-- Name: recompute_pr_total(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recompute_pr_total() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE _pr uuid;
BEGIN
  _pr := COALESCE(NEW.requisition_id, OLD.requisition_id);
  UPDATE public.purchase_requisitions
    SET estimated_total = (SELECT COALESCE(SUM(total),0) FROM public.requisition_lines WHERE requisition_id = _pr)
    WHERE id = _pr;
  RETURN COALESCE(NEW, OLD);
END; $$;


--
-- Name: recompute_quote_total(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recompute_quote_total() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE _q uuid;
BEGIN
  _q := COALESCE(NEW.quotation_id, OLD.quotation_id);
  UPDATE public.quotations SET total=(SELECT COALESCE(SUM(total),0) FROM public.quote_lines WHERE quotation_id=_q) WHERE id=_q;
  RETURN COALESCE(NEW,OLD);
END $$;


--
-- Name: recompute_so_total(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recompute_so_total() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE _s uuid;
BEGIN
  _s := COALESCE(NEW.so_id, OLD.so_id);
  UPDATE public.sales_orders SET total=(SELECT COALESCE(SUM(total),0) FROM public.so_lines WHERE so_id=_s) WHERE id=_s;
  RETURN COALESCE(NEW,OLD);
END $$;


--
-- Name: record_match_decision(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_match_decision(_po_id uuid, _decision text, _reason text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
END; $$;


--
-- Name: reject_procurement_step(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_procurement_step(_approval_id uuid, _comment text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
END; $$;


--
-- Name: reopen_gl_period(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reopen_gl_period(_period text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'No tenant'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators can reopen GL periods';
  END IF;

  UPDATE public.period_locks
     SET status = 'open', closed_by = NULL, closed_at = NULL
   WHERE tenant_id = _tenant AND module = 'GL' AND period = _period;
END; $$;


--
-- Name: resolve_all_erp_alerts(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resolve_all_erp_alerts(_module text DEFAULT NULL::text, _severity text DEFAULT NULL::text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_tenant uuid;
  v_count integer;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = auth.uid();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No tenant'; END IF;

  -- Restrict bulk resolve to admins
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;

  UPDATE public.erp_alerts
     SET is_resolved = true,
         resolved_at = now(),
         resolved_by = auth.uid()
   WHERE tenant_id = v_tenant
     AND is_resolved = false
     AND (_module IS NULL OR module = _module)
     AND (_severity IS NULL OR severity = _severity);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END; $$;


--
-- Name: resolve_erp_alert(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resolve_erp_alert(_alert_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.erp_alerts WHERE id = _alert_id;
  IF v_tenant IS NULL THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_role_assignments
    WHERE user_id = auth.uid() AND tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.erp_alerts
     SET is_resolved = true,
         resolved_at = now(),
         resolved_by = auth.uid()::text
   WHERE id = _alert_id;
  RETURN true;
END $$;


--
-- Name: reverse_journal_entry(uuid, date, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reverse_journal_entry(_entry_id uuid, _reverse_date date DEFAULT CURRENT_DATE, _reason text DEFAULT 'Contre-passation'::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _src public.journal_entries%ROWTYPE;
  _new_id uuid;
  _new_number text;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  SELECT * INTO _src FROM public.journal_entries WHERE id = _entry_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entry not found'; END IF;
  IF _src.tenant_id <> _tenant THEN RAISE EXCEPTION 'Tenant mismatch'; END IF;
  IF _src.status <> 'posted' THEN
    RAISE EXCEPTION 'Only posted entries can be reversed (status=%)', _src.status;
  END IF;

  _new_number := 'REV-' || _src.entry_number || '-' || to_char(now(),'YYYYMMDDHH24MISS');

  INSERT INTO public.journal_entries
    (tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES
    (_src.tenant_id, _new_number, _reverse_date,
     'Reversal of '||_src.entry_number||' — '||COALESCE(_reason,''),
     'reversal', 'draft', auth.uid())
  RETURNING id INTO _new_id;

  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  SELECT _new_id, jl.account_id, jl.credit, jl.debit,
         'Reversal: '||COALESCE(jl.description,'')
    FROM public.journal_lines jl
   WHERE jl.entry_id = _src.id;

  UPDATE public.journal_entries
     SET status='posted', posted_by=auth.uid(), posted_at=now()
   WHERE id = _new_id;

  UPDATE public.journal_entries
     SET status='reversed'
   WHERE id = _src.id;

  RETURN _new_id;
END; $$;


--
-- Name: seed_ap_defaults(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seed_ap_defaults(_tenant_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.ap_general_settings(tenant_id) VALUES (_tenant_id) ON CONFLICT DO NOTHING;

  INSERT INTO public.ap_numbering_series(tenant_id, doc_type, prefix, format) VALUES
    (_tenant_id, 'Supplier Invoice', 'APINV-', 'APINV-YYYY-####'),
    (_tenant_id, 'Credit Note', 'APCN-', 'APCN-YYYY-####'),
    (_tenant_id, 'Payment', 'APPAY-', 'APPAY-YYYY-####')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.ap_payment_methods(tenant_id, code, label, is_default, is_active) VALUES
    (_tenant_id, 'WIRE', 'Virement bancaire', true, true),
    (_tenant_id, 'CHECK', 'Chèque', false, true),
    (_tenant_id, 'LC', 'Lettre de crédit', false, true),
    (_tenant_id, 'CASH', 'Espèces', false, false)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.ap_withholding_rates(tenant_id, category, rate_pct, gl_account, is_active) VALUES
    (_tenant_id, 'Services (BIC)', 7.5, '4471', true),
    (_tenant_id, 'Loyers', 15, '4472', true),
    (_tenant_id, 'Non-résidents', 20, '4473', true),
    (_tenant_id, 'Dividendes', 10, '4474', false);

  INSERT INTO public.ap_notification_rules(tenant_id, event, channel, recipients) VALUES
    (_tenant_id, 'Facture en attente > 48h', 'email', 'AP Manager'),
    (_tenant_id, 'Échéance dans 3 jours', 'email,inapp', 'AP Clerk, Treasury'),
    (_tenant_id, 'Paiement > 50M XOF', 'inapp', 'CFO'),
    (_tenant_id, 'Échec 3-way match', 'email', 'AP Manager');

  INSERT INTO public.ap_approval_thresholds(tenant_id, level, max_amount, approver, sla_hours, doc_types) VALUES
    (_tenant_id, 'L1 — Clerk', 5000000, 'AP Clerk', 4, 'Facture, Avoir'),
    (_tenant_id, 'L2 — Manager', 20000000, 'AP Manager', 24, 'Facture, Paiement'),
    (_tenant_id, 'L3 — Director', 50000000, 'Finance Director', 48, 'Paiement, Contrat'),
    (_tenant_id, 'L4 — CFO', NULL, 'CFO', 72, 'Tous au-dessus du seuil')
  ON CONFLICT DO NOTHING;
END;
$$;


--
-- Name: seed_ar_defaults(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seed_ar_defaults() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.ar_payment_terms (tenant_id, code, label, days, discount_percent) VALUES
    (NEW.id, 'NET30', 'Net 30', 30, 0),
    (NEW.id, 'NET60', 'Net 60', 60, 0),
    (NEW.id, '2/10N30', '2% 10 Net 30', 30, 2),
    (NEW.id, 'COD', 'Cash on Delivery', 0, 0)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.ar_numbering_series (tenant_id, doc_type, prefix, format) VALUES
    (NEW.id, 'invoice', 'INV-', 'INV-YYYY-####'),
    (NEW.id, 'credit_note', 'CN-', 'CN-YYYY-####'),
    (NEW.id, 'receipt', 'REC-', 'REC-YYYY-####'),
    (NEW.id, 'adjustment', 'ADJ-', 'ADJ-YYYY-####')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.ar_dunning_rules (tenant_id, level, days_overdue, action, fee_amount, template) VALUES
    (NEW.id, 1, 7, 'Email reminder', 0, 'Friendly reminder'),
    (NEW.id, 2, 30, 'Formal letter', 15000, 'First notice'),
    (NEW.id, 3, 60, 'Phone + letter', 50000, 'Final notice'),
    (NEW.id, 4, 90, 'Legal action', 150000, 'Legal warning')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.ar_general_settings (tenant_id) VALUES (NEW.id)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END; $$;


--
-- Name: seed_inventory_defaults(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seed_inventory_defaults() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.inventory_settings(tenant_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  INSERT INTO public.warehouses(tenant_id, code, name, is_default)
  VALUES (NEW.id, 'MAIN', 'Entrepôt principal', true) ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;


--
-- Name: seed_procurement_approval_queue(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seed_procurement_approval_queue() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _doc_type text;
  _amount numeric;
  _t public.procurement_approval_thresholds%ROWTYPE;
  _order int := 1;
BEGIN
  IF TG_TABLE_NAME = 'purchase_requisitions' THEN
    _doc_type := 'PR'; _amount := COALESCE(NEW.estimated_total, 0);
  ELSE
    _doc_type := 'PO'; _amount := COALESCE(NEW.total, 0);
  END IF;

  -- Only seed when entering pending_approval and queue empty
  IF NEW.status <> 'pending_approval' THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.procurement_approvals WHERE doc_type=_doc_type AND doc_id=NEW.id) THEN
    RETURN NEW;
  END IF;

  FOR _t IN
    SELECT * FROM public.procurement_approval_thresholds
     WHERE tenant_id = NEW.tenant_id AND doc_type = _doc_type
     ORDER BY max_amount NULLS LAST
  LOOP
    INSERT INTO public.procurement_approvals
      (tenant_id, doc_type, doc_id, level_order, level_label, approver_role, sla_hours, sla_due_at, amount)
    VALUES
      (NEW.tenant_id, _doc_type, NEW.id, _order, _t.level, _t.approver, _t.sla_hours,
       now() + (_t.sla_hours || ' hours')::interval, _amount);
    _order := _order + 1;
    -- Stop at the threshold that covers the amount (NULL = top tier)
    IF _t.max_amount IS NULL OR _amount <= _t.max_amount THEN EXIT; END IF;
  END LOOP;

  PERFORM public.notify_procurement(
    NEW.tenant_id, 'info',
    _doc_type || ' assignée pour approbation',
    'Document ' || COALESCE(CASE WHEN _doc_type='PR' THEN NEW.pr_number ELSE NEW.po_number END,'') || ' en file d''attente.',
    NEW.id::text);
  RETURN NEW;
END; $$;


--
-- Name: seed_procurement_defaults(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seed_procurement_defaults() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.procurement_settings (tenant_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  INSERT INTO public.procurement_approval_thresholds (tenant_id, doc_type, level, max_amount, approver, sla_hours) VALUES
    (NEW.id, 'PR', 'L1 — Manager', 2000000, 'Department Manager', 24),
    (NEW.id, 'PR', 'L2 — Director', 10000000, 'Procurement Director', 48),
    (NEW.id, 'PR', 'L3 — CFO', NULL, 'CFO', 72),
    (NEW.id, 'PO', 'L1 — Buyer', 5000000, 'Senior Buyer', 24),
    (NEW.id, 'PO', 'L2 — Procurement Mgr', 25000000, 'Procurement Manager', 48),
    (NEW.id, 'PO', 'L3 — CFO', NULL, 'CFO', 72)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;


--
-- Name: seed_sales_defaults(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seed_sales_defaults() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.sales_settings(tenant_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;


--
-- Name: suggest_bank_matches(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.suggest_bank_matches(p_line_id uuid) RETURNS TABLE(transaction_id uuid, transaction_date date, description text, amount numeric, score numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_tenant uuid;
  v_account uuid;
  v_amount numeric;
  v_date date;
  v_tol numeric := 0;
  v_window int := 3;
BEGIN
  SELECT l.tenant_id, s.bank_account_id, l.amount, l.line_date
    INTO v_tenant, v_account, v_amount, v_date
  FROM public.bank_statement_lines l
  JOIN public.bank_statements s ON s.id = l.statement_id
  WHERE l.id = p_line_id;

  IF v_tenant IS NULL OR v_tenant <> public.get_user_tenant_id(auth.uid()) THEN
    RETURN;
  END IF;

  SELECT ts.match_amount_tolerance, ts.match_date_window_days
    INTO v_tol, v_window
  FROM public.treasury_settings ts WHERE ts.tenant_id = v_tenant;
  v_tol := COALESCE(v_tol, 0);
  v_window := COALESCE(v_window, 3);

  RETURN QUERY
  SELECT t.id, t.transaction_date, t.description, t.amount,
    (100 - LEAST(100, ABS(t.amount - v_amount)::numeric)
        - LEAST(50, ABS(t.transaction_date - v_date) * 5))::numeric AS score
  FROM public.bank_transactions t
  WHERE t.tenant_id = v_tenant
    AND t.bank_account_id = v_account
    AND t.is_reconciled = false
    AND ABS(t.amount - v_amount) <= GREATEST(v_tol, 0.01)
    AND ABS(t.transaction_date - v_date) <= v_window
  ORDER BY score DESC
  LIMIT 10;
END $$;


--
-- Name: touch_ai_schedules_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_ai_schedules_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


--
-- Name: touch_notification_preferences(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_notification_preferences() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;


--
-- Name: touch_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;


--
-- Name: transfer_stock(uuid, uuid, uuid, numeric, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.transfer_stock(_item_id uuid, _from_wh uuid, _to_wh uuid, _qty numeric, _notes text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid()); _avg numeric;
BEGIN
  IF NOT public.has_inventory_perm(auth.uid(), 'transfer') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  IF _qty <= 0 THEN RAISE EXCEPTION 'Quantité doit être > 0'; END IF;
  IF _from_wh = _to_wh THEN RAISE EXCEPTION 'Entrepôts identiques'; END IF;

  SELECT average_cost INTO _avg FROM public.items WHERE id = _item_id;

  INSERT INTO public.stock_movements(tenant_id, item_id, movement_type, quantity, unit_cost, warehouse_id, reference_type, created_by, status)
  VALUES (_tenant, _item_id, 'transfer_out', -_qty, COALESCE(_avg,0), _from_wh, 'transfer', auth.uid(), 'posted');
  INSERT INTO public.stock_movements(tenant_id, item_id, movement_type, quantity, unit_cost, warehouse_id, reference_type, created_by, status)
  VALUES (_tenant, _item_id, 'transfer_in',  _qty, COALESCE(_avg,0), _to_wh,   'transfer', auth.uid(), 'posted');

  PERFORM public.notify_inventory(_tenant, 'info', 'Transfert stock', _qty || ' unités déplacées', _item_id::text);
END $$;


--
-- Name: trg_bank_recon_validated(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_bank_recon_validated() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.status = 'validated' AND (OLD.status IS DISTINCT FROM 'validated') THEN
    UPDATE public.bank_accounts SET last_reconciled_at = NEW.period_end WHERE id = NEW.bank_account_id;
    NEW.validated_at := COALESCE(NEW.validated_at, now());
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;


--
-- Name: trg_bsl_match_sync(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_bsl_match_sync() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.matched_transaction_id IS NOT NULL AND (OLD.matched_transaction_id IS DISTINCT FROM NEW.matched_transaction_id) THEN
    UPDATE public.bank_transactions SET is_reconciled = true WHERE id = NEW.matched_transaction_id;
    NEW.matched_at := COALESCE(NEW.matched_at, now());
  ELSIF NEW.matched_transaction_id IS NULL AND OLD.matched_transaction_id IS NOT NULL THEN
    UPDATE public.bank_transactions SET is_reconciled = false WHERE id = OLD.matched_transaction_id;
    NEW.matched_at := NULL;
  END IF;
  RETURN NEW;
END $$;


--
-- Name: validate_ap_invoice(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_ap_invoice() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.total := ROUND((COALESCE(NEW.subtotal,0) + COALESCE(NEW.tax_amount,0))::numeric, 2);
  IF NEW.amount_paid > NEW.total THEN
    RAISE EXCEPTION 'AP Invoice %: amount_paid (%) > total (%)', NEW.invoice_number, NEW.amount_paid, NEW.total;
  END IF;
  RETURN NEW;
END; $$;


--
-- Name: validate_ar_invoice(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_ar_invoice() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.total := ROUND((COALESCE(NEW.subtotal,0) + COALESCE(NEW.tax_amount,0))::numeric, 2);
  IF NEW.amount_paid > NEW.total THEN
    RAISE EXCEPTION 'AR Invoice %: amount_paid (%) > total (%)', NEW.invoice_number, NEW.amount_paid, NEW.total;
  END IF;
  RETURN NEW;
END; $$;


--
--


