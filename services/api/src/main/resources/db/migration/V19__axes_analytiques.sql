-- V19 — Axes analytiques : départements, centres de coûts, projets… Écrit à la main.
--
-- POURQUOI
-- journal_lines portait trois colonnes texte libres (department, cost_center,
-- project) : aucune liste de valeurs, aucun contrôle, jamais remplies par les
-- comptabilisations automatiques (vérifié sur le dump : 0 valeur sur 8 lignes).
-- Le cahier des charges exige des « dimensions analytiques (projet/centre de
-- coûts) cohérentes par société » (GL-01).
--
-- MODÈLE (axes séparés du plan de comptes : SAP CO, Sage X3, Dynamics 365)
-- Le plan SYSCOHADA est normalisé et lu par compte dans les états financiers ;
-- l'analytique est une gestion à part, hors du numéro de compte.
--   analytic_axes            axes de la société (Département, Centre de coûts…)
--   analytic_values          sections de chaque axe, hiérarchisées et datées
--   analytic_rules           obligatoire / interdit, par préfixe de compte
--                            (le préfixe le plus long l'emporte ; sans règle :
--                            facultatif)
--   analytic_defaults        section par défaut d'un client, pour un axe
--   ar_invoice_analytics     section choisie sur une facture (prioritaire)
--   journal_line_analytics   imputation d'une ligne d'écriture, un axe = une section
--
-- CONTRÔLE (erreur QG002), à la comptabilisation d'une écriture :
--   - toute section imputée doit être active, d'un axe actif, valide à la date ;
--   - une règle « interdit » refuse toute imputation sur l'axe ;
--   - une règle « obligatoire » exige une section, pour les sources qui savent
--     en fournir aujourd'hui : écritures manuelles, factures clients,
--     encaissements. Les comptabilisations fournisseurs, stock, paie et
--     immobilisations n'ont pas encore de valeurs par défaut (lots 3 et 4) : les
--     soumettre à l'obligation les bloquerait toutes. L'exemption est volontaire,
--     limitée et listée dans enforce_analytics().
--   - une contre-passation reproduit l'original : elle n'est pas recontrôlée, et
--     reverse_journal_entry() recopie désormais l'imputation analytique.
--
-- Les colonnes texte de journal_lines sont conservées (compatibilité de l'écran
-- actuel) mais ne sont plus la source : à retirer quand l'écran sera migré.
--
-- Jumelle : supabase/migrations/20261112150000_6e2b8c1d-4a7f-4d3e-9b5a-1f8c3e6d2a94.sql

-- ─── Clés composites : l'appartenance à une société garantie par le schéma ───

ALTER TABLE public.customers ADD CONSTRAINT customers_id_tenant_key UNIQUE (id, tenant_id);
ALTER TABLE public.ar_invoices ADD CONSTRAINT ar_invoices_id_tenant_key UNIQUE (id, tenant_id);

CREATE TABLE public.analytic_axes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    code text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]*$'),
    name text NOT NULL CHECK (length(btrim(name)) > 0),
    sort_order integer NOT NULL DEFAULT 0,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, code),
    UNIQUE (id, tenant_id)
);

CREATE TABLE public.analytic_values (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    axis_id uuid NOT NULL,
    code text NOT NULL CHECK (length(btrim(code)) > 0),
    name text NOT NULL CHECK (length(btrim(name)) > 0),
    parent_id uuid,
    valid_from date,
    valid_to date,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (axis_id, code),
    UNIQUE (id, axis_id),
    FOREIGN KEY (axis_id, tenant_id) REFERENCES public.analytic_axes(id, tenant_id) ON DELETE CASCADE,
    -- Le parent est une section du MÊME axe.
    FOREIGN KEY (parent_id, axis_id) REFERENCES public.analytic_values(id, axis_id),
    CHECK (parent_id IS NULL OR parent_id <> id),
    CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_from <= valid_to)
);
CREATE INDEX analytic_values_parent_idx ON public.analytic_values (parent_id, axis_id);

CREATE TABLE public.analytic_rules (
    tenant_id uuid NOT NULL,
    axis_id uuid NOT NULL,
    account_prefix text NOT NULL CHECK (account_prefix ~ '^[0-9]+$'),
    requirement text NOT NULL CHECK (requirement IN ('required', 'forbidden')),
    PRIMARY KEY (axis_id, account_prefix),
    FOREIGN KEY (axis_id, tenant_id) REFERENCES public.analytic_axes(id, tenant_id) ON DELETE CASCADE
);

CREATE TABLE public.analytic_defaults (
    tenant_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    axis_id uuid NOT NULL,
    value_id uuid NOT NULL,
    PRIMARY KEY (customer_id, axis_id),
    FOREIGN KEY (customer_id, tenant_id) REFERENCES public.customers(id, tenant_id) ON DELETE CASCADE,
    FOREIGN KEY (axis_id, tenant_id) REFERENCES public.analytic_axes(id, tenant_id) ON DELETE CASCADE,
    FOREIGN KEY (value_id, axis_id) REFERENCES public.analytic_values(id, axis_id)
);
CREATE INDEX analytic_defaults_value_idx ON public.analytic_defaults (value_id, axis_id);

CREATE TABLE public.ar_invoice_analytics (
    tenant_id uuid NOT NULL,
    invoice_id uuid NOT NULL,
    axis_id uuid NOT NULL,
    value_id uuid NOT NULL,
    PRIMARY KEY (invoice_id, axis_id),
    FOREIGN KEY (invoice_id, tenant_id) REFERENCES public.ar_invoices(id, tenant_id) ON DELETE CASCADE,
    FOREIGN KEY (axis_id, tenant_id) REFERENCES public.analytic_axes(id, tenant_id) ON DELETE CASCADE,
    FOREIGN KEY (value_id, axis_id) REFERENCES public.analytic_values(id, axis_id)
);
CREATE INDEX ar_invoice_analytics_value_idx ON public.ar_invoice_analytics (value_id, axis_id);

CREATE TABLE public.journal_line_analytics (
    line_id uuid NOT NULL REFERENCES public.journal_lines(id) ON DELETE CASCADE,
    axis_id uuid NOT NULL,
    value_id uuid NOT NULL,
    PRIMARY KEY (line_id, axis_id),
    FOREIGN KEY (value_id, axis_id) REFERENCES public.analytic_values(id, axis_id)
);
CREATE INDEX journal_line_analytics_value_idx ON public.journal_line_analytics (value_id, axis_id);

-- ─── Fonctions ───

-- Le porteur a l'un de ces rôles DANS la société courante (has_role() ignore la société).
CREATE FUNCTION public.tenant_has_any_role(_roles text[]) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles r
    WHERE r.user_id = auth.uid()
      AND r.tenant_id = public.get_user_tenant_id(auth.uid())
      AND r.role::text = ANY (_roles))
$$;

-- Imputation d'une ligne : même société que l'écriture, et figée une fois comptabilisée.
CREATE FUNCTION public.guard_journal_line_analytics() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _line_id uuid := COALESCE(NEW.line_id, OLD.line_id);
  _entry public.journal_entries%ROWTYPE;
BEGIN
  SELECT e.* INTO _entry FROM public.journal_lines l
  JOIN public.journal_entries e ON e.id = l.entry_id WHERE l.id = _line_id;

  IF _entry.status IN ('posted', 'reversed') THEN
    RAISE EXCEPTION 'Imputation analytique figée : l''écriture % est comptabilisée (contre-passer pour corriger)', _entry.entry_number
      USING ERRCODE = 'QG002';
  END IF;
  IF TG_OP <> 'DELETE' AND NOT EXISTS (
      SELECT 1 FROM public.analytic_axes a WHERE a.id = NEW.axis_id AND a.tenant_id = _entry.tenant_id) THEN
    RAISE EXCEPTION 'Axe analytique inconnu dans la société de l''écriture %', _entry.entry_number
      USING ERRCODE = '23503';
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$;

-- Section choisie sur une facture : modifiable tant que la facture est en brouillon.
CREATE FUNCTION public.guard_ar_invoice_analytics() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _status text;
BEGIN
  SELECT status INTO _status FROM public.ar_invoices WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF _status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Imputation analytique figée : la facture n''est plus en brouillon'
      USING ERRCODE = 'QG002';
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$;

-- Contrôle à la comptabilisation (BEFORE INSERT OR UPDATE sur journal_entries).
CREATE FUNCTION public.enforce_analytics() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  -- Sources qui savent aujourd'hui fournir une imputation (manuelle, facture
  -- client via client ou facture, encaissement). À étendre avec les lots 3 et 4.
  _sources_controlees constant text[] := ARRAY['manual', 'ar_invoice', 'ar_receipt'];
  _p record;
BEGIN
  IF NEW.status <> 'posted' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'posted' THEN RETURN NEW; END IF;
  -- Une contre-passation reproduit une écriture déjà contrôlée.
  IF NEW.source = 'reversal' THEN RETURN NEW; END IF;

  -- 1. Sections imputées utilisables à la date de l'écriture.
  SELECT a.name AS axe, v.code AS section, g.code AS compte INTO _p
  FROM public.journal_lines l
  JOIN public.journal_line_analytics la ON la.line_id = l.id
  JOIN public.analytic_values v ON v.id = la.value_id
  JOIN public.analytic_axes a ON a.id = la.axis_id
  JOIN public.gl_accounts g ON g.id = l.account_id
  WHERE l.entry_id = NEW.id
    AND (NOT v.is_active OR NOT a.is_active
         OR (v.valid_from IS NOT NULL AND NEW.entry_date < v.valid_from)
         OR (v.valid_to IS NOT NULL AND NEW.entry_date > v.valid_to))
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Imputation analytique invalide : la section % de l''axe « % » n''est pas utilisable le % (compte %)',
      _p.section, _p.axe, NEW.entry_date, _p.compte
      USING ERRCODE = 'QG002',
            HINT = 'Réactiver la section, corriger ses dates de validité, ou en choisir une autre.';
  END IF;

  -- 2. Règles : pour chaque ligne et chaque axe actif, la règle au préfixe le plus long.
  SELECT a.name AS axe, g.code AS compte, r.requirement INTO _p
  FROM public.journal_lines l
  JOIN public.gl_accounts g ON g.id = l.account_id
  JOIN public.analytic_axes a ON a.tenant_id = NEW.tenant_id AND a.is_active
  JOIN LATERAL (
    SELECT ru.requirement FROM public.analytic_rules ru
    WHERE ru.axis_id = a.id AND g.code LIKE ru.account_prefix || '%'
    ORDER BY length(ru.account_prefix) DESC
    LIMIT 1) r ON true
  LEFT JOIN public.journal_line_analytics la ON la.line_id = l.id AND la.axis_id = a.id
  WHERE l.entry_id = NEW.id
    AND ((r.requirement = 'required' AND la.line_id IS NULL AND NEW.source = ANY (_sources_controlees))
      OR (r.requirement = 'forbidden' AND la.line_id IS NOT NULL))
  ORDER BY a.sort_order, a.code, g.code
  LIMIT 1;
  IF FOUND THEN
    IF _p.requirement = 'required' THEN
      RAISE EXCEPTION 'Imputation analytique incomplète : l''axe « % » est obligatoire sur le compte % (écriture %)',
        _p.axe, _p.compte, NEW.entry_number
        USING ERRCODE = 'QG002',
              HINT = 'Choisir une section sur la pièce, ou définir une section par défaut pour le client.';
    ELSE
      RAISE EXCEPTION 'Imputation analytique interdite : l''axe « % » ne s''applique pas au compte % (écriture %)',
        _p.axe, _p.compte, NEW.entry_number
        USING ERRCODE = 'QG002';
    END IF;
  END IF;

  RETURN NEW;
END; $$;

-- ─── Comptabilisation AR : imputation de la ligne de produit (remplace V18) ───
-- Seule la ligne de produit (rôle SALES_REVENUE) reçoit l'analytique : c'est la
-- ligne de gestion. Priorité : section choisie sur la facture, puis section par
-- défaut du client. Le reste est inchangé.

CREATE OR REPLACE FUNCTION public.on_ar_invoice_posted() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _entry_id uuid; _entry_number text; _rev_line uuid;
  _ar uuid; _rev uuid; _vat uuid;
  _manquants text[] := '{}';
BEGIN
  IF NEW.journal_entry_id IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('sent','open','posted') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN RETURN NEW; END IF;

  _ar  := public.posting_account(NEW.tenant_id, 'AR_RECEIVABLE');
  _rev := public.posting_account(NEW.tenant_id, 'SALES_REVENUE');
  _vat := public.posting_account(NEW.tenant_id, 'VAT_OUTPUT');

  IF _ar  IS NULL THEN _manquants := _manquants || 'AR_RECEIVABLE'::text; END IF;
  IF _rev IS NULL THEN _manquants := _manquants || 'SALES_REVENUE'::text; END IF;
  IF COALESCE(NEW.tax_amount,0) > 0 AND _vat IS NULL THEN
    _manquants := _manquants || 'VAT_OUTPUT'::text;
  END IF;
  IF cardinality(_manquants) > 0 THEN
    RAISE EXCEPTION 'Paramétrage comptable incomplet : % ; la facture % ne peut pas être émise',
      public.posting_roles_label(_manquants), NEW.invoice_number
      USING ERRCODE = 'QG001',
            HINT = 'Associer un compte actif à chaque rôle dans le paramétrage comptable, ou enregistrer la facture en brouillon.';
  END IF;

  _entry_number := 'JE-AR-' || to_char(now(),'YYYYMMDD') || '-' || substr(NEW.id::text,1,8);

  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES (NEW.tenant_id, _entry_number, NEW.invoice_date, 'AR Invoice: '||NEW.invoice_number, 'ar_invoice', 'draft', NEW.created_by)
  RETURNING id INTO _entry_id;

  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  VALUES (_entry_id, _ar, NEW.total, 0, 'DR Clients');
  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  VALUES (_entry_id, _rev, 0, NEW.subtotal, 'CR Ventes HT')
  RETURNING id INTO _rev_line;
  IF COALESCE(NEW.tax_amount,0) > 0 THEN
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _vat, 0, NEW.tax_amount, 'CR TVA collectée');
  END IF;

  INSERT INTO public.journal_line_analytics (line_id, axis_id, value_id)
  SELECT _rev_line, a.id, COALESCE(ia.value_id, d.value_id)
  FROM public.analytic_axes a
  LEFT JOIN public.ar_invoice_analytics ia ON ia.invoice_id = NEW.id AND ia.axis_id = a.id
  LEFT JOIN public.analytic_defaults d ON d.customer_id = NEW.customer_id AND d.axis_id = a.id
  WHERE a.tenant_id = NEW.tenant_id AND a.is_active
    AND COALESCE(ia.value_id, d.value_id) IS NOT NULL;

  UPDATE public.journal_entries
    SET status = 'posted', posted_by = NEW.created_by, posted_at = now()
    WHERE id = _entry_id;

  NEW.journal_entry_id := _entry_id;
  RETURN NEW;
END; $$;

-- ─── Contre-passation : recopie l'imputation analytique (remplace la version du dump) ───
-- Identique à l'original, sauf : les lignes sont recopiées une à une pour
-- reporter leur imputation analytique, et leurs colonnes texte historiques.

CREATE OR REPLACE FUNCTION public.reverse_journal_entry(_entry_id uuid, _reverse_date date DEFAULT CURRENT_DATE, _reason text DEFAULT 'Contre-passation'::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _src public.journal_entries%ROWTYPE;
  _line public.journal_lines%ROWTYPE;
  _new_id uuid;
  _new_line uuid;
  _new_number text;
  _tenant uuid := public.get_user_tenant_id(auth.uid());
BEGIN
  SELECT * INTO _src FROM public.journal_entries WHERE id = _entry_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entry not found'; END IF;
  IF _src.tenant_id <> _tenant THEN RAISE EXCEPTION 'Tenant mismatch'; END IF;
  IF _src.status <> 'posted' THEN
    RAISE EXCEPTION 'Only posted entries can be reversed (status=%)', _src.status;
  END IF;

  _new_number := 'REV-' || _src.entry_number || '-' || to_char(now(),'YYYYMMDDHH24MISS');

  INSERT INTO public.journal_entries
    (tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES
    (_src.tenant_id, _new_number, _reverse_date,
     'Reversal of '||_src.entry_number||' — '||COALESCE(_reason,''),
     'reversal', 'draft', auth.uid())
  RETURNING id INTO _new_id;

  FOR _line IN SELECT * FROM public.journal_lines WHERE entry_id = _src.id ORDER BY id LOOP
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description, cost_center, department, project)
    VALUES (_new_id, _line.account_id, _line.credit, _line.debit,
            'Reversal: '||COALESCE(_line.description,''), _line.cost_center, _line.department, _line.project)
    RETURNING id INTO _new_line;
    INSERT INTO public.journal_line_analytics (line_id, axis_id, value_id)
    SELECT _new_line, la.axis_id, la.value_id FROM public.journal_line_analytics la WHERE la.line_id = _line.id;
  END LOOP;

  UPDATE public.journal_entries
     SET status='posted', posted_by=auth.uid(), posted_at=now()
   WHERE id = _new_id;

  UPDATE public.journal_entries
     SET status='reversed'
   WHERE id = _src.id;

  RETURN _new_id;
END; $$;

-- ─── Déclencheurs ───

CREATE TRIGGER trg_enforce_analytics BEFORE INSERT OR UPDATE ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.enforce_analytics();
CREATE TRIGGER trg_guard_journal_line_analytics BEFORE INSERT OR UPDATE OR DELETE ON public.journal_line_analytics
  FOR EACH ROW EXECUTE FUNCTION public.guard_journal_line_analytics();
CREATE TRIGGER trg_guard_ar_invoice_analytics BEFORE INSERT OR UPDATE OR DELETE ON public.ar_invoice_analytics
  FOR EACH ROW EXECUTE FUNCTION public.guard_ar_invoice_analytics();

-- ─── Sécurité ───
-- Axes et règles : structure de l'analytique, réservée à l'administrateur.
-- Sections et valeurs par défaut : données de gestion, administrateur ou comptable.
-- Imputations : lisibles dans la société, écrites par l'administrateur ou le comptable
-- (le déclencheur de garde fige ce qui est comptabilisé).

ALTER TABLE public.analytic_axes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytic_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytic_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytic_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ar_invoice_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_line_analytics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation" ON public.analytic_axes FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Administrateur de la société" ON public.analytic_axes FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.is_tenant_admin())
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.is_tenant_admin());

CREATE POLICY "Tenant isolation" ON public.analytic_rules FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Administrateur de la société" ON public.analytic_rules FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.is_tenant_admin())
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.is_tenant_admin());

CREATE POLICY "Tenant isolation" ON public.analytic_values FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Gestion comptable" ON public.analytic_values FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.tenant_has_any_role(ARRAY['admin', 'accountant']))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.tenant_has_any_role(ARRAY['admin', 'accountant']));

CREATE POLICY "Tenant isolation" ON public.analytic_defaults FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Gestion comptable" ON public.analytic_defaults FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.tenant_has_any_role(ARRAY['admin', 'accountant']))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.tenant_has_any_role(ARRAY['admin', 'accountant']));

CREATE POLICY "Tenant isolation" ON public.ar_invoice_analytics FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Gestion comptable" ON public.ar_invoice_analytics FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.tenant_has_any_role(ARRAY['admin', 'accountant']))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.tenant_has_any_role(ARRAY['admin', 'accountant']));

CREATE POLICY "Tenant isolation" ON public.journal_line_analytics FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.journal_lines l JOIN public.journal_entries e ON e.id = l.entry_id
                 WHERE l.id = journal_line_analytics.line_id AND e.tenant_id = public.get_user_tenant_id(auth.uid())));
CREATE POLICY "Gestion comptable" ON public.journal_line_analytics FOR ALL TO authenticated
  USING (public.tenant_has_any_role(ARRAY['admin', 'accountant'])
         AND EXISTS (SELECT 1 FROM public.journal_lines l JOIN public.journal_entries e ON e.id = l.entry_id
                     WHERE l.id = journal_line_analytics.line_id AND e.tenant_id = public.get_user_tenant_id(auth.uid())))
  WITH CHECK (public.tenant_has_any_role(ARRAY['admin', 'accountant'])
         AND EXISTS (SELECT 1 FROM public.journal_lines l JOIN public.journal_entries e ON e.id = l.entry_id
                     WHERE l.id = journal_line_analytics.line_id AND e.tenant_id = public.get_user_tenant_id(auth.uid())));

-- Nouvelles fonctions : EXECUTE fermé à PUBLIC (voir V18), ouvert au strict nécessaire.
REVOKE ALL ON FUNCTION public.tenant_has_any_role(text[]), public.guard_journal_line_analytics(),
  public.guard_ar_invoice_analytics(), public.enforce_analytics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tenant_has_any_role(text[]) TO authenticated, service_role;

-- Supabase accorde par défaut tables et fonctions nouvelles à `anon` (voir V18).
REVOKE ALL ON public.analytic_axes, public.analytic_values, public.analytic_rules,
  public.analytic_defaults, public.ar_invoice_analytics, public.journal_line_analytics FROM anon;
REVOKE ALL ON FUNCTION public.tenant_has_any_role(text[]), public.guard_journal_line_analytics(),
  public.guard_ar_invoice_analytics(), public.enforce_analytics() FROM anon;
