-- V115 — Identité sur site : délai de réutilisation d'un jeton de renouvellement.
--
-- V114 fermait la session dès qu'un jeton déjà consommé était présenté. Deux onglets (ou deux contextes) qui
-- renouvellent la même session au même instant présentent légitimement le même jeton : le second perdait la
-- session. Comme Supabase (GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL, 10 s par défaut), une réutilisation dans
-- le délai fixé par l'installation reçoit un nouveau jeton de la même session ; au-delà, c'est un vol probable et
-- la session est fermée.

DROP FUNCTION qerp_identity.session_refresh(text, text, timestamptz);

CREATE FUNCTION qerp_identity.session_refresh(_old_hash text, _new_hash text, _expires_at timestamptz, _reuse_seconds integer)
RETURNS TABLE (status text, user_id uuid, session_id uuid, email text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _t qerp_identity.refresh_tokens%ROWTYPE;
  _s qerp_identity.sessions%ROWTYPE;
  _a qerp_identity.accounts%ROWTYPE;
BEGIN
  SELECT * INTO _t FROM qerp_identity.refresh_tokens WHERE token_hash = _old_hash FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  SELECT * INTO _s FROM qerp_identity.sessions WHERE id = _t.session_id FOR UPDATE;
  SELECT * INTO _a FROM qerp_identity.accounts WHERE accounts.user_id = _s.user_id;
  IF _t.used_at IS NOT NULL AND _t.used_at < now() - make_interval(secs => greatest(_reuse_seconds, 0)) THEN
    IF _s.revoked_at IS NULL THEN
      UPDATE qerp_identity.sessions SET revoked_at = now(), revoked_reason = 'refresh_reuse' WHERE id = _s.id;
      INSERT INTO qerp_identity.events (user_id, email, event) VALUES (_a.user_id, _a.email, 'refresh_reuse');
    END IF;
    RETURN QUERY SELECT 'reused'::text, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  IF _t.expires_at <= now() OR _s.revoked_at IS NOT NULL OR _a.disabled_at IS NOT NULL THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  UPDATE qerp_identity.refresh_tokens SET used_at = COALESCE(used_at, now()) WHERE token_hash = _old_hash;
  INSERT INTO qerp_identity.refresh_tokens (token_hash, session_id, expires_at) VALUES (_new_hash, _s.id, _expires_at);
  RETURN QUERY SELECT 'ok'::text, _a.user_id, _s.id, _a.email;
END;
$$;

REVOKE ALL ON FUNCTION qerp_identity.session_refresh(text, text, timestamptz, integer) FROM PUBLIC;

DO $$
DECLARE
  _r text;
BEGIN
  FOREACH _r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = _r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION qerp_identity.session_refresh(text, text, timestamptz, integer) FROM %I', _r);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'qerp_api') THEN
    GRANT EXECUTE ON FUNCTION qerp_identity.session_refresh(text, text, timestamptz, integer) TO qerp_api;
  END IF;
END;
$$;
