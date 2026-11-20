-- V131 — Suivi des commandes et des expéditions (lot I3 ; références : norme DCSA Track & Trace des compagnies
-- maritimes — événements d'expédition, de transport et d'équipement, observés à une date et un lieu —, SAP Global Track
-- and Trace — événements prévus / estimés / réels rattachés à la commande et à la livraison entrante —, plateformes de
-- suivi multi-transporteurs par connaissement ou conteneur).
--   shipment_event_codes      étapes de référence (marchandise prête → réservation → entrée terminal → chargement →
--                             départ → transbordement → arrivée → déchargement → déclaration → mainlevée → sortie
--                             terminal → livraison) et effet sur le statut du dossier d'import ;
--   shipment_events           événements d'une commande ou d'un dossier : prévu, estimé ou réel, date, lieu (code
--                             UN/LOCODE ou libellé), navire / vol, voyage, conteneur, source (saisie, fichier importé,
--                             fournisseur de suivi), référence externe (sans doublon) ;
--   effet automatique         un événement réel fait avancer le dossier (départ → en transit, arrivée ou déchargement →
--                             arrivé, mainlevée → dédouané, jamais en arrière ni après répartition), l'arrivée réelle
--                             renseigne la date d'arrivée, une arrivée estimée met à jour l'ETA (l'ETA initiale est
--                             conservée pour mesurer le retard) ;
--   shipment_timeline         chronologie complète sans ressaisie : faits de l'ERP (commande, accusé de réception du
--                             fournisseur, date de livraison prévue, réceptions validées) + événements ;
--   shipment_tracking_status  par dossier : dernier événement réel, ETA initiale et actuelle, retard en jours, état
--                             (à l'heure, en retard, arrivé, livré) ;
--   import_shipment_events    import d'un fichier de suivi (transitaire, compagnie) tout ou rien, sans doublon ;
--   create_import_file_from_po   dossier ouvert depuis une commande, déjà rempli (fournisseur, Incoterm, commande).
-- Droits : procurement.import ou procurement.followup.

ALTER TABLE public.import_files
  ADD COLUMN carrier text,
  ADD COLUMN vessel text,
  ADD COLUMN voyage text,
  ADD COLUMN port_of_loading text,
  ADD COLUMN port_of_discharge text,
  ADD COLUMN etd date,
  ADD COLUMN initial_eta date;
UPDATE public.import_files SET initial_eta = eta WHERE eta IS NOT NULL;

CREATE TABLE public.shipment_event_codes (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z_]{2,30}$'),
  label text NOT NULL,
  stage integer NOT NULL,
  file_status text CHECK (file_status IN ('in_transit', 'arrived', 'cleared')),
  keywords text[] NOT NULL DEFAULT '{}'
);
INSERT INTO public.shipment_event_codes (code, label, stage, file_status, keywords) VALUES
  ('CARGO_READY', 'Marchandise prête chez le fournisseur', 10, NULL, '{prête,ready,cargo ready,disponible}'),
  ('BOOKED', 'Réservation confirmée', 20, NULL, '{réservation,booking,booked,confirmed}'),
  ('GATE_IN', 'Conteneur entré au terminal de départ', 30, NULL, '{gate in,entrée terminal,full in,received at terminal}'),
  ('LOADED', 'Chargé à bord', 40, NULL, '{loaded,chargé,load on vessel,embarqué}'),
  ('DEPARTED', 'Départ', 50, 'in_transit', '{departed,départ,sailed,vessel departure,décollé,departure}'),
  ('TRANSSHIPMENT', 'Transbordement', 60, 'in_transit', '{transshipment,transbordement,transhipment}'),
  ('ARRIVED', 'Arrivée au port ou à l''aéroport', 70, 'arrived', '{arrived,arrivée,arrival,vessel arrival,atterri}'),
  ('DISCHARGED', 'Déchargé', 80, 'arrived', '{discharged,déchargé,unloaded,débarqué}'),
  ('CUSTOMS_DECLARED', 'Déclaration en douane déposée', 90, NULL, '{déclaration,declared,customs declaration,dépôt déclaration}'),
  ('CUSTOMS_RELEASED', 'Mainlevée (bon à enlever)', 100, 'cleared', '{mainlevée,bon à enlever,bae,released,customs release,cleared}'),
  ('GATE_OUT', 'Sortie du terminal', 110, 'cleared', '{gate out,sortie terminal,full out,enlevé}'),
  ('DELIVERED', 'Livré à l''entrepôt', 120, NULL, '{delivered,livré,livraison effectuée}');

CREATE TABLE public.shipment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  import_file_id uuid REFERENCES public.import_files (id) ON DELETE CASCADE,
  po_id uuid REFERENCES public.purchase_orders (id) ON DELETE CASCADE,
  event_code text NOT NULL REFERENCES public.shipment_event_codes (code),
  event_class text NOT NULL DEFAULT 'actual' CHECK (event_class IN ('planned', 'estimated', 'actual')),
  event_at timestamptz NOT NULL,
  location text,
  vessel text,
  voyage text,
  container_number text CHECK (container_number IS NULL OR container_number ~ '^[A-Z]{4}[0-9]{7}$'),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import', 'provider')),
  external_ref text,
  notes text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (import_file_id IS NOT NULL OR po_id IS NOT NULL)
);
CREATE UNIQUE INDEX shipment_events_external_ref ON public.shipment_events (tenant_id, source, external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX shipment_events_file ON public.shipment_events (import_file_id, event_at);
CREATE INDEX shipment_events_po ON public.shipment_events (po_id, event_at);

ALTER TABLE public.shipment_event_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipment_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture du référentiel" ON public.shipment_event_codes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Lecture société" ON public.shipment_events FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Saisie habilitée" ON public.shipment_events FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid())
         AND (public.has_permission(auth.uid(), 'procurement.import') OR public.has_permission(auth.uid(), 'procurement.followup')))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid())
         AND (public.has_permission(auth.uid(), 'procurement.import') OR public.has_permission(auth.uid(), 'procurement.followup')));
GRANT SELECT ON public.shipment_event_codes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shipment_events TO authenticated;

-- Commande et dossier cohérents ; effet d'un événement sur le dossier d'import.
CREATE FUNCTION public.shipment_event_effects()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  RETURN NEW;
END $$;
CREATE TRIGGER trg_shipment_event_effects BEFORE INSERT ON public.shipment_events
  FOR EACH ROW EXECUTE FUNCTION public.shipment_event_effects();

-- L'ETA initiale se fige à la première ETA connue.
CREATE FUNCTION public.import_file_initial_eta()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.initial_eta IS NULL AND NEW.eta IS NOT NULL THEN NEW.initial_eta := NEW.eta; END IF;
  IF TG_OP = 'UPDATE' AND OLD.initial_eta IS NOT NULL THEN NEW.initial_eta := OLD.initial_eta; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_import_file_initial_eta BEFORE INSERT OR UPDATE ON public.import_files
  FOR EACH ROW EXECUTE FUNCTION public.import_file_initial_eta();

CREATE FUNCTION public.shipment_timeline(_import_file uuid DEFAULT NULL, _po uuid DEFAULT NULL)
RETURNS TABLE (event_at timestamptz, event_code text, label text, event_class text, origin text, location text, detail text, po_number text)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH t AS (SELECT public.get_user_tenant_id(auth.uid()) AS id),
  pos AS (
    SELECT po.* FROM public.purchase_orders po
     WHERE po.tenant_id = (SELECT id FROM t)
       AND ((_po IS NOT NULL AND po.id = _po)
            OR (_import_file IS NOT NULL AND po.id IN (SELECT o.po_id FROM public.import_file_orders o WHERE o.import_file_id = _import_file))))
  SELECT po.order_date::timestamptz, 'PO_ORDERED', 'Commande passée', 'actual', 'erp', NULL::text, NULL::text, po.po_number FROM pos po
  UNION ALL
  SELECT l.created_at, 'PO_ACKNOWLEDGED', 'Commande confirmée par le fournisseur', 'actual', 'erp', NULL, l.supplier_reference, po.po_number
    FROM pos po JOIN public.purchase_order_followup_log l ON l.po_id = po.id AND l.event = 'acknowledged'
  UNION ALL
  SELECT po.expected_date::timestamptz, 'DELIVERY_PLANNED', 'Livraison prévue (commande)', 'planned', 'erp', NULL, NULL, po.po_number
    FROM pos po WHERE po.expected_date IS NOT NULL
  UNION ALL
  SELECT gr.receipt_date::timestamptz, 'RECEIVED', 'Réception validée ' || gr.gr_number, 'actual', 'erp', NULL, NULL, po.po_number
    FROM pos po JOIN public.goods_receipts gr ON gr.po_id = po.id AND gr.status = 'completed'
  UNION ALL
  SELECT e.event_at, e.event_code, c.label, e.event_class, e.source, e.location,
         concat_ws(' · ', NULLIF(e.vessel, ''), NULLIF(e.voyage, ''), NULLIF(e.container_number, ''), NULLIF(e.notes, '')),
         (SELECT po_number FROM public.purchase_orders WHERE id = e.po_id)
    FROM public.shipment_events e JOIN public.shipment_event_codes c ON c.code = e.event_code
   WHERE e.tenant_id = (SELECT id FROM t)
     AND ((_import_file IS NOT NULL AND e.import_file_id = _import_file) OR (_po IS NOT NULL AND e.po_id = _po))
  ORDER BY 1, 2
$$;
REVOKE EXECUTE ON FUNCTION public.shipment_timeline(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shipment_timeline(uuid, uuid) TO authenticated;

CREATE VIEW public.shipment_tracking_status WITH (security_invoker = true) AS
SELECT f.id AS import_file_id, f.tenant_id, f.file_number, f.status, f.initial_eta, f.eta, f.arrival_date,
       last.event_code AS last_event_code, last.label AS last_event_label, last.event_at AS last_event_at, last.location AS last_event_location,
       CASE WHEN f.initial_eta IS NOT NULL AND COALESCE(f.arrival_date, f.eta) IS NOT NULL THEN COALESCE(f.arrival_date, f.eta) - f.initial_eta END AS delay_days,
       CASE
         WHEN EXISTS (SELECT 1 FROM public.shipment_events e WHERE e.import_file_id = f.id AND e.event_code = 'DELIVERED' AND e.event_class = 'actual')
           OR f.status IN ('allocated', 'closed') THEN 'delivered'
         WHEN f.arrival_date IS NOT NULL OR f.status IN ('arrived', 'cleared') THEN 'arrived'
         WHEN f.eta IS NOT NULL AND f.eta < CURRENT_DATE THEN 'overdue'
         WHEN f.initial_eta IS NOT NULL AND f.eta > f.initial_eta THEN 'delayed'
         ELSE 'on_time'
       END AS tracking_state
  FROM public.import_files f
  LEFT JOIN LATERAL (
    SELECT e.event_code, c.label, e.event_at, e.location FROM public.shipment_events e JOIN public.shipment_event_codes c ON c.code = e.event_code
     WHERE e.import_file_id = f.id AND e.event_class = 'actual' ORDER BY e.event_at DESC, c.stage DESC LIMIT 1) last ON true;
GRANT SELECT ON public.shipment_tracking_status TO authenticated;

-- Import d'un fichier de suivi : tout ou rien, lignes refusées listées, doublons ignorés (référence calculée).
CREATE FUNCTION public.import_shipment_events(_import_file uuid, _rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _r jsonb; _i integer := 0; _code text; _at timestamptz; _errors text[] := '{}'; _added integer := 0; _ref text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.import_files WHERE id = _import_file AND tenant_id = _tenant) THEN
    RAISE EXCEPTION 'Dossier introuvable dans la société active' USING ERRCODE = 'QG033';
  END IF;
  IF jsonb_typeof(_rows) <> 'array' OR jsonb_array_length(_rows) = 0 THEN RAISE EXCEPTION 'Aucune ligne à importer' USING ERRCODE = 'QG033'; END IF;
  FOR _r IN SELECT * FROM jsonb_array_elements(_rows) LOOP
    _i := _i + 1;
    _code := upper(_r ->> 'event_code');
    BEGIN _at := (_r ->> 'event_at')::timestamptz; EXCEPTION WHEN others THEN _at := NULL; END;
    IF NOT EXISTS (SELECT 1 FROM public.shipment_event_codes WHERE code = _code) THEN _errors := _errors || format('ligne %s : étape non reconnue', _i); CONTINUE; END IF;
    IF _at IS NULL THEN _errors := _errors || format('ligne %s : date illisible', _i); CONTINUE; END IF;
  END LOOP;
  IF cardinality(_errors) > 0 THEN
    RAISE EXCEPTION 'Fichier de suivi refusé : %', array_to_string(_errors[1:10], ' ; ') USING ERRCODE = 'QG033';
  END IF;
  FOR _r IN SELECT * FROM jsonb_array_elements(_rows) LOOP
    _ref := md5(concat_ws('|', upper(_r ->> 'event_code'), _r ->> 'event_at', COALESCE(_r ->> 'event_class', 'actual'), upper(COALESCE(_r ->> 'container_number', '')), COALESCE(_r ->> 'location', '')));
    INSERT INTO public.shipment_events (tenant_id, import_file_id, event_code, event_class, event_at, location, vessel, voyage, container_number, source, external_ref, notes)
    VALUES (_tenant, _import_file, upper(_r ->> 'event_code'), COALESCE(NULLIF(_r ->> 'event_class', ''), 'actual'), (_r ->> 'event_at')::timestamptz,
            NULLIF(_r ->> 'location', ''), NULLIF(_r ->> 'vessel', ''), NULLIF(_r ->> 'voyage', ''), NULLIF(_r ->> 'container_number', ''), 'import', _ref,
            NULLIF(_r ->> 'notes', ''))
    ON CONFLICT (tenant_id, source, external_ref) WHERE external_ref IS NOT NULL DO NOTHING;
    IF FOUND THEN _added := _added + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('added', _added, 'ignored', jsonb_array_length(_rows) - _added);
END $$;
REVOKE EXECUTE ON FUNCTION public.import_shipment_events(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_shipment_events(uuid, jsonb) TO authenticated;

-- Dossier ouvert depuis une commande, déjà rempli.
CREATE FUNCTION public.create_import_file_from_po(_po uuid)
RETURNS uuid LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _p public.purchase_orders%ROWTYPE; _id uuid;
BEGIN
  SELECT * INTO _p FROM public.purchase_orders WHERE id = _po AND tenant_id = public.get_user_tenant_id(auth.uid());
  IF NOT FOUND THEN RAISE EXCEPTION 'Commande introuvable dans la société active' USING ERRCODE = 'QG033'; END IF;
  IF EXISTS (SELECT 1 FROM public.import_file_orders WHERE po_id = _po) THEN
    RAISE EXCEPTION 'La commande % appartient déjà à un dossier d''importation', _p.po_number USING ERRCODE = 'QG033';
  END IF;
  INSERT INTO public.import_files (tenant_id, supplier_id, incoterm, eta, origin_country)
  VALUES (_p.tenant_id, _p.supplier_id, _p.incoterm, _p.expected_date,
          (SELECT CASE WHEN s.country ~ '^[A-Z]{2}$' THEN s.country END FROM public.suppliers s WHERE s.id = _p.supplier_id))
  RETURNING id INTO _id;
  INSERT INTO public.import_file_orders (tenant_id, import_file_id, po_id) VALUES (_p.tenant_id, _id, _po);
  RETURN _id;
END $$;
REVOKE EXECUTE ON FUNCTION public.create_import_file_from_po(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_import_file_from_po(uuid) TO authenticated;

SELECT public.install_tenant_isolation_triggers();
