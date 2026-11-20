-- V134 — Connecteur de suivi automatique par un prestataire (Terminal49, Vizion, ShipsGo… ; choix et abonnement par le
-- propriétaire). Mode « poussé » : le prestataire envoie les événements à une adresse propre à la société (jeton
-- aléatoire), au format de la norme DCSA Track & Trace (eventClassifierCode PLN / EST / ACT, transportEventTypeCode
-- ARRI / DEPA, equipmentEventTypeCode LOAD / DISC / GTIN / GTOT, lieu UN/LOCODE, conteneur, navire) ; les événements sont
-- rattachés au dossier par le connaissement ou le conteneur, sans doublon (identifiant d'événement du prestataire).
--   tracking_connections   par société : prestataire, activé, jeton du webhook, clé API du prestataire (écriture seule :
--                          la colonne n'est jamais lisible par les utilisateurs), dernière réception ;
--   set_tracking_connection   enregistrement (droit procurement.settings), jeton généré ;
--   ingest_tracking_events    réception des événements (service_role dans le nuage par la fonction tracking-webhook,
--                          qerp_api sur site par la route publique), jamais exécutable par les utilisateurs.

CREATE TABLE public.tracking_connections (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants (id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('terminal49', 'vizion', 'shipsgo', 'searates', 'dcsa')),
  enabled boolean NOT NULL DEFAULT true,
  webhook_token text NOT NULL UNIQUE,
  api_key text,
  last_received_at timestamptz,
  last_result jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
ALTER TABLE public.tracking_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture société" ON public.tracking_connections FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'procurement.settings'));
-- La clé API n'est jamais lisible : seules les autres colonnes sont accordées en lecture ; l'écriture passe par la fonction.
-- Les privilèges par défaut du schéma accordent toute la table : on les retire avant d'accorder les colonnes.
REVOKE ALL ON public.tracking_connections FROM PUBLIC, anon, authenticated;
GRANT SELECT (tenant_id, provider, enabled, webhook_token, last_received_at, last_result, updated_at, updated_by) ON public.tracking_connections TO authenticated;

CREATE FUNCTION public.set_tracking_connection(_provider text, _enabled boolean, _api_key text DEFAULT NULL, _regenerate boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tenant uuid := public.get_user_tenant_id(auth.uid()); _token text;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'procurement.settings') THEN
    RAISE EXCEPTION 'Droit insuffisant : paramètres des achats' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.tracking_connections (tenant_id, provider, enabled, webhook_token, api_key, updated_by)
  VALUES (_tenant, _provider, COALESCE(_enabled, true), replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), NULLIF(btrim(_api_key), ''), auth.uid())
  ON CONFLICT (tenant_id) DO UPDATE SET provider = EXCLUDED.provider, enabled = EXCLUDED.enabled,
    api_key = COALESCE(NULLIF(btrim(_api_key), ''), tracking_connections.api_key),
    webhook_token = CASE WHEN _regenerate THEN EXCLUDED.webhook_token ELSE tracking_connections.webhook_token END,
    updated_at = now(), updated_by = auth.uid()
  RETURNING webhook_token INTO _token;
  RETURN _token;
END $$;
REVOKE EXECUTE ON FUNCTION public.set_tracking_connection(text, boolean, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_tracking_connection(text, boolean, text, boolean) TO authenticated;

-- Traduction d'un événement DCSA en étape QUOREICH.
CREATE FUNCTION public.dcsa_event_code(_e jsonb)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _e ->> 'eventType' = 'TRANSPORT' AND _e ->> 'transportEventTypeCode' = 'DEPA' THEN 'DEPARTED'
    WHEN _e ->> 'eventType' = 'TRANSPORT' AND _e ->> 'transportEventTypeCode' = 'ARRI' THEN 'ARRIVED'
    WHEN _e ->> 'eventType' = 'EQUIPMENT' AND _e ->> 'equipmentEventTypeCode' = 'GTIN' THEN 'GATE_IN'
    WHEN _e ->> 'eventType' = 'EQUIPMENT' AND _e ->> 'equipmentEventTypeCode' = 'LOAD' THEN 'LOADED'
    WHEN _e ->> 'eventType' = 'EQUIPMENT' AND _e ->> 'equipmentEventTypeCode' = 'DISC' THEN 'DISCHARGED'
    WHEN _e ->> 'eventType' = 'EQUIPMENT' AND _e ->> 'equipmentEventTypeCode' = 'GTOT' THEN 'GATE_OUT'
    WHEN _e ->> 'eventType' = 'SHIPMENT' AND _e ->> 'shipmentEventTypeCode' = 'CONF' THEN 'BOOKED'
    ELSE NULL END
$$;

CREATE FUNCTION public.ingest_tracking_events(_token text, _payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _c public.tracking_connections%ROWTYPE;
  _e jsonb; _code text; _file uuid; _bl text; _container text; _added integer := 0; _unmatched integer := 0; _ignored integer := 0; _result jsonb;
BEGIN
  SELECT * INTO _c FROM public.tracking_connections WHERE webhook_token = _token AND enabled;
  IF NOT FOUND THEN RAISE EXCEPTION 'Connexion de suivi inconnue ou désactivée' USING ERRCODE = '42501'; END IF;
  FOR _e IN SELECT * FROM jsonb_array_elements(CASE WHEN jsonb_typeof(_payload -> 'events') = 'array' THEN _payload -> 'events'
                                                    WHEN jsonb_typeof(_payload) = 'array' THEN _payload ELSE jsonb_build_array(_payload) END) LOOP
    _code := public.dcsa_event_code(_e);
    IF _code IS NULL THEN _ignored := _ignored + 1; CONTINUE; END IF;
    _bl := COALESCE(_e ->> 'transportDocumentReference', _e -> 'documentReferences' -> 0 ->> 'documentReferenceValue', _payload ->> 'billOfLading');
    _container := upper(regexp_replace(COALESCE(_e ->> 'equipmentReference', ''), '\s', '', 'g'));
    SELECT f.id INTO _file FROM public.import_files f
     WHERE f.tenant_id = _c.tenant_id AND f.status <> 'closed'
       AND ((_bl IS NOT NULL AND upper(btrim(f.bill_of_lading)) = upper(btrim(_bl)))
            OR (_container <> '' AND upper(COALESCE(f.containers, '')) LIKE '%' || _container || '%'))
     ORDER BY f.created_at DESC LIMIT 1;
    IF _file IS NULL THEN _unmatched := _unmatched + 1; CONTINUE; END IF;
    INSERT INTO public.shipment_events (tenant_id, import_file_id, event_code, event_class, event_at, location, vessel, voyage, container_number, source, external_ref, notes, created_by)
    VALUES (_c.tenant_id, _file, _code,
            CASE _e ->> 'eventClassifierCode' WHEN 'PLN' THEN 'planned' WHEN 'EST' THEN 'estimated' ELSE 'actual' END,
            (_e ->> 'eventDateTime')::timestamptz,
            COALESCE(_e -> 'eventLocation' ->> 'UNLocationCode', _e -> 'transportCall' -> 'location' ->> 'UNLocationCode', _e -> 'transportCall' ->> 'UNLocationCode'),
            _e -> 'transportCall' -> 'vessel' ->> 'vesselName', _e -> 'transportCall' ->> 'exportVoyageNumber',
            CASE WHEN _container ~ '^[A-Z]{4}[0-9]{7}$' THEN _container END,
            'provider', COALESCE(_e ->> 'eventID', md5(_e::text)), _c.provider, NULL)
    ON CONFLICT (tenant_id, COALESCE(import_file_id, po_id), source, external_ref) WHERE external_ref IS NOT NULL DO NOTHING;
    IF FOUND THEN _added := _added + 1; ELSE _ignored := _ignored + 1; END IF;
  END LOOP;
  _result := jsonb_build_object('added', _added, 'unmatched', _unmatched, 'ignored', _ignored);
  UPDATE public.tracking_connections SET last_received_at = now(), last_result = _result WHERE tenant_id = _c.tenant_id;
  RETURN _result;
END $$;
REVOKE EXECUTE ON FUNCTION public.ingest_tracking_events(text, jsonb) FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.ingest_tracking_events(text, jsonb) TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'qerp_api') THEN
    GRANT EXECUTE ON FUNCTION public.ingest_tracking_events(text, jsonb) TO qerp_api;
  END IF;
END $$;
