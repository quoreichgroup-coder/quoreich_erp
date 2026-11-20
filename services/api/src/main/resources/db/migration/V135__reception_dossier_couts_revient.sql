-- V135 — Achats internationaux, fin du parcours (docs/audit-erp/29 §4) : moins de saisie encore.
--   receive_import_file(dossier, dépôt, date)   réception de tout le dossier en une action (NetSuite « receive inbound
--                                    shipment ») : une réception validée par commande de marchandises, pour tout le reste
--                                    à recevoir, dans le dépôt choisi (magasin de consolidation ou dépôt de la société) ;
--   frais réels sans saisie          la facture du transitaire qui cite la commande de transport du dossier crée, à son
--                                    approbation, les frais réels du dossier (une ligne de facture = un frais, au type de
--                                    la ligne de commande) ; les estimations restent pour la comparaison ;
--   import_file_cost_report          coût de revient par article : quantité, valeur d'achat, frais répartis, coût unitaire
--                                    rendu (Dynamics 365 « voyage costing »).

ALTER TABLE public.po_lines ADD COLUMN landed_cost_type_id uuid REFERENCES public.landed_cost_types (id);
ALTER TABLE public.import_file_costs ADD COLUMN ap_invoice_line_id uuid UNIQUE REFERENCES public.ap_invoice_lines (id) ON DELETE SET NULL;

-- La commande de transport garde le type de frais de chaque ligne.
CREATE OR REPLACE FUNCTION public.create_transport_po(_file uuid)
RETURNS uuid LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _f public.import_files%ROWTYPE; _po uuid; _n integer := 0;
BEGIN
  SELECT * INTO _f FROM public.import_files WHERE id = _file AND tenant_id = public.get_user_tenant_id(auth.uid());
  IF NOT FOUND THEN RAISE EXCEPTION 'Dossier introuvable dans la société active' USING ERRCODE = 'QG033'; END IF;
  IF _f.forwarder_id IS NULL THEN RAISE EXCEPTION 'Dossier % : choisissez d''abord le transitaire', _f.file_number USING ERRCODE = 'QG033'; END IF;
  IF EXISTS (SELECT 1 FROM public.import_file_orders WHERE import_file_id = _file AND role = 'transport') THEN
    RAISE EXCEPTION 'Dossier % : une commande de transport existe déjà', _f.file_number USING ERRCODE = 'QG033';
  END IF;
  INSERT INTO public.purchase_orders (tenant_id, supplier_id, order_date, expected_date, incoterm, status, created_by, total)
  VALUES (_f.tenant_id, _f.forwarder_id, CURRENT_DATE, _f.eta, _f.incoterm, 'draft', auth.uid(), 0)
  RETURNING id INTO _po;
  INSERT INTO public.po_lines (po_id, description, quantity, unit_cost, landed_cost_type_id)
  SELECT _po, t.label || ' — Shipment : ' || _f.file_number, 1,
         COALESCE(sum(c.amount) FILTER (WHERE NOT c.is_estimate), sum(c.amount) FILTER (WHERE c.is_estimate)), t.id
    FROM public.import_file_costs c JOIN public.landed_cost_types t ON t.id = c.cost_type_id
   WHERE c.import_file_id = _file AND t.category IN ('freight', 'insurance', 'transit', 'handling')
   GROUP BY t.id, t.label, t.code ORDER BY t.code;
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n = 0 THEN
    INSERT INTO public.po_lines (po_id, description, quantity, unit_cost, landed_cost_type_id)
    VALUES (_po, 'Transport — Shipment : ' || _f.file_number, 1, 0,
            (SELECT id FROM public.landed_cost_types WHERE tenant_id = _f.tenant_id AND category = 'freight' AND is_active ORDER BY code LIMIT 1));
  END IF;
  INSERT INTO public.import_file_orders (tenant_id, import_file_id, po_id, role) VALUES (_f.tenant_id, _file, _po, 'transport');
  RETURN _po;
END $$;

-- Facture du transitaire approuvée → frais réels du dossier (sans saisie).
CREATE FUNCTION public.import_costs_from_ap_invoice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.approval_status <> 'approved' OR OLD.approval_status = 'approved' THEN RETURN NULL; END IF;
  INSERT INTO public.import_file_costs (tenant_id, import_file_id, cost_type_id, description, amount, ap_invoice_id, ap_invoice_line_id, created_by)
  SELECT NEW.tenant_id, o.import_file_id, pl.landed_cost_type_id, 'Facture ' || NEW.invoice_number || ' — ' || l.description, l.net_amount, NEW.id, l.id, NEW.created_by
    FROM public.ap_invoice_lines l
    JOIN public.po_lines pl ON pl.id = l.po_line_id AND pl.landed_cost_type_id IS NOT NULL
    JOIN public.import_file_orders o ON o.po_id = pl.po_id AND o.role = 'transport'
    JOIN public.import_files f ON f.id = o.import_file_id AND f.status NOT IN ('allocated', 'closed')
   WHERE l.invoice_id = NEW.id AND l.net_amount > 0
  ON CONFLICT (ap_invoice_line_id) DO NOTHING;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_import_costs_from_ap_invoice AFTER UPDATE OF approval_status ON public.ap_invoices
  FOR EACH ROW EXECUTE FUNCTION public.import_costs_from_ap_invoice();
REVOKE EXECUTE ON FUNCTION public.import_costs_from_ap_invoice() FROM PUBLIC, anon;

-- Réception de tout le dossier en une action.
CREATE FUNCTION public.receive_import_file(_file uuid, _warehouse uuid DEFAULT NULL, _date date DEFAULT CURRENT_DATE)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _f public.import_files%ROWTYPE; _po record; _gr uuid; _wh uuid; _n integer := 0; _lines integer;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'procurement.receive') THEN
    RAISE EXCEPTION 'Droit insuffisant : enregistrer des réceptions' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _f FROM public.import_files WHERE id = _file AND tenant_id = _tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dossier introuvable dans la société active' USING ERRCODE = 'QG033'; END IF;
  _wh := COALESCE(_warehouse, _f.consolidation_warehouse_id, _f.destination_warehouse_id);
  IF _wh IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.warehouses WHERE id = _wh AND tenant_id = _tenant) THEN
    RAISE EXCEPTION 'Dépôt introuvable dans la société' USING ERRCODE = 'QG033';
  END IF;
  FOR _po IN SELECT p.id, p.po_number FROM public.import_file_orders o JOIN public.purchase_orders p ON p.id = o.po_id
              WHERE o.import_file_id = _file AND o.role = 'goods' AND p.status IN ('approved', 'ordered', 'partially_received') ORDER BY p.po_number LOOP
    _gr := gen_random_uuid();
    INSERT INTO public.goods_receipts (id, tenant_id, gr_number, po_id, receipt_date, received_by, warehouse_id, status)
    VALUES (_gr, _tenant, 'GR-' || _f.file_number || '-' || _po.po_number, _po.id, COALESCE(_date, CURRENT_DATE), auth.uid(), _wh, 'pending');
    INSERT INTO public.gr_lines (gr_id, po_line_id, item_id, quantity_received)
    SELECT _gr, pl.id, pl.item_id,
           pl.quantity - COALESCE((SELECT sum(g2.quantity_received) FROM public.gr_lines g2 JOIN public.goods_receipts r2 ON r2.id = g2.gr_id
                                    WHERE g2.po_line_id = pl.id AND r2.status = 'completed'), 0) + public.po_line_returned(pl.id, true)
      FROM public.po_lines pl WHERE pl.po_id = _po.id;
    DELETE FROM public.gr_lines WHERE gr_id = _gr AND quantity_received <= 0;
    SELECT count(*) INTO _lines FROM public.gr_lines WHERE gr_id = _gr;
    IF _lines = 0 THEN DELETE FROM public.goods_receipts WHERE id = _gr; CONTINUE; END IF;
    UPDATE public.goods_receipts SET status = 'completed' WHERE id = _gr;
    _n := _n + 1;
  END LOOP;
  IF _n = 0 THEN RAISE EXCEPTION 'Dossier % : rien à réceptionner (commandes reçues ou non approuvées)', _f.file_number USING ERRCODE = 'QG033'; END IF;
  RETURN jsonb_build_object('receipts', _n);
END $$;
REVOKE EXECUTE ON FUNCTION public.receive_import_file(uuid, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_import_file(uuid, uuid, date) TO authenticated;

-- Coût de revient par article et par dossier.
CREATE VIEW public.import_file_cost_report WITH (security_invoker = true) AS
SELECT f.tenant_id, f.id AS import_file_id, f.file_number, COALESCE(gl.item_id, pl.item_id) AS item_id,
       COALESCE(i.code, '') AS item_code, COALESCE(i.name, pl.description) AS item_name,
       sum(gl.quantity_received) AS quantity,
       round(sum(gl.quantity_received * pl.unit_cost), 2) AS purchase_value,
       COALESCE((SELECT sum(a.allocated) FROM public.import_file_allocations a WHERE a.import_file_id = f.id
                  AND a.gr_line_id = ANY (array_agg(gl.id))), 0) AS landed_costs,
       round((sum(gl.quantity_received * pl.unit_cost)
              + COALESCE((SELECT sum(a.allocated) FROM public.import_file_allocations a WHERE a.import_file_id = f.id AND a.gr_line_id = ANY (array_agg(gl.id))), 0))
             / NULLIF(sum(gl.quantity_received), 0), 4) AS unit_landed_cost
  FROM public.import_files f
  JOIN public.import_file_orders o ON o.import_file_id = f.id AND o.role = 'goods'
  JOIN public.goods_receipts gr ON gr.po_id = o.po_id AND gr.status = 'completed'
  JOIN public.gr_lines gl ON gl.gr_id = gr.id AND gl.quantity_received > 0
  JOIN public.po_lines pl ON pl.id = gl.po_line_id
  LEFT JOIN public.items i ON i.id = COALESCE(gl.item_id, pl.item_id)
 GROUP BY f.tenant_id, f.id, f.file_number, COALESCE(gl.item_id, pl.item_id), i.code, i.name, pl.description;
GRANT SELECT ON public.import_file_cost_report TO authenticated;

SELECT public.install_tenant_isolation_triggers();
