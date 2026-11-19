-- V117 — Analyses IA planifiées sur site.
--
-- Dans le nuage, la fonction ai-scheduler (pg_cron, clé de service) lit les planifications échues de toutes les
-- sociétés. Sur site il n'y a pas de clé de service : l'API exécute chaque analyse avec l'identité de la personne
-- qui l'a planifiée (ou, si elle n'est plus membre de la société, d'un administrateur de la société), sous la RLS
-- ordinaire — l'analyse ne voit que ce que cette personne voit.
-- qerp_jobs.ai_claim_due_schedules réserve les planifications échues de façon atomique (FOR UPDATE SKIP LOCKED :
-- deux instances de l'API n'exécutent jamais la même) et avance leur prochaine exécution selon la fréquence
-- (mêmes pas que le nuage : 1, 7 ou 30 jours). Schéma fermé, fonction exécutable par qerp_api seul ; dans le nuage
-- le schéma existe à l'identique et n'est pas utilisé.

CREATE SCHEMA IF NOT EXISTS qerp_jobs;
REVOKE ALL ON SCHEMA qerp_jobs FROM PUBLIC;

CREATE FUNCTION qerp_jobs.ai_claim_due_schedules(_limit integer)
RETURNS TABLE (schedule_id uuid, tenant_id uuid, analysis_type text, params jsonb, run_as uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT s.id FROM public.ai_analysis_schedules s
     WHERE s.enabled AND s.next_run_at <= now()
     ORDER BY s.next_run_at
     LIMIT greatest(_limit, 1)
     FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.ai_analysis_schedules s
       SET last_run_at = now(),
           next_run_at = now() + CASE s.frequency WHEN 'weekly' THEN interval '7 days' WHEN 'monthly' THEN interval '30 days' ELSE interval '1 day' END
      FROM due WHERE s.id = due.id
    RETURNING s.id, s.tenant_id, s.analysis_type::text, COALESCE(s.params, '{}'::jsonb) AS params, s.created_by
  )
  SELECT c.id, c.tenant_id, c.analysis_type, c.params,
         COALESCE(
           (SELECT p.id FROM public.profiles p WHERE p.id = c.created_by AND p.tenant_id = c.tenant_id),
           (SELECT ura.user_id FROM public.user_role_assignments ura
              JOIN public.erp_roles r ON r.id = ura.role_id AND r.tenant_id = c.tenant_id AND r.code = 'admin'
              JOIN public.profiles p ON p.id = ura.user_id AND p.tenant_id = c.tenant_id
             WHERE ura.tenant_id = c.tenant_id
             ORDER BY ura.user_id LIMIT 1))
    FROM claimed c;
END;
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA qerp_jobs FROM PUBLIC;

DO $$
DECLARE
  _r text;
BEGIN
  FOREACH _r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = _r) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA qerp_jobs FROM %I', _r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA qerp_jobs FROM %I', _r);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'qerp_api') THEN
    GRANT USAGE ON SCHEMA qerp_jobs TO qerp_api;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA qerp_jobs TO qerp_api;
  END IF;
END;
$$;
