-- V101 — Isolation des sociétés : fonctions SECURITY DEFINER qui prennent une société en paramètre.
--
-- Revue du 17 nov. 2026 : une fonction SECURITY DEFINER s'exécute avec les droits de son propriétaire et
-- ignore la sécurité par ligne. Exposée aux utilisateurs avec un paramètre « société », elle répond pour
-- n'importe quelle société. Constats (rejoués sur la copie réelle) :
--   * budget_actual / budget_committed / budget_precommitted / budget_availability (V77) : totaux comptables et
--     engagements d'une autre société ;
--   * notify_inventory / notify_procurement / notify_sales : notification écrite dans une autre société ;
--   * seed_ap_defaults : paramètres écrits dans une autre société ;
--   * ar_setting, sales_setting, procurement_setting, budget_setting, chart_import_setting, treasury_require_account,
--     assert_fiscal_period_open, asset_setting : paramètres d'une autre société lisibles.
-- Règle : une fonction interne (appelée seulement par d'autres fonctions de la base) n'est plus exécutable par
-- les utilisateurs ; une fonction appelée dans le contexte de l'utilisateur (politiques RLS, gardes non
-- SECURITY DEFINER) ne répond plus que pour la société de l'appelant. SchemaMigrationIT / IsolationSocietesIT
-- vérifient désormais qu'aucune nouvelle fonction ne réintroduit le défaut.

-- 1. Fonctions internes : plus d'exécution directe par les utilisateurs.
REVOKE EXECUTE ON FUNCTION public.ar_setting(uuid), public.sales_setting(uuid), public.procurement_setting(uuid), public.asset_setting(uuid),
  public.budget_setting(uuid), public.chart_import_setting(uuid), public.treasury_require_account(uuid),
  public.assert_fiscal_period_open(uuid, date, text),
  public.budget_actual(uuid, text, date, date, uuid), public.budget_committed(uuid, text, date, date, uuid, uuid),
  public.budget_precommitted(uuid, text, date, date, uuid, uuid), public.budget_availability(uuid, uuid, date, uuid, uuid, uuid[]),
  public.notify_inventory(uuid, text, text, text, text), public.notify_procurement(uuid, text, text, text, text),
  public.notify_sales(uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;

-- Fonction retirée par V75 (calcul d'amortissement exécutable sur n'importe quelle société) : encore présente
-- sur des bases mises à jour hors Flyway.
DROP FUNCTION IF EXISTS public.post_monthly_depreciation(uuid, date);

-- 2. Fonctions appelées dans le contexte de l'utilisateur : réponse limitée à la société de l'appelant.
--    (Sans session utilisateur — code de la base, migrations, tests propriétaires — le comportement est inchangé.)
CREATE OR REPLACE FUNCTION public.caller_tenant_matches(_tenant uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NULL OR _tenant IS NOT DISTINCT FROM public.get_user_tenant_id(auth.uid())
$function$;
GRANT EXECUTE ON FUNCTION public.caller_tenant_matches(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.budget_account_ok(_tenant uuid, _account uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.caller_tenant_matches(_tenant)
     AND EXISTS (SELECT 1 FROM public.gl_accounts g WHERE g.id = _account AND g.tenant_id = _tenant
                  AND g.account_type = ANY ((public.budget_setting(_tenant)).budgetable_types))
$function$;

CREATE OR REPLACE FUNCTION public.chart_framework(_tenant uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN public.caller_tenant_matches(_tenant) THEN COALESCE(
    (SELECT c.framework_code FROM public.charts c WHERE c.tenant_id = _tenant AND c.kind = 'operational' AND c.status = 'active'),
    (SELECT s.framework_code FROM public.tenant_accounting_settings s WHERE s.tenant_id = _tenant),
    'SYSCOHADA_REVISE') END
$function$;

CREATE OR REPLACE FUNCTION public.quality_rule_severity(_tenant uuid, _framework text, _rule text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN NOT public.caller_tenant_matches(_tenant) THEN NULL
    WHEN t.tenant_id IS NOT NULL AND NOT t.enabled THEN NULL
    WHEN t.tenant_id IS NOT NULL AND t.severity IS NOT NULL THEN t.severity
    WHEN r.framework_code IS NULL OR NOT r.enabled THEN CASE WHEN t.tenant_id IS NOT NULL AND t.enabled THEN COALESCE(t.severity, 'warning') END
    ELSE r.severity END
  FROM (SELECT 1) x
  LEFT JOIN public.framework_quality_rules r ON r.framework_code = _framework AND r.rule_code = _rule
  LEFT JOIN public.tenant_quality_rules t ON t.tenant_id = _tenant AND t.rule_code = _rule
$function$;

CREATE OR REPLACE FUNCTION public.replenishment_target_ok(_tenant uuid, _item uuid, _supplier uuid, _warehouse uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.caller_tenant_matches(_tenant)
     AND EXISTS (SELECT 1 FROM public.items WHERE id = _item AND tenant_id = _tenant)
     AND (_supplier IS NULL OR EXISTS (SELECT 1 FROM public.suppliers WHERE id = _supplier AND tenant_id = _tenant))
     AND (_warehouse IS NULL OR EXISTS (SELECT 1 FROM public.warehouses WHERE id = _warehouse AND tenant_id = _tenant))
$function$;

-- Paramètres fournisseurs par défaut : seulement pour la société de l'appelant.
CREATE OR REPLACE FUNCTION public.seed_ap_defaults(_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.caller_tenant_matches(_tenant_id) THEN
    RAISE EXCEPTION 'Paramètres fournisseurs : société différente de la vôtre' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.ap_general_settings(tenant_id) VALUES (_tenant_id) ON CONFLICT DO NOTHING;

  INSERT INTO public.ap_numbering_series(tenant_id, doc_type, prefix, format) VALUES
    (_tenant_id, 'Supplier Invoice', 'APINV-', 'APINV-YYYY-####'),
    (_tenant_id, 'Credit Note', 'APCN-', 'APCN-YYYY-####'),
    (_tenant_id, 'Payment', 'APPAY-', 'APPAY-YYYY-####')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.ap_payment_methods(tenant_id, code, label, is_default, is_active) VALUES
    (_tenant_id, 'WIRE', 'Virement bancaire', true, true),
    (_tenant_id, 'CHECK', 'Chèque', false, true),
    (_tenant_id, 'LC', 'Lettre de crédit', false, true),
    (_tenant_id, 'CASH', 'Espèces', false, false)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.ap_withholding_rates(tenant_id, category, rate_pct, gl_account, is_active) VALUES
    (_tenant_id, 'Services (BIC)', 7.5, '4471', true),
    (_tenant_id, 'Loyers', 15, '4472', true),
    (_tenant_id, 'Non-résidents', 20, '4473', true),
    (_tenant_id, 'Dividendes', 10, '4474', false);

  INSERT INTO public.ap_notification_rules(tenant_id, event, channel, recipients) VALUES
    (_tenant_id, 'Facture en attente > 48h', 'email', 'AP Manager'),
    (_tenant_id, 'Échéance dans 3 jours', 'email,inapp', 'AP Clerk, Treasury'),
    (_tenant_id, 'Paiement > 50M XOF', 'inapp', 'CFO'),
    (_tenant_id, 'Échec 3-way match', 'email', 'AP Manager');

  INSERT INTO public.ap_approval_thresholds(tenant_id, level, max_amount, approver, sla_hours, doc_types) VALUES
    (_tenant_id, 'L1 — Clerk', 5000000, 'AP Clerk', 4, 'Facture, Avoir'),
    (_tenant_id, 'L2 — Manager', 20000000, 'AP Manager', 24, 'Facture, Paiement'),
    (_tenant_id, 'L3 — Director', 50000000, 'Finance Director', 48, 'Paiement, Contrat'),
    (_tenant_id, 'L4 — CFO', NULL, 'CFO', 72, 'Tous au-dessus du seuil')
  ON CONFLICT DO NOTHING;
END;
$function$;
