-- V110 — Catégorie de frais : compte de charge imputable.
--
-- Le parcours 99 a montré qu'une catégorie pouvait porter un compte de regroupement (« 6 ») : la note
-- était approuvée puis refusée à la comptabilisation. Comme SAP (compte de détermination non
-- imputable refusé au paramétrage) et Sage X3 (comptes de regroupement non saisissables), la catégorie
-- exige un compte actif, de charge, imputable (ni regroupement, ni bloqué), dès sa création.

CREATE FUNCTION public.guard_expense_category() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _g record;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.gl_account_id IS NOT DISTINCT FROM OLD.gl_account_id AND NEW.is_active = OLD.is_active THEN RETURN NEW; END IF;
  SELECT code, account_type, is_active, is_header, posting_mode INTO _g FROM public.gl_accounts WHERE id = NEW.gl_account_id;
  IF NEW.is_active AND (NOT _g.is_active OR _g.is_header OR _g.posting_mode = 'blocked' OR _g.account_type <> 'expense') THEN
    RAISE EXCEPTION 'Compte % : une catégorie de frais exige un compte de charge actif et imputable (ni regroupement, ni bloqué)', _g.code
      USING ERRCODE = 'QG027';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_guard_expense_category BEFORE INSERT OR UPDATE ON public.expense_categories
  FOR EACH ROW EXECUTE FUNCTION public.guard_expense_category();
