-- V116 — Dernières tables modifiables par tout membre (balayage du 19 nov. 2026, méthode de CLAUDE.md).
--
-- Constat (base locale, rôle authenticated) : politiques qui ne vérifiaient que la société, sans déclencheur de
-- garde vérifiant un droit :
--   • achats : demandes, commandes, réceptions et leurs lignes et sections analytiques. Les déclencheurs (V34,
--     V39) ne contrôlent que l'état de la pièce : un « Lecteur » pouvait créer une commande, ou créer et valider
--     une réception — donc mouvementer le stock et passer l'écriture de réception (V72) ;
--   • prévisions de trésorerie (cashflow_forecasts), modèles de rapports (report_templates), règles et instances
--     de flux (workflow_rules, workflow_instances), ancienne matrice de droits (erp_permissions, plus lue depuis
--     V23), historique des analyses IA (ai_analysis_history : falsifiable ou effaçable par tout membre).
-- Règle du propriétaire (« tout paramétrable ») : chaque écriture relève d'un droit du catalogue, accordé par
-- défaut aux rôles qui le pratiquaient, attribuable à un rôle personnalisé.
-- Références : SAP (objets d'autorisation M_BANF_*, M_BEST_*, M_MSEG_* : demande, commande, entrée de
-- marchandises distincts), Sage X3 (habilitations fonctionnelles par fonction), AUDCIF (séparation des tâches).

-- ─── Droits du catalogue ───
INSERT INTO public.erp_permission_catalog (code, module, action, label) VALUES
  ('procurement.requisition', 'procurement', 'requisition', 'Créer et modifier des demandes d''achat'),
  ('procurement.order', 'procurement', 'order', 'Créer et modifier des commandes fournisseurs'),
  ('procurement.receive', 'procurement', 'receive', 'Enregistrer et valider des réceptions de marchandises'),
  ('reports.templates', 'reports', 'templates', 'Créer et modifier les modèles de rapports'),
  ('workflow.manage', 'workflow', 'manage', 'Paramétrer les règles de circuit de validation')
ON CONFLICT (code) DO NOTHING;

-- Demandes : direction, achats, stocks et projets (les autres rôles l'obtiennent par un rôle personnalisé).
INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
SELECT r.code, 'procurement.requisition' FROM public.erp_system_roles r
 WHERE r.code IN ('admin', 'manager', 'procurement_controller', 'procurement_l1', 'procurement_l2', 'procurement_l3',
                  'inventory_manager', 'inventory_controller', 'inventory_clerk', 'project_admin', 'project_planner')
ON CONFLICT DO NOTHING;
INSERT INTO public.erp_system_role_permissions (role_code, permission_code) VALUES
  ('admin', 'procurement.order'), ('manager', 'procurement.order'), ('procurement_controller', 'procurement.order'),
  ('procurement_l1', 'procurement.order'), ('procurement_l2', 'procurement.order'), ('procurement_l3', 'procurement.order'),
  ('admin', 'procurement.receive'), ('procurement_controller', 'procurement.receive'), ('procurement_l1', 'procurement.receive'),
  ('procurement_l2', 'procurement.receive'), ('procurement_l3', 'procurement.receive'), ('inventory_manager', 'procurement.receive'),
  ('inventory_controller', 'procurement.receive'), ('inventory_clerk', 'procurement.receive'),
  ('admin', 'reports.templates'), ('accountant', 'reports.templates'), ('manager', 'reports.templates'),
  ('admin', 'workflow.manage')
ON CONFLICT DO NOTHING;

SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, sp.permission_code
  FROM public.erp_roles r
  JOIN public.erp_system_role_permissions sp ON sp.role_code = r.code
 WHERE r.is_system
   AND sp.permission_code IN ('procurement.requisition', 'procurement.order', 'procurement.receive', 'reports.templates', 'workflow.manage')
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

-- ─── Achats : lecture société, écriture avec le droit de la pièce ───
DROP POLICY "Tenant isolation" ON public.purchase_requisitions;
CREATE POLICY "Lecture société" ON public.purchase_requisitions FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Saisie habilitée" ON public.purchase_requisitions FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'procurement.requisition'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'procurement.requisition'));

DROP POLICY "Access via requisition" ON public.requisition_lines;
CREATE POLICY "Lecture avec la pièce" ON public.requisition_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.purchase_requisitions d WHERE d.id = requisition_lines.requisition_id
                   AND d.tenant_id = public.get_user_tenant_id(auth.uid())));
CREATE POLICY "Saisie habilitée" ON public.requisition_lines FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'procurement.requisition') AND EXISTS (SELECT 1 FROM public.purchase_requisitions d
           WHERE d.id = requisition_lines.requisition_id AND d.tenant_id = public.get_user_tenant_id(auth.uid())))
  WITH CHECK (public.has_permission(auth.uid(), 'procurement.requisition') AND EXISTS (SELECT 1 FROM public.purchase_requisitions d
           WHERE d.id = requisition_lines.requisition_id AND d.tenant_id = public.get_user_tenant_id(auth.uid())));

DROP POLICY "Tenant isolation" ON public.purchase_orders;
CREATE POLICY "Lecture société" ON public.purchase_orders FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Saisie habilitée" ON public.purchase_orders FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'procurement.order'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'procurement.order'));

DROP POLICY "Access via PO" ON public.po_lines;
CREATE POLICY "Lecture avec la pièce" ON public.po_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.purchase_orders d WHERE d.id = po_lines.po_id AND d.tenant_id = public.get_user_tenant_id(auth.uid())));
CREATE POLICY "Saisie habilitée" ON public.po_lines FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'procurement.order') AND EXISTS (SELECT 1 FROM public.purchase_orders d
           WHERE d.id = po_lines.po_id AND d.tenant_id = public.get_user_tenant_id(auth.uid())))
  WITH CHECK (public.has_permission(auth.uid(), 'procurement.order') AND EXISTS (SELECT 1 FROM public.purchase_orders d
           WHERE d.id = po_lines.po_id AND d.tenant_id = public.get_user_tenant_id(auth.uid())));

DROP POLICY "Tenant isolation" ON public.goods_receipts;
CREATE POLICY "Lecture société" ON public.goods_receipts FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Saisie habilitée" ON public.goods_receipts FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'procurement.receive'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'procurement.receive'));

DROP POLICY "Access via GR" ON public.gr_lines;
CREATE POLICY "Lecture avec la pièce" ON public.gr_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.goods_receipts d WHERE d.id = gr_lines.gr_id AND d.tenant_id = public.get_user_tenant_id(auth.uid())));
CREATE POLICY "Saisie habilitée" ON public.gr_lines FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'procurement.receive') AND EXISTS (SELECT 1 FROM public.goods_receipts d
           WHERE d.id = gr_lines.gr_id AND d.tenant_id = public.get_user_tenant_id(auth.uid())))
  WITH CHECK (public.has_permission(auth.uid(), 'procurement.receive') AND EXISTS (SELECT 1 FROM public.goods_receipts d
           WHERE d.id = gr_lines.gr_id AND d.tenant_id = public.get_user_tenant_id(auth.uid())));

-- Sections analytiques des pièces d'achat (V77, V78) : même droit que la pièce.
ALTER POLICY "Écriture avec la pièce" ON public.purchase_requisition_analytics
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'procurement.requisition')
         AND EXISTS (SELECT 1 FROM public.purchase_requisitions d WHERE d.id = purchase_requisition_analytics.document_id))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'procurement.requisition')
         AND EXISTS (SELECT 1 FROM public.purchase_requisitions d WHERE d.id = purchase_requisition_analytics.document_id));
ALTER POLICY "Écriture avec la pièce" ON public.requisition_line_analytics
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'procurement.requisition')
         AND EXISTS (SELECT 1 FROM public.requisition_lines l JOIN public.purchase_requisitions d ON d.id = l.requisition_id
                      WHERE l.id = requisition_line_analytics.line_id))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'procurement.requisition')
         AND EXISTS (SELECT 1 FROM public.requisition_lines l JOIN public.purchase_requisitions d ON d.id = l.requisition_id
                      WHERE l.id = requisition_line_analytics.line_id));
ALTER POLICY "Écriture avec la pièce" ON public.purchase_order_analytics
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'procurement.order')
         AND EXISTS (SELECT 1 FROM public.purchase_orders d WHERE d.id = purchase_order_analytics.document_id))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'procurement.order')
         AND EXISTS (SELECT 1 FROM public.purchase_orders d WHERE d.id = purchase_order_analytics.document_id));
ALTER POLICY "Écriture avec la pièce" ON public.po_line_analytics
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'procurement.order')
         AND EXISTS (SELECT 1 FROM public.po_lines l JOIN public.purchase_orders d ON d.id = l.po_id WHERE l.id = po_line_analytics.line_id))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'procurement.order')
         AND EXISTS (SELECT 1 FROM public.po_lines l JOIN public.purchase_orders d ON d.id = l.po_id WHERE l.id = po_line_analytics.line_id));

-- ─── Prévisions de trésorerie : treasury.edit_forecast (droit existant) ───
DROP POLICY tenant_cashflow_forecasts ON public.cashflow_forecasts;
CREATE POLICY "Lecture société" ON public.cashflow_forecasts FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Saisie habilitée" ON public.cashflow_forecasts FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'treasury.edit_forecast'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'treasury.edit_forecast'));

-- ─── Modèles de rapports : reports.templates ───
DROP POLICY "Tenant isolation" ON public.report_templates;
CREATE POLICY "Lecture société" ON public.report_templates FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Paramétrage habilité" ON public.report_templates FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'reports.templates'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'reports.templates'));

-- ─── Circuits de validation : règles avec workflow.manage ; instances écrites par les fonctions seulement ───
DROP POLICY "Tenant isolation" ON public.workflow_rules;
CREATE POLICY "Lecture société" ON public.workflow_rules FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Paramétrage habilité" ON public.workflow_rules FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'workflow.manage'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'workflow.manage'));
DROP POLICY "Tenant isolation" ON public.workflow_instances;
CREATE POLICY "Lecture société" ON public.workflow_instances FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

-- ─── Ancienne matrice de droits (remplacée par V23, plus lue) : lecture seule ───
DROP POLICY "Access via role" ON public.erp_permissions;
CREATE POLICY "Lecture société" ON public.erp_permissions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.erp_roles r WHERE r.id = erp_permissions.role_id AND r.tenant_id = public.get_user_tenant_id(auth.uid())));

-- ─── Historique des analyses IA : ajout par l'auteur de l'analyse, jamais modifié ni effacé ───
DROP POLICY "Tenant isolation" ON public.ai_analysis_history;
CREATE POLICY "Lecture société" ON public.ai_analysis_history FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Ajout par l'auteur" ON public.ai_analysis_history FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND created_by = auth.uid());
