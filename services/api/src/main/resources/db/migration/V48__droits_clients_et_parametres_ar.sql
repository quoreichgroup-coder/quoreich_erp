-- V48 — Fiches clients et paramètres des comptes clients : écriture réservée aux rôles habilités.
--
-- Comme les tables transactionnelles avant V42, customers, ar_payment_terms, ar_dunning_rules et
-- ar_notification_rules n'avaient qu'une politique « Tenant isolation » FOR ALL : tout membre de la
-- société, un « Lecteur » compris, créait, modifiait ou supprimait clients, conditions de paiement,
-- niveaux de relance et règles de notification. Désormais :
--   * lecture : tout membre de la société (inchangé) ;
--   * fiche client — création et modification : administrateur, comptable, commerciaux (sales_*),
--     CRM (crm_admin, crm_manager) ; suppression : administrateur ou comptable (une fiche citée par
--     une pièce reste protégée par les clés étrangères : on la désactive) ;
--   * paramètres AR (conditions, relances, notifications) : administrateur ou comptable.

DROP POLICY "Tenant isolation" ON public.customers;
CREATE POLICY "Lecture société" ON public.customers FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Création habilitée" ON public.customers FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid())
    AND public.tenant_has_any_role(ARRAY['admin', 'accountant', 'sales_manager', 'sales_rep', 'sales_controller', 'crm_admin', 'crm_manager']));
CREATE POLICY "Modification habilitée" ON public.customers FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid())
    AND public.tenant_has_any_role(ARRAY['admin', 'accountant', 'sales_manager', 'sales_rep', 'sales_controller', 'crm_admin', 'crm_manager']))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Suppression comptable" ON public.customers FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.tenant_has_any_role(ARRAY['admin', 'accountant']));

DROP POLICY "Tenant isolation" ON public.ar_payment_terms;
CREATE POLICY "Lecture société" ON public.ar_payment_terms FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Gestion comptable" ON public.ar_payment_terms FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.tenant_has_any_role(ARRAY['admin', 'accountant']))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.tenant_has_any_role(ARRAY['admin', 'accountant']));

DROP POLICY "Tenant isolation" ON public.ar_dunning_rules;
CREATE POLICY "Lecture société" ON public.ar_dunning_rules FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Gestion comptable" ON public.ar_dunning_rules FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.tenant_has_any_role(ARRAY['admin', 'accountant']))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.tenant_has_any_role(ARRAY['admin', 'accountant']));

DROP POLICY "Tenant isolation" ON public.ar_notification_rules;
CREATE POLICY "Lecture société" ON public.ar_notification_rules FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Gestion comptable" ON public.ar_notification_rules FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.tenant_has_any_role(ARRAY['admin', 'accountant']))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.tenant_has_any_role(ARRAY['admin', 'accountant']));
