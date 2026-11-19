-- V114 — Identité sur site (connexion sans Supabase Auth).
--
-- Décision (DEC-07) : l'API Java porte l'identité de l'installation sur site au lieu d'un fournisseur séparé.
-- Les comptes du nuage sont repris tels quels : même identifiant (les clés étrangères vers auth.users restent
-- valides), même empreinte bcrypt (l'utilisateur garde son mot de passe). Keycloak ne vérifie pas bcrypt sans
-- extension tierce, ce qui aurait imposé une réinitialisation de tous les mots de passe.
-- Références : OWASP ASVS v4 (V2 authentification : empreinte adaptative, verrouillage après échecs, journal ;
-- V3 sessions : jetons d'accès courts, jetons de renouvellement à usage unique, détection de réutilisation,
-- révocation à la déconnexion et au changement de mot de passe), RFC 6749 §10.4 et RFC 9700 (rotation des
-- jetons de renouvellement).
--
-- Schéma qerp_identity : fermé à tous (aucun droit sur les tables, RLS activée sans politique) ; l'API passe
-- uniquement par les fonctions ci-dessous, exécutables par le seul rôle qerp_api quand il existe. Dans le nuage
-- (Supabase), le schéma existe à l'identique mais reste vide et inutilisé : l'identité y est celle de Supabase,
-- et le schéma n'est pas exposé par l'API de données.

CREATE SCHEMA IF NOT EXISTS qerp_identity;
REVOKE ALL ON SCHEMA qerp_identity FROM PUBLIC;

CREATE TABLE qerp_identity.accounts (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(btrim(email)) AND email LIKE '%_@_%'),
  password_hash text NOT NULL CHECK (password_hash ~ '^\$2[aby]\$[0-9]{2}\$.{53}$'),
  email_confirmed_at timestamptz,
  disabled_at timestamptz,
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until timestamptz,
  last_sign_in_at timestamptz,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX accounts_email_key ON qerp_identity.accounts (email);

CREATE TABLE qerp_identity.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES qerp_identity.accounts (user_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_reason text CHECK (revoked_reason IN ('logout', 'logout_global', 'password_changed', 'refresh_reuse', 'admin_reset'))
);
CREATE INDEX sessions_user_idx ON qerp_identity.sessions (user_id) WHERE revoked_at IS NULL;

-- Empreinte SHA-256 du jeton de renouvellement : le jeton lui-même n'est jamais stocké.
CREATE TABLE qerp_identity.refresh_tokens (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  session_id uuid NOT NULL REFERENCES qerp_identity.sessions (id) ON DELETE CASCADE,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE INDEX refresh_tokens_session_idx ON qerp_identity.refresh_tokens (session_id);

CREATE TABLE qerp_identity.events (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid,
  email text,
  event text NOT NULL CHECK (event IN ('signup', 'login', 'login_failed', 'login_locked', 'login_unknown', 'login_disabled',
    'refresh_reuse', 'logout', 'password_changed', 'admin_reset')),
  ip text,
  detail text
);
CREATE INDEX events_user_idx ON qerp_identity.events (user_id, seq);

ALTER TABLE qerp_identity.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE qerp_identity.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE qerp_identity.refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE qerp_identity.events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA qerp_identity FROM PUBLIC;

-- ─── Connexion ───

-- Compte d'une adresse (l'API vérifie l'empreinte elle-même). Aucune ligne = adresse inconnue.
CREATE FUNCTION qerp_identity.login_lookup(_email text)
RETURNS TABLE (user_id uuid, email text, password_hash text, email_confirmed_at timestamptz, disabled boolean, locked_until timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT a.user_id, a.email, a.password_hash, a.email_confirmed_at, a.disabled_at IS NOT NULL, a.locked_until
    FROM qerp_identity.accounts a WHERE a.email = lower(btrim(_email))
$$;

-- Issue d'une tentative : échec = compteur, verrouillage au seuil ; succès = remise à zéro. Journalisé.
CREATE FUNCTION qerp_identity.login_result(_email text, _user_id uuid, _outcome text, _max_attempts integer, _lock_minutes integer, _ip text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _n integer;
BEGIN
  IF _outcome NOT IN ('login', 'login_failed', 'login_locked', 'login_unknown', 'login_disabled') THEN
    RAISE EXCEPTION 'Issue de connexion inconnue : %', _outcome USING ERRCODE = '22023';
  END IF;
  IF _outcome = 'login' THEN
    UPDATE qerp_identity.accounts SET failed_attempts = 0, locked_until = NULL, last_sign_in_at = now() WHERE user_id = _user_id;
  ELSIF _outcome = 'login_failed' THEN
    UPDATE qerp_identity.accounts SET failed_attempts = failed_attempts + 1 WHERE user_id = _user_id RETURNING failed_attempts INTO _n;
    IF _n >= greatest(_max_attempts, 1) THEN
      UPDATE qerp_identity.accounts SET failed_attempts = 0, locked_until = now() + make_interval(mins => greatest(_lock_minutes, 1))
       WHERE user_id = _user_id;
      _outcome := 'login_locked';
    END IF;
  END IF;
  INSERT INTO qerp_identity.events (user_id, email, event, ip) VALUES (_user_id, lower(btrim(_email)), _outcome, left(_ip, 64));
END;
$$;

-- Ouvre une session et son premier jeton de renouvellement.
CREATE FUNCTION qerp_identity.session_open(_user_id uuid, _token_hash text, _expires_at timestamptz)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _session uuid;
BEGIN
  INSERT INTO qerp_identity.sessions (user_id) VALUES (_user_id) RETURNING id INTO _session;
  INSERT INTO qerp_identity.refresh_tokens (token_hash, session_id, expires_at) VALUES (_token_hash, _session, _expires_at);
  RETURN _session;
END;
$$;

-- Rotation : le jeton présenté est consommé et remplacé. Un jeton déjà consommé = vol probable : la session est
-- révoquée (statut « reused », sans lever d'exception pour que la révocation soit conservée).
CREATE FUNCTION qerp_identity.session_refresh(_old_hash text, _new_hash text, _expires_at timestamptz)
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
  IF _t.used_at IS NOT NULL THEN
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
  UPDATE qerp_identity.refresh_tokens SET used_at = now() WHERE token_hash = _old_hash;
  INSERT INTO qerp_identity.refresh_tokens (token_hash, session_id, expires_at) VALUES (_new_hash, _s.id, _expires_at);
  RETURN QUERY SELECT 'ok'::text, _a.user_id, _s.id, _a.email;
END;
$$;

-- Session encore ouverte (contrôlée à chaque requête : une déconnexion prend effet immédiatement).
CREATE FUNCTION qerp_identity.session_active(_session_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM qerp_identity.sessions s JOIN qerp_identity.accounts a ON a.user_id = s.user_id
                  WHERE s.id = _session_id AND s.user_id = _user_id AND s.revoked_at IS NULL AND a.disabled_at IS NULL)
$$;

-- Déconnexion : 'local' = cette session, 'global' = toutes, 'others' = toutes sauf celle-ci.
CREATE FUNCTION qerp_identity.session_close(_session_id uuid, _user_id uuid, _scope text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF _scope NOT IN ('local', 'global', 'others') THEN
    RAISE EXCEPTION 'Portée de déconnexion inconnue : %', _scope USING ERRCODE = '22023';
  END IF;
  UPDATE qerp_identity.sessions SET revoked_at = now(), revoked_reason = CASE WHEN _scope = 'local' THEN 'logout' ELSE 'logout_global' END
   WHERE user_id = _user_id AND revoked_at IS NULL
     AND ((_scope = 'local' AND id = _session_id) OR _scope = 'global' OR (_scope = 'others' AND id <> _session_id));
  INSERT INTO qerp_identity.events (user_id, event, detail) VALUES (_user_id, 'logout', _scope);
END;
$$;

-- ─── Comptes ───

-- Création d'un compte (inscription sur site) : utilisateur, compte et profil sans société. Sur site, l'adresse
-- est considérée comme confirmée (pas encore de messagerie) ; le rattachement à une société passe par une
-- invitation ou la création de sa société (V31).
CREATE FUNCTION qerp_identity.account_create(_user_id uuid, _email text, _password_hash text, _full_name text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM qerp_identity.accounts WHERE email = lower(btrim(_email))) THEN
    RAISE EXCEPTION 'Un compte existe déjà pour cette adresse' USING ERRCODE = '23505';
  END IF;
  INSERT INTO auth.users (id) VALUES (_user_id);
  INSERT INTO qerp_identity.accounts (user_id, email, password_hash, email_confirmed_at)
  VALUES (_user_id, lower(btrim(_email)), _password_hash, now());
  INSERT INTO public.profiles (id, full_name) VALUES (_user_id, NULLIF(btrim(_full_name), '')) ON CONFLICT (id) DO NOTHING;
  INSERT INTO qerp_identity.events (user_id, email, event) VALUES (_user_id, lower(btrim(_email)), 'signup');
END;
$$;

-- Fiche du compte connecté (forme de l'utilisateur Supabase).
CREATE FUNCTION qerp_identity.account_get(_user_id uuid)
RETURNS TABLE (user_id uuid, email text, email_confirmed_at timestamptz, created_at timestamptz, last_sign_in_at timestamptz, full_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT a.user_id, a.email, a.email_confirmed_at, a.created_at, a.last_sign_in_at, p.full_name
    FROM qerp_identity.accounts a LEFT JOIN public.profiles p ON p.id = a.user_id WHERE a.user_id = _user_id
$$;

-- Changement de mot de passe par l'intéressé (l'API a vérifié sa session) : les autres sessions sont fermées.
CREATE FUNCTION qerp_identity.account_set_password(_user_id uuid, _password_hash text, _keep_session uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  UPDATE qerp_identity.accounts SET password_hash = _password_hash, password_changed_at = now(), failed_attempts = 0, locked_until = NULL
   WHERE user_id = _user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Compte introuvable' USING ERRCODE = '42501';
  END IF;
  UPDATE qerp_identity.sessions SET revoked_at = now(), revoked_reason = 'password_changed'
   WHERE user_id = _user_id AND revoked_at IS NULL AND id IS DISTINCT FROM _keep_session;
  INSERT INTO qerp_identity.events (user_id, event) VALUES (_user_id, 'password_changed');
END;
$$;

-- Mot de passe provisoire fixé par un administrateur de la société pour un membre de SA société (sans
-- messagerie, c'est la voie de secours d'un oubli) : toutes les sessions du membre sont fermées.
CREATE FUNCTION qerp_identity.account_admin_reset(_actor uuid, _target uuid, _password_hash text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _tenant uuid := public.get_user_tenant_id(_actor);
BEGIN
  IF _tenant IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.user_role_assignments ura JOIN public.erp_roles r ON r.id = ura.role_id
        WHERE ura.user_id = _actor AND ura.tenant_id = _tenant AND r.tenant_id = _tenant AND r.code = 'admin') THEN
    RAISE EXCEPTION 'Réservé à un administrateur de la société' USING ERRCODE = '42501';
  END IF;
  IF _actor = _target THEN
    RAISE EXCEPTION 'Changez votre propre mot de passe depuis votre profil' USING ERRCODE = '22023';
  END IF;
  IF public.get_user_tenant_id(_target) IS DISTINCT FROM _tenant THEN
    RAISE EXCEPTION 'Ce membre n''appartient pas à votre société' USING ERRCODE = '42501';
  END IF;
  UPDATE qerp_identity.accounts SET password_hash = _password_hash, password_changed_at = now(), failed_attempts = 0, locked_until = NULL
   WHERE user_id = _target;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ce membre n''a pas de compte sur site' USING ERRCODE = '22023';
  END IF;
  UPDATE qerp_identity.sessions SET revoked_at = now(), revoked_reason = 'admin_reset' WHERE user_id = _target AND revoked_at IS NULL;
  INSERT INTO qerp_identity.events (user_id, event, detail) VALUES (_target, 'admin_reset', 'par ' || _actor::text);
END;
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA qerp_identity FROM PUBLIC;

-- Supabase accorde par défaut les nouveaux objets à anon / authenticated / service_role : retrait explicite.
DO $$
DECLARE
  _r text;
BEGIN
  FOREACH _r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = _r) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA qerp_identity FROM %I', _r);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA qerp_identity FROM %I', _r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA qerp_identity FROM %I', _r);
    END IF;
  END LOOP;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'qerp_api') THEN
    GRANT USAGE ON SCHEMA qerp_identity TO qerp_api;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA qerp_identity TO qerp_api;
  END IF;
END;
$$;
