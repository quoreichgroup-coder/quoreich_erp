-- V39 — Cycle de vie des demandes d'achat et des commandes, paramètres appliqués, séparation des
-- tâches (Lot 3, étape 2). Écrit à la main.
--
-- Constaté le 14 nov. 2026 (audit des paramètres demandé par le propriétaire : « tient compte des
-- règles de paramétrage dans chaque module ») :
--   - le bouton « Approve » passait le statut de « draft » à « approved » par une simple mise à
--     jour : la file d'approbation par seuils (procurement_approvals) n'était jamais utilisée ;
--   - approve_procurement_step acceptait n'importe quel niveau dans n'importe quel ordre et laissait
--     le saisisseur approuver son propre document ; aucun rejet n'existait ;
--   - « demande d'achat obligatoire avant commande » (procurement_settings.require_pr_before_po)
--     n'était lu par personne ; une pièce se modifiait ou se supprimait à tout moment.
--
-- Cycle (SAP : stratégie de libération ; Sage X3 : circuits de signature) :
--   brouillon → soumis (« pending_approval », file créée selon les seuils de la société)
--     → approuvé niveau par niveau, dans l'ordre → « approved »
--     → ou rejeté (motif obligatoire) → « rejected », de nouveau modifiable, puis resoumis ;
--   annulation (« cancelled », motif) : demande non convertie, commande sans réception validée.
-- Règles :
--   - chaque niveau demande le droit du catalogue procurement.approve_l<n> (n plafonné à 3) ;
--   - le saisisseur (demandeur, auteur de la commande) n'approuve JAMAIS son document, même
--     administrateur, et une même personne ne valide pas deux niveaux du même document ;
--   - commande : si la société exige une demande préalable, la soumission est refusée (QG007) pour
--     une commande qui ne vient pas d'une demande convertie ;
--   - sans seuil défini pour le type de pièce, un niveau unique « L1 » est créé ;
--   - côté utilisateur (rôles authenticated / qerp_api), un statut ne change QUE par ces
--     fonctions ; en-tête et lignes ne se modifient et ne se suppriment qu'en brouillon ou rejeté.
--
-- Jumelle : supabase/migrations/20261114120000_2a6e9c4f-7d1b-4e3a-8c5f-1b0d7e4a9c62.sql

CREATE FUNCTION public.procurement_doc(_doc_type text, _doc_id uuid,
    OUT tenant_id uuid, OUT status text, OUT creator uuid, OUT number text, OUT amount numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF _doc_type = 'PR' THEN
    SELECT r.tenant_id, r.status, r.requested_by, r.pr_number, COALESCE(r.estimated_total, 0)
      INTO tenant_id, status, creator, number, amount
      FROM public.purchase_requisitions r WHERE r.id = _doc_id;
  ELSIF _doc_type = 'PO' THEN
    SELECT p.tenant_id, p.status, p.created_by, p.po_number, COALESCE(p.total, 0)
      INTO tenant_id, status, creator, number, amount
      FROM public.purchase_orders p WHERE p.id = _doc_id;
  ELSE
    RAISE EXCEPTION 'Type de pièce inconnu : % (PR ou PO)', _doc_type USING ERRCODE = '22023';
  END IF;
  IF tenant_id IS NULL OR tenant_id IS DISTINCT FROM public.get_user_tenant_id(auth.uid()) THEN
    RAISE EXCEPTION 'Pièce introuvable dans la société' USING ERRCODE = '22023';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.procurement_doc(text, uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.procurement_set_status(_doc_type text, _doc_id uuid, _status text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF _doc_type = 'PR' THEN
    UPDATE public.purchase_requisitions SET status = _status,
           approved_by = CASE WHEN _status = 'approved' THEN auth.uid() ELSE approved_by END,
           approved_at = CASE WHEN _status = 'approved' THEN now() ELSE approved_at END
     WHERE id = _doc_id;
  ELSE
    UPDATE public.purchase_orders SET status = _status,
           approved_by = CASE WHEN _status = 'approved' THEN auth.uid() ELSE approved_by END
     WHERE id = _doc_id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.procurement_set_status(text, uuid, text) FROM PUBLIC, anon, authenticated;

-- ─── Soumission ───
CREATE FUNCTION public.procurement_submit(_doc_type text, _doc_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _d record;
  _lines integer;
  _levels integer;
BEGIN
  SELECT * INTO _d FROM public.procurement_doc(_doc_type, _doc_id);
  IF _d.status NOT IN ('draft', 'rejected') THEN
    RAISE EXCEPTION 'La pièce % est « % » : seule une pièce en brouillon ou rejetée se soumet', _d.number, _d.status
      USING ERRCODE = 'QG007';
  END IF;
  IF _doc_type = 'PR' THEN
    SELECT count(*) INTO _lines FROM public.requisition_lines WHERE requisition_id = _doc_id;
  ELSE
    SELECT count(*) INTO _lines FROM public.po_lines WHERE po_id = _doc_id;
    IF COALESCE((SELECT s.require_pr_before_po FROM public.procurement_settings s WHERE s.tenant_id = _d.tenant_id), false)
       AND NOT EXISTS (SELECT 1 FROM public.purchase_requisitions r WHERE r.po_id = _doc_id) THEN
      RAISE EXCEPTION 'La société exige une demande d''achat avant toute commande : la commande % doit venir d''une demande convertie',
        _d.number USING ERRCODE = 'QG007',
        HINT = 'Paramètres des achats : « demande obligatoire avant commande ».';
    END IF;
  END IF;
  IF _lines = 0 THEN
    RAISE EXCEPTION 'La pièce % n''a aucune ligne' , _d.number USING ERRCODE = 'QG007';
  END IF;

  -- Une resoumission repart d'une file vierge.
  DELETE FROM public.procurement_approvals WHERE doc_type = _doc_type AND doc_id = _doc_id;
  PERFORM public.procurement_set_status(_doc_type, _doc_id, 'pending_approval');   -- seed_procurement_approval_queue

  SELECT count(*) INTO _levels FROM public.procurement_approvals WHERE doc_type = _doc_type AND doc_id = _doc_id;
  IF _levels = 0 THEN
    INSERT INTO public.procurement_approvals (tenant_id, doc_type, doc_id, level_order, level_label, approver_role,
                                              sla_hours, sla_due_at, amount)
    VALUES (_d.tenant_id, _doc_type, _doc_id, 1, 'L1', 'Approbateur niveau 1', 24, now() + interval '24 hours', _d.amount);
    _levels := 1;
  END IF;
  RETURN _levels;
END $$;
REVOKE ALL ON FUNCTION public.procurement_submit(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.procurement_submit(text, uuid) TO authenticated;

-- ─── Approbation d'un niveau : dans l'ordre, par un tiers habilité ───
CREATE OR REPLACE FUNCTION public.approve_procurement_step(_approval_id uuid, _comment text DEFAULT NULL) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _a public.procurement_approvals%ROWTYPE;
  _d record;
  _perm text;
BEGIN
  SELECT * INTO _a FROM public.procurement_approvals WHERE id = _approval_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Étape d''approbation introuvable' USING ERRCODE = '22023'; END IF;
  SELECT * INTO _d FROM public.procurement_doc(_a.doc_type, _a.doc_id);
  IF _a.status <> 'pending' OR _d.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'Étape % déjà décidée ou pièce % non soumise', _a.level_label, _d.number USING ERRCODE = 'QG007';
  END IF;
  IF EXISTS (SELECT 1 FROM public.procurement_approvals x WHERE x.doc_type = _a.doc_type AND x.doc_id = _a.doc_id
               AND x.status = 'pending' AND x.level_order < _a.level_order) THEN
    RAISE EXCEPTION 'Les niveaux précédents de la pièce % ne sont pas encore approuvés', _d.number USING ERRCODE = 'QG007';
  END IF;
  IF auth.uid() = _d.creator THEN
    RAISE EXCEPTION 'Séparation des tâches : vous ne pouvez pas approuver la pièce % que vous avez saisie', _d.number
      USING ERRCODE = 'QG007';
  END IF;
  IF EXISTS (SELECT 1 FROM public.procurement_approvals x WHERE x.doc_type = _a.doc_type AND x.doc_id = _a.doc_id
               AND x.status = 'approved' AND x.decided_by = auth.uid()) THEN
    RAISE EXCEPTION 'Séparation des tâches : vous avez déjà approuvé un niveau de la pièce %', _d.number USING ERRCODE = 'QG007';
  END IF;
  _perm := 'procurement.approve_l' || least(_a.level_order, 3)::text;
  IF NOT public.has_permission(auth.uid(), _perm) THEN
    RAISE EXCEPTION 'Droit insuffisant : le niveau % (%) demande le droit %', _a.level_label, _a.approver_role, _perm
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.procurement_approvals SET status = 'approved', decided_by = auth.uid(), decided_at = now(),
         comment = NULLIF(btrim(_comment), '')
   WHERE id = _approval_id;

  IF NOT EXISTS (SELECT 1 FROM public.procurement_approvals x WHERE x.doc_type = _a.doc_type AND x.doc_id = _a.doc_id
                   AND x.status = 'pending') THEN
    PERFORM public.procurement_set_status(_a.doc_type, _a.doc_id, 'approved');
    PERFORM public.notify_procurement(_a.tenant_id, 'success', _a.doc_type || ' approuvée',
      'Pièce ' || COALESCE(_d.number, '') || ' entièrement approuvée.', _a.doc_id::text);
  ELSE
    PERFORM public.notify_procurement(_a.tenant_id, 'info', _a.level_label || ' approuvé',
      'Étape franchie pour ' || COALESCE(_d.number, ''), _a.doc_id::text);
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.approve_procurement_step(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_procurement_step(uuid, text) TO authenticated;

-- ─── Rejet : motif obligatoire, la pièce redevient modifiable (signature existante conservée) ───
CREATE OR REPLACE FUNCTION public.reject_procurement_step(_approval_id uuid, _comment text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _a public.procurement_approvals%ROWTYPE;
  _d record;
BEGIN
  IF _comment IS NULL OR btrim(_comment) = '' THEN
    RAISE EXCEPTION 'Motif de rejet obligatoire' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO _a FROM public.procurement_approvals WHERE id = _approval_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Étape d''approbation introuvable' USING ERRCODE = '22023'; END IF;
  SELECT * INTO _d FROM public.procurement_doc(_a.doc_type, _a.doc_id);
  IF _a.status <> 'pending' OR _d.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'Étape % déjà décidée ou pièce % non soumise', _a.level_label, _d.number USING ERRCODE = 'QG007';
  END IF;
  IF auth.uid() = _d.creator THEN
    RAISE EXCEPTION 'Séparation des tâches : vous ne pouvez pas décider de la pièce % que vous avez saisie', _d.number
      USING ERRCODE = 'QG007';
  END IF;
  IF NOT public.has_permission(auth.uid(), 'procurement.approve_l' || least(_a.level_order, 3)::text) THEN
    RAISE EXCEPTION 'Droit insuffisant pour décider du niveau %', _a.level_label USING ERRCODE = '42501';
  END IF;

  UPDATE public.procurement_approvals SET status = 'rejected', decided_by = auth.uid(), decided_at = now(),
         comment = btrim(_comment)
   WHERE id = _approval_id;
  UPDATE public.procurement_approvals SET status = 'skipped', decided_at = now()
   WHERE doc_type = _a.doc_type AND doc_id = _a.doc_id AND status = 'pending';
  PERFORM public.procurement_set_status(_a.doc_type, _a.doc_id, 'rejected');
  PERFORM public.notify_procurement(_a.tenant_id, 'warning', _a.doc_type || ' rejetée',
    'Pièce ' || COALESCE(_d.number, '') || ' rejetée : ' || btrim(_comment), _a.doc_id::text);
END $$;
REVOKE ALL ON FUNCTION public.reject_procurement_step(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_procurement_step(uuid, text) TO authenticated;

-- ─── Annulation ───
CREATE FUNCTION public.procurement_cancel(_doc_type text, _doc_id uuid, _reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _d record;
BEGIN
  SELECT * INTO _d FROM public.procurement_doc(_doc_type, _doc_id);
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'Motif d''annulation obligatoire' USING ERRCODE = '22023';
  END IF;
  IF auth.uid() IS DISTINCT FROM _d.creator AND NOT public.has_permission(auth.uid(), 'procurement.approve_l1') THEN
    RAISE EXCEPTION 'Seul l''auteur ou un approbateur annule la pièce %', _d.number USING ERRCODE = '42501';
  END IF;
  IF _doc_type = 'PR' THEN
    IF _d.status NOT IN ('draft', 'pending_approval', 'rejected', 'approved')
       OR EXISTS (SELECT 1 FROM public.purchase_requisitions WHERE id = _doc_id AND po_id IS NOT NULL) THEN
      RAISE EXCEPTION 'La demande % est « % » ou déjà convertie : elle ne s''annule plus', _d.number, _d.status
        USING ERRCODE = 'QG007';
    END IF;
  ELSE
    IF _d.status NOT IN ('draft', 'pending_approval', 'rejected', 'approved', 'ordered')
       OR EXISTS (SELECT 1 FROM public.goods_receipts g WHERE g.po_id = _doc_id AND g.status = 'completed') THEN
      RAISE EXCEPTION 'La commande % est « % » ou déjà réceptionnée : elle ne s''annule plus', _d.number, _d.status
        USING ERRCODE = 'QG007';
    END IF;
  END IF;
  UPDATE public.procurement_approvals SET status = 'skipped', decided_at = now(), comment = btrim(_reason)
   WHERE doc_type = _doc_type AND doc_id = _doc_id AND status = 'pending';
  PERFORM public.procurement_set_status(_doc_type, _doc_id, 'cancelled');
END $$;
REVOKE ALL ON FUNCTION public.procurement_cancel(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.procurement_cancel(text, uuid, text) TO authenticated;

-- ─── Gardes : côté utilisateur, statut par les fonctions seulement ; modification en brouillon ───
-- Pas SECURITY DEFINER : current_user est le rôle de l'appelant. Les fonctions ci-dessus, la
-- conversion et la réception (SECURITY DEFINER) s'exécutent sous le propriétaire et passent.
CREATE FUNCTION public.guard_procurement_document() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon', 'qerp_api') THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'Une pièce d''achat se crée en brouillon' USING ERRCODE = 'QG007';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status NOT IN ('draft', 'rejected') THEN
    RAISE EXCEPTION 'Pièce « % » : seule une pièce en brouillon ou rejetée se modifie ou se supprime', OLD.status
      USING ERRCODE = 'QG007';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status = 'rejected' AND NEW.status = 'draft') THEN
    RAISE EXCEPTION 'Le statut d''une pièce d''achat change par soumission, approbation, rejet ou annulation'
      USING ERRCODE = 'QG007';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER trg_guard_procurement_document BEFORE INSERT OR UPDATE OR DELETE ON public.purchase_requisitions
  FOR EACH ROW EXECUTE FUNCTION public.guard_procurement_document();
CREATE TRIGGER trg_guard_procurement_document BEFORE INSERT OR UPDATE OR DELETE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_procurement_document();

CREATE FUNCTION public.guard_procurement_lines() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  _status text;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon', 'qerp_api') THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_TABLE_NAME = 'requisition_lines' THEN
    SELECT status INTO _status FROM public.purchase_requisitions WHERE id = COALESCE(NEW.requisition_id, OLD.requisition_id);
  ELSE
    SELECT status INTO _status FROM public.purchase_orders WHERE id = COALESCE(NEW.po_id, OLD.po_id);
  END IF;
  IF _status NOT IN ('draft', 'rejected') THEN
    RAISE EXCEPTION 'Les lignes d''une pièce « % » ne se modifient plus', _status USING ERRCODE = 'QG007';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER trg_guard_procurement_lines BEFORE INSERT OR UPDATE OR DELETE ON public.requisition_lines
  FOR EACH ROW EXECUTE FUNCTION public.guard_procurement_lines();
CREATE TRIGGER trg_guard_procurement_lines BEFORE INSERT OR UPDATE OR DELETE ON public.po_lines
  FOR EACH ROW EXECUTE FUNCTION public.guard_procurement_lines();
