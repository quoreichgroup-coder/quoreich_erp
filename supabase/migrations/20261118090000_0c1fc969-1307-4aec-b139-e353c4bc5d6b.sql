-- V103 — Paie : séparation des fonctions effective.
--
-- Revue du 18 nov. 2026 (parcours 95-rh-paie) : un cycle créé depuis l'écran (chemin Supabase) était inséré
-- sans auteur (created_by NULL) ; le contrôle de V89 « le préparateur ne peut pas approuver son propre cycle »
-- comparait created_by à l'approbateur et ne bloquait donc jamais : le préparateur approuvait sa propre paie.
--   * l'auteur est toujours posé par la base (jamais fourni par le client) ;
--   * les cycles existants reprennent l'auteur de leur événement « created » du journal ;
--   * l'approbation est refusée si l'auteur est inconnu, si l'approbateur a créé le cycle ou en a généré les lignes.

CREATE OR REPLACE FUNCTION public.stamp_payroll_run_creator()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon', 'qerp_api') OR NEW.created_by IS NULL THEN
    NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
  END IF;
  RETURN NEW;
END $function$;
CREATE TRIGGER trg_stamp_payroll_run_creator BEFORE INSERT ON public.payroll_runs
  FOR EACH ROW EXECUTE FUNCTION public.stamp_payroll_run_creator();

UPDATE public.payroll_runs r SET created_by = a.performed_by
  FROM (SELECT DISTINCT ON (run_id) run_id, performed_by FROM public.payroll_run_audit
         WHERE event_type = 'created' AND performed_by IS NOT NULL ORDER BY run_id, created_at) a
 WHERE r.id = a.run_id AND r.created_by IS NULL;

CREATE OR REPLACE FUNCTION public.approve_payroll_run(_run_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _run public.payroll_runs%ROWTYPE;
  _precheck public.payroll_run_prechecks%ROWTYPE;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  IF NOT public.has_hr_perm(auth.uid(), 'approve_payroll_run') THEN
    RAISE EXCEPTION 'Permission refusée : rôle Approbateur Paie requis' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _run FROM public.payroll_runs WHERE id = _run_id AND tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cycle introuvable' USING ERRCODE = '42501'; END IF;
  IF _run.status <> 'draft' THEN RAISE EXCEPTION 'Seuls les cycles brouillons peuvent être approuvés' USING ERRCODE = 'QG028'; END IF;
  IF _run.created_by IS NULL THEN
    RAISE EXCEPTION 'Préparateur du cycle inconnu : séparation des fonctions impossible à vérifier' USING ERRCODE = '42501';
  END IF;
  IF _run.created_by = auth.uid() OR EXISTS (SELECT 1 FROM public.payroll_run_audit a
       WHERE a.run_id = _run.id AND a.event_type = 'lines_generated' AND a.performed_by = auth.uid()) THEN
    RAISE EXCEPTION 'Le préparateur ne peut pas approuver son propre cycle (création ou génération des lignes)' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _precheck FROM public.payroll_run_prechecks
    WHERE tenant_id = _tenant AND run_id = _run_id
      AND checked_at >= COALESCE((SELECT max(a.created_at) FROM public.payroll_run_audit a
        WHERE a.tenant_id = _tenant AND a.run_id = _run_id AND a.event_type = 'lines_generated'), '-infinity'::timestamptz)
    ORDER BY checked_at DESC, id DESC LIMIT 1;
  IF NOT FOUND OR NOT _precheck.passed THEN
    RAISE EXCEPTION 'Un précontrôle sans anomalie est requis avant approbation' USING ERRCODE = 'QG028';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.payroll_lines WHERE tenant_id = _tenant AND run_id = _run_id) THEN
    RAISE EXCEPTION 'Aucune ligne de paie calculée' USING ERRCODE = 'QG028';
  END IF;
  UPDATE public.payroll_runs SET status = 'approved', approved_by = auth.uid(), approved_at = now()
    WHERE id = _run_id;
END
$function$;
