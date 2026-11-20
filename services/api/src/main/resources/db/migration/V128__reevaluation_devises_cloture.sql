-- V128 — Réévaluation de clôture des créances et dettes en devise (écart G-25, lot I1 ; décision D-I1 de
-- docs/audit-erp/11 §7 : SYSCOHADA révisé, prudence).
--   fx_revaluation_items(date)   pièces ouvertes en devise à la date (créances clients émises, dettes fournisseurs
--                                approuvées) : reste dû en devise et en devise de la société au cours d'origine, cours
--                                de clôture, valeur à ce cours, écart (positif = gain latent) ;
--   post_fx_revaluation(date, motif)   (droit currency.revaluation) : une écriture OD datée de la clôture —
--                                perte latente : débit 478 (FX_TRANSLATION_ASSET) / crédit du compte de tiers ; gain
--                                latent : débit du compte de tiers / crédit 479 (FX_TRANSLATION_LIABILITY), sans effet sur
--                                le résultat — contre-passée le lendemain (ouverture) ; provision des pertes latentes :
--                                débit 697 (FX_PROVISION_EXPENSE) / crédit 194 (FX_PROVISION), la provision de la
--                                réévaluation précédente étant d'abord reprise (débit 194 / crédit 797, FX_PROVISION_INCOME).
--   fx_revaluation_runs          historique (lecture seule), une réévaluation par date.
-- Les comptes de tiers suivent les jeux de comptes (V105) ; la réévaluation ne touche ni les factures ni le lettrage.

CREATE TEMP TABLE _v128_roles (code text, label text, description text, syscohada text, syscohada_name text, pcg text, pcg_name text, account_type text) ON COMMIT DROP;
INSERT INTO _v128_roles VALUES
  ('FX_TRANSLATION_ASSET', 'Écarts de conversion – actif', 'Perte latente sur créances et dettes en devise à la clôture', '478', 'Écarts de conversion – actif', '476', 'Différences de conversion – actif', 'asset'),
  ('FX_TRANSLATION_LIABILITY', 'Écarts de conversion – passif', 'Gain latent sur créances et dettes en devise à la clôture (sans produit)', '479', 'Écarts de conversion – passif', '477', 'Différences de conversion – passif', 'liability'),
  ('FX_PROVISION', 'Provisions pour pertes de change', 'Provision des pertes latentes de change', '194', 'Provisions pour pertes de change', '1515', 'Provisions pour pertes de change', 'liability'),
  ('FX_PROVISION_EXPENSE', 'Dotations aux provisions financières', 'Dotation à la provision pour pertes de change', '697', 'Dotations aux provisions et dépréciations financières', '6865', 'Dotations aux provisions financières', 'expense'),
  ('FX_PROVISION_INCOME', 'Reprises de provisions financières', 'Reprise de la provision pour pertes de change', '797', 'Reprises de provisions et dépréciations financières', '7865', 'Reprises sur provisions financières', 'revenue');

INSERT INTO public.posting_roles (code, label, module, description, expected_prefixes)
SELECT r.code, r.label, 'GL', r.description, ARRAY[r.syscohada, r.pcg] FROM _v128_roles r
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.framework_role_expectations (framework_code, role_code, prefixes)
SELECT f.f, r.code, ARRAY[CASE f.f WHEN 'SYSCOHADA_REVISE' THEN r.syscohada ELSE r.pcg END]
  FROM _v128_roles r CROSS JOIN (VALUES ('SYSCOHADA_REVISE'), ('PCG_FR')) AS f(f)
 WHERE EXISTS (SELECT 1 FROM public.accounting_frameworks WHERE code = f.f)
ON CONFLICT (framework_code, role_code) DO NOTHING;
INSERT INTO public.framework_reference_accounts (framework_code, code, name, account_type)
SELECT f.f, CASE f.f WHEN 'SYSCOHADA_REVISE' THEN r.syscohada ELSE r.pcg END, CASE f.f WHEN 'SYSCOHADA_REVISE' THEN r.syscohada_name ELSE r.pcg_name END, r.account_type
  FROM _v128_roles r CROSS JOIN (VALUES ('SYSCOHADA_REVISE'), ('PCG_FR')) AS f(f)
 WHERE EXISTS (SELECT 1 FROM public.accounting_frameworks WHERE code = f.f)
ON CONFLICT (framework_code, code) DO NOTHING;
INSERT INTO public.accounting_framework_accounts (framework_code, code, name, account_type)
SELECT f.f, CASE f.f WHEN 'SYSCOHADA_REVISE' THEN r.syscohada ELSE r.pcg END, CASE f.f WHEN 'SYSCOHADA_REVISE' THEN r.syscohada_name ELSE r.pcg_name END, r.account_type
  FROM _v128_roles r CROSS JOIN (VALUES ('SYSCOHADA_REVISE'), ('PCG_FR')) AS f(f)
 WHERE EXISTS (SELECT 1 FROM public.accounting_frameworks WHERE code = f.f)
   AND NOT EXISTS (SELECT 1 FROM public.accounting_framework_accounts a WHERE a.framework_code = f.f
                    AND a.code = CASE f.f WHEN 'SYSCOHADA_REVISE' THEN r.syscohada ELSE r.pcg END);
INSERT INTO public.accounting_framework_role_defaults (framework_code, role_code, account_code)
SELECT f.f, r.code, CASE f.f WHEN 'SYSCOHADA_REVISE' THEN r.syscohada ELSE r.pcg END
  FROM _v128_roles r CROSS JOIN (VALUES ('SYSCOHADA_REVISE'), ('PCG_FR')) AS f(f)
 WHERE EXISTS (SELECT 1 FROM public.accounting_frameworks WHERE code = f.f)
   AND NOT EXISTS (SELECT 1 FROM public.accounting_framework_role_defaults d WHERE d.framework_code = f.f AND d.role_code = r.code);
INSERT INTO public.gl_accounts (tenant_id, code, name, account_type)
SELECT s.tenant_id, a.code, a.name, a.account_type
  FROM public.tenant_accounting_settings s
  JOIN public.accounting_framework_role_defaults d ON d.framework_code = s.framework_code AND d.role_code IN (SELECT code FROM _v128_roles)
  JOIN public.accounting_framework_accounts a ON a.framework_code = d.framework_code AND a.code = d.account_code
ON CONFLICT (tenant_id, code) DO NOTHING;
INSERT INTO public.tenant_posting_accounts (tenant_id, role_code, gl_account_id)
SELECT s.tenant_id, d.role_code, g.id
  FROM public.tenant_accounting_settings s
  JOIN public.accounting_framework_role_defaults d ON d.framework_code = s.framework_code AND d.role_code IN (SELECT code FROM _v128_roles)
  JOIN public.gl_accounts g ON g.tenant_id = s.tenant_id AND g.code = d.account_code AND g.is_active
ON CONFLICT (tenant_id, role_code) DO NOTHING;

CREATE TABLE public.fx_revaluation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  revaluation_date date NOT NULL,
  reason text NOT NULL,
  gains numeric(18, 2) NOT NULL DEFAULT 0,
  losses numeric(18, 2) NOT NULL DEFAULT 0,
  items jsonb NOT NULL DEFAULT '[]',
  entry_id uuid REFERENCES public.journal_entries (id),
  reversal_entry_id uuid REFERENCES public.journal_entries (id),
  provision_entry_id uuid REFERENCES public.journal_entries (id),
  provision_amount numeric(18, 2) NOT NULL DEFAULT 0,
  provision_reversal_entry_id uuid REFERENCES public.journal_entries (id),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, revaluation_date)
);
ALTER TABLE public.fx_revaluation_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture société" ON public.fx_revaluation_runs FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
GRANT SELECT ON public.fx_revaluation_runs TO authenticated;

CREATE FUNCTION public.fx_revaluation_items(_date date)
RETURNS TABLE (kind text, invoice_id uuid, invoice_number text, party_id uuid, party_name text, currency text, invoice_rate numeric,
               fx_outstanding numeric, book_value numeric, closing_rate numeric, closing_value numeric, difference numeric)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH t AS (SELECT public.get_user_tenant_id(auth.uid()) AS id),
  docs AS (
    SELECT 'ar'::text AS kind, i.id, i.invoice_number, i.customer_id AS party_id, c.name AS party_name, i.currency, i.exchange_rate,
           i.total - COALESCE((SELECT sum(p.amount) FROM public.payments p WHERE p.ar_invoice_id = i.id AND p.payment_date <= _date), 0) AS book
      FROM public.ar_invoices i JOIN public.customers c ON c.id = i.customer_id
     WHERE i.tenant_id = (SELECT id FROM t) AND i.currency IS NOT NULL AND i.invoice_date <= _date
       AND i.status NOT IN ('draft', 'cancelled', 'void')
    UNION ALL
    SELECT 'ap', i.id, i.invoice_number, i.supplier_id, s.name, i.currency, i.exchange_rate,
           i.total - COALESCE((SELECT sum(p.amount) FROM public.payments p WHERE p.ap_invoice_id = i.id AND p.payment_date <= _date), 0)
      FROM public.ap_invoices i JOIN public.suppliers s ON s.id = i.supplier_id
     WHERE i.tenant_id = (SELECT id FROM t) AND i.currency IS NOT NULL AND i.invoice_date <= _date
       AND i.approval_status = 'approved' AND i.status NOT IN ('draft', 'cancelled', 'void'))
  SELECT d.kind, d.id, d.invoice_number, d.party_id, d.party_name, d.currency, d.exchange_rate,
         round(d.book / d.exchange_rate, 2), d.book, r.rate, round(round(d.book / d.exchange_rate, 2) * r.rate, 2),
         CASE WHEN r.rate IS NULL THEN NULL
              WHEN d.kind = 'ar' THEN round(round(d.book / d.exchange_rate, 2) * r.rate, 2) - d.book
              ELSE d.book - round(round(d.book / d.exchange_rate, 2) * r.rate, 2) END
    FROM docs d
    CROSS JOIN LATERAL (SELECT public.exchange_rate_at((SELECT id FROM t), d.currency, _date) AS rate) r
   WHERE d.book > 0
   ORDER BY d.kind, d.currency, d.invoice_number
$$;
REVOKE EXECUTE ON FUNCTION public.fx_revaluation_items(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fx_revaluation_items(date) TO authenticated;

CREATE FUNCTION public.post_fx_revaluation(_date date, _reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _run uuid := gen_random_uuid();
  _entry uuid := gen_random_uuid();
  _rev uuid;
  _prov uuid;
  _prev public.fx_revaluation_runs%ROWTYPE;
  _prev_rev uuid;
  _missing text;
  _gains numeric; _losses numeric;
  _items jsonb;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'currency.revaluation') THEN
    RAISE EXCEPTION 'Droit insuffisant : réévaluer les créances et dettes en devise' USING ERRCODE = '42501';
  END IF;
  IF _date IS NULL THEN RAISE EXCEPTION 'Date de réévaluation obligatoire' USING ERRCODE = 'QG030'; END IF;
  IF NULLIF(btrim(_reason), '') IS NULL THEN RAISE EXCEPTION 'Motif obligatoire (ex. : clôture de l''exercice)' USING ERRCODE = 'QG030'; END IF;
  IF EXISTS (SELECT 1 FROM public.fx_revaluation_runs WHERE tenant_id = _tenant AND revaluation_date = _date) THEN
    RAISE EXCEPTION 'Une réévaluation existe déjà au %', to_char(_date, 'DD/MM/YYYY') USING ERRCODE = 'QG030';
  END IF;
  DROP TABLE IF EXISTS _fx_items;
  CREATE TEMP TABLE _fx_items ON COMMIT DROP AS SELECT * FROM public.fx_revaluation_items(_date);
  SELECT string_agg(DISTINCT currency, ', ') INTO _missing FROM _fx_items WHERE closing_rate IS NULL;
  IF _missing IS NOT NULL THEN
    RAISE EXCEPTION 'Cours de clôture manquant au % pour : % (Paramètres → Devises et cours)', to_char(_date, 'DD/MM/YYYY'), _missing USING ERRCODE = 'QG030';
  END IF;
  SELECT COALESCE(sum(difference) FILTER (WHERE difference > 0), 0), COALESCE(-sum(difference) FILTER (WHERE difference < 0), 0),
         COALESCE(jsonb_agg(to_jsonb(i) ORDER BY i.kind, i.invoice_number), '[]')
    INTO _gains, _losses, _items FROM _fx_items i;

  -- Reprise de la provision de la réévaluation précédente, avant d'en constituer une nouvelle.
  SELECT * INTO _prev FROM public.fx_revaluation_runs
   WHERE tenant_id = _tenant AND revaluation_date < _date AND provision_amount > 0 AND provision_reversal_entry_id IS NULL
   ORDER BY revaluation_date DESC LIMIT 1;
  IF _prev.id IS NOT NULL THEN
    _prev_rev := public.post_two_line_entry(_tenant, _date, 'fx_revaluation', 'Reprise de la provision pour pertes de change du ' || to_char(_prev.revaluation_date, 'DD/MM/YYYY'),
      public.require_posting_account(_tenant, 'FX_PROVISION'), public.require_posting_account(_tenant, 'FX_PROVISION_INCOME'), _prev.provision_amount);
    UPDATE public.fx_revaluation_runs SET provision_reversal_entry_id = _prev_rev WHERE id = _prev.id;
  END IF;

  IF _gains = 0 AND _losses = 0 THEN
    INSERT INTO public.fx_revaluation_runs (id, tenant_id, revaluation_date, reason, gains, losses, items, created_by)
    VALUES (_run, _tenant, _date, btrim(_reason), 0, 0, _items, auth.uid());
    RETURN _run;
  END IF;

  INSERT INTO public.journal_entries (id, tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES (_entry, _tenant, 'REV-' || to_char(_date, 'YYYYMMDD') || '-' || substr(_entry::text, 1, 8), _date,
          'Réévaluation des créances et dettes en devise au ' || to_char(_date, 'DD/MM/YYYY') || ' — ' || btrim(_reason),
          'fx_revaluation', 'draft', auth.uid());
  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  SELECT _entry, x.account_id, sum(x.debit), sum(x.credit), min(x.label)
    FROM (
      SELECT CASE WHEN i.difference < 0 THEN public.require_posting_account(_tenant, 'FX_TRANSLATION_ASSET')
                  ELSE public.require_posting_account(_tenant, CASE i.kind WHEN 'ar' THEN 'AR_RECEIVABLE' ELSE 'AP_PAYABLE' END,
                         CASE i.kind WHEN 'ar' THEN public.customer_account_set(i.party_id) ELSE public.supplier_account_set(i.party_id) END) END AS account_id,
             abs(i.difference) AS debit, 0::numeric AS credit,
             CASE WHEN i.difference < 0 THEN 'Perte latente de change' ELSE 'Gain latent de change' END AS label, 'D' AS side
        FROM _fx_items i WHERE i.difference <> 0
      UNION ALL
      SELECT CASE WHEN i.difference > 0 THEN public.require_posting_account(_tenant, 'FX_TRANSLATION_LIABILITY')
                  ELSE public.require_posting_account(_tenant, CASE i.kind WHEN 'ar' THEN 'AR_RECEIVABLE' ELSE 'AP_PAYABLE' END,
                         CASE i.kind WHEN 'ar' THEN public.customer_account_set(i.party_id) ELSE public.supplier_account_set(i.party_id) END) END,
             0, abs(i.difference),
             CASE WHEN i.difference > 0 THEN 'Gain latent de change' ELSE 'Perte latente de change' END, 'C'
        FROM _fx_items i WHERE i.difference <> 0) x
   GROUP BY x.account_id, x.side;
  UPDATE public.journal_entries SET status = 'posted', posted_by = auth.uid(), posted_at = now() WHERE id = _entry;
  -- Contre-passation à l'ouverture : les pièces gardent leur valeur d'origine, l'écart réel naîtra au règlement.
  _rev := public.reverse_journal_entry(_entry, _date + 1, 'Contre-passation à l''ouverture de la réévaluation du ' || to_char(_date, 'DD/MM/YYYY'));

  IF _losses > 0 THEN
    _prov := public.post_two_line_entry(_tenant, _date, 'fx_revaluation', 'Provision pour pertes de change au ' || to_char(_date, 'DD/MM/YYYY'),
      public.require_posting_account(_tenant, 'FX_PROVISION_EXPENSE'), public.require_posting_account(_tenant, 'FX_PROVISION'), _losses);
  END IF;

  INSERT INTO public.fx_revaluation_runs (id, tenant_id, revaluation_date, reason, gains, losses, items, entry_id, reversal_entry_id,
                                         provision_entry_id, provision_amount, created_by)
  VALUES (_run, _tenant, _date, btrim(_reason), _gains, _losses, _items, _entry, _rev, _prov, _losses, auth.uid());
  RETURN _run;
END $$;
REVOKE EXECUTE ON FUNCTION public.post_fx_revaluation(date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_fx_revaluation(date, text) TO authenticated;

INSERT INTO public.erp_permission_catalog (code, module, action, label) VALUES
  ('currency.revaluation', 'currency', 'revaluation', 'Réévaluer les créances et dettes en devise à la clôture')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.erp_system_role_permissions (role_code, permission_code) VALUES
  ('admin', 'currency.revaluation'), ('accountant', 'currency.revaluation')
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, sp.permission_code
  FROM public.erp_roles r
  JOIN public.erp_system_role_permissions sp ON sp.role_code = r.code
 WHERE r.is_system AND sp.permission_code = 'currency.revaluation'
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

SELECT public.install_tenant_isolation_triggers();
