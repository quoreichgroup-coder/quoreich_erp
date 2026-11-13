-- Compte de test des parcours de bout en bout (tests/e2e/parcours-*.spec.ts), sur Supabase.
-- Rejouable : ne crée que ce qui manque, ne touche à aucun autre compte.
--
--   psql "$SUPABASE_DB_URL" -v email=... -v password=... --single-transaction -f scripts/e2e/compte-de-test.sql
--
-- Le compte est créé confirmé (le projet exige la confirmation par e-mail, et l'adresse de test
-- n'en reçoit pas) et SANS société : le parcours crée sa société par l'écran d'accueil, comme un
-- vrai premier utilisateur. Le profil vient du déclencheur on_auth_user_created
-- (scripts/schema/supabase-platform.sql). Identifiants : hors dépôt (QERP-backups/e2e-credentials.txt).

-- « IS NOT NULL » : ne jamais afficher le mot de passe dans la sortie de psql.
SELECT set_config('qerp.e2e_email', lower(:'email'), true) IS NOT NULL
   AND set_config('qerp.e2e_password', :'password', true) IS NOT NULL AS parametres_lus;

DO $$
DECLARE
  _email text := current_setting('qerp.e2e_email');
  _id uuid;
BEGIN
  IF _email !~ '^e2e[-.a-z0-9]*@[-a-z0-9.]+\.invalid$' THEN
    RAISE EXCEPTION 'Adresse de test attendue en e2e…@….invalid (reçu %)', _email;
  END IF;
  SELECT id INTO _id FROM auth.users WHERE email = _email;
  IF _id IS NULL THEN
    _id := gen_random_uuid();
    INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change_token_new, email_change)
    VALUES ('00000000-0000-0000-0000-000000000000', _id, 'authenticated', 'authenticated', _email,
            extensions.crypt(current_setting('qerp.e2e_password'), extensions.gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}', '{"full_name":"Testeur E2E"}', now(), now(),
            '', '', '', '');
    INSERT INTO auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), _id, _id::text, 'email',
            jsonb_build_object('sub', _id::text, 'email', _email, 'email_verified', true), now(), now(), now());
  ELSE
    UPDATE auth.users SET encrypted_password = extensions.crypt(current_setting('qerp.e2e_password'), extensions.gen_salt('bf')),
                          email_confirmed_at = COALESCE(email_confirmed_at, now()), updated_at = now()
     WHERE id = _id;
  END IF;
  INSERT INTO public.profiles (id, full_name) VALUES (_id, 'Testeur E2E') ON CONFLICT (id) DO NOTHING;
  RAISE NOTICE 'Compte de test % prêt (%)', _email, _id;
END $$;
