-- V108 — Paramètres et circuits d'approbation protégés (balayage « tables modifiables par tout membre »).
--
-- Méthode de revue (CLAUDE.md) : tables que « authenticated » peut écrire et dont la politique ne vérifie que
-- la société. Les pièces (paiements, factures, achats, réceptions) sont déjà gardées par leurs déclencheurs
-- de cycle de vie ; restaient sans aucune garde :
--   • les paramètres et seuils d'approbation fournisseurs (ap_*) et achats : un lecteur pouvait supprimer un
--     niveau d'approbation, changer la numérotation, les modes de paiement ou les retenues ;
--   • les files d'approbation (procurement_approvals, ap_approval_queue) et les décisions de rapprochement :
--     un membre pouvait marquer lui-même un niveau « approuvé » puis faire valider le niveau suivant ;
--   • les alertes, les modules activés et les licences de la société.
-- Les files et décisions ne s'écrivent plus que par les fonctions métier (SECURITY DEFINER) ; les paramètres
-- par le droit du catalogue (nouveau : ap.settings) ; modules et licences par l'administrateur de la société.

-- ─── Droit du catalogue ───
INSERT INTO public.erp_permission_catalog (code, module, action, label)
VALUES ('ap.settings', 'ap', 'settings', 'Paramétrer les comptes fournisseurs (seuils, numérotation, modes de paiement, retenues)')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
VALUES ('admin', 'ap.settings'), ('accountant', 'ap.settings')
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, sp.permission_code
  FROM public.erp_roles r
  JOIN public.erp_system_role_permissions sp ON sp.role_code = r.code
 WHERE r.is_system AND r.code IN ('admin', 'accountant') AND sp.permission_code = 'ap.settings'
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

-- ─── Paramètres fournisseurs : lecture société, écriture avec ap.settings ───
DROP POLICY "Tenant isolation" ON public.ap_approval_thresholds;
DROP POLICY "Tenant isolation" ON public.ap_general_settings;
DROP POLICY "Tenant isolation" ON public.ap_notification_rules;
DROP POLICY "Tenant isolation" ON public.ap_numbering_series;
DROP POLICY "Tenant isolation" ON public.ap_payment_methods;
DROP POLICY "Tenant isolation" ON public.ap_withholding_rates;

CREATE POLICY "Lecture société" ON public.ap_approval_thresholds FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Paramétrage habilité" ON public.ap_approval_thresholds FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'ap.settings'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'ap.settings'));
CREATE POLICY "Lecture société" ON public.ap_general_settings FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Paramétrage habilité" ON public.ap_general_settings FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'ap.settings'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'ap.settings'));
CREATE POLICY "Lecture société" ON public.ap_notification_rules FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Paramétrage habilité" ON public.ap_notification_rules FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'ap.settings'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'ap.settings'));
CREATE POLICY "Lecture société" ON public.ap_numbering_series FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Paramétrage habilité" ON public.ap_numbering_series FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'ap.settings'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'ap.settings'));
CREATE POLICY "Lecture société" ON public.ap_payment_methods FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Paramétrage habilité" ON public.ap_payment_methods FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'ap.settings'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'ap.settings'));
CREATE POLICY "Lecture société" ON public.ap_withholding_rates FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Paramétrage habilité" ON public.ap_withholding_rates FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'ap.settings'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'ap.settings'));

-- ─── Seuils d'approbation des achats : écriture avec procurement.settings ; un niveau par type ───
DROP POLICY tenant_isolation_proc_thresholds ON public.procurement_approval_thresholds;
CREATE POLICY "Lecture société" ON public.procurement_approval_thresholds FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Paramétrage habilité" ON public.procurement_approval_thresholds FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'procurement.settings'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'procurement.settings'));
CREATE UNIQUE INDEX procurement_approval_thresholds_level_key ON public.procurement_approval_thresholds (tenant_id, doc_type, level);
CREATE UNIQUE INDEX ap_approval_thresholds_level_key ON public.ap_approval_thresholds (tenant_id, level);
ALTER TABLE public.procurement_approval_thresholds ADD CONSTRAINT procurement_approval_thresholds_values_check
  CHECK (btrim(level) <> '' AND btrim(approver) <> '' AND sla_hours > 0 AND (max_amount IS NULL OR max_amount > 0)) NOT VALID;
ALTER TABLE public.ap_approval_thresholds ADD CONSTRAINT ap_approval_thresholds_values_check
  CHECK (btrim(level) <> '' AND btrim(approver) <> '' AND sla_hours > 0 AND (max_amount IS NULL OR max_amount > 0)) NOT VALID;

-- ─── Files d'approbation, décisions de rapprochement, alertes : écrites par les fonctions métier seulement ───
DROP POLICY tenant_isolation_proc_approvals ON public.procurement_approvals;
CREATE POLICY "Lecture société" ON public.procurement_approvals FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
DROP POLICY tenant_isolation_match_dec ON public.procurement_match_decisions;
CREATE POLICY "Lecture société" ON public.procurement_match_decisions FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
DROP POLICY "Tenant isolation" ON public.ap_approval_queue;
CREATE POLICY "Lecture société" ON public.ap_approval_queue FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
DROP POLICY "Tenant isolation" ON public.erp_alerts;
CREATE POLICY "Lecture société" ON public.erp_alerts FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.procurement_approvals, public.procurement_match_decisions, public.ap_approval_queue, public.erp_alerts
  FROM anon, authenticated;

-- ─── Modules et licences : l'administrateur de la société ───
DROP POLICY "Tenant isolation" ON public.tenant_modules;
CREATE POLICY "Lecture société" ON public.tenant_modules FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Administrateur de la société" ON public.tenant_modules FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.is_tenant_admin())
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.is_tenant_admin());
DROP POLICY "Tenant isolation" ON public.licenses;
CREATE POLICY "Lecture société" ON public.licenses FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.licenses FROM anon, authenticated;
