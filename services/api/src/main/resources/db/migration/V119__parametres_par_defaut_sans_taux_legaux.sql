-- V119 — Paramètres par défaut sans taux légaux ni montants inventés ; doublons des paramètres fournisseurs.
--
-- Balayage du 19 nov. 2026 (« aucune règle codée en dur ») :
--   • seed_ap_defaults pré-remplissait des taux de retenue à la source (7,5 / 15 / 20 / 10 %) sur des comptes
--     4471 à 4474 que le plan de la société ne contient pas forcément : des taux légaux que personne n'a validés
--     (règle déjà suivie pour les codes TVA : aucun taux légal pré-rempli) ;
--   • ses insertions de retenues et de règles de notification n'avaient aucune protection contre les doublons,
--     alors que la fonction est appelée à chaque modification des paramètres fournisseurs : 3 652 lignes pour
--     4 taux distincts sur la société de test du nuage (744 sur site) ; aucune société réelle concernée ;
--   • seed_ar_defaults fixait des frais de relance de 15 000, 50 000 et 150 000 XOF.
-- Désormais : les retenues se saisissent par la société ; les frais de relance par défaut sont nuls (les niveaux et
-- délais restent proposés, modifiables) ; libellés en français ; doublons supprimés (la ligne la plus ancienne de
-- chaque valeur est conservée ; aucune autre table ne les référence) et rendus impossibles.

DELETE FROM public.ap_withholding_rates w
 USING public.ap_withholding_rates k
 WHERE w.tenant_id = k.tenant_id AND lower(btrim(w.category)) = lower(btrim(k.category))
   AND (k.created_at, k.id) < (w.created_at, w.id);
CREATE UNIQUE INDEX ap_withholding_rates_category_key ON public.ap_withholding_rates (tenant_id, lower(btrim(category)));

DELETE FROM public.ap_notification_rules r
 USING public.ap_notification_rules k
 WHERE r.tenant_id = k.tenant_id AND r.event = k.event AND r.channel = k.channel
   AND (k.created_at, k.id) < (r.created_at, r.id);
CREATE UNIQUE INDEX ap_notification_rules_event_key ON public.ap_notification_rules (tenant_id, event, channel);

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

  -- Retenues à la source : aucun taux pré-rempli (taux et comptes fixés par la société, validés localement).

  INSERT INTO public.ap_notification_rules(tenant_id, event, channel, recipients) VALUES
    (_tenant_id, 'Facture en attente > 48h', 'email', 'Responsable fournisseurs'),
    (_tenant_id, 'Échéance dans 3 jours', 'email,inapp', 'Comptable fournisseurs, Trésorerie'),
    (_tenant_id, 'Échec du rapprochement à trois', 'email', 'Responsable fournisseurs')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.ap_approval_thresholds(tenant_id, level, max_amount, approver, sla_hours, doc_types) VALUES
    (_tenant_id, 'L1', NULL, 'Approbateur niveau 1', 24, 'Facture, Avoir')
  ON CONFLICT DO NOTHING;
END;
$function$;

CREATE OR REPLACE FUNCTION public.seed_ar_defaults()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.ar_payment_terms (tenant_id, code, label, days, discount_percent) VALUES
    (NEW.id, 'NET30', 'Net à 30 jours', 30, 0),
    (NEW.id, 'NET60', 'Net à 60 jours', 60, 0),
    (NEW.id, 'COMPTANT', 'Comptant à la livraison', 0, 0)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.ar_numbering_series (tenant_id, doc_type, prefix, format) VALUES
    (NEW.id, 'invoice', 'INV-', 'INV-YYYY-####'),
    (NEW.id, 'credit_note', 'CN-', 'CN-YYYY-####'),
    (NEW.id, 'receipt', 'REC-', 'REC-YYYY-####'),
    (NEW.id, 'adjustment', 'ADJ-', 'ADJ-YYYY-####')
  ON CONFLICT DO NOTHING;

  -- Niveaux de relance proposés, sans frais : les frais éventuels relèvent des conditions de la société.
  INSERT INTO public.ar_dunning_rules (tenant_id, level, days_overdue, action, fee_amount, template) VALUES
    (NEW.id, 1, 7, 'Rappel par e-mail', 0, 'Rappel amiable'),
    (NEW.id, 2, 30, 'Lettre de relance', 0, 'Première relance'),
    (NEW.id, 3, 60, 'Appel et lettre', 0, 'Dernière relance'),
    (NEW.id, 4, 90, 'Mise en demeure', 0, 'Mise en demeure')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.ar_general_settings (tenant_id) VALUES (NEW.id)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END; $function$;
