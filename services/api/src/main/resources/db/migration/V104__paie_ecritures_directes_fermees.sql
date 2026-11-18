-- V104 — Paie : plus d'écriture directe sur les cycles et les lignes de paie.
--
-- Revue de sécurité du 18 nov. 2026 : les utilisateurs disposaient de tous les droits SQL sur payroll_runs et
-- payroll_lines, et les politiques RLS laissaient un détenteur de « run_payroll » modifier ou supprimer
-- directement. La seule garde (guard_payroll_run_lock) ne protégeait qu'un cycle déjà comptabilisé. Il était
-- donc possible, sans passer par les fonctions de paie :
--   * de passer un cycle brouillon à « approuvé » (sans précontrôle ni seconde personne — contournement de V89 /
--     V103), ou de réécrire ses totaux ;
--   * de modifier le brut, les retenues ou le net d'une ligne après approbation, voire après comptabilisation
--     (paie et comptabilité désaccordées) ; de supprimer les lignes d'un cycle comptabilisé.
-- Les écrans n'écrivent directement que la création d'un cycle brouillon ; tout le reste passe par
-- generate_payroll_lines / precheck_payroll_run / approve_payroll_run / post_payroll_run (SECURITY DEFINER).
-- Règle : pour les rôles applicatifs, un cycle se crée en brouillon vierge et se supprime tant qu'il est
-- brouillon ; aucune autre écriture directe, ni sur le cycle ni sur ses lignes ; la confirmation des règles de paie
-- ne s'écrit pas directement non plus.

CREATE OR REPLACE FUNCTION public.guard_payroll_run_direct_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon', 'qerp_api') THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'draft';
    NEW.approved_by := NULL; NEW.approved_at := NULL; NEW.executed_by := NULL; NEW.executed_at := NULL;
    NEW.gross_total := 0; NEW.net_total := 0; NEW.deductions_total := 0; NEW.taxes_total := 0;
    NEW.employer_charges_total := 0; NEW.employee_count := 0;
    NEW.payroll_country_code := NULL; NEW.payroll_currency_code := NULL; NEW.payroll_rules_snapshot := NULL;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Un cycle de paie ne se modifie que par ses fonctions (génération, précontrôle, approbation, comptabilisation)'
      USING ERRCODE = '42501';
  END IF;
  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'Seul un cycle de paie brouillon se supprime (cycle « % »)', OLD.status USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END $function$;
CREATE TRIGGER trg_guard_payroll_run_direct_write BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_runs
  FOR EACH ROW EXECUTE FUNCTION public.guard_payroll_run_direct_write();

CREATE OR REPLACE FUNCTION public.guard_payroll_line_direct_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE _status text;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon', 'qerp_api') THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN
    SELECT r.status INTO _status FROM public.payroll_runs r WHERE r.id = OLD.run_id;
    IF _status IS NULL OR _status = 'draft' THEN RETURN OLD; END IF;   -- suppression d'un cycle brouillon (cascade)
  END IF;
  RAISE EXCEPTION 'Les lignes de paie ne s''écrivent que par la génération du cycle' USING ERRCODE = '42501';
END $function$;
CREATE TRIGGER trg_guard_payroll_line_direct_write BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_lines
  FOR EACH ROW EXECUTE FUNCTION public.guard_payroll_line_direct_write();

-- Règles de paie : la confirmation (rules_validated_at / _by) ne se pose que par confirm_payroll_rules, qui
-- vérifie que les règles sont complètes et valides ; un utilisateur ne peut pas l'écrire directement.
CREATE OR REPLACE FUNCTION public.guard_payroll_rules_confirmation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon', 'qerp_api') THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.rules_validated_at := NULL; NEW.rules_validated_by := NULL;
  ELSIF (NEW.rules_validated_at, NEW.rules_validated_by) IS DISTINCT FROM (OLD.rules_validated_at, OLD.rules_validated_by)
        AND NEW.rules_validated_at IS NOT NULL THEN
    RAISE EXCEPTION 'La confirmation des règles de paie passe par « Confirmer les barèmes »' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $function$;
CREATE TRIGGER trg_guard_payroll_rules_confirmation BEFORE INSERT OR UPDATE ON public.hr_payroll_settings
  FOR EACH ROW EXECUTE FUNCTION public.guard_payroll_rules_confirmation();
