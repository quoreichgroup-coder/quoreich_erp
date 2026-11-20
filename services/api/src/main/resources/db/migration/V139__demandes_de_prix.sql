-- V139 — Demandes de prix et comparatif fournisseurs (écart G-29, lot A2 de docs/audit-erp/11 ; SAP RFQ → comparaison
-- des offres → attribution, Sage X3 demandes d'offres).
--   rfqs / rfq_lines             demande de prix (numéro DP-AAAA-####), lignes reprises d'une demande d'achat approuvée ou
--                                saisies ; brouillon → envoyée → attribuée / annulée ;
--   rfq_suppliers                fournisseurs consultés (proposés d'après le catalogue fournisseurs V54) et leurs conditions
--                                (délai de paiement, Incoterm, validité) ; répondu / décliné ;
--   rfq_quotes                   offre d'un fournisseur par ligne : prix (dans sa devise), délai, quantité minimale ;
--   rfq_comparison               comparatif par ligne : prix converti en devise de la société au cours du jour, rang,
--                                moins-disant, délai ;
--   award_rfq(rfq, attributions) chaque ligne attribuée à un fournisseur qui a fait une offre ; motif obligatoire quand ce
--                                n'est pas le moins-disant ; une commande brouillon par fournisseur retenu (prix et devise
--                                de l'offre, lien à la ligne de demande d'achat) ; la demande d'achat est convertie ;
--   rfq_settings                 nombre minimal d'offres par ligne (NULL = aucun), attribution par une autre personne que
--                                l'auteur (défaut oui), validité par défaut des offres ;
--   droits                       procurement.rfq (préparer, envoyer, saisir les offres), procurement.rfq_award (attribuer).
-- Écriture des tables seulement par les fonctions (lecture : société).

CREATE TABLE public.rfq_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants (id) ON DELETE CASCADE,
  min_quotes integer CHECK (min_quotes IS NULL OR min_quotes BETWEEN 1 AND 10),
  award_second_person boolean NOT NULL DEFAULT true,
  default_validity_days integer NOT NULL DEFAULT 30 CHECK (default_validity_days BETWEEN 1 AND 365),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT auth.uid()
);

CREATE TABLE public.rfqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  rfq_number text NOT NULL,
  title text NOT NULL CHECK (btrim(title) <> ''),
  requisition_id uuid REFERENCES public.purchase_requisitions (id),
  response_due date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'awarded', 'cancelled')),
  notes text,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  awarded_by uuid,
  awarded_at timestamptz,
  cancel_reason text,
  UNIQUE (tenant_id, rfq_number),
  UNIQUE (id, tenant_id)
);

CREATE TABLE public.rfq_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  rfq_id uuid NOT NULL,
  line_no integer NOT NULL,
  item_id uuid REFERENCES public.items (id),
  description text NOT NULL CHECK (btrim(description) <> ''),
  quantity numeric(18, 4) NOT NULL CHECK (quantity > 0),
  needed_by date,
  requisition_line_id uuid REFERENCES public.requisition_lines (id),
  FOREIGN KEY (rfq_id, tenant_id) REFERENCES public.rfqs (id, tenant_id) ON DELETE CASCADE,
  UNIQUE (rfq_id, line_no),
  UNIQUE (id, tenant_id)
);

CREATE TABLE public.rfq_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  rfq_id uuid NOT NULL,
  supplier_id uuid NOT NULL REFERENCES public.suppliers (id),
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'responded', 'declined')),
  currency text,
  payment_terms integer,
  incoterm text,
  valid_until date,
  supplier_reference text,
  responded_at timestamptz,
  recorded_by uuid,
  FOREIGN KEY (rfq_id, tenant_id) REFERENCES public.rfqs (id, tenant_id) ON DELETE CASCADE,
  UNIQUE (rfq_id, supplier_id)
);

CREATE TABLE public.rfq_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  rfq_id uuid NOT NULL,
  rfq_line_id uuid NOT NULL,
  supplier_id uuid NOT NULL REFERENCES public.suppliers (id),
  unit_price numeric(18, 4) NOT NULL CHECK (unit_price >= 0),
  currency text,
  lead_time_days integer CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
  min_quantity numeric(18, 4),
  notes text,
  FOREIGN KEY (rfq_id, tenant_id) REFERENCES public.rfqs (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (rfq_line_id, tenant_id) REFERENCES public.rfq_lines (id, tenant_id) ON DELETE CASCADE,
  UNIQUE (rfq_line_id, supplier_id)
);

CREATE TABLE public.rfq_awards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  rfq_id uuid NOT NULL,
  rfq_line_id uuid NOT NULL UNIQUE,
  supplier_id uuid NOT NULL REFERENCES public.suppliers (id),
  unit_price numeric(18, 4) NOT NULL,
  currency text,
  cheapest boolean NOT NULL,
  reason text,
  po_id uuid REFERENCES public.purchase_orders (id),
  awarded_by uuid NOT NULL DEFAULT auth.uid(),
  awarded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (rfq_id, tenant_id) REFERENCES public.rfqs (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (rfq_line_id, tenant_id) REFERENCES public.rfq_lines (id, tenant_id) ON DELETE CASCADE,
  CHECK (cheapest OR btrim(COALESCE(reason, '')) <> '')
);

ALTER TABLE public.rfq_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rfqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rfq_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rfq_suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rfq_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rfq_awards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture société" ON public.rfq_settings FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Paramétrage habilité" ON public.rfq_settings FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'procurement.settings'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'procurement.settings'));
CREATE POLICY "Lecture société" ON public.rfqs FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Lecture société" ON public.rfq_lines FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Lecture société" ON public.rfq_suppliers FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Lecture société" ON public.rfq_quotes FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Lecture société" ON public.rfq_awards FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON public.rfqs, public.rfq_lines, public.rfq_suppliers, public.rfq_quotes, public.rfq_awards FROM PUBLIC, anon, authenticated;

INSERT INTO public.erp_permission_catalog (code, module, action, label) VALUES
  ('procurement.rfq', 'procurement', 'rfq', 'Préparer et envoyer les demandes de prix, saisir les offres des fournisseurs'),
  ('procurement.rfq_award', 'procurement', 'rfq_award', 'Attribuer une demande de prix (comparatif des offres) et créer les commandes')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
SELECT r.code, p.code FROM public.erp_system_roles r
  JOIN (VALUES ('procurement.rfq'), ('procurement.rfq_award')) p (code) ON true
 WHERE (p.code = 'procurement.rfq' AND r.code IN ('admin', 'procurement_controller', 'procurement_l1', 'procurement_l2', 'procurement_l3'))
    OR (p.code = 'procurement.rfq_award' AND r.code IN ('admin', 'procurement_controller', 'procurement_l2', 'procurement_l3'))
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, sp.permission_code
  FROM public.erp_roles r
  JOIN public.erp_system_role_permissions sp ON sp.role_code = r.code
 WHERE r.is_system AND sp.permission_code IN ('procurement.rfq', 'procurement.rfq_award')
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

CREATE FUNCTION public.rfq_setting(_tenant uuid)
RETURNS public.rfq_settings LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT s FROM public.rfq_settings s WHERE s.tenant_id = _tenant),
                  ROW(_tenant, NULL, true, 30, now(), NULL)::public.rfq_settings)
$$;
REVOKE EXECUTE ON FUNCTION public.rfq_setting(uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.rfq_require(_perm text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _t uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF _t IS NULL OR NOT public.has_permission(auth.uid(), _perm) THEN
    RAISE EXCEPTION 'Droit insuffisant : %', CASE _perm WHEN 'procurement.rfq_award' THEN 'attribuer une demande de prix' ELSE 'gérer les demandes de prix' END
      USING ERRCODE = '42501';
  END IF;
  RETURN _t;
END $$;
REVOKE EXECUTE ON FUNCTION public.rfq_require(text) FROM PUBLIC, anon, authenticated;

-- Création : lignes saisies ([{description, quantity, item_id, needed_by}]) ou reprises d'une demande d'achat approuvée ;
-- fournisseurs donnés, sinon proposés par le catalogue (offres actives des articles demandés).
CREATE FUNCTION public.create_rfq(_title text, _requisition uuid DEFAULT NULL, _lines jsonb DEFAULT NULL, _suppliers uuid[] DEFAULT NULL,
                                  _response_due date DEFAULT NULL, _notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _t uuid := public.rfq_require('procurement.rfq');
  _pr public.purchase_requisitions%ROWTYPE;
  _id uuid := gen_random_uuid(); _number text; _n integer;
BEGIN
  IF _requisition IS NOT NULL THEN
    SELECT * INTO _pr FROM public.purchase_requisitions WHERE id = _requisition AND tenant_id = _t FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Demande d''achat introuvable dans la société' USING ERRCODE = 'QG036'; END IF;
    IF _pr.status <> 'approved' OR _pr.po_id IS NOT NULL THEN
      RAISE EXCEPTION 'La demande % doit être approuvée et non convertie pour être mise en consultation', _pr.pr_number USING ERRCODE = 'QG036';
    END IF;
    IF EXISTS (SELECT 1 FROM public.rfqs WHERE requisition_id = _requisition AND status IN ('draft', 'sent')) THEN
      RAISE EXCEPTION 'La demande % est déjà en consultation', _pr.pr_number USING ERRCODE = 'QG036';
    END IF;
  END IF;
  INSERT INTO public.ar_numbering_series (tenant_id, doc_type, prefix, format, next_number, reset_frequency)
  SELECT _t, 'rfq', 'DP-', 'DP-YYYY-####', 1, 'yearly'
   WHERE NOT EXISTS (SELECT 1 FROM public.ar_numbering_series WHERE tenant_id = _t AND doc_type = 'rfq');
  _number := public.next_document_number(_t, 'rfq', CURRENT_DATE);
  INSERT INTO public.rfqs (id, tenant_id, rfq_number, title, requisition_id, response_due, notes, created_by)
  VALUES (_id, _t, _number, COALESCE(NULLIF(btrim(_title), ''), 'Demande de prix ' || _number), _requisition, _response_due, NULLIF(btrim(COALESCE(_notes, '')), ''), auth.uid());
  IF _requisition IS NOT NULL THEN
    INSERT INTO public.rfq_lines (tenant_id, rfq_id, line_no, item_id, description, quantity, requisition_line_id)
    SELECT _t, _id, row_number() OVER (ORDER BY rl.id), rl.item_id, rl.description, rl.quantity, rl.id
      FROM public.requisition_lines rl WHERE rl.requisition_id = _requisition;
  ELSE
    INSERT INTO public.rfq_lines (tenant_id, rfq_id, line_no, item_id, description, quantity, needed_by)
    SELECT _t, _id, x.ord, i.id, btrim(x.v ->> 'description'), (x.v ->> 'quantity')::numeric, NULLIF(x.v ->> 'needed_by', '')::date
      FROM jsonb_array_elements(COALESCE(_lines, '[]'::jsonb)) WITH ORDINALITY x (v, ord)
      LEFT JOIN public.items i ON i.id = NULLIF(x.v ->> 'item_id', '')::uuid AND i.tenant_id = _t;
  END IF;
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n = 0 THEN RAISE EXCEPTION 'Une demande de prix a au moins une ligne' USING ERRCODE = 'QG036'; END IF;
  INSERT INTO public.rfq_suppliers (tenant_id, rfq_id, supplier_id)
  SELECT DISTINCT _t, _id, s.id FROM public.suppliers s
   WHERE s.tenant_id = _t AND s.status IS DISTINCT FROM 'inactive'
     AND (s.id = ANY (COALESCE(_suppliers, '{}'))
          OR (_suppliers IS NULL AND EXISTS (SELECT 1 FROM public.supplier_items si JOIN public.rfq_lines l ON l.item_id = si.item_id
                                              WHERE l.rfq_id = _id AND si.supplier_id = s.id AND si.active)));
  IF _suppliers IS NOT NULL AND (SELECT count(*) FROM public.rfq_suppliers WHERE rfq_id = _id) <> cardinality(ARRAY(SELECT DISTINCT unnest(_suppliers))) THEN
    RAISE EXCEPTION 'Fournisseur inconnu ou inactif dans la société' USING ERRCODE = 'QG036';
  END IF;
  RETURN _id;
END $$;

CREATE FUNCTION public.rfq_set_suppliers(_rfq uuid, _suppliers uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _t uuid := public.rfq_require('procurement.rfq'); _r public.rfqs%ROWTYPE; _n integer;
BEGIN
  SELECT * INTO _r FROM public.rfqs WHERE id = _rfq AND tenant_id = _t FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Demande de prix introuvable dans la société' USING ERRCODE = 'QG036'; END IF;
  IF _r.status NOT IN ('draft', 'sent') THEN RAISE EXCEPTION 'Demande de prix % : consultation close', _r.rfq_number USING ERRCODE = 'QG036'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(_suppliers) x WHERE NOT EXISTS (SELECT 1 FROM public.suppliers s WHERE s.id = x AND s.tenant_id = _t)) THEN
    RAISE EXCEPTION 'Fournisseur inconnu dans la société' USING ERRCODE = 'QG036';
  END IF;
  -- Un fournisseur qui a déjà remis une offre reste consulté.
  DELETE FROM public.rfq_suppliers rs WHERE rs.rfq_id = _rfq AND rs.supplier_id <> ALL (_suppliers)
     AND NOT EXISTS (SELECT 1 FROM public.rfq_quotes q WHERE q.rfq_id = _rfq AND q.supplier_id = rs.supplier_id);
  INSERT INTO public.rfq_suppliers (tenant_id, rfq_id, supplier_id) SELECT _t, _rfq, x FROM unnest(_suppliers) x ON CONFLICT (rfq_id, supplier_id) DO NOTHING;
  SELECT count(*) INTO _n FROM public.rfq_suppliers WHERE rfq_id = _rfq;
  RETURN _n;
END $$;

CREATE FUNCTION public.rfq_send(_rfq uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _t uuid := public.rfq_require('procurement.rfq'); _r public.rfqs%ROWTYPE;
BEGIN
  SELECT * INTO _r FROM public.rfqs WHERE id = _rfq AND tenant_id = _t FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Demande de prix introuvable dans la société' USING ERRCODE = 'QG036'; END IF;
  IF _r.status <> 'draft' THEN RAISE EXCEPTION 'Demande de prix % : déjà envoyée', _r.rfq_number USING ERRCODE = 'QG036'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rfq_suppliers WHERE rfq_id = _rfq) THEN
    RAISE EXCEPTION 'Demande de prix % : choisissez au moins un fournisseur à consulter', _r.rfq_number USING ERRCODE = 'QG036';
  END IF;
  UPDATE public.rfqs SET status = 'sent', sent_at = now() WHERE id = _rfq;
END $$;

-- Offre d'un fournisseur : [{line_id, unit_price, lead_time_days, min_quantity, notes}] ; conditions de l'offre.
CREATE FUNCTION public.record_rfq_quote(_rfq uuid, _supplier uuid, _quotes jsonb, _currency text DEFAULT NULL, _valid_until date DEFAULT NULL,
                                        _payment_terms integer DEFAULT NULL, _incoterm text DEFAULT NULL, _reference text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _t uuid := public.rfq_require('procurement.rfq'); _r public.rfqs%ROWTYPE; _cur text; _n integer;
BEGIN
  SELECT * INTO _r FROM public.rfqs WHERE id = _rfq AND tenant_id = _t FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Demande de prix introuvable dans la société' USING ERRCODE = 'QG036'; END IF;
  IF _r.status <> 'sent' THEN RAISE EXCEPTION 'Demande de prix % : les offres se saisissent une fois la demande envoyée et avant attribution', _r.rfq_number USING ERRCODE = 'QG036'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rfq_suppliers WHERE rfq_id = _rfq AND supplier_id = _supplier) THEN
    RAISE EXCEPTION 'Ce fournisseur n''est pas consulté sur la demande %', _r.rfq_number USING ERRCODE = 'QG036';
  END IF;
  _cur := NULLIF(upper(btrim(COALESCE(_currency, ''))), '');
  IF _cur IS NOT NULL AND public.exchange_rate_at(_t, _cur, CURRENT_DATE) IS NULL THEN
    RAISE EXCEPTION 'Aucun cours connu pour la devise % (Paramètres → Devises et cours)', _cur USING ERRCODE = 'QG036';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(_quotes, '[]')) q
              WHERE NOT EXISTS (SELECT 1 FROM public.rfq_lines l WHERE l.id = NULLIF(q ->> 'line_id', '')::uuid AND l.rfq_id = _rfq)
                 OR COALESCE((q ->> 'unit_price')::numeric, -1) < 0) THEN
    RAISE EXCEPTION 'Offre invalide : ligne inconnue ou prix manquant' USING ERRCODE = 'QG036';
  END IF;
  DELETE FROM public.rfq_quotes WHERE rfq_id = _rfq AND supplier_id = _supplier;
  INSERT INTO public.rfq_quotes (tenant_id, rfq_id, rfq_line_id, supplier_id, unit_price, currency, lead_time_days, min_quantity, notes)
  SELECT _t, _rfq, (q ->> 'line_id')::uuid, _supplier, (q ->> 'unit_price')::numeric, _cur, NULLIF(q ->> 'lead_time_days', '')::integer,
         NULLIF(q ->> 'min_quantity', '')::numeric, NULLIF(btrim(COALESCE(q ->> 'notes', '')), '')
    FROM jsonb_array_elements(_quotes) q;
  GET DIAGNOSTICS _n = ROW_COUNT;
  UPDATE public.rfq_suppliers SET status = CASE WHEN _n > 0 THEN 'responded' ELSE 'declined' END, currency = _cur, payment_terms = _payment_terms,
         incoterm = NULLIF(btrim(COALESCE(_incoterm, '')), ''), supplier_reference = NULLIF(btrim(COALESCE(_reference, '')), ''),
         valid_until = COALESCE(_valid_until, CURRENT_DATE + (public.rfq_setting(_t)).default_validity_days), responded_at = now(), recorded_by = auth.uid()
   WHERE rfq_id = _rfq AND supplier_id = _supplier;
  RETURN _n;
END $$;

-- Comparatif : prix converti en devise de la société au cours du jour, rang par ligne (1 = moins-disant).
CREATE VIEW public.rfq_comparison WITH (security_invoker = true) AS
SELECT q.tenant_id, q.rfq_id, q.rfq_line_id, l.line_no, l.description, l.quantity, q.supplier_id, s.name AS supplier_name,
       q.unit_price, q.currency, q.lead_time_days, q.min_quantity, rs.valid_until, rs.payment_terms, rs.incoterm,
       round(q.unit_price * COALESCE(public.exchange_rate_at(q.tenant_id, q.currency, CURRENT_DATE), 1), 4) AS unit_price_base,
       round(q.unit_price * COALESCE(public.exchange_rate_at(q.tenant_id, q.currency, CURRENT_DATE), 1) * l.quantity, 2) AS amount_base,
       rank() OVER (PARTITION BY q.rfq_line_id ORDER BY q.unit_price * COALESCE(public.exchange_rate_at(q.tenant_id, q.currency, CURRENT_DATE), 1)) AS price_rank,
       (rs.valid_until IS NOT NULL AND rs.valid_until < CURRENT_DATE) AS expired
  FROM public.rfq_quotes q
  JOIN public.rfq_lines l ON l.id = q.rfq_line_id
  JOIN public.suppliers s ON s.id = q.supplier_id
  JOIN public.rfq_suppliers rs ON rs.rfq_id = q.rfq_id AND rs.supplier_id = q.supplier_id;
GRANT SELECT ON public.rfq_comparison TO authenticated;

-- Attribution : [{line_id, supplier_id, reason}] ; une commande brouillon par fournisseur retenu.
CREATE FUNCTION public.award_rfq(_rfq uuid, _awards jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _t uuid := public.rfq_require('procurement.rfq_award');
  _r public.rfqs%ROWTYPE; _s public.rfq_settings; _a jsonb; _l public.rfq_lines%ROWTYPE; _q public.rfq_quotes%ROWTYPE;
  _best numeric; _mine numeric; _quotes integer; _sup record; _po uuid; _pos jsonb := '[]'; _rate numeric; _rs public.rfq_suppliers%ROWTYPE;
BEGIN
  SELECT * INTO _r FROM public.rfqs WHERE id = _rfq AND tenant_id = _t FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Demande de prix introuvable dans la société' USING ERRCODE = 'QG036'; END IF;
  IF _r.status <> 'sent' THEN RAISE EXCEPTION 'Demande de prix % : seule une demande envoyée s''attribue', _r.rfq_number USING ERRCODE = 'QG036'; END IF;
  _s := public.rfq_setting(_t);
  IF _s.award_second_person AND _r.created_by = auth.uid() THEN
    RAISE EXCEPTION 'Demande de prix % : l''attribution revient à une autre personne que son auteur', _r.rfq_number USING ERRCODE = '42501';
  END IF;
  IF jsonb_array_length(COALESCE(_awards, '[]')) <> (SELECT count(*) FROM public.rfq_lines WHERE rfq_id = _rfq) THEN
    RAISE EXCEPTION 'Demande de prix % : attribuez chaque ligne, une seule fois', _r.rfq_number USING ERRCODE = 'QG036';
  END IF;
  FOR _a IN SELECT * FROM jsonb_array_elements(_awards) LOOP
    SELECT * INTO _l FROM public.rfq_lines WHERE id = NULLIF(_a ->> 'line_id', '')::uuid AND rfq_id = _rfq;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ligne inconnue sur la demande %', _r.rfq_number USING ERRCODE = 'QG036'; END IF;
    SELECT * INTO _q FROM public.rfq_quotes WHERE rfq_line_id = _l.id AND supplier_id = NULLIF(_a ->> 'supplier_id', '')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ligne % : ce fournisseur n''a pas fait d''offre', _l.line_no USING ERRCODE = 'QG036'; END IF;
    SELECT * INTO _rs FROM public.rfq_suppliers WHERE rfq_id = _rfq AND supplier_id = _q.supplier_id;
    IF _rs.valid_until IS NOT NULL AND _rs.valid_until < CURRENT_DATE THEN
      RAISE EXCEPTION 'Ligne % : l''offre retenue a expiré le %', _l.line_no, _rs.valid_until USING ERRCODE = 'QG036';
    END IF;
    SELECT count(*), min(unit_price_base) INTO _quotes, _best FROM public.rfq_comparison WHERE rfq_line_id = _l.id AND NOT expired;
    IF _s.min_quotes IS NOT NULL AND _quotes < _s.min_quotes THEN
      RAISE EXCEPTION 'Ligne % : % offre(s) valable(s), la société en exige % avant attribution', _l.line_no, _quotes, _s.min_quotes USING ERRCODE = 'QG036';
    END IF;
    _mine := _q.unit_price * COALESCE(public.exchange_rate_at(_t, _q.currency, CURRENT_DATE), 1);
    INSERT INTO public.rfq_awards (tenant_id, rfq_id, rfq_line_id, supplier_id, unit_price, currency, cheapest, reason)
    VALUES (_t, _rfq, _l.id, _q.supplier_id, _q.unit_price, _q.currency, _mine <= _best, NULLIF(btrim(COALESCE(_a ->> 'reason', '')), ''));
  END LOOP;
  -- Une commande brouillon par fournisseur retenu, au prix et dans la devise de son offre.
  FOR _sup IN SELECT DISTINCT a.supplier_id, a.currency FROM public.rfq_awards a WHERE a.rfq_id = _rfq LOOP
    SELECT * INTO _rs FROM public.rfq_suppliers WHERE rfq_id = _rfq AND supplier_id = _sup.supplier_id;
    _rate := COALESCE(public.exchange_rate_at(_t, _sup.currency, CURRENT_DATE), 1);
    INSERT INTO public.purchase_orders (tenant_id, supplier_id, order_date, total, status, created_by, currency, exchange_rate, incoterm)
    VALUES (_t, _sup.supplier_id, CURRENT_DATE, 0, 'draft', auth.uid(), _sup.currency, CASE WHEN _sup.currency IS NULL THEN NULL ELSE _rate END, _rs.incoterm)
    RETURNING id INTO _po;
    INSERT INTO public.po_lines (po_id, item_id, description, quantity, unit_cost, fx_unit_cost, requisition_line_id)
    SELECT _po, l.item_id, l.description, l.quantity, round(a.unit_price * _rate, 4), CASE WHEN a.currency IS NULL THEN NULL ELSE a.unit_price END, l.requisition_line_id
      FROM public.rfq_awards a JOIN public.rfq_lines l ON l.id = a.rfq_line_id
     WHERE a.rfq_id = _rfq AND a.supplier_id = _sup.supplier_id AND a.currency IS NOT DISTINCT FROM _sup.currency
     ORDER BY l.line_no;
    UPDATE public.rfq_awards SET po_id = _po WHERE rfq_id = _rfq AND supplier_id = _sup.supplier_id AND currency IS NOT DISTINCT FROM _sup.currency;
    _pos := _pos || jsonb_build_object('po_id', _po, 'supplier_id', _sup.supplier_id);
  END LOOP;
  UPDATE public.rfqs SET status = 'awarded', awarded_by = auth.uid(), awarded_at = now() WHERE id = _rfq;
  IF _r.requisition_id IS NOT NULL THEN
    UPDATE public.purchase_requisitions SET status = 'converted', po_id = (_pos -> 0 ->> 'po_id')::uuid WHERE id = _r.requisition_id;
  END IF;
  RETURN jsonb_build_object('purchase_orders', _pos);
END $$;

CREATE FUNCTION public.rfq_cancel(_rfq uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _t uuid := public.rfq_require('procurement.rfq'); _r public.rfqs%ROWTYPE;
BEGIN
  SELECT * INTO _r FROM public.rfqs WHERE id = _rfq AND tenant_id = _t FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Demande de prix introuvable dans la société' USING ERRCODE = 'QG036'; END IF;
  IF _r.status NOT IN ('draft', 'sent') THEN RAISE EXCEPTION 'Demande de prix % : déjà attribuée ou annulée', _r.rfq_number USING ERRCODE = 'QG036'; END IF;
  IF btrim(COALESCE(_reason, '')) = '' THEN RAISE EXCEPTION 'Indiquez le motif de l''annulation' USING ERRCODE = 'QG036'; END IF;
  UPDATE public.rfqs SET status = 'cancelled', cancel_reason = btrim(_reason) WHERE id = _rfq;
END $$;

DO $$
DECLARE _f text;
BEGIN
  FOREACH _f IN ARRAY ARRAY['create_rfq(text, uuid, jsonb, uuid[], date, text)', 'rfq_set_suppliers(uuid, uuid[])', 'rfq_send(uuid)',
    'record_rfq_quote(uuid, uuid, jsonb, text, date, integer, text, text)', 'award_rfq(uuid, jsonb)', 'rfq_cancel(uuid, text)'] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon', _f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', _f);
  END LOOP;
END $$;

SELECT public.install_tenant_isolation_triggers();
