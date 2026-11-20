-- V132 — Processus d'importation de la société (procédure Sage 300 « Processus commandes internationales »)
-- repris et automatisé, sans manipulation de fichier Excel (docs/audit-erp/29).
--   Sage : réception dans un magasin de consolidation à l'étranger → numéro d'expédition unique ANNÉE-TRANSITAIRE-
--   MODE-NNN saisi à la main → bon de commande de transport copié, champs optionnels ETA / ETAT / SHIPNO saisis →
--   transfert de transit : rapport d'extraction, export Excel, nettoyage de trois feuilles (#REF!), script d'import,
--   comptabilisation.
--   QUOREICH :
--   * dépôts typés (standard, consolidation, transit) ; la réception se fait dans le dépôt choisi (le magasin de
--     consolidation) ; le stock consolidé ou en transit est en 381 « marchandises en cours de route » (rôle
--     GOODS_IN_TRANSIT, décision D-I4), le stock arrivé en 311 ; un transfert entre dépôts de comptes différents passe
--     l'écriture de reclassement ;
--   * numéro d'expédition au format de la société (import_settings.number_format, par ex. {YYYY}-{FWD}-{MODE}-{SEQ3} =
--     2026-BOL-MER-012 : code du transitaire tiré de son nom, mode de transport, séquence qui ne repart pas à zéro) ;
--   * commande de transport créée depuis le dossier, au transitaire, avec les frais du dossier et « Shipment : n° »,
--     rattachée au dossier (rôle transport : ses lignes ne se répartissent pas comme des marchandises) ;
--   * transfert de transit en un clic : expédition (consolidation → transit) puis arrivée (transit → destination),
--     quantités calculées par le dossier (reçu − déjà expédié), éventuellement déclenchées par les événements de suivi
--     réels « départ » et « livré » (import_settings.auto_transit_transfers) ;
--   * stock en consolidation et en transit par dossier (consolidation_stock).

-- ─── Rôle 381 : marchandises en cours de route ───
INSERT INTO public.posting_roles (code, label, module, description, expected_prefixes) VALUES
  ('GOODS_IN_TRANSIT', 'Marchandises en cours de route', 'STK', 'Stock acheté, consolidé ou en transit, pas encore arrivé dans un dépôt de la société', ARRAY['38'])
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.framework_role_expectations (framework_code, role_code, prefixes)
SELECT 'SYSCOHADA_REVISE', 'GOODS_IN_TRANSIT', ARRAY['38'] WHERE EXISTS (SELECT 1 FROM public.accounting_frameworks WHERE code = 'SYSCOHADA_REVISE')
ON CONFLICT (framework_code, role_code) DO NOTHING;
INSERT INTO public.framework_reference_accounts (framework_code, code, name, account_type)
SELECT 'SYSCOHADA_REVISE', '381', 'Marchandises en cours de route', 'asset' WHERE EXISTS (SELECT 1 FROM public.accounting_frameworks WHERE code = 'SYSCOHADA_REVISE')
ON CONFLICT (framework_code, code) DO NOTHING;
INSERT INTO public.accounting_framework_accounts (framework_code, code, name, account_type)
SELECT 'SYSCOHADA_REVISE', '381', 'Marchandises en cours de route', 'asset'
 WHERE EXISTS (SELECT 1 FROM public.accounting_frameworks WHERE code = 'SYSCOHADA_REVISE')
   AND NOT EXISTS (SELECT 1 FROM public.accounting_framework_accounts WHERE framework_code = 'SYSCOHADA_REVISE' AND code = '381');
INSERT INTO public.accounting_framework_role_defaults (framework_code, role_code, account_code)
SELECT 'SYSCOHADA_REVISE', 'GOODS_IN_TRANSIT', '381'
 WHERE EXISTS (SELECT 1 FROM public.accounting_frameworks WHERE code = 'SYSCOHADA_REVISE')
   AND NOT EXISTS (SELECT 1 FROM public.accounting_framework_role_defaults WHERE framework_code = 'SYSCOHADA_REVISE' AND role_code = 'GOODS_IN_TRANSIT');
INSERT INTO public.gl_accounts (tenant_id, code, name, account_type)
SELECT s.tenant_id, '381', 'Marchandises en cours de route', 'asset' FROM public.tenant_accounting_settings s WHERE s.framework_code = 'SYSCOHADA_REVISE'
ON CONFLICT (tenant_id, code) DO NOTHING;
INSERT INTO public.tenant_posting_accounts (tenant_id, role_code, gl_account_id)
SELECT s.tenant_id, 'GOODS_IN_TRANSIT', g.id FROM public.tenant_accounting_settings s
  JOIN public.gl_accounts g ON g.tenant_id = s.tenant_id AND g.code = '381' AND g.is_active
 WHERE s.framework_code = 'SYSCOHADA_REVISE'
ON CONFLICT (tenant_id, role_code) DO NOTHING;
INSERT INTO public.posting_role_set_kinds (kind, role_code, control) VALUES ('item', 'GOODS_IN_TRANSIT', true) ON CONFLICT DO NOTHING;

-- ─── Dépôts typés, dépôt de réception ───
ALTER TABLE public.warehouses
  ADD COLUMN kind text NOT NULL DEFAULT 'standard' CHECK (kind IN ('standard', 'consolidation', 'transit')),
  ADD COLUMN country text CHECK (country ~ '^[A-Z]{2}$');
ALTER TABLE public.goods_receipts ADD COLUMN warehouse_id uuid REFERENCES public.warehouses (id);

-- Rôle du compte de stock d'un dépôt : 381 pour un dépôt de consolidation ou de transit, 311 sinon.
CREATE FUNCTION public.warehouse_stock_role(_warehouse uuid)
RETURNS text LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE WHEN (SELECT w.kind FROM public.warehouses w WHERE w.id = _warehouse) IN ('consolidation', 'transit') THEN 'GOODS_IN_TRANSIT' ELSE 'INVENTORY' END
$$;
REVOKE EXECUTE ON FUNCTION public.warehouse_stock_role(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.warehouse_stock_role(uuid) TO authenticated;

-- ─── Paramètres d'importation de la société ───
CREATE TABLE public.import_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants (id) ON DELETE CASCADE,
  number_format text NOT NULL DEFAULT 'IMP-{YYYY}-{SEQ4}' CHECK (number_format ~ '\{SEQ[0-9]\}' AND length(number_format) <= 60),
  mode_codes jsonb NOT NULL DEFAULT '{"sea": "MER", "air": "AIR", "road": "ROU", "rail": "FER", "multimodal": "MUL"}',
  last_sequence integer NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  auto_transit_transfers boolean NOT NULL DEFAULT false,
  default_consolidation_warehouse_id uuid REFERENCES public.warehouses (id),
  default_transit_warehouse_id uuid REFERENCES public.warehouses (id),
  default_destination_warehouse_id uuid REFERENCES public.warehouses (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
ALTER TABLE public.import_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture société" ON public.import_settings FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Paramétrage habilité" ON public.import_settings FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'procurement.settings'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'procurement.settings'));
GRANT SELECT, INSERT, UPDATE ON public.import_settings TO authenticated;
-- La séquence reprend après les dossiers existants (elle ne repart jamais à zéro).
INSERT INTO public.import_settings (tenant_id, last_sequence)
SELECT f.tenant_id, count(*) FROM public.import_files f GROUP BY f.tenant_id
ON CONFLICT (tenant_id) DO NOTHING;

ALTER TABLE public.import_files
  ADD COLUMN consolidation_warehouse_id uuid REFERENCES public.warehouses (id),
  ADD COLUMN transit_warehouse_id uuid REFERENCES public.warehouses (id),
  ADD COLUMN destination_warehouse_id uuid REFERENCES public.warehouses (id);
ALTER TABLE public.import_file_orders ADD COLUMN role text NOT NULL DEFAULT 'goods' CHECK (role IN ('goods', 'transport'));

-- Numéro d'expédition au format de la société : {YYYY} {YY} {FWD} (code du transitaire) {MODE} {SEQn}.
CREATE FUNCTION public.next_import_file_number(_tenant uuid, _forwarder uuid, _mode text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _s public.import_settings%ROWTYPE; _n integer; _fwd text; _out text; _w integer;
BEGIN
  INSERT INTO public.import_settings (tenant_id) VALUES (_tenant) ON CONFLICT (tenant_id) DO NOTHING;
  UPDATE public.import_settings SET last_sequence = last_sequence + 1 WHERE tenant_id = _tenant RETURNING * INTO _s;
  _n := _s.last_sequence;
  SELECT upper(left(regexp_replace(translate(lower(s.name), 'àâäéèêëîïôöùûüç', 'aaaeeeeiioouuuc'), '[^a-z]', '', 'g'), 3)) INTO _fwd
    FROM public.suppliers s WHERE s.id = _forwarder;
  _out := _s.number_format;
  _out := replace(_out, '{YYYY}', to_char(CURRENT_DATE, 'YYYY'));
  _out := replace(_out, '{YY}', to_char(CURRENT_DATE, 'YY'));
  _out := replace(_out, '{FWD}', COALESCE(NULLIF(_fwd, ''), 'XXX'));
  _out := replace(_out, '{MODE}', COALESCE(_s.mode_codes ->> COALESCE(_mode, ''), 'XXX'));
  _w := substring(_out from '\{SEQ([0-9])\}')::int;
  _out := regexp_replace(_out, '\{SEQ[0-9]\}', lpad(_n::text, greatest(_w, length(_n::text)), '0'));
  RETURN _out;
END $$;
REVOKE EXECUTE ON FUNCTION public.next_import_file_number(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- ─── Commande de transport créée depuis le dossier ───
CREATE FUNCTION public.create_transport_po(_file uuid)
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
  -- Une ligne par type de frais du transitaire : montant réel s'il est connu, sinon estimé.
  INSERT INTO public.po_lines (po_id, description, quantity, unit_cost)
  SELECT _po, t.label || ' — Shipment : ' || _f.file_number, 1,
         COALESCE(sum(c.amount) FILTER (WHERE NOT c.is_estimate), sum(c.amount) FILTER (WHERE c.is_estimate))
    FROM public.import_file_costs c JOIN public.landed_cost_types t ON t.id = c.cost_type_id
   WHERE c.import_file_id = _file AND t.category IN ('freight', 'insurance', 'transit', 'handling')
   GROUP BY t.id, t.label, t.code ORDER BY t.code;
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n = 0 THEN
    INSERT INTO public.po_lines (po_id, description, quantity, unit_cost) VALUES (_po, 'Transport — Shipment : ' || _f.file_number, 1, 0);
  END IF;
  INSERT INTO public.import_file_orders (tenant_id, import_file_id, po_id, role) VALUES (_f.tenant_id, _file, _po, 'transport');
  RETURN _po;
END $$;
REVOKE EXECUTE ON FUNCTION public.create_transport_po(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_transport_po(uuid) TO authenticated;

-- ─── Transfert de transit en un clic ───
CREATE TABLE public.import_file_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  import_file_id uuid NOT NULL REFERENCES public.import_files (id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN ('ship', 'deliver')),
  item_id uuid NOT NULL REFERENCES public.items (id),
  from_warehouse_id uuid NOT NULL REFERENCES public.warehouses (id),
  to_warehouse_id uuid NOT NULL REFERENCES public.warehouses (id),
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit_cost numeric NOT NULL DEFAULT 0,
  transfer_date date NOT NULL,
  journal_entry_id uuid REFERENCES public.journal_entries (id),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.import_file_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture société" ON public.import_file_transfers FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
GRANT SELECT ON public.import_file_transfers TO authenticated;

-- Reclassement de stock entre deux dépôts de comptes différents (381 ↔ 311), en inventaire permanent.
CREATE FUNCTION public.stock_reclass_entry(_tenant uuid, _item uuid, _from uuid, _to uuid, _value numeric, _date date, _label text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r1 text := public.warehouse_stock_role(_from); _r2 text := public.warehouse_stock_role(_to);
BEGIN
  IF _r1 = _r2 OR COALESCE(_value, 0) <= 0 THEN RETURN NULL; END IF;
  IF NOT COALESCE((SELECT s.auto_je_on_movement FROM public.inventory_settings s WHERE s.tenant_id = _tenant), true) THEN RETURN NULL; END IF;
  RETURN public.post_two_line_entry(_tenant, _date, 'stock_movement', _label,
    public.require_posting_account(_tenant, _r2, public.item_account_set(_item)),
    public.require_posting_account(_tenant, _r1, public.item_account_set(_item)), round(_value, 2));
END $$;
REVOKE EXECUTE ON FUNCTION public.stock_reclass_entry(uuid, uuid, uuid, uuid, numeric, date, text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.import_file_transit_transfer(_file uuid, _stage text, _date date DEFAULT CURRENT_DATE)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _f public.import_files%ROWTYPE;
  _from uuid; _to uuid;
  _l record; _qty numeric; _avg numeric; _entry uuid; _n integer := 0; _value numeric := 0;
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'procurement.import') OR public.has_permission(auth.uid(), 'inventory.transfer')) THEN
    RAISE EXCEPTION 'Droit insuffisant : dossiers d''importation ou transferts de stock' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _f FROM public.import_files WHERE id = _file AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dossier introuvable dans la société active' USING ERRCODE = 'QG033'; END IF;
  IF _stage NOT IN ('ship', 'deliver') THEN RAISE EXCEPTION 'Étape de transfert inconnue : %', _stage USING ERRCODE = 'QG033'; END IF;
  _date := COALESCE(_date, CURRENT_DATE);
  IF _stage = 'ship' THEN _to := _f.transit_warehouse_id; ELSE _from := _f.transit_warehouse_id; _to := _f.destination_warehouse_id; END IF;
  IF _to IS NULL OR (_stage = 'deliver' AND _from IS NULL) THEN
    RAISE EXCEPTION 'Dossier % : renseignez les dépôts de transit et de destination', _f.file_number USING ERRCODE = 'QG033';
  END IF;

  FOR _l IN
    -- Expédition : reçu dans un dépôt de consolidation (ou celui du dossier) − déjà expédié ; arrivée : expédié − déjà arrivé.
    SELECT x.item_id, x.from_wh, sum(x.qty) AS qty FROM (
      SELECT COALESCE(gl.item_id, pl.item_id) AS item_id, gr.warehouse_id AS from_wh, gl.quantity_received AS qty
        FROM public.import_file_orders o
        JOIN public.goods_receipts gr ON gr.po_id = o.po_id AND gr.status = 'completed'
        JOIN public.gr_lines gl ON gl.gr_id = gr.id
        JOIN public.po_lines pl ON pl.id = gl.po_line_id
        JOIN public.warehouses w ON w.id = gr.warehouse_id AND w.kind = 'consolidation'
       WHERE _stage = 'ship' AND o.import_file_id = _file AND o.role = 'goods' AND COALESCE(gl.item_id, pl.item_id) IS NOT NULL
      UNION ALL
      SELECT t.item_id, t.from_warehouse_id, -t.quantity FROM public.import_file_transfers t WHERE _stage = 'ship' AND t.import_file_id = _file AND t.stage = 'ship'
      UNION ALL
      SELECT t.item_id, _from, t.quantity FROM public.import_file_transfers t WHERE _stage = 'deliver' AND t.import_file_id = _file AND t.stage = 'ship'
      UNION ALL
      SELECT t.item_id, _from, -t.quantity FROM public.import_file_transfers t WHERE _stage = 'deliver' AND t.import_file_id = _file AND t.stage = 'deliver'
    ) x GROUP BY x.item_id, x.from_wh HAVING sum(x.qty) > 0
  LOOP
    -- Jamais plus que ce qui est réellement dans le dépôt de départ.
    _qty := least(_l.qty, COALESCE((SELECT il.quantity_on_hand FROM public.item_locations il WHERE il.item_id = _l.item_id AND il.warehouse_id = _l.from_wh), 0));
    CONTINUE WHEN _qty <= 0;
    SELECT COALESCE(average_cost, 0) INTO _avg FROM public.items WHERE id = _l.item_id;
    INSERT INTO public.stock_movements (tenant_id, item_id, movement_type, quantity, unit_cost, warehouse_id, reference_type, reference_id, movement_date,
                                        created_by, status, reason)
    VALUES (_tenant, _l.item_id, 'transfer_out', -_qty, _avg, _l.from_wh, 'import_file', _file, _date, auth.uid(), 'posted', 'Transit ' || _f.file_number),
           (_tenant, _l.item_id, 'transfer_in', _qty, _avg, _to, 'import_file', _file, _date, auth.uid(), 'posted', 'Transit ' || _f.file_number);
    _entry := public.stock_reclass_entry(_tenant, _l.item_id, _l.from_wh, _to, _qty * _avg, _date,
      CASE _stage WHEN 'ship' THEN 'Expédition ' ELSE 'Arrivée ' END || _f.file_number);
    INSERT INTO public.import_file_transfers (tenant_id, import_file_id, stage, item_id, from_warehouse_id, to_warehouse_id, quantity, unit_cost, transfer_date, journal_entry_id)
    VALUES (_tenant, _file, _stage, _l.item_id, _l.from_wh, _to, _qty, _avg, _date, _entry);
    _n := _n + 1; _value := _value + _qty * _avg;
  END LOOP;
  IF _n = 0 THEN
    RAISE EXCEPTION 'Dossier % : rien à %', _f.file_number,
      CASE _stage WHEN 'ship' THEN 'expédier (aucune marchandise reçue en dépôt de consolidation non encore expédiée)' ELSE 'réceptionner (rien en transit pour ce dossier)' END
      USING ERRCODE = 'QG033';
  END IF;
  RETURN jsonb_build_object('lines', _n, 'value', round(_value, 2));
END $$;
REVOKE EXECUTE ON FUNCTION public.import_file_transit_transfer(uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_file_transit_transfer(uuid, text, date) TO authenticated;

-- Stock consolidé ou en transit, par dépôt et par dossier.
CREATE VIEW public.consolidation_stock WITH (security_invoker = true) AS
SELECT il.tenant_id, w.id AS warehouse_id, w.code AS warehouse_code, w.name AS warehouse_name, w.kind, i.id AS item_id, i.code AS item_code, i.name AS item_name,
       il.quantity_on_hand, round(il.quantity_on_hand * COALESCE(i.average_cost, 0), 2) AS value
  FROM public.item_locations il
  JOIN public.warehouses w ON w.id = il.warehouse_id AND w.kind IN ('consolidation', 'transit')
  JOIN public.items i ON i.id = il.item_id
 WHERE il.quantity_on_hand <> 0;
GRANT SELECT ON public.consolidation_stock TO authenticated;

-- ─── Frais estimés par règles (Dynamics 365 « auto costs »), comparés aux frais réels ───
ALTER TABLE public.import_file_costs ADD COLUMN is_estimate boolean NOT NULL DEFAULT false;
CREATE TABLE public.landed_cost_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  cost_type_id uuid NOT NULL REFERENCES public.landed_cost_types (id),
  transport_mode text CHECK (transport_mode IN ('sea', 'air', 'road', 'rail', 'multimodal')),
  supplier_id uuid REFERENCES public.suppliers (id),
  method text NOT NULL CHECK (method IN ('percent', 'fixed')),
  value numeric(18, 4) NOT NULL CHECK (value > 0),
  is_active boolean NOT NULL DEFAULT true
);
ALTER TABLE public.landed_cost_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture société" ON public.landed_cost_rules FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Paramétrage habilité" ON public.landed_cost_rules FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'procurement.import'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'procurement.import'));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.landed_cost_rules TO authenticated;

-- Frais estimés d'un dossier : les estimations existantes sont remplacées ; la règle la plus précise (fournisseur, puis
-- mode de transport) l'emporte pour un type de frais ; un pourcentage s'applique à la valeur commandée des marchandises.
CREATE FUNCTION public.apply_landed_cost_rules(_file uuid)
RETURNS integer LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _f public.import_files%ROWTYPE; _value numeric; _n integer;
BEGIN
  SELECT * INTO _f FROM public.import_files WHERE id = _file AND tenant_id = public.get_user_tenant_id(auth.uid());
  IF NOT FOUND THEN RAISE EXCEPTION 'Dossier introuvable dans la société active' USING ERRCODE = 'QG033'; END IF;
  SELECT COALESCE(sum(pl.quantity * pl.unit_cost), 0) INTO _value
    FROM public.import_file_orders o JOIN public.po_lines pl ON pl.po_id = o.po_id WHERE o.import_file_id = _file AND o.role = 'goods';
  DELETE FROM public.import_file_costs WHERE import_file_id = _file AND is_estimate;
  INSERT INTO public.import_file_costs (tenant_id, import_file_id, cost_type_id, description, amount, is_estimate)
  SELECT _f.tenant_id, _file, r.cost_type_id, 'Estimation (' || CASE r.method WHEN 'percent' THEN r.value || ' % de la valeur' ELSE 'forfait' END || ')',
         CASE r.method WHEN 'percent' THEN round(_value * r.value / 100, 2) ELSE r.value END, true
    FROM (SELECT DISTINCT ON (lr.cost_type_id) lr.* FROM public.landed_cost_rules lr
           WHERE lr.tenant_id = _f.tenant_id AND lr.is_active
             AND (lr.supplier_id IS NULL OR lr.supplier_id = _f.supplier_id)
             AND (lr.transport_mode IS NULL OR lr.transport_mode = _f.transport_mode)
           ORDER BY lr.cost_type_id, (lr.supplier_id IS NOT NULL) DESC, (lr.transport_mode IS NOT NULL) DESC) r
   WHERE CASE r.method WHEN 'percent' THEN round(_value * r.value / 100, 2) ELSE r.value END > 0;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;
REVOKE EXECUTE ON FUNCTION public.apply_landed_cost_rules(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_landed_cost_rules(uuid) TO authenticated;

CREATE VIEW public.import_file_cost_comparison WITH (security_invoker = true) AS
SELECT c.tenant_id, c.import_file_id, t.id AS cost_type_id, t.code, t.label,
       COALESCE(sum(c.amount) FILTER (WHERE c.is_estimate), 0) AS estimated,
       COALESCE(sum(c.amount) FILTER (WHERE NOT c.is_estimate), 0) AS actual,
       COALESCE(sum(c.amount) FILTER (WHERE NOT c.is_estimate), 0) - COALESCE(sum(c.amount) FILTER (WHERE c.is_estimate), 0) AS variance
  FROM public.import_file_costs c JOIN public.landed_cost_types t ON t.id = c.cost_type_id
 GROUP BY c.tenant_id, c.import_file_id, t.id, t.code, t.label;
GRANT SELECT ON public.import_file_cost_comparison TO authenticated;

-- ─── Fonctions existantes étendues ───
CREATE OR REPLACE FUNCTION public.on_gr_completed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _po public.purchase_orders%ROWTYPE;
  _ligne record;
  _lignes integer;
  _restant numeric;
BEGIN
  -- En-tête figé et création « en attente » : garde_goods_receipt (BEFORE). Ici, la validation.
  IF TG_OP <> 'UPDATE' OR NEW.status <> 'completed' OR OLD.status = 'completed' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO _po FROM public.purchase_orders WHERE id = NEW.po_id FOR UPDATE;
  IF NOT FOUND OR _po.tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'Réception % : commande introuvable', NEW.gr_number USING ERRCODE = 'QG004';
  END IF;
  IF _po.status NOT IN ('approved', 'ordered', 'partially_received') THEN
    RAISE EXCEPTION 'Réception refusée : la commande % est « % » (approuvée, commandée ou partiellement reçue requise)',
      _po.po_number, _po.status USING ERRCODE = 'QG004';
  END IF;

  -- La réception est datée : elle tombe dans une période ouverte des achats (calendrier V33).
  PERFORM public.assert_fiscal_period_open(NEW.tenant_id, NEW.receipt_date, 'PURCHASING');

  SELECT count(*) INTO _lignes FROM public.gr_lines WHERE gr_id = NEW.id;
  IF _lignes = 0 THEN
    RAISE EXCEPTION 'Réception % sans ligne', NEW.gr_number USING ERRCODE = 'QG004';
  END IF;

  -- Chaque ligne reçue se rapporte à une ligne de CETTE commande, sans dépasser le restant dû.
  FOR _ligne IN
    SELECT gl.id, gl.po_line_id, gl.item_id AS gr_item, gl.quantity_received, gl.quantity_rejected, pl.po_id, pl.quantity AS commande,
           pl.item_id, pl.unit_cost, pl.description,
           COALESCE((SELECT sum(g2.quantity_received) FROM public.gr_lines g2
                       JOIN public.goods_receipts r2 ON r2.id = g2.gr_id
                      WHERE g2.po_line_id = gl.po_line_id AND r2.status = 'completed' AND r2.id <> NEW.id), 0)
             - public.po_line_returned(gl.po_line_id, true) AS deja_recu
    FROM public.gr_lines gl
    LEFT JOIN public.po_lines pl ON pl.id = gl.po_line_id
    WHERE gl.gr_id = NEW.id
  LOOP
    IF _ligne.po_line_id IS NULL OR _ligne.po_id IS DISTINCT FROM NEW.po_id THEN
      RAISE EXCEPTION 'Réception % : chaque ligne doit se rapporter à une ligne de la commande %', NEW.gr_number, _po.po_number
        USING ERRCODE = 'QG004';
    END IF;
    IF _ligne.gr_item IS NOT NULL AND _ligne.item_id IS NOT NULL AND _ligne.gr_item <> _ligne.item_id THEN
      RAISE EXCEPTION 'Réception % : l''article reçu diffère de celui de la ligne de commande « % »', NEW.gr_number,
        COALESCE(_ligne.description, 'ligne') USING ERRCODE = 'QG004';
    END IF;
    IF COALESCE(_ligne.quantity_received, 0) < 0 OR COALESCE(_ligne.quantity_rejected, 0) < 0 THEN
      RAISE EXCEPTION 'Réception % : quantités négatives refusées', NEW.gr_number USING ERRCODE = 'QG004';
    END IF;
    _restant := _ligne.commande - _ligne.deja_recu;
    IF _ligne.quantity_received > _restant THEN
      RAISE EXCEPTION 'Sur-réception refusée (« % ») : commandé %, déjà reçu %, reçu maintenant %',
        COALESCE(_ligne.description, 'ligne'), _ligne.commande, _ligne.deja_recu, _ligne.quantity_received
        USING ERRCODE = 'QG004';
    END IF;
  END LOOP;

  -- Stock : un seul mouvement par ligne, valorisé au coût de la commande ; apply_stock_movement met
  -- à jour la quantité et le coût moyen (plus de mise à jour directe de items).
  INSERT INTO public.stock_movements (tenant_id, item_id, movement_type, quantity, unit_cost, movement_date,
                                      reference_type, reference_id, created_by, warehouse_id)
  SELECT NEW.tenant_id, COALESCE(gl.item_id, pl.item_id), 'receipt', gl.quantity_received, COALESCE(pl.unit_cost, 0),
         COALESCE(NEW.receipt_date, CURRENT_DATE), 'goods_receipt', NEW.id, NEW.received_by, NEW.warehouse_id
  FROM public.gr_lines gl
  JOIN public.po_lines pl ON pl.id = gl.po_line_id
  WHERE gl.gr_id = NEW.id AND COALESCE(gl.item_id, pl.item_id) IS NOT NULL AND gl.quantity_received > 0;

  -- Statut de la commande : entièrement reçue ou partiellement reçue.
  UPDATE public.purchase_orders p
     SET status = CASE WHEN NOT EXISTS (
           SELECT 1 FROM public.po_lines pl
            WHERE pl.po_id = p.id
              AND pl.quantity > COALESCE((SELECT sum(g.quantity_received) FROM public.gr_lines g
                                            JOIN public.goods_receipts r ON r.id = g.gr_id
                                           WHERE g.po_line_id = pl.id AND r.status = 'completed'), 0)
                                - public.po_line_returned(pl.id, true)
         ) THEN 'received' ELSE 'partially_received' END
   WHERE p.id = NEW.po_id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.on_stock_movement_je()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _permanent boolean;
  _stock_acc uuid; _variation_acc uuid;
  _entry_id uuid;
  _value numeric := COALESCE(NEW.total_value, 0);
  _is_in boolean := COALESCE(NEW.quantity, 0) > 0;
  _label text;
BEGIN
  IF NEW.journal_entry_id IS NOT NULL OR NEW.status <> 'posted' OR _value <= 0 THEN RETURN NEW; END IF;
  -- Un transfert entre dépôts ne change pas la valeur du stock de la société.
  IF NEW.movement_type LIKE 'transfer%' THEN RETURN NEW; END IF;

  SELECT auto_je_on_movement INTO _permanent FROM public.inventory_settings WHERE tenant_id = NEW.tenant_id;
  IF NOT COALESCE(_permanent, true) THEN RETURN NEW; END IF;   -- inventaire intermittent

  -- Stock d'un dépôt de consolidation ou de transit : 381 « marchandises en cours de route » (V132).
  _stock_acc := public.require_posting_account(NEW.tenant_id, public.warehouse_stock_role(NEW.warehouse_id), public.item_account_set(NEW.item_id));
  _variation_acc := public.require_posting_account(NEW.tenant_id, 'STOCK_VARIATION', public.item_account_set(NEW.item_id));

  _label := CASE NEW.movement_type
              WHEN 'receipt' THEN 'Entrée en stock — réception'
              WHEN 'customer_return' THEN 'Entrée en stock — retour client'
              WHEN 'delivery' THEN 'Sortie de stock — livraison'
              WHEN 'supplier_return' THEN 'Sortie de stock — retour fournisseur'
              WHEN 'adjustment' THEN CASE WHEN _is_in THEN 'Ajustement de stock (excédent)' ELSE 'Ajustement de stock (manquant)' END
              ELSE CASE WHEN _is_in THEN 'Entrée en stock' ELSE 'Sortie de stock' END || ' — ' || NEW.movement_type
            END;

  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES (NEW.tenant_id, 'JE-STK-' || to_char(now(), 'YYYYMMDD') || '-' || substr(NEW.id::text, 1, 8),
          COALESCE(NEW.movement_date, CURRENT_DATE), _label, 'stock_movement', 'draft', NEW.created_by)
  RETURNING id INTO _entry_id;

  IF _is_in THEN
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _stock_acc, _value, 0, _label), (_entry_id, _variation_acc, 0, _value, _label);
  ELSE
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _variation_acc, _value, 0, _label), (_entry_id, _stock_acc, 0, _value, _label);
  END IF;

  UPDATE public.journal_entries SET status = 'posted', posted_by = NEW.created_by, posted_at = now() WHERE id = _entry_id;
  UPDATE public.stock_movements SET journal_entry_id = _entry_id WHERE id = NEW.id;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.transfer_stock(_item_id uuid, _from_wh uuid, _to_wh uuid, _qty numeric, _notes text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _i public.items%ROWTYPE;
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Aucune société active' USING ERRCODE = '42501'; END IF;
  IF NOT public.has_inventory_perm(auth.uid(), 'transfer') THEN
    RAISE EXCEPTION 'Droit insuffisant : %', (SELECT label FROM public.erp_permission_catalog WHERE code = 'inventory.transfer')
      USING ERRCODE = '42501';
  END IF;
  IF COALESCE(_qty, 0) <= 0 THEN RAISE EXCEPTION 'La quantité transférée doit être positive' USING ERRCODE = 'QG015'; END IF;
  IF _from_wh IS NULL OR _to_wh IS NULL OR _from_wh = _to_wh THEN
    RAISE EXCEPTION 'Choisir deux dépôts différents' USING ERRCODE = 'QG015';
  END IF;
  _i := public.stock_item_of_tenant(_tenant, _item_id, _from_wh);
  PERFORM public.stock_item_of_tenant(_tenant, _item_id, _to_wh);

  INSERT INTO public.stock_movements (tenant_id, item_id, movement_type, quantity, unit_cost, warehouse_id, reference_type,
                                      created_by, status, reason)
  VALUES (_tenant, _item_id, 'transfer_out', -_qty, COALESCE(_i.average_cost, 0), _from_wh, 'transfer', auth.uid(), 'posted',
          NULLIF(btrim(COALESCE(_notes, '')), '')),
         (_tenant, _item_id, 'transfer_in', _qty, COALESCE(_i.average_cost, 0), _to_wh, 'transfer', auth.uid(), 'posted',
          NULLIF(btrim(COALESCE(_notes, '')), ''));

  -- Dépôts de comptes différents (consolidation / transit ↔ dépôt de la société) : reclassement 381 ↔ 311 (V132).
  PERFORM public.stock_reclass_entry(_tenant, _item_id, _from_wh, _to_wh, _qty * COALESCE(_i.average_cost, 0), CURRENT_DATE, 'Transfert de stock');
  PERFORM public.notify_inventory(_tenant, 'info', 'Transfert stock', _qty || ' unités déplacées', _item_id::text);
END $function$;

CREATE OR REPLACE FUNCTION public.import_file_defaults()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Numéro d'expédition au format de la société (V132), séquence continue.
    IF NULLIF(btrim(NEW.file_number), '') IS NULL THEN
      NEW.file_number := public.next_import_file_number(NEW.tenant_id, NEW.forwarder_id, NEW.transport_mode);
    END IF;
    -- Dépôts par défaut de la société.
    SELECT COALESCE(NEW.consolidation_warehouse_id, s.default_consolidation_warehouse_id), COALESCE(NEW.transit_warehouse_id, s.default_transit_warehouse_id),
           COALESCE(NEW.destination_warehouse_id, s.default_destination_warehouse_id)
      INTO NEW.consolidation_warehouse_id, NEW.transit_warehouse_id, NEW.destination_warehouse_id
      FROM public.import_settings s WHERE s.tenant_id = NEW.tenant_id;
    INSERT INTO public.landed_cost_types (tenant_id, code, label, category, allocation_basis, capitalize)
    SELECT NEW.tenant_id, v.code, v.label, v.cat, v.basis, true FROM (VALUES
      ('FRET', 'Fret international', 'freight', 'value'), ('ASSUR', 'Assurance transport', 'insurance', 'value'),
      ('DD', 'Droit de douane', 'customs_duty', 'value'), ('RS', 'Redevance statistique', 'customs_fee', 'value'),
      ('PCS', 'Prélèvement communautaire de solidarité', 'customs_fee', 'value'), ('PC', 'Prélèvement communautaire CEDEAO', 'customs_fee', 'value'),
      ('TRANSIT', 'Honoraires du transitaire', 'transit', 'value'), ('MANUT', 'Manutention et magasinage', 'handling', 'quantity')) AS v(code, label, cat, basis)
     WHERE NOT EXISTS (SELECT 1 FROM public.landed_cost_types t WHERE t.tenant_id = NEW.tenant_id)
    ON CONFLICT (tenant_id, code) DO NOTHING;
    RETURN NEW;
  END IF;
  IF current_setting('qerp.import_allocation', true) = 'on' THEN RETURN NEW; END IF;
  IF OLD.status IN ('allocated', 'closed') AND NOT (OLD.status = 'allocated' AND NEW.status = 'closed'
       AND (to_jsonb(NEW) - 'status') = (to_jsonb(OLD) - 'status')) THEN
    RAISE EXCEPTION 'Dossier % : frais déjà répartis, le dossier ne se modifie plus (il peut seulement être clos)', OLD.file_number USING ERRCODE = 'QG032';
  END IF;
  IF NEW.status = 'allocated' OR NEW.allocation_entry_id IS DISTINCT FROM OLD.allocation_entry_id OR NEW.allocation_date IS DISTINCT FROM OLD.allocation_date THEN
    RAISE EXCEPTION 'La répartition des frais passe par « Répartir les frais »' USING ERRCODE = 'QG032';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.import_file_received_lines(_file uuid)
 RETURNS TABLE(gr_line_id uuid, gr_number text, item_id uuid, item_name text, quantity numeric, unit_cost numeric, value numeric, weight numeric, volume numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT gl.id, gr.gr_number, COALESCE(gl.item_id, pl.item_id), COALESCE(i.name, pl.description), gl.quantity_received, pl.unit_cost,
         round(gl.quantity_received * pl.unit_cost, 2), gl.quantity_received * COALESCE(i.weight_kg, 0), gl.quantity_received * COALESCE(i.volume_m3, 0)
    FROM public.import_file_orders o
    JOIN public.import_files f ON f.id = o.import_file_id AND f.tenant_id = public.get_user_tenant_id(auth.uid())
    JOIN public.goods_receipts gr ON gr.po_id = o.po_id AND gr.status = 'completed'
    JOIN public.gr_lines gl ON gl.gr_id = gr.id AND gl.quantity_received > 0
    JOIN public.po_lines pl ON pl.id = gl.po_line_id
    LEFT JOIN public.items i ON i.id = COALESCE(gl.item_id, pl.item_id)
   WHERE o.import_file_id = _file AND o.role = 'goods'
   ORDER BY gr.gr_number, gl.id
$function$;

CREATE OR REPLACE FUNCTION public.allocate_import_costs(_file uuid, _date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _f public.import_files%ROWTYPE;
  _c record;
  _basis text;
  _total numeric;
  _sum numeric;
  _entry uuid;
  _permanent boolean;
  _stock numeric := 0;
  _expense numeric := 0;
  _i record;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'procurement.import') THEN
    RAISE EXCEPTION 'Droit insuffisant : gérer les dossiers d''importation' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _f FROM public.import_files WHERE id = _file AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dossier introuvable dans la société active' USING ERRCODE = 'QG032'; END IF;
  IF _f.status IN ('allocated', 'closed') THEN RAISE EXCEPTION 'Dossier % : frais déjà répartis', _f.file_number USING ERRCODE = 'QG032'; END IF;
  _date := COALESCE(_date, CURRENT_DATE);
  PERFORM public.assert_fiscal_period_open(_tenant, _date, 'INVENTORY');

  DROP TABLE IF EXISTS _imp_lines;
  CREATE TEMP TABLE _imp_lines ON COMMIT DROP AS SELECT * FROM public.import_file_received_lines(_file);
  IF NOT EXISTS (SELECT 1 FROM _imp_lines) THEN
    RAISE EXCEPTION 'Dossier % : aucune réception validée sur ses commandes, rien à répartir', _f.file_number USING ERRCODE = 'QG032';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.import_file_costs ic JOIN public.landed_cost_types t ON t.id = ic.cost_type_id
                  WHERE ic.import_file_id = _file AND t.capitalize AND NOT ic.is_estimate) THEN
    RAISE EXCEPTION 'Dossier % : aucun frais réel incorporable au coût du stock (les estimations ne se répartissent pas)', _f.file_number USING ERRCODE = 'QG032';
  END IF;

  PERFORM set_config('qerp.import_allocation', 'on', true);
  FOR _c IN SELECT ic.*, t.allocation_basis AS type_basis, t.label AS type_label FROM public.import_file_costs ic
              JOIN public.landed_cost_types t ON t.id = ic.cost_type_id
             WHERE ic.import_file_id = _file AND t.capitalize AND NOT ic.is_estimate ORDER BY ic.created_at, ic.id LOOP
    _basis := COALESCE(_c.allocation_basis, _c.type_basis);
    SELECT sum(CASE _basis WHEN 'value' THEN value WHEN 'quantity' THEN quantity WHEN 'weight' THEN weight ELSE volume END) INTO _total FROM _imp_lines;
    IF COALESCE(_total, 0) <= 0 THEN
      RAISE EXCEPTION 'Frais « % » : base « % » nulle sur les lignes reçues (renseignez le poids ou le volume des articles, ou changez de base)',
        _c.type_label, _basis USING ERRCODE = 'QG032';
    END IF;
    INSERT INTO public.import_file_allocations (tenant_id, import_file_id, cost_id, gr_line_id, item_id, basis, basis_value, allocated)
    SELECT _tenant, _file, _c.id, l.gr_line_id, l.item_id, _basis, b.v, round(_c.amount * b.v / _total, 2)
      FROM _imp_lines l CROSS JOIN LATERAL (SELECT CASE _basis WHEN 'value' THEN l.value WHEN 'quantity' THEN l.quantity WHEN 'weight' THEN l.weight ELSE l.volume END AS v) b
     WHERE b.v > 0;
    -- L'arrondi va à la plus grosse ligne : la somme répartie est exactement le frais.
    SELECT sum(allocated) INTO _sum FROM public.import_file_allocations WHERE cost_id = _c.id;
    UPDATE public.import_file_allocations SET allocated = allocated + (_c.amount - _sum)
     WHERE id = (SELECT id FROM public.import_file_allocations WHERE cost_id = _c.id ORDER BY basis_value DESC, id LIMIT 1);
  END LOOP;

  -- Part en stock (au prorata du stock restant de l'article) et part déjà consommée (reste en charges).
  FOR _i IN SELECT a.item_id, sum(a.allocated) AS share,
                   (SELECT sum(l.quantity) FROM _imp_lines l WHERE l.item_id = a.item_id) AS received,
                   it.quantity_on_hand AS on_hand, it.average_cost AS avg_cost
              FROM public.import_file_allocations a LEFT JOIN public.items it ON it.id = a.item_id
             WHERE a.import_file_id = _file GROUP BY a.item_id, it.quantity_on_hand, it.average_cost LOOP
    IF _i.item_id IS NULL OR COALESCE(_i.on_hand, 0) <= 0 THEN
      UPDATE public.import_file_allocations SET to_expense = allocated, to_stock = 0 WHERE import_file_id = _file AND item_id IS NOT DISTINCT FROM _i.item_id;
    ELSE
      UPDATE public.import_file_allocations
         SET to_stock = round(allocated * least(_i.on_hand / NULLIF(_i.received, 0), 1), 2),
             to_expense = allocated - round(allocated * least(_i.on_hand / NULLIF(_i.received, 0), 1), 2)
       WHERE import_file_id = _file AND item_id = _i.item_id;
      UPDATE public.items
         SET average_cost = round((_i.on_hand * COALESCE(_i.avg_cost, 0)
                                   + (SELECT sum(to_stock) FROM public.import_file_allocations WHERE import_file_id = _file AND item_id = _i.item_id)) / _i.on_hand, 4)
       WHERE id = _i.item_id;
    END IF;
  END LOOP;
  SELECT COALESCE(sum(to_stock), 0), COALESCE(sum(to_expense), 0) INTO _stock, _expense FROM public.import_file_allocations WHERE import_file_id = _file;

  SELECT COALESCE(s.auto_je_on_movement, false) INTO _permanent FROM public.inventory_settings s WHERE s.tenant_id = _tenant;
  IF COALESCE(_permanent, false) AND _stock > 0 THEN
    _entry := gen_random_uuid();
    INSERT INTO public.journal_entries (id, tenant_id, entry_number, entry_date, description, source, status, created_by)
    VALUES (_entry, _tenant, 'JE-IMP-' || to_char(_date, 'YYYYMMDD') || '-' || substr(_entry::text, 1, 8), _date,
            'Frais d''approche du dossier ' || _f.file_number || ' incorporés au stock', 'landed_cost', 'draft', auth.uid());
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    SELECT _entry, public.require_posting_account(_tenant, 'INVENTORY', public.item_account_set(a.item_id)), sum(a.to_stock), 0, 'Stock — frais d''approche ' || _f.file_number
      FROM public.import_file_allocations a WHERE a.import_file_id = _file AND a.to_stock > 0 GROUP BY 2;
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    SELECT _entry, public.require_posting_account(_tenant, 'STOCK_VARIATION', public.item_account_set(a.item_id)), 0, sum(a.to_stock), 'Variation de stock — frais d''approche ' || _f.file_number
      FROM public.import_file_allocations a WHERE a.import_file_id = _file AND a.to_stock > 0 GROUP BY 2;
    UPDATE public.journal_entries SET status = 'posted', posted_by = auth.uid(), posted_at = now() WHERE id = _entry;
  END IF;

  UPDATE public.import_files SET status = 'allocated', allocation_date = _date, allocation_entry_id = _entry WHERE id = _file;
  PERFORM set_config('qerp.import_allocation', 'off', true);
  RETURN jsonb_build_object('to_stock', _stock, 'to_expense', _expense, 'entry_id', _entry);
END $function$;

CREATE OR REPLACE FUNCTION public.shipment_event_effects()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _f public.import_files%ROWTYPE; _target text; _rank jsonb := '{"open":0,"in_transit":1,"arrived":2,"cleared":3,"allocated":9,"closed":9}';
BEGIN
  IF NEW.import_file_id IS NULL AND NEW.po_id IS NOT NULL THEN
    SELECT o.import_file_id INTO NEW.import_file_id FROM public.import_file_orders o WHERE o.po_id = NEW.po_id;
  END IF;
  IF NEW.import_file_id IS NOT NULL AND NEW.po_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.import_file_orders o WHERE o.import_file_id = NEW.import_file_id AND o.po_id = NEW.po_id) THEN
    RAISE EXCEPTION 'La commande n''est pas rattachée à ce dossier d''importation' USING ERRCODE = 'QG033';
  END IF;
  NEW.container_number := NULLIF(upper(regexp_replace(COALESCE(NEW.container_number, ''), '\s', '', 'g')), '');
  IF NEW.import_file_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO _f FROM public.import_files WHERE id = NEW.import_file_id;
  IF _f.status IN ('allocated', 'closed') THEN RETURN NEW; END IF;
  SELECT file_status INTO _target FROM public.shipment_event_codes WHERE code = NEW.event_code;
  PERFORM set_config('qerp.import_tracking', 'on', true);
  IF NEW.event_class = 'actual' THEN
    UPDATE public.import_files SET
      status = CASE WHEN _target IS NOT NULL AND (_rank ->> _target)::int > (_rank ->> status)::int THEN _target ELSE status END,
      arrival_date = CASE WHEN NEW.event_code = 'ARRIVED' THEN COALESCE(arrival_date, NEW.event_at::date) ELSE arrival_date END,
      vessel = COALESCE(vessel, NEW.vessel), voyage = COALESCE(voyage, NEW.voyage)
     WHERE id = _f.id;
  ELSIF NEW.event_code = 'ARRIVED' THEN
    UPDATE public.import_files SET eta = NEW.event_at::date, initial_eta = COALESCE(initial_eta, eta, NEW.event_at::date) WHERE id = _f.id;
  ELSIF NEW.event_code = 'DEPARTED' THEN
    UPDATE public.import_files SET etd = NEW.event_at::date WHERE id = _f.id;
  END IF;
  PERFORM set_config('qerp.import_tracking', 'off', true);
  -- Transferts de transit déclenchés par les événements réels, si la société l'a choisi (V132) : départ → expédition,
  -- livraison → arrivée en dépôt. Un transfert impossible (rien à transférer, dépôt manquant) n'empêche pas l'événement.
  IF NEW.event_class = 'actual' AND NEW.event_code IN ('DEPARTED', 'DELIVERED')
     AND COALESCE((SELECT s.auto_transit_transfers FROM public.import_settings s WHERE s.tenant_id = NEW.tenant_id), false) THEN
    BEGIN
      PERFORM public.import_file_transit_transfer(NEW.import_file_id, CASE NEW.event_code WHEN 'DEPARTED' THEN 'ship' ELSE 'deliver' END, NEW.event_at::date);
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Transfert de transit non effectué pour le dossier % : %', _f.file_number, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END $function$;

SELECT public.install_tenant_isolation_triggers();
