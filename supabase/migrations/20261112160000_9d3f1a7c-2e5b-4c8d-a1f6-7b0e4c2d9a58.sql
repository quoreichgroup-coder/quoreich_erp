-- V20 — Hiérarchie des sections analytiques sans boucle. Écrit à la main.
--
-- V19 interdit qu'une section soit son propre parent, pas une boucle plus longue
-- (A → B → A). Une hiérarchie circulaire rendrait faux tout cumul par niveau
-- (balance analytique, budget par département) et ferait boucler un parcours
-- récursif. Le contrôle est dans le schéma, comme les autres invariants : l'API le
-- vérifie aussi pour donner un message précis, mais n'est pas la barrière.
--
-- Jumelle : services/api/src/main/resources/db/migration/V20__hierarchie_analytique_sans_boucle.sql

CREATE FUNCTION public.guard_analytic_value_hierarchy() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _courant uuid := NEW.parent_id;
  _profondeur int := 0;
BEGIN
  WHILE _courant IS NOT NULL LOOP
    IF _courant = NEW.id THEN
      RAISE EXCEPTION 'Hiérarchie circulaire : la section % ne peut pas descendre d''elle-même', NEW.code
        USING ERRCODE = '23514';
    END IF;
    _profondeur := _profondeur + 1;
    IF _profondeur > 64 THEN
      RAISE EXCEPTION 'Hiérarchie analytique trop profonde (plus de 64 niveaux)' USING ERRCODE = '23514';
    END IF;
    SELECT parent_id INTO _courant FROM public.analytic_values WHERE id = _courant;
  END LOOP;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_guard_analytic_value_hierarchy
  BEFORE INSERT OR UPDATE OF parent_id ON public.analytic_values
  FOR EACH ROW EXECUTE FUNCTION public.guard_analytic_value_hierarchy();

REVOKE ALL ON FUNCTION public.guard_analytic_value_hierarchy() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_analytic_value_hierarchy() FROM anon;
