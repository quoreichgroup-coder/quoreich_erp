-- V133 — Doublons de suivi par dossier : la référence externe d'un événement importé (empreinte de l'étape, de la date,
-- du conteneur et du lieu) était unique pour toute la société ; un même événement importé dans un AUTRE dossier (même
-- jour, même port) était donc ignoré à tort. L'unicité porte désormais sur le dossier (ou la commande).
DROP INDEX public.shipment_events_external_ref;
CREATE UNIQUE INDEX shipment_events_external_ref ON public.shipment_events
  (tenant_id, COALESCE(import_file_id, po_id), source, external_ref) WHERE external_ref IS NOT NULL;

CREATE OR REPLACE FUNCTION public.import_shipment_events(_import_file uuid, _rows jsonb)
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
    ON CONFLICT (tenant_id, COALESCE(import_file_id, po_id), source, external_ref) WHERE external_ref IS NOT NULL DO NOTHING;
    IF FOUND THEN _added := _added + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('added', _added, 'ignored', jsonb_array_length(_rows) - _added);
END $$;
