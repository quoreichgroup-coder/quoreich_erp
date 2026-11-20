-- V129 — Achats internationaux, lot I2 : dossier d'importation, frais d'approche répartis dans le coût du stock, douane
-- UEMOA en données (docs/audit-erp/11 §5 et §7, décisions D-I2 à D-I5 ; SAP « conditions de coût d'acquisition »,
-- Sage X3 « frais d'approche », Odoo « landed costs »).
--   import_files              dossier : fournisseur, transitaire, Incoterm, transport, connaissement / LTA, conteneurs,
--                             ETA, bureau et déclaration de douane, pays de destination et catégorie TEC ; numéro
--                             IMP-AAAA-#### ; commandes rattachées (import_file_orders, une commande = un dossier) ;
--   landed_cost_types         types de frais propres à la société (fret, assurance, droit de douane, RS, PCS, PC,
--                             transit, manutention…), base de répartition par défaut (valeur, quantité, poids, volume)
--                             et incorporation ou non au coût du stock ; créés au premier dossier, modifiables ;
--   import_file_costs         frais du dossier (montant HT en devise de la société, facture du transitaire, du
--                             transporteur, de l'assureur ou de la douane citée) ; la facture se comptabilise par son
--                             propre circuit (6015, TVA import 4452) ;
--   customs_tariffs           taux par pays (lignes de référence sans société, à confirmer par le transitaire avant mise
--                             en service, et lignes de la société qui priment) ; customs_estimate(pays, catégorie, valeur
--                             CAF) calcule DD, RS, PCS, PC et la TVA à l'importation (base CAF + droits) ;
--   allocate_import_costs     répartit les frais incorporables sur les lignes reçues des commandes du dossier (base de
--                             chaque frais), relève le coût moyen de la part encore en stock et passe, en inventaire
--                             permanent, l'écriture complémentaire 311 / 6031 (jeux de comptes des articles) ; la part
--                             déjà vendue reste en charges ; le dossier est alors figé (import_file_allocations).
-- Droit : procurement.import (catalogue 140).

ALTER TABLE public.items ADD COLUMN weight_kg numeric(18, 4) CHECK (weight_kg >= 0), ADD COLUMN volume_m3 numeric(18, 6) CHECK (volume_m3 >= 0);

CREATE TABLE public.landed_cost_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_]{1,20}$'),
  label text NOT NULL,
  category text NOT NULL CHECK (category IN ('freight', 'insurance', 'customs_duty', 'customs_fee', 'transit', 'handling', 'other')),
  allocation_basis text NOT NULL DEFAULT 'value' CHECK (allocation_basis IN ('value', 'quantity', 'weight', 'volume')),
  capitalize boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, code),
  UNIQUE (id, tenant_id)
);

CREATE TABLE public.import_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  file_number text,
  supplier_id uuid NOT NULL REFERENCES public.suppliers (id),
  forwarder_id uuid REFERENCES public.suppliers (id),
  incoterm text,
  transport_mode text CHECK (transport_mode IN ('sea', 'air', 'road', 'rail', 'multimodal')),
  bill_of_lading text,
  containers text,
  origin_country text CHECK (origin_country ~ '^[A-Z]{2}$'),
  destination_country text CHECK (destination_country ~ '^[A-Z]{2}$'),
  tec_category numeric(5, 2),
  customs_office text,
  customs_declaration text,
  customs_date date,
  eta date,
  arrival_date date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_transit', 'arrived', 'cleared', 'allocated', 'closed')),
  allocation_date date,
  allocation_entry_id uuid REFERENCES public.journal_entries (id),
  notes text,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, file_number)
);

CREATE TABLE public.import_file_orders (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  import_file_id uuid NOT NULL REFERENCES public.import_files (id) ON DELETE CASCADE,
  po_id uuid NOT NULL UNIQUE REFERENCES public.purchase_orders (id),
  PRIMARY KEY (import_file_id, po_id)
);

CREATE TABLE public.import_file_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  import_file_id uuid NOT NULL REFERENCES public.import_files (id) ON DELETE CASCADE,
  cost_type_id uuid NOT NULL REFERENCES public.landed_cost_types (id),
  description text,
  amount numeric(18, 2) NOT NULL CHECK (amount > 0),
  allocation_basis text CHECK (allocation_basis IN ('value', 'quantity', 'weight', 'volume')),
  ap_invoice_id uuid REFERENCES public.ap_invoices (id),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.import_file_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  import_file_id uuid NOT NULL REFERENCES public.import_files (id) ON DELETE CASCADE,
  cost_id uuid NOT NULL REFERENCES public.import_file_costs (id) ON DELETE CASCADE,
  gr_line_id uuid NOT NULL REFERENCES public.gr_lines (id),
  item_id uuid REFERENCES public.items (id),
  basis text NOT NULL,
  basis_value numeric NOT NULL,
  allocated numeric(18, 2) NOT NULL,
  to_stock numeric(18, 2) NOT NULL DEFAULT 0,
  to_expense numeric(18, 2) NOT NULL DEFAULT 0
);

CREATE TABLE public.customs_tariffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants (id) ON DELETE CASCADE,
  country text NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_]{1,20}$'),
  label text NOT NULL,
  tec_category numeric(5, 2),
  rate numeric(7, 4) NOT NULL CHECK (rate >= 0 AND rate <= 100),
  base text NOT NULL DEFAULT 'cif' CHECK (base IN ('cif', 'cif_plus_duties')),
  capitalize boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  is_validated boolean NOT NULL DEFAULT false,
  source text
);
CREATE UNIQUE INDEX customs_tariffs_unique ON public.customs_tariffs
  (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), country, code, COALESCE(tec_category, -1));

-- Référence UEMOA (TEC 2022) pour le Burkina Faso et la Côte d'Ivoire, à confirmer par le transitaire.
INSERT INTO public.customs_tariffs (tenant_id, country, code, label, tec_category, rate, base, capitalize, sort_order, is_validated, source)
SELECT NULL, c.country, v.code, v.label, v.cat, v.rate, v.base, v.cap, v.ord, false, 'TEC UEMOA 2022 — à confirmer par le transitaire'
  FROM (VALUES ('BF'), ('CI')) AS c(country)
 CROSS JOIN (VALUES
   ('DD', 'Droit de douane (catégorie 0)', 0::numeric, 0::numeric, 'cif', true, 10),
   ('DD', 'Droit de douane (catégorie 1, 5 %)', 5, 5, 'cif', true, 10),
   ('DD', 'Droit de douane (catégorie 2, 10 %)', 10, 10, 'cif', true, 10),
   ('DD', 'Droit de douane (catégorie 3, 20 %)', 20, 20, 'cif', true, 10),
   ('DD', 'Droit de douane (catégorie 4, 35 %)', 35, 35, 'cif', true, 10),
   ('RS', 'Redevance statistique', NULL, 1, 'cif', true, 20),
   ('PCS', 'Prélèvement communautaire de solidarité UEMOA', NULL, 0.8, 'cif', true, 30),
   ('PC', 'Prélèvement communautaire CEDEAO', NULL, 0.5, 'cif', true, 40),
   ('TVA', 'TVA à l''importation (récupérable)', NULL, 18, 'cif_plus_duties', false, 90)) AS v(code, label, cat, rate, base, cap, ord);

ALTER TABLE public.landed_cost_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_file_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_file_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_file_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customs_tariffs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Lecture société" ON public.landed_cost_types FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Paramétrage habilité" ON public.landed_cost_types FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'procurement.import'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'procurement.import'));
CREATE POLICY "Lecture société" ON public.import_files FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Saisie habilitée" ON public.import_files FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'procurement.import'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'procurement.import'));
CREATE POLICY "Lecture société" ON public.import_file_orders FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Saisie habilitée" ON public.import_file_orders FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'procurement.import'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'procurement.import'));
CREATE POLICY "Lecture société" ON public.import_file_costs FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Saisie habilitée" ON public.import_file_costs FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'procurement.import'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'procurement.import'));
CREATE POLICY "Lecture société" ON public.import_file_allocations FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Lecture référence et société" ON public.customs_tariffs FOR SELECT TO authenticated
  USING (tenant_id IS NULL OR tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Paramétrage habilité" ON public.customs_tariffs FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'procurement.import'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'procurement.import'));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.landed_cost_types, public.import_files, public.import_file_orders, public.import_file_costs, public.customs_tariffs TO authenticated;
GRANT SELECT ON public.import_file_allocations TO authenticated;

-- Numéro, types de frais par défaut au premier dossier, dossier figé après répartition.
CREATE FUNCTION public.import_file_defaults()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NULLIF(btrim(NEW.file_number), '') IS NULL THEN
      INSERT INTO public.ar_numbering_series (tenant_id, doc_type, prefix, format, next_number, reset_frequency)
      SELECT NEW.tenant_id, 'import_file', 'IMP-', 'IMP-YYYY-####', 1, 'yearly'
       WHERE NOT EXISTS (SELECT 1 FROM public.ar_numbering_series WHERE tenant_id = NEW.tenant_id AND doc_type = 'import_file');
      NEW.file_number := public.next_document_number(NEW.tenant_id, 'import_file', CURRENT_DATE);
    END IF;
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
END $$;
CREATE TRIGGER trg_import_file_defaults BEFORE INSERT OR UPDATE ON public.import_files
  FOR EACH ROW EXECUTE FUNCTION public.import_file_defaults();

CREATE FUNCTION public.guard_import_file_children()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _file uuid := COALESCE(NEW.import_file_id, OLD.import_file_id); _status text; _num text;
BEGIN
  IF current_setting('qerp.import_allocation', true) = 'on' THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT status, file_number INTO _status, _num FROM public.import_files WHERE id = _file;
  IF TG_OP <> 'DELETE' THEN NEW.tenant_id := (SELECT tenant_id FROM public.import_files WHERE id = NEW.import_file_id); END IF;
  IF _status IN ('allocated', 'closed') THEN
    RAISE EXCEPTION 'Dossier % : frais déjà répartis, commandes et frais sont figés', _num USING ERRCODE = 'QG032';
  END IF;
  IF TG_TABLE_NAME = 'import_file_orders' AND TG_OP <> 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM public.purchase_orders po JOIN public.import_files f ON f.id = NEW.import_file_id
                    WHERE po.id = NEW.po_id AND po.tenant_id = f.tenant_id) THEN
      RAISE EXCEPTION 'Commande introuvable dans la société du dossier' USING ERRCODE = 'QG032';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'import_file_costs' AND TG_OP <> 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM public.landed_cost_types t JOIN public.import_files f ON f.id = NEW.import_file_id
                    WHERE t.id = NEW.cost_type_id AND t.tenant_id = f.tenant_id AND t.is_active) THEN
      RAISE EXCEPTION 'Type de frais inconnu ou inactif dans la société' USING ERRCODE = 'QG032';
    END IF;
    IF NEW.ap_invoice_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.ap_invoices i JOIN public.import_files f ON f.id = NEW.import_file_id
                    WHERE i.id = NEW.ap_invoice_id AND i.tenant_id = f.tenant_id) THEN
      RAISE EXCEPTION 'Facture citée introuvable dans la société du dossier' USING ERRCODE = 'QG032';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER trg_guard_import_file_orders BEFORE INSERT OR UPDATE OR DELETE ON public.import_file_orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_import_file_children();
CREATE TRIGGER trg_guard_import_file_costs BEFORE INSERT OR UPDATE OR DELETE ON public.import_file_costs
  FOR EACH ROW EXECUTE FUNCTION public.guard_import_file_children();

-- Estimation des droits et taxes à l'importation : taux de la société, sinon de référence ; DD selon la catégorie TEC.
CREATE FUNCTION public.customs_estimate(_country text, _tec_category numeric, _cif numeric)
RETURNS TABLE (code text, label text, base_amount numeric, rate numeric, amount numeric, capitalize boolean, is_validated boolean)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH t AS (SELECT public.get_user_tenant_id(auth.uid()) AS id),
  rates AS (
    SELECT DISTINCT ON (c.code) c.code, c.label, c.rate, c.base, c.capitalize, c.sort_order, c.is_validated
      FROM public.customs_tariffs c
     WHERE c.country = upper(_country) AND (c.tenant_id IS NULL OR c.tenant_id = (SELECT id FROM t))
       AND (c.code <> 'DD' OR c.tec_category = _tec_category)
     ORDER BY c.code, (c.tenant_id IS NULL) ASC),
  duties AS (SELECT COALESCE(sum(round(_cif * r.rate / 100, 0)), 0) AS d FROM rates r WHERE r.base = 'cif')
  SELECT r.code, r.label,
         CASE WHEN r.base = 'cif' THEN _cif ELSE _cif + (SELECT d FROM duties) END,
         r.rate,
         round((CASE WHEN r.base = 'cif' THEN _cif ELSE _cif + (SELECT d FROM duties) END) * r.rate / 100, 0),
         r.capitalize, r.is_validated
    FROM rates r ORDER BY r.sort_order, r.code
$$;
REVOKE EXECUTE ON FUNCTION public.customs_estimate(text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customs_estimate(text, numeric, numeric) TO authenticated;

-- Lignes reçues d'un dossier (réceptions validées de ses commandes), avec les bases de répartition.
CREATE FUNCTION public.import_file_received_lines(_file uuid)
RETURNS TABLE (gr_line_id uuid, gr_number text, item_id uuid, item_name text, quantity numeric, unit_cost numeric, value numeric, weight numeric, volume numeric)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT gl.id, gr.gr_number, COALESCE(gl.item_id, pl.item_id), COALESCE(i.name, pl.description), gl.quantity_received, pl.unit_cost,
         round(gl.quantity_received * pl.unit_cost, 2), gl.quantity_received * COALESCE(i.weight_kg, 0), gl.quantity_received * COALESCE(i.volume_m3, 0)
    FROM public.import_file_orders o
    JOIN public.import_files f ON f.id = o.import_file_id AND f.tenant_id = public.get_user_tenant_id(auth.uid())
    JOIN public.goods_receipts gr ON gr.po_id = o.po_id AND gr.status = 'completed'
    JOIN public.gr_lines gl ON gl.gr_id = gr.id AND gl.quantity_received > 0
    JOIN public.po_lines pl ON pl.id = gl.po_line_id
    LEFT JOIN public.items i ON i.id = COALESCE(gl.item_id, pl.item_id)
   WHERE o.import_file_id = _file
   ORDER BY gr.gr_number, gl.id
$$;
REVOKE EXECUTE ON FUNCTION public.import_file_received_lines(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_file_received_lines(uuid) TO authenticated;

CREATE FUNCTION public.allocate_import_costs(_file uuid, _date date DEFAULT CURRENT_DATE)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
                  WHERE ic.import_file_id = _file AND t.capitalize) THEN
    RAISE EXCEPTION 'Dossier % : aucun frais incorporable au coût du stock', _f.file_number USING ERRCODE = 'QG032';
  END IF;

  PERFORM set_config('qerp.import_allocation', 'on', true);
  FOR _c IN SELECT ic.*, t.allocation_basis AS type_basis, t.label AS type_label FROM public.import_file_costs ic
              JOIN public.landed_cost_types t ON t.id = ic.cost_type_id
             WHERE ic.import_file_id = _file AND t.capitalize ORDER BY ic.created_at, ic.id LOOP
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
END $$;
REVOKE EXECUTE ON FUNCTION public.allocate_import_costs(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allocate_import_costs(uuid, date) TO authenticated;

INSERT INTO public.erp_permission_catalog (code, module, action, label) VALUES
  ('procurement.import', 'procurement', 'import', 'Gérer les dossiers d''importation et les frais d''approche')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
SELECT r.code, 'procurement.import' FROM public.erp_system_roles r
 WHERE r.code IN ('admin', 'accountant', 'procurement_controller', 'procurement_l2', 'procurement_l3')
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, sp.permission_code
  FROM public.erp_roles r
  JOIN public.erp_system_role_permissions sp ON sp.role_code = r.code
 WHERE r.is_system AND sp.permission_code = 'procurement.import'
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

SELECT public.install_tenant_isolation_triggers();
