-- Extraction des comptes du nuage (Supabase, auth.users) au format CSV sur la sortie standard, pour
-- reprendre-comptes.sql. Appelé par reprendre-comptes.sh (variable filtre). Comptes supprimés exclus ; seules les
-- empreintes bcrypt complètes sont extraites.
COPY (
  SELECT id, lower(btrim(email)), encrypted_password, email_confirmed_at,
         NULLIF(btrim(raw_user_meta_data ->> 'full_name'), ''), created_at
    FROM auth.users
   WHERE email ILIKE :'filtre'
     AND deleted_at IS NULL
     AND encrypted_password ~ '^\$2[aby]\$[0-9]{2}\$.{53}$'
) TO STDOUT WITH (FORMAT csv);
