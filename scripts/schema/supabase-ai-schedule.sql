-- Tâche planifiée de l'IA sur Supabase (nuage) : appel quotidien de la fonction ai-scheduler,
-- qui exécute les planifications dues de ai_analysis_schedules. Rejouable sans effet.
--
-- Usage :  psql "$SUPABASE_DB_URL" -v project_url=https://<ref>.supabase.co \
--               --single-transaction -f scripts/schema/supabase-ai-schedule.sql
--
-- Prérequis : le secret Vault « ai_scheduler_secret » (Supabase → Integrations → Vault), de même
-- valeur que le secret de fonction AI_SCHEDULER_SECRET. Le secret n'est jamais écrit dans la tâche :
-- il est lu dans le coffre à chaque appel (l'ancien projet Lovable gardait un jeton en clair dans
-- cron.job). Sans ce secret, le script s'arrête sans rien créer.
--
-- Fréquence : une fois par jour à 06:00 UTC (06:00 à Ouagadougou), le temps de l'offre gratuite du
-- fournisseur d'IA ; revenir à « 0 * * * * » (toutes les heures) avec un abonnement.
-- Sur site, l'équivalent est la planification Quartz de l'API Java (plan de bascule).

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT set_config('qerp.project_url', :'project_url', true);

DO $$
DECLARE
  _url text := rtrim(current_setting('qerp.project_url'), '/') || '/functions/v1/ai-scheduler';
BEGIN
  IF current_setting('qerp.project_url') !~ '^https://[a-z0-9]+\.supabase\.co/?$' THEN
    RAISE EXCEPTION 'project_url attendu : https://<ref>.supabase.co (reçu : %)', current_setting('qerp.project_url');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'ai_scheduler_secret' AND decrypted_secret <> '') THEN
    RAISE EXCEPTION 'Secret Vault « ai_scheduler_secret » absent : créez-le avant de planifier (même valeur que AI_SCHEDULER_SECRET)';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'qerp-ai-scheduler') THEN
    PERFORM cron.unschedule('qerp-ai-scheduler');
  END IF;
  PERFORM cron.schedule('qerp-ai-scheduler', '0 6 * * *', format($cmd$
    SELECT net.http_post(
      url := %L,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-scheduler-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'ai_scheduler_secret')),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000)
  $cmd$, _url));
END $$;

SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'qerp-ai-scheduler';
