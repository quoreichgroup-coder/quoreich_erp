-- V68 — Import du plan comptable simplifié (demande du propriétaire, 14 nov. 2026) : plus de profil à
-- choisir. Comme Odoo (un modèle : code, intitulé, type ; « exporter d'abord ») et Sage 100 (numéro et
-- intitulé, import paramétrable seulement pour un fichier hors format), un seul format standard,
-- identique à l'export du plan, dont les colonnes sont reconnues automatiquement sous leurs noms usuels
-- (français, anglais, Sage, SAP) ; le type se déduit de la classe du compte quand il manque.
--
-- Les profils Sage 300 / Sage X3 / SAP de V65 sont retirés (aucun import ne les cite) et leurs en-têtes
-- versés dans le format standard ; la table import_profiles reste pour d'éventuels profils de société.
-- prepare_chart_import accepte un profil NULL = format standard.

UPDATE public.chart_import_runs SET profile_id = NULL
 WHERE profile_id IN (SELECT id FROM public.import_profiles WHERE tenant_id IS NULL AND code IN ('SAGE300', 'SAGEX3', 'SAP'));
DELETE FROM public.import_profiles WHERE tenant_id IS NULL AND code IN ('SAGE300', 'SAGEX3', 'SAP');

UPDATE public.import_profiles SET
  name = 'Format standard',
  notes = 'Colonnes Code et Intitulé obligatoires ; Type, Parent, Regroupement, Sens facultatifs (type déduit de la classe). Même format que l''export du plan.',
  column_map = '{
    "code": ["Code", "Compte", "Numéro de compte", "N° compte", "N° de compte", "Numéro", "No compte", "Account", "Account No.", "Account Number", "Account Code", "ACCTID", "ACC", "G/L Account", "SAKNR", "Compte général", "CG_Num"],
    "name": ["Intitulé", "Libellé", "Nom", "Désignation", "Intitulé du compte", "Libellé du compte", "Description", "Account Name", "Name", "ACCTDESC", "DES", "Long Text", "TXT50", "G/L Acct Long Text", "Short Text", "TXT20", "CG_Intitule"],
    "type": ["Type", "Nature", "Type de compte", "Account Type", "ACCTTYPE", "GLACCOUNT_TYPE"],
    "parent": ["Parent", "Compte parent", "Compte de regroupement", "Parent Account", "Account Group", "Group Account"],
    "header": ["Regroupement", "Titre", "Compte de totalisation", "Header"],
    "normal_balance": ["Sens", "Sens normal", "Normal Balance"]
  }'::jsonb
 WHERE tenant_id IS NULL AND code = 'QUOREICH';

CREATE OR REPLACE FUNCTION public.prepare_chart_import(_profile_id uuid, _file_name text, _rows jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _p public.import_profiles%ROWTYPE; _run uuid;
BEGIN
  IF _tenant IS NULL OR NOT public.has_permission(auth.uid(), 'accounting.import') THEN
    RAISE EXCEPTION 'Droit insuffisant : préparer un import de plan comptable' USING ERRCODE = '42501';
  END IF;
  IF _profile_id IS NULL THEN
    SELECT * INTO _p FROM public.import_profiles WHERE tenant_id IS NULL AND code = 'QUOREICH';
  ELSE
    SELECT * INTO _p FROM public.import_profiles WHERE id = _profile_id AND (tenant_id IS NULL OR tenant_id = _tenant);
  END IF;
  IF _p.id IS NULL THEN RAISE EXCEPTION 'Format d''import introuvable' USING ERRCODE = 'QG020'; END IF;
  IF jsonb_typeof(_rows) <> 'array' OR jsonb_array_length(_rows) = 0 THEN RAISE EXCEPTION 'Fichier vide' USING ERRCODE = 'QG020'; END IF;
  IF jsonb_array_length(_rows) > 10000 THEN RAISE EXCEPTION 'Fichier trop volumineux (10 000 lignes au plus)' USING ERRCODE = 'QG020'; END IF;

  INSERT INTO public.chart_import_runs (tenant_id, profile_id, file_name, created_by)
  VALUES (_tenant, _p.id, COALESCE(NULLIF(btrim(_file_name), ''), 'import.csv'), auth.uid()) RETURNING id INTO _run;
  INSERT INTO public.chart_import_rows (run_id, tenant_id, line_no, code, name, raw_type, parent_code, is_header, normal_balance)
  SELECT _run, _tenant, x.n::int, NULLIF(regexp_replace(COALESCE(x.v ->> 'code', ''), '\s', '', 'g'), ''), NULLIF(btrim(x.v ->> 'name'), ''),
         NULLIF(btrim(x.v ->> 'type'), ''), NULLIF(regexp_replace(COALESCE(x.v ->> 'parent', ''), '\s', '', 'g'), ''),
         public.normalize_account_label(x.v ->> 'header') IN ('oui', 'o', 'yes', 'y', 'x', 'true', '1', 'vrai'),
         CASE WHEN COALESCE(_p.balance_map, '{}') ? public.normalize_account_label(x.v ->> 'normal_balance')
              THEN NULLIF(_p.balance_map ->> public.normalize_account_label(x.v ->> 'normal_balance'), '')
              WHEN public.normalize_account_label(x.v ->> 'normal_balance') IN ('debit', 'd', 'debiteur', 'dr') THEN 'debit'
              WHEN public.normalize_account_label(x.v ->> 'normal_balance') IN ('credit', 'c', 'crediteur', 'cr') THEN 'credit' END
    FROM jsonb_array_elements(_rows) WITH ORDINALITY AS x(v, n);
  PERFORM public.chart_import_check(_run);
  RETURN _run;
END $function$;
