-- V47 — Identité légale de la société, pour l'en-tête des pièces imprimées.
--
-- Une facture doit porter l'identité du vendeur (Burkina Faso, CGI art. 562 et 564 : RCCM, IFU,
-- régime d'imposition et service des impôts de rattachement, coordonnées bancaires ; équivalents
-- NIF / NCC / NINEA dans les autres pays OHADA). tenants ne portait que le nom. Les valeurs sont
-- propres à chaque pays et se valident avec l'expert-comptable ; rien n'est imposé ici, l'édition
-- affiche « à renseigner » pour une mention vide. Modification par l'administrateur de la société
-- seulement (set_company_identity).

ALTER TABLE public.tenants
  ADD COLUMN legal_name text,
  ADD COLUMN address text,
  ADD COLUMN phone text,
  ADD COLUMN email text,
  ADD COLUMN rccm text,
  ADD COLUMN tax_id text,
  ADD COLUMN tax_regime text,
  ADD COLUMN tax_office text,
  ADD COLUMN bank_details text;

CREATE OR REPLACE FUNCTION public.set_company_identity(_identity jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _v text;
BEGIN
  IF _tenant IS NULL OR NOT public.is_tenant_admin() THEN
    RAISE EXCEPTION 'Droit insuffisant : seul l''administrateur de la société modifie son identité légale' USING ERRCODE = '42501';
  END IF;
  _v := NULLIF(btrim(_identity->>'email'), '');
  IF _v IS NOT NULL AND _v !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Adresse électronique invalide' USING ERRCODE = '22023';
  END IF;
  UPDATE public.tenants SET
    legal_name   = NULLIF(btrim(_identity->>'legal_name'), ''),
    address      = NULLIF(btrim(_identity->>'address'), ''),
    phone        = NULLIF(btrim(_identity->>'phone'), ''),
    email        = _v,
    rccm         = NULLIF(btrim(_identity->>'rccm'), ''),
    tax_id       = NULLIF(btrim(_identity->>'tax_id'), ''),
    tax_regime   = NULLIF(btrim(_identity->>'tax_regime'), ''),
    tax_office   = NULLIF(btrim(_identity->>'tax_office'), ''),
    bank_details = NULLIF(btrim(_identity->>'bank_details'), ''),
    updated_at   = now()
  WHERE id = _tenant;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_company_identity(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_company_identity(jsonb) TO authenticated;
